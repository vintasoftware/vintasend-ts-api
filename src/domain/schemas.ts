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
  createdAtFrom: isoDateSchema.optional(),
  createdAtTo: isoDateSchema.optional(),
  sentAtFrom: isoDateSchema.optional(),
  sentAtTo: isoDateSchema.optional(),
  orderByField: orderByFieldSchema.optional(),
  orderByDirection: orderByDirectionSchema.optional(),
});

export const resendBodySchema = z
  .object({
    useStoredContext: z.boolean().default(false),
  })
  .default({ useStoredContext: false });

export type NotificationListQueryInput = z.infer<typeof notificationListQuerySchema>;
export type PaginationQueryInput = z.infer<typeof paginationQuerySchema>;
export type ResendBodyInput = z.infer<typeof resendBodySchema>;
