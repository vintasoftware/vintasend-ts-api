/**
 * Public entrypoint for embedding the API in another Node process, and for
 * sharing the wire contract with TypeScript clients.
 */

export { API_BASE_PATH, type AppDependencies, createApp } from './app.js';
export { loadServerConfig, type ServerConfig } from './config.js';
export * from './contract/types.js';
export { ApiError } from './errors.js';
export {
  createGitHubTemplateClientFromEnv,
  GitHubTemplateClient,
} from './services/github-template-client.js';
export type { TemplateSourceClient } from './services/notification-preview.js';
export {
  asNotificationServicePort,
  type NotificationServicePort,
} from './services/notification-service-port.js';
export { createServiceProvider, loadNotificationService } from './services/service-loader.js';
