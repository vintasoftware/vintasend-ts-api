/**
 * What a host mounting the API relies on: its own authentication, its own error reporting, a body
 * that is read the way the contract says, pages that never offer an empty next one, and an app
 * that runs wherever `fetch` does.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { ApiErrorResponse } from '../src/contract/types.js';
import { ApiError } from '../src/errors.js';
import { type Authenticator, apiKeyAuthenticator } from '../src/middleware/authenticate.js';
import type { NotificationServicePort } from '../src/services/notification-service-port.js';
import {
  authHeaders,
  makeService,
  makeTemplateClient,
  makeUserNotification,
  TEST_API_KEY,
} from './helpers/fixtures.js';

function buildApp(
  options: {
    service?: NotificationServicePort;
    authenticate?: Authenticator;
    onUnhandledError?: Parameters<typeof createApp>[0]['onUnhandledError'];
  } = {},
) {
  const service = options.service ?? makeService();
  const app = createApp({
    authenticate: options.authenticate ?? apiKeyAuthenticator(TEST_API_KEY),
    getService: async () => service,
    getTemplateClient: () => makeTemplateClient(),
    ...(options.onUnhandledError ? { onUnhandledError: options.onUnhandledError } : {}),
  });
  return { app, service };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * What the other VintaSend API package's `ApiError` looks like from here: same name and shape, a
 * different class.
 */
class ForeignApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

describe('authenticate', () => {
  /** A host's own session: the signed-in user arrives in a header its proxy sets. */
  const session: Authenticator = (c: Context) => {
    const user = c.req.header('x-user');
    if (user === undefined) throw ApiError.unauthorized('Sign in first.');
    if (user === 'viewer') throw ApiError.forbidden('Viewers cannot resend notifications.');
    return { actor: user };
  };

  it('refuses a caller it does not know with a 401', async () => {
    const { app } = buildApp({ authenticate: session });

    const response = await app.request('/api/v1/notifications');

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Sign in first.' },
    });
  });

  it('refuses a caller it knows and will not allow with a 403, before anything is sent', async () => {
    const resendNotification = vi.fn();
    const { app } = buildApp({
      authenticate: session,
      service: makeService({ resendNotification }),
    });

    const response = await app.request('/api/v1/notifications/notif-1/resend', {
      method: 'POST',
      headers: { 'x-user': 'viewer' },
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as ApiErrorResponse).error.code).toBe('FORBIDDEN');
    expect(resendNotification).not.toHaveBeenCalled();
  });

  it('lets a caller it knows through', async () => {
    const { app } = buildApp({ authenticate: session });

    const response = await app.request('/api/v1/notifications', { headers: { 'x-user': 'ana' } });

    expect(response.status).toBe(200);
  });

  it('runs before the request is validated', async () => {
    const { app } = buildApp({ authenticate: session });

    const response = await app.request('/api/v1/notifications?page=0');

    expect(response.status).toBe(401);
  });

  it('may throw the ApiError of the templates management API, so one function serves both', async () => {
    for (const [code, status] of [
      ['UNAUTHORIZED', 401],
      ['FORBIDDEN', 403],
    ] as const) {
      const { app } = buildApp({
        authenticate: () => {
          throw new ForeignApiError(code, 'Refused.');
        },
      });

      const response = await app.request('/api/v1/notifications');

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: { code, message: 'Refused.' } });
    }
  });

  it('treats an ApiError with a code this contract lacks as unexpected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = buildApp({
      authenticate: () => {
        throw new ForeignApiError('INVALID_STATUS_TRANSITION', 'Not here.');
      },
    });

    expect((await app.request('/api/v1/notifications')).status).toBe(500);
  });

  it('leaves the health check open', async () => {
    const { app } = buildApp({ authenticate: session });

    expect((await app.request('/health')).status).toBe(200);
  });
});

describe('onUnhandledError', () => {
  const failing = () =>
    makeService({ getNotification: vi.fn().mockRejectedValue(new TypeError('db is down')) });

  it('receives the error instead of the default log line', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: { error: Error; requestId: string }[] = [];
    const { app } = buildApp({
      service: failing(),
      onUnhandledError: (error, _c, { requestId }) => void seen.push({ error, requestId }),
    });

    const response = await app.request('/api/v1/notifications/123', {
      headers: { ...authHeaders, 'x-request-id': 'req-9' },
    });

    expect(response.status).toBe(500);
    expect(seen.map(({ error, requestId }) => [error.message, requestId])).toEqual([
      ['db is down', 'req-9'],
    ]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('falls back to the redacted line when it throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = buildApp({
      service: failing(),
      onUnhandledError: () => {
        throw new Error('the tracker is down too');
      },
    });

    const response = await app.request('/api/v1/notifications/123', {
      headers: { ...authHeaders, 'x-request-id': 'req-10' },
    });

    expect(response.status).toBe(500);
    expect(consoleError.mock.calls).toEqual([
      ['[vintasend-api] unhandled TypeError (request req-10) on GET /api/v1/notifications/:id'],
    ]);
  });
});

describe('the resend body', () => {
  const resend = (body: BodyInit | undefined, headers: Record<string, string> = {}) => {
    const resendNotification = vi.fn().mockResolvedValue(makeUserNotification({ id: 'new' }));
    const { app } = buildApp({ service: makeService({ resendNotification }) });
    const response = app.request('/api/v1/notifications/notif-1/resend', {
      method: 'POST',
      ...(body === undefined ? {} : { body }),
      headers: { ...authHeaders, ...headers },
    });
    return { response, resendNotification };
  };

  async function expectRefused(response: Promise<Response>, message: string) {
    const settled = await response;
    expect(settled.status).toBe(400);
    expect(((await settled.json()) as ApiErrorResponse).error.details).toEqual({
      issues: [{ path: '', message }],
    });
  }

  it('refuses a form-encoded body rather than resending with a regenerated context', async () => {
    const { response, resendNotification } = resend('{"useStoredContext":true}', {
      'content-type': 'application/x-www-form-urlencoded',
    });

    await expectRefused(response, 'Send the request body as application/json.');
    expect(resendNotification).not.toHaveBeenCalled();
  });

  it('refuses a body with no content type', async () => {
    const { response, resendNotification } = resend(
      new TextEncoder().encode('{"useStoredContext":true}'),
    );

    await expectRefused(response, 'Send the request body as application/json.');
    expect(resendNotification).not.toHaveBeenCalled();
  });

  it('reads an empty or absent body as an omitted one', async () => {
    for (const body of ['', undefined]) {
      const { response, resendNotification } = resend(body, { 'content-type': 'text/plain' });

      expect((await response).status).toBe(201);
      expect(resendNotification).toHaveBeenCalledWith('notif-1', false);
    }
  });

  it('reads a structured JSON media type as JSON', async () => {
    const { response, resendNotification } = resend('{"useStoredContext":true}', {
      'content-type': 'application/merge-patch+json',
    });

    expect((await response).status).toBe(201);
    expect(resendNotification).toHaveBeenCalledWith('notif-1', true);
  });

  it('refuses an empty body declared as JSON, and malformed JSON, in the same envelope', async () => {
    for (const body of ['', '{"useStoredContext":']) {
      const { response, resendNotification } = resend(body, { 'content-type': 'application/json' });

      await expectRefused(response, 'Malformed JSON in request body');
      expect(resendNotification).not.toHaveBeenCalled();
    }
  });

  it('lists the field an invalid body got wrong', async () => {
    const { response } = resend('{"useStoredContext":"yes"}', {
      'content-type': 'application/json',
    });

    const settled = await response;
    expect(settled.status).toBe(400);
    expect(((await settled.json()) as ApiErrorResponse).error.details).toMatchObject({
      issues: [{ path: 'useStoredContext' }],
    });
  });
});

describe('every 400', () => {
  it('lists its issues for an invalid query parameter', async () => {
    const { app } = buildApp();

    const response = await app.request('/api/v1/notifications?pageSize=500', {
      headers: authHeaders,
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as ApiErrorResponse).error.details).toMatchObject({
      issues: [{ path: 'pageSize' }],
    });
  });
});

describe('hasMore', () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => makeUserNotification({ id: `n-${index}` }));

  it.each([
    ['/api/v1/notifications', 'filterNotifications'],
    ['/api/v1/notifications/pending', 'getPendingNotifications'],
    ['/api/v1/notifications/future', 'getFutureNotifications'],
    ['/api/v1/notifications/one-off', 'getOneOffNotifications'],
  ])('is false on %s when the list exactly fills the last page', async (path, method) => {
    // Four rows, paged 0-indexed like the TypeScript backends.
    const read =
      method === 'filterNotifications'
        ? vi.fn(async (_filter: unknown, page: number, pageSize: number) =>
            rows(4).slice(page * pageSize, page * pageSize + pageSize),
          )
        : vi.fn(async (page: number, pageSize: number) =>
            rows(4).slice(page * pageSize, page * pageSize + pageSize),
          );
    const { app } = buildApp({ service: makeService({ [method]: read }) });

    const last = await (
      await app.request(`${path}?page=2&pageSize=2`, { headers: authHeaders })
    ).json();
    const first = await (
      await app.request(`${path}?page=1&pageSize=2`, { headers: authHeaders })
    ).json();

    expect([last.data.length, last.hasMore]).toEqual([2, false]);
    expect([first.data.length, first.hasMore]).toEqual([2, true]);
  });

  it('asks for the row after the page with the same filter and order, and only after a full page', async () => {
    const filterNotifications = vi.fn(async (_filter: unknown, page: number, pageSize: number) =>
      rows(5).slice(page * pageSize, page * pageSize + pageSize),
    );
    const { app } = buildApp({ service: makeService({ filterNotifications }) });

    await app.request('/api/v1/notifications?page=2&pageSize=2&status=SENT', {
      headers: authHeaders,
    });

    const [page, probe] = filterNotifications.mock.calls as unknown[][];
    expect(probe?.[0]).toEqual(page?.[0]);
    // Contract page 5 of one-row pages is the fifth row; the backend counts from 0.
    expect(probe?.slice(1, 4)).toEqual([4, 1, page?.[3]]);
    expect(filterNotifications).toHaveBeenCalledTimes(2);

    await app.request('/api/v1/notifications?page=3&pageSize=2', { headers: authHeaders });
    expect(filterNotifications).toHaveBeenCalledTimes(3);
  });
});

describe('the app outside Node', () => {
  /** Every module `createApp` loads, following relative imports from `src/app.ts`. */
  function appModules(): Map<string, string> {
    const modules = new Map<string, string>();
    const pending = [fileURLToPath(new URL('../src/app.ts', import.meta.url))];
    while (pending.length > 0) {
      const file = pending.pop() as string;
      if (modules.has(file)) continue;
      const source = readFileSync(file, 'utf8');
      modules.set(file, source);
      for (const [, specifier] of source.matchAll(/from '(\.[^']+)\.js'/g)) {
        pending.push(resolve(dirname(file), `${specifier}.ts`));
      }
    }
    return modules;
  }

  it('loads no Node built-in, so it can run wherever fetch does', () => {
    const modules = appModules();

    expect(modules.size).toBeGreaterThan(8);
    for (const [file, source] of modules) {
      expect(source, file).not.toMatch(/from 'node:|\bBuffer\./);
    }
  });
});
