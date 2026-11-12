import { db } from "@workspace/db";
import { NextResponse } from "next/server";
import { verifyMetaSignature } from "@/server/event-messaging-provider";
import { applyMetaDelivery } from "@/server/event-messaging";
import { makeRequestId, createApiErrorPayload } from "@/server/write-safety";
import { safeServerError } from "@/server/safe-server-log";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams,
    token = process.env.META_WA_WEBHOOK_VERIFY_TOKEN;
  if (!token) return new Response("Webhook not configured", { status: 503 });
  if (q.get("hub.mode") !== "subscribe" || q.get("hub.verify_token") !== token)
    return new Response("Forbidden", { status: 403 });
  return new Response(q.get("hub.challenge") ?? "", {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(req: Request) {
  const requestId = makeRequestId(req.headers.get("x-request-id"));
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 1048576)
      return new Response("Too large", { status: 413 });
    if (
      !verifyMetaSignature(
        raw,
        req.headers.get("x-hub-signature-256"),
        process.env.META_WA_APP_SECRET,
      )
    )
      return new Response("Forbidden", { status: 403 });
    await applyMetaDelivery(db, JSON.parse(raw));
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    console.error("AJN WhatsApp delivery webhook failed", {
      requestId,
      error: safeServerError(cause),
    });
    return NextResponse.json(
      createApiErrorPayload({ status: 500, code: "DATABASE_ERROR", requestId }),
      { status: 500 },
    );
  }
}
