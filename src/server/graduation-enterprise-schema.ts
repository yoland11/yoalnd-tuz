import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ensureGraduationOperationsTables } from "@/server/graduation-schema";

let enterpriseTablesReady: Promise<void> | null = null;

/**
 * Additive compatibility guard for branches that have not applied migration
 * 0068 yet. This deliberately performs no deletes and does not rewrite orders.
 */
export async function ensureGraduationEnterpriseTables() {
  if (!enterpriseTablesReady) {
    enterpriseTablesReady = (async () => {
      await ensureGraduationOperationsTables();
      await db.execute(sql`select 1`);
    })().catch((error) => {
      enterpriseTablesReady = null;
      throw error;
    });
  }
  await enterpriseTablesReady;
}
