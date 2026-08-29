import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;
let dbInstance: NodePgDatabase<typeof schema> | null = null;

/**
 * A serverless function can be replicated many times.  Keeping the local
 * connection pool small prevents one burst of requests from exhausting a
 * session-pooler connection limit.  Vercel functions must always use one
 * connection: a deployment may run many isolated function instances, so an
 * inherited DB_POOL_MAX value would multiply connections and exhaust the
 * Supabase session pool. Local long-running development may still override
 * the default deliberately.
 */
const defaultPoolMax = process.env.VERCEL ? 1 : 5;

export function resolvePoolMax(env: NodeJS.ProcessEnv = process.env): number {
  if (env.VERCEL) return 1;
  return (
    Number.parseInt(env.DB_POOL_MAX ?? String(defaultPoolMax), 10) ||
    defaultPoolMax
  );
}

export function getPool(): pg.Pool {
  if (!poolInstance) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL must be set. Did you forget to provision a database?",
      );
    }
    poolInstance = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: resolvePoolMax(),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    poolInstance.on("error", (err) => {
      console.error("Database idle client error", {
        code: (err as NodeJS.ErrnoException).code ?? "unknown",
        message: err.message,
      });
    });
  }
  return poolInstance;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

export const pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    const target = getPool();
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    const target = getDb();
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export * from "./schema";
