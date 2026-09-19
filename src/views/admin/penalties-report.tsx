import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, FileSpreadsheet, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { exportReport, type ReportColumn } from "@/lib/pdf-report";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";

type PenaltyReportRow = {
  id: number;
  penaltyNo: string;
  sourceType: string;
  sourceId: number;
  customerName: string;
  itemLabel: string;
  damageType: string;
  quantity: number;
  penaltyAmount: number;
  reason: string;
  status: string;
  origin: string;
  createdByName: string;
  createdAt: string | null;
  paid: number;
  remaining: number;
  displayStatus: string;
};
type PenaltyReportPayload = { rows: PenaltyReportRow[]; totals: { count: number; penaltyTotal: number; paid: number; remaining: number; pendingReview: number } };
type PenaltyKpi = { pendingReview: number; unpaid: number; partlyPaid: number; paid: number; thisMonthCount: number; penaltyTotal: number; collected: number; remaining: number };

const DAMAGE_LABELS: Record<string, string> = { break: "كسر", loss: "فقدان", damage: "تلف", shortage: "نقص", not_returned: "عدم إرجاع", other: "ضرر آخر" };
const STATUS_LABELS: Record<string, string> = { pending_review: "قيد المراجعة", unpaid: "غير مدفوعة", partly_paid: "مدفوعة جزئياً", paid: "مدفوعة بالكامل", cancelled: "ملغاة" };
const damageLabel = (value: string) => DAMAGE_LABELS[value] ?? value;
const statusLabel = (value: string) => STATUS_LABELS[value] ?? value;
const sourceLabel = (value: string) => (value === "kosha_booking" ? "كوشة" : "خدمة");

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PenaltiesReportPage() {
  const { data: settings } = usePublicSettings();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [damageType, setDamageType] = useState("");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "", status: "", damageType: "", search: "" });
  const [exporting, setExporting] = useState(false);

  const params = new URLSearchParams();
  if (applied.from) params.set("from", applied.from);
  if (applied.to) params.set("to", applied.to);
  if (applied.status) params.set("status", applied.status);
  if (applied.damageType) params.set("damageType", applied.damageType);
  if (applied.search) params.set("search", applied.search);
  const qs = params.toString();

  const report = useQuery<PenaltyReportPayload>({ queryKey: ["penalties-report", qs], queryFn: () => adminFetch(`/admin/penalties/report${qs ? `?${qs}` : ""}`) });
  const kpi = useQuery<PenaltyKpi>({ queryKey: ["penalties-kpi"], queryFn: () => adminFetch("/admin/penalties/kpi") });
  const rows = report.data?.rows ?? [];
  const totals = report.data?.totals ?? { count: 0, penaltyTotal: 0, paid: 0, remaining: 0, pendingReview: 0 };

  const apply = () => setApplied({ from, to, status, damageType, search: search.trim() });
  const reset = () => { setFrom(""); setTo(""); setStatus(""); setDamageType(""); setSearch(""); setApplied({ from: "", to: "", status: "", damageType: "", search: "" }); };

  const columns: ReportColumn<PenaltyReportRow>[] = [
    { key: "penaltyNo", header: "الرقم", width: 11, kind: "code", priority: "high" },
    { key: "customerName", header: "العميل", width: 13, priority: "high", value: (r) => r.customerName || "—" },
    { key: "source", header: "الحجز", width: 10, priority: "medium", value: (r) => `${sourceLabel(r.sourceType)} #${r.sourceId}` },
    { key: "itemLabel", header: "العنصر", width: 14, priority: "high" },
    { key: "damageType", header: "الحالة", width: 9, priority: "medium", value: (r) => damageLabel(r.damageType) },
    { key: "quantity", header: "الكمية", width: 6, kind: "number", align: "center", priority: "low" },
    { key: "penaltyAmount", header: "الغرامة", width: 10, kind: "money", priority: "high" },
    { key: "paid", header: "المدفوع", width: 10, kind: "money", priority: "high" },
    { key: "remaining", header: "المتبقي", width: 10, kind: "money", priority: "high" },
    { key: "displayStatus", header: "الحالة", width: 10, align: "center", priority: "high", value: (r) => statusLabel(r.displayStatus) },
  ];

  async function exportPdf(mode: "download" | "print") {
    setExporting(true);
    try {
      await exportReport<PenaltyReportRow>({
        options: {
          title: "تقرير الغرامات والتلفيات",
          subtitle: [applied.status ? `الحالة: ${statusLabel(applied.status)}` : "", applied.search ? `بحث: ${applied.search}` : ""].filter(Boolean).join(" · ") || undefined,
          orientation: "landscape",
          logoUrl: logoSrc(settings),
          summary: [
            { label: "عدد الغرامات", value: String(totals.count) },
            { label: "إجمالي الغرامات", value: formatCurrency(totals.penaltyTotal) },
            { label: "المحصّل", value: formatCurrency(totals.paid) },
            { label: "المتبقي", value: formatCurrency(totals.remaining) },
          ],
          totalsLabel: "الإجمالي",
          totals: [
            { key: "penaltyAmount", text: formatCurrency(totals.penaltyTotal) },
            { key: "paid", text: formatCurrency(totals.paid) },
            { key: "remaining", text: formatCurrency(totals.remaining) },
          ],
          dateRange: { from: applied.from || null, to: applied.to || null },
          footerNote: `عدد الغرامات: ${totals.count} · تقرير الغرامات والتلفيات · نظام AJN`,
        },
        columns,
        rows,
        filename: "تقرير الغرامات والتلفيات.pdf",
        mode,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "تعذّر التصدير");
    } finally {
      setExporting(false);
    }
  }

  function exportCsv() {
    const header = ["الرقم", "العميل", "الحجز", "العنصر", "نوع الحالة", "الكمية", "الغرامة", "المدفوع", "المتبقي", "الحالة", "السبب", "أنشأها", "التاريخ"];
    const lines = rows.map((r) => [r.penaltyNo, r.customerName, `${sourceLabel(r.sourceType)} #${r.sourceId}`, r.itemLabel, damageLabel(r.damageType), r.quantity, r.penaltyAmount, r.paid, r.remaining, statusLabel(r.displayStatus), (r.reason || "").replace(/[\r\n,]+/g, " "), r.createdByName, r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-CA") : ""].join(","));
    download(`﻿${[header.join(","), ...lines].join("\n")}`, "تقرير الغرامات والتلفيات.csv", "text/csv;charset=utf-8");
  }

  const kpiCards: Array<[string, string | number, string]> = [
    ["قيد المراجعة", kpi.data?.pendingReview ?? 0, "#92400e"],
    ["غير مدفوعة", kpi.data?.unpaid ?? 0, "#991b1b"],
    ["مدفوعة جزئياً", kpi.data?.partlyPaid ?? 0, "#92400e"],
    ["غرامات هذا الشهر", kpi.data?.thisMonthCount ?? 0, "#1d4ed8"],
    ["إجمالي الغرامات", formatCurrency(kpi.data?.penaltyTotal ?? 0), "#111827"],
    ["إجمالي المحصّل", formatCurrency(kpi.data?.collected ?? 0), "#065f46"],
    ["إجمالي المتبقي", formatCurrency(kpi.data?.remaining ?? 0), "#b45309"],
  ];

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><AlertTriangle className="h-6 w-6 text-amber-600" /> تقرير الغرامات والتلفيات</h1><p className="mt-1 text-sm text-muted-foreground">غرامات الأضرار والتلفيات على الحجوزات — مستقلة عن إيرادات المبيعات.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exportPdf("print")} disabled={!rows.length || exporting}><Printer className="ml-2 h-4 w-4" /> طباعة</Button>
          <Button variant="outline" size="sm" onClick={() => exportPdf("download")} disabled={!rows.length || exporting}><Download className="ml-2 h-4 w-4" /> PDF</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><FileSpreadsheet className="ml-2 h-4 w-4" /> CSV</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {kpiCards.map(([label, value, color]) => (
          <div key={label} className="rounded-xl border border-border/40 bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold" style={{ color }}>{kpi.isLoading ? "…" : value}</p></div>
        ))}
      </div>

      <div className="rounded-xl border border-border/40 bg-card p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="relative block"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} placeholder="بحث بالعميل/العنصر/الرقم" className="w-full rounded-lg border border-border/40 bg-background py-2 pr-10 pl-3 text-sm" /></label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="">كل الحالات</option>{Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select value={damageType} onChange={(e) => setDamageType(e.target.value)} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="">كل الأنواع</option>{Object.entries(DAMAGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
        <div className="mt-2 flex gap-2"><Button size="sm" onClick={apply}>تطبيق</Button><Button size="sm" variant="ghost" onClick={reset}>مسح</Button></div>
      </div>

      {report.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : !rows.length ? (
        <EmptyState message="لا توجد غرامات مطابقة للفلاتر" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/30 bg-card">
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] w-full text-sm">
              <thead className="bg-background/50 text-muted-foreground"><tr>{["الرقم", "العميل", "الحجز", "العنصر", "نوع الحالة", "الكمية", "الغرامة", "المدفوع", "المتبقي", "الحالة"].map((h) => <th key={h} className="p-3 text-right">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border/20">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-background/40">
                    <td className="p-3 font-mono text-xs" dir="ltr">{r.penaltyNo}</td>
                    <td className="p-3">{r.customerName || "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground">{sourceLabel(r.sourceType)} #{r.sourceId}</td>
                    <td className="p-3">{r.itemLabel}</td>
                    <td className="p-3">{damageLabel(r.damageType)}</td>
                    <td className="p-3 text-center">{r.quantity}</td>
                    <td className="p-3">{formatCurrency(r.penaltyAmount)}</td>
                    <td className="p-3 text-status-success">{formatCurrency(r.paid)}</td>
                    <td className="p-3 text-status-warning">{formatCurrency(r.remaining)}</td>
                    <td className="p-3 text-center">{statusLabel(r.displayStatus)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-background/60 font-bold"><tr><td className="p-3" colSpan={6}>الإجمالي — {totals.count} غرامة</td><td className="p-3">{formatCurrency(totals.penaltyTotal)}</td><td className="p-3 text-status-success">{formatCurrency(totals.paid)}</td><td className="p-3 text-status-warning">{formatCurrency(totals.remaining)}</td><td /></tr></tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
