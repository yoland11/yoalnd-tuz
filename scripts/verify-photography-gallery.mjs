// Verifies client-gallery access control and the operational alert engine. No DB.
// Run: node scripts/verify-photography-gallery.mjs
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { build } = require("../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js");

const bundle = await build({
  entryPoints: ["src/server/photography-gallery.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  external: ["node:crypto"],
});
const outFile = join(mkdtempSync(join(tmpdir(), "ajn-gal-")), "gallery.mjs");
writeFileSync(outFile, bundle.outputFiles[0].text);

const {
  newGallerySlug, hashGalleryPassword, verifyGalleryPassword,
  evaluateGalleryAccess, galleryShareUrl, deriveOperationalAlerts,
} = await import(pathToFileURL(outFile).href);

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`✗ ${name}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`); }
  else console.log(`✓ ${name}`);
};

// ── Slugs + passwords ──
const slugs = new Set(Array.from({ length: 500 }, () => newGallerySlug()));
check("slugs are 24 hex chars", /^[0-9a-f]{24}$/.test(newGallerySlug()), true);
check("500 slugs are all distinct", slugs.size, 500);

const { hash, salt } = hashGalleryPassword("Sirr-1234");
check("correct password verifies", verifyGalleryPassword("Sirr-1234", hash, salt), true);
check("wrong password rejected", verifyGalleryPassword("Sirr-1235", hash, salt), false);
check("empty password rejected", verifyGalleryPassword("", hash, salt), false);
check("missing hash rejected", verifyGalleryPassword("Sirr-1234", null, salt), false);
check("missing salt rejected", verifyGalleryPassword("Sirr-1234", hash, null), false);
check("a different salt yields a different hash",
  hashGalleryPassword("Sirr-1234").hash === hash, false);
check("password is not recoverable from the hash", hash.includes("Sirr"), false);

// ── Access rules ──
const open = { isActive: true, expiresAt: null, passwordHash: null, passwordSalt: null, suppliedPassword: null };
check("an open, active gallery is visible", evaluateGalleryAccess(open).ok, true);

check("a disabled gallery is refused",
  evaluateGalleryAccess({ ...open, isActive: false }).status, 403);
check("a disabled gallery does not prompt for a password",
  evaluateGalleryAccess({ ...open, isActive: false, passwordHash: hash, passwordSalt: salt }).needsPassword, false);

const past = new Date("2020-01-01T00:00:00Z");
const future = new Date("2099-01-01T00:00:00Z");
check("an expired gallery returns 410",
  evaluateGalleryAccess({ ...open, expiresAt: past }).status, 410);
check("a future expiry still allows access",
  evaluateGalleryAccess({ ...open, expiresAt: future }).ok, true);
check("expiry is evaluated before the password",
  evaluateGalleryAccess({ ...open, expiresAt: past, passwordHash: hash, passwordSalt: salt, suppliedPassword: "Sirr-1234" }).status, 410);
check("an expiry exactly now is expired",
  evaluateGalleryAccess({ ...open, expiresAt: new Date("2026-07-22T10:00:00Z"), now: new Date("2026-07-22T10:00:00Z") }).status, 410);
check("a malformed expiry does not lock everyone out",
  evaluateGalleryAccess({ ...open, expiresAt: "not-a-date" }).ok, true);

const locked = { ...open, passwordHash: hash, passwordSalt: salt };
check("a protected gallery prompts, not errors",
  evaluateGalleryAccess(locked).needsPassword, true);
check("prompting uses 401", evaluateGalleryAccess(locked).status, 401);
check("the right password opens it",
  evaluateGalleryAccess({ ...locked, suppliedPassword: "Sirr-1234" }).ok, true);
check("the wrong password is refused",
  evaluateGalleryAccess({ ...locked, suppliedPassword: "nope" }).ok, false);
check("a wrong password still reports needsPassword",
  evaluateGalleryAccess({ ...locked, suppliedPassword: "nope" }).needsPassword, true);

check("share url is built cleanly",
  galleryShareUrl("https://ajn.example.com/", "abc123"), "https://ajn.example.com/gallery/abc123");
check("share url tolerates a missing trailing slash",
  galleryShareUrl("https://ajn.example.com", "abc123"), "https://ajn.example.com/gallery/abc123");

// ── Operational alerts ──
const now = new Date("2026-07-22T10:00:00Z");
const baseShoot = {
  id: 1, eventId: 11, stage: "assigned", eventDate: "2026-07-23", eventTime: "18:00",
  customerName: "علي", clientToken: "tok1", checkedOutAssets: 0,
};
const types = (input) => deriveOperationalAlerts({ now, cards: [], editProjects: [], ...input }).map((a) => a.type).sort();

check("a shoot tomorrow with no prep raises an upcoming alert",
  types({ shoots: [baseShoot] }), ["photography_upcoming_shoot"]);
check("a shoot two weeks out is quiet",
  types({ shoots: [{ ...baseShoot, eventDate: "2026-08-10" }] }), []);
check("a shoot already being prepared is quiet",
  types({ shoots: [{ ...baseShoot, stage: "preparing" }] }), []);
check("a shoot in progress raises nothing",
  types({ shoots: [{ ...baseShoot, stage: "shooting", eventDate: "2026-07-22", eventTime: "08:00" }] }), []);

check("a photographer late past the start is critical",
  types({ shoots: [{ ...baseShoot, eventDate: "2026-07-22", eventTime: "08:00" }] }),
  ["photography_late_arrival"]);
check("late arrival is flagged critical",
  deriveOperationalAlerts({ now, cards: [], editProjects: [],
    shoots: [{ ...baseShoot, eventDate: "2026-07-22", eventTime: "08:00" }] })[0].severity, "critical");
check("arrived on site is never late",
  types({ shoots: [{ ...baseShoot, stage: "arrived", eventDate: "2026-07-22", eventTime: "08:00" }] }), []);
check("a shoot with no time cannot be late",
  types({ shoots: [{ ...baseShoot, eventDate: "2026-07-22", eventTime: null }] }), []);

check("completed shoot with kit still out",
  types({ shoots: [{ ...baseShoot, stage: "completed", eventDate: "2026-07-01", checkedOutAssets: 3 }] }),
  ["photography_equipment_unreturned"]);
check("completed shoot with everything returned is quiet",
  types({ shoots: [{ ...baseShoot, stage: "completed", eventDate: "2026-07-01" }] }), []);

check("a full card is flagged",
  types({ shoots: [], cards: [{ id: 5, label: "SanDisk", status: "full", shootId: null }] }),
  ["photography_card_full"]);
check("a damaged card is critical",
  types({ shoots: [], cards: [{ id: 5, label: "SanDisk", status: "damaged", shootId: null }] }),
  ["photography_card_damaged"]);
check("an available card is quiet",
  types({ shoots: [], cards: [{ id: 5, label: "SanDisk", status: "available", shootId: null }] }), []);

const overdue = { id: 9, shootId: 1, status: "editing", dueDate: "2026-07-01", customerName: "علي", clientToken: "tok1" };
check("overdue editing is flagged",
  types({ shoots: [], editProjects: [overdue] }), ["photography_editing_overdue"]);
check("delivered work is never overdue",
  types({ shoots: [], editProjects: [{ ...overdue, status: "delivered" }] }), []);
check("editing without a due date is quiet",
  types({ shoots: [], editProjects: [{ ...overdue, dueDate: null }] }), []);
check("a future due date is quiet",
  types({ shoots: [], editProjects: [{ ...overdue, dueDate: "2026-12-01" }] }), []);

check("every alert carries a dedupe key",
  deriveOperationalAlerts({ now, cards: [{ id: 5, label: "X", status: "full", shootId: null }],
    editProjects: [overdue], shoots: [baseShoot] })
    .every((a) => a.type && a.entityType && Number.isFinite(a.entityId)), true);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
