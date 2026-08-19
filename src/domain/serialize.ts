/**
 * Converts VintaSend database notifications into the wire contract.
 *
 * List payloads drop the potentially large context/attachment payloads; detail
 * payloads keep them. Dates always become ISO-8601 strings, and absent dates
 * are normalised to `null` (never `undefined`) so JSON responses are uniform.
 */

import type { StoredAttachment } from 'vintasend';
import { isOneOffNotification } from 'vintasend';

import type {
  JsonValue,
  Notification,
  NotificationAttachment,
  NotificationDetail,
  OneOffNotification,
  UserNotification,
} from '../contract/types.js';
import type {
  ApiAnyDatabaseNotification,
  ApiDatabaseNotification,
  ApiDatabaseOneOffNotification,
} from '../services/notification-service-port.js';

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toJsonValue(value: unknown): JsonValue | null {
  if (value === undefined || value === null) {
    return null;
  }
  return value as JsonValue;
}

function serializeAttachments(attachments?: StoredAttachment[]): NotificationAttachment[] {
  if (!attachments) {
    return [];
  }

  return attachments.map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size,
    ...(attachment.description === undefined ? {} : { description: attachment.description }),
  }));
}

function serializeSharedFields(notification: ApiAnyDatabaseNotification) {
  return {
    notificationType: notification.notificationType,
    title: notification.title,
    contextName: notification.contextName,
    status: notification.status,
    sendAfter: toIsoString(notification.sendAfter),
    sentAt: toIsoString(notification.sentAt),
    readAt: toIsoString(notification.readAt),
    createdAt: toIsoString(notification.createdAt),
    updatedAt: toIsoString(notification.updatedAt),
    adapterUsed: notification.adapterUsed,
    bodyTemplate: notification.bodyTemplate,
    subjectTemplate: notification.subjectTemplate,
    gitCommitSha: notification.gitCommitSha,
    tenant: notification.tenant,
  };
}

export function serializeUserNotification(notification: ApiDatabaseNotification): UserNotification {
  return {
    kind: 'user',
    id: String(notification.id),
    userId: String(notification.userId),
    ...serializeSharedFields(notification),
  };
}

export function serializeOneOffNotification(
  notification: ApiDatabaseOneOffNotification,
): OneOffNotification {
  return {
    kind: 'one-off',
    id: String(notification.id),
    emailOrPhone: notification.emailOrPhone,
    firstName: notification.firstName ?? null,
    lastName: notification.lastName ?? null,
    ...serializeSharedFields(notification),
  };
}

/**
 * Serializes either notification variant for list responses.
 */
export function serializeNotification(notification: ApiAnyDatabaseNotification): Notification {
  return isOneOffNotification(notification)
    ? serializeOneOffNotification(notification)
    : serializeUserNotification(notification);
}

function serializeDetailFields(notification: ApiAnyDatabaseNotification) {
  return {
    contextUsed: toJsonValue(notification.contextUsed),
    contextParameters: toJsonValue(notification.contextParameters),
    extraParams: toJsonValue(notification.extraParams),
    attachments: serializeAttachments(notification.attachments),
  };
}

/**
 * Serializes either notification variant for detail responses.
 */
export function serializeNotificationDetail(
  notification: ApiAnyDatabaseNotification,
): NotificationDetail {
  if (isOneOffNotification(notification)) {
    return {
      ...serializeOneOffNotification(notification),
      ...serializeDetailFields(notification),
    };
  }

  return {
    ...serializeUserNotification(notification),
    ...serializeDetailFields(notification),
  };
}
