import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeDollarSign,
  CalendarRange,
  Download,
  FileSpreadsheet,
  Loader2,
  Printer,
  Search,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { downloadElementPdf } from "@/lib/pdf";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { adminFetch, apiErrorMessage, fetchAdminMe, formatCurrency, hasPerm } from "./_lib";
import { assetSalesReportCss, printWhenImagesReadyScript } from "./print-helpers";

type SaleRow = {
  id: number;
  saleNo: string;
  productId: number;
  asset: string;
  assetCode: string;
  category: string | null;
  buyerName: string;
  buyerPhone: string | null;
  saleDate: string;
  purchaseCost: number;
  bookValue: number;
  salePrice: number;
  paidAmount: number;
  receivableAmount: number;
  profit: number;
  loss: number;
  paymentMethod: string;
  paymentStatus: string;
  accountName: string | null;
  invoiceNumber: string | null;
  disposalReference: string;
  accountingReference: string | null;
  soldByName: string;
};

type SalesResponse = {
  data: SaleRow[];
  categories: string[];
  summary: { count: number; salePrice: number; profit: number; loss: number; receivable: number };
};

const inputClass =
  "h-10 rounded-lg border border-border/40 bg-background px-3 text-sm text-foreground outline-none focus:border-primary";

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const paymentLabel = (value: string) =>
  value === "cash" ? "نقدي" : value === "bank_transfer" ? "تحويل بنكي" : "دفع جزئي";
const statusLabel = (value: string) => (value === "paid" ? "مدفوع" : "دفع جزئي");

export default function AssetSalesPage() {
  const { toast } = useToast();
  const settings = usePublicSettings().data;
  const reportRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [working, setWorking] = useState<"print" | "pdf" | "excel" | null>(null);
  const meQuery = useQuery({ queryKey: ["admin", "me"], queryFn: () => fetchAdminMe(), staleTime: 60_000 });
  const params = useMemo(() => {
    const value = new URLSearchParams();
    if (search.trim()) value.set("q", search.trim());
    if (from) value.set("from", from);
    if (to) value.set("to", to);
    if (category) value.set("category", category);
    if (paymentStatus) value.set("paymentStatus", paymentStatus);
    return value.toString();
  }, [search, from, to, category, paymentStatus]);
  const query = useQuery<SalesResponse>({
    queryKey: ["asset-sales", params],
    queryFn: () => adminFetch(`/admin/assets/sales${params ? `?${params}` : ""}`),
  });
  const rows = query.data?.data ?? [];
  const summary = query.data?.summary ?? { count: 0, salePrice: 0, profit: 0, loss: 0, receivable: 0 };

  const filterDescription = [
    search.trim() ? `البحث: ${search.trim()}` : null,
    from ? `من: ${from}` : null,
    to ? `إلى: ${to}` : null,
    category ? `الفئة: ${category}` : null,
    paymentStatus ? `السداد: ${statusLabel(paymentStatus)}` : null,
  ].filter(Boolean).join(" · ") || "كل مبيعات الأصول";

  const reportMarkup = useMemo(() => {
    const body = rows.map((row) => `<tr>
      <td>${escapeHtml(row.saleNo)}</td><td>${escapeHtml(row.asset)}<br><small>${escapeHtml(row.assetCode)}</small></td>
      <td>${escapeHtml(row.category || "—")}</td><td>${escapeHtml(row.buyerName)}</td><td>${escapeHtml(row.saleDate)}</td>
      <td class="num">${escapeHtml(formatCurrency(row.purchaseCost))}</td><td class="num">${escapeHtml(formatCurrency(row.bookValue))}</td>
      <td class="num">${escapeHtml(formatCurrency(row.salePrice))}</td><td class="num profit">${escapeHtml(formatCurrency(row.profit))}</td>
      <td class="num">${escapeHtml(formatCurrency(row.loss))}</td><td>${escapeHtml(statusLabel(row.paymentStatus))}</td>
      <td>${escapeHtml(row.accountName || "—")}</td><td>${escapeHtml(row.invoiceNumber || "—")}</td>
    </tr>`).join("");
    return `<div class="report-sheet asset-sales-sheet" dir="rtl">
      <header class="report-head"><div><div class="report-company">${escapeHtml(settings?.site_name || "مجموعة علي جان نهاد")}</div><div class="report-title">تقرير مبيعات الأصول</div></div>${settings ? `<img class="report-logo" src="${escapeHtml(logoSrc(settings))}" alt="AJN">` : ""}</header>
      <div class="report-meta">تاريخ الإصدار: ${escapeHtml(new Date().toLocaleString("ar-IQ"))}</div>
      <div class="filter-note">${escapeHtml(filterDescription)}</div>
      <section class="report-summary"><div class="report-stat">عدد المبيعات<strong>${summary.count.toLocaleString("ar-IQ")}</strong></div><div class="report-stat">إجمالي البيع<strong>${escapeHtml(formatCurrency(summary.salePrice))}</strong></div><div class="report-stat">الأرباح<strong>${escapeHtml(formatCurrency(summary.profit))}</strong></div><div class="report-stat">الخسائر<strong>${escapeHtml(formatCurrency(summary.loss))}</strong></div><div class="report-stat">الذمم المدينة<strong>${escapeHtml(formatCurrency(summary.receivable))}</strong></div></section>
      <table class="report-table"><thead><tr><th>المرجع</th><th>الأصل</th><th>الفئة</th><th>المشتري</th><th>التاريخ</th><th>كلفة الشراء</th><th>القيمة الدفترية</th><th>سعر البيع</th><th>الربح</th><th>الخسارة</th><th>السداد</th><th>الحساب</th><th>الفاتورة</th></tr></thead><tbody>${body || `<tr><td colspan="13">لا توجد نتائج</td></tr>`}</tbody></table>
      <footer class="report-footer">تقرير صادر من نظام AJN ERP · سجلات البيع والأصول محفوظة ولا تُحذف</footer>
    </div>`;
  }, [rows, settings, summary, filterDescription]);

  const audit = (action: "print" | "pdf" | "excel") =>
    adminFetch("/admin/assets/sales/audit", { method: "POST", body: JSON.stringify({ action, filters: { search, from, to, category, paymentStatus }, rowCount: rows.length }) });

  const printReport = async () => {
    setWorking("print");
    try {
      await audit("print");
      const popup = window.open("", "_blank", "width=1250,height=850");
      if (!popup) throw new Error("تعذّر فتح نافذة الطباعة");
      popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير مبيعات الأصول</title><style>${assetSalesReportCss()}</style></head><body>${reportMarkup}${printWhenImagesReadyScript()}</body></html>`);
      popup.document.close();
    } catch (cause) {
      toast({ title: "تعذّرت الطباعة", description: apiErrorMessage(cause), variant: "destructive" });
    } finally { setWorking(null); }
  };

  const exportPdf = async () => {
    setWorking("pdf");
    try {
      await audit("pdf");
      await downloadElementPdf(reportRef.current, `asset-sales-${new Date().toISOString().slice(0, 10)}.pdf`, { format: "a4", margin: 7, scale: 2, pagebreakMode: ["css", "legacy"] });
    } catch (cause) {
      toast({ title: "تعذّر تصدير PDF", description: apiErrorMessage(cause), variant: "destructive" });
    } finally { setWorking(null); }
  };

  const exportExcel = async () => {
    setWorking("excel");
    try {
      await audit("excel");
      const excelRows = rows.map((row) => `<tr><td>${escapeHtml(row.asset)}</td><td>${escapeHtml(row.assetCode)}</td><td>${escapeHtml(row.category || "")}</td><td>${escapeHtml(row.buyerName)}</td><td>${escapeHtml(row.saleDate)}</td><td>${row.purchaseCost}</td><td>${row.bookValue}</td><td>${row.salePrice}</td><td>${row.profit}</td><td>${row.loss}</td><td>${escapeHtml(statusLabel(row.paymentStatus))}</td><td>${escapeHtml(row.accountName || "")}</td><td>${escapeHtml(row.invoiceNumber || "")}</td></tr>`).join("");
      const workbook = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body dir="rtl"><table><tr><th>الأصل</th><th>كود الأصل</th><th>الفئة</th><th>المشتري</th><th>تاريخ البيع</th><th>كلفة الشراء</th><th>القيمة الدفترية</th><th>سعر البيع</th><th>الربح</th><th>الخسارة</th><th>السداد</th><th>الصندوق/الحساب</th><th>الفاتورة</th></tr>${excelRows}</table></body></html>`;
      const url = URL.createObjectURL(new Blob(["\ufeff", workbook], { type: "application/vnd.ms-excel;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `asset-sales-${new Date().toISOString().slice(0, 10)}.xls`; link.click(); URL.revokeObjectURL(url);
    } catch (cause) {
      toast({ title: "تعذّر تصدير Excel", description: apiErrorMessage(cause), variant: "destructive" });
    } finally { setWorking(null); }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="flex items-center gap-2 text-2xl font-bold"><BadgeDollarSign className="h-6 w-6 text-primary" /> مبيعات الأصول</h1><p className="mt-1 text-sm text-muted-foreground">سجل دائم لبيع الأصول ونتيجة الربح أو الخسارة والقيود المالية المرتبطة.</p></div>
        <div className="flex flex-wrap gap-2">
          {hasPerm(meQuery.data ?? null, "asset.print_sales") ? <Button variant="outline" onClick={printReport} disabled={!rows.length || working !== null} className="gap-1.5">{working === "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} طباعة</Button> : null}
          {hasPerm(meQuery.data ?? null, "asset.export_sales") ? <><Button variant="outline" onClick={exportPdf} disabled={!rows.length || working !== null} className="gap-1.5">{working === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF</Button><Button variant="outline" onClick={exportExcel} disabled={!rows.length || working !== null} className="gap-1.5">{working === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel</Button></> : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          [BadgeDollarSign, "عدد المبيعات", summary.count.toLocaleString("ar-IQ")], [WalletCards, "إجمالي البيع", formatCurrency(summary.salePrice)],
          [TrendingUp, "الأرباح", formatCurrency(summary.profit)], [TrendingDown, "الخسائر", formatCurrency(summary.loss)], [CalendarRange, "الذمم المدينة", formatCurrency(summary.receivable)],
        ].map(([Icon, label, value]) => { const MetricIcon = Icon as typeof BadgeDollarSign; return <div key={String(label)} className="rounded-xl border border-border/35 bg-card p-4 shadow-sm"><MetricIcon className="h-4 w-4 text-primary" /><p className="mt-3 text-xs text-muted-foreground">{String(label)}</p><p className="mt-1 text-lg font-bold">{String(value)}</p></div>; })}
      </div>

      <section className="rounded-xl border border-border/35 bg-card p-4 shadow-sm">
        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_150px_150px_180px_160px]">
          <label className="relative"><Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" /><input className={`${inputClass} w-full pr-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالأصل أو الكود أو المشتري أو الفاتورة" /></label>
          <input className={inputClass} type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="من تاريخ" />
          <input className={inputClass} type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="إلى تاريخ" />
          <select className={inputClass} value={category} onChange={(event) => setCategory(event.target.value)}><option value="">كل الفئات</option>{query.data?.categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select className={inputClass} value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}><option value="">كل حالات الدفع</option><option value="paid">مدفوع</option><option value="partial">دفع جزئي</option></select>
        </div>
        {query.isLoading ? <Skeleton className="mt-4 h-72" /> : query.isError ? <p className="mt-4 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{apiErrorMessage(query.error)}</p> : !rows.length ? <p className="mt-4 rounded-lg border border-dashed border-border/50 p-10 text-center text-sm text-muted-foreground">لا توجد مبيعات أصول مطابقة.</p> : (
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[1280px] text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-3 text-right">الأصل</th><th className="p-3 text-right">المشتري</th><th className="p-3 text-right">تاريخ البيع</th><th className="p-3 text-right">كلفة الشراء</th><th className="p-3 text-right">القيمة الدفترية</th><th className="p-3 text-right">سعر البيع</th><th className="p-3 text-right">الربح</th><th className="p-3 text-right">الخسارة</th><th className="p-3 text-right">السداد</th><th className="p-3 text-right">الصندوق / البنك</th><th className="p-3 text-right">الفاتورة</th></tr></thead><tbody className="divide-y divide-border/25">{rows.map((row) => <tr key={row.id} className="hover:bg-muted/20"><td className="p-3"><p className="font-semibold">{row.asset}</p><p className="text-xs text-muted-foreground">{row.assetCode} · {row.category || "بدون فئة"}</p></td><td className="p-3"><p>{row.buyerName}</p><p className="text-xs text-muted-foreground" dir="ltr">{row.buyerPhone || "—"}</p></td><td className="p-3">{row.saleDate}</td><td className="p-3">{formatCurrency(row.purchaseCost)}</td><td className="p-3">{formatCurrency(row.bookValue)}</td><td className="p-3 font-semibold">{formatCurrency(row.salePrice)}</td><td className="p-3 text-emerald-500">{row.profit ? formatCurrency(row.profit) : "—"}</td><td className="p-3 text-destructive">{row.loss ? formatCurrency(row.loss) : "—"}</td><td className="p-3"><p>{statusLabel(row.paymentStatus)}</p><p className="text-xs text-muted-foreground">{paymentLabel(row.paymentMethod)}</p></td><td className="p-3">{row.accountName || "—"}</td><td className="p-3">{row.invoiceNumber || "—"}</td></tr>)}</tbody></table></div>
        )}
      </section>

      <div className="fixed -left-[10000px] top-0 w-[1120px] bg-white" aria-hidden="true"><style>{assetSalesReportCss()}</style><div ref={reportRef} dangerouslySetInnerHTML={{ __html: reportMarkup }} /></div>
    </div>
  );
}
