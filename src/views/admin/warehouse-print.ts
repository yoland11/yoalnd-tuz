import { printStandaloneDocument } from "@/lib/pdf";
import { exportReport, type ReportColumn } from "@/lib/pdf-report";
import { thermalReceiptCss } from "./print-helpers";

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] as string);

export type WarehousePrintColumn<T> = { key: string; header: string; value: (row: T) => string | number; width?: number; number?: boolean; thermal?: boolean };
export type WarehousePrintReport<T> = { title: string; subtitle: string; columns: WarehousePrintColumn<T>[]; rows: T[]; footer?: string; filename: string };

/** One line per row: its first column is the heading, the columns marked for 80mm follow. */
export function buildWarehouseThermalHtml<T>(report: WarehousePrintReport<T>, company = "مجموعة علي جان نهاد") {
  const [lead, ...rest] = report.columns.filter((column) => column.thermal !== false);
  const rows = report.rows.map((row) => `
    <div style="border-bottom:1px dashed #000;padding:1.5mm 0">
      <div style="font-weight:800">${esc(lead?.value(row))}</div>
      ${rest.map((column) => `<div style="display:flex;justify-content:space-between;gap:2mm"><span>${esc(column.header)}</span><b>${esc(column.value(row))}</b></div>`).join("")}
    </div>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(report.title)}</title><style>${thermalReceiptCss("80mm")}</style></head><body>
    <div style="text-align:center;font-weight:800">${esc(company)}</div>
    <div style="text-align:center;font-weight:800;font-size:15px;margin-top:1mm">${esc(report.title)}</div>
    <div style="text-align:center;font-size:11px;margin-bottom:1.5mm">${esc(report.subtitle)}</div>
    ${rows || '<div style="text-align:center;padding:3mm 0">لا توجد بيانات</div>'}
    ${report.footer ? `<div style="margin-top:1.5mm;font-weight:700">${esc(report.footer)}</div>` : ""}
  </body></html>`;
}

export async function printWarehouseReport<T>(report: WarehousePrintReport<T>, format: "a4" | "80mm") {
  if (format === "80mm") {
    printStandaloneDocument(buildWarehouseThermalHtml(report), 320);
    return;
  }
  const columns: ReportColumn<T>[] = report.columns.map((column) => ({
    key: column.key,
    header: column.header,
    width: column.width ?? 12,
    align: column.number ? "center" : undefined,
    priority: "high",
    value: (row: T) => column.value(row),
  }));
  await exportReport<T>({
    options: { title: report.title, subtitle: report.subtitle, orientation: "landscape", footerNote: report.footer, emptyText: "لا توجد بيانات" },
    columns,
    rows: report.rows,
    filename: report.filename,
    mode: "print",
  });
}
