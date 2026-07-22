/**
 * READ-ONLY diagnostic for Sound/Kosha booking routing into the Kosha Portal.
 *
 * Runs SELECT statements only. It never inserts, updates, deletes or alters
 * anything, and it never prints customer phone numbers in full.
 *
 * Usage: node scripts/verify-sound-routing.mjs
 */

import { readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;

// Mirror of the server-side classifier in src/server/api.ts.
const KOSHA_ROUTING_WORDS = [
  "sound", "sounds", "audio", "speaker", "speakers", "mixer", "mixers",
  "microphone", "microphones", "mic", "mics", "dj", "amplifier", "amplifiers",
  "subwoofer", "subwoofers",
];

const KOSHA_ROUTING_TOKENS = [
  "kosha", "rcf", "w17",
  "كوش", "صوت", "سماع", "سبيكر", "مكسر", "ميكسر",
  "ميكرفون", "مايكرفون", "مايك", "دي جي", "مضخم",
];

const WORD_RE = new RegExp(
  `(^|[^\\p{L}\\p{N}])(${KOSHA_ROUTING_WORDS.join("|")})([^\\p{L}\\p{N}]|$)`,
  "u",
);

const matches = (raw) => {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return false;
  return KOSHA_ROUTING_TOKENS.some((token) => value.includes(token)) || WORD_RE.test(value);
};

function routes(order, service) {
  const fields = order.custom_fields ?? {};
  const values = [
    service?.type,
    service?.name,
    service?.name_ar,
    fields.serviceType,
    fields.department,
    ...(Array.isArray(fields.departments) ? fields.departments : []),
    fields.packageName,
    fields.category,
    fields.categoryName,
    ...(Array.isArray(fields.bookingCenterServices)
      ? fields.bookingCenterServices.map((item) => item?.type ?? item?.key ?? item?.name)
      : []),
    ...(Array.isArray(fields.items)
      ? fields.items.map((item) => item?.name ?? item?.nameAr ?? item?.productName)
      : []),
  ];
  return values.some(matches);
}

function envUrl() {
  for (const file of [".env.local", ".env"]) {
    try {
      const match = readFileSync(file, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n\r]+)"?/m);
      if (match) return match[1].trim();
    } catch {
      // Try the next environment source.
    }
  }
  return process.env.DATABASE_URL ?? null;
}

const url = envUrl();
if (!url) {
  console.error("DATABASE_URL not found in .env.local, .env or the environment.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 20_000 });
const query = async (text) => (await pool.query(text)).rows;
const line = (title) => console.log(`\n${"─".repeat(64)}\n${title}\n${"─".repeat(64)}`);

try {
  line("1. services.type values");
  const types = await query(`
    select type, count(*)::int as n, min(name) as sample_en, min(name_ar) as sample_ar
    from services group by type order by n desc limit 40
  `);
  console.table(types);

  line("2. Categories that look sound-related");
  const categories = await query(`
    select id, slug, name, name_ar from categories
    where slug ilike '%sound%' or slug ilike '%audio%' or slug ilike '%speaker%'
       or name ilike '%sound%' or name ilike '%audio%'
       or name_ar like '%صوت%' or name_ar like '%سماع%'
    order by id limit 40
  `);
  console.table(categories);

  line("3. Service orders — classifier decision");
  const orders = await query(`
    select so.id, so.status, so.created_at,
           so.archived_at is not null as archived,
           so.custom_fields,
           s.type as s_type, s.name as s_name, s.name_ar as s_name_ar
    from service_orders so
    left join services s on s.id = so.service_id
    where so.archived_at is null
    order by so.created_at desc
    limit 500
  `);

  const decided = orders.map((order, index) => ({
    rank: index + 1,
    id: order.id,
    status: order.status,
    serviceType: order.s_type,
    department: order.custom_fields?.department ?? null,
    departments: Array.isArray(order.custom_fields?.departments)
      ? order.custom_fields.departments.join(",")
      : null,
    centreServices: Array.isArray(order.custom_fields?.bookingCenterServices)
      ? order.custom_fields.bookingCenterServices.map((item) => item?.type).join(",")
      : null,
    routes: routes(order, {
      type: order.s_type,
      name: order.s_name,
      name_ar: order.s_name_ar,
    }),
  }));

  const routed = decided.filter((row) => row.routes);
  console.log(`scanned ${decided.length} active service orders — ${routed.length} route into the Kosha Portal`);
  console.table(routed.slice(0, 40));

  line("4. Bookings the OLD 150-row cap would have hidden");
  const lostToCap = routed.filter((row) => row.rank > 150);
  if (lostToCap.length === 0) {
    console.log("None — every routed booking is inside the newest 150 service orders.");
    console.log("(The cap bug only bites once older sound bookings fall past rank 150.)");
  } else {
    console.log(`${lostToCap.length} routed booking(s) sat past rank 150 and were invisible before this fix:`);
    console.table(lostToCap);
  }

  line("5. Summary");
  console.log(`active service orders scanned : ${decided.length}`);
  console.log(`routed into Kosha Portal      : ${routed.length}`);
  console.log(`hidden by the old 150 cap     : ${lostToCap.length}`);
  console.log(`sound-typed services found    : ${types.filter((type) => matches(type.type)).map((type) => type.type).join(", ") || "none"}`);
} catch (error) {
  console.error("\nQuery failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
