import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render the actual page, replacing only context/network hooks and UI shells.
// The query result is the external boundary; no fetch or database is invoked.
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync("src/views/admin/simple-salaries.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const row = { id: 31, employeeId: 9, employeeName: "موظف معروف", username: "employee", department: "إدارة", month: "2026-11", baseSalary: 198765, bonus: 0, deduction: 0, netSalary: 198765, paymentStatus: "unpaid" };
const empty = { rows: [], staff: [], history: [], totals: { count: 0, base: 0, bonus: 0, deduction: 0, net: 0 } };
const data = { ...empty, rows: [row], totals: { count: 1, base: 198765, bonus: 0, deduction: 0, net: 198765 } };
const failure = Object.assign(new Error("تعذر قراءة بيانات الرواتب"), { code: "DATABASE_ERROR", requestId: "REQ-salary-load" });
function render(query: any, history: any = { isSuccess: true, data: empty }, historyOpen = false) {
  let stateIndex = 0, retried = 0;
  const actions: Array<{ children: React.ReactNode; onClick?: () => void }> = [];
  const shell = (tag: string) => ({ children }: any) => React.createElement(tag, {}, children);
  const ctx: any = { exports: {}, require: (id: string) => {
    if (id === "react") return { ...React, useMemo: (fn: () => any) => fn(), useState: (initial: any) => [++stateIndex === 8 && historyOpen ? row : typeof initial === "function" ? initial() : initial, () => {}] };
    if (id === "@tanstack/react-query") return { useQuery: (options: any) => ({ isLoading: false, isFetching: false, refetch: () => { retried++; }, ...(options.queryKey[0] === "simple-salaries" ? query : history) }), useQueryClient: () => ({}), useMutation: () => ({ isPending: false }) };
    if (id === "@/components/ui/button") return { Button: ({ children, onClick, ...props }: any) => { actions.push({ children, onClick }); return React.createElement("button", { disabled: props.disabled }, children); } };
    if (id === "@/components/ui/dialog") return { Dialog: ({ open, children }: any) => open ? React.createElement("div", {}, children) : null, DialogContent: shell("section"), DialogFooter: shell("footer"), DialogHeader: shell("header"), DialogTitle: shell("h2") };
    if (id === "@/components/ui/input") return { Input: (props: any) => React.createElement("input", props) };
    if (id === "./_lib") return { adminFetch: () => { throw new Error("No network is permitted in this render test"); } };
    if (id === "@/hooks/use-toast") return { useToast: () => ({ toast: () => {} }) };
    if (id === "@/lib/public-settings") return { usePublicSettings: () => ({}), logoSrc: () => "" };
    if (id === "./print-helpers") return {};
    if (id === "@/components/print/print-provider") return { usePrint: () => ({ print: () => {} }) };
    return require(id);
  } };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const html = renderToStaticMarkup(React.createElement(ctx.exports.default));
  return { html, text: html.replace(/<[^>]+>/g, ""), retry: () => { const button = actions.find(x => x.children === "إعادة المحاولة"); assert.ok(button?.onClick, "visible query error must provide a retry action"); button.onClick(); return retried; } };
}
for (const stale of [undefined, data]) {
  const result = render({ isError: true, error: failure, data: stale });
  assert.match(result.html, /role="alert"/, "a failed salary load must be visible as an error");
  assert.match(result.text, /تعذر قراءة بيانات الرواتب/); assert.match(result.text, /REQ-salary-load/);
  assert.doesNotMatch(result.text, /لا توجد رواتب لهذا الشهر|موظف معروف|198[٬,]?765|0 د\.ع/, "failed loads cannot become empty, zero or authoritative cached totals");
  assert.equal(result.retry(), 1);
}
const loading = render({ isLoading: true });
assert.doesNotMatch(loading.text, /لا توجد رواتب لهذا الشهر|0 د\.ع/);
assert.match(loading.text, /تحميل/);
assert.match(render({ isSuccess: true, data: empty }).text, /لا توجد رواتب لهذا الشهر/);
const history = render({ isSuccess: true, data }, { isError: true, error: failure, data: { ...empty, history: [row] } }, true);
assert.match(history.html, /role="alert"/); assert.match(history.text, /REQ-salary-load/);
assert.equal((history.text.match(/2026-11/g) || []).length, 1, "a failed history refresh hides cached history rows while preserving the independently successful main query");
assert.doesNotMatch(history.text, /لا يوجد سجل رواتب مبسط لهذا الموظف/); assert.equal(history.retry(), 1);
console.log("PASS actual salary page: structured visible error/retry, loading placeholders, successful empty data and separate history errors; failed reads never display false zeros or cached salaries");
