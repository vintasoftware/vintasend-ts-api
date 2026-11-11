/**
 * The optional notification actions over HTTP: requeue and repin with `templateVersion`,
 * `expectedVersion` and `send`, the `{ id, version }` search, and the action capabilities.
 *
 * Every refusal is checked for what it did not do: the service is not called when the API refuses,
 * and nothing reaches the backend when the service does.
 */

import { NotificationActionError, VintaSendFactory } from 'vintasend';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { apiKeyAuthenticator } from '../src/middleware/authenticate.js';
import {
  type ApiNotificationConfig,
  asNotificationServicePort,
  type NotificationServicePort,
} from '../src/services/notification-service-port.js';
import {
  authHeaders,
  makeService,
  makeTemplateClient,
  makeUserNotification,
  TEST_API_KEY,
} from './helpers/fixtures.js';

const ALL_ACTIONS = {
  'repin.expectedVersion': true,
  'requeue.expectedVersion': true,
  'requeue.templateVersion': true,
  'versions.filter': true,
};

/** A service on a VintaSend that reports and implements every optional action. */
function makeCapableService(overrides: Record<string, unknown> = {}) {
  return makeService({
    getBackendSupportedActionCapabilities: vi.fn().mockResolvedValue(ALL_ACTIONS),
    filterNotificationVersions: vi.fn().mockResolvedValue([]),
    ...overrides,
  });
}

function buildApp(service: NotificationServicePort) {
  return createApp({
    authenticate: apiKeyAuthenticator(TEST_API_KEY),
    getService: async () => service,
    getTemplateClient: () => makeTemplateClient(),
  });
}

const post = (app: ReturnType<typeof createApp>, path: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

function refusal(reason: string, action: 'requeue' | 'repin' = 'requeue') {
  return new NotificationActionError({
    action,
    reason: reason as never,
    notificationId: 'notif-1',
    message: `Refused: ${reason}`,
  });
}

describe('POST /api/v1/notifications/:id/requeue', () => {
  it('passes templateVersion, expectedVersion and send to the service', async () => {
    const service = makeCapableService();

    const response = await post(buildApp(service), '/api/v1/notifications/notif-1/requeue', {
      templateVersion: 4,
      expectedVersion: '2026-01-01T00:00:00.001Z',
      send: false,
    });

    expect(response.status).toBe(200);
    expect(service.requeueNotification).toHaveBeenCalledWith('notif-1', {
      templateVersion: 4,
      expectedVersion: '2026-01-01T00:00:00.001Z',
      send: false,
    });
  });

  it('returns the status the send left, such as FAILED', async () => {
    const service = makeCapableService({
      requeueNotification: vi.fn().mockResolvedValue(makeUserNotification({ status: 'FAILED' })),
    });

    const body = await (
      await post(buildApp(service), '/api/v1/notifications/notif-1/requeue')
    ).json();

    expect(body.data.status).toBe('FAILED');
  });

  it.each(['CHANGED', 'UNSUPPORTED', 'INVALID_STATUS'])(
    'answers %s with a 409 carrying the reason',
    async (reason) => {
      const service = makeCapableService({
        requeueNotification: vi.fn().mockRejectedValue(refusal(reason)),
      });

      const response = await post(buildApp(service), '/api/v1/notifications/notif-1/requeue', {
        expectedVersion: 'v1',
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: { code: 'CONFLICT', message: `Refused: ${reason}`, details: { reason } },
      });
    },
  );

  it('carries the reason on a 404 too', async () => {
    const service = makeCapableService({
      requeueNotification: vi.fn().mockRejectedValue(refusal('NOT_FOUND')),
    });

    const response = await post(buildApp(service), '/api/v1/notifications/missing/requeue');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'NOT_FOUND', details: { reason: 'NOT_FOUND' } },
    });
  });

  it.each([{ templateVersion: 4 }, { expectedVersion: 'v1' }, { send: false }])(
    'refuses %o for a service that predates it, without calling it',
    async (body) => {
      const service = makeService();

      const response = await post(buildApp(service), '/api/v1/notifications/notif-1/requeue', body);

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'CONFLICT', details: { reason: 'UNSUPPORTED' } },
      });
      expect(service.requeueNotification).not.toHaveBeenCalled();
    },
  );

  it('still requeues with sendAfter alone on such a service', async () => {
    const service = makeService();

    const response = await post(buildApp(service), '/api/v1/notifications/notif-1/requeue', {
      sendAfter: null,
    });

    expect(response.status).toBe(200);
  });

  it.each([
    { expectedVersion: '' },
    { expectedVersion: 7 },
    { send: 'no' },
    { templateVersion: -1 },
    { templateVersion: 1.5 },
  ])('rejects %o with a 400', async (body) => {
    const service = makeCapableService();

    const response = await post(buildApp(service), '/api/v1/notifications/notif-1/requeue', body);

    expect(response.status).toBe(400);
    expect(service.requeueNotification).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/notifications/:id/repin', () => {
  it('passes expectedVersion to the service', async () => {
    const service = makeCapableService();

    await post(buildApp(service), '/api/v1/notifications/notif-1/repin', {
      templateVersion: 4,
      expectedVersion: 'v1',
    });

    expect(service.repinNotification).toHaveBeenCalledWith('notif-1', {
      templateVersion: 4,
      expectedVersion: 'v1',
    });
  });

  it('answers CHANGED with a 409 carrying the reason', async () => {
    const service = makeCapableService({
      repinNotification: vi.fn().mockRejectedValue(refusal('CHANGED', 'repin')),
    });

    const response = await post(buildApp(service), '/api/v1/notifications/notif-1/repin', {
      expectedVersion: 'v1',
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { details: { reason: 'CHANGED' } },
    });
  });

  it('refuses expectedVersion for a service that predates it, without calling it', async () => {
    const service = makeService();

    const response = await post(buildApp(service), '/api/v1/notifications/notif-1/repin', {
      expectedVersion: 'v1',
    });

    expect(response.status).toBe(409);
    expect(service.repinNotification).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/notifications/versions', () => {
  it('runs the filter tree, with dates, on the backend page, and returns ids and versions only', async () => {
    const service = makeCapableService({
      filterNotificationVersions: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 7, version: 'a', bodyTemplate: 'welcome' },
          { id: 9, version: 'b' },
        ])
        .mockResolvedValueOnce([{ id: 11, version: 'c' }]),
    });
    const filter = {
      and: [
        { bodyTemplate: 'welcome', createdAtRange: { from: '2026-01-01T00:00:00.000Z' } },
        {
          or: [
            {
              and: [
                { status: 'PENDING_SEND', hasSendAfter: true, hasRequestedTemplateVersion: true },
                { not: { requestedTemplateVersion: 4 } },
              ],
            },
            { status: 'FAILED' },
          ],
        },
      ],
    };

    const response = await post(buildApp(service), '/api/v1/notifications/versions', {
      filter,
      page: 1,
      pageSize: 2,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        { id: '7', version: 'a' },
        { id: '9', version: 'b' },
      ],
      page: 1,
      pageSize: 2,
      hasMore: true,
    });
    const expectedFilter = {
      and: [
        { bodyTemplate: 'welcome', createdAtRange: { from: new Date('2026-01-01T00:00:00.000Z') } },
        filter.and[1],
      ],
    };
    // The contract's page 1 is the backend's page 0; the probe for `hasMore` is one-row page 2.
    expect(service.filterNotificationVersions).toHaveBeenNthCalledWith(
      1,
      expectedFilter,
      0,
      2,
      undefined,
    );
    expect(service.filterNotificationVersions).toHaveBeenNthCalledWith(
      2,
      expectedFilter,
      2,
      1,
      undefined,
    );
  });

  it('matches everything with no body, a page of 100', async () => {
    const service = makeCapableService();

    const response = await post(buildApp(service), '/api/v1/notifications/versions');

    expect(response.status).toBe(200);
    expect(service.filterNotificationVersions).toHaveBeenCalledWith({}, 0, 100, undefined);
  });

  it('pages a one-indexed backend in its own numbering', async () => {
    const service = makeCapableService({
      getBackendSupportedFilterCapabilities: vi
        .fn()
        .mockResolvedValue({ 'pagination.oneIndexed': true }),
    });

    await post(buildApp(service), '/api/v1/notifications/versions', { page: 3 });

    expect(service.filterNotificationVersions).toHaveBeenCalledWith({}, 3, 100, undefined);
  });

  it('refuses a filter the backend reports it cannot run, without calling it', async () => {
    const service = makeCapableService({
      getBackendSupportedFilterCapabilities: vi
        .fn()
        .mockResolvedValue({ 'logical.or': false, 'negation.sendAfterRange': false }),
    });

    const response = await post(buildApp(service), '/api/v1/notifications/versions', {
      filter: {
        and: [
          { or: [{ status: 'FAILED' }, { status: 'CANCELLED' }] },
          { not: { sendAfterRange: { from: '2026-01-01T00:00:00.000Z' } } },
        ],
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        details: {
          issues: [
            { path: 'filter.and.0.or', message: 'The backend does not support logical.or.' },
            {
              path: 'filter.and.1.not.sendAfterRange',
              message: 'The backend does not support negation.sendAfterRange.',
            },
          ],
        },
      },
    });
    expect(service.filterNotificationVersions).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown field', { recipientEmail: 'a@b.c' }],
    ['a group mixed with fields', { status: 'FAILED', or: [{ status: 'SENT' }] }],
    ['an empty or', { or: [] }],
    ['a date that is not one', { sentAtRange: { from: 'yesterday' } }],
    ['nesting past six levels', { not: { not: { not: { not: { not: { not: { not: {} } } } } } } }],
  ])('rejects %s with a 400', async (_label, filter) => {
    const service = makeCapableService();

    const response = await post(buildApp(service), '/api/v1/notifications/versions', { filter });

    expect(response.status).toBe(400);
    expect(service.filterNotificationVersions).not.toHaveBeenCalled();
  });

  it('rejects a page size over 1000', async () => {
    const response = await post(buildApp(makeCapableService()), '/api/v1/notifications/versions', {
      pageSize: 1001,
    });

    expect(response.status).toBe(400);
  });

  it('answers 409 UNSUPPORTED for a service that cannot list versions', async () => {
    for (const service of [
      makeService(),
      makeCapableService({
        getBackendSupportedActionCapabilities: vi
          .fn()
          .mockResolvedValue({ ...ALL_ACTIONS, 'versions.filter': false }),
      }),
    ]) {
      const response = await post(buildApp(service), '/api/v1/notifications/versions');

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'CONFLICT', details: { reason: 'UNSUPPORTED' } },
      });
    }
  });
});

describe('GET /api/v1/capabilities', () => {
  it('adds the action capabilities to the filter capabilities', async () => {
    const service = makeCapableService({
      getBackendSupportedFilterCapabilities: vi.fn().mockResolvedValue({ 'logical.or': true }),
    });

    const response = await buildApp(service).request('/api/v1/capabilities', {
      headers: authHeaders,
    });

    await expect(response.json()).resolves.toEqual({
      data: { 'logical.or': true, ...ALL_ACTIONS },
    });
  });
});

describe('through a real VintaSend', () => {
  it('passes the service refusal on as 409 UNSUPPORTED, with nothing written', async () => {
    const backend = {
      getNotification: vi.fn().mockResolvedValue(makeUserNotification({ status: 'FAILED' })),
      getOneOffNotification: vi.fn().mockResolvedValue(null),
      requeueNotification: vi.fn(),
      persistNotificationUpdate: vi.fn(),
      getBackendIdentifier: () => 'primary',
    };
    const vintasend = new VintaSendFactory<ApiNotificationConfig>().create({
      adapters: [],
      backend: backend as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      contextGeneratorsMap: {},
    });

    const response = await post(
      buildApp(asNotificationServicePort(vintasend)),
      '/api/v1/notifications/notif-1/requeue',
      { templateVersion: 4, expectedVersion: 'v1' },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { details: { reason: 'UNSUPPORTED' } },
    });
    expect(backend.requeueNotification).not.toHaveBeenCalled();
    expect(backend.persistNotificationUpdate).not.toHaveBeenCalled();
  });
});
