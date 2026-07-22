// Verifies the kosha execution pipeline, equipment checklist and damage gate. No DB.
// Run: node scripts/verify-kosha-operations.mjs
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { build } = require("../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js");

const bundle = await build({
  entryPoints: ["src/server/kosha-operations.ts"],
  bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
});
const outFile = join(mkdtempSync(join(tmpdir(), "ajn-kosha-")), "kosha.mjs");
writeFileSync(outFile, bundle.outputFiles[0].text);

const {
  KOSHA_STAGES, LEGACY_KOSHA_STAGES, KOSHA_CHECKLIST_ITEMS,
  koshaStageRank, evaluateKoshaStage, checklistCovered, blockingChecklistIssues,
  scanPointForStage, validateDamageReport, damageNeedsManagerApproval,
} = await import(pathToFileURL(outFile).href);

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`✗ ${name}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`); }
  else console.log(`✓ ${name}`);
};

const full = KOSHA_CHECKLIST_ITEMS.map((item) => ({ item, condition: "available" }));
const partial = full.slice(0, 5);
const withIssue = full.map((e) => (e.item === "lighting" ? { ...e, condition: "damaged" } : e));

// ── The pipeline extends, never replaces ──
check("11 stages", KOSHA_STAGES.length, 11);
check("every legacy key survives",
  LEGACY_KOSHA_STAGES.filter((s) => !KOSHA_STAGES.includes(s)), []);
check("legacy keys keep their relative order",
  LEGACY_KOSHA_STAGES.map(koshaStageRank),
  [...LEGACY_KOSHA_STAGES.map(koshaStageRank)].sort((a, b) => a - b));
check("an unknown stored stage ranks 0 instead of throwing", koshaStageRank("nonsense"), 0);

// ── Legacy adjacency must keep working (the regression this caught) ──
const go = (from, to, extra = {}) =>
  evaluateKoshaStage({ from, to, isManager: false, checklist: full, damageAnswered: true, ...extra });

check("legacy preparing → out_of_warehouse still allowed", go("preparing", "out_of_warehouse").ok, true);
check("legacy out_of_warehouse → on_the_way still allowed", go("out_of_warehouse", "on_the_way").ok, true);
check("legacy executing → executed still allowed", go("executing", "executed").ok, true);
check("legacy executed → delivered still allowed", go("executed", "delivered").ok, true);

// ── New stages work too ──
check("booked → preparing", go("booked", "preparing").ok, true);
check("preparing → ready", go("preparing", "ready").ok, true);
check("ready → out_of_warehouse", go("ready", "out_of_warehouse").ok, true);
check("executed → event_running", go("executed", "event_running").ok, true);
check("event_running → dismantling", go("event_running", "dismantling").ok, true);
check("dismantling → returned", go("dismantling", "returned").ok, true);
check("returned → delivered", go("returned", "delivered").ok, true);

// ── Illegal moves ──
check("cannot skip several stages", go("booked", "on_the_way").ok, false);
check("skipping returns 409", go("booked", "on_the_way").status, 409);
check("same stage refused", go("preparing", "preparing").status, 409);
check("unknown target refused", go("preparing", "teleport").status, 400);
check("crew cannot rewind", go("on_the_way", "out_of_warehouse").ok, false);
check("rewind refusal is 403", go("on_the_way", "out_of_warehouse").status, 403);
check("manager can rewind",
  evaluateKoshaStage({ from: "on_the_way", to: "out_of_warehouse", isManager: true }).ok, true);
check("rewind is flagged",
  evaluateKoshaStage({ from: "on_the_way", to: "out_of_warehouse", isManager: true }).backward, true);

// ── Checklist gate on dispatch ──
check("full checklist is covered", checklistCovered(full), true);
check("partial checklist is not covered", checklistCovered(partial), false);
check("dispatch blocked on an incomplete checklist",
  go("ready", "out_of_warehouse", { checklist: partial }).status, 422);
check("dispatch blocked when an item is damaged",
  go("ready", "out_of_warehouse", { checklist: withIssue }).status, 422);
check("the blocking item is named",
  go("ready", "out_of_warehouse", { checklist: withIssue }).reason.includes("الإضاءة"), true);
check("a manager cannot bypass the checklist either",
  evaluateKoshaStage({ from: "ready", to: "out_of_warehouse", isManager: true, checklist: partial }).ok, false);
check("issues are enumerated",
  blockingChecklistIssues(withIssue).map((e) => e.item), ["lighting"]);
check("a clean checklist has no issues", blockingChecklistIssues(full), []);
check("missing and needs_maintenance both block",
  blockingChecklistIssues([
    { item: "chairs", condition: "missing" },
    { item: "carpet", condition: "needs_maintenance" },
    { item: "tables", condition: "available" },
  ]).map((e) => e.item), ["chairs", "carpet"]);
// The gate is on dispatch only — it must not block earlier stages.
check("an empty checklist does not block preparing", go("booked", "preparing", { checklist: [] }).ok, true);

// ── Damage gate on closing ──
check("closing blocked while damage is unanswered",
  go("returned", "delivered", { damageAnswered: false }).status, 422);
check("closing allowed once answered", go("returned", "delivered", { damageAnswered: true }).ok, true);
// Legacy rows never went through the damage question; omitting the flag must not lock them.
check("an omitted damage flag does not block legacy closing",
  evaluateKoshaStage({ from: "executed", to: "delivered", isManager: false }).ok, true);

// ── Scan points ──
check("loading scans warehouse out", scanPointForStage("out_of_warehouse"), "warehouse_out");
check("departure scans the vehicle load", scanPointForStage("on_the_way"), "vehicle_load");
check("installing scans installation", scanPointForStage("executing"), "installation");
check("dismantling scans the return", scanPointForStage("dismantling"), "return");
check("arriving back scans warehouse in", scanPointForStage("returned"), "warehouse_in");
check("stages without scanning return null",
  [scanPointForStage("booked"), scanPointForStage("delivered")], [null, null]);

// ── Damage report validation ──
const ok = (draft) => validateDamageReport(draft);
check("a valid report passes",
  ok({ productId: 5, description: "انكسرت قاعدة الإطار", priority: "low" }).ok, true);
check("an asset is required", ok({ description: "وصف كافٍ هنا" }).ok, false);
check("a too-short description is rejected",
  ok({ productId: 5, description: "كسر" }).ok, false);
check("priority defaults to medium",
  ok({ productId: 5, description: "وصف كافٍ هنا" }).value.priority, "medium");
check("an unknown priority falls back to medium",
  ok({ productId: 5, description: "وصف كافٍ هنا", priority: "urgent" }).value.priority, "medium");
check("high severity requires a responsible person",
  ok({ productId: 5, description: "وصف كافٍ هنا", priority: "high" }).ok, false);
check("high severity passes once named",
  ok({ productId: 5, description: "وصف كافٍ هنا", priority: "high", responsibleStaffId: 7 }).ok, true);
check("negative cost is discarded",
  ok({ productId: 5, description: "وصف كافٍ هنا", costEstimate: -50 }).value.costEstimate, 0);
check("junk cost is discarded",
  ok({ productId: 5, description: "وصف كافٍ هنا", costEstimate: "abc" }).value.costEstimate, 0);
check("cost is rounded",
  ok({ productId: 5, description: "وصف كافٍ هنا", costEstimate: 12500.7 }).value.costEstimate, 12501);
check("a blank photo becomes null",
  ok({ productId: 5, description: "وصف كافٍ هنا", photoUrl: "   " }).value.photoUrl, null);

check("costed damage needs manager approval", damageNeedsManagerApproval("low", 5000), true);
check("critical damage needs manager approval", damageNeedsManagerApproval("critical", 0), true);
check("a zero-cost low report does not", damageNeedsManagerApproval("low", 0), false);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
