import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as icons from "lucide-react";

// Run the real payment form handler. A network failure must retain the amount
// and request identity; a pending response must not claim settled collection.
export async function testInstallmentPaymentActions(text = readFileSync("src/views/admin/installments.tsx", "utf8")) {
  const tree = ts.createSourceFile("installments.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const source = tree.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(tree)).join("\n");
  const code = ts.transpileModule(source + "\nexports.detail = ContractDetail;", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const states = [], requests = [], notices = [];
  let cursor = 0, fail = true, nonce = 0;
  const ui = Object.fromEntries(["Button", "Card", "CardContent", "Input", "Label", "Skeleton", "Table", "TableHeader", "TableRow", "TableHead", "TableBody", "TableCell"].map(name => [name, () => null]));
  const context = vm.createContext({
    ...ui, ...icons, require: createRequire(import.meta.url), exports: {},
    crypto: { randomUUID: () => `request-${++nonce}` },
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    },
    useRef(initial) { const index = cursor++; return states[index] ??= { current: initial }; },
    useQueryClient: () => ({ invalidateQueries() {} }),
    useToast: () => ({ toast: notice => notices.push(notice) }),
    useQuery: () => ({ isLoading: false, data: { contract: { id: 23, contract_no: "INST-23", status: "active", customer_name: "عميل", financed_amount: 100, scheduled_paid_amount: 0, remaining_amount: 100, collected_amount: 0 }, schedule: [] } }),
    useMutation: options => ({ isPending: false, mutate: async input => {
      try { const result = await options.mutationFn(input); options.onSuccess?.(result); }
      catch (error) { options.onError?.(error); }
    } }),
    adminFetch: async (url, options) => {
      requests.push({ url, ...options });
      if (fail) throw new Error("network interrupted");
      return { payment: { status: "pending" } };
    }, apiErrorMessage: String, formatCurrency: String,
  });
  vm.runInContext(code, context);
  function render() {
    cursor = 0;
    const root = context.exports.detail({ id: 23, onBack() {} });
    const nodes = [];
    function visit(node) {
      if (!React.isValidElement(node)) return;
      nodes.push(node); React.Children.forEach(node.props.children, visit);
    }
    visit(root);
    return { input: nodes.find(node => node.type === ui.Input), pay: nodes.find(node => node.type === ui.Button && React.Children.toArray(node.props.children).includes("استلام قسط")) };
  }
  render().input.props.onChange({ target: { value: "40" } });
  await render().pay.props.onClick();
  assert.equal(render().input.props.value, "40", "Failed submission must preserve the amount");
  await render().pay.props.onClick();
  const first = JSON.parse(requests[0].body), retry = JSON.parse(requests[1].body);
  assert.equal(requests[0].url, "/admin/installments/contracts/23/payment");
  assert.equal(first.amount, "40");
  assert.equal(retry.idempotencyKey, first.idempotencyKey, "Network retry must reuse its original payment key");
  fail = false;
  await render().pay.props.onClick();
  assert.equal(render().input.props.value, "");
  assert.match(notices.at(-1).title, /بانتظار الموافقة/);
  render().input.props.onChange({ target: { value: "40" } });
  await render().pay.props.onClick();
  assert.notEqual(JSON.parse(requests.at(-1).body).idempotencyKey, first.idempotencyKey, "A confirmed new payment needs a new identity");
}
