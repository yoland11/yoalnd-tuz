import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

let researchTablesReady: Promise<void> | null = null;

/** Connectivity guard; deployment migrations own the research schema. */
export async function ensureResearchCenterTables() {
  if (!researchTablesReady) {
    researchTablesReady = db.execute(sql`select 1`).then(() => undefined).catch((error) => { researchTablesReady = null; throw error; });
  }
  await researchTablesReady;
}
