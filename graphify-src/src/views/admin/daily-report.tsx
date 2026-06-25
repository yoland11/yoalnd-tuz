import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CreditCard, FileSpreadsheet, FileText, Printer, Receipt, Search, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadElementPdf } from "@/lib/pdf";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";

type DailyReportPayload = {
  date: string;
  summary: Record<string, number>;
  expensesByCategory: { category_name: string; total: number }[];
  rows: {
    invoices: Record<string, unknown>[];
    orders: Record<string, unknown>[];
    serviceBookings: Record<string, unknown>[];
    expenses: Record<string, unknown>[];
  };
};

const inputCls = "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50";
const today = () => new Date().toISOString().slice(0, 10);
const paymentMethods = [
  { value: "", label: "كل طرق الدفع" },
  { value: "cash", label: "نقد" },
  { value: "pos", label: "بطاقة / POS" },
  { value: "transfer", label: "تحويل" },
  { value: "cod", label: "عند الاستلام" },
];
const statuses = [
  { value: "", label: "كل الحالات" },
  { value: "paid", label: "مدفوع" },
  { value: "partial", label: "جزئي" },
  { value: "unpaid", label: "غير مدفوع" },
  { value: "completed", label: "مكتمل" },
  { value: "delivered", label: "مسلّم" },
  { value: "pending", label: "قيد الانتظار" },
];

export default function DailyFinancialReportPage() {
  const reportRef = useRef<HTMLDivElement | null>(null);
  const { data: settings } = usePublicSettings();
  const [filters, setFilters] = useState({ date: today(), paymentMethod: "", status: "", user: "" });
  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("date", filters.date);
    if (filters.paymentMethod) params.set("paymentMethod", filters.paymentMethod);
    if (filters.status) params.set("status", filters.status);
    if (filters.user.trim()) params.set("user", filters.user.trim());
    return params.toString();
  }, [filters]);
  const { data, isLoading } = useQuery<DailyReportPayload>({
    queryKey: ["admin", "reports", "daily", filters],
    queryFn: () => adminFetch(`/admin/reports/daily?${query}`),
  });

  const summary = data?.summary ?? {};
  const cards = [
    { label: "إجمالي المبيعات اليوم", value: summary.totalSales, icon: Wallet },
    { label: "حجوزات الخدمات", value: summary.totalServiceBookings, icon: CalendarDays },
    { label: "طلبات المتجر", value: summary.totalStoreOrders, icon: Receipt },
    { label: "الفواتير", value: summary.totalInvoices, icon: FileText },
    { label: "مصاريف اليوم", value: summary.totalExpenses, icon: CreditCard },
    { label: "مجموع التوصيل", value: summary.deliveryFeesTotal, icon: Receipt },
    { label: "الصافي بدون توصيل", value: summary.netSalesExcludingDelivery, icon: Wallet },
    { label: "صافي الربح", value: summary.netProfit, icon: Wallet },
    { label: "الكاش", value: summary.cashTotal, icon: CreditCard },
    { label: "البطاقة", value: summary.cardTotal, icon: CreditCard },
    { label: "التحويل", value: summary.transferTotal, icon: CreditCard },
    { label: "مدفوعات معلقة", value: summary.pendingPayments, icon: Search, plain: true },
    { label: "مدفوعات مكتملة", value: summary.completedPayments, icon: Search, plain: true },
  ];

  function exportExcel() {
    const rows = flattenRows(data);
    downloadCsv(`daily-report-${filters.date}.csv`, ["القسم", "المرجع", "التاريخ", "العميل/العنوان", "المبلغ", "الدفع", "الحالة"], rows);
  }

  async function exportPdf() {
    void recordReportAudit("report_pdf_exported", "التقرير اليومي", "pdf");
    await downloadElementPdf(reportRef.current, `daily-report-${filters.date}.pdf`);
  }

  function printReport(thermal = false) {
    if (!data) return;
    void recordReportAudit("report_printed", "التقرير اليومي", thermal ? "thermal" : "a4");
    const win = window.open("", "_blank", "width=920,height=760");
    if (!win) return;
    win.document.write(buildDailyPrintHtml(data, logoSrc(settings), thermal));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">التقرير اليومي</h1>
          <p className="text-sm text-muted-foreground">ملخص المبيعات والمصاريف والمدفوعات حسب اليوم</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => printReport(false)} disabled={!data}><Printer className="w-4 h-4" /> طباعة A4</Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => printReport(true)} disabled={!data}><Printer className="w-4 h-4" /> حراري</Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportPdf} disabled={!data}><FileText className="w-4 h-4" /> PDF</Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportExcel} disabled={!data}><FileSpreadsheet className="w-4 h-4" /> Excel</Button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border/30 p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div><label className="block text-xs text-muted-foreground mb-1">التاريخ</label><input type="date" value={filters.date} onChange={(e) => setFilters((f) => ({ ...f, date: e.target.value }))} className={inputCls} /></div>
        <div><label className="block text-xs text-muted-foreground mb-1">طريقة الدفع</label><select value={filters.paymentMethod} onChange={(e) => setFilters((f) => ({ ...f, paymentMethod: e.target.value }))} className={inputCls}>{paymentMethods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
        <div><label className="block text-xs text-muted-foreground mb-1">الحالة</label><select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className={inputCls}>{statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
        <div><label className="block text-xs text-muted-foreground mb-1">الموظف</label><input value={filters.user} onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))} className={inputCls} placeholder="اسم الموظف" /></div>
      </div>

      <div ref={reportRef} className="space-y-4">
        <div className="bg-card rounded-xl border border-border/30 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src={logoSrc(settings)} alt="AJN" className="h-12 w-20 object-contain rounded-lg bg-background/60 border border-border/30" />
            <div>
              <p className="text-xs text-muted-foreground">مجموعة علي جان</p>
              <h2 className="font-bold text-foreground">التقرير اليومي - {filters.date}</h2>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{new Date().toLocaleString("ar-IQ")}</p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {cards.map((card) => (
              <div key={card.label} className="bg-card rounded-xl border border-border/30 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <card.icon className="w-4 h-4 text-primary" />
                </div>
                <p className="text-lg font-bold text-foreground">{card.plain ? Number(card.value ?? 0).toLocaleString("ar-IQ") : formatCurrency(card.value ?? 0)}</p>
              </div>
            ))}
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-4">
          <ReportTable title="الفواتير" rows={data?.rows.invoices ?? []} columns={["ref", "customer", "total", "payment_method", "payment_status"]} />
          <ReportTable title="طلبات المتجر" rows={data?.rows.orders ?? []} columns={["ref", "customer", "total", "delivery_fee", "payment_status"]} />
          <ReportTable title="حجوزات الخدمات" rows={data?.rows.serviceBookings ?? []} columns={["ref", "customer", "total", "payment_status", "status"]} />
          <ReportTable title="المصاريف" rows={data?.rows.expenses ?? []} columns={["title", "category_name", "amount", "payment_method", "created_by_name"]} />
        </div>
      </div>
    </div>
  );
}

function ReportTable({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  return (
    <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/30"><h3 className="font-semibold text-foreground">{title}</h3></div>
      {rows.length === 0 ? <EmptyState message="لا توجد بيانات" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground bg-background/50">{columns.map((c) => <th key={c} className="px-3 py-2 text-right">{labelFor(c)}</th>)}</tr></thead>
            <tbody className="divide-y divide-border/15">
              {rows.map((row, index) => <tr key={index}>{columns.map((c) => <td key={c} className="px-3 py-2 text-foreground">{formatValue(row[c])}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function labelFor(key: string) {
  const labels: Record<string, string> = { ref: "المرجع", customer: "العميل", total: "المبلغ", amount: "المبلغ", delivery_fee: "التوصيل", payment_method: "الدفع", payment_status: "الدفع", status: "الحالة", title: "العنوان", category_name: "التصنيف", created_by_name: "بواسطة" };
  return labels[key] ?? key;
}

function formatValue(value: unknown) {
  if (value == null || value === "") return "—";
  if (["cash", "cod"].includes(String(value))) return "نقد";
  if (["pos", "card"].includes(String(value))) return "بطاقة";
  if (String(value) === "transfer") return "تحويل";
  if (["paid"].includes(String(value))) return "مدفوع";
  if (String(value) === "partial") return "جزئي";
  if (String(value) === "unpaid") return "غير مدفوع";
  const num = Number(value);
  if (Number.isFinite(num) && String(value).match(/^\d+(\.\d+)?$/)) return formatCurrency(num);
  return String(value);
}

function flattenRows(data?: DailyReportPayload): (string | number)[][] {
  if (!data) return [];
  const out: (string | number)[][] = [];
  const push = (section: string, rows: Record<string, unknown>[], amountKey: string) => rows.forEach((row) => out.push([section, String(row.ref ?? ""), String(row.date ?? data.date), String(row.customer ?? row.title ?? ""), String(row[amountKey] ?? row.total ?? ""), String(row.payment_method ?? ""), String(row.payment_status ?? row.status ?? "")]));
  push("الفواتير", data.rows.invoices, "total");
  push("طلبات المتجر", data.rows.orders, "total");
  push("حجوزات الخدمات", data.rows.serviceBookings, "total");
  push("المصاريف", data.rows.expenses, "amount");
  return out;
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildDailyPrintHtml(data: DailyReportPayload, logo: string, thermal: boolean) {
  const cards = Object.entries(data.summary).map(([key, value]) => `<div class="total"><span>${labelForSummary(key)}</span><strong>${Number(value).toLocaleString("ar-IQ")} د.ع</strong></div>`).join("");
  const rows = flattenRows(data).map((row) => `<tr>${row.slice(0, thermal ? 5 : 7).map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    @page{size:${thermal ? "80mm auto" : "A4"};margin:${thermal ? "4mm" : "12mm"}}
    *{color:#000!important;box-shadow:none!important;text-shadow:none!important}body{font-family:Arial,sans-serif;width:${thermal ? "72mm" : "auto"};background:#fff}
    .head{display:flex;justify-content:space-between;gap:10px;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:12px}img{width:${thermal ? "42px" : "68px"};height:52px;object-fit:contain}h1{font-size:${thermal ? "15px" : "20px"};margin:0}.meta{font-size:11px}.totals{display:grid;grid-template-columns:repeat(${thermal ? 2 : 4},1fr);gap:7px;margin:12px 0}.total{border:1px solid #000;padding:7px}.total span{display:block;font-size:10px}.total strong{font-size:12px}table{width:100%;border-collapse:collapse;font-size:${thermal ? "10px" : "12px"}}td,th{border:1px solid #000;padding:5px;font-weight:700}
  </style></head><body><div class="head"><div><img src="${escapeHtml(logo)}"><h1>التقرير اليومي</h1></div><div class="meta"><div>${data.date}</div><div>${new Date().toLocaleString("ar-IQ")}</div></div></div><div class="totals">${cards}</div><table><tbody>${rows}</tbody></table></body></html>`;
}

function labelForSummary(key: string) {
  const labels: Record<string, string> = { totalSales: "إجمالي المبيعات", totalServiceBookings: "الخدمات", totalStoreOrders: "المتجر", totalInvoices: "الفواتير", totalExpenses: "المصاريف", deliveryFeesTotal: "التوصيل", netSalesExcludingDelivery: "الصافي بدون توصيل", netProfit: "صافي الربح", cashTotal: "الكاش", cardTotal: "البطاقة", transferTotal: "التحويل", pendingPayments: "معلقة", completedPayments: "مكتملة" };
  return labels[key] ?? key;
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string));
}

function recordReportAudit(action: "report_printed" | "report_pdf_exported", title: string, format: string) {
  return adminFetch("/admin/reports/audit", { method: "POST", body: JSON.stringify({ action, title, format }) }).catch(() => null);
}
