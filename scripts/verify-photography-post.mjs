// Verifies the post-production rules (edit room, memory cards, media ledger) with no DB.
// Run: node scripts/verify-photography-post.mjs
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { build } = require("../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js");

const bundle = await build({
  entryPoints: ["src/server/photography-post.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  alias: { "@workspace/db": "./lib/db/src/schema/index.ts" },
});
const outFile = join(mkdtempSync(join(tmpdir(), "ajn-post-")), "post.mjs");
writeFileSync(outFile, bundle.outputFiles[0].text);

const {
  evaluateEditTransition, editTimestamps, shootStageForEditStatus,
  evaluateCardTransition, cardTimestamps,
  formatBytes, parseCount, parseBytes, summarizeMedia,
  turnaroundHours, averageOf,
} = await import(pathToFileURL(outFile).href);

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`✗ ${name}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`); }
  else console.log(`✓ ${name}`);
};

// ── Edit-room pipeline ──
const editable = { hasEditor: true, isManager: false };
check("waiting → copying_files needs an editor",
  evaluateEditTransition({ from: "waiting", to: "copying_files", hasEditor: false, isManager: false }).status, 422);
check("with an editor, work may start",
  evaluateEditTransition({ from: "waiting", to: "copying_files", ...editable }).ok, true);
check("a manager still cannot start an unassigned project",
  evaluateEditTransition({ from: "waiting", to: "copying_files", hasEditor: false, isManager: true }).ok, false);
check("editing → color_correction allowed",
  evaluateEditTransition({ from: "editing", to: "color_correction", ...editable }).ok, true);
check("cannot skip color correction",
  evaluateEditTransition({ from: "editing", to: "exporting", ...editable }).status, 409);
check("editor cannot sign off their own QC",
  evaluateEditTransition({ from: "quality_check", to: "ready", ...editable }).status, 403);
check("manager signs off QC",
  evaluateEditTransition({ from: "quality_check", to: "ready", hasEditor: true, isManager: true }).ok, true);
check("editor may deliver an approved project",
  evaluateEditTransition({ from: "ready", to: "delivered", ...editable }).ok, true);
check("delivered is terminal",
  evaluateEditTransition({ from: "delivered", to: "ready", ...editable }).ok, false);
check("editor cannot rewind",
  evaluateEditTransition({ from: "exporting", to: "editing", ...editable }).status, 403);
check("manager can rewind",
  evaluateEditTransition({ from: "exporting", to: "editing", hasEditor: true, isManager: true }).backward, true);
check("unknown status rejected",
  evaluateEditTransition({ from: "editing", to: "rendering", ...editable }).status, 400);
check("same status rejected",
  evaluateEditTransition({ from: "editing", to: "editing", ...editable }).status, 409);

const now = new Date("2026-07-22T12:00:00Z");
check("copying stamps startedAt", Object.keys(editTimestamps("copying_files", now)), ["startedAt"]);
check("ready stamps readyAt", Object.keys(editTimestamps("ready", now)), ["readyAt"]);
check("editing stamps nothing", editTimestamps("editing", now), {});

// ── Edit status drives the shoot stage ──
check("ready lifts the shoot to review", shootStageForEditStatus("ready"), "ready_for_review");
check("delivered lifts the shoot to delivered", shootStageForEditStatus("delivered"), "delivered");
check("mid-pipeline leaves the shoot alone", shootStageForEditStatus("exporting"), null);

// The auto-sync must never rewind a shoot: api.ts gates it on stageIndex, so assert the
// ordering that gate depends on.
const SHOOT_ORDER = ["assigned","preparing","on_the_way","arrived","shooting",
  "uploading","editing","ready_for_review","delivered","completed"];
const idx = (s) => SHOOT_ORDER.indexOf(s);
check("ready_for_review sits before delivered", idx("ready_for_review") < idx("delivered"), true);
check("a completed shoot is past ready_for_review",
  idx(shootStageForEditStatus("ready")) < idx("completed"), true);
check("a delivered shoot is not moved by edit status 'delivered'",
  idx(shootStageForEditStatus("delivered")) > idx("delivered"), false);

// ── Memory cards ──
check("available → assigned", evaluateCardTransition({ from: "available", to: "assigned", isManager: false }).ok, true);
check("cannot jump available → delivered",
  evaluateCardTransition({ from: "available", to: "delivered", isManager: false }).status, 409);
check("assigned → full → copying → delivered → returned all legal", [
  evaluateCardTransition({ from: "assigned", to: "full", isManager: false }).ok,
  evaluateCardTransition({ from: "full", to: "copying", isManager: false }).ok,
  evaluateCardTransition({ from: "copying", to: "delivered", isManager: false }).ok,
  evaluateCardTransition({ from: "delivered", to: "returned", isManager: false }).ok,
], [true, true, true, true]);
check("returned card can be reissued",
  evaluateCardTransition({ from: "returned", to: "assigned", isManager: false }).ok, true);
check("damage is reachable mid-flight",
  evaluateCardTransition({ from: "copying", to: "damaged", isManager: false }).ok, true);
check("reviving a damaged card needs a manager",
  evaluateCardTransition({ from: "damaged", to: "available", isManager: false }).status, 403);
check("a manager can revive it",
  evaluateCardTransition({ from: "damaged", to: "available", isManager: true }).ok, true);
check("unknown card status rejected",
  evaluateCardTransition({ from: "available", to: "melted", isManager: true }).status, 400);
check("copying stamps copiedAt", Object.keys(cardTimestamps("copying", now)), ["copiedAt"]);
check("returned stamps returnedAt", Object.keys(cardTimestamps("returned", now)), ["returnedAt"]);

// ── Media ledger ──
check("negative counts clamp to zero", parseCount(-5), 0);
check("fractional counts floor", parseCount(12.9), 12);
check("junk counts become zero", parseCount("abc"), 0);
check("counts are capped", parseCount(9e9), 1_000_000);
check("negative bytes clamp", parseBytes(-1), 0);
check("bytes are capped at 1 PB", parseBytes(9e18), 1_125_899_906_842_624);
check("bytes format", [formatBytes(0), formatBytes(512), formatBytes(1024), formatBytes(1610612736)],
  ["0 B", "512 B", "1.0 KB", "1.5 GB"]);

const totals = summarizeMedia([
  { kind: "raw", fileCount: 800, totalBytes: 32_000_000_000 },
  { kind: "video", fileCount: 12, totalBytes: 48_000_000_000 },
  { kind: "raw", fileCount: 200, totalBytes: 8_000_000_000 },
  { kind: "bogus", fileCount: 999, totalBytes: 999 },
]);
check("raw batches accumulate", totals.byKind.raw, { files: 1000, bytes: 40_000_000_000 });
check("unknown kinds are ignored", totals.files, 1012);
check("totals sum across kinds", totals.bytes, 88_000_000_000);
check("untouched kinds stay zero", totals.byKind.drone, { files: 0, bytes: 0 });

// ── Turnaround ──
check("turnaround in hours",
  turnaroundHours("2026-07-20T08:00:00Z", "2026-07-21T20:00:00Z"), 36);
check("missing endpoint → null", turnaroundHours("2026-07-20T08:00:00Z", null), null);
check("reversed clock collapses to 0",
  turnaroundHours("2026-07-21T20:00:00Z", "2026-07-20T08:00:00Z"), 0);
check("invalid date → null", turnaroundHours("not-a-date", "2026-07-21T20:00:00Z"), null);
check("average skips nulls", averageOf([10, null, 20, null]), 15);
check("average of nothing is null", averageOf([null, null]), null);
check("average rounds to 1dp", averageOf([1, 2, 2]), 1.7);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
