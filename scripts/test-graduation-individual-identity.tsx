import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
// Match the CJS module instance used by tsx-transpiled component dependencies.
const { QueryClient, QueryClientProvider } = createRequire(import.meta.url)(
  "@tanstack/react-query",
) as typeof import("@tanstack/react-query");
(globalThis as any).React = React;
import { GraduationStudentWizard } from "../src/components/graduation-student-wizard";

// Individual orders: name, phone and university details are entered once (step 5)
// and the confirmation wizard only shows them, with an explicit edit option.
const page = readFileSync("src/views/graduation.tsx", "utf8");
const step5 = page.slice(page.indexOf("{step === 5 ? ("), page.indexOf("{step === 6 ? ("));
for (const label of ["الاسم الكامل *", "رقم الهاتف *", "الجامعة", "الكلية", "القسم", "سنة التخرج"])
  assert.ok(step5.includes(label), `step 5 collects ${label}`);
assert.match(step5, /customerName: value,\s*customText: \{ \.\.\.current\.customText, studentName: value \}/, "one name feeds the order and the design");
assert.match(step5, /formatIraqiPhoneInput\(event\.target\.value\)/);
assert.match(page, /if \(step === 5 && form\.customerName\.trim\(\)\.length < 2\)/);
assert.match(page, /if \(step === 5 && form\.phone\.replace\(\/\\D\/g, ""\)\.length < 10\)/);

const render = (base: Record<string, any>) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      createElement(GraduationStudentWizard, { scope: "individual", base }),
    ),
  );
const base = {
  customerName: "علي حسين",
  phone: "0770 123 4567",
  customText: { studentName: "علي حسين", university: "جامعة بغداد", college: "الهندسة", department: "المدني", graduationYear: "2027" },
  colors: {},
  measurements: {},
  extras: {},
};
const confirmed = render(base);
assert.match(confirmed, /بيانات الطالب المسجلة/);
for (const value of ["علي حسين", "0770 123 4567", "جامعة بغداد", "الهندسة", "المدني", "2027"])
  assert.ok(confirmed.includes(value), `confirmation shows ${value}`);
assert.doesNotMatch(confirmed, /id="student-customerName"/, "the name is not asked a second time");
assert.doesNotMatch(confirmed, /id="student-phone"/, "the phone is not asked a second time");
assert.match(confirmed, /تعديل/);
if (process.env.AJN_GRAD_IDENTITY_HTML)
  writeFileSync(process.env.AJN_GRAD_IDENTITY_HTML, `<main class="mx-auto max-w-3xl p-4" dir="rtl">${confirmed}</main>`);

// Missing details (e.g. an older draft) still fall back to the inputs.
const missing = render({ ...base, customerName: "", phone: "", customText: { ...base.customText, studentName: "" } });
assert.match(missing, /id="student-customerName"/);
assert.match(missing, /id="student-phone"/);
assert.doesNotMatch(missing, /بيانات الطالب المسجلة/);

// Group student links keep their own entry step.
const group = renderToStaticMarkup(
  createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    createElement(GraduationStudentWizard, { scope: "group-token", base: { ...base, groupToken: "group-token" } }),
  ),
);
assert.match(group, /id="student-customerName"/);
console.log("PASS  individual graduation order asks name, phone and university details once");
