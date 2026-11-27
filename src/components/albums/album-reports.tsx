import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { albumStageLabel } from "@/lib/albums";
import { printStandaloneDocument } from "@/lib/pdf";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import { ErrorBlock, Field, LoadingBlock, albumKeys, money } from "./shared";

type Reports = {
  from: string; to: string;
  daily: Array<{ day: string; count: number }>;
  monthly: Array<{ month: string; count: number }>;
  status: { total: number; completed: number; completedLate: number; delayed: number };
  staff: Array<{ staffId: number; staffName: string; stageMoves: number; designs: number; prints: number; bindings: number; qualityChecks: number; deliveries: number }>;
  finance?: { sales: string; costs: Record<"design" | "printing" | "cover" | "binding" | "extra", string>; totalCost: string; netProfit: string; packageAlbums: number };
  outstanding?: Array<{ id: number; albumNo: string; customerName: string; phone: string; stage: string; invoiceNo: string | null; remainingAmount: string }>;
};

export function AlbumReportsDialog({ open, onOpenChange, today, onOpenAlbum }: { open: boolean; onOpenChange: (open: boolean) => void; today: string; onOpenAlbum: (id: number) => void }) {
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const params = `from=${from}&to=${to}`;
  const reports = useQuery({ queryKey: albumKeys.reports(params), queryFn: () => adminFetch<Reports>(`/admin/albums/reports?${params}`), enabled: open && Boolean(from && to) });
  const data = reports.data;
  const maxDaily = Math.max(1, ...(data?.daily.map((row) => row.count) ?? [1]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92dvh] w-[min(calc(100%-2rem),56rem)] overflow-y-auto">
        <DialogHeader className="text-right"><DialogTitle>تقرير الألبومات</DialogTitle><DialogDescription>الطلبات اليومية والشهرية، المنجز والمتأخر، إنتاجية الموظفين، المبيعات والمصاريف وصافي الربح، والأرصدة المستحقة.</DialogDescription></DialogHeader>
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <Field label="من" htmlFor="report-from" className="w-44"><DateField id="report-from" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></Field>
          <Field label="إلى" htmlFor="report-to" className="w-44"><DateField id="report-to" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></Field>
          <Button type="button" variant="outline" disabled={!data} onClick={() => data && printStandaloneDocument(reportHtml(data))}><Printer className="h-4 w-4" />طباعة التقرير</Button>
        </div>
        {reports.isLoading ? <LoadingBlock /> : reports.isError ? <ErrorBlock message={apiErrorMessage(reports.error, "تعذّر تحميل التقرير")} onRetry={() => void reports.refetch()} /> : data ? (
          <div className="min-w-0 space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="طلبات الفترة" value={data.status.total} />
              <Stat label="مُسلّمة" value={data.status.completed} />
              <Stat label="سُلّمت متأخرة" value={data.status.completedLate} tone={data.status.completedLate ? "warn" : undefined} />
              <Stat label="متأخرة الآن" value={data.status.delayed} tone={data.status.delayed ? "bad" : undefined} />
            </div>

            {data.finance ? (
              <section className="space-y-2">
                <h3 className="font-bold">المبيعات والمصاريف</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="المبيعات (فواتير الألبومات)" value={money(data.finance.sales)} />
                  <Stat label="إجمالي التكلفة" value={money(data.finance.totalCost)} />
                  <Stat label="صافي الربح" value={money(data.finance.netProfit)} tone={Number(data.finance.netProfit) < 0 ? "bad" : "good"} />
                  <Stat label="ألبومات ضمن باقات" value={data.finance.packageAlbums} />
                </div>
                <p className="text-xs text-muted-foreground">التكاليف: تصميم {money(data.finance.costs.design)} · طباعة {money(data.finance.costs.printing)} · أغلفة {money(data.finance.costs.cover)} · تجليد {money(data.finance.costs.binding)} · إضافية {money(data.finance.costs.extra)}. ألبومات الباقات تُحتسب تكلفتها هنا وإيرادها ضمن الحجز.</p>
              </section>
            ) : null}

            <section className="space-y-2">
              <h3 className="font-bold">الطلبات اليومية</h3>
              {data.daily.length ? (
                <ul className="space-y-1">
                  {data.daily.map((row) => (
                    <li key={row.day} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-xs">
                      <span className="tabular-nums text-muted-foreground" dir="ltr">{row.day}</span>
                      <span className="h-2.5 rounded-full bg-primary/80" style={{ width: `${Math.max(4, (row.count / maxDaily) * 100)}%` }} />
                      <b className="tabular-nums">{row.count}</b>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted-foreground">لا توجد طلبات في هذه الفترة.</p>}
              {data.monthly.length ? <p className="text-xs text-muted-foreground">آخر 12 شهراً: {data.monthly.map((row) => `${row.month}: ${row.count}`).join(" · ")}</p> : null}
            </section>

            <section className="space-y-2">
              <h3 className="font-bold">إنتاجية الموظفين</h3>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-muted/60 text-xs text-muted-foreground"><tr>{["الموظف", "تصاميم", "طباعة", "تجليد", "فحص جودة", "تسليم", "كل الحركات"].map((head) => <th key={head} className="px-3 py-2 text-right font-bold">{head}</th>)}</tr></thead>
                  <tbody className="divide-y divide-border tabular-nums">
                    {data.staff.map((row) => <tr key={row.staffId}><td className="px-3 py-2 font-bold">{row.staffName}</td><td className="px-3 py-2">{row.designs}</td><td className="px-3 py-2">{row.prints}</td><td className="px-3 py-2">{row.bindings}</td><td className="px-3 py-2">{row.qualityChecks}</td><td className="px-3 py-2">{row.deliveries}</td><td className="px-3 py-2">{row.stageMoves}</td></tr>)}
                    {!data.staff.length ? <tr><td colSpan={7} className="px-3 py-5 text-center text-xs text-muted-foreground">لا توجد حركات في هذه الفترة</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>

            {data.outstanding ? (
              <section className="space-y-2">
                <h3 className="font-bold">أرصدة الزبائن المستحقة</h3>
                {data.outstanding.length ? (
                  <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                    {data.outstanding.map((row) => (
                      <li key={row.id}><button type="button" onClick={() => onOpenAlbum(row.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-right hover:bg-muted/50">
                        <span className="min-w-0"><b className="tabular-nums" dir="ltr">{row.albumNo}</b> · {row.customerName} <span className="text-xs text-muted-foreground">({albumStageLabel(row.stage)})</span></span>
                        <b className="tabular-nums text-destructive">{money(row.remainingAmount)}</b>
                      </button></li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-muted-foreground">لا توجد أرصدة مستحقة على الألبومات.</p>}
              </section>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "bad" ? "text-destructive" : tone === "good" ? "text-status-success" : tone === "warn" ? "text-status-warning" : "text-foreground";
  return <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</p></div>;
}

function reportHtml(data: Reports) {
  const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const rows = (cells: unknown[][]) => cells.map((cells) => `<tr>${cells.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>تقرير الألبومات</title><style>
    @page { size: A4; margin: 12mm; } body { font-family: Cairo, Tahoma, Arial, sans-serif; font-size: 12px; color: #111; }
    h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 16px 0 6px; } table { width: 100%; border-collapse: collapse; }
    td, th { border: 1px solid #ddd; padding: 4px 6px; text-align: right; } th { background: #f4f1f2; } .muted { color: #666; }
  </style></head><body>
    <h1>تقرير الألبومات</h1><p class="muted">${esc(data.from)} — ${esc(data.to)}</p>
    <table>${rows([["طلبات الفترة", data.status.total], ["مُسلّمة", data.status.completed], ["سُلّمت متأخرة", data.status.completedLate], ["متأخرة الآن", data.status.delayed]])}</table>
    ${data.finance ? `<h2>المالية</h2><table>${rows([["المبيعات", money(data.finance.sales)], ["إجمالي التكلفة", money(data.finance.totalCost)], ["صافي الربح", money(data.finance.netProfit)], ["ألبومات ضمن باقات", data.finance.packageAlbums]])}</table>` : ""}
    <h2>إنتاجية الموظفين</h2><table><tr><th>الموظف</th><th>تصاميم</th><th>طباعة</th><th>تجليد</th><th>فحص جودة</th><th>تسليم</th></tr>${rows(data.staff.map((row) => [row.staffName, row.designs, row.prints, row.bindings, row.qualityChecks, row.deliveries]))}</table>
    ${data.outstanding?.length ? `<h2>الأرصدة المستحقة</h2><table><tr><th>الألبوم</th><th>الزبون</th><th>الهاتف</th><th>المتبقي</th></tr>${rows(data.outstanding.map((row) => [row.albumNo, row.customerName, row.phone, money(row.remainingAmount)]))}</table>` : ""}
  </body></html>`;
}
