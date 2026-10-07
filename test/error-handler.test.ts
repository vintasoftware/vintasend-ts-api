import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { authHeaders, makeService, makeTemplateClient, TEST_API_KEY } from './helpers/fixtures.js';

describe('unhandled errors', () => {
  const sensitive = 'Communication/123 for Jane Synthetic, jane.synthetic@example.com';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function failingApp() {
    const service = makeService({
      getNotification: vi.fn().mockRejectedValue(new TypeError(sensitive)),
    });
    return createApp({
      apiKey: TEST_API_KEY,
      getService: async () => service,
      getTemplateClient: () => makeTemplateClient(),
    });
  }

  it('logs the error name, a request id and the route, never the error itself', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await failingApp().request('/api/v1/notifications/123', {
      headers: { ...authHeaders, 'x-request-id': 'req-42' },
    });

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]).toEqual([
      '[vintasend-api] unhandled TypeError (request req-42) on GET /api/v1/notifications/:id',
    ]);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('Jane Synthetic');
  });

  it('keeps the generic 500 body and returns the request id it logged', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await failingApp().request('/api/v1/notifications/123', {
      headers: { ...authHeaders, 'x-request-id': 'req-43' },
    });

    expect(response.headers.get('x-request-id')).toBe('req-43');
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('Jane Synthetic');
  });

  it('replaces a request id that could break the log line', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await failingApp().request('/api/v1/notifications/123', {
      headers: { ...authHeaders, 'x-request-id': 'bad id [forged] line' },
    });

    const requestId = response.headers.get('x-request-id');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(consoleError.mock.calls[0]?.[0]).toContain(`(request ${requestId})`);
    expect(consoleError.mock.calls[0]?.[0]).not.toContain('forged');
  });
});
