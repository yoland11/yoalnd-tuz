import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ensureGraduationEnterpriseTables } from "@/server/graduation-enterprise-schema";

let mediaTablesReady: Promise<void> | null = null;

/** Additive compatibility guard; mirrors migration 0071 without deleting data. */
export async function ensureGraduationMediaTables() {
  if (!mediaTablesReady) {
    mediaTablesReady = (async () => {
      await ensureGraduationEnterpriseTables();
      await db.execute(sql`select 1`);
    })().catch((error) => {
      mediaTablesReady = null;
      throw error;
    });
  }
  await mediaTablesReady;
}

