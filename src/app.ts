/**
 * Builds the HTTP application.
 *
 * Everything the API needs from the outside world — who the caller is, the VintaSend service and
 * the template source — is injected, so the app can be exercised in tests without a database, a
 * mail provider, or GitHub, and mounted inside a host's own server behind its own authentication.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { API_VERSION, type HealthResponse } from './contract/types.js';
import { type Authenticator, authenticateWith } from './middleware/authenticate.js';
import {
  createErrorHandler,
  handleNotFound,
  type UnhandledErrorHandler,
} from './middleware/error-handler.js';
import { createNotificationRoutes } from './routes/notifications.js';
import type { TemplateSourceClient } from './services/notification-preview.js';
import type { NotificationServicePort } from './services/notification-service-port.js';

export type AppDependencies = {
  /**
   * Runs before every `/api/v1` route. It refuses a caller by throwing `ApiError.unauthorized` or
   * `ApiError.forbidden`. `apiKeyAuthenticator(key)` is the shared-secret case.
   */
  authenticate: Authenticator;
  getService: () => Promise<NotificationServicePort>;
  /** Where previews read a notification's templates from, at the commit it was sent with. */
  getTemplateClient: () => TemplateSourceClient;
  backendIdentifier?: string | undefined;
  corsOrigins?: string[];
  /**
   * Receives every error the API does not map to a contract error. Defaults to a single log line
   * with the error's name, a request id and the route — never the error object or the request.
   * If the handler throws, that default line is logged instead. The client gets the generic 500
   * either way.
   */
  onUnhandledError?: UnhandledErrorHandler;
};

export const API_BASE_PATH = `/api/${API_VERSION}`;

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.onError(createErrorHandler(deps.onUnhandledError));
  app.notFound(handleNotFound);

  if (deps.corsOrigins && deps.corsOrigins.length > 0) {
    const allowedOrigins = deps.corsOrigins;
    app.use(
      `${API_BASE_PATH}/*`,
      cors({
        origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
        allowHeaders: ['Authorization', 'Content-Type'],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
      }),
    );
  }

  // Unauthenticated: used by load balancers and container health checks.
  app.get('/health', (c) => c.json<HealthResponse>({ status: 'ok', apiVersion: API_VERSION }));

  app.use(`${API_BASE_PATH}/*`, authenticateWith(deps.authenticate));
  app.route(API_BASE_PATH, createNotificationRoutes(deps));

  return app;
}
