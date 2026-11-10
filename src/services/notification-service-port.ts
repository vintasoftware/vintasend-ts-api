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

  /**
   * Puts a `FAILED` or `CANCELLED` notification back into `PENDING_SEND`, sending it at once when
   * it is due. Throws a `NotificationActionError` when refused.
   */
  requeueNotification(
    notificationId: string,
    options?: { sendAfter?: Date | null },
  ): Promise<ApiAnyDatabaseNotification>;

  /**
   * Pins a notification that has not been delivered to a template version, the current one by
   * default. Throws a `NotificationActionError` when refused.
   */
  repinNotification(
    notificationId: string,
    options?: { templateVersion?: number },
  ): Promise<ApiAnyDatabaseNotification>;

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
