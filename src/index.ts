/**
 * Server entrypoint: wires environment configuration into the app and listens.
 */

import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { loadServerConfig } from './config.js';
import { createGitHubTemplateClientFromEnv } from './services/github-template-client.js';
import { createServiceProvider } from './services/service-loader.js';

async function main(): Promise<void> {
  const config = loadServerConfig();
  const getService = createServiceProvider(config.serviceModule);

  const app = createApp({
    apiKey: config.apiKey,
    getService,
    getTemplateClient: () => createGitHubTemplateClientFromEnv(),
    backendIdentifier: config.backendIdentifier,
    corsOrigins: config.corsOrigins,
  });

  // Fail fast on a broken service module instead of surfacing it per request.
  await getService();

  serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.info(`[vintasend-api] listening on http://${config.host}:${info.port}`);
  });
}

main().catch((error) => {
  console.error('[vintasend-api] failed to start', error);
  process.exit(1);
});
