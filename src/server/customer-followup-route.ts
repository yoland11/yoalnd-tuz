import { NextResponse } from "next/server";
import { CustomerFollowupError, handleCustomerFollowupRequest } from "./customer-followups";
import type { FollowupActor } from "@/lib/customer-followups";
import { codeForHttpStatus, createApiErrorPayload, makeRequestId, type ApiErrorCode } from "./write-safety";
import { safeServerError } from "./safe-server-log";

/** Original AJN authentication is resolved by api.ts; this boundary adds no role grants. */
export async function customerFollowupRoute(
  request: Request,
  parts: string[],
  actor: FollowupActor | null,
  db: Parameters<typeof handleCustomerFollowupRequest>[0],
  run: typeof handleCustomerFollowupRequest = handleCustomerFollowupRequest,
) {
  const requestId = makeRequestId(request.headers.get("x-request-id"));
  const headers = { "Cache-Control": "private, no-store", "x-request-id": requestId };
  if (!actor) return NextResponse.json(createApiErrorPayload({ status: 401, code: "AUTH_REQUIRED", requestId }), { status: 401, headers });
  try {
    const result = await run(db, actor, { method: request.method, parts, query: new URL(request.url).searchParams, readBody: () => request.json() });
    return NextResponse.json(result.data, { status: result.status, headers });
  } catch (cause) {
    const known = cause instanceof CustomerFollowupError;
    const badJson = cause instanceof SyntaxError;
    const status = known ? cause.status : badJson ? 400 : 500;
    const code: ApiErrorCode = status >= 500 ? "DATABASE_ERROR" : known && cause.code === "STALE_DATA" ? "STALE_DATA" : codeForHttpStatus(status);
    console.error("AJN customer followup request failed", {
      requestId, actorId: actor.id, action: parts[1] ?? parts[0] ?? request.method,
      error: safeServerError(cause),
    });
    return NextResponse.json({
      ...createApiErrorPayload({ status, code, requestId,
        ...(known ? { message: cause.message, retryable: cause.retryable } : badJson ? { message: "صيغة طلب المتابعة غير صحيحة", retryable: false } : { retryable: true }),
      }),
      ...(known ? { featureCode: cause.code } : {}),
      ...(known && cause.existingBooking ? { existingBooking: cause.existingBooking } : {}),
    }, { status, headers });
  }
}
