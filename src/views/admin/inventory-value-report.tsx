import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Package, Printer, RefreshCw, Search, WalletCards, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TableTotalsFooter } from "@/components/ui/table-totals-footer";
import { downloadElementPdf } from "@/lib/pdf";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";

type InventoryValueRow = {
  id: number;
  productName: string;
  categoryName: string;
  stock: number;
  wholesalePrice: number;
  salePrice: number;
  wholesaleValue: number;
  saleValue: number;
  expectedProfit: number;
  linkedCount: number;
  linkedProductNames: string;
};

type InventoryValueTotals = {
  productCount: number;
  totalQuantity: number;
  totalWholesaleValue: number;
  totalSaleValue: number;
  expectedProfit: number;
};

type CategoryOption = {
  value: string;
  label: string;
};

type InventoryValuePayload = {
  rows: InventoryValueRow[];
  totals: InventoryValueTotals;
  categories: CategoryOption[];
};

const EMPTY_TOTALS: InventoryValueTotals = {
  productCount: 0,
  totalQuantity: 0,
  totalWholesaleValue: 0,
  totalSaleValue: 0,
  expectedProfit: 0,
};

export default function InventoryValueReportPage() {
  const reportRef = useRef<HTMLDivElement | null>(null);
  const { data: settings } = usePublicSettings();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedCategory, setAppliedCategory] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (appliedSearch.trim()) params.set("search", appliedSearch.trim());
    if (appliedCategory.trim()) params.set("category", appliedCategory.trim());
    return params.toString();
  }, [appliedCategory, appliedSearch]);

  const reportQuery = useQuery<InventoryValuePayload>({
    queryKey: ["admin", "inventory-value", appliedSearch, appliedCategory],
    queryFn: () => adminFetch(`/admin/inventory-value${queryString ? `?${queryString}` : ""}`),
    staleTime: 60_000,
  });

  const rows = reportQuery.data?.rows ?? [];
  const totals = reportQuery.data?.totals ?? EMPTY_TOTALS;
  const categories = reportQuery.data?.categories ?? [];

  function applyFilters() {
    setAppliedSearch(search.trim());
    setAppliedCategory(category.trim());
  }

  function resetFilters() {
    setSearch("");
    setCategory("");
    setAppliedSearch("");
    setAppliedCategory("");
  }

  async function exportPdf() {
    setExportingPdf(true);
    try {
      await recordReportAudit("report_pdf_exported", "تقرير قيمة المخزون", "pdf");
      await downloadElementPdf(reportRef.current, "تقرير قيمة المخزون.pdf");
    } catch (err) {
      alert(err instanceof Error ? err.message : "تعذر تصدير PDF");
    } finally {
      setExportingPdf(false);
    }
  }

  function exportExcel() {
    const html = buildExcelHtml(rows);
    downloadBlob(`\uFEFF${html}`, "تقرير قيمة المخزون.xls", "application/vnd.ms-excel;charset=utf-8");
  }

  function printReport() {
    const popup = window.open("", "_blank", "width=1100,height=760");
    if (!popup) {
      alert("تعذر فتح نافذة الطباعة");
      return;
    }
    void recordReportAudit("report_printed", "تقرير قيمة المخزون", "a4");
    popup.document.write(buildPrintHtml({
      rows,
      totals,
      logo: logoSrc(settings),
      categoryLabel: categories.find((item) => item.value === appliedCategory)?.label ?? "كل التصنيفات",
      search: appliedSearch,
    }));
    popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 250);
  }

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">تقرير قيمة المخزون</h1>
          <p className="text-sm text-muted-foreground mt-1">احتساب قيمة المخزون بسعر الجملة وسعر البيع مع دعم المخزون المشترك.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={printReport} disabled={rows.length === 0}>
            <Printer className="w-4 h-4 ml-2" />
            طباعة
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={rows.length === 0 || exportingPdf}>
            <Download className="w-4 h-4 ml-2" />
            PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={rows.length === 0}>
            <FileSpreadsheet className="w-4 h-4 ml-2" />
            Excel
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <SummaryCard label="عدد المنتجات الكلي" value={totals.productCount.toLocaleString("ar-IQ")} icon={Package} />
        <SummaryCard label="إجمالي الكميات" value={totals.totalQuantity.toLocaleString("ar-IQ")} icon={Package} />
        <SummaryCard label="إجمالي سعر الجملة" value={formatCurrency(totals.totalWholesaleValue)} icon={WalletCards} />
        <SummaryCard label="إجمالي سعر البيع" value={formatCurrency(totals.totalSaleValue)} icon={WalletCards} />
        <SummaryCard label="الربح المتوقع" value={formatCurrency(totals.expectedProfit)} icon={WalletCards} positive={totals.expectedProfit >= 0} />
      </div>

      <div className="bg-card rounded-xl border border-border/40 p-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_260px_auto_auto] gap-3 items-end">
          <FilterField label="بحث باسم المنتج">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyFilters();
                }}
                placeholder="اسم المنتج أو الباركود..."
                className="admin-report-input pr-10"
              />
            </div>
          </FilterField>
          <FilterField label="التصنيف">
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="admin-report-input">
              <option value="">كل التصنيفات</option>
              {categories.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FilterField>
          <Button onClick={applyFilters} className="h-10">
            <Search className="w-4 h-4 ml-2" />
            عرض التقرير
          </Button>
          <Button type="button" variant="outline" onClick={resetFilters} className="h-10">
            <RefreshCw className="w-4 h-4 ml-2" />
            إعادة تعيين
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
        <div className="hidden print:flex items-center justify-between gap-4 p-4 border-b border-border/30 bg-white text-black">
          <div className="flex items-center gap-3">
            <img src={logoSrc(settings)} alt="AJN" className="w-14 h-14 object-contain" />
            <div>
              <h2 className="text-xl font-bold">تقرير قيمة المخزون</h2>
              <p className="text-sm">مجموعة علي جان</p>
            </div>
          </div>
          <div className="text-sm text-left">
            <p>التصنيف: {categories.find((item) => item.value === appliedCategory)?.label ?? "كل التصنيفات"}</p>
            <p>تاريخ الإنشاء: {new Date().toLocaleString("ar-IQ")}</p>
          </div>
        </div>

        {reportQuery.isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-14 rounded-xl" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState message="لا توجد منتجات مطابقة للتقرير" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-right p-3 font-medium">اسم المنتج</th>
                  <th className="text-right p-3 font-medium">التصنيف</th>
                  <th className="text-center p-3 font-medium">الكمية المتوفرة</th>
                  <th className="text-center p-3 font-medium">سعر الجملة</th>
                  <th className="text-center p-3 font-medium">سعر البيع</th>
                  <th className="text-center p-3 font-medium">قيمة الجملة</th>
                  <th className="text-center p-3 font-medium">قيمة البيع</th>
                  <th className="text-center p-3 font-medium">الربح المتوقع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-background/30">
                    <td className="p-3">
                      <div className="font-medium text-foreground">{row.productName}</div>
                      {row.linkedCount > 1 && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          مخزون مشترك مع {row.linkedCount.toLocaleString("ar-IQ")} منتجات: {compactLinkedNames(row.linkedProductNames)}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">{row.categoryName}</td>
                    <td className="p-3 text-center font-semibold">{row.stock.toLocaleString("ar-IQ")}</td>
                    <td className="p-3 text-center">{formatCurrency(row.wholesalePrice)}</td>
                    <td className="p-3 text-center">{formatCurrency(row.salePrice)}</td>
                    <td className="p-3 text-center font-medium">{formatCurrency(row.wholesaleValue)}</td>
                    <td className="p-3 text-center font-medium">{formatCurrency(row.saleValue)}</td>
                    <td className={`p-3 text-center font-semibold ${row.expectedProfit >= 0 ? "text-status-success" : "text-status-danger"}`}>
                      {formatCurrency(row.expectedProfit)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <TableTotalsFooter
                rows={rows}
                allRows={rows}
                labelColSpan={2}
                cells={[
                  { key: "stock", label: "إجمالي الكمية", value: (row) => row.stock },
                  { key: "wholesalePrice", label: "", },
                  { key: "salePrice", label: "", },
                  { key: "wholesaleValue", label: "إجمالي قيمة الجملة", value: (row) => row.wholesaleValue, format: formatCurrency },
                  { key: "saleValue", label: "إجمالي قيمة البيع", value: (row) => row.saleValue, format: formatCurrency },
                  { key: "expectedProfit", label: "إجمالي الربح المتوقع", value: (row) => row.expectedProfit, format: formatCurrency },
                ]}
              />
            </table>
          </div>
        )}
      </div>

      <div
        ref={reportRef}
        dir="rtl"
        aria-hidden="true"
        style={{
          position: "fixed",
          top: 0,
          left: "-100000px",
          width: "1120px",
          background: "#ffffff",
          color: "#111827",
          padding: "24px",
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottom: "2px solid #111827", paddingBottom: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src={logoSrc(settings)} alt="AJN" style={{ width: 72, height: 56, objectFit: "contain" }} />
            <div>
              <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>تقرير قيمة المخزون</h2>
              <p style={{ margin: "6px 0 0", fontSize: 13 }}>مجموعة علي جان</p>
            </div>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.8, textAlign: "left" }}>
            <div>التصنيف: {categories.find((item) => item.value === appliedCategory)?.label ?? "كل التصنيفات"}</div>
            <div>البحث: {appliedSearch || "كل المنتجات"}</div>
            <div>تاريخ الإنشاء: {new Date().toLocaleString("ar-IQ")}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 18 }}>
          <PdfTotal label="عدد المنتجات" value={totals.productCount.toLocaleString("ar-IQ")} />
          <PdfTotal label="إجمالي الكميات" value={totals.totalQuantity.toLocaleString("ar-IQ")} />
          <PdfTotal label="إجمالي الجملة" value={formatCurrency(totals.totalWholesaleValue)} />
          <PdfTotal label="إجمالي البيع" value={formatCurrency(totals.totalSaleValue)} />
          <PdfTotal label="الربح المتوقع" value={formatCurrency(totals.expectedProfit)} />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {["اسم المنتج", "التصنيف", "الكمية", "سعر الجملة", "سعر البيع", "قيمة الجملة", "قيمة البيع", "الربح المتوقع"].map((heading) => (
                <th key={heading} style={pdfCellStyle(true)}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`pdf-${row.id}`}>
                <td style={pdfCellStyle()}>{row.productName}</td>
                <td style={pdfCellStyle()}>{row.categoryName}</td>
                <td style={pdfCellStyle()}>{row.stock.toLocaleString("ar-IQ")}</td>
                <td style={pdfCellStyle()}>{formatCurrency(row.wholesalePrice)}</td>
                <td style={pdfCellStyle()}>{formatCurrency(row.salePrice)}</td>
                <td style={pdfCellStyle()}>{formatCurrency(row.wholesaleValue)}</td>
                <td style={pdfCellStyle()}>{formatCurrency(row.saleValue)}</td>
                <td style={pdfCellStyle()}>{formatCurrency(row.expectedProfit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={pdfCellStyle(true)}>الإجمالي</td>
              <td style={pdfCellStyle(true)}>{totals.totalQuantity.toLocaleString("ar-IQ")}</td>
              <td style={pdfCellStyle(true)}>—</td>
              <td style={pdfCellStyle(true)}>—</td>
              <td style={pdfCellStyle(true)}>{formatCurrency(totals.totalWholesaleValue)}</td>
              <td style={pdfCellStyle(true)}>{formatCurrency(totals.totalSaleValue)}</td>
              <td style={pdfCellStyle(true)}>{formatCurrency(totals.expectedProfit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <style>{`
        .admin-report-input {
          width: 100%;
          height: 2.5rem;
          border-radius: 0.5rem;
          border: 1px solid hsl(var(--border) / 0.4);
          background: hsl(var(--background));
          padding: 0 0.75rem;
          color: hsl(var(--foreground));
          font-size: 0.875rem;
        }
        .admin-report-input:focus {
          outline: none;
          box-shadow: 0 0 0 1px hsl(var(--ring));
        }
        @media print {
          body { background: #fff !important; }
          .print\\:flex { display: flex !important; }
        }
      `}</style>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  positive,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  positive?: boolean;
}) {
  return (
    <div className="bg-card rounded-xl border border-border/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-lg font-bold mt-1 ${positive === undefined ? "text-foreground" : positive ? "text-status-success" : "text-status-danger"}`}>{value}</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function PdfTotal({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: 10 }}>
      <span style={{ display: "block", fontSize: 11, color: "#4b5563" }}>{label}</span>
      <strong style={{ display: "block", marginTop: 4, fontSize: 14, color: "#111827" }}>{value}</strong>
    </div>
  );
}

function pdfCellStyle(header = false): CSSProperties {
  return {
    border: "1px solid #111827",
    padding: "7px 8px",
    textAlign: "right",
    color: "#111827",
    fontWeight: header ? 800 : 600,
    background: "#ffffff",
  };
}

function compactLinkedNames(value: string) {
  const names = value.split("،").map((item) => item.trim()).filter(Boolean);
  const compact = names.slice(0, 4).join("، ");
  return names.length > 4 ? `${compact}...` : compact;
}

function recordReportAudit(action: "report_printed" | "report_pdf_exported", title: string, format: string) {
  return adminFetch("/admin/reports/audit", {
    method: "POST",
    body: JSON.stringify({ action, title, format }),
  }).catch(() => null);
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

function buildExcelHtml(rows: InventoryValueRow[]) {
  const totals = calculateInventoryTotals(rows);
  return `
    <html dir="rtl">
      <head><meta charset="utf-8" /></head>
      <body>
        <table>
          <thead>
            <tr>
              <th>اسم المنتج</th>
              <th>التصنيف</th>
              <th>الكمية المتوفرة</th>
              <th>سعر الجملة</th>
              <th>سعر البيع</th>
              <th>قيمة الجملة</th>
              <th>قيمة البيع</th>
              <th>الربح المتوقع</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.productName)}</td>
                <td>${escapeHtml(row.categoryName)}</td>
                <td>${row.stock}</td>
                <td>${row.wholesalePrice}</td>
                <td>${row.salePrice}</td>
                <td>${row.wholesaleValue}</td>
                <td>${row.saleValue}</td>
                <td>${row.expectedProfit}</td>
              </tr>
            `).join("")}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2">الإجمالي</td>
              <td>${totals.totalQuantity}</td>
              <td>—</td>
              <td>—</td>
              <td>${totals.totalWholesaleValue}</td>
              <td>${totals.totalSaleValue}</td>
              <td>${totals.expectedProfit}</td>
            </tr>
          </tfoot>
        </table>
      </body>
    </html>
  `;
}

function buildPrintHtml(input: {
  rows: InventoryValueRow[];
  totals: InventoryValueTotals;
  logo: string;
  categoryLabel: string;
  search: string;
}) {
  const generatedAt = new Date().toLocaleString("ar-IQ");
  return `<!doctype html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>تقرير قيمة المخزون</title>
        <style>
          @page { size: A4; margin: 12mm; }
          * { color: #000 !important; box-shadow: none !important; text-shadow: none !important; }
          body { font-family: Arial, sans-serif; background: #fff; padding: 12px; }
          .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 12px; }
          .brand { display: flex; align-items: center; gap: 10px; }
          img { width: 68px; height: 52px; object-fit: contain; }
          h1 { font-size: 20px; margin: 0; font-weight: 800; }
          .meta { font-size: 12px; line-height: 1.8; }
          .totals { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 16px; }
          .total { border: 1px solid #000; padding: 8px; border-radius: 6px; }
          .total span { display: block; font-size: 11px; color: #333; }
          .total strong { font-size: 13px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th, td { border: 1px solid #000; padding: 6px; text-align: right; font-weight: 600; }
          th { background: #fff; font-weight: 800; }
        </style>
      </head>
      <body>
        <div class="head">
          <div class="brand">
            <img src="${escapeHtml(input.logo)}" alt="AJN" />
            <div>
              <h1>تقرير قيمة المخزون</h1>
              <div class="meta">مجموعة علي جان</div>
            </div>
          </div>
          <div class="meta">
            <div>التصنيف: ${escapeHtml(input.categoryLabel)}</div>
            <div>البحث: ${escapeHtml(input.search || "كل المنتجات")}</div>
            <div>تاريخ الإنشاء: ${escapeHtml(generatedAt)}</div>
          </div>
        </div>
        <div class="totals">
          <div class="total"><span>عدد المنتجات</span><strong>${escapeHtml(input.totals.productCount.toLocaleString("ar-IQ"))}</strong></div>
          <div class="total"><span>إجمالي الكميات</span><strong>${escapeHtml(input.totals.totalQuantity.toLocaleString("ar-IQ"))}</strong></div>
          <div class="total"><span>إجمالي الجملة</span><strong>${escapeHtml(formatCurrency(input.totals.totalWholesaleValue))}</strong></div>
          <div class="total"><span>إجمالي البيع</span><strong>${escapeHtml(formatCurrency(input.totals.totalSaleValue))}</strong></div>
          <div class="total"><span>الربح المتوقع</span><strong>${escapeHtml(formatCurrency(input.totals.expectedProfit))}</strong></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>اسم المنتج</th>
              <th>التصنيف</th>
              <th>الكمية</th>
              <th>سعر الجملة</th>
              <th>سعر البيع</th>
              <th>قيمة الجملة</th>
              <th>قيمة البيع</th>
              <th>الربح المتوقع</th>
            </tr>
          </thead>
          <tbody>
            ${input.rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.productName)}</td>
                <td>${escapeHtml(row.categoryName)}</td>
                <td>${escapeHtml(row.stock.toLocaleString("ar-IQ"))}</td>
                <td>${escapeHtml(formatCurrency(row.wholesalePrice))}</td>
                <td>${escapeHtml(formatCurrency(row.salePrice))}</td>
                <td>${escapeHtml(formatCurrency(row.wholesaleValue))}</td>
                <td>${escapeHtml(formatCurrency(row.saleValue))}</td>
                <td>${escapeHtml(formatCurrency(row.expectedProfit))}</td>
              </tr>
            `).join("")}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2">الإجمالي</td>
              <td>${escapeHtml(input.totals.totalQuantity.toLocaleString("ar-IQ"))}</td>
              <td>—</td>
              <td>—</td>
              <td>${escapeHtml(formatCurrency(input.totals.totalWholesaleValue))}</td>
              <td>${escapeHtml(formatCurrency(input.totals.totalSaleValue))}</td>
              <td>${escapeHtml(formatCurrency(input.totals.expectedProfit))}</td>
            </tr>
          </tfoot>
        </table>
      </body>
    </html>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function calculateInventoryTotals(rows: InventoryValueRow[]): InventoryValueTotals {
  return rows.reduce<InventoryValueTotals>((result, row) => ({
    productCount: result.productCount + 1,
    totalQuantity: result.totalQuantity + Number(row.stock || 0),
    totalWholesaleValue: result.totalWholesaleValue + Number(row.wholesaleValue || 0),
    totalSaleValue: result.totalSaleValue + Number(row.saleValue || 0),
    expectedProfit: result.expectedProfit + Number(row.expectedProfit || 0),
  }), { ...EMPTY_TOTALS });
}
