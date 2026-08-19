/**
 * Translates validated query parameters into VintaSend backend filters.
 *
 * String filters and ordering are negotiated against the backend's advertised
 * capabilities: a backend that cannot do case-insensitive `includes` gets an
 * exact match instead, and ordering by an unsupported field is dropped rather
 * than failing the request.
 */

import type {
  NotificationFilterCapabilities,
  NotificationOrderBy,
  StringFieldFilter,
} from 'vintasend';
import type { ApiNotificationFilterFields } from '../services/notification-service-port.js';
import type { NotificationListQueryInput } from './schemas.js';

export const DEFAULT_ORDER_BY_FIELD = 'createdAt' as const;
export const DEFAULT_ORDER_BY_DIRECTION = 'desc' as const;

export function buildStringFilter(
  value: string,
  capabilities: NotificationFilterCapabilities,
): StringFieldFilter {
  const supportsIncludes = capabilities['stringLookups.includes'];
  const supportsCaseInsensitive = capabilities['stringLookups.caseInsensitive'];

  if (supportsIncludes) {
    return {
      lookup: 'includes',
      value,
      ...(supportsCaseInsensitive ? { caseSensitive: false } : {}),
    };
  }

  if (supportsCaseInsensitive) {
    return { lookup: 'exact', value, caseSensitive: false };
  }

  return value;
}

export function buildBackendFilter(
  query: NotificationListQueryInput,
  capabilities: NotificationFilterCapabilities,
): ApiNotificationFilterFields {
  const filter: ApiNotificationFilterFields = {};

  if (query.status) filter.status = query.status;
  if (query.notificationType) filter.notificationType = query.notificationType;
  if (query.adapterUsed) filter.adapterUsed = query.adapterUsed;
  if (query.userId) filter.userId = query.userId;
  if (query.tenant) filter.tenant = query.tenant;

  if (query.bodyTemplate) {
    filter.bodyTemplate = buildStringFilter(query.bodyTemplate, capabilities);
  }
  if (query.subjectTemplate) {
    filter.subjectTemplate = buildStringFilter(query.subjectTemplate, capabilities);
  }
  if (query.contextName) {
    filter.contextName = buildStringFilter(query.contextName, capabilities);
  }

  if (query.createdAtFrom || query.createdAtTo) {
    filter.createdAtRange = {
      ...(query.createdAtFrom ? { from: new Date(query.createdAtFrom) } : {}),
      ...(query.createdAtTo ? { to: new Date(query.createdAtTo) } : {}),
    };
  }

  if (query.sentAtFrom || query.sentAtTo) {
    filter.sentAtRange = {
      ...(query.sentAtFrom ? { from: new Date(query.sentAtFrom) } : {}),
      ...(query.sentAtTo ? { to: new Date(query.sentAtTo) } : {}),
    };
  }

  return filter;
}

export function buildOrderBy(
  query: NotificationListQueryInput,
  capabilities: NotificationFilterCapabilities,
): NotificationOrderBy | undefined {
  const field = query.orderByField ?? DEFAULT_ORDER_BY_FIELD;
  const direction = query.orderByDirection ?? DEFAULT_ORDER_BY_DIRECTION;

  if (capabilities[`orderBy.${field}`] === false) {
    return undefined;
  }

  return { field, direction };
}
