import type { ApiErrorCode } from "@bandsync/shared";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  email_in_use: 409,
  invalid_credentials: 401,
  invite_invalid: 404,
  invite_expired: 410,
  invite_revoked: 410,
  invite_used: 410,
  already_member: 409,
  rate_limited: 429,
  conflict: 409,
  payload_too_large: 413,
  unsupported_media: 415,
  upstream_unavailable: 503,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  toBody() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const notFound = (what = "resource") => new ApiError("not_found", `${what} not found`);
export const forbidden = (why?: string) => new ApiError("forbidden", why);
export const unauthorized = () => new ApiError("unauthorized", "authentication required");
