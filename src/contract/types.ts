/**
 * Wire contract for the VintaSend dashboard API.
 *
 * These types describe the JSON payloads exchanged over HTTP. They intentionally
 * avoid importing anything from `vintasend`: any implementation of this contract
 * (the TypeScript one in this repo, a future Python one) must produce exactly
 * these shapes, and any UI consuming the API only needs these definitions.
 *
 * All timestamps are ISO-8601 strings in UTC.
 */

export const API_VERSION = 'v1';

export type NotificationStatus = 'PENDING_SEND' | 'SENT' | 'FAILED' | 'READ' | 'CANCELLED';

export type NotificationType = 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Attachment metadata exposed on notification details.
 */
export type NotificationAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  description?: string;
};

/**
 * Fields shared by regular and one-off notifications in list responses.
 */
type NotificationBase = {
  id: string;
  notificationType: NotificationType;
  title: string | null;
  contextName: string;
  status: NotificationStatus;
  sendAfter: string | null;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  adapterUsed: string | null;
  bodyTemplate: string;
  subjectTemplate: string | null;
  gitCommitSha: string | null;
  tenant: string | null;
};

/**
 * A notification addressed to a known user.
 */
export type UserNotification = NotificationBase & {
  kind: 'user';
  userId: string;
};

/**
 * A notification addressed to a raw email/phone, without a user record.
 */
export type OneOffNotification = NotificationBase & {
  kind: 'one-off';
  emailOrPhone: string;
  firstName: string | null;
  lastName: string | null;
};

/**
 * List-view notification. `kind` discriminates the two variants.
 */
export type Notification = UserNotification | OneOffNotification;

type NotificationDetailFields = {
  contextUsed: JsonValue | null;
  contextParameters: JsonValue | null;
  extraParams: JsonValue | null;
  attachments: NotificationAttachment[];
};

export type UserNotificationDetail = UserNotification & NotificationDetailFields;
export type OneOffNotificationDetail = OneOffNotification & NotificationDetailFields;

/**
 * Detail-view notification, including the (potentially large) context payloads.
 */
export type NotificationDetail = UserNotificationDetail | OneOffNotificationDetail;

export type NotificationOrderByField =
  | 'sendAfter'
  | 'sentAt'
  | 'readAt'
  | 'createdAt'
  | 'updatedAt';

export type NotificationOrderDirection = 'asc' | 'desc';

/**
 * Query parameters accepted by `GET /api/v1/notifications`.
 * Every field is optional; date fields are ISO-8601 strings.
 */
export type NotificationListQuery = {
  page?: number;
  pageSize?: number;
  status?: NotificationStatus;
  notificationType?: NotificationType;
  adapterUsed?: string;
  userId?: string;
  bodyTemplate?: string;
  subjectTemplate?: string;
  contextName?: string;
  tenant?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
  sentAtFrom?: string;
  sentAtTo?: string;
  orderByField?: NotificationOrderByField;
  orderByDirection?: NotificationOrderDirection;
};

/**
 * Envelope returned by every paginated endpoint. `page` is 1-indexed.
 */
export type PaginatedResponse<T> = {
  data: T[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};

/**
 * Envelope returned by every single-resource endpoint.
 */
export type DataResponse<T> = {
  data: T;
};

/**
 * Filter capabilities advertised by the configured backend. Consumers use it to
 * hide sorting/filtering affordances the backend cannot honour. Keys mirror
 * VintaSend's capability keys (e.g. `orderBy.sentAt`, `stringLookups.includes`).
 */
export type FilterCapabilities = Record<string, boolean>;

/**
 * Payload of `GET /api/v1/notifications/{id}/preview` on success.
 */
export type NotificationPreview = {
  gitCommitSha: string;
  bodyTemplatePath: string;
  subjectTemplatePath: string | null;
  renderedBodyHtml: string;
  renderedSubjectHtml: string;
};

/**
 * Payload of `POST /api/v1/notifications/{id}/cancel` on success.
 */
export type CancelledNotification = {
  id: string;
  status: NotificationStatus;
};

/**
 * Machine-readable error codes. Clients should branch on these, not on messages.
 */
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PREVIEW_UNAVAILABLE'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

/**
 * Error envelope returned with every non-2xx response.
 */
export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: JsonValue;
  };
};

export type HealthResponse = {
  status: 'ok';
  apiVersion: string;
};
