import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, Loader2, Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildReportDocumentHtml, downloadReportPdf, isMobilePdfEnvironment, type ReportColumn } from "@/lib/pdf-report";
import {
  buildPartnerStatements, formatReportMoney, isPartnershipPayoutRequest, isPartnershipReversedPayoutRequest, partnershipCategoryLabels,
  partnershipReportStatuses, proveApprovedClosing, provePayoutReceipt,
  type ApprovedMonthlyReport, type PartnerStatement, type PartnershipReportBranding,
  type PartnershipReportIdentity, type PartnershipReportWorkspace, type PayoutReceipt, type StatementRow,
} from "@/lib/vehicle-partnership/reports";
import { buildThermalReceiptHtml, printWhenImagesReadyScript } from "./print-helpers";
import { adminFetch, apiErrorMessage } from "./_lib";
import VehicleDriverCoverageSync from "./vehicle-driver-coverage";

type Props = { vehicleId: number; vehicleName: string; plateNumber: string; workspace: PartnershipReportWorkspace };
const status = (value: string) => partnershipReportStatuses[value] ?? value;
const direction = (value: string) => value === "debit" ? "على الشريك / تسوية" : "للشريك / استحقاق";
const currentBalanceNote = "رصيد حالي من جميع المستحقات الأصلية؛ مرشّح النشاط لا يحوّله إلى كشف تاريخي. رأس المال والأرباح والسلف والخسائر والتسويات فئات منفصلة ولا تُجمع في رصيد واحد.";
const readonlyNote = "للقراءة والطباعة فقط؛ الطباعة لا تُنشئ ولا تعتمد ولا تصرف حركة مالية. المعلّق محجوز فقط ولا يمثل مدفوعاً منفذاً.";
function conversionNote(row: StatementRow): string {
  const labels = { nonCashSettledAmount: "تسوية غير نقدية", conversionAmount: "محول", pendingConversionAmount: "تحويل معلق", conversionCashPaidAmount: "صرف نقدي من التحويل", conversionCashReservedAmount: "صرف محجوز من التحويل", availableCoverageAmount: "تغطية متاحة" };
  return Object.entries(labels).filter(([key]) => row[key as keyof StatementRow] !== undefined).map(([key, label]) => `${label}: ${formatReportMoney(row[key as keyof StatementRow] as string)}`).join(" · ");
}
function statementColumns(): ReportColumn<StatementRow>[] {
  // Already-formatted exact decimal strings stay TEXT; the legacy money column
  // formatter uses Number and must not round an original financial amount.
  return [
    { key: "identity", header: "الشريك / الفئة", width: 22, kind: "text", value: row => `${row.memberName || "نشاط المركبة الداخلي"}\n${partnershipCategoryLabels[row.category]}\n${direction(row.direction)}${conversionNote(row) ? `\n${conversionNote(row)}` : ""}` },
    { key: "status", header: "حالة الأصل", width: 10, kind: "text", value: row => `${status(row.status)}${row.payable ? "" : " · غير قابل للصرف"}` },
    ...([["totalAmount", "أصل الاستحقاق"], ["approvedPaidAmount", "المدفوع المنفذ"], ["remainingAmount", "المتبقي المركزي"], ["reservedAmount", "محجوز معلق"], ["availableAmount", "المتاح للصرف"]] as const).map(([key, header]) => ({ key, header, width: 13.6, kind: "text" as const, align: "end" as const, value: (row: StatementRow) => formatReportMoney(row[key]) })),
  ];
}
function addReportSafetyStyles(html: string): string {
  return html.replace("</style>", ".rpt-brand-name,.rpt-title,.rpt-brand-sub,.rpt-meta{overflow-wrap:anywhere;white-space:pre-wrap}.rpt-table td{white-space:pre-line}.rpt-table td.end{direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums}</style>");
}
export function buildPartnershipStatementHtml(statement: PartnerStatement, identity: PartnershipReportIdentity, branding: PartnershipReportBranding = {}): string {
  return addReportSafetyStyles(buildReportDocumentHtml({
    title: statement.key === "all" ? "كشف حساب السيارة — أرصدة حالية" : "كشف حساب الشريك — رصيد حالي", subtitle: `${statement.name}\n${currentBalanceNote}`,
    company: branding.companyName, logoUrl: branding.logoUrl, orientation: "landscape",
    meta: [{ label: "المركبة", value: identity.vehicleName }, { label: "رقم اللوحة", value: identity.plateNumber || "غير مسجل" }, { label: "تاريخ العرض", value: identity.generatedAt }],
    emptyText: "لا توجد مستحقات أصلية في هذا الكشف.", footerNote: readonlyNote,
  }, statementColumns(), statement.rows));
}
export function buildPartnershipMonthlyHtml(report: ApprovedMonthlyReport, identity: PartnershipReportIdentity, branding: PartnershipReportBranding = {}): string {
  return addReportSafetyStyles(buildReportDocumentHtml({
    title: "تقرير أرباح الشهر المعتمد", subtitle: "نتيجة الشهر المعتمدة من نسختها المحفوظة؛ تخصيص الأرباح لا يعني صرفها. الاستثمار والتخصيص الداخلي معروضان بشكل منفصل.",
    company: branding.companyName, logoUrl: branding.logoUrl,
    meta: [{ label: "المركبة", value: identity.vehicleName }, { label: "اللوحة", value: identity.plateNumber || "غير مسجل" }, { label: "الشهر", value: report.month }, { label: "الحالة", value: status(report.status) }, { label: "المراجعة المعتمدة", value: String(report.revision) }, { label: "تاريخ العرض", value: identity.generatedAt }],
    dateRange: { from: report.from, to: report.to }, footerNote: readonlyNote,
  }, [{ key: "category", header: "القسم", width: 24, kind: "text" }, { key: "label", header: "البيان / المستفيد", width: 46, kind: "text" }, { key: "amount", header: "المبلغ — د.ع", width: 30, kind: "text", align: "end", value: row => formatReportMoney(row.amount) }], report.rows));
}
export function buildPartnershipPayoutHtml(receipt: PayoutReceipt, identity: PartnershipReportIdentity, branding: PartnershipReportBranding = {}): string {
  const methods: Record<string, string> = { cash: "نقداً", transfer: "تحويل", pos: "بطاقة" };
  return buildThermalReceiptHtml({ title: receipt.title, docNo: receipt.transactionNo, dateTime: receipt.transactionDate,
    companyName: branding.companyName, companyPhone: branding.companyPhone, logoUrl: branding.logoUrl,
    rows: [{ label: "المستلم", value: receipt.payeeName, strong: true }, { label: "المركبة", value: identity.vehicleName }, { label: "رقم اللوحة", value: identity.plateNumber || "غير مسجل" }, { label: "طريقة الدفع", value: methods[receipt.paymentMethod] ?? receipt.paymentMethod }, { label: "تاريخ التنفيذ", value: receipt.executedAt }],
    amountLabel: "المبلغ المصروف", amountValue: formatReportMoney(receipt.amount), statusText: "صرف منفذ بعد الموافقة", footerText: "نسخة من السند المالي الأصلي — إعادة الطباعة لا تُنشئ دفعة جديدة",
  // Only this new receipt receives screen-preview centering. Shared printing
  // helpers and original 80mm paper geometry are preserved.
  }).replace("</style>", ".receipt .kv{min-width:0}.receipt .v,.r-company{overflow-wrap:anywhere;white-space:pre-wrap}.receipt .num{unicode-bidi:isolate}.receipt .grand{flex-wrap:wrap}@media screen {html {width:100%;max-width:none;}body {width:80mm;max-width:100%;margin-inline:auto !important;}}</style>");
}

export function PartnerStatementTable({ statement }: { statement: PartnerStatement }) {
  return <div className="overflow-x-auto rounded-xl border border-border/50"><table className="w-full min-w-[860px] text-right text-sm"><thead className="bg-muted/40"><tr>{["الفئة / المصدر", "الحالة", "أصل الاستحقاق", "المدفوع المنفذ", "المتبقي المركزي", "محجوز معلق", "المتاح للصرف"].map(label => <th key={label} className="p-3 font-semibold">{label}</th>)}</tr></thead><tbody>{statement.rows.map(row => <tr key={row.id} className="border-t border-border/40 align-top"><td className="max-w-64 break-words p-3"><p className="font-medium">{row.memberName || "نشاط المركبة الداخلي"}</p><p className="mt-1">{partnershipCategoryLabels[row.category]}</p><p className="mt-1 text-xs text-muted-foreground">{direction(row.direction)}</p>{conversionNote(row) && <p className="mt-2 max-w-prose text-xs leading-6 text-muted-foreground">{conversionNote(row)}</p>}</td><td className="p-3"><span className="inline-block rounded-full bg-muted px-2 py-1 text-xs">{status(row.status)}</span>{!row.payable && <p className="mt-2 text-xs text-muted-foreground">غير قابل للصرف</p>}</td>{(["totalAmount", "approvedPaidAmount", "remainingAmount", "reservedAmount", "availableAmount"] as const).map(field => <td key={field} className="p-3"><bdi dir="ltr" className="whitespace-nowrap tabular-nums">{formatReportMoney(row[field])}</bdi></td>)}</tr>)}{!statement.rows.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">لا توجد مستحقات أصلية لعرضها.</td></tr>}</tbody></table></div>;
}

/** Open synchronously from a click (mobile popup policies), then populate only
 * after the original source has been revalidated. Failed windows are explicit. */
function reservePrintWindow(): Window {
  const popup = window.open("", "_blank", "width=1080,height=800");
  if (!popup) throw new Error("حظر المتصفح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.");
  popup.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>التحقق من مستند الطباعة</title></head><body><p>جاري التحقق من المصدر الأصلي قبل الطباعة…</p></body></html>'); popup.document.close();
  return popup;
}
function printVerifiedHtml(popup: Window, html: string) {
  if (popup.closed) throw new Error("أُغلقت نافذة الطباعة؛ أعد المحاولة.");
  const readiness = printWhenImagesReadyScript().replace("waitForImages().then(function() {", "Promise.all([waitForImages(), document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()]).then(function() {");
  popup.document.open(); popup.document.write(html.replace("</body>", `${readiness}</body>`)); popup.document.close();
}
function generatedAt() { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baghdad", dateStyle: "medium", timeStyle: "short" }).format(new Date()); }
function ReportSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-border/50 bg-card p-4 sm:p-5"><h3 className="font-bold">{title}</h3><p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">{description}</p><div className="mt-4 space-y-4">{children}</div></section>;
}

export default function VehiclePartnershipReports({ vehicleId, vehicleName, plateNumber, workspace }: Props) {
  const qc = useQueryClient(), [memberKey, setMemberKey] = useState("all"), [month, setMonth] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState<{ kind: "monthly"; month: string; html: string } | { kind: "payout"; requestId: number; html: string } | null>(null);
  // Reuse real public branding endpoint, without the legacy helper's example
  // phone fallback or conversion of a failed HTTP request into settings data.
  const settings = useQuery<{ site_name?: string; phone?: string; logo_url?: string }>({ queryKey: ["vehicle-partnership", "print-branding"], queryFn: () => adminFetch("/settings/public"), staleTime: 300000, retry: false });
  const statements = useMemo(() => { try { return { data: buildPartnerStatements(workspace), error: null }; } catch (cause) { return { data: null, error: cause }; } }, [workspace]);
  const all: PartnerStatement = { key: "all", memberId: null, name: "حسابات المركبة — فئات منفصلة", rows: statements.data?.flatMap(statement => statement.rows) ?? [] };
  const selected = memberKey === "all" ? all : statements.data?.find(statement => statement.key === memberKey);
  const closings = workspace.closings.filter(closing => ["approved", "distributed"].includes(closing.status));
  const selectedMonth = month || closings[0]?.month || "";
  const payouts = workspace.requests.filter(isPartnershipPayoutRequest);
  const reversedPayouts = workspace.requests.filter(isPartnershipReversedPayoutRequest);
  const identity = (): PartnershipReportIdentity => ({ vehicleName, plateNumber, generatedAt: generatedAt() });
  const branding = (): PartnershipReportBranding => {
    if (!settings.data || settings.isError) throw settings.error || new Error("لم تصل إعدادات الشركة؛ أعد تحميلها قبل الطباعة");
    const logo = settings.data.logo_url?.trim();
    const logoUrl = logo ? new URL(logo, window.location.origin) : null;
    if (logoUrl && !["https:", "http:"].includes(logoUrl.protocol)) throw new Error("رابط شعار الشركة غير صالح للطباعة");
    return { companyName: settings.data.site_name?.trim() || undefined, companyPhone: settings.data.phone?.trim() || undefined, logoUrl: logoUrl?.href };
  };
  const action = async (run: () => Promise<void>) => { setError(null); setBusy(true); try { await run(); } catch (cause) { setError(cause); } finally { setBusy(false); } };
  const currentMonthlyHtml = async (chosenMonth: string) => {
    const chosen = workspace.closings.find(closing => closing.month === chosenMonth && ["approved", "distributed"].includes(closing.status));
    if (!chosen) throw new Error("اختر شهراً معتمداً من سجل المركبة");
    const response = await adminFetch(`/admin/enterprise/vehicles/${vehicleId}/partnership/closings/preview`, { method: "POST", body: JSON.stringify({ month: chosenMonth }) });
    return buildPartnershipMonthlyHtml(await proveApprovedClosing(vehicleId, chosen, response), identity(), branding());
  };
  const currentPayoutHtml = async (requestId: number) => {
    const detail = await adminFetch(`/admin/master-cash/transactions/${requestId}`);
    return buildPartnershipPayoutHtml(await provePayoutReceipt(vehicleId, workspace, requestId, detail), identity(), branding());
  };
  const currentStatementHtml = async () => {
    // Reconcile through the existing authorized workspace immediately before
    // generating a document labelled as the current balance.
    const query = new URLSearchParams();
    if (workspace.from) query.set("from", workspace.from);
    if (workspace.to) query.set("to", workspace.to);
    const fresh = await adminFetch<PartnershipReportWorkspace>(`/admin/enterprise/vehicles/${vehicleId}/partnership/workspace?${query}`);
    const groups = buildPartnerStatements(fresh);
    const chosen = memberKey === "all" ? {key:"all",memberId:null,name:"حسابات المركبة — فئات منفصلة",rows:groups.flatMap(group=>group.rows)} : groups.find(group=>group.key===memberKey);
    if (!chosen) throw new Error("حساب الشريك لم يعد ضمن الكشف الحالي؛ حدّث البيانات.");
    return buildPartnershipStatementHtml(chosen, identity(), branding());
  };
  const print = (load: () => Promise<string> | string) => {
    let popup: Window;
    try { popup = reservePrintWindow(); } catch (cause) { setError(cause); return; }
    void action(async () => { try { printVerifiedHtml(popup, await load()); } catch (cause) { popup.close(); throw cause; } });
  };
  const download = (load: () => Promise<string> | string, filename: string, orientation: "portrait" | "landscape") => {
    if (isMobilePdfEnvironment()) { print(load); return; }
    void action(async () => { await downloadReportPdf(await load(), filename, orientation); });
  };
  const disabled = busy || settings.isPending || settings.isError || Boolean(statements.error);
  return <div dir="rtl" className="space-y-4">
    {Boolean(error || settings.isError || statements.error) && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4"><p className="font-semibold">تعذر عرض أو طباعة التقرير</p><p className="mt-1 break-words text-sm leading-6">{apiErrorMessage(error || settings.error || statements.error)}</p><Button type="button" variant="outline" className="mt-3 gap-2" disabled={busy} onClick={() => void action(async () => { const result = await settings.refetch(); if (result.error) throw result.error; await qc.invalidateQueries({ queryKey: ["vehicle-partnership", vehicleId] }); })}><RefreshCw className="h-4 w-4" />تحديث المصادر وإعادة المحاولة</Button></div>}
    {settings.isPending && <p aria-busy="true" className="text-sm text-muted-foreground">جاري تحميل إعدادات طباعة الشركة…</p>}
    <ReportSection title="كشوف حساب الشراكة" description={currentBalanceNote}>
      <div className="flex flex-wrap items-end justify-between gap-3"><label className="block min-w-48 space-y-2 text-sm"><span>حساب الشريك أو المركبة</span><select value={selected ? memberKey : "all"} onChange={event => setMemberKey(event.target.value)} className="min-h-11 w-full max-w-full rounded-lg border border-input bg-background px-3"><option value="all">كشف حساب السيارة — جميع الفئات</option>{statements.data?.map((statement, index) => <option key={statement.key} value={statement.key}>{statement.name} — سجل العضوية {index + 1}</option>)}</select></label><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11 gap-2" disabled={disabled || !selected} onClick={() => print(currentStatementHtml)}><Printer className="h-4 w-4" />طباعة الكشف A4</Button><Button type="button" variant="outline" className="min-h-11 gap-2" disabled={disabled || !selected} onClick={() => download(currentStatementHtml, "AJN-partnership-current-statement.pdf", "landscape")}><FileDown className="h-4 w-4" />تحميل PDF</Button></div></div>
      {selected && !statements.error && <PartnerStatementTable statement={selected} />}<p className="text-xs leading-6 text-muted-foreground">{readonlyNote}</p>
    </ReportSection>
    <ReportSection title="تقرير أرباح الشهر المعتمد" description="يعرض النسخة المجمدة للشهر بعد اعتمادها. المسودات والتقديرات لا تصلح كتقرير أرباح معتمد.">
      <div className="flex flex-wrap items-end gap-3"><label className="block min-w-48 space-y-2 text-sm"><span>الشهر المعتمد</span><select className="min-h-11 w-full rounded-lg border border-input bg-background px-3" value={selectedMonth} onChange={event => { setMonth(event.target.value); setPreview(null); }} disabled={!closings.length || busy}><option value="">اختر الشهر</option>{closings.map(closing => <option key={closing.closingId} value={closing.month}>{closing.month} · {status(closing.status)}</option>)}</select></label><Button type="button" className="min-h-11 gap-2" disabled={disabled || !selectedMonth} onClick={() => void action(async () => setPreview({ kind: "monthly", month: selectedMonth, html: await currentMonthlyHtml(selectedMonth) }))}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}معاينة التقرير المعتمد</Button></div>{!closings.length && <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">لا يوجد إغلاق شهري معتمد للطباعة بعد.</p>}
      <VehicleDriverCoverageSync key={vehicleId} base={`/admin/enterprise/vehicles/${vehicleId}/partnership`} closing={closings.find(closing => closing.month === selectedMonth) ?? null} canApprove={workspace.canApprove === true} refresh={() => qc.invalidateQueries({ queryKey: ["vehicle-partnership", vehicleId] })} />
    </ReportSection>
    <ReportSection title="وصول الصرف المنفذة — 80mm" description={`صرف حصة الشريك واسترداد السلفة وأجرة السائق من السند المالي الأصلي فقط. ${workspace.from && workspace.to ? `سجل الطلبات للفترة ${workspace.from} إلى ${workspace.to}.` : "سجل الطلبات ضمن مرشّح النشاط الحالي."} لا يُطبع وصل للمعلّق أو المعكوس.`}>
      <div className="space-y-2">{payouts.map(request => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/40 p-3"><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{request.description || "صرف شراكة منفذ"}</p><p className="mt-1 text-xs text-muted-foreground"><bdi>{request.date}</bdi> · <bdi dir="ltr">{formatReportMoney(request.amount)}</bdi></p></div><Button type="button" variant="outline" className="min-h-11 gap-2" disabled={disabled} onClick={() => void action(async () => setPreview({ kind: "payout", requestId: request.id, html: await currentPayoutHtml(request.id) }))}><Printer className="h-4 w-4" />معاينة وصل 80mm</Button></div>)}{!payouts.length && <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">لا توجد طلبات صرف منفذة في الفترة المعروضة. الطلب المعلق لا يمثل دفعة.</p>}</div>
    </ReportSection>
    {reversedPayouts.length>0&&<ReportSection title="سجل الصرف المعكوس" description="السند الأصلي محفوظ مع سند إرجاع المبلغ. لا يمثل صرفاً سارياً ولا يُعاد طبعه كوصل دفع منفذ."><div className="space-y-2">{reversedPayouts.map(request=><div key={request.id} className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-border/40 p-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{request.description||"صرف شراكة معكوس"}</p><p className="mt-1 text-xs text-muted-foreground"><bdi>{request.date}</bdi> · المبلغ الأصلي <bdi dir="ltr">{formatReportMoney(request.amount)}</bdi> · معكوس</p></div><a href={`/admin/finance/master-cash?transaction=${request.id}`} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-border px-3 text-sm font-medium text-primary">عرض السند وسجل العكس</a></div>)}</div></ReportSection>}
    <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(null); }}><DialogContent className="max-h-[94dvh] max-w-4xl overflow-y-auto" dir="rtl"><DialogHeader><DialogTitle>{preview?.kind === "payout" ? "معاينة وصل الصرف — 80mm" : "معاينة تقرير الأرباح المعتمد — A4"}</DialogTitle><DialogDescription>تُفحص حالة المصدر مجدداً قبل الطباعة. فتح نافذة الطباعة لا يثبت خروج ورقة من الطابعة.</DialogDescription></DialogHeader>{preview && <iframe title="معاينة مستند الشراكة" sandbox="" referrerPolicy="no-referrer" srcDoc={preview.html} className={`mx-auto h-[55dvh] max-w-full rounded-lg border bg-white ${preview.kind === "payout" ? "w-[80mm]" : "w-full"}`} />}<DialogFooter className="flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" onClick={() => setPreview(null)}>إغلاق</Button>{preview?.kind === "monthly" && <Button type="button" variant="outline" className="min-h-11 gap-2" disabled={disabled} onClick={() => download(() => currentMonthlyHtml(preview.month), `AJN-partnership-${preview.month}.pdf`, "portrait")}><FileDown className="h-4 w-4" />تحميل PDF</Button>}<Button type="button" className="min-h-11 gap-2" disabled={disabled || !preview} onClick={() => { if (preview) print(() => preview.kind === "payout" ? currentPayoutHtml(preview.requestId) : currentMonthlyHtml(preview.month)); }}><Printer className="h-4 w-4" />طباعة</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
