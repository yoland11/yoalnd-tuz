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
  const canonical = (await pool.query(`
    select id, custom_fields
    from service_orders
    where archived_at is null
      and (custom_fields->>'bookingType' = 'sound'
        or custom_fields->'departments' ? 'sound')
  `)).rows;
  const missingAssetReservations = canonical.filter((row) => {
    const fields = row.custom_fields ?? {};
    const assetIds = (Array.isArray(fields.soundItems) ? fields.soundItems : [])
      .filter((item) => item?.isAsset === true || item?.isRental === true)
      .map((item) => Number(item.productId))
      .filter(Boolean);
    const reserved = new Set(
      (Array.isArray(fields.bookingOperations?.assets) ? fields.bookingOperations.assets : [])
        .filter((item) => ["reserved", "picked", "out", "returned", "inspection", "completed"].includes(String(item?.stage)))
        .map((item) => Number(item.productId)),
    );
    return assetIds.some((id) => !reserved.has(id));
  });
  const sourceIdentity = new Set(canonical.map((row) => {
    const fields = row.custom_fields ?? {};
    return `${fields.sourceType ?? ""}:${fields.sourceId ?? ""}`;
  }));
  const portalFiles = [
    readFileSync("src/views/staff/index.tsx", "utf8"),
    readFileSync("src/views/staff/lib.ts", "utf8"),
    readFileSync("src/views/staff/booking-detail.tsx", "utf8"),
  ].join("\n");
  const sourceSafePortal = portalFiles.includes("?source=service") && portalFiles.includes("source={source}");
  console.table(summary);
  console.log(`duplicate SourceType + SourceID references: ${duplicates.length}`);
  console.log(`sound bookings missing source identity: ${malformed}`);
  console.log(`canonical source identities: ${sourceIdentity.size}/${canonical.length}`);
  console.log(`sound asset reservations missing: ${missingAssetReservations.length}`);
  console.log(`staff portal source-safe links and actions: ${sourceSafePortal ? "yes" : "no"}`);
  if (duplicates.length || malformed || missingAssetReservations.length || !sourceSafePortal) {
    failed = true;
    if (duplicates.length) console.table(duplicates);
    if (missingAssetReservations.length) console.table(missingAssetReservations.map((row) => ({ bookingId: row.id })));
  }
} finally {
  await pool.end();
}
if (failed) process.exit(1);
console.log("Sound Center integrity checks passed");
