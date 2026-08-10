/**
 * Safe, transport-neutral error contract for AJN write endpoints.
 *
 * This module deliberately contains no database or Next.js imports so it can
 * be unit-tested without connecting to a database. API routes keep the legacy
 * `error` property as an alias during the gradual migration of existing UI.
 */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_REQUIRED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DUPLICATE"
  | "FOREIGN_KEY_CONFLICT"
  | "STOCK_INSUFFICIENT"
  | "PAYMENT_INVALID"
  | "INVOICE_INVALID"
  | "BOOKING_INVALID"
  | "DATABASE_ERROR"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "STALE_DATA"
  | "UNKNOWN_ERROR";

export type ApiErrorPayload = {
  success: false;
  code: ApiErrorCode;
  message: string;
  /** Legacy alias retained until every existing caller has migrated. */
  error: string;
  fieldErrors?: Record<string, string>;
  requestId: string;
  retryable: boolean;
};

export type MappedWriteError = Pick<
  ApiErrorPayload,
  "code" | "message" | "retryable"
> & { status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 };

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: "البيانات المدخلة غير صحيحة",
  AUTH_REQUIRED: "يرجى تسجيل الدخول أولاً",
  PERMISSION_DENIED: "لا تملك صلاحية تنفيذ هذه العملية",
  NOT_FOUND: "السجل المطلوب غير موجود",
  CONFLICT: "تعذر إكمال العملية بسبب تعارض في البيانات",
  DUPLICATE: "السجل موجود مسبقاً",
  FOREIGN_KEY_CONFLICT: "لا يمكن تنفيذ العملية لوجود سجلات مرتبطة",
  STOCK_INSUFFICIENT: "الكمية المطلوبة أكبر من المتوفر في المخزون",
  PAYMENT_INVALID: "طريقة الدفع أو بياناته غير صالحة",
  INVOICE_INVALID: "بيانات الفاتورة غير صالحة",
  BOOKING_INVALID: "بيانات الحجز غير صالحة",
  DATABASE_ERROR: "تعذر الاتصال بقاعدة البيانات",
  NETWORK_ERROR: "تعذر الاتصال بالخادم",
  RATE_LIMITED: "تم تجاوز عدد المحاولات المسموح، حاول لاحقاً",
  STALE_DATA: "تم تعديل البيانات من مستخدم آخر، حدّث الصفحة وحاول مجدداً",
  UNKNOWN_ERROR: "تعذر إكمال العملية. حاول مرة أخرى، وإذا استمرت المشكلة راجع سجل الخادم.",
};

export function codeForHttpStatus(status: number): ApiErrorCode {
  if (status === 400) return "VALIDATION_ERROR";
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 422) return "VALIDATION_ERROR";
  if (status === 429) return "RATE_LIMITED";
  return "UNKNOWN_ERROR";
}

export function makeRequestId(value?: string | null): string {
  const safe = String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (safe) return safe;
  return `REQ-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createApiErrorPayload(input: {
  requestId: string;
  status: number;
  code?: ApiErrorCode;
  message?: string;
  retryable?: boolean;
  fieldErrors?: Record<string, string>;
}): ApiErrorPayload {
  const code = input.code ?? codeForHttpStatus(input.status);
  const message = input.message || DEFAULT_MESSAGES[code];
  return {
    success: false,
    code,
    message,
    error: message,
    ...(input.fieldErrors && Object.keys(input.fieldErrors).length
      ? { fieldErrors: input.fieldErrors }
      : {}),
    requestId: input.requestId,
    retryable: input.retryable ?? (code === "STALE_DATA" || code === "DATABASE_ERROR" || code === "NETWORK_ERROR"),
  };
}

/** Maps PostgreSQL/Drizzle driver errors without leaking their raw detail. */
export function mapWriteError(error: unknown): MappedWriteError {
  const value = error as { code?: string; message?: string; name?: string } | null;
  const pgCode = value?.code;
  if (pgCode === "23505") return { status: 409, code: "DUPLICATE", message: DEFAULT_MESSAGES.DUPLICATE, retryable: false };
  if (pgCode === "23503") return { status: 409, code: "FOREIGN_KEY_CONFLICT", message: DEFAULT_MESSAGES.FOREIGN_KEY_CONFLICT, retryable: false };
  if (pgCode === "23502" || pgCode === "22P02" || pgCode === "22007" || pgCode === "22003")
    return { status: 400, code: "VALIDATION_ERROR", message: DEFAULT_MESSAGES.VALIDATION_ERROR, retryable: false };
  if (pgCode === "23514") return { status: 422, code: "VALIDATION_ERROR", message: DEFAULT_MESSAGES.VALIDATION_ERROR, retryable: false };
  // PostgreSQL raises 42P10 when ON CONFLICT does not reproduce a partial
  // unique-index predicate. This is a deploy/schema compatibility conflict,
  // not an opaque 500 or a client retry condition.
  if (pgCode === "42P10") return { status: 409, code: "CONFLICT", message: "تعذر حفظ العملية بسبب تعارض في قيد قاعدة البيانات", retryable: false };
  if (pgCode === "40001" || pgCode === "40P01") return { status: 409, code: "STALE_DATA", message: DEFAULT_MESSAGES.STALE_DATA, retryable: true };
  if (pgCode === "08000" || pgCode === "08001" || pgCode === "08003" || pgCode === "08006" || pgCode === "57P01" || pgCode === "53300" || value?.name === "PostgresError")
    return { status: 500, code: "DATABASE_ERROR", message: DEFAULT_MESSAGES.DATABASE_ERROR, retryable: true };
  return { status: 500, code: "UNKNOWN_ERROR", message: DEFAULT_MESSAGES.UNKNOWN_ERROR, retryable: false };
}
