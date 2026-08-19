/**
 * The slice of a VintaSend service this API depends on.
 *
 * The API is generic over notification config: it only reads fields that exist
 * on every notification, so it pins the config to `BaseNotificationTypeConfig`.
 * Operator-provided services are configured with their own concrete config and
 * are adapted to this port when loaded (see `service-loader.ts`).
 */

import type {
  AnyDatabaseNotification,
  BaseNotificationTypeConfig,
  DatabaseNotification,
  DatabaseOneOffNotification,
  EmailTemplate,
  EmailTemplateContent,
  JsonObject,
  NotificationFilterCapabilities,
  NotificationFilterFields,
  NotificationOrderBy,
} from 'vintasend';

export type ApiNotificationConfig = BaseNotificationTypeConfig;

export type ApiDatabaseNotification = DatabaseNotification<ApiNotificationConfig>;
export type ApiDatabaseOneOffNotification = DatabaseOneOffNotification<ApiNotificationConfig>;
export type ApiAnyDatabaseNotification = AnyDatabaseNotification<ApiNotificationConfig>;
export type ApiNotificationFilterFields = NotificationFilterFields<ApiNotificationConfig>;

export type RenderContextInput =
  | { context: JsonObject }
  | { contextName: string; contextParameters: JsonObject };

export interface NotificationServicePort {
  getBackendSupportedFilterCapabilities(
    backendIdentifier?: string,
  ): Promise<NotificationFilterCapabilities>;

  filterNotifications(
    filter: ApiNotificationFilterFields,
    page: number,
    pageSize: number,
    orderBy?: NotificationOrderBy,
    backendIdentifier?: string,
  ): Promise<ApiAnyDatabaseNotification[]>;

  getPendingNotifications(
    page: number,
    pageSize: number,
    backendIdentifier?: string,
  ): Promise<ApiAnyDatabaseNotification[]>;

  getFutureNotifications(
    page: number,
    pageSize: number,
    backendIdentifier?: string,
  ): Promise<ApiAnyDatabaseNotification[]>;

  getOneOffNotifications(
    page: number,
    pageSize: number,
    backendIdentifier?: string,
  ): Promise<ApiDatabaseOneOffNotification[]>;

  getNotification(
    notificationId: string,
    forUpdate?: boolean,
    backendIdentifier?: string,
  ): Promise<ApiDatabaseNotification | null>;

  getOneOffNotification(
    notificationId: string,
    forUpdate?: boolean,
    backendIdentifier?: string,
  ): Promise<ApiDatabaseOneOffNotification | null>;

  resendNotification(
    notificationId: string,
    useStoredContextIfAvailable?: boolean,
  ): Promise<ApiDatabaseNotification | undefined>;

  cancelNotification(notificationId: string): Promise<void>;

  renderEmailTemplateFromContent(
    notification: ApiAnyDatabaseNotification,
    templateContent: EmailTemplateContent,
    contextInput: RenderContextInput,
  ): Promise<EmailTemplate>;
}

/**
 * Resolves a VintaSend service (or anything structurally compatible) to the port.
 *
 * VintaSend services are generic over the operator's notification config, so a
 * concrete service is not assignable to the base-config port even though every
 * member the API touches is compatible. The cast is confined to this function.
 */
export function asNotificationServicePort(service: unknown): NotificationServicePort {
  return service as NotificationServicePort;
}
