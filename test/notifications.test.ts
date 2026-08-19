import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { TemplateSourceClient } from '../src/services/notification-preview.js';
import type { NotificationServicePort } from '../src/services/notification-service-port.js';
import {
  authHeaders,
  makeOneOffNotification,
  makeService,
  makeTemplateClient,
  makeUserNotification,
  TEST_API_KEY,
} from './helpers/fixtures.js';

function buildApp({
  service = makeService(),
  templateClient = makeTemplateClient(),
  backendIdentifier,
}: {
  service?: NotificationServicePort;
  templateClient?: TemplateSourceClient;
  backendIdentifier?: string;
} = {}) {
  const app = createApp({
    apiKey: TEST_API_KEY,
    getService: async () => service,
    getTemplateClient: () => templateClient,
    backendIdentifier,
  });

  return { app, service, templateClient };
}

const get = (app: ReturnType<typeof createApp>, path: string) =>
  app.request(path, { headers: authHeaders });

const post = (app: ReturnType<typeof createApp>, path: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

describe('GET /api/v1/notifications', () => {
  it('serializes user notifications with ISO dates and a kind discriminator', async () => {
    const service = makeService({
      filterNotifications: vi.fn().mockResolvedValue([makeUserNotification()]),
    });
    const { app } = buildApp({ service });

    const response = await get(app, '/api/v1/notifications');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      kind: 'user',
      id: 'notif-1',
      userId: 'user-1',
      status: 'SENT',
      sentAt: '2024-01-15T10:00:00.000Z',
      createdAt: '2024-01-15T09:00:00.000Z',
      updatedAt: '2024-01-15T09:30:00.000Z',
      sendAfter: null,
      tenant: 'tenant-1',
    });
    // List payloads stay small: no context blobs.
    expect(body.data[0]).not.toHaveProperty('contextUsed');
  });

  it('serializes one-off notifications with their recipient fields', async () => {
    const service = makeService({
      filterNotifications: vi.fn().mockResolvedValue([makeOneOffNotification()]),
    });
    const { app } = buildApp({ service });

    const body = await (await get(app, '/api/v1/notifications')).json();

    expect(body.data[0]).toMatchObject({
      kind: 'one-off',
      id: 'oneoff-1',
      emailOrPhone: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
    });
    expect(body.data[0]).not.toHaveProperty('userId');
  });

  it('defaults to page 1 with pageSize 20 and converts to 0-indexed backend pages', async () => {
    const { app, service } = buildApp();

    const body = await (await get(app, '/api/v1/notifications')).json();

    expect(service.filterNotifications).toHaveBeenCalledWith(
      {},
      0,
      20,
      { field: 'createdAt', direction: 'desc' },
      undefined,
    );
    expect(body).toMatchObject({ page: 1, pageSize: 20, hasMore: false });
  });

  it('reports hasMore when a full page comes back', async () => {
    const service = makeService({
      filterNotifications: vi
        .fn()
        .mockResolvedValue([makeUserNotification(), makeUserNotification({ id: 'notif-2' })]),
    });
    const { app } = buildApp({ service });

    const body = await (await get(app, '/api/v1/notifications?pageSize=2')).json();

    expect(body.hasMore).toBe(true);
  });

  it('maps filters onto the backend filter, negotiating string lookups', async () => {
    const { app, service } = buildApp();

    await get(
      app,
      '/api/v1/notifications?status=SENT&notificationType=EMAIL&adapterUsed=mailgun' +
        '&userId=user-1&tenant=tenant-1&bodyTemplate=welcome' +
        '&createdAtFrom=2024-01-01T00:00:00.000Z&sentAtTo=2024-02-01T00:00:00.000Z',
    );

    expect(service.filterNotifications).toHaveBeenCalledWith(
      {
        status: 'SENT',
        notificationType: 'EMAIL',
        adapterUsed: 'mailgun',
        userId: 'user-1',
        tenant: 'tenant-1',
        bodyTemplate: { lookup: 'includes', value: 'welcome', caseSensitive: false },
        createdAtRange: { from: new Date('2024-01-01T00:00:00.000Z') },
        sentAtRange: { to: new Date('2024-02-01T00:00:00.000Z') },
      },
      0,
      20,
      { field: 'createdAt', direction: 'desc' },
      undefined,
    );
  });

  it('falls back to an exact match when the backend cannot do includes', async () => {
    const service = makeService({
      getBackendSupportedFilterCapabilities: vi.fn().mockResolvedValue({
        'stringLookups.includes': false,
        'stringLookups.caseInsensitive': true,
      }),
    });
    const { app } = buildApp({ service });

    await get(app, '/api/v1/notifications?contextName=welcome');

    expect(service.filterNotifications).toHaveBeenCalledWith(
      { contextName: { lookup: 'exact', value: 'welcome', caseSensitive: false } },
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
    );
  });

  it('drops ordering the backend does not support instead of failing', async () => {
    const service = makeService({
      getBackendSupportedFilterCapabilities: vi.fn().mockResolvedValue({ 'orderBy.sentAt': false }),
    });
    const { app } = buildApp({ service });

    const response = await get(app, '/api/v1/notifications?orderByField=sentAt');

    expect(response.status).toBe(200);
    expect(service.filterNotifications).toHaveBeenCalledWith({}, 0, 20, undefined, undefined);
  });

  it('passes the page straight through for a one-indexed backend', async () => {
    const service = makeService({
      getBackendSupportedFilterCapabilities: vi
        .fn()
        .mockResolvedValue({ 'pagination.oneIndexed': true }),
    });
    const { app } = buildApp({ service });

    await get(app, '/api/v1/notifications?page=2');

    expect(service.filterNotifications).toHaveBeenCalledWith(
      {},
      2,
      20,
      expect.anything(),
      undefined,
    );
  });

  it('forwards the configured backend identifier', async () => {
    const { app, service } = buildApp({ backendIdentifier: 'replica' });

    await get(app, '/api/v1/notifications');

    expect(service.getBackendSupportedFilterCapabilities).toHaveBeenCalledWith('replica');
    expect(service.filterNotifications).toHaveBeenCalledWith(
      {},
      0,
      20,
      expect.anything(),
      'replica',
    );
  });

  it('rejects invalid query parameters with a 400 and field details', async () => {
    const { app } = buildApp();

    const response = await get(app, '/api/v1/notifications?status=NOPE');
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.details.issues[0].path).toBe('status');
  });

  it('rejects a pageSize above the maximum', async () => {
    const { app } = buildApp();

    expect((await get(app, '/api/v1/notifications?pageSize=500')).status).toBe(400);
  });
});

describe('collection shortcuts', () => {
  it.each([
    ['/api/v1/notifications/pending', 'getPendingNotifications'],
    ['/api/v1/notifications/future', 'getFutureNotifications'],
    ['/api/v1/notifications/one-off', 'getOneOffNotifications'],
  ] as const)('%s delegates to %s', async (path, method) => {
    const service = makeService({
      [method]: vi.fn().mockResolvedValue([makeUserNotification()]),
    });
    const { app } = buildApp({ service });

    const response = await get(app, `${path}?page=2&pageSize=5`);

    expect(response.status).toBe(200);
    expect(service[method]).toHaveBeenCalledWith(1, 5, undefined);
    await expect(response.json()).resolves.toMatchObject({ page: 2, pageSize: 5 });
  });

  it.each([
    ['/api/v1/notifications/pending', 'getPendingNotifications'],
    ['/api/v1/notifications/future', 'getFutureNotifications'],
    ['/api/v1/notifications/one-off', 'getOneOffNotifications'],
  ] as const)('%s pages a one-indexed backend without an offset', async (path, method) => {
    const service = makeService({
      getBackendSupportedFilterCapabilities: vi
        .fn()
        .mockResolvedValue({ 'pagination.oneIndexed': true }),
      [method]: vi.fn().mockResolvedValue([]),
    });
    const { app } = buildApp({ service });

    await get(app, `${path}?page=2&pageSize=5`);

    expect(service[method]).toHaveBeenCalledWith(2, 5, undefined);
  });

  it('does not shadow the detail route with the shortcut routes', async () => {
    const service = makeService({
      getNotification: vi.fn().mockResolvedValue(makeUserNotification({ id: 'pending-lookalike' })),
    });
    const { app } = buildApp({ service });

    const body = await (await get(app, '/api/v1/notifications/pending-lookalike')).json();

    expect(body.data.id).toBe('pending-lookalike');
  });
});

describe('GET /api/v1/notifications/:id', () => {
  it('returns the detail payload including context data', async () => {
    const service = makeService({
      getNotification: vi.fn().mockResolvedValue(makeUserNotification()),
    });
    const { app } = buildApp({ service });

    const body = await (await get(app, '/api/v1/notifications/notif-1')).json();

    expect(body.data).toMatchObject({
      kind: 'user',
      contextUsed: { key: 'value' },
      contextParameters: { param: 'test' },
      extraParams: null,
      attachments: [],
    });
  });

  it('falls back to the one-off lookup', async () => {
    const service = makeService({
      getNotification: vi.fn().mockResolvedValue(null),
      getOneOffNotification: vi.fn().mockResolvedValue(makeOneOffNotification()),
    });
    const { app } = buildApp({ service });

    const body = await (await get(app, '/api/v1/notifications/oneoff-1')).json();

    expect(body.data.kind).toBe('one-off');
  });

  it('404s when neither lookup finds the notification', async () => {
    const { app } = buildApp();

    const response = await get(app, '/api/v1/notifications/missing');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('GET /api/v1/notifications/:id/preview', () => {
  it('renders templates fetched at the notification commit', async () => {
    const service = makeService({
      getNotification: vi.fn().mockResolvedValue(makeUserNotification()),
    });
    const templateClient = makeTemplateClient();
    const { app } = buildApp({ service, templateClient });

    const body = await (await get(app, '/api/v1/notifications/notif-1/preview')).json();

    expect(templateClient.getTemplateContentByCommit).toHaveBeenCalledWith({
      templatePath: 'emails/body.pug',
      gitCommitSha: 'abc123',
    });
    expect(body.data).toMatchObject({
      gitCommitSha: 'abc123',
      bodyTemplatePath: 'emails/body.pug',
      subjectTemplatePath: 'emails/subject.pug',
      renderedBodyHtml: '<p>Body</p>',
      renderedSubjectHtml: '<h1>Subject</h1>',
    });
  });

  it('renders the stored context when one is present', async () => {
    const service = makeService({
      getNotification: vi.fn().mockResolvedValue(makeUserNotification()),
    });
    const { app } = buildApp({ service });

    await get(app, '/api/v1/notifications/notif-1/preview');

    expect(service.renderEmailTemplateFromContent).toHaveBeenCalledWith(
      expect.anything(),
      { body: 'h1 Hello', subject: 'h1 Hello' },
      { context: { key: 'value' } },
    );
  });

  it('regenerates the context when the notification has none', async () => {
    const service = makeService({
      getNotification: vi.fn().mockResolvedValue(makeUserNotification({ contextUsed: null })),
    });
    const { app } = buildApp({ service });

    await get(app, '/api/v1/notifications/notif-1/preview');

    expect(service.renderEmailTemplateFromContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { contextName: 'testContext', contextParameters: { param: 'test' } },
    );
  });

  it('uses the latest main commit for pending notifications without a SHA', async () => {
    const service = makeService({
      getNotification: vi
        .fn()
        .mockResolvedValue(makeUserNotification({ gitCommitSha: null, status: 'PENDING_SEND' })),
    });
    const templateClient = makeTemplateClient();
    const { app } = buildApp({ service, templateClient });

    const body = await (await get(app, '/api/v1/notifications/notif-1/preview')).json();

    expect(templateClient.getLatestMainCommitSha).toHaveBeenCalled();
    expect(body.data.gitCommitSha).toBe('main-sha');
  });

  it('409s when a sent notification has no tracked commit', async () => {
    const service = makeService({
      getNotification: vi.fn().mockResolvedValue(makeUserNotification({ gitCommitSha: null })),
    });
    const { app } = buildApp({ service });

    const response = await get(app, '/api/v1/notifications/notif-1/preview');

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'PREVIEW_UNAVAILABLE' },
    });
  });

  it('skips the subject fetch when the notification has no subject template', async () => {
    const service = makeService({
      getNotification: vi.fn().mockResolvedValue(makeUserNotification({ subjectTemplate: null })),
    });
    const templateClient = makeTemplateClient();
    const { app } = buildApp({ service, templateClient });

    const body = await (await get(app, '/api/v1/notifications/notif-1/preview')).json();

    expect(templateClient.getTemplateContentByCommit).toHaveBeenCalledTimes(1);
    expect(body.data.subjectTemplatePath).toBeNull();
  });

  it('reports an unreachable template source as an upstream error', async () => {
    const service = makeService({
      getNotification: vi.fn().mockResolvedValue(makeUserNotification()),
    });
    const templateClient = makeTemplateClient({
      getTemplateContentByCommit: vi
        .fn()
        .mockRejectedValue(
          new Error('GitHub API rate limit exceeded while fetching template preview.'),
        ),
    });
    const { app } = buildApp({ service, templateClient });

    const response = await get(app, '/api/v1/notifications/notif-1/preview');

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UPSTREAM_ERROR',
        message: 'GitHub API rate limit exceeded while fetching template preview.',
      },
    });
  });

  it('reports a failed commit lookup as an upstream error', async () => {
    const service = makeService({
      getNotification: vi
        .fn()
        .mockResolvedValue(makeUserNotification({ gitCommitSha: null, status: 'PENDING_SEND' })),
    });
    const templateClient = makeTemplateClient({
      getLatestMainCommitSha: vi
        .fn()
        .mockRejectedValue(new Error('Unable to resolve latest commit SHA from the main branch.')),
    });
    const { app } = buildApp({ service, templateClient });

    const response = await get(app, '/api/v1/notifications/notif-1/preview');

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'UPSTREAM_ERROR' },
    });
  });

  it('keeps a rendering failure an internal error', async () => {
    // Rendering happens inside this API, so its failures are ours, not upstream.
    const service = makeService({
      getNotification: vi.fn().mockResolvedValue(makeUserNotification()),
      renderEmailTemplateFromContent: vi.fn().mockRejectedValue(new Error('template blew up')),
    });
    const { app } = buildApp({ service });

    const response = await get(app, '/api/v1/notifications/notif-1/preview');

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INTERNAL_ERROR' },
    });
  });

  it('reports an internal error without leaking backend details', async () => {
    const service = makeService({
      getNotification: vi.fn().mockRejectedValue(new Error('db credentials rejected')),
    });
    const { app } = buildApp({ service });

    const response = await get(app, '/api/v1/notifications/notif-1/preview');
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('db credentials');
  });
});

describe('POST /api/v1/notifications/:id/resend', () => {
  it('resends with the stored context and returns the new notification', async () => {
    const service = makeService({
      resendNotification: vi.fn().mockResolvedValue(makeUserNotification({ id: 'notif-2' })),
    });
    const { app } = buildApp({ service });

    const response = await post(app, '/api/v1/notifications/notif-1/resend', {
      useStoredContext: true,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(service.resendNotification).toHaveBeenCalledWith('notif-1', true);
    expect(body.data).toMatchObject({ kind: 'user', id: 'notif-2' });
  });

  it('defaults useStoredContext to false when the body is empty', async () => {
    const service = makeService({
      resendNotification: vi.fn().mockResolvedValue(makeUserNotification()),
    });
    const { app } = buildApp({ service });

    await post(app, '/api/v1/notifications/notif-1/resend');

    expect(service.resendNotification).toHaveBeenCalledWith('notif-1', false);
  });

  it('409s when the service refuses to resend', async () => {
    const { app } = buildApp();

    const response = await post(app, '/api/v1/notifications/notif-1/resend');

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('rejects a malformed body', async () => {
    const { app } = buildApp();

    const response = await post(app, '/api/v1/notifications/notif-1/resend', {
      useStoredContext: 'yes',
    });

    expect(response.status).toBe(400);
  });
});

describe('POST /api/v1/notifications/:id/cancel', () => {
  it('cancels a pending notification', async () => {
    const service = makeService({
      getNotification: vi.fn().mockResolvedValue(makeUserNotification({ status: 'PENDING_SEND' })),
    });
    const { app } = buildApp({ service });

    const response = await post(app, '/api/v1/notifications/notif-1/cancel');

    expect(response.status).toBe(200);
    expect(service.cancelNotification).toHaveBeenCalledWith('notif-1');
    await expect(response.json()).resolves.toEqual({
      data: { id: 'notif-1', status: 'CANCELLED' },
    });
  });

  it('409s when the notification is not pending', async () => {
    const service = makeService({
      getNotification: vi.fn().mockResolvedValue(makeUserNotification({ status: 'SENT' })),
    });
    const { app } = buildApp({ service });

    const response = await post(app, '/api/v1/notifications/notif-1/cancel');

    expect(response.status).toBe(409);
    expect(service.cancelNotification).not.toHaveBeenCalled();
  });

  it('404s for an unknown notification', async () => {
    const { app } = buildApp();

    expect((await post(app, '/api/v1/notifications/missing/cancel')).status).toBe(404);
  });
});

describe('GET /api/v1/capabilities', () => {
  it('returns the backend capability map', async () => {
    const service = makeService({
      getBackendSupportedFilterCapabilities: vi.fn().mockResolvedValue({ 'orderBy.sentAt': false }),
    });
    const { app } = buildApp({ service });

    const body = await (await get(app, '/api/v1/capabilities')).json();

    expect(body).toEqual({ data: { 'orderBy.sentAt': false } });
  });

  it('does not publish the backend pagination convention', async () => {
    // The wire is 1-indexed regardless; a client that saw this might convert too.
    const service = makeService({
      getBackendSupportedFilterCapabilities: vi.fn().mockResolvedValue({
        'pagination.oneIndexed': true,
        'orderBy.sentAt': true,
      }),
    });
    const { app } = buildApp({ service });

    const body = await (await get(app, '/api/v1/capabilities')).json();

    expect(body.data).toEqual({ 'orderBy.sentAt': true });
  });
});

describe('capability lookups', () => {
  it('reads the backend capability report once per request', async () => {
    const { app, service } = buildApp();

    await get(app, '/api/v1/notifications');

    expect(service.getBackendSupportedFilterCapabilities).toHaveBeenCalledTimes(1);
  });

  it('pages the shortcut collections through the same conversion', async () => {
    // Regression guard: these routes used to page by assumption.
    const service = makeService({
      getBackendSupportedFilterCapabilities: vi
        .fn()
        .mockResolvedValue({ 'pagination.oneIndexed': true }),
    });
    const { app } = buildApp({ service });

    await get(app, '/api/v1/notifications/pending?page=4');

    expect(service.getPendingNotifications).toHaveBeenCalledWith(4, 20, undefined);
    expect(service.getBackendSupportedFilterCapabilities).toHaveBeenCalledTimes(1);
  });
});
