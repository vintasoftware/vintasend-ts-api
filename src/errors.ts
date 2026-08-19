import type { ApiErrorCode, ApiErrorResponse, JsonValue } from './contract/types.js';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PREVIEW_UNAVAILABLE: 409,
  UPSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
};

/**
 * Error carrying an API error code, which the error handler turns into the
 * documented status code and error envelope.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;

  readonly status: number;

  readonly details?: JsonValue;

  constructor(code: ApiErrorCode, message: string, details?: JsonValue) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  static notFound(message: string): ApiError {
    return new ApiError('NOT_FOUND', message);
  }

  static conflict(message: string): ApiError {
    return new ApiError('CONFLICT', message);
  }

  static badRequest(message: string, details?: JsonValue): ApiError {
    return new ApiError('BAD_REQUEST', message, details);
  }

  toResponseBody(): ApiErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
