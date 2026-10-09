/**
 * `openapi.yaml` against this server: every operation it declares is routed, and the check every
 * other suite runs — a client error the operation does not declare fails the test — actually
 * fails.
 */

import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { ApiError } from '../src/errors.js';
import { apiKeyAuthenticator } from '../src/middleware/authenticate.js';
import { declaredOperations, undeclaredStatus } from './helpers/contract.js';
import { authHeaders, makeService, makeTemplateClient, TEST_API_KEY } from './helpers/fixtures.js';

describe('openapi.yaml', () => {
  it.each(declaredOperations().map(({ method, path }) => ({ method, path })))(
    'routes $method $path',
    async ({ method, path }) => {
      const app = createApp({
        authenticate: apiKeyAuthenticator(TEST_API_KEY),
        getService: async () => makeService(),
        getTemplateClient: () => makeTemplateClient(),
      });

      const response = await app.request(path.replace('{id}', 'notif-1'), {
        method: method.toUpperCase(),
        headers: authHeaders,
      });

      // 404 is a legitimate answer from a handler; "no route matches" is not.
      if (response.status === 404) {
        const payload = (await response.json()) as { error: { message: string } };
        expect(payload.error.message).not.toMatch(/No route matches/);
      }
    },
  );

  it('declares a 403 on every authenticated route', () => {
    for (const operation of declaredOperations()) {
      if (operation.path.startsWith('/api/v1/')) {
        expect(operation.statuses, `${operation.method} ${operation.path}`).toContain('403');
      }
    }
  });
});

describe('the declared-status check', () => {
  it('reports a client error the operation does not declare', () => {
    expect(undeclaredStatus('POST', '/api/v1/notifications/n-1/cancel', 409)).toBeUndefined();
    expect(undeclaredStatus('POST', '/api/v1/notifications/n-1/cancel', 400)).toMatch(
      /POST \/api\/v1\/notifications\/\{id\}\/cancel answered 400/,
    );
  });

  it('matches the literal route before a parameter that could also match', () => {
    expect(undeclaredStatus('GET', '/api/v1/notifications/pending', 404)).toMatch(
      /notifications\/pending answered 404/,
    );
  });

  it('runs on every app a test builds', async () => {
    // The detail route declares no 400, so an authenticator answering one breaks the contract.
    const app = createApp({
      authenticate: () => {
        throw ApiError.badRequest('Not a contract answer here.');
      },
      getService: async () => makeService(),
      getTemplateClient: () => makeTemplateClient(),
    });

    await expect(app.request('/api/v1/notifications/n-1')).rejects.toThrow(
      /openapi.yaml: GET \/api\/v1\/notifications\/\{id\} answered 400/,
    );
  });

  it('leaves server errors and unknown routes alone', () => {
    expect(undeclaredStatus('GET', '/api/v1/notifications/n-1', 500)).toBeUndefined();
    expect(undeclaredStatus('GET', '/api/v1/nope', 404)).toBeUndefined();
  });
});
