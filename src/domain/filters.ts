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
import type {
  ApiNotificationFilter,
  ApiNotificationFilterFields,
} from '../services/notification-service-port.js';
import type { FilterInput, NotificationListQueryInput } from './schemas.js';

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

  // Compared against undefined rather than tested for truthiness: version 0 is a legitimate value
  // the query schema accepts, and `if (query.requestedTemplateVersion)` would drop it.
  //
  // Not capability-gated, matching the Python implementation. Both fields default to unsupported
  // in VintaSend's capability map, so gating them here would silently drop the filter for every
  // backend that has not opted in — and a filter the backend ignores returns too many rows rather
  // than too few, which a caller can see. Read `/capabilities` to know whether it will bite.
  if (query.requestedTemplateVersion !== undefined) {
    filter.requestedTemplateVersion = query.requestedTemplateVersion;
  }
  if (query.usedTemplateVersion !== undefined) {
    filter.usedTemplateVersion = query.usedTemplateVersion;
  }

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

const DATE_RANGE_FIELDS = [
  'sendAfterRange',
  'createdAtRange',
  'sentAtRange',
  'readAtRange',
] as const;

/**
 * A search filter from the wire as VintaSend takes it: the same tree, with each range's ISO
 * strings turned into dates.
 */
export function toBackendFilter(filter: FilterInput): ApiNotificationFilter {
  if ('and' in filter) return { and: filter.and.map(toBackendFilter) };
  if ('or' in filter) return { or: filter.or.map(toBackendFilter) };
  if ('not' in filter) return { not: toBackendFilter(filter.not) };

  const fields: Record<string, unknown> = { ...filter };
  for (const key of DATE_RANGE_FIELDS) {
    const range = filter[key];
    if (range !== undefined) {
      fields[key] = {
        ...(range.from === undefined ? {} : { from: new Date(range.from) }),
        ...(range.to === undefined ? {} : { to: new Date(range.to) }),
      };
    }
  }
  return fields as ApiNotificationFilterFields;
}

/**
 * Everything in `filter` the backend reports it cannot do, as 400 issues; empty when it can do all
 * of it.
 *
 * Checked up front because a backend refuses such a filter with a plain error, which would reach
 * the client as a 500. Reads `logical.and`, `logical.or`, `logical.not`, `logical.notNested` (a
 * `not` around a group), `fields.<field>` and, under a `not`, `negation.<field>`. A key the report
 * leaves out counts as supported, as VintaSend's capability map does.
 */
export function unsupportedFilterFeatures(
  filter: FilterInput,
  capabilities: NotificationFilterCapabilities,
  path = 'filter',
  negated = false,
): { path: string; message: string }[] {
  const refuses = (key: string) => capabilities[key] === false;
  const issue = (at: string, key: string) => ({
    path: at,
    message: `The backend does not support ${key}.`,
  });

  if ('and' in filter || 'or' in filter) {
    const operator = 'and' in filter ? 'and' : 'or';
    const children = 'and' in filter ? filter.and : (filter as { or: FilterInput[] }).or;
    return [
      ...(refuses(`logical.${operator}`)
        ? [issue(`${path}.${operator}`, `logical.${operator}`)]
        : []),
      ...(negated && refuses('logical.notNested') ? [issue(path, 'logical.notNested')] : []),
      ...children.flatMap((child, index) =>
        unsupportedFilterFeatures(child, capabilities, `${path}.${operator}.${index}`, negated),
      ),
    ];
  }

  if ('not' in filter) {
    return [
      ...(refuses('logical.not') ? [issue(`${path}.not`, 'logical.not')] : []),
      ...(negated && refuses('logical.notNested') ? [issue(path, 'logical.notNested')] : []),
      ...unsupportedFilterFeatures(filter.not, capabilities, `${path}.not`, true),
    ];
  }

  return Object.keys(filter).flatMap((field) => {
    const key = negated ? `negation.${field}` : `fields.${field}`;
    const found = [];
    if (refuses(`fields.${field}`)) found.push(issue(`${path}.${field}`, `fields.${field}`));
    if (negated && refuses(key)) found.push(issue(`${path}.${field}`, key));
    return found;
  });
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
