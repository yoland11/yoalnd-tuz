import assert from "node:assert/strict";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { ResearchOrderTable } from "../src/views/admin/research/overview";
import {
  researchAccess,
  researchFilterParams,
  validateResearchForm,
  researchOrderPayload,
  researchPaymentPayload,
  reminderPreview,
  researchOrderShareText,
  whatsappLink,
} from "../src/views/admin/research/ui-model";
import {
  ResearchFailure,
  ResearchMetrics,
} from "../src/views/admin/research/shared";
import {
  researchOrderSheetHtml,
  researchReceiptHtml,
  researchStudentStatementThermalHtml,
  researchStatementShareText,
} from "../src/views/admin/research-print";
import * as researchPrint from "../src/views/admin/research-print";
import { ResearchOrderActions } from "../src/views/admin/research/order-actions";
Object.assign(globalThis, { React });
const { QueryClient, QueryClientProvider } = createRequire(import.meta.url)("@tanstack/react-query") as typeof import("@tanstack/react-query");
const statementFixture={customer:{name:'طالب <script>',phone:'07700000000'},openingBalance:500,closingBalance:300,documentsRemaining:300,from:'2026-11-01',to:'2026-11-16',entries:[{date:'2026-11-16',reference:'PAY-1',description:'دفعة معتمدة',receivedByName:'المستلم أحمد',debit:0,credit:200,balance:300}]};
const thermalStatement=researchStudentStatementThermalHtml(statementFixture);
assert.match(thermalStatement,/كشف حساب الطالب/);assert.ok(!thermalStatement.includes('<script>'));assert.match(thermalStatement,/PAY-1/);
assert.match(thermalStatement,/المستلم أحمد/);
assert.match(researchStatementShareText(statementFixture),/300/);assert.match(researchStatementShareText(statementFixture),/دفعة معتمدة/);

const shareOrder = { researchNo: 'RS-9', title: 'مشروع الطالب العلمي', customerName: 'محمد علي', universityName: 'جامعة بغداد', deadline: '2026-12-01', qrToken: 'track/token', totalAmount: 999999, paidAmount: 888888, remainingAmount: 777777, notes: 'ملاحظات داخلية سرية', internalNotes: 'خاصة بالموظفين' };
const operationalShare = researchOrderShareText(shareOrder, undefined, 'https://ajn.example');
assert.match(operationalShare, /RS-9/);
assert.match(operationalShare, /محمد علي/);
assert.match(operationalShare, /https:\/\/ajn\.example\/research\/track\/track%2Ftoken/);
assert.doesNotMatch(operationalShare, /999|888|777|سرية|الموظفين|admin\//);
const financialShare = researchOrderShareText(shareOrder, { totalAmount: 500000, approvedPaidAmount: 200000, paidAmount: 350000, remainingAmount: 300000, pendingAmount: 150000 }, 'https://ajn.example');
assert.match(financialShare, /500,000/);
assert.match(financialShare, /200,000/);
assert.match(financialShare, /300,000/);
assert.doesNotMatch(financialShare, /350,000|150,000|999|سرية/);
assert.throws(() => researchOrderShareText(shareOrder, { totalAmount: 500000 }, 'https://ajn.example'), /المالية/);
assert.equal(new URL(whatsappLink('07701234567', financialShare)!).searchParams.get('text'), financialShare);
assert.match(whatsappLink('07701234567', financialShare)!, /^https:\/\/wa\.me\/9647701234567\?/);
assert.equal(whatsappLink('123', financialShare), null);
const orderActions = renderToStaticMarkup(createElement(ResearchOrderActions, { order: { ...shareOrder, id: 9 }, financial: false }));
assert.match(orderActions, /طباعة A4/);
assert.match(orderActions, /طباعة 80mm/);
assert.match(orderActions, /PDF/);
assert.match(orderActions, /إرسال إلى واتساب/);
assert.doesNotMatch(orderActions, /type="submit"/);

const reader = {
  id: 3,
  username: "reader",
  fullName: "Reader",
  role: "staff",
  permissions: ["research.view"],
  isActive: true,
};
const renderResearchRows = (archivable: boolean, archived = false) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ResearchOrderTable, { items: [{ id: 9, researchNo: "RS-9", title: "بحث الطالب الأصلي", customerName: "محمد علي", status: archived ? "archived" : "new", archivedAt: archived ? "2026-11-19" : null }], financial: false, archivable, onOpen: () => {} })));
assert.match(renderResearchRows(true), /حذف الطلب RS-9/, "authorized active rows expose an explicit safe-delete action");
assert.doesNotMatch(renderResearchRows(false), /حذف الطلب/, "read-only rows never expose deletion");
assert.doesNotMatch(renderResearchRows(true, true), /حذف الطلب/, "already archived rows cannot be deleted again");
assert.equal(researchAccess(reader, "research.financials.view"), false);
assert.equal(
  researchAccess({ ...reader, permissions: ["research"] }, "research.edit"),
  true,
);
assert.equal(
  researchAccess(
    { ...reader, isActive: false, role: "admin" },
    "research.create",
  ),
  false,
);
const params = researchFilterParams({
  q: "بحث الطالب",
  category: "all",
  stage: "quality_review",
  from: "2026-11-01",
  to: "2026-11-30",
  page: 2,
});
assert.equal(params.get("q"), "بحث الطالب");
assert.equal(params.has("category"), false);
assert.equal(params.get("page"), "2");
const errors = validateResearchForm({
  title: "بحث أكاديمي",
  customerName: "طالب",
  phone: "07701234567",
  universityName: "بغداد",
  requiredPages: 30,
  estimatedPrice: 100,
  deposit: 120,
  deadline: "2026-12-30",
  paymentDueDate: "2026-11-30",
});
assert.equal(Boolean(errors.deposit), true);
assert.equal(
  Boolean(errors.paymentDueDate),
  false,
  "payment due date is independent from delivery deadline",
);
assert.throws(
  () =>
    researchPaymentPayload({ amount: 101, method: "cash" }, 100, "request-1"),
  /المتاح/,
);
assert.equal(
  researchPaymentPayload({ amount: 100, method: "cash" }, 100, "request-1")
    .idempotencyKey,
  "request-1",
);
const payload = researchOrderPayload(
  {
    title: "بحث أكاديمي",
    estimatedPrice: 500,
    deposit: 100,
    assignedWriterId: "42",
    paidAmount: 400,
    assignedReviewerId: 7,
    paymentDueDate: "2026-01-01",
  },
  { financial: false, assignable: false, receive: false },
  "create-1",
  true,
);
assert.equal("estimatedPrice" in payload, false);
assert.equal("deposit" in payload, false);
assert.equal("paidAmount" in payload, false);
assert.equal("paymentDueDate" in payload, false);
assert.equal(
  "assignedReviewerId" in payload,
  false,
  "editing ordinary details never sends team mutations without a grant",
);
const printOrder = {
  researchNo: "R-1",
  title: "<script>unsafe</script> بحث",
  customerName: "طالب",
  customerPhone: "07701234567",
};
const printAccount = { totalAmount: 100, paidAmount: 25, remainingAmount: 75 };
const pendingReceipt = researchReceiptHtml(printOrder, printAccount, {
  amount: 50,
  approvalStatus: "approved",
  direction: "revenue",
});
assert.match(pendingReceipt, /لا يعد إثبات قبض/);
assert.doesNotMatch(pendingReceipt, /وصل قبض بحث علمي/);
assert.doesNotMatch(pendingReceipt, /<script>unsafe/);
const reversedReceipt = researchReceiptHtml(printOrder, printAccount, {
  amount: 50,
  netAmount: 25,
  approvalStatus: "executed",
  direction: "revenue",
});
assert.match(reversedReceipt, /صافي الدفعة بعد العكس/);
const orderSheet = researchOrderSheetHtml(printOrder);
assert.match(orderSheet, /A4 portrait/);
assert.doesNotMatch(orderSheet, /<th[^>]*>المقبوض/);
const detailedOrder = {
  ...printOrder, titleEnglish: 'Smart Irrigation', academicLevel: 'master',
  researchCategory: 'software', researchType: 'graduation', universityName: 'جامعة بغداد',
  college: 'كلية الهندسة', department: 'قسم الحاسبات', supervisorName: 'د. أحمد',
  researchField: 'إنترنت الأشياء', language: 'en', requiredPages: 45, citationStyle: 'APA7',
  keywords: ['حساسات', 'ري'], urgency: 'urgent', status: 'writing', progress: 35,
  deadline: '2026-12-01', paymentDueDate: '2026-11-30', createdAt: '2026-11-17T10:00:00Z',
  assignedWriterId: 8, notes: 'متطلبات الطالب <script>\nتنفيذ المشروع كاملاً',
  internalNotes: 'PRIVATE-INTERNAL', qrToken: 'PRIVATE-TOKEN',
  totalAmount: 999999, paidAmount: 888888, remainingAmount: 777777,
};
const printAssignments = [
  { assignment: { role: 'writer', staffId: 7 }, staffName: 'المسؤول السابق' },
  { assignment: { role: 'writer', staffId: 8 }, staffName: 'المسؤول الحالي' },
];
const detailedAccount = { totalAmount: 500000, approvedPaidAmount: 200000, paidAmount: 350000, remainingAmount: 300000, pendingAmount: 150000 };
const { researchOrderThermalHtml } = researchPrint;
for (const builder of [researchOrderSheetHtml, researchOrderThermalHtml]) {
  const full = builder(detailedOrder, detailedAccount, printAssignments);
  for (const value of ['Smart Irrigation', 'ماجستير', 'مشروع برمجي', 'مشروع تخرج', 'جامعة بغداد', 'كلية الهندسة', 'قسم الحاسبات', 'د. أحمد', 'إنترنت الأشياء', 'الإنجليزية', '45', 'APA7', 'حساسات', 'ري', 'مستعجل', 'الكتابة', '35%', '2026-12-01', '2026-11-30', 'المسؤول الحالي', 'متطلبات الطالب &lt;script&gt;', 'تنفيذ المشروع كاملاً', '500,000', '200,000', '300,000', '150,000'])
    assert.ok(full.includes(value), `Full research document missing ${value}`);
  assert.doesNotMatch(full, /<script>|PRIVATE-|999,999|888,888|777,777|350,000|المسؤول السابق/);
  const nonfinancial = builder(detailedOrder, undefined, printAssignments);
  assert.doesNotMatch(nonfinancial, /999,999|888,888|777,777|المقبوض المعتمد|المتبقي|2026-11-30|الدفعات المعلقة/);
  assert.match(nonfinancial, /تنفيذ المشروع كاملاً/);
  assert.throws(() => builder(detailedOrder, { totalAmount: 500000 }), /المالية/);
  for (const remainingAmount of [-1, ' ', 'invalid'])
    assert.throws(() => builder(detailedOrder, { ...detailedAccount, remainingAmount }), /المالية/);
  assert.match(builder({ ...printOrder, language: 'ku' }), /الكردية/);
  assert.match(builder({ ...printOrder, status: 'legacy_status', researchType: 'نوع قديم' }), /legacy_status/);
}
const fullThermal = researchOrderThermalHtml(detailedOrder, detailedAccount);
assert.match(fullThermal, /max-width:72mm/);
assert.doesNotMatch(fullThermal, /size:\s*A4/);
const failed = renderToStaticMarkup(
  createElement(ResearchFailure, {
    error: new Error("request failed"),
    retry: () => {},
  }),
);
assert.match(failed, /role="alert"/);
assert.doesNotMatch(failed, /لا توجد|0 د/);
const operational = renderToStaticMarkup(
  createElement(ResearchMetrics, {
    summary: {
      total: 9,
      newOrders: 2,
      inProgress: 3,
      awaitingReview: 1,
      ready: 2,
      completed: 1,
      totalValue: 999999,
    },
    financial: false,
  }),
);
assert.doesNotMatch(operational, /999999|قيمة الأبحاث|المبالغ المقبوضة/);
const financial = renderToStaticMarkup(
  createElement(ResearchMetrics, {
    summary: {
      total: 9,
      totalValue: 500,
      collected: 200,
      remaining: 300,
      overdueDebt: 50,
    },
    financial: true,
  }),
);
assert.equal((financial.match(/data-research-metric=/g) ?? []).length, 10);
assert.match(
  reminderPreview({
    customerName: "أحمد",
    researchNo: "R-1",
    remainingAmount: 250,
    paymentDueDate: null,
  }),
  /لم يحدد موعد/,
);
console.log(
  "Research UI: grants, ten metrics, errors, filters, form dates and pending collection limits verified.",
);
