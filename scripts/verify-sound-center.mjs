/** Read-only integrity check for the centralized Sound Booking Center. */
import { readFileSync } from "node:fs";
import pg from "pg";

function databaseUrl() {
  for (const file of [".env.local", ".env"]) {
    try {
      const match = readFileSync(file, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n\r]+)"?/m);
      if (match) return match[1].trim();
    } catch { /* continue */ }
  }
  return process.env.DATABASE_URL ?? null;
}

const url = databaseUrl();
if (!url) throw new Error("DATABASE_URL is missing");
const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 20_000 });
let failed = false;
try {
  const summary = (await pool.query(`
    select coalesce(custom_fields->>'sourceType', 'admin_booking') as source_type,
           count(*)::int as bookings
    from service_orders
    where archived_at is null
      and (custom_fields->>'bookingType' = 'sound'
        or custom_fields->'departments' ? 'sound')
    group by 1 order by 1
  `)).rows;
  const duplicates = (await pool.query(`
    select custom_fields->>'externalReference' as external_reference, count(*)::int as copies
    from service_orders
    where archived_at is null and custom_fields->>'externalReference' is not null
      and (custom_fields->>'bookingType' = 'sound'
        or custom_fields->'departments' ? 'sound')
    group by 1 having count(*) > 1
  `)).rows;
  const malformed = (await pool.query(`
    select count(*)::int as count
    from service_orders
    where archived_at is null and custom_fields->>'bookingType' = 'sound'
      and (custom_fields->>'sourceType' is null or custom_fields->>'sourceId' is null)
  `)).rows[0]?.count ?? 0;
  console.table(summary);
  console.log(`duplicate SourceType + SourceID references: ${duplicates.length}`);
  console.log(`sound bookings missing source identity: ${malformed}`);
  if (duplicates.length || malformed) {
    failed = true;
    if (duplicates.length) console.table(duplicates);
  }
} finally {
  await pool.end();
}
if (failed) process.exit(1);
console.log("Sound Center integrity checks passed");
