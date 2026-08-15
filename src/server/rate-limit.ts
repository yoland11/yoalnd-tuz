import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

type LocalBucket = { count: number; resetAt: number };
const localBuckets = new Map<string, LocalBucket>();

function digestKey(action: string, keyParts: readonly string[]) {
  const normalized = keyParts
    .map((part) => part.trim().toLowerCase())
    .join("\u0000");
  return createHash("sha256")
    .update(`${action}\u0000${normalized}`)
    .digest("hex");
}

function useDistributedStore() {
  if (process.env.RATE_LIMIT_BACKEND === "memory") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RATE_LIMIT_BACKEND=memory is forbidden in production");
    }
    return false;
  }
  return (
    process.env.NODE_ENV === "production" ||
    process.env.RATE_LIMIT_BACKEND === "postgres"
  );
}

function consumeLocal(
  keyHash: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = localBuckets.get(keyHash);
  const bucket =
    !existing || existing.resetAt <= now
      ? { count: 1, resetAt: now + windowMs }
      : { count: existing.count + 1, resetAt: existing.resetAt };
  localBuckets.set(keyHash, bucket);
  return {
    allowed: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export async function consumeRateLimit(input: {
  action: string;
  keyParts: readonly string[];
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  const keyHash = digestKey(input.action, input.keyParts);
  if (!useDistributedStore())
    return consumeLocal(keyHash, input.limit, input.windowMs);

  const result = await db.execute(sql`
    INSERT INTO rate_limit_buckets
      (key_hash, action, hit_count, window_started_at, reset_at, updated_at)
    VALUES
      (${keyHash}, ${input.action}, 1, now(), now() + (${input.windowMs} * interval '1 millisecond'), now())
    ON CONFLICT (key_hash) DO UPDATE SET
      action = EXCLUDED.action,
      hit_count = CASE
        WHEN rate_limit_buckets.reset_at <= now() THEN 1
        ELSE rate_limit_buckets.hit_count + 1
      END,
      window_started_at = CASE
        WHEN rate_limit_buckets.reset_at <= now() THEN now()
        ELSE rate_limit_buckets.window_started_at
      END,
      reset_at = CASE
        WHEN rate_limit_buckets.reset_at <= now()
          THEN now() + (${input.windowMs} * interval '1 millisecond')
        ELSE rate_limit_buckets.reset_at
      END,
      updated_at = now()
    RETURNING hit_count, reset_at
  `);
  const row = result.rows[0] as
    { hit_count: number | string; reset_at: Date | string } | undefined;
  if (!row) throw new Error("Distributed rate limiter returned no result");
  const count = Number(row.hit_count);
  const resetAt = new Date(row.reset_at).getTime();
  return {
    allowed: count <= input.limit,
    limit: input.limit,
    remaining: Math.max(0, input.limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  };
}

export async function cleanupExpiredRateLimits(input: {
  limit?: number;
  retentionMs?: number;
} = {}): Promise<{ deleted: number; limit: number; retentionMs: number }> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 1_000), 1), 5_000);
  const retentionMs = Math.max(Math.trunc(input.retentionMs ?? 24 * 60 * 60 * 1_000), 60_000);
  const result = await db.execute(sql`
    WITH expired AS (
      SELECT key_hash
      FROM rate_limit_buckets
      WHERE reset_at < now() - (${retentionMs} * interval '1 millisecond')
      ORDER BY reset_at ASC
      LIMIT ${limit}
    )
    DELETE FROM rate_limit_buckets bucket
    USING expired
    WHERE bucket.key_hash = expired.key_hash
    RETURNING bucket.key_hash
  `);
  return { deleted: result.rows.length, limit, retentionMs };
}

export function resetLocalRateLimitsForTests() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Cannot reset production rate limits");
  localBuckets.clear();
}
