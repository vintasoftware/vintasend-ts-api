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

/**
 * Body of `POST /notifications/{id}/requeue`. Optional: an omitted `sendAfter` keeps the
 * notification's own schedule, and `null` sends it as soon as it is re-queued.
 */
export const requeueBodySchema = z.object({
  sendAfter: isoDateSchema.nullable().optional(),
});

/**
 * Body of `POST /notifications/{id}/repin`. Optional: an omitted `templateVersion` pins the
 * version the renderer reports as current. `min(0)` for the same reason as the list filter.
 */
export const repinBodySchema = z.object({
  templateVersion: z.number().int().min(0).optional(),
});

export type NotificationListQueryInput = z.infer<typeof notificationListQuerySchema>;
export type PaginationQueryInput = z.infer<typeof paginationQuerySchema>;
export type ResendBodyInput = z.infer<typeof resendBodySchema>;
export type RequeueBodyInput = z.infer<typeof requeueBodySchema>;
export type RepinBodyInput = z.infer<typeof repinBodySchema>;
