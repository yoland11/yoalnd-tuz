/**
 * READ-ONLY diagnostic for Sound/Kosha booking routing into the Kosha Portal.
 *
 * Runs SELECT statements only. It never inserts, updates, deletes or alters
 * anything, and it never prints customer phone numbers in full.
 *
 * Usage:  node scripts/verify-sound-routing.mjs
 *
 * It answers three questions:
 *   1. What values do Sound services/categories actually store?
 *   2. Which service orders does the portal's classifier accept?
 *   3. Would any sound booking have been lost to the old row cap?
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

// ─── Mirror of the server-side classifier (src/server/api.ts) ───────────────

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
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return false;
  return KOSHA_ROUTING_TOKENS.some((t) => v.includes(t)) || WORD_RE.test(v);
};

function routes(order, service) {
  const f = order.custom_fields ?? {};
  const values = [
    service?.type, service?.name, service?.name_ar,
    f.serviceType, f.department, f.packageName, f.category, f.categoryName,
    ...(Array.isArray(f.bookingCenterServices)
      ? f.bookingCenterServices.map((i) => i?.type ?? i?.key ?? i?.name)
      : []),
    ...(Array.isArray(f.items)
      ? f.items.map((i) => i?.name ?? i?.nameAr ?? i?.productName)
      : []),
  ];
  return values.some(matches);
}

// ─── Connect ────────────────────────────────────────────────────────────────

function envUrl() {
  for (const file of [".env.local", ".env"]) {
    try {
      const m = readFileSync(file, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n\r]+)"?/m);
      if (m) return m[1].trim();
    } catch {}
  }
  return process.env.DATABASE_URL ?? null;
}

const url = envUrl();
if (!url) {
  console.error("DATABASE_URL not found in .env.local, .env or the environment.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20 });
const line = (t) => console.log(`\n${"─".repeat(64)}\n${t}\n${"─".repeat(64)}`);

try {
  // 1) What Sound actually stores.
  line("1. services.type values");
  const types = await sql`
    select type, count(*)::int as n, min(name) as sample_en, min(name_ar) as sample_ar
    from services group by type order by n desc limit 40`;
  console.table(types);

  line("2. Categories that look sound-related");
  const cats = await sql`
    select id, slug, name, name_ar from categories
    where slug ilike '%sound%' or slug ilike '%audio%' or slug ilike '%speaker%'
       or name ilike '%sound%' or name ilike '%audio%'
       or name_ar like '%صوت%' or name_ar like '%سماع%'
    order by id limit 40`;
  console.table(cats);

  // 2) Which service orders route into the portal.
  line("3. Service orders — classifier decision");
  const orders = await sql`
    select so.id, so.status, so.created_at,
           so.archived_at is not null as archived,
           so.custom_fields,
           s.type as s_type, s.name as s_name, s.name_ar as s_name_ar
    from service_orders so
    left join services s on s.id = so.service_id
    where so.archived_at is null
    order by so.created_at desc
    limit 500`;

  const decided = orders.map((o, index) => ({
    rank: index + 1, // 1 = newest
    id: o.id,
    status: o.status,
    serviceType: o.s_type,
    department: o.custom_fields?.department ?? null,
    centreServices: Array.isArray(o.custom_fields?.bookingCenterServices)
      ? o.custom_fields.bookingCenterServices.map((i) => i?.type).join(",")
      : null,
    routes: routes(o, { type: o.s_type, name: o.s_name, name_ar: o.s_name_ar }),
  }));

  const routed = decided.filter((r) => r.routes);
  console.log(`scanned ${decided.length} active service orders — ${routed.length} route into the Kosha Portal`);
  console.table(routed.slice(0, 40));

  // 3) The bug this fix addresses: routed rows that sat outside the old cap.
  line("4. Bookings the OLD 150-row cap would have hidden");
  const lostToCap = routed.filter((r) => r.rank > 150);
  if (lostToCap.length === 0) {
    console.log("None — every routed booking is inside the newest 150 service orders.");
    console.log("(The cap bug only bites once older sound bookings fall past rank 150.)");
  } else {
    console.log(`${lostToCap.length} routed booking(s) sat past rank 150 and were INVISIBLE in the portal before this fix:`);
    console.table(lostToCap);
  }

  line("5. Summary");
  console.log(`active service orders scanned : ${decided.length}`);
  console.log(`routed into Kosha Portal      : ${routed.length}`);
  console.log(`hidden by the old 150 cap     : ${lostToCap.length}`);
  console.log(`sound-typed services found    : ${types.filter((t) => matches(t.type)).map((t) => t.type).join(", ") || "none"}`);
} catch (err) {
  console.error("\nQuery failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
