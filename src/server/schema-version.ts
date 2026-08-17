import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const REQUIRED_SCHEMA_REVISION = 99;

export class SchemaOutdatedError extends Error {
  constructor() {
    super(
      `AJN database schema revision ${REQUIRED_SCHEMA_REVISION} is required`,
    );
    this.name = "SchemaOutdatedError";
  }
}

let currentSchemaPromise: Promise<void> | null = null;

export async function assertCurrentSchema(): Promise<void> {
  if (!currentSchemaPromise) {
    currentSchemaPromise = (async () => {
      try {
        const result = await db.execute(sql`
          SELECT EXISTS (
            SELECT 1 FROM ajn_schema_revisions
            WHERE revision = ${REQUIRED_SCHEMA_REVISION}
          ) AS current
        `);
        if (!(result.rows[0] as { current?: boolean } | undefined)?.current) {
          throw new SchemaOutdatedError();
        }
      } catch (error: any) {
        if (error instanceof SchemaOutdatedError) throw error;
        if (error?.code === "42P01" || error?.code === "42703")
          throw new SchemaOutdatedError();
        throw error;
      }
    })().catch((error) => {
      currentSchemaPromise = null;
      throw error;
    });
  }
  return currentSchemaPromise;
}
