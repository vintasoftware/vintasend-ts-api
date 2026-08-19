/**
 * Builds the HTTP application.
 *
 * Everything the API needs from the outside world — the VintaSend service and
 * the template source — is injected, so the app can be exercised in tests
 * without a database, a mail provider, or GitHub.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { API_VERSION, type HealthResponse } from './contract/types.js';
import { apiKeyAuth } from './middleware/api-key-auth.js';
import { handleError, handleNotFound } from './middleware/error-handler.js';
import { createNotificationRoutes } from './routes/notifications.js';
import type { TemplateSourceClient } from './services/notification-preview.js';
import type { NotificationServicePort } from './services/notification-service-port.js';

export type AppDependencies = {
  apiKey: string;
  getService: () => Promise<NotificationServicePort>;
  getTemplateClient: () => TemplateSourceClient;
  backendIdentifier?: string | undefined;
  corsOrigins?: string[];
};

export const API_BASE_PATH = `/api/${API_VERSION}`;

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.onError(handleError);
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

  app.use(`${API_BASE_PATH}/*`, apiKeyAuth(deps.apiKey));
  app.route(API_BASE_PATH, createNotificationRoutes(deps));

  return app;
}
