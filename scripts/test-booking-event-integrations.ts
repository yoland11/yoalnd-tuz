import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import ts from "typescript";
import vm from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { recordOccasionFollowups } from "../src/server/event-followup-operations";
import { followupOccasion, suggestedFollowupServices } from "../src/server/customer-followups-rules";

for (const value of ["henna", "حنة", "حنه"]) {
  assert.equal(followupOccasion(value), "henna");
  assert.deepEqual(suggestedFollowupServices({ eventType: value, departments: [] }), ["wedding"]);
}
for (const value of ["birthday", "عيد ميلاد", "other", "أخرى", "custom historical occasion", null]) {
  assert.equal(followupOccasion(value), null);
  assert.deepEqual(suggestedFollowupServices({ eventType: value, departments: [] }), []);
}

const dialect = new PgDialect();
async function scenario(eventType: unknown, options: { source?: "service" | "kosha"; blocked?: boolean; existing?: "open" | "converted" | "uninterested"; failAudit?: boolean } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const inserted = new Map<string, number>();
  const audits: string[] = [];
  const tx = { async execute(statement: any) {
    const query = dialect.sqlToQuery(statement);
    const text = query.sql.replace(/\s+/g, " ").trim();
    calls.push({ sql: text, params: query.params });
    if (text.includes("information_schema.columns")) return { rows: [{ ready: true }] };
    if (text.startsWith("SELECT id,customer_id")) return { rows: [{ id: 42, customer_id: 8, event_type: eventType }] };
    if (text.startsWith("SELECT c.id FROM customers")) {
      assert.match(text, /contact_blocked=true/);
      assert.match(text, /FOR UPDATE OF c/);
      return { rows: options.blocked ? [] : [{ id: 8 }] };
    }
    if (text.startsWith("SELECT id FROM staff")) return { rows: [{ id: 3 }] };
    if (text.startsWith("INSERT INTO customer_followups(")) {
      assert.match(text, /f.status IN \('converted','uninterested'\) OR f.completed_at IS NULL/);
      assert.match(text, /ON CONFLICT DO NOTHING RETURNING id/);
      const service = String(query.params[1]);
      const token = query.params.find(value => typeof value === "string" && value.startsWith("auto:")) as string;
      assert.equal(token, `auto:${options.source ?? "service"}:42:${service}`);
      if (options.existing || inserted.has(token)) return { rows: [] };
      const id = inserted.size + 1; inserted.set(token, id);
      return { rows: [{ id }] };
    }
    if (text.startsWith("INSERT INTO customer_followup_events")) {
      if (options.failAudit) throw new Error("followup audit unavailable");
      audits.push(text);
      return { rows: [{ id: audits.length }] };
    }
    throw new Error(`Unexpected controlled SQL: ${text}`);
  } };
  const input = { source: options.source ?? "service", id: 42, staffId: 3 };
  const first = await recordOccasionFollowups(tx as any, input);
  const retry = await recordOccasionFollowups(tx as any, input);
  return { first, retry, calls, inserted, audits };
}

for (const value of ["engagement", "خطوبة"]) {
  const result = await scenario(value);
  assert.equal(result.first.created, 2);
  assert.equal(result.retry.created, 0);
  assert.equal(result.audits.length, 2);
}
for (const value of ["henna", "حنة"]) {
  const result = await scenario(value);
  assert.equal(result.first.created, 1);
  assert.deepEqual([...result.inserted.keys()], ["auto:service:42:wedding"]);
  assert.equal(result.retry.created, 0);
}
for (const existing of ["open", "converted", "uninterested"] as const) assert.equal((await scenario("henna", { existing })).first.created, 0);
assert.deepEqual([...(await scenario("حنة", { source: "kosha" })).inserted.keys()], ["auto:kosha:42:wedding"]);
assert.equal((await scenario("henna", { blocked: true })).first.status, "contact_blocked");
assert.equal((await scenario("henna", { blocked: true })).inserted.size, 0);
for (const value of ["birthday", "other", "graduation", null]) assert.equal((await scenario(value)).first.status, "not_applicable");
await assert.rejects(scenario("henna", { failAudit: true }), /followup audit unavailable/);

const operations = readFileSync("src/server/event-followup-operations.ts", "utf8");
const sweep = operations.slice(operations.indexOf("export async function sweepOccasionFollowups"));
assert.match(sweep, /created_at>=now\(\)-interval '7 days'/);
assert.match(sweep, /ORDER BY id DESC LIMIT 40/);
assert.match(sweep, /'henna','حنة','حنه'/);

const graduation = readFileSync("src/views/admin/graduation.tsx", "utf8");
const ast = ts.createSourceFile("graduation.tsx", graduation, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const queryFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "initialGraduationOrderId");
assert.ok(queryFunction, "existing graduation list needs a real stable-order query parser");
const sandbox = { exports: {} as any, URLSearchParams };
vm.runInNewContext(ts.transpileModule(`exports.read=${queryFunction.getText(ast)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
assert.equal(sandbox.exports.read("?order=75"), 75);
assert.equal(sandbox.exports.read("?status=ready&order=19&search=graduate"), 19);
for (const query of ["", "?order=0", "?order=-1", "?order=1.5", "?order=abc", "?order=2147483648", "?order=9007199254740992", "?id=75"]) assert.equal(sandbox.exports.read(query), null);
assert.match(graduation, /useState<number \| null>\(initialGraduationOrderId\)/);
assert.match(graduation, /تعذر فتح طلب التخرج/);
assert.match(graduation, /refetch\(\)/);
const detailFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "OrderDetail");
assert.ok(detailFunction);
const wrapper = ({ children }: { children?: React.ReactNode }) => React.createElement("div", {}, children);
for (const mode of ["error", "empty", "loading"] as const) {
  const context: any = {
    exports: {}, React, useToast: () => ({ toast() {} }), useQueryClient: () => ({}),
    useQuery: (input: any) => input.queryKey[2] === "order" ? { data: mode === "empty" ? {} : undefined, isLoading: mode === "loading", error: mode === "error" ? new Error("تعذر الوصول · REQ-graduation-link") : null, refetch() {} } : { data: [] },
    useState: () => [{}, () => {}], useMutation: () => ({}),
    Dialog: wrapper, DialogContent: wrapper, DialogHeader: wrapper, DialogTitle: wrapper, DialogDescription: wrapper, Button: wrapper,
    RefreshCw: () => null, Skeleton: () => React.createElement("span", {}, "loading-fixture"), apiErrorMessage: (error: Error) => error.message,
  };
  vm.runInNewContext(ts.transpileModule(`exports.Component=${detailFunction.getText(ast)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, context);
  const markup = renderToStaticMarkup(React.createElement(context.exports.Component, { id: 75, onClose() {} }));
  if (mode === "loading") assert.match(markup, /loading-fixture/);
  else {
    assert.match(markup, /تعذر فتح طلب التخرج/);
    assert.match(markup, /إعادة المحاولة/);
    assert.doesNotMatch(markup, /loading-fixture/);
    if (mode === "error") assert.match(markup, /REQ-graduation-link/);
    else assert.match(markup, /استجابة طلب التخرج غير مكتملة/);
  }
}
console.log("PASS existing occasion integrations: engagement/henna chain, original durable retry/contact/audit safeguards, no birthday/other inference and authorized graduation-order query selection");
