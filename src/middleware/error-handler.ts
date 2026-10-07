/**
 * Maps thrown errors to the contract's error envelope.
 *
 * Unexpected errors are reported generically, so backend internals never leak to a client. They
 * are not logged whole either: an error from a notification backend or provider can quote
 * notification content, recipients or context values, and the applications this API serves
 * handle health data. The log line names the error, a request id and the route, nothing else.
 */

import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { ApiErrorResponse } from '../contract/types.js';
import { ApiError } from '../errors.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Only a request id that cannot break a log line out of its field is taken from the client. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** The caller's `X-Request-Id` when it is safe to log, otherwise a fresh one. */
export function requestIdFor(c: Context): string {
  const supplied = c.req.header(REQUEST_ID_HEADER);
  return supplied !== undefined && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
}

export function handleError(error: Error, c: Context): Response {
  if (error instanceof ApiError) {
    return c.json<ApiErrorResponse>(error.toResponseBody(), error.status as 400);
  }

  if (error instanceof HTTPException) {
    return c.json<ApiErrorResponse>(
      { error: { code: 'BAD_REQUEST', message: error.message } },
      error.status,
    );
  }

  // `name` rather than the constructor's name: some backends' errors come from minified bundles.
  const requestId = requestIdFor(c);
  console.error(
    `[vintasend-api] unhandled ${error.name || 'Error'} (request ${requestId}) on ` +
      `${c.req.method} ${c.req.routePath}`,
  );

  c.header(REQUEST_ID_HEADER, requestId);
  return c.json<ApiErrorResponse>(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while handling the request.',
      },
    },
    500,
  );
}

export function handleNotFound(c: Context): Response {
  return c.json<ApiErrorResponse>(
    {
      error: {
        code: 'NOT_FOUND',
        message: `No route matches ${c.req.method} ${new URL(c.req.url).pathname}.`,
      },
    },
    404,
  );
}
