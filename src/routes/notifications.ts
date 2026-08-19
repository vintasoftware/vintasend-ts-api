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
  PaginatedResponse,
} from '../contract/types.js';
import { toWireCapabilities } from '../domain/capabilities.js';
import { buildBackendFilter, buildOrderBy } from '../domain/filters.js';
import {
  notificationListQuerySchema,
  paginationQuerySchema,
  resendBodySchema,
} from '../domain/schemas.js';
import {
  serializeNotification,
  serializeNotificationDetail,
  serializeUserNotification,
} from '../domain/serialize.js';
import { ApiError } from '../errors.js';
import type { TemplateSourceClient } from '../services/notification-preview.js';
import { buildNotificationPreview } from '../services/notification-preview.js';
import type {
  ApiAnyDatabaseNotification,
  NotificationServicePort,
} from '../services/notification-service-port.js';
import { createPagedNotificationReader } from '../services/paged-notification-reader.js';
import { validate } from './validation.js';

export type NotificationRoutesDependencies = {
  getService: () => Promise<NotificationServicePort>;
  getTemplateClient: () => TemplateSourceClient;
  backendIdentifier?: string | undefined;
};

function paginate(
  notifications: ApiAnyDatabaseNotification[],
  page: number,
  pageSize: number,
): PaginatedResponse<Notification> {
  const data = notifications.map(serializeNotification);

  return {
    data,
    page,
    pageSize,
    hasMore: data.length === pageSize,
  };
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

    return c.json<DataResponse<FilterCapabilities>>({
      data: toWireCapabilities(await reader.capabilities()),
    });
  });

  routes.get('/notifications', validate('query', notificationListQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const reader = await readerFor();
    const capabilities = await reader.capabilities();

    const notifications = await reader.filterNotifications(
      buildBackendFilter(query, capabilities),
      query.page,
      query.pageSize,
      buildOrderBy(query, capabilities),
    );

    return c.json(paginate(notifications, query.page, query.pageSize));
  });

  routes.get('/notifications/pending', validate('query', paginationQuerySchema), async (c) => {
    const { page, pageSize } = c.req.valid('query');
    const reader = await readerFor();
    const notifications = await reader.getPendingNotifications(page, pageSize);

    return c.json(paginate(notifications, page, pageSize));
  });

  routes.get('/notifications/future', validate('query', paginationQuerySchema), async (c) => {
    const { page, pageSize } = c.req.valid('query');
    const reader = await readerFor();
    const notifications = await reader.getFutureNotifications(page, pageSize);

    return c.json(paginate(notifications, page, pageSize));
  });

  routes.get('/notifications/one-off', validate('query', paginationQuerySchema), async (c) => {
    const { page, pageSize } = c.req.valid('query');
    const reader = await readerFor();
    const notifications = await reader.getOneOffNotifications(page, pageSize);

    return c.json(paginate(notifications, page, pageSize));
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

  return routes;
}
