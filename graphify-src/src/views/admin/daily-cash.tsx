import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Calendar,
  Download,
  FileText,
  Printer,
  RefreshCw,
  Save,
  Search,
  Wallet,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadElementPdf } from "@/lib/pdf";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "./_layout";
import { adminFetch, formatCurrency } from "./_lib";

type PageMode = "reports" | "reconciliation";
type CashStatus = "balanced" | "surplus" | "shortage" | "not_reconciled";

type DailyCashRow = {
  reportDate: string;
  openingBalance: number;
  totalSales: number;
  totalExpenses: number;
  closingBalance: number;
  expectedCashBalance: number;
  actualCashInDrawer: number | null;
  difference: number | null;
  status: CashStatus;
  notes: string;
  reconciliationNotes: string;
  createdByName: string;
  updatedByName: string;
  updatedAt: string | null;
  reconciliationUpdatedAt: string | null;
  hasManualOpeningBalance: boolean;
  breakdown: {
    invoiceSales: number;
    productOrderSales: number;
    serviceOrderSales: number;
    invoiceCount: number;
    productOrderCount: number;
    serviceOrderCount: number;
  };
};

type DailyCashPayload = {
  data: DailyCashRow[];
  chart: { date: string; sales: number; expenses: number; closing: number; difference: number }[];
  totals: {
    openingBalance: number;
    totalSales: number;
    totalExpenses: number;
    closingBalance: number;
    actualCashInDrawer: number;
    difference: number;
  };
  page: number;
  limit: number;
  total: number;
  from: string;
  to: string;
};

type DailyCashColumn = {
  key: string;
  label: string;
  center?: boolean;
};

type Filters = {
  from: string;
  to: string;
  search: string;
};

const TODAY = new Date().toISOString().slice(0, 10);
const LAST_30 = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
const DEFAULT_FILTERS: Filters = { from: LAST_30, to: TODAY, search: "" };
const inputCls = "admin-daily-cash-input";

const STATUS_LABELS: Record<CashStatus, string> = {
  balanced: "متوازن",
  surplus: "زيادة نقدية",
  shortage: "نقص نقدي",
  not_reconciled: "غير مجرود",
};

const STATUS_CLASSES: Record<CashStatus, string> = {
  balanced: "bg-status-success/10 text-status-success border-status-success/20",
  surplus: "bg-primary/10 text-primary border-primary/20",
  shortage: "bg-status-danger/10 text-status-danger border-status-danger/20",
  not_reconciled: "bg-muted/30 text-muted-foreground border-border/30",
};

export function DailyCashReportsPage() {
  return <DailyCashPage mode="reports" />;
}

export function DailyCashReconciliationPage() {
  return <DailyCashPage mode="reconciliation" />;
}

export default DailyCashReportsPage;

function DailyCashPage({ mode }: { mode: PageMode }) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [reportDraft, setReportDraft] = useState({ reportDate: TODAY, openingBalance: "", notes: "" });
  const [reconciliationDraft, setReconciliationDraft] = useState({
    reportDate: TODAY,
    openingBalance: "",
    actualCashInDrawer: "",
    notes: "",
  });

  const isReconciliation = mode === "reconciliation";
  const title = isReconciliation ? "جرد الصندوق اليومي" : "تقارير الصندوق اليومية";
  const description = isReconciliation
    ? "مطابقة النقد الفعلي مع الرصيد المتوقع للصندوق"
    : "رصيد الافتتاح والمبيعات والمصاريف ورصيد الإغلاق لكل يوم";

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("from", appliedFilters.from);
    params.set("to", appliedFilters.to);
    params.set("page", String(page));
    params.set("limit", "20");
    if (appliedFilters.search.trim()) params.set("search", appliedFilters.search.trim());
    return params.toString();
  }, [appliedFilters, page]);

  const cashQuery = useQuery<DailyCashPayload>({
    queryKey: ["admin", "daily-cash", mode, appliedFilters, page],
    queryFn: () => adminFetch(`/admin/daily-cash/${isReconciliation ? "reconciliation" : "reports"}?${queryString}`),
  });

  const rows = cashQuery.data?.data ?? [];
  const totals = cashQuery.data?.totals;
  const totalPages = Math.max(1, Math.ceil((cashQuery.data?.total ?? 0) / (cashQuery.data?.limit ?? 20)));

  const saveReport = useMutation({
    mutationFn: (payload: typeof reportDraft) => adminFetch<DailyCashRow>("/admin/daily-cash/reports", {
      method: "POST",
      body: JSON.stringify({
        reportDate: payload.reportDate,
        openingBalance: payload.openingBalance || 0,
        notes: payload.notes || undefined,
      }),
    }),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "daily-cash"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      setReportDraft((current) => ({ ...current, openingBalance: String(row.openingBalance), notes: row.notes || "" }));
      toast({ title: "تم حفظ تقرير الصندوق", description: row.reportDate });
    },
    onError: (err: any) => toast({ title: "تعذر حفظ التقرير", description: err?.message, variant: "destructive" }),
  });

  const saveReconciliation = useMutation({
    mutationFn: (payload: typeof reconciliationDraft) => adminFetch<DailyCashRow>("/admin/daily-cash/reconciliation", {
      method: "POST",
      body: JSON.stringify({
        reportDate: payload.reportDate,
        openingBalance: payload.openingBalance === "" ? undefined : payload.openingBalance,
        actualCashInDrawer: payload.actualCashInDrawer || 0,
        notes: payload.notes || undefined,
      }),
    }),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "daily-cash"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      setReconciliationDraft((current) => ({
        ...current,
        openingBalance: String(row.openingBalance),
        actualCashInDrawer: String(row.actualCashInDrawer ?? ""),
        notes: row.reconciliationNotes || "",
      }));
      toast({ title: "تم حفظ جرد الصندوق", description: STATUS_LABELS[row.status] ?? row.reportDate });
    },
    onError: (err: any) => toast({ title: "تعذر حفظ الجرد", description: err?.message, variant: "destructive" }),
  });

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    setPage(1);
    setAppliedFilters(filters);
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  async function exportPdf() {
    setExportingPdf(true);
    try {
      await downloadElementPdf(pageRef.current, `${title}.pdf`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "تعذر تصدير PDF");
    } finally {
      setExportingPdf(false);
    }
  }

  function exportCsv() {
    const csvRows = [tableColumns(mode).map((column) => column.label).join(",")];
    for (const row of rows) {
      csvRows.push(tableColumns(mode).map((column) => `"${formatColumn(row, column.key).replace(/"/g, '""')}"`).join(","));
    }
    downloadBlob(`\uFEFF${csvRows.join("\n")}`, `${title}.csv`, "text/csv;charset=utf-8");
  }

  function printPage() {
    const popup = window.open("", "_blank", "width=1100,height=760");
    if (!popup) {
      alert("تعذر فتح نافذة الطباعة");
      return;
    }
    popup.document.write(buildPrintHtml(title, mode, rows, totals));
    popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 250);
  }

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={printPage} disabled={rows.length === 0} className="gap-2">
            <Printer className="w-4 h-4" />
            طباعة
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={rows.length === 0 || exportingPdf} className="gap-2">
            <FileText className="w-4 h-4" />
            {exportingPdf ? "جاري التصدير..." : "PDF"}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0} className="gap-2">
            <Download className="w-4 h-4" />
            CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="bg-card rounded-xl border border-border/40 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <FilterField label="من تاريخ">
              <input type="date" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} className={inputCls} />
            </FilterField>
            <FilterField label="إلى تاريخ">
              <input type="date" value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} className={inputCls} />
            </FilterField>
            <FilterField label="بحث">
              <input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="تاريخ، حالة، موظف، ملاحظات" className={inputCls} />
            </FilterField>
            <div className="flex gap-2">
              <Button size="sm" onClick={applyFilters} className="h-10 flex-1 gap-2">
                <Search className="w-4 h-4" />
                عرض
              </Button>
              <Button variant="outline" size="sm" onClick={resetFilters} className="h-10 gap-2">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border/40 p-4">
          {isReconciliation ? (
            <ReconciliationForm draft={reconciliationDraft} onChange={setReconciliationDraft} onSave={() => saveReconciliation.mutate(reconciliationDraft)} pending={saveReconciliation.isPending} />
          ) : (
            <ReportForm draft={reportDraft} onChange={setReportDraft} onSave={() => saveReport.mutate(reportDraft)} pending={saveReport.isPending} />
          )}
        </div>
      </div>

      <div ref={pageRef} className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatCard label="رصيد الافتتاح" value={formatCurrency(totals?.openingBalance ?? 0)} icon={WalletCards} />
          <StatCard label="إجمالي المبيعات" value={formatCurrency(totals?.totalSales ?? 0)} icon={Wallet} />
          <StatCard label="إجمالي المصاريف" value={formatCurrency(totals?.totalExpenses ?? 0)} icon={FileText} />
          <StatCard label="رصيد الإغلاق" value={formatCurrency(totals?.closingBalance ?? 0)} icon={Calendar} />
          <StatCard label="النقد الفعلي" value={formatCurrency(totals?.actualCashInDrawer ?? 0)} icon={WalletCards} />
          <StatCard label="فرق الجرد" value={formatCurrency(totals?.difference ?? 0)} icon={Wallet} />
        </div>

        <div className="bg-card rounded-xl border border-border/40 p-4">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-semibold text-sm text-foreground">تدفق الصندوق اليومي</h2>
              <p className="text-xs text-muted-foreground">{cashQuery.data?.from ?? appliedFilters.from} إلى {cashQuery.data?.to ?? appliedFilters.to}</p>
            </div>
          </div>
          {cashQuery.isLoading ? (
            <Skeleton className="h-56 rounded-xl" />
          ) : !cashQuery.data?.chart.length ? (
            <EmptyState message="لا توجد بيانات للمخطط ضمن الفترة الحالية" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cashQuery.data.chart.slice(-45)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.35)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(value) => Number(value).toLocaleString("ar-IQ")} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} labelStyle={{ color: "#111827" }} />
                  <Bar dataKey="sales" name="المبيعات" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="المصاريف" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey={isReconciliation ? "difference" : "closing"} name={isReconciliation ? "فرق الجرد" : "الإغلاق"} fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
          <div className="overflow-x-auto">
            {cashQuery.isLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="h-10 rounded-lg" />)}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState message="لا توجد بيانات مطابقة للفلاتر الحالية" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 text-muted-foreground text-xs">
                    {tableColumns(mode).map((column) => (
                      <th key={column.key} className={`px-4 py-3 ${column.center ? "text-center" : "text-right"}`}>
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {rows.map((row) => (
                    <tr key={row.reportDate} className="hover:bg-muted/10">
                      {tableColumns(mode).map((column) => (
                        <td key={column.key} className={`px-4 py-3 ${column.center ? "text-center" : "text-right"}`}>
                          {renderColumn(row, column.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t border-border/30 p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>النتائج: {(cashQuery.data?.total ?? 0).toLocaleString("ar-IQ")}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>السابق</Button>
              <span>{page.toLocaleString("ar-IQ")} / {totalPages.toLocaleString("ar-IQ")}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>التالي</Button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .admin-daily-cash-input {
          width: 100%;
          background: hsl(var(--background));
          border: 1px solid hsl(var(--border) / 0.4);
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
          color: hsl(var(--foreground));
          min-height: 2.5rem;
        }
        .admin-daily-cash-input:focus {
          box-shadow: 0 0 0 1px hsl(var(--primary));
        }
      `}</style>
    </div>
  );
}

function ReportForm({
  draft,
  onChange,
  onSave,
  pending,
}: {
  draft: { reportDate: string; openingBalance: string; notes: string };
  onChange: (draft: { reportDate: string; openingBalance: string; notes: string }) => void;
  onSave: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold text-sm text-foreground">رصيد افتتاح اليوم</h2>
        <p className="text-xs text-muted-foreground">المبيعات والمصاريف تُحسب تلقائياً بعد الحفظ</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FilterField label="التاريخ"><input type="date" value={draft.reportDate} onChange={(event) => onChange({ ...draft, reportDate: event.target.value })} className={inputCls} /></FilterField>
        <FilterField label="رصيد الافتتاح"><input type="number" min="0" value={draft.openingBalance} onChange={(event) => onChange({ ...draft, openingBalance: event.target.value })} className={inputCls} placeholder="0" /></FilterField>
      </div>
      <FilterField label="ملاحظات"><textarea value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} className={`${inputCls} min-h-20`} /></FilterField>
      <Button onClick={onSave} disabled={pending || !draft.reportDate} className="w-full gap-2">
        <Save className="w-4 h-4" />
        {pending ? "جارٍ الحفظ..." : "حفظ التقرير"}
      </Button>
    </div>
  );
}

function ReconciliationForm({
  draft,
  onChange,
  onSave,
  pending,
}: {
  draft: { reportDate: string; openingBalance: string; actualCashInDrawer: string; notes: string };
  onChange: (draft: { reportDate: string; openingBalance: string; actualCashInDrawer: string; notes: string }) => void;
  onSave: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold text-sm text-foreground">جرد النقد الفعلي</h2>
        <p className="text-xs text-muted-foreground">النظام يحسب الرصيد المتوقع والفرق تلقائياً</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FilterField label="التاريخ"><input type="date" value={draft.reportDate} onChange={(event) => onChange({ ...draft, reportDate: event.target.value })} className={inputCls} /></FilterField>
        <FilterField label="رصيد الافتتاح"><input type="number" min="0" value={draft.openingBalance} onChange={(event) => onChange({ ...draft, openingBalance: event.target.value })} className={inputCls} placeholder="اختياري" /></FilterField>
        <FilterField label="النقد الفعلي في الصندوق"><input type="number" min="0" value={draft.actualCashInDrawer} onChange={(event) => onChange({ ...draft, actualCashInDrawer: event.target.value })} className={inputCls} placeholder="0" /></FilterField>
      </div>
      <FilterField label="ملاحظات الجرد"><textarea value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} className={`${inputCls} min-h-20`} /></FilterField>
      <Button onClick={onSave} disabled={pending || !draft.reportDate || !draft.actualCashInDrawer} className="w-full gap-2">
        <Save className="w-4 h-4" />
        {pending ? "جارٍ الحفظ..." : "حفظ الجرد"}
      </Button>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
      {children}
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Wallet }) {
  return (
    <div className="bg-card rounded-xl border border-border/40 p-4">
      <div className="flex items-center gap-2 text-primary mb-2">
        <Icon className="w-4 h-4" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold text-foreground truncate">{value}</p>
    </div>
  );
}

function tableColumns(mode: PageMode): DailyCashColumn[] {
  if (mode === "reconciliation") {
    return [
      { key: "reportDate", label: "التاريخ" },
      { key: "expectedCashBalance", label: "الرصيد المتوقع", center: true },
      { key: "actualCashInDrawer", label: "النقد الفعلي", center: true },
      { key: "difference", label: "الفرق", center: true },
      { key: "status", label: "الحالة", center: true },
      { key: "updatedByName", label: "آخر تعديل" },
    ];
  }
  return [
    { key: "reportDate", label: "التاريخ" },
    { key: "openingBalance", label: "الافتتاح", center: true },
    { key: "totalSales", label: "المبيعات", center: true },
    { key: "totalExpenses", label: "المصاريف", center: true },
    { key: "closingBalance", label: "الإغلاق", center: true },
    { key: "breakdown", label: "التفاصيل" },
    { key: "updatedByName", label: "آخر تعديل" },
  ];
}

function renderColumn(row: DailyCashRow, key: string) {
  if (key === "status") return <StatusBadge status={row.status} />;
  if (key === "breakdown") {
    return (
      <div className="text-xs text-muted-foreground leading-6">
        <span>فواتير {formatCurrency(row.breakdown.invoiceSales)}</span>
        <span className="mx-1">/</span>
        <span>طلبات {formatCurrency(row.breakdown.productOrderSales)}</span>
        <span className="mx-1">/</span>
        <span>حجوزات {formatCurrency(row.breakdown.serviceOrderSales)}</span>
      </div>
    );
  }
  const formatted = formatColumn(row, key);
  const moneyKeys = ["openingBalance", "totalSales", "totalExpenses", "closingBalance", "expectedCashBalance", "actualCashInDrawer", "difference"];
  return <span className={moneyKeys.includes(key) ? "font-medium text-primary" : ""}>{formatted}</span>;
}

function formatColumn(row: DailyCashRow, key: string) {
  if (key === "reportDate") return row.reportDate;
  if (key === "openingBalance") return formatCurrency(row.openingBalance);
  if (key === "totalSales") return formatCurrency(row.totalSales);
  if (key === "totalExpenses") return formatCurrency(row.totalExpenses);
  if (key === "closingBalance") return formatCurrency(row.closingBalance);
  if (key === "expectedCashBalance") return formatCurrency(row.expectedCashBalance);
  if (key === "actualCashInDrawer") return row.actualCashInDrawer == null ? "—" : formatCurrency(row.actualCashInDrawer);
  if (key === "difference") return row.difference == null ? "—" : formatCurrency(row.difference);
  if (key === "status") return STATUS_LABELS[row.status] ?? row.status;
  if (key === "updatedByName") return row.updatedByName || row.createdByName || "—";
  if (key === "breakdown") return `فواتير ${formatCurrency(row.breakdown.invoiceSales)} / طلبات ${formatCurrency(row.breakdown.productOrderSales)} / حجوزات ${formatCurrency(row.breakdown.serviceOrderSales)}`;
  return "—";
}

function StatusBadge({ status }: { status: CashStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs ${STATUS_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function buildPrintHtml(title: string, mode: PageMode, rows: DailyCashRow[], totals?: DailyCashPayload["totals"]) {
  const columns = tableColumns(mode);
  return `<!doctype html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #000; padding: 24px; }
          h1 { font-size: 20px; margin: 0 0 12px; }
          .totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
          .total { border: 1px solid #222; padding: 8px; border-radius: 6px; }
          .total span { display: block; font-size: 11px; color: #333; }
          .total strong { font-size: 14px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #222; padding: 7px; text-align: right; }
          th { background: #f2f2f2; font-weight: 700; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <div class="totals">
          <div class="total"><span>المبيعات</span><strong>${escapeHtml(formatCurrency(totals?.totalSales ?? 0))}</strong></div>
          <div class="total"><span>المصاريف</span><strong>${escapeHtml(formatCurrency(totals?.totalExpenses ?? 0))}</strong></div>
          <div class="total"><span>الإغلاق</span><strong>${escapeHtml(formatCurrency(totals?.closingBalance ?? 0))}</strong></div>
          <div class="total"><span>فرق الجرد</span><strong>${escapeHtml(formatCurrency(totals?.difference ?? 0))}</strong></div>
        </div>
        <table>
          <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(formatColumn(row, column.key))}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </body>
    </html>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] as string));
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
