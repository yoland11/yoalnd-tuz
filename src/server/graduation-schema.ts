import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

let operationsTablesReady: Promise<void> | null = null;

/**
 * Additive runtime guard for installations that have not applied the latest
 * migration yet. It never drops, renames, or rewrites historical orders.
 */
export async function ensureGraduationOperationsTables() {
  if (!operationsTablesReady) {
    operationsTablesReady = db
      .execute(sql`select 1`)
      .then(() => undefined)
      .catch((error) => {
        operationsTablesReady = null;
        throw error;
      });
  }
  await operationsTablesReady;
}
