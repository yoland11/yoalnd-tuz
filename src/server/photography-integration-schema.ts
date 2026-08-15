import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

let promise: Promise<void> | null = null;

export async function ensurePhotographyIntegrationTables() {
  if (!promise) {
    promise = db.execute(sql.raw("select 1")).then(() => undefined).catch((error) => { promise = null; throw error; });
  }
  await promise;
}
