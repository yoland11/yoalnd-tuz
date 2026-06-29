import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db, desktopIdempotencyKeysTable } from "@workspace/db";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$/;
let tableReady: Promise<void> | null = null;

async function ensureDesktopIdempotencyTable() {
  if (!tableReady) {
    tableReady = db.execute(sql`
      CREATE TABLE IF NOT EXISTS "desktop_idempotency_keys" (
        "id" serial PRIMARY KEY,
        "idempotency_key" varchar(100) NOT NULL,
        "request_method" varchar(10) NOT NULL,
        "request_path" text NOT NULL,
        "request_hash" varchar(64) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'processing',
        "response_status" varchar(3),
        "response_body" jsonb,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "completed_at" timestamp
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "desktop_idempotency_key_unique_idx"
        ON "desktop_idempotency_keys" ("idempotency_key");
      CREATE INDEX IF NOT EXISTS "desktop_idempotency_created_at_idx"
        ON "desktop_idempotency_keys" ("created_at");
      CREATE INDEX IF NOT EXISTS "desktop_idempotency_status_idx"
        ON "desktop_idempotency_keys" ("status");
    `).then(() => undefined).catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  await tableReady;
}

function requestHash(method: string, path: string, body: string) {
  return createHash("sha256").update(`${method}\n${path}\n${body}`).digest("hex");
}

function replayResponse(row: typeof desktopIdempotencyKeysTable.$inferSelect) {
  const status = Number(row.responseStatus ?? 200) || 200;
  return NextResponse.json(row.responseBody ?? { ok: true }, {
    status,
    headers: { "x-idempotent-replay": "1" },
  });
}

export async function withDesktopIdempotency(
  request: NextRequest,
  path: string[],
  handler: () => Promise<Response>,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const key = request.headers.get("x-idempotency-key")?.trim() ?? "";
  if (!MUTATION_METHODS.has(method) || !key) return handler();
  if (!KEY_PATTERN.test(key)) {
    return NextResponse.json({ error: "مفتاح منع التكرار غير صالح" }, { status: 400 });
  }

  await ensureDesktopIdempotencyTable();
  const requestPath = `/api/${path.join("/")}`;
  const rawBody = await request.clone().text().catch(() => "");
  const fingerprint = requestHash(method, requestPath, rawBody);
  const existing = await db.query.desktopIdempotencyKeysTable.findFirst({
    where: eq(desktopIdempotencyKeysTable.idempotencyKey, key),
  });
  if (existing) {
    if (existing.requestHash !== fingerprint || existing.requestMethod !== method || existing.requestPath !== requestPath) {
      return NextResponse.json({ error: "استُخدم مفتاح المزامنة لعملية مختلفة" }, { status: 409 });
    }
    if (existing.status === "completed") return replayResponse(existing);
    return NextResponse.json({ error: "العملية قيد التنفيذ، أعد المحاولة بعد قليل" }, { status: 409 });
  }

  const claimed = await db.insert(desktopIdempotencyKeysTable).values({
    idempotencyKey: key,
    requestMethod: method,
    requestPath,
    requestHash: fingerprint,
    status: "processing",
  }).onConflictDoNothing().returning({ id: desktopIdempotencyKeysTable.id });

  if (!claimed.length) {
    const raced = await db.query.desktopIdempotencyKeysTable.findFirst({
      where: and(
        eq(desktopIdempotencyKeysTable.idempotencyKey, key),
        eq(desktopIdempotencyKeysTable.requestHash, fingerprint),
      ),
    });
    if (raced?.status === "completed") return replayResponse(raced);
    return NextResponse.json({ error: "العملية قيد التنفيذ، أعد المحاولة بعد قليل" }, { status: 409 });
  }

  try {
    const response = await handler();
    if (!response.ok) {
      await db.delete(desktopIdempotencyKeysTable).where(eq(desktopIdempotencyKeysTable.id, claimed[0].id));
      return response;
    }
    const text = await response.clone().text();
    let responseBody: unknown = null;
    try { responseBody = text ? JSON.parse(text) : { ok: true }; }
    catch { responseBody = { value: text }; }
    await db.update(desktopIdempotencyKeysTable).set({
      status: "completed",
      responseStatus: String(response.status),
      responseBody,
      completedAt: new Date(),
    }).where(eq(desktopIdempotencyKeysTable.id, claimed[0].id));

    // Best-effort retention keeps the table bounded without touching recent retries.
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    void db.delete(desktopIdempotencyKeysTable).where(lt(desktopIdempotencyKeysTable.createdAt, cutoff)).catch(() => undefined);
    return response;
  } catch (error) {
    await db.delete(desktopIdempotencyKeysTable).where(eq(desktopIdempotencyKeysTable.id, claimed[0].id)).catch(() => undefined);
    throw error;
  }
}
