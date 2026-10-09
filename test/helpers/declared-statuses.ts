/**
 * Every app a test builds fails the test on a client error its operation does not declare.
 *
 * `openapi.yaml` declares each operation's statuses by hand, and the Python implementation is
 * held to the same file. A route answering a status the document never mentions is a contract a
 * generated client cannot handle, and nothing else notices, because the server still answers.
 * The suites build their apps in several places, so `createApp` is wrapped here, once, for all of
 * them.
 */

import type { Hono } from 'hono';
import { vi } from 'vitest';

import { undeclaredStatus } from './contract.js';

function checked(app: Hono): Hono {
  const request = app.request;

  app.request = async (input, init, ...rest) => {
    const response = await request(input, init, ...rest);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const url = input instanceof Request ? input.url : String(input);
    const problem = undeclaredStatus(method, url, response.status);
    if (problem !== undefined) {
      throw new Error(`openapi.yaml: ${problem}`);
    }
    return response;
  };

  return app;
}

vi.mock('../../src/app.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/app.js')>();
  return {
    ...original,
    createApp: (...args: Parameters<typeof original.createApp>) =>
      checked(original.createApp(...args)),
  };
});
