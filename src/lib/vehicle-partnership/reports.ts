import { canonicalPartnershipJson } from "./canonical";
import { formatMoney, parseMoney } from "./money";

/** Structural read DTOs: these are the existing workspace, never a second ledger. */
export type ReportPaymentState = {
  totalAmount: string; approvedPaidAmount: string; remainingAmount: string;
  reservedAmount: string; availableAmount: string; payable: boolean; approvalStatus: string;
  nonCashSettledAmount?: string; conversionAmount?: string; pendingConversionAmount?: string;
  conversionCashPaidAmount?: string; conversionCashReservedAmount?: string; availableCoverageAmount?: string;
};
export type ReportRight = {
  id: number; category: string; direction: string; memberId: number | null; memberName: string | null;
  amount: string; status: string; closingId: number | null; closingVersion: number | null; paymentState: ReportPaymentState;
};
export type ReportDriver = { entryId: number; employeeId: number; employeeName: string | null; amount: string; entryDate: string; status: string; paymentState: ReportPaymentState };
export type ReportClosing = { closingId: number; month: string; status: string; version: number; revision: number; sourceDigest: string | null; financialTransactionId: number | null };
export type ReportRequest = { id: number; sourceType: string; sourceId: string; sourceEvent: string; status: string; amount: string; date: string; description: string | null; reversedAt?:string|null; reversalTxnId?:number|null };
export type PartnershipReportWorkspace = { rights: ReportRight[]; driverEntries: ReportDriver[]; closings: ReportClosing[]; requests: ReportRequest[]; from?: string; to?: string; canApprove?: boolean };
export type StatementRow = Omit<ReportRight, "paymentState"> & ReportPaymentState;
export type PartnerStatement = { key: string; memberId: number | null; name: string; rows: StatementRow[] };
export type PartnershipReportIdentity = { vehicleName: string; plateNumber: string; generatedAt: string };
export type PartnershipReportBranding = { companyName?: string; companyPhone?: string; logoUrl?: string | null };
export type MonthlyReportRow = { category: string; label: string; amount: string };
export type ApprovedMonthlyReport = { month: string; status: string; from: string; to: string; revision: number; rows: MonthlyReportRow[] };
export type PayoutReceipt = { transactionNo: string; transactionDate: string; payeeName: string; amount: string; title: string; paymentMethod: string; executedAt: string };

export const partnershipCategoryLabels: Record<string, string> = { capital: "رأس المال", profit: "الأرباح المعتمدة", advance: "سلف الشريك القابلة للاسترداد", loss: "الخسائر", loss_recovery: "تسوية الخسائر", internal_entitlement: "استحقاق النقل الداخلي" };
export const partnershipReportStatuses: Record<string, string> = { approved: "معتمد", executed: "منفذ", pending: "بانتظار الموافقة", draft: "مسودة", review: "قيد المراجعة", distributed: "موزّع", cancelled: "ملغي", reversed: "معكوس", rejected: "مرفوض", settled: "مسدد", partially_settled: "مسدد جزئياً" };
function fail(message: string): never { throw new Error(message); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail("إثبات التقرير غير مكتمل"); return value as Record<string, unknown>; }
function list(value: unknown): unknown[] { if (!Array.isArray(value)) fail("سجل التقرير غير مكتمل"); return value; }
function id(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) fail("مرجع التقرير غير صالح"); return value; }
function text(value: unknown): string { if (typeof value !== "string" || !value.trim()) fail("بيانات التقرير غير مكتملة"); return value; }
function amount(value: unknown): string { if (typeof value !== "string") fail("مبالغ التقرير يجب أن تكون نصوصاً دقيقة"); return formatMoney(parseMoney(value)); }
function signed(value: unknown): bigint { const valueText = text(value); return valueText.startsWith("-") ? -parseMoney(valueText.slice(1)) : parseMoney(valueText); }
function day(value: unknown): string { const result = text(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(`${result}T00:00:00Z`)) || new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) fail("تاريخ التقرير غير صالح"); return result; }
function time(value: unknown): string { const result = text(value); if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) fail("إثبات تاريخ تنفيذ الصرف غير موجود"); return result; }
async function digest(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) fail("التحقق من بصمة التقرير يحتاج اتصالاً آمناً بالمتصفح");
  const result = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPartnershipJson(value)));
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function formatReportMoney(value: string): string {
  const normalized = formatMoney(signed(value));
  const [whole, fraction] = normalized.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction} د.ع`;
}

/** No netting capital, losses, advances or pending requests into profit/paid.
 * Group identity is the ORIGINAL agreement member, never the current name. */
export function buildPartnerStatements(workspace: Pick<PartnershipReportWorkspace, "rights">): PartnerStatement[] {
  const groups = new Map<string, PartnerStatement>(), seen = new Set<number>();
  for (const right of workspace.rights) {
    const rightId = id(right.id); if (seen.has(rightId)) fail("مرجع استحقاق مكرر في الكشف"); seen.add(rightId);
    if (!Object.hasOwn(partnershipCategoryLabels, right.category) || !["credit", "debit"].includes(right.direction)) fail("نوع استحقاق التقرير غير صالح");
    const state = right.paymentState;
    if (!state || typeof state.payable !== "boolean" || !state.approvalStatus) fail("رصيد الاستحقاق المركزي غير متاح");
    const values = { totalAmount: amount(state.totalAmount), approvedPaidAmount: amount(state.approvedPaidAmount), remainingAmount: amount(state.remainingAmount), reservedAmount: amount(state.reservedAmount), availableAmount: amount(state.availableAmount) };
    if (amount(right.amount) !== values.totalAmount) fail("مبلغ الاستحقاق لا يطابق رصيده المركزي");
    const extras: Partial<ReportPaymentState> = {};
    for (const field of ["nonCashSettledAmount", "conversionAmount", "pendingConversionAmount", "conversionCashPaidAmount", "conversionCashReservedAmount", "availableCoverageAmount"] as const) if (state[field] !== undefined) extras[field] = amount(state[field]);
    const memberId = right.memberId == null ? null : id(right.memberId);
    const key = memberId != null ? `member:${memberId}` : right.category === "internal_entitlement" ? "internal" : `unidentified:${rightId}`;
    const name = right.memberName?.trim() || (key === "internal" ? "تسوية نشاط المركبة الداخلية" : "اسم الشريك غير متاح");
    let group = groups.get(key); if (!group) { group = { key, memberId, name, rows: [] }; groups.set(key, group); }
    group.rows.push({ ...right, ...values, ...extras, payable: state.payable, approvalStatus: state.approvalStatus });
  }
  return [...groups.values()];
}

/** The original endpoint proves source accounting. Recheck the selected saved
 * identity and SHA-256 snapshot here; never print a live estimate as approved. */
export async function proveApprovedClosing(vehicleId: number, selected: ReportClosing, response: unknown): Promise<ApprovedMonthlyReport> {
  id(vehicleId); id(selected.closingId);
  if (!["approved", "distributed"].includes(selected.status) || !selected.sourceDigest || !/^[a-f0-9]{64}$/.test(selected.sourceDigest)) fail("اختر إغلاقاً شهرياً معتمداً");
  const result = object(response), snapshot = object(result.snapshot);
  if (result.stored !== true || result.provisional !== false || result.vehicleId !== vehicleId || result.closingId !== selected.closingId || result.version !== selected.version || result.status !== selected.status || result.sourceDigest !== selected.sourceDigest || snapshot.formatVersion !== 1 || snapshot.vehicleId !== vehicleId || snapshot.partnershipId !== result.partnershipId) fail("نسخة الإغلاق تغيرت أو لم تُعتمد؛ حدّث البيانات قبل الطباعة");
  const from = day(snapshot.from), to = day(snapshot.to);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected.month) || from !== `${selected.month}-01` || to !== new Date(Date.UTC(Number(selected.month.slice(0, 4)), Number(selected.month.slice(5)), 0)).toISOString().slice(0, 10) || result.from !== from || result.to !== to || await digest(snapshot) !== selected.sourceDigest) fail("بصمة الإغلاق المحفوظ أو فترته لا تطابق النسخة المعتمدة");
  const calculation = object(snapshot.calculation), summary = object(calculation.summary);
  if (canonicalPartnershipJson(calculation) !== canonicalPartnershipJson(result.calculation) || summary.complete !== true || list(summary.blockers).length || list(result.approvalBlockers).length || object(snapshot.policy).accountingMethod !== "activity_clearing") fail("النتيجة المحفوظة غير مكتملة أو غير معتمدة");
  const labels: Record<string, string> = { externalIncome: "دخل النقل الخارجي", internalIncome: "تخصيص النقل الداخلي — ليس إيراد عميل إضافياً", cost: "تكاليف التشغيل المعتمدة", result: "صافي نتيجة النشاط", lossRecovered: "تسوية الخسائر السابقة", carriedLossOut: "الخسائر المرحلة", reserve: "الاحتياطي المعتمد", maxDistributable: "الربح المعتمد القابل للتوزيع" };
  const rows: MonthlyReportRow[] = Object.entries(labels).map(([key, label]) => ({ category: "نتيجة الشهر المعتمدة", label, amount: formatMoney(signed(summary[key])) }));
  rows.push({ category: "استثمار منفصل", label: "الاستثمار الرأسمالي — ليس مصروف رحلة", amount: amount(calculation.investment) });
  const agreements = list(snapshot.agreements).map(object);
  for (const [field, category] of [["profitAllocations", "تخصيص ربح معتمد"], ["lossAllocations", "تخصيص خسارة"], ["lossRecoveries", "تسوية خسارة"]]) {
    for (const allocation of list(calculation[field]).map(object)) {
      const agreementId = id(allocation.agreementId), memberId = id(allocation.memberId);
      const matching = agreements.filter(a => a.id === agreementId); if (matching.length !== 1) fail("اتفاق توزيع الشهر الأصلي غير موجود");
      const members = list(matching[0].members).map(object).filter(member => member.id === memberId); if (members.length !== 1) fail("هوية صاحب حصة الشهر غير مطابقة للاتفاق الأصلي");
      const party = object(members[0].party); if (`${text(party.kind)}:${id(party.id)}` !== allocation.partyKey) fail("طرف حصة الشهر لا يطابق الاتفاق الأصلي");
      rows.push({ category, label: typeof members[0].name === "string" && members[0].name.trim() ? members[0].name : "اسم الشريك غير متاح في النسخة المحفوظة", amount: amount(allocation.amount) });
    }
  }
  return { month: selected.month, status: String(result.status), from, to, revision: selected.revision, rows };
}

const payoutRules: Record<string, { sourceType: string; type: string; account: string; title: string; category?: string }> = {
  distribution: { sourceType: "vehicle_partnership_settlement", type: "vp_partner_distribution", account: "VP-PROFIT", title: "وصل صرف حصة الشريك", category: "profit" },
  advance_reimbursement: { sourceType: "vehicle_partnership_settlement", type: "vp_partner_advance_repayment", account: "VP-ADVANCE", title: "وصل استرداد سلفة الشريك", category: "advance" },
  driver_fee_settlement: { sourceType: "vehicle_partnership_driver", type: "vp_driver_payment", account: "VP-DRIVER", title: "وصل صرف أجرة سائق" },
};
function isOriginalPayout(request:ReportRequest){return request.status==="executed"&&Object.hasOwn(payoutRules,request.sourceEvent)&&payoutRules[request.sourceEvent].sourceType===request.sourceType;}
export function isPartnershipPayoutRequest(request: ReportRequest): boolean { return isOriginalPayout(request)&&!request.reversedAt&&request.reversalTxnId==null; }
export function isPartnershipReversedPayoutRequest(request:ReportRequest):boolean{return isOriginalPayout(request)&&Boolean(request.reversedAt||request.reversalTxnId!=null);}

/** Receipt proof is obtained only through the existing authorized transaction
 * detail. Pending/approved requests and reversed payouts never become receipts. */
export async function provePayoutReceipt(vehicleId: number, workspace: PartnershipReportWorkspace, requestId: number, response: unknown): Promise<PayoutReceipt> {
  id(vehicleId); id(requestId);
  const matching = workspace.requests.filter(request => request.id === requestId);
  if (matching.length !== 1 || !isPartnershipPayoutRequest(matching[0])) fail("اختر صرفاً منفذاً من طلبات هذه المركبة وحدّث البيانات");
  const request = matching[0], rule = payoutRules[request.sourceEvent], detail = object(response), paid = amount(detail.amount);
  if (detail.id !== request.id || detail.approvalStatus !== "executed" || detail.direction !== "expense" || detail.sourceType !== request.sourceType || detail.sourceId !== request.sourceId || detail.sourceEvent !== request.sourceEvent || detail.transactionType !== rule.type || paid !== amount(request.amount) || day(detail.transactionDate) !== request.date || parseMoney(paid) <= 0n) fail("الصرف الأصلي لا يطابق طلب المركبة أو لم ينفذ");
  if (detail.reversedAt != null || detail.reversalTxnId != null || detail.reversedTransactionId != null) fail("لا يمكن إصدار وصل صرف لحركة معكوسة");
  const transactionNo = text(detail.transactionNo);
  if (transactionNo.length > 50 || /[\u0000-\u001f]/.test(transactionNo) || /[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/i.test(transactionNo)) fail("رقم السند المالي النهائي غير متاح");
  const executedAt = time(detail.executedAt); time(detail.approvedAt); id(detail.executedBy); id(detail.approvedBy);
  if (detail.balanceBefore == null || detail.balanceAfter == null || signed(detail.balanceBefore) - signed(detail.balanceAfter) !== parseMoney(paid)) fail("إثبات خصم الصندوق لا يطابق الصرف");
  const entries = list(detail.entries).map(object); let debit = 0n, credit = 0n;
  for (const entry of entries) {
    const value = parseMoney(amount(entry.amount));
    if (entry.side === "debit" && entry.accountCode === rule.account) debit += value;
    else if (entry.side === "credit" && entry.accountCode === "1000") credit += value;
    else fail("قيد صرف الشراكة لا يطابق حسابه الأصلي");
  }
  if (debit !== parseMoney(paid) || credit !== parseMoney(paid)) fail("إثبات قيد الصرف غير مكتمل");
  const audits = list(detail.audits).map(object).filter(audit => audit.action === "vehicle_partnership_financial_requested");
  if (audits.length !== 1) fail("إثبات مصدر الصرف غير موجود أو مكرر");
  const audit = object(audits[0].newValues), proposal = object(audit.sourceSnapshot), command = object(proposal.command), origin = object(proposal.origin);
  if (audit.vehicleId !== vehicleId || proposal.vehicleId !== vehicleId || audit.partnershipId !== proposal.partnershipId || audit.sourceType !== request.sourceType || String(audit.sourceId) !== request.sourceId || amount(audit.amount) !== paid || proposal.formatVersion !== 1 || await digest(proposal) !== audit.sourceDigest || amount(command.amount) !== paid || day(command.transactionDate) !== request.date || command.paymentMethod !== detail.paymentMethod) fail("بصمة مصدر الصرف أو هويته لا تطابق المركبة");
  id(proposal.partnershipId);
  let payeeName: string;
  if (rule.category) {
    const rightId = id(command.rightId), rights = workspace.rights.filter(right => right.id === rightId && right.category === rule.category);
    if (String(rightId) !== request.sourceId || rights.length !== 1 || origin.rightId !== rightId || origin.memberId !== rights[0].memberId || rights[0].status !== "approved") fail("استحقاق صاحب الصرف الأصلي لا يطابق الكشف");
    payeeName = rights[0].memberName?.trim() || "اسم الشريك غير متاح";
  } else {
    const entryId = id(command.entryId), entries = workspace.driverEntries.filter(entry => entry.entryId === entryId);
    if (String(id(proposal.settlementId)) !== request.sourceId || origin.entryId !== entryId || entries.length !== 1 || origin.employeeId !== entries[0].employeeId) fail("تسوية أجرة السائق لا تطابق الاستحقاق الأصلي");
    payeeName = entries[0].employeeName?.trim() || "اسم السائق غير متاح";
  }
  return { transactionNo, transactionDate: request.date, payeeName, amount: paid, title: rule.title, paymentMethod: text(detail.paymentMethod), executedAt };
}
