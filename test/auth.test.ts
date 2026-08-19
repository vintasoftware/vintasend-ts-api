import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { authHeaders, makeService, makeTemplateClient, TEST_API_KEY } from './helpers/fixtures.js';

function app() {
  return createApp({
    apiKey: TEST_API_KEY,
    getService: async () => makeService(),
    getTemplateClient: () => makeTemplateClient(),
  });
}

describe('authentication', () => {
  it('leaves the health endpoint open', async () => {
    const response = await app().request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', apiVersion: 'v1' });
  });

  it('rejects requests without an API key', async () => {
    const response = await app().request('/api/v1/notifications');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('rejects requests with the wrong API key', async () => {
    const response = await app().request('/api/v1/notifications', {
      headers: { Authorization: 'Bearer nope' },
    });

    expect(response.status).toBe(401);
  });

  it('rejects a non-bearer authorization header', async () => {
    const response = await app().request('/api/v1/notifications', {
      headers: { Authorization: TEST_API_KEY },
    });

    expect(response.status).toBe(401);
  });

  it('accepts requests with the configured API key', async () => {
    const response = await app().request('/api/v1/notifications', { headers: authHeaders });

    expect(response.status).toBe(200);
  });

  it('returns the error envelope for unknown routes', async () => {
    const response = await app().request('/api/v1/nope', { headers: authHeaders });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
