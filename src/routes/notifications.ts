/**
 * Notification endpoints. Each handler maps HTTP input to a VintaSend service
 * call and the result back to the wire contract — no business logic beyond the
 * translation itself.
 */

import { Hono } from 'hono';

import type {
  CancelledNotification,
  DataResponse,
  FilterCapabilities,
  Notification,
  NotificationDetail,
  NotificationPreview,
  NotificationVersionEntry,
  PaginatedResponse,
} from '../contract/types.js';
import { toWireCapabilities } from '../domain/capabilities.js';
import {
  buildBackendFilter,
  buildOrderBy,
  toBackendFilter,
  unsupportedFilterFeatures,
} from '../domain/filters.js';
import { toBackendPage } from '../domain/pagination.js';
import {
  notificationListQuerySchema,
  notificationVersionsSearchBodySchema,
  paginationQuerySchema,
  repinBodySchema,
  requeueBodySchema,
  resendBodySchema,
} from '../domain/schemas.js';
import {
  serializeNotification,
  serializeNotificationDetail,
  serializeUserNotification,
} from '../domain/serialize.js';
import { ApiError, fromNotificationActionError, unsupported } from '../errors.js';
import type { TemplateSourceClient } from '../services/notification-preview.js';
import { buildNotificationPreview } from '../services/notification-preview.js';
import type {
  ApiAnyDatabaseNotification,
  ApiRequeueOptions,
  NotificationServicePort,
} from '../services/notification-service-port.js';
import { createPagedNotificationReader } from '../services/paged-notification-reader.js';
import { validate } from './validation.js';

export type NotificationRoutesDependencies = {
  getService: () => Promise<NotificationServicePort>;
  getTemplateClient: () => TemplateSourceClient;
  backendIdentifier?: string | undefined;
};

/**
 * One page of a listing, and whether the next page has a row.
 *
 * Backends are not required to count, so that is asked directly: a full page is followed by a
 * one-row read of the first row after it, which is page `page * pageSize + 1` of one-row pages. A
 * short page is the last one without asking. `read` takes the contract's 1-indexed pages.
 */
async function paginate(
  read: (page: number, pageSize: number) => Promise<ApiAnyDatabaseNotification[]>,
  page: number,
  pageSize: number,
): Promise<PaginatedResponse<Notification>> {
  const notifications = await read(page, pageSize);
  const hasMore =
    notifications.length === pageSize && (await read(page * pageSize + 1, 1)).length > 0;

  return {
    data: notifications.map(serializeNotification),
    page,
    pageSize,
    hasMore,
  };
}

/**
 * The action capabilities of the backend, every key explicit.
 *
 * Unlike the filter capabilities, a missing key here means "unsupported", so the four keys are
 * always sent. A service without `getBackendSupportedActionCapabilities` predates these actions and
 * supports none of them.
 */
async function actionCapabilities(
  service: NotificationServicePort,
  backendIdentifier: string | undefined,
): Promise<Record<ActionCapability, boolean>> {
  const reported =
    typeof service.getBackendSupportedActionCapabilities === 'function'
      ? await service.getBackendSupportedActionCapabilities(backendIdentifier)
      : {};
  return Object.fromEntries(
    ACTION_CAPABILITIES.map((key) => [key, reported[key] === true]),
  ) as Record<ActionCapability, boolean>;
}

const ACTION_CAPABILITIES = [
  'repin.expectedVersion',
  'requeue.expectedVersion',
  'requeue.templateVersion',
  'versions.filter',
] as const;

type ActionCapability = (typeof ACTION_CAPABILITIES)[number];

/**
 * Refuse the newer action options for a service that would ignore them.
 *
 * A VintaSend that reports action capabilities refuses an option its backend cannot honour itself,
 * with `UNSUPPORTED`. One that predates them would drop `templateVersion` and `expectedVersion`
 * silently and send despite `send: false`, so this API refuses them up front instead.
 */
function assertServiceKnowsActionOptions(
  service: NotificationServicePort,
  options: { templateVersion?: number; expectedVersion?: string; send?: boolean },
): void {
  if (typeof service.getBackendSupportedActionCapabilities === 'function') {
    return;
  }
  const given = Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  if (given.length > 0) {
    throw unsupported(
      `The configured service does not support ${given.join(', ')}; it predates these options.`,
    );
  }
}

/**
 * Runs a re-queue or re-pin, answering the service's refusals with the contract's 404 and 409.
 */
async function runNotificationAction(
  action: () => Promise<ApiAnyDatabaseNotification>,
): Promise<ApiAnyDatabaseNotification> {
  try {
    return await action();
  } catch (error) {
    throw fromNotificationActionError(error) ?? error;
  }
}

/**
 * Looks a notification up as a user notification first, then as a one-off one.
 */
async function findNotification(
  service: NotificationServicePort,
  id: string,
  backendIdentifier: string | undefined,
): Promise<ApiAnyDatabaseNotification> {
  const notification =
    (await service.getNotification(id, false, backendIdentifier)) ??
    (await service.getOneOffNotification(id, false, backendIdentifier));

  if (!notification) {
    throw ApiError.notFound(`Notification with ID ${id} was not found.`);
  }

  return notification;
}

export function createNotificationRoutes(deps: NotificationRoutesDependencies): Hono {
  const routes = new Hono();
  const { backendIdentifier } = deps;

  /**
   * Reads pages the way the contract does: 1-indexed, translated for the backend.
   */
  const readerFor = async () =>
    createPagedNotificationReader(await deps.getService(), backendIdentifier);

  routes.get('/capabilities', async (c) => {
    const reader = await readerFor();
    const service = await deps.getService();

    return c.json<DataResponse<FilterCapabilities>>({
      data: {
        ...toWireCapabilities(await reader.capabilities()),
        ...(await actionCapabilities(service, backendIdentifier)),
      },
    });
  });

  routes.get('/notifications', validate('query', notificationListQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const reader = await readerFor();
    const capabilities = await reader.capabilities();

    const filter = buildBackendFilter(query, capabilities);
    const orderBy = buildOrderBy(query, capabilities);

    return c.json(
      await paginate(
        (page, pageSize) => reader.filterNotifications(filter, page, pageSize, orderBy),
        query.page,
        query.pageSize,
      ),
    );
  });

  routes.get('/notifications/pending', validate('query', paginationQuerySchema), async (c) => {
    const { page, pageSize } = c.req.valid('query');
    const reader = await readerFor();

    return c.json(await paginate(reader.getPendingNotifications, page, pageSize));
  });

  routes.get('/notifications/future', validate('query', paginationQuerySchema), async (c) => {
    const { page, pageSize } = c.req.valid('query');
    const reader = await readerFor();

    return c.json(await paginate(reader.getFutureNotifications, page, pageSize));
  });

  routes.get('/notifications/one-off', validate('query', paginationQuerySchema), async (c) => {
    const { page, pageSize } = c.req.valid('query');
    const reader = await readerFor();

    return c.json(await paginate(reader.getOneOffNotifications, page, pageSize));
  });

  routes.get('/notifications/:id', async (c) => {
    const service = await deps.getService();
    const notification = await findNotification(service, c.req.param('id'), backendIdentifier);

    return c.json<DataResponse<NotificationDetail>>({
      data: serializeNotificationDetail(notification),
    });
  });

  routes.get('/notifications/:id/preview', async (c) => {
    const service = await deps.getService();
    const notification = await findNotification(service, c.req.param('id'), backendIdentifier);

    const preview = await buildNotificationPreview({
      service,
      templateClient: deps.getTemplateClient(),
      notification,
    });

    return c.json<DataResponse<NotificationPreview>>({ data: preview });
  });

  routes.post('/notifications/:id/resend', validate('json', resendBodySchema), async (c) => {
    const { useStoredContext } = c.req.valid('json');
    const service = await deps.getService();

    const resent = await service.resendNotification(c.req.param('id'), useStoredContext);

    if (!resent) {
      throw ApiError.conflict(
        'The notification could not be resent. It may not exist, may be a one-off notification, or may be scheduled for the future.',
      );
    }

    return c.json<DataResponse<Notification>>({ data: serializeUserNotification(resent) }, 201);
  });

  routes.post('/notifications/:id/cancel', async (c) => {
    const id = c.req.param('id');
    const service = await deps.getService();
    const notification = await findNotification(service, id, backendIdentifier);

    if (notification.status !== 'PENDING_SEND') {
      throw ApiError.conflict('Only notifications in PENDING_SEND status can be cancelled.');
    }

    await service.cancelNotification(id);

    return c.json<DataResponse<CancelledNotification>>({
      data: { id, status: 'CANCELLED' },
    });
  });

  routes.post('/notifications/:id/requeue', validate('json', requeueBodySchema), async (c) => {
    const { sendAfter, templateVersion, expectedVersion, send } = c.req.valid('json');
    const service = await deps.getService();
    assertServiceKnowsActionOptions(service, { templateVersion, expectedVersion, send });

    // Only the keys the caller sent: an absent `sendAfter` keeps the notification's own.
    const options: ApiRequeueOptions = {
      ...(sendAfter === undefined
        ? {}
        : { sendAfter: sendAfter === null ? null : new Date(sendAfter) }),
      ...(templateVersion === undefined ? {} : { templateVersion }),
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      ...(send === undefined ? {} : { send }),
    };

    const requeued = await runNotificationAction(() =>
      service.requeueNotification(c.req.param('id'), options),
    );

    return c.json<DataResponse<Notification>>({ data: serializeNotification(requeued) });
  });

  routes.post('/notifications/:id/repin', validate('json', repinBodySchema), async (c) => {
    const { templateVersion, expectedVersion } = c.req.valid('json');
    const service = await deps.getService();
    assertServiceKnowsActionOptions(service, { expectedVersion });

    const repinned = await runNotificationAction(() =>
      service.repinNotification(c.req.param('id'), {
        ...(templateVersion === undefined ? {} : { templateVersion }),
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      }),
    );

    return c.json<DataResponse<Notification>>({ data: serializeNotification(repinned) });
  });

  routes.post(
    '/notifications/versions',
    validate('json', notificationVersionsSearchBodySchema),
    async (c) => {
      const { filter, page, pageSize } = c.req.valid('json');
      const service = await deps.getService();
      const actions = await actionCapabilities(service, backendIdentifier);
      const { filterNotificationVersions } = service;
      if (!actions['versions.filter'] || typeof filterNotificationVersions !== 'function') {
        throw unsupported(
          'The configured backend cannot list notification versions (versions.filter).',
        );
      }

      const reader = await readerFor();
      const capabilities = await reader.capabilities();
      const issues = unsupportedFilterFeatures(filter, capabilities);
      if (issues.length > 0) {
        throw ApiError.badRequest('The backend cannot run this filter.', issues);
      }

      const backendFilter = toBackendFilter(filter);
      const read = (contractPage: number, size: number) =>
        filterNotificationVersions.call(
          service,
          backendFilter,
          toBackendPage(contractPage, capabilities),
          size,
          backendIdentifier,
        );

      const versions = await read(page, pageSize);
      const hasMore =
        versions.length === pageSize && (await read(page * pageSize + 1, 1)).length > 0;

      return c.json<PaginatedResponse<NotificationVersionEntry>>({
        data: versions.map(({ id, version }) => ({ id: String(id), version })),
        page,
        pageSize,
        hasMore,
      });
    },
  );

  return routes;
}
