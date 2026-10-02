// Verifies the field-shoot lifecycle rules without touching the database.
// Run: node scripts/verify-shoot-lifecycle.mjs
// The module imports its stage/checklist constants from @workspace/db, which plain node
// cannot resolve, so bundle it in-memory with esbuild first.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// esbuild is present as a transitive dependency only; locate the version installed by pnpm.
const require = createRequire(import.meta.url);
const pnpmStore = join(process.cwd(), "node_modules", ".pnpm");
const esbuildPackage = readdirSync(pnpmStore).find((name) => name.startsWith("esbuild@"));
if (!esbuildPackage) throw new Error("esbuild is not installed in the pnpm store");
const { build } = require(join(pnpmStore, esbuildPackage, "node_modules", "esbuild", "lib", "main.js"));

const bundle = await build({
  entryPoints: ["src/server/photography-shoots.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  alias: { "@workspace/db": "./lib/db/src/schema/index.ts" },
});
const outFile = join(mkdtempSync(join(tmpdir(), "ajn-shoot-")), "shoots.mjs");
writeFileSync(outFile, bundle.outputFiles[0].text);

const {
  evaluateTransition,
  checklistComplete,
  missingChecklistItems,
  mapsLink,
  parseCoordinate,
  stageTimestamps,
  normalizeShootStage,
  isPhotographyWorkflowStageEnabled,
} = await import(pathToFileURL(outFile).href);

const FULL = Object.fromEntries(
  ["camera_ready","lens_cleaned","batteries_charged","cards_empty","mic_working",
   "flash_working","gimbal_calibrated","drone_ready","tripod_packed"].map((k) => [k, true]),
);
const PARTIAL = { ...FULL, drone_ready: false };

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`✗ ${name}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`); }
  else console.log(`✓ ${name}`);
};

// ── The checklist gate ──
check("incomplete checklist blocks departure",
  evaluateTransition({ from: "waiting_event", to: "on_the_way", checklist: PARTIAL, isManager: false }).ok, false);
check("gate returns 422",
  evaluateTransition({ from: "waiting_event", to: "on_the_way", checklist: PARTIAL, isManager: false }).status, 422);
check("complete checklist allows departure",
  evaluateTransition({ from: "waiting_event", to: "on_the_way", checklist: FULL, isManager: false }).ok, true);
check("a manager cannot bypass the checklist either",
  evaluateTransition({ from: "waiting_event", to: "on_the_way", checklist: PARTIAL, isManager: true }).ok, false);
check("missing items are named", missingChecklistItems(PARTIAL), ["drone_ready"]);
check("empty checklist is incomplete", checklistComplete({}), false);
check("non-object checklist is incomplete", checklistComplete(null), false);
check("truthy-but-not-true values do not count", checklistComplete({ ...FULL, camera_ready: "yes" }), false);

// ── Forward transitions ──
check("assigned → preparing allowed",
  evaluateTransition({ from: "awaiting_assignment", to: "crew_assigned", checklist: {}, isManager: false }).ok, true);
check("cannot skip stages",
  evaluateTransition({ from: "awaiting_assignment", to: "shooting", checklist: FULL, isManager: false }).ok, false);
check("skipping returns 409",
  evaluateTransition({ from: "awaiting_assignment", to: "shooting", checklist: FULL, isManager: false }).status, 409);
check("same stage refused",
  evaluateTransition({ from: "shooting", to: "shooting", checklist: FULL, isManager: false }).ok, false);
check("unknown stage refused",
  evaluateTransition({ from: "shooting", to: "teleporting", checklist: FULL, isManager: false }).status, 400);
check("completed is terminal",
  evaluateTransition({ from: "completed", to: "delivered", checklist: FULL, isManager: false }).ok, false);

// ── Backward transitions are manager-only ──
check("photographer cannot rewind",
  evaluateTransition({ from: "shooting", to: "on_the_way", checklist: FULL, isManager: false }).ok, false);
check("rewind refusal is 403",
  evaluateTransition({ from: "shooting", to: "on_the_way", checklist: FULL, isManager: false }).status, 403);
check("manager can rewind",
  evaluateTransition({ from: "shooting", to: "on_the_way", checklist: FULL, isManager: true }).ok, true);
check("rewind is flagged backward",
  evaluateTransition({ from: "shooting", to: "on_the_way", checklist: FULL, isManager: true }).backward, true);
check("manager rewind past the gate is allowed",
  evaluateTransition({ from: "arrived", to: "waiting_event", checklist: PARTIAL, isManager: true }).ok, true);

// ── Milestones ──
check("legacy assigned stage remains readable", normalizeShootStage("assigned"), "crew_assigned");
check("legacy uploading stage remains readable", normalizeShootStage("uploading"), "processing_files");
check(
  "legacy workflow setting enables its current processing stage",
  isPhotographyWorkflowStageEnabled(["shoot_ended", "files_received", "editing"], "processing_files"),
  true,
);
check(
  "legacy workflow setting enables its current review stage",
  isPhotographyWorkflowStageEnabled(["customer_review", "revising", "ready_print"], "review_and_edit"),
  true,
);
check(
  "explicitly disabled workflow stage remains disabled",
  isPhotographyWorkflowStageEnabled(["shooting", "printing"], "processing_files"),
  false,
);
check(
  "empty workflow settings preserve the all-stages-enabled default",
  isPhotographyWorkflowStageEnabled([], "processing_files"),
  true,
);
const now = new Date("2026-07-22T10:00:00Z");
check("departure stamps departedAt", Object.keys(stageTimestamps("on_the_way", now)), ["departedAt"]);
check("starting the shoot stamps its start time", Object.keys(stageTimestamps("shooting", now)), ["shootingStartedAt"]);
check("processing files closes the shooting window", Object.keys(stageTimestamps("processing_files", now)), ["shootingEndedAt"]);
check("waiting stamps nothing", stageTimestamps("waiting_event", now), {});

// ── Maps + coordinates ──
check("coordinates win over venue text",
  mapsLink(33.3152, 44.3661, "بغداد"), "https://www.google.com/maps/search/?api=1&query=33.3152,44.3661");
check("0,0 is treated as absent, falls back to venue",
  mapsLink(0, 0, "كربلاء"), "https://www.google.com/maps/search/?api=1&query=%D9%83%D8%B1%D8%A8%D9%84%D8%A7%D8%A1");
check("no coordinates and no venue → null", mapsLink(null, null, null), null);
check("latitude out of range rejected", parseCoordinate(91, "lat"), null);
check("longitude 180 accepted", parseCoordinate(180, "lng"), 180);
check("longitude 181 rejected", parseCoordinate(181, "lng"), null);
check("empty string is null not zero", parseCoordinate("", "lat"), null);
check("NaN rejected", parseCoordinate("abc", "lat"), null);
check("negative coordinate accepted", parseCoordinate(-33.9, "lat"), -33.9);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
