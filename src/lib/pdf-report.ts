import { formatCurrency } from "@/lib/money";
import { downloadElementPdf } from "@/lib/pdf";

/**
 * Shared, reusable foundation for PROFESSIONAL table-report PDFs / printable
 * documents across AJN. It exists so report exports stop capturing the live,
 * responsive web DOM (which produces "broken screenshot" PDFs) and instead
 * render a dedicated print document with INTENTIONAL column widths.
 *
 * Design goals (per the PDF task):
 *   - explicit, fixed column widths (table-layout: fixed + <colgroup>) so
 *     browser flex/grid can never decide the PDF layout;
 *   - RTL for Arabic, LTR isolation for numbers / codes / phones;
 *   - long Arabic content wraps inside its own column, never overlaps;
 *   - rows never split across a page break;
 *   - intentional A4 portrait OR landscape;
 *   - repeated table header + a page footer on the paged-media (print) path.
 *
 * This is FOUNDATION ONLY — it changes no existing report. It also does NOT
 * touch the protected Booking Center A4 invoice, thermal layouts, or the
 * business/financial layer: every value is presentation, passed in already
 * computed by the caller.
 */

export type ReportColumnKind = "text" | "number" | "money" | "code" | "date";
export type ReportColumnAlign = "start" | "center" | "end";
export type ReportColumnPriority = "high" | "medium" | "low";

export type ReportColumn<Row = Record<string, unknown>> = {
  key: string;
  header: string;
  /** Relative weight of the column; widths are normalised to 100%. */
  width: number;
  kind?: ReportColumnKind;
  align?: ReportColumnAlign;
  priority?: ReportColumnPriority;
  /** Custom accessor; defaults to row[key]. */
  value?: (row: Row) => unknown;
};

export type ReportMetaItem = { label: string; value: string };

/** A summary KPI shown in the stats grid above the table (for dashboard reports). */
export type ReportSummaryStat = { label: string; value: string; tone?: "default" | "positive" | "negative" };

export type ReportTotalsCell = {
  /** Column key this total sits under (aligns it to that column). */
  key: string;
  text: string;
};

export type ReportDocumentOptions = {
  title: string;
  subtitle?: string;
  orientation?: "portrait" | "landscape";
  company?: string;
  companySubtitle?: string;
  logoUrl?: string | null;
  meta?: ReportMetaItem[];
  dateRange?: { from?: string | null; to?: string | null };
  /** Optional KPI cards rendered above the table (dashboard-style reports). */
  summary?: ReportSummaryStat[];
  /** Optional totals/summary row rendered in the table footer. */
  totalsLabel?: string;
  totals?: ReportTotalsCell[];
  emptyText?: string;
  footerNote?: string;
};

const DEFAULT_COMPANY = "AJN — مجموعة علي جان نهاد";
const DEFAULT_COMPANY_SUBTITLE = "لتنظيم المناسبات";

function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}

const isNumericKind = (kind?: ReportColumnKind) => kind === "number" || kind === "money" || kind === "code";

function formatCell(kind: ReportColumnKind | undefined, value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === "") return "—";
  if (kind === "money") return formatCurrency(value as never);
  return String(value);
}

function columnClass(column: ReportColumn<any>): string {
  if (isNumericKind(column.kind)) return "num";
  return column.align ?? "start";
}

/**
 * Pick the columns that should appear, honouring priority. When `maxColumns`
 * is set and there are too many, low- then medium-priority columns are dropped
 * first so a wide table degrades gracefully instead of being squeezed.
 */
export function pickReportColumns<Row>(
  columns: ReportColumn<Row>[],
  maxColumns?: number,
): ReportColumn<Row>[] {
  if (!maxColumns || columns.length <= maxColumns) return columns;
  const rank: Record<ReportColumnPriority, number> = { high: 0, medium: 1, low: 2 };
  const ordered = columns
    .map((column, index) => ({ column, index, rank: rank[column.priority ?? "medium"] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, maxColumns)
    .sort((a, b) => a.index - b.index);
  return ordered.map((entry) => entry.column);
}

export function reportDocumentCss(orientation: "portrait" | "landscape" = "portrait"): string {
  const size = orientation === "landscape" ? "A4 landscape" : "A4 portrait";
  return `
    @page { size: ${size}; margin: 12mm 10mm 15mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111827; direction: rtl;
      font-family: Cairo, Tahoma, Arial, sans-serif; font-size: 11px; line-height: 1.5; }
    .rpt-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
      border-bottom: 2px solid #111827; padding-bottom: 8px; margin-bottom: 10px; }
    .rpt-brand-name { font-size: 18px; font-weight: 800; }
    .rpt-brand-sub { font-size: 11px; color: #4b5563; }
    .rpt-title { font-size: 15px; font-weight: 700; margin-top: 3px; }
    .rpt-logo { height: 40px; width: auto; max-width: 120px; object-fit: contain; margin-bottom: 4px; }
    .rpt-meta { font-size: 11px; line-height: 1.9; text-align: left; min-width: 40mm; }
    .rpt-meta b { font-weight: 700; }
    .rpt-meta .num { direction: ltr; unicode-bidi: isolate; }
    .rpt-summary { display: grid; gap: 8px; margin-bottom: 12px; }
    .rpt-summary > div { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 10px; }
    .rpt-summary span { display: block; font-size: 10px; color: #4b5563; }
    .rpt-summary strong { display: block; margin-top: 3px; font-size: 13px; color: #111827;
      direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
    .rpt-summary strong.pos { color: #237a57; }
    .rpt-summary strong.neg { color: #b23a4c; }
    table.rpt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .rpt-table thead { display: table-header-group; }
    .rpt-table th { background: #f3f4f6; border: 1px solid #111827; padding: 6px 5px;
      font-weight: 800; text-align: center; font-size: 11px; }
    .rpt-table td { border: 1px solid #d1d5db; padding: 5px; vertical-align: top;
      overflow-wrap: anywhere; word-break: break-word; font-size: 11px; }
    .rpt-table tr { break-inside: avoid; page-break-inside: avoid; }
    .rpt-table td.start, .rpt-table th.start { text-align: right; }
    .rpt-table td.center, .rpt-table th.center { text-align: center; }
    .rpt-table td.end, .rpt-table th.end { text-align: left; }
    .rpt-table td.num, .rpt-table th.num { direction: ltr; unicode-bidi: isolate; text-align: left;
      white-space: nowrap; font-variant-numeric: tabular-nums; }
    .rpt-table tbody tr:nth-child(even) td { background: #fafafa; }
    .rpt-table tfoot { display: table-footer-group; }
    .rpt-table tfoot td { background: #f3f4f6; border: 1px solid #111827; font-weight: 800; }
    .rpt-empty { text-align: center; padding: 20px; color: #6b7280; }
    .rpt-doc-footer { margin-top: 12px; padding-top: 6px; border-top: 1px solid #d1d5db;
      display: flex; justify-content: space-between; gap: 10px; font-size: 10px; color: #6b7280; }
    /* On the print path this repeats on every printed page. */
    .rpt-page-footer { display: none; }
    @media print {
      .rpt-page-footer { display: block; position: fixed; bottom: 4mm; inset-inline: 0;
        text-align: center; font-size: 9px; color: #6b7280; }
    }
  `;
}

/**
 * Pure builder: a complete standalone report document (thead/tbody/tfoot with
 * fixed column widths). Works on both the print-window path (repeated header +
 * page footer) and the direct-download path.
 */
export function buildReportDocumentHtml<Row>(
  options: ReportDocumentOptions,
  columns: ReportColumn<Row>[],
  rows: Row[],
): string {
  const orientation = options.orientation ?? "portrait";
  const totalWeight = columns.reduce((sum, column) => sum + (column.width > 0 ? column.width : 1), 0) || 1;
  const colgroup = `<colgroup>${columns
    .map((column) => `<col style="width:${(((column.width > 0 ? column.width : 1) / totalWeight) * 100).toFixed(3)}%">`)
    .join("")}</colgroup>`;
  const thead = `<thead><tr>${columns
    .map((column) => `<th class="${columnClass(column)}">${esc(column.header)}</th>`)
    .join("")}</tr></thead>`;
  const body = rows.length
    ? rows
        .map(
          (row) =>
            `<tr>${columns
              .map((column) => {
                const raw = column.value ? column.value(row) : (row as Record<string, unknown>)[column.key];
                return `<td class="${columnClass(column)}">${esc(formatCell(column.kind, raw))}</td>`;
              })
              .join("")}</tr>`,
        )
        .join("")
    : `<tr><td class="rpt-empty" colspan="${columns.length}">${esc(options.emptyText || "لا توجد بيانات لعرضها")}</td></tr>`;

  let tfoot = "";
  if (options.totals && options.totals.length) {
    const byKey = new Map(options.totals.map((total) => [total.key, total.text]));
    const firstTotalIndex = columns.findIndex((column) => byKey.has(column.key));
    const labelSpan = firstTotalIndex < 0 ? columns.length : firstTotalIndex;
    const cells: string[] = [];
    if (labelSpan > 0) cells.push(`<td colspan="${labelSpan}" class="start">${esc(options.totalsLabel || "الإجمالي")}</td>`);
    for (let index = labelSpan; index < columns.length; index++) {
      const column = columns[index];
      const text = byKey.get(column.key);
      cells.push(`<td class="${columnClass(column)}">${text ? esc(text) : ""}</td>`);
    }
    tfoot = `<tfoot><tr>${cells.join("")}</tr></tfoot>`;
  }

  const metaItems: ReportMetaItem[] = [...(options.meta ?? [])];
  if (options.dateRange && (options.dateRange.from || options.dateRange.to)) {
    metaItems.push({ label: "الفترة", value: `${options.dateRange.from || "—"} — ${options.dateRange.to || "—"}` });
  }
  metaItems.push({
    label: "تاريخ الطباعة",
    value: new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date()),
  });
  const metaHtml = metaItems
    .map((item) => `<div><b>${esc(item.label)}:</b> <span class="num">${esc(item.value)}</span></div>`)
    .join("");

  const header = `<div class="rpt-head">
    <div>
      ${options.logoUrl ? `<img class="rpt-logo" src="${esc(options.logoUrl)}" alt="" onerror="this.remove()">` : ""}
      <div class="rpt-brand-name">${esc(options.company || DEFAULT_COMPANY)}</div>
      <div class="rpt-brand-sub">${esc(options.companySubtitle || DEFAULT_COMPANY_SUBTITLE)}</div>
      <div class="rpt-title">${esc(options.title)}</div>
      ${options.subtitle ? `<div class="rpt-brand-sub">${esc(options.subtitle)}</div>` : ""}
    </div>
    <div class="rpt-meta">${metaHtml}</div>
  </div>`;

  const summaryHtml = options.summary && options.summary.length
    ? `<div class="rpt-summary" style="grid-template-columns:repeat(${Math.min(options.summary.length, 5)},minmax(0,1fr))">${options.summary
        .map(
          (stat) =>
            `<div><span>${esc(stat.label)}</span><strong class="${stat.tone === "positive" ? "pos" : stat.tone === "negative" ? "neg" : ""}">${esc(stat.value)}</strong></div>`,
        )
        .join("")}</div>`
    : "";

  const footerNote = options.footerNote || "تقرير للقراءة والطباعة فقط · صادر من نظام AJN";
  const docFooter = `<div class="rpt-doc-footer"><span>${esc(footerNote)}</span><span class="num">${esc(String(rows.length))} سطر</span></div>`;
  const pageFooter = `<div class="rpt-page-footer">${esc(options.company || DEFAULT_COMPANY)} · ${esc(footerNote)}</div>`;

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(options.title)}</title><style>${reportDocumentCss(orientation)}</style></head><body>${header}${summaryHtml}<table class="rpt-table">${colgroup}${thead}${tfoot}<tbody>${body}</tbody></table>${docFooter}${pageFooter}</body></html>`;
}

/**
 * High-level convenience: build the report document and either download it as a
 * PDF file (default — matches the existing "تحميل PDF" buttons and fixes the
 * broken column layout) or open it for printing (best quality: repeated header +
 * page footer + vector-sharp text).
 */
export async function exportReport<Row>(input: {
  options: ReportDocumentOptions;
  columns: ReportColumn<Row>[];
  rows: Row[];
  filename: string;
  /** "download" (default) → direct PDF file · "print" → paged-media print window. */
  mode?: "download" | "print";
  /** Cap the number of columns, dropping low-priority ones first. */
  maxColumns?: number;
}): Promise<void> {
  const columns = pickReportColumns(input.columns, input.maxColumns);
  const html = buildReportDocumentHtml(input.options, columns, input.rows);
  if (input.mode === "print") {
    openReportPrintWindow(html);
    return;
  }
  await downloadReportPdf(html, input.filename, input.options.orientation ?? "portrait");
}

/** Minimal auto-print bootstrap (waits for images) for the print-window path. */
function autoPrintScript(): string {
  return `<script>(function(){function go(){setTimeout(function(){window.focus();window.print();},80);}var imgs=document.images;if(!imgs.length){window.onload=go;return;}var left=imgs.length;function one(){if(--left<=0)go();}window.onload=function(){for(var i=0;i<imgs.length;i++){var im=imgs[i];if(im.complete)one();else{im.onload=one;im.onerror=one;}}};})();</script>`;
}

/**
 * Best-quality path: open the report in a new window and print it. Uses real
 * paged media, so the header repeats on every page, the page footer shows on
 * every page, text stays vector-sharp, and the user saves it as PDF.
 */
export function openReportPrintWindow(html: string): void {
  const popup = window.open("", "_blank", "width=1024,height=800");
  if (!popup) {
    throw new Error("تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى.");
  }
  popup.document.open();
  popup.document.write(html.includes("window.print") ? html : html.replace("</body>", `${autoPrintScript()}</body>`));
  popup.document.close();
}

/**
 * Direct-download path: render the report into a hidden node and rasterise it
 * to a PDF file via the shared generator. Single-image (no per-page repeated
 * header), but still uses the intentional fixed column layout.
 */
export async function downloadReportPdf(
  html: string,
  filename: string,
  orientation: "portrait" | "landscape" = "portrait",
): Promise<void> {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:fixed;left:-100000px;top:0;background:#ffffff;pointer-events:none;";
  wrapper.style.width = orientation === "landscape" ? "1122px" : "794px";
  wrapper.dir = "rtl";
  wrapper.innerHTML = `<style>${parsed.head.querySelector("style")?.textContent ?? ""}</style>${parsed.body.innerHTML}`;
  document.body.appendChild(wrapper);
  try {
    await downloadElementPdf(wrapper, filename, {
      format: "a4",
      orientation,
      margin: [10, 8, 12, 8],
      pagebreakMode: ["css", "legacy"],
    });
  } finally {
    wrapper.remove();
  }
}
