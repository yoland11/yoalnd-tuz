import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Calendar,
  Download,
  FileSpreadsheet,
  FileText,
  Package,
  PieChart,
  Printer,
  RefreshCw,
  Search,
  ShoppingBag,
  Tags,
  Truck,
  UserRound,
  Users,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadElementPdf } from "@/lib/pdf";
import { adminFetch, formatCurrency } from "./_lib";

type ReportType =
  | "invoice-sales"
  | "invoice-details"
  | "customers"
  | "products"
  | "categories"
  | "staff"
  | "profit-daily"
  | "profit-monthly"
  | "delivery"
  | "returns";

type ColumnType = "text" | "number" | "money" | "date" | "status" | "payment";
type ReportColumn = { key: string; label: string; type?: ColumnType; align?: "right" | "center" };
type TotalDef = { key: string; label: string; type?: "number" | "money" };
type ReportConfig = {
  id: ReportType;
  label: string;
  description: string;
  icon: typeof BarChart3;
  columns: ReportColumn[];
  totals: TotalDef[];
  chartLabelKey: string;
  chartValueKey: string;
};
type ReportPayload = { type: ReportType; from: string; to: string; rows: Record<string, unknown>[] };
type ReportOption = { value: string; label: string };
type ReportOptions = {
  customers: ReportOption[];
  products: ReportOption[];
  categories: ReportOption[];
  paymentMethods: ReportOption[];
};
type Filters = {
  from: string;
  to: string;
  customer: string;
  product: string;
  category: string;
  paymentMethod: string;
};

const THIS_MONTH_FROM = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);
const DEFAULT_FILTERS: Filters = { from: THIS_MONTH_FROM, to: TODAY, customer: "", product: "", category: "", paymentMethod: "" };

const PAYMENT_LABELS: Record<string, string> = {
  cash: "نقدي",
  card: "بطاقة",
  transfer: "تحويل",
  cod: "عند الاستلام",
};

const STATUS_LABELS: Record<string, string> = {
  paid: "مدفوع",
  partial: "جزئي",
  unpaid: "غير مدفوع",
  active: "فعالة",
  returned: "مرتجع",
  refunded: "مسترجع",
  pending: "قيد الانتظار",
  processing: "قيد التجهيز",
  completed: "مكتمل",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

const REPORTS: ReportConfig[] = [
  {
    id: "invoice-sales",
    label: "مبيعات الفواتير",
    description: "الفواتير مع العميل والدفع والإجماليات",
    icon: ShoppingBag,
    chartLabelKey: "invoice_no",
    chartValueKey: "net_total",
    totals: [
      { key: "__rows", label: "عدد الفواتير", type: "number" },
      { key: "subtotal", label: "إجمالي المبيعات", type: "money" },
      { key: "discount", label: "إجمالي الخصومات", type: "money" },
      { key: "net_total", label: "صافي المبيعات", type: "money" },
      { key: "remaining_amount", label: "المتبقي", type: "money" },
    ],
    columns: [
      { key: "invoice_no", label: "رقم الفاتورة" },
      { key: "date", label: "التاريخ", type: "date", align: "center" },
      { key: "customer_name", label: "العميل" },
      { key: "staff_name", label: "الموظف" },
      { key: "item_count", label: "الأصناف", type: "number", align: "center" },
      { key: "subtotal", label: "الإجمالي", type: "money", align: "center" },
      { key: "discount", label: "الخصم", type: "money", align: "center" },
      { key: "net_total", label: "الصافي", type: "money", align: "center" },
      { key: "payment_method", label: "الدفع", type: "payment", align: "center" },
      { key: "payment_status", label: "الحالة", type: "status", align: "center" },
    ],
  },
  {
    id: "invoice-details",
    label: "مبيعات الفواتير التفصيلية",
    description: "كل صنف داخل الفواتير",
    icon: FileText,
    chartLabelKey: "product_name",
    chartValueKey: "total",
    totals: [
      { key: "__rows", label: "عدد الأسطر", type: "number" },
      { key: "quantity", label: "إجمالي الكمية", type: "number" },
      { key: "total", label: "إجمالي المبيعات", type: "money" },
      { key: "profit", label: "إجمالي الربح", type: "money" },
    ],
    columns: [
      { key: "invoice_no", label: "رقم الفاتورة" },
      { key: "date", label: "التاريخ", type: "date", align: "center" },
      { key: "customer_name", label: "العميل" },
      { key: "product_name", label: "الصنف" },
      { key: "category_name", label: "القسم" },
      { key: "quantity", label: "الكمية", type: "number", align: "center" },
      { key: "unit_price", label: "سعر البيع", type: "money", align: "center" },
      { key: "discount", label: "الخصم", type: "money", align: "center" },
      { key: "total", label: "الإجمالي", type: "money", align: "center" },
    ],
  },
  {
    id: "customers",
    label: "مبيعات العملاء",
    description: "ترتيب العملاء حسب الأعلى مبيعاً",
    icon: Users,
    chartLabelKey: "customer_name",
    chartValueKey: "net_sales",
    totals: [
      { key: "__rows", label: "عدد العملاء", type: "number" },
      { key: "invoice_count", label: "عدد الفواتير", type: "number" },
      { key: "gross_sales", label: "إجمالي المبيعات", type: "money" },
      { key: "discounts", label: "الخصومات", type: "money" },
      { key: "net_sales", label: "الصافي", type: "money" },
    ],
    columns: [
      { key: "customer_name", label: "العميل" },
      { key: "customer_phone", label: "الهاتف" },
      { key: "invoice_count", label: "عدد الفواتير", type: "number", align: "center" },
      { key: "gross_sales", label: "إجمالي المبيعات", type: "money", align: "center" },
      { key: "discounts", label: "الخصومات", type: "money", align: "center" },
      { key: "net_sales", label: "الصافي", type: "money", align: "center" },
      { key: "remaining_amount", label: "المتبقي", type: "money", align: "center" },
    ],
  },
  {
    id: "products",
    label: "مبيعات المنتجات",
    description: "الأصناف الأكثر مبيعاً وربحاً",
    icon: Package,
    chartLabelKey: "product_name",
    chartValueKey: "total_revenue",
    totals: [
      { key: "__rows", label: "عدد المنتجات", type: "number" },
      { key: "total_qty", label: "الكمية المباعة", type: "number" },
      { key: "total_revenue", label: "إجمالي المبيعات", type: "money" },
      { key: "total_cost", label: "التكلفة", type: "money" },
      { key: "profit", label: "الربح", type: "money" },
    ],
    columns: [
      { key: "product_name", label: "المنتج" },
      { key: "category_name", label: "القسم" },
      { key: "total_qty", label: "الكمية", type: "number", align: "center" },
      { key: "total_revenue", label: "المبيعات", type: "money", align: "center" },
      { key: "total_cost", label: "التكلفة", type: "money", align: "center" },
      { key: "profit", label: "الربح", type: "money", align: "center" },
    ],
  },
  {
    id: "categories",
    label: "مبيعات الأقسام",
    description: "أداء الأقسام في المتجر",
    icon: Tags,
    chartLabelKey: "category_name",
    chartValueKey: "total_revenue",
    totals: [
      { key: "__rows", label: "عدد الأقسام", type: "number" },
      { key: "invoice_count", label: "عدد الفواتير", type: "number" },
      { key: "total_qty", label: "الكمية", type: "number" },
      { key: "total_revenue", label: "المبيعات", type: "money" },
      { key: "profit", label: "الربح", type: "money" },
    ],
    columns: [
      { key: "category_name", label: "القسم" },
      { key: "invoice_count", label: "الفواتير", type: "number", align: "center" },
      { key: "total_qty", label: "الكمية", type: "number", align: "center" },
      { key: "total_revenue", label: "المبيعات", type: "money", align: "center" },
      { key: "profit", label: "الربح", type: "money", align: "center" },
    ],
  },
  {
    id: "staff",
    label: "مبيعات الموظفين",
    description: "أداء الموظفين حسب الفواتير",
    icon: UserRound,
    chartLabelKey: "staff_name",
    chartValueKey: "total_revenue",
    totals: [
      { key: "__rows", label: "عدد الموظفين", type: "number" },
      { key: "invoice_count", label: "عدد الفواتير", type: "number" },
      { key: "total_revenue", label: "إجمالي المبيعات", type: "money" },
      { key: "profit", label: "إجمالي الأرباح", type: "money" },
    ],
    columns: [
      { key: "staff_name", label: "الموظف" },
      { key: "invoice_count", label: "عدد الفواتير", type: "number", align: "center" },
      { key: "total_revenue", label: "إجمالي المبيعات", type: "money", align: "center" },
      { key: "profit", label: "إجمالي الأرباح", type: "money", align: "center" },
    ],
  },
  {
    id: "profit-daily",
    label: "الأرباح اليومية",
    description: "ربح كل يوم ضمن الفترة",
    icon: Calendar,
    chartLabelKey: "period",
    chartValueKey: "profit",
    totals: [
      { key: "__rows", label: "عدد الأيام", type: "number" },
      { key: "invoice_count", label: "عدد الفواتير", type: "number" },
      { key: "revenue", label: "المبيعات", type: "money" },
      { key: "cost", label: "التكلفة", type: "money" },
      { key: "profit", label: "الربح", type: "money" },
    ],
    columns: [
      { key: "period", label: "اليوم", type: "date" },
      { key: "invoice_count", label: "الفواتير", type: "number", align: "center" },
      { key: "revenue", label: "المبيعات", type: "money", align: "center" },
      { key: "cost", label: "التكلفة", type: "money", align: "center" },
      { key: "profit", label: "الربح", type: "money", align: "center" },
    ],
  },
  {
    id: "profit-monthly",
    label: "الأرباح الشهرية",
    description: "ربح كل شهر ضمن الفترة",
    icon: BarChart3,
    chartLabelKey: "period",
    chartValueKey: "profit",
    totals: [
      { key: "__rows", label: "عدد الأشهر", type: "number" },
      { key: "invoice_count", label: "عدد الفواتير", type: "number" },
      { key: "revenue", label: "المبيعات", type: "money" },
      { key: "cost", label: "التكلفة", type: "money" },
      { key: "profit", label: "الربح", type: "money" },
    ],
    columns: [
      { key: "period", label: "الشهر" },
      { key: "invoice_count", label: "الفواتير", type: "number", align: "center" },
      { key: "revenue", label: "المبيعات", type: "money", align: "center" },
      { key: "cost", label: "التكلفة", type: "money", align: "center" },
      { key: "profit", label: "الربح", type: "money", align: "center" },
    ],
  },
  {
    id: "delivery",
    label: "التوصيل",
    description: "مبالغ التوصيل منفصلة عن إيراد الصندوق",
    icon: Truck,
    chartLabelKey: "tracking_code",
    chartValueKey: "delivery_fee",
    totals: [
      { key: "__rows", label: "عدد الطلبات", type: "number" },
      { key: "gross_total", label: "إجمالي الطلبات", type: "money" },
      { key: "order_total", label: "إيراد الطلبات", type: "money" },
      { key: "delivery_fee", label: "إجمالي التوصيل", type: "money" },
    ],
    columns: [
      { key: "tracking_code", label: "رقم التتبع" },
      { key: "date", label: "التاريخ", type: "date", align: "center" },
      { key: "customer_name", label: "العميل" },
      { key: "order_total", label: "مبلغ الطلب", type: "money", align: "center" },
      { key: "delivery_fee", label: "التوصيل", type: "money", align: "center" },
      { key: "gross_total", label: "الإجمالي", type: "money", align: "center" },
      { key: "payment_status", label: "حالة الدفع", type: "status", align: "center" },
      { key: "status", label: "حالة الطلب", type: "status", align: "center" },
    ],
  },
  {
    id: "returns",
    label: "المرتجعات",
    description: "الفواتير المرتجعة إن وجدت",
    icon: RefreshCw,
    chartLabelKey: "invoice_no",
    chartValueKey: "total",
    totals: [
      { key: "__rows", label: "عدد المرتجعات", type: "number" },
      { key: "total", label: "قيمة المرتجعات", type: "money" },
    ],
    columns: [
      { key: "invoice_no", label: "رقم الفاتورة" },
      { key: "date", label: "التاريخ", type: "date", align: "center" },
      { key: "customer_name", label: "العميل" },
      { key: "customer_phone", label: "الهاتف" },
      { key: "status", label: "الحالة", type: "status", align: "center" },
      { key: "total", label: "القيمة", type: "money", align: "center" },
    ],
  },
];

export default function ReportsPage() {
  const reportRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<ReportType>("invoice-sales");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [exportingPdf, setExportingPdf] = useState(false);

  const activeReport = REPORTS.find((report) => report.id === tab) ?? REPORTS[0];
  const optionsQuery = useQuery<ReportOptions>({
    queryKey: ["admin", "reports", "options"],
    queryFn: () => adminFetch("/admin/reports/options"),
    staleTime: 5 * 60 * 1000,
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("type", tab);
    params.set("from", appliedFilters.from);
    params.set("to", appliedFilters.to);
    if (appliedFilters.customer.trim()) params.set("customer", appliedFilters.customer.trim());
    if (appliedFilters.product.trim()) params.set("product", appliedFilters.product.trim());
    if (appliedFilters.category.trim()) params.set("category", appliedFilters.category.trim());
    if (appliedFilters.paymentMethod.trim()) params.set("paymentMethod", appliedFilters.paymentMethod.trim());
    return params.toString();
  }, [appliedFilters, tab]);

  const reportQuery = useQuery<ReportPayload>({
    queryKey: ["admin", "reports", "table", tab, appliedFilters],
    queryFn: () => adminFetch(`/admin/reports/table?${queryString}`),
  });

  const rows = reportQuery.data?.rows ?? [];
  const totals = useMemo(() => activeReport.totals.map((total) => ({
    ...total,
    value: total.key === "__rows" ? rows.length : rows.reduce((sum, row) => sum + toNumber(row[total.key]), 0),
  })), [activeReport, rows]);
  const chartRows = useMemo(() => {
    const list = rows
      .map((row) => ({
        label: String(row[activeReport.chartLabelKey] ?? "—"),
        value: toNumber(row[activeReport.chartValueKey]),
      }))
      .filter((row) => row.value !== 0)
      .slice(0, 18);
    return list;
  }, [activeReport, rows]);
  const chartMax = Math.max(...chartRows.map((row) => Math.abs(row.value)), 1);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyQuickRange(nextFrom: string, nextTo: string) {
    const next = { ...filters, from: nextFrom, to: nextTo };
    setFilters(next);
    setAppliedFilters(next);
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
  }

  async function exportPdf() {
    setExportingPdf(true);
    try {
      await downloadElementPdf(reportRef.current, `${activeReport.label}.pdf`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "تعذر تصدير PDF");
    } finally {
      setExportingPdf(false);
    }
  }

  function exportCsv() {
    const csv = buildDelimitedExport(activeReport.columns, rows, ",");
    downloadBlob(`\uFEFF${csv}`, `${activeReport.label}.csv`, "text/csv;charset=utf-8");
  }

  function exportExcel() {
    const html = buildExcelHtml(activeReport.label, activeReport.columns, rows);
    downloadBlob(`\uFEFF${html}`, `${activeReport.label}.xls`, "application/vnd.ms-excel;charset=utf-8");
  }

  function printReport() {
    const popup = window.open("", "_blank", "width=1100,height=760");
    if (!popup) {
      alert("تعذر فتح نافذة الطباعة");
      return;
    }
    popup.document.write(buildPrintHtml(activeReport.label, activeReport.columns, rows, totals));
    popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 250);
  }

  return (
    <div dir="rtl" className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">تقارير المبيعات</h1>
        <p className="text-sm text-muted-foreground">تحليل الفواتير والعملاء والمنتجات والأرباح</p>
      </div>

      <div className="bg-card rounded-xl border border-border/40 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 items-end">
          <FilterField label="من تاريخ">
            <input
              type="date"
              value={filters.from}
              onChange={(event) => updateFilter("from", event.target.value)}
              className="admin-report-input"
            />
          </FilterField>
          <FilterField label="إلى تاريخ">
            <input
              type="date"
              value={filters.to}
              onChange={(event) => updateFilter("to", event.target.value)}
              className="admin-report-input"
            />
          </FilterField>
          <FilterField label="العميل">
            <input
              list="report-customers"
              value={filters.customer}
              onChange={(event) => updateFilter("customer", event.target.value)}
              placeholder="اسم أو هاتف"
              className="admin-report-input"
            />
            <datalist id="report-customers">
              {(optionsQuery.data?.customers ?? []).map((option) => (
                <option key={`${option.value}-${option.label}`} value={option.value}>{option.label}</option>
              ))}
            </datalist>
          </FilterField>
          <FilterField label="المنتج">
            <input
              list="report-products"
              value={filters.product}
              onChange={(event) => updateFilter("product", event.target.value)}
              placeholder="اسم أو باركود"
              className="admin-report-input"
            />
            <datalist id="report-products">
              {(optionsQuery.data?.products ?? []).map((option) => (
                <option key={option.value} value={option.label}>{option.value}</option>
              ))}
            </datalist>
          </FilterField>
          <FilterField label="القسم">
            <select
              value={filters.category}
              onChange={(event) => updateFilter("category", event.target.value)}
              className="admin-report-input"
            >
              <option value="">كل الأقسام</option>
              {(optionsQuery.data?.categories ?? []).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="طريقة الدفع">
            <select
              value={filters.paymentMethod}
              onChange={(event) => updateFilter("paymentMethod", event.target.value)}
              className="admin-report-input"
            >
              <option value="">كل الطرق</option>
              {(optionsQuery.data?.paymentMethods ?? []).map((option) => (
                <option key={option.value} value={option.value}>{PAYMENT_LABELS[option.value] ?? option.label}</option>
              ))}
            </select>
          </FilterField>
        </div>

        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              { label: "هذا الشهر", from: THIS_MONTH_FROM, to: TODAY },
              { label: "آخر 7 أيام", from: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10), to: TODAY },
              { label: "هذا العام", from: `${new Date().getFullYear()}-01-01`, to: TODAY },
            ].map((range) => (
              <Button
                key={range.label}
                variant="outline"
                size="sm"
                onClick={() => applyQuickRange(range.from, range.to)}
                className="text-xs"
              >
                {range.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAppliedFilters(filters)} className="gap-2">
              <Search className="w-4 h-4" />
              عرض التقرير
            </Button>
            <Button variant="outline" size="sm" onClick={resetFilters} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              إعادة تعيين
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-muted/20 rounded-xl p-1 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {REPORTS.map((report) => (
            <button
              key={report.id}
              onClick={() => setTab(report.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === report.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <report.icon className="w-4 h-4" />
              {report.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={printReport} disabled={rows.length === 0} className="gap-2">
          <Printer className="w-4 h-4" />
          طباعة
        </Button>
        <Button variant="outline" size="sm" onClick={exportPdf} disabled={rows.length === 0 || exportingPdf} className="gap-2">
          <FileText className="w-4 h-4" />
          {exportingPdf ? "جاري التصدير..." : "PDF"}
        </Button>
        <Button variant="outline" size="sm" onClick={exportExcel} disabled={rows.length === 0} className="gap-2">
          <FileSpreadsheet className="w-4 h-4" />
          Excel
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0} className="gap-2">
          <Download className="w-4 h-4" />
          CSV
        </Button>
      </div>

      <div ref={reportRef} className="space-y-4">
        <div className="bg-card rounded-xl border border-border/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="font-bold text-lg text-foreground">{activeReport.label}</h2>
              <p className="text-sm text-muted-foreground">{activeReport.description}</p>
            </div>
            <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
              {appliedFilters.from} إلى {appliedFilters.to}
            </div>
          </div>

          {reportQuery.isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((item) => <SkeletonCard key={item} />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              {totals.map((total) => (
                <StatCard
                  key={total.key}
                  label={total.label}
                  value={total.type === "money" ? formatCurrency(total.value) : formatNumber(total.value)}
                  icon={total.type === "money" ? WalletCards : PieChart}
                />
              ))}
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border/40 p-4">
          <h3 className="font-semibold text-sm mb-4">المخطط</h3>
          {reportQuery.isLoading ? (
            <SkeletonCard />
          ) : chartRows.length === 0 ? (
            <EmptyMsg msg="لا توجد بيانات للمخطط ضمن الفلاتر الحالية" />
          ) : (
            <div className="flex items-end gap-2 h-44 overflow-x-auto pb-2">
              {chartRows.map((item, index) => {
                const height = Math.max(4, Math.abs(item.value) / chartMax * 100);
                return (
                  <div key={`${item.label}-${index}`} className="flex flex-col items-center gap-2 min-w-[48px] flex-1">
                    <div className="relative w-full flex items-end justify-center" style={{ height: 128 }}>
                      <div
                        className={`w-full max-w-[42px] rounded-t transition-all ${item.value >= 0 ? "bg-primary/75" : "bg-red-500/75"}`}
                        style={{ height: `${height}%` }}
                        title={`${item.label}: ${formatCurrency(item.value)}`}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground max-w-[64px] truncate">{item.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
          <div className="overflow-x-auto">
            {reportQuery.isLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-10 bg-muted/20 rounded-lg animate-pulse" />)}
              </div>
            ) : rows.length === 0 ? (
              <EmptyMsg msg="لا توجد بيانات مطابقة للفلاتر الحالية" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 text-muted-foreground text-xs">
                    {activeReport.columns.map((column) => (
                      <th
                        key={column.key}
                        className={`px-4 py-3 ${column.align === "center" ? "text-center" : "text-right"}`}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {rows.map((row, index) => (
                    <tr key={index} className="hover:bg-muted/10">
                      {activeReport.columns.map((column) => (
                        <td
                          key={column.key}
                          className={`px-4 py-3 ${column.align === "center" ? "text-center" : "text-right"} ${column.type === "money" ? "font-medium text-primary" : ""}`}
                        >
                          {formatCell(row[column.key], column.type)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .admin-report-input {
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
        .admin-report-input:focus {
          box-shadow: 0 0 0 1px hsl(var(--primary));
        }
      `}</style>
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

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof BarChart3 }) {
  return (
    <div className="bg-background/40 rounded-xl border border-border/30 p-3 flex items-start gap-3">
      <div className="bg-primary/10 text-primary p-2.5 rounded-lg shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold text-foreground truncate">{value}</p>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-card rounded-xl border border-border/40 p-4 animate-pulse">
      <div className="h-4 bg-muted/30 rounded w-1/3 mb-3" />
      <div className="h-8 bg-muted/30 rounded w-1/2" />
    </div>
  );
}

function EmptyMsg({ msg }: { msg: string }) {
  return (
    <div className="py-12 text-center text-muted-foreground text-sm">
      {msg}
    </div>
  );
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatNumber(value: number) {
  return value.toLocaleString("ar-IQ", { maximumFractionDigits: 3 });
}

function formatCell(value: unknown, type: ColumnType = "text") {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "money") return formatCurrency(toNumber(value));
  if (type === "number") return formatNumber(toNumber(value));
  if (type === "payment") return PAYMENT_LABELS[String(value)] ?? String(value);
  if (type === "status") return STATUS_LABELS[String(value)] ?? String(value);
  if (type === "date") return String(value);
  return String(value);
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

function buildDelimitedExport(columns: ReportColumn[], rows: Record<string, unknown>[], delimiter: string) {
  const header = columns.map((column) => column.label).join(delimiter);
  const body = rows.map((row) => columns.map((column) => {
    const cell = formatCell(row[column.key], column.type).replace(/"/g, '""');
    return `"${cell}"`;
  }).join(delimiter));
  return [header, ...body].join("\n");
}

function buildExcelHtml(title: string, columns: ReportColumn[], rows: Record<string, unknown>[]) {
  return `
    <html dir="rtl" lang="ar">
      <head><meta charset="utf-8" /></head>
      <body>
        <table border="1">
          <caption>${escapeHtml(title)}</caption>
          <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(formatCell(row[column.key], column.type))}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

function buildPrintHtml(title: string, columns: ReportColumn[], rows: Record<string, unknown>[], totals: Array<TotalDef & { value: number }>) {
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
          ${totals.map((total) => `<div class="total"><span>${escapeHtml(total.label)}</span><strong>${escapeHtml(total.type === "money" ? formatCurrency(total.value) : formatNumber(total.value))}</strong></div>`).join("")}
        </div>
        <table>
          <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(formatCell(row[column.key], column.type))}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </body>
    </html>`;
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
