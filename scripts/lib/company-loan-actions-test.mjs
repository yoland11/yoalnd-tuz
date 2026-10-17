import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import * as React from "react";
import * as icons from "lucide-react";

// Exercise the real rendered action handlers. Removing print dispatch, editing
// the wrong loan, or allowing cancellation of an active loan must fail this
// test; renaming a private helper must not. Only hooks/external I/O are doubled.
export async function testCompanyLoanActions(text = readFileSync("src/views/admin/loans.tsx", "utf8")) {
  const tree = ts.createSourceFile("loans.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const source = tree.statements.filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(tree)).join("\n");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const loan = { id: 19, loanNo: "LOAN-19", lenderName: "مقرض تجريبي", originalAmount: 100,
    totalRepaid: 0, remainingAmount: 100, receivedDate: "2026-10-01", paymentMethod: "cash",
    status: "pending", repayments: [] };
  const prints = [], requests = [], states = [];
  let stateIndex = 0, reason = "  سبب الإلغاء  ";
  const Button = () => null;
  const context = vm.createContext({
    ...icons, require: createRequire(import.meta.url), exports: {}, Button,
    Dialog: () => null, DialogContent: () => null, DialogHeader: () => null, DialogTitle: () => null,
    useState(initial) {
      const index = stateIndex++;
      states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value) => { states[index] = value; }];
    },
    useMemo: (fn) => fn(), useQueryClient: () => ({ invalidateQueries() {} }),
    useToast: () => ({ toast() {} }), usePrint: () => ({ print: (input) => prints.push(input) }),
    useQuery: () => ({ data: { loans: [loan] }, isError: false, isLoading: false }),
    useMutation: (options) => ({ isPending: false, mutate: (input) => options.mutationFn(input) }),
    adminFetch: async (url, options) => { requests.push({ url, ...options }); return {}; },
    apiErrorMessage: String, formatCurrency: String,
    buildCompanyLoanStatementDocumentHtml: (input) => JSON.stringify(input),
    buildCompanyLoanRepaymentReceiptDocumentHtml: (input) => JSON.stringify(input),
    window: { prompt: () => reason },
  });
  vm.runInContext(code, context);
  function actions() {
    stateIndex = 0;
    const root = context.exports.CompanyLoansPanel({});
    const found = [];
    function visit(node) {
      if (!React.isValidElement(node)) return;
      if (node.type === Button) found.push(node);
      React.Children.forEach(node.props.children, visit);
    }
    visit(root);
    return found;
  }
  const label = (button) => React.Children.toArray(button.props.children)
    .filter((child) => typeof child === "string").join("");
  const find = (buttons, value) => {
    const button = buttons.find((item) => label(item) === value);
    assert(button, `Missing loan action: ${value}`);
    return button;
  };
  let buttons = actions();
  find(buttons, "طباعة").props.onClick();
  assert.equal(prints.length, 1);
  assert.equal(prints[0].documentLabel, "كشف قرض LOAN-19");
  assert.deepEqual(Array.from(prints[0].formats, (format) => format.id), ["a4"]);
  assert.equal(JSON.parse(prints[0].formats[0].buildHtml()).id, 19);
  assert.equal(requests.length, 0, "Print audit must wait for print completion");
  prints[0].onPrinted();
  assert.equal(requests[0].url, "/admin/loans/19/printed");
  assert.equal(requests[0].method, "POST");
  find(buttons, "تعديل").props.onClick();
  assert.equal(states[1].id, 19, "Edit must select this loan");
  assert.equal(states[4].lenderName, "مقرض تجريبي");
  assert.equal(states[4].amount, "100");
  await find(buttons, "مسح / إلغاء").props.onClick();
  assert.equal(requests[1].url, "/admin/loans/19");
  assert.equal(requests[1].method, "DELETE");
  assert.deepEqual(JSON.parse(requests[1].body), { reason: "سبب الإلغاء" });
  reason = "   ";
  await find(buttons, "مسح / إلغاء").props.onClick();
  assert.equal(requests.length, 2, "Blank reason must not send cancellation");
  loan.status = "active";
  buttons = actions();
  assert(!buttons.some((button) => label(button) === "مسح / إلغاء"), "Active loan must not offer destructive cancellation");
  find(buttons, "طباعة");
  find(buttons, "تعديل");
}
