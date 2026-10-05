import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GraduationStudentSummary, GraduationStudentWizard } from "../src/components/graduation-student-wizard";
import { GraduationGroupPricingAccess, GraduationGroupPricingEditor } from "../src/components/graduation-group-pricing-editor";

Object.assign(globalThis, { React });
// Source components run through TSX's CommonJS loader; use that same React Query context.
const { QueryClient, QueryClientProvider } = createRequire(import.meta.url)("@tanstack/react-query") as typeof import("@tanstack/react-query");
const configuration = {
  sashSelectionMode: "restricted",
  sashOptions: ["royal", "american"],
  sashType: "royal",
  sashPricing: { mode: "by_sash", prices: { royal: 23000, american: 25000 } },
};
function wizard(base: Record<string, unknown>) {
  return renderToStaticMarkup(React.createElement(QueryClientProvider, {
    client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    children: React.createElement(GraduationStudentWizard, { base, scope: "pricing-test" }),
  }));
}

// Removing the persisted selected price from the student flow must fail this test.
const priced = wizard(configuration);
assert.match(priced, /سعر تجهيز الطالب/);
assert.match(priced, /23,000/);
assert.match(priced, /ملكي/);
assert.doesNotMatch(priced, /name="(?:sashPricing|totalAmount|unitPrice)"/);
assert.match(wizard({ ...configuration, sashPricing: { mode: "by_sash", prices: { royal: 0, american: 25000 } } }), /سعر تجهيز الطالب[\s\S]*0/);
assert.match(wizard({ ...configuration, sashPricing: { mode: "by_sash", prices: { royal: 23000 } } }), /role="alert"/);
assert.doesNotMatch(wizard({ ...configuration, sashPricing: undefined }), /سعر تجهيز الطالب/);

// A policy change must never reprice an already stored student receipt.
const stored = renderToStaticMarkup(React.createElement(GraduationStudentSummary, {
  order: { customerName: "طالب قديم", totalAmount: 17000, customText: { sashType: "royal" }, ...configuration },
}));
assert.match(stored, /17,000/);
assert.doesNotMatch(stored, /23,000/);

// An approved choice must have its own labelled value; a valid zero cannot disappear.
const editor = renderToStaticMarkup(React.createElement(GraduationGroupPricingEditor, {
  configuration: { ...configuration, sashPricing: { mode: "by_sash", prices: { royal: 0, american: 25000 } } },
  endpoint: "/admin/graduation/groups/41/sash-pricing",
  onSaved: () => {},
}));
assert.match(editor, /سعر الطالب — ملكي/);
assert.match(editor, /سعر الطالب — أمريكي/);
assert.match(editor, /name="sash-price-royal"[^>]*value="0"/);
assert.match(editor, /name="sash-price-american"[^>]*value="25000"/);
assert.doesNotMatch(editor, /name="sash-price-(?:standard|side)"/);
const catalogEditor = renderToStaticMarkup(React.createElement(GraduationGroupPricingEditor, {
  configuration: { ...configuration, sashPricing: undefined },
  endpoint: "/admin/graduation/groups/41/sash-pricing",
  onSaved: () => {},
}));
assert.match(catalogEditor, /<input(?=[^>]*value="catalog")(?=[^>]*checked="")[^>]*>/);
assert.doesNotMatch(catalogEditor, /name="sash-price-/);

// Opening the public student link alone must not expose an unauthenticated price form.
const publicAccess = renderToStaticMarkup(React.createElement(QueryClientProvider, {
  client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  children: React.createElement(GraduationGroupPricingAccess, { token: "public-join-token", onSaved: () => {} }),
}));
assert.doesNotMatch(publicAccess, /name="sash-price-/);
assert.doesNotMatch(publicAccess, /حفظ أسعار المجموعة/);

// Both final actions and the handler must block retries until the changed quote is reviewed.
const wizardSource = readFileSync("src/components/graduation-student-wizard.tsx", "utf8");
assert.match(wizardSource, /async function save\(addAnother: boolean\) \{[\s\S]*?if \(priceStale\) \{[\s\S]*?return;/);
assert.match(wizardSource, /disabled=\{[^}]*priceStale\}[^>]*onClick=\{\(\) => void save\(false\)\}/);
assert.match(wizardSource, /disabled=\{[^}]*priceStale\}[\s\S]*?onClick=\{\(\) => void save\(true\)\}/);

console.log("Graduation group pricing UI tests passed.");
