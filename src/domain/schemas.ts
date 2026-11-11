/**
 * Request validation schemas. These define, precisely, what the API accepts —
 * an implementation of this contract in another language should reject the same
 * inputs with the same 400 responses.
 */

import { z } from 'zod';

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 100;

const notificationStatusSchema = z.enum(['PENDING_SEND', 'SENT', 'FAILED', 'READ', 'CANCELLED']);

const notificationTypeSchema = z.enum(['EMAIL', 'SMS', 'PUSH', 'IN_APP']);

const orderByFieldSchema = z.enum(['sendAfter', 'sentAt', 'readAt', 'createdAt', 'updatedAt']);

const orderByDirectionSchema = z.enum(['asc', 'desc']);

const isoDateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Must be an ISO-8601 date string',
});

const nonEmptyString = z.string().trim().min(1);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  pageSize: z.coerce
    .number()
    .int()
    .min(MIN_PAGE_SIZE)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export const notificationListQuerySchema = paginationQuerySchema.extend({
  status: notificationStatusSchema.optional(),
  notificationType: notificationTypeSchema.optional(),
  adapterUsed: nonEmptyString.optional(),
  userId: nonEmptyString.optional(),
  bodyTemplate: nonEmptyString.optional(),
  subjectTemplate: nonEmptyString.optional(),
  contextName: nonEmptyString.optional(),
  tenant: nonEmptyString.optional(),
  // `min(0)` rather than `min(1)`: the contract admits version 0, and rejecting it here would
  // make a legal filter a 400.
  requestedTemplateVersion: z.coerce.number().int().min(0).optional(),
  usedTemplateVersion: z.coerce.number().int().min(0).optional(),
  createdAtFrom: isoDateSchema.optional(),
  createdAtTo: isoDateSchema.optional(),
  sentAtFrom: isoDateSchema.optional(),
  sentAtTo: isoDateSchema.optional(),
  orderByField: orderByFieldSchema.optional(),
  orderByDirection: orderByDirectionSchema.optional(),
});

/** Body of `POST /notifications/{id}/resend`. Optional: an omitted body regenerates the context. */
export const resendBodySchema = z.object({
  useStoredContext: z.boolean().default(false),
});

/** A template version: `min(0)` for the same reason as the list filter. */
const templateVersionSchema = z.number().int().min(0);

/**
 * A version token from `POST /notifications/versions`. Opaque: only its length is checked, so a
 * token from any backend passes through untouched.
 */
const versionTokenSchema = z.string().min(1).max(256);

/**
 * Body of `POST /notifications/{id}/requeue`. Optional: an omitted `sendAfter` keeps the
 * notification's own schedule, and `null` sends it as soon as it is re-queued. `templateVersion`
 * pins it in the same write, `expectedVersion` refuses if it changed since it was listed, and
 * `send: false` leaves it for the pending sender.
 */
export const requeueBodySchema = z.object({
  sendAfter: isoDateSchema.nullable().optional(),
  templateVersion: templateVersionSchema.optional(),
  expectedVersion: versionTokenSchema.optional(),
  send: z.boolean().optional(),
});

/**
 * Body of `POST /notifications/{id}/repin`. Optional: an omitted `templateVersion` pins the
 * version the renderer reports as current; `expectedVersion` refuses if it changed since it was
 * listed.
 */
export const repinBodySchema = z.object({
  templateVersion: templateVersionSchema.optional(),
  expectedVersion: versionTokenSchema.optional(),
});

/** How deep `and` / `or` / `not` may nest in a search filter. */
export const MAX_FILTER_DEPTH = 6;
/** How many sub-filters one `and` or `or` may hold, and how many values one list may. */
export const MAX_FILTER_ITEMS = 50;
/** `POST /notifications/versions` returns IDs only, so it pages larger than the listings. */
export const MAX_VERSIONS_PAGE_SIZE = 1000;

const oneOrMany = <T extends z.ZodType>(schema: T) =>
  z.union([schema, z.array(schema).min(1).max(MAX_FILTER_ITEMS)]);

const dateRangeSchema = z.strictObject({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

/**
 * One leaf of a search filter: VintaSend's filter fields, every one optional and ANDed. Strings
 * match exactly; dates are ISO-8601 strings.
 */
export const filterFieldsSchema = z.strictObject({
  status: oneOrMany(notificationStatusSchema).optional(),
  notificationType: oneOrMany(notificationTypeSchema).optional(),
  adapterUsed: oneOrMany(nonEmptyString).optional(),
  userId: nonEmptyString.optional(),
  bodyTemplate: nonEmptyString.optional(),
  subjectTemplate: nonEmptyString.optional(),
  contextName: nonEmptyString.optional(),
  tenant: oneOrMany(nonEmptyString).optional(),
  requestedTemplateVersion: oneOrMany(templateVersionSchema).optional(),
  usedTemplateVersion: oneOrMany(templateVersionSchema).optional(),
  hasSendAfter: z.boolean().optional(),
  hasRequestedTemplateVersion: z.boolean().optional(),
  sendAfterRange: dateRangeSchema.optional(),
  createdAtRange: dateRangeSchema.optional(),
  sentAtRange: dateRangeSchema.optional(),
  readAtRange: dateRangeSchema.optional(),
});

export type FilterFieldsInput = z.infer<typeof filterFieldsSchema>;

/** A search filter as it arrives on the wire: VintaSend's `NotificationFilter`, with ISO dates. */
export type FilterInput =
  | FilterFieldsInput
  | { and: FilterInput[] }
  | { or: FilterInput[] }
  | { not: FilterInput };

const filterNodeSchema: z.ZodType<FilterInput> = z.lazy(() =>
  z.union([
    z.strictObject({ and: z.array(filterNodeSchema).min(1).max(MAX_FILTER_ITEMS) }),
    z.strictObject({ or: z.array(filterNodeSchema).min(1).max(MAX_FILTER_ITEMS) }),
    z.strictObject({ not: filterNodeSchema }),
    filterFieldsSchema,
  ]),
);

function filterDepth(filter: FilterInput): number {
  if ('and' in filter) return 1 + Math.max(...filter.and.map(filterDepth));
  if ('or' in filter) return 1 + Math.max(...filter.or.map(filterDepth));
  if ('not' in filter) return 1 + filterDepth(filter.not);
  return 0;
}

export const notificationFilterSchema = filterNodeSchema.superRefine((filter, ctx) => {
  if (filterDepth(filter) > MAX_FILTER_DEPTH) {
    ctx.addIssue({
      code: 'custom',
      message: `and/or/not may nest at most ${MAX_FILTER_DEPTH} levels deep`,
    });
  }
});

/**
 * Body of `POST /notifications/versions`. An omitted filter matches every notification.
 */
export const notificationVersionsSearchBodySchema = z.object({
  filter: notificationFilterSchema.default({}),
  page: z.number().int().min(1).default(DEFAULT_PAGE),
  pageSize: z.number().int().min(MIN_PAGE_SIZE).max(MAX_VERSIONS_PAGE_SIZE).default(100),
});

export type NotificationListQueryInput = z.infer<typeof notificationListQuerySchema>;
export type PaginationQueryInput = z.infer<typeof paginationQuerySchema>;
export type ResendBodyInput = z.infer<typeof resendBodySchema>;
export type RequeueBodyInput = z.infer<typeof requeueBodySchema>;
export type RepinBodyInput = z.infer<typeof repinBodySchema>;
export type NotificationVersionsSearchBodyInput = z.infer<
  typeof notificationVersionsSearchBodySchema
>;
