import { zValidator } from '@hono/zod-validator';
import type { ZodSchema } from 'zod';

import type { JsonValue } from '../contract/types.js';
import { ApiError } from '../errors.js';

type ValidationTarget = 'query' | 'json' | 'param';

/**
 * `zValidator` with the contract's error envelope: invalid input always comes
 * back as a 400 `BAD_REQUEST` listing the offending fields.
 */
// biome-ignore lint/suspicious/noExplicitAny: mirrors zValidator's own signature
export function validate(target: ValidationTarget, schema: ZodSchema<any>) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw ApiError.badRequest(`Invalid request ${target}.`, {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      } as JsonValue);
    }
  });
}
