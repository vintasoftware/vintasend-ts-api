/**
 * Public entrypoint for mounting the API inside a host's own server, and for sharing the wire
 * contract with TypeScript clients.
 *
 * It imports no Node built-in, so it loads wherever `fetch` does, a browser included. The
 * standalone server's pieces are on `./server`.
 */

export { API_BASE_PATH, type AppDependencies, createApp } from './app.js';
export * from './contract/types.js';
export { ApiError, invalidRequest } from './errors.js';
export {
  type Authenticated,
  type Authenticator,
  apiKeyAuthenticator,
  authenticated,
  bearerToken,
} from './middleware/authenticate.js';
export {
  logUnhandledError,
  REQUEST_ID_HEADER,
  type UnhandledErrorHandler,
} from './middleware/error-handler.js';
export {
  createGitHubTemplateClientFromEnv,
  GitHubTemplateClient,
} from './services/github-template-client.js';
export type { TemplateSourceClient } from './services/notification-preview.js';
export {
  asNotificationServicePort,
  type NotificationServicePort,
} from './services/notification-service-port.js';
