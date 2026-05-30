// Shared invoice print utility — types, defaults, and HTML generation

export type InvoiceType = "sales" | "purchase" | "pos" | "delivery";

export type ColumnDef = {
  key: string;
  label: string;
  show: boolean;
  order: number;
};

export type InvoiceTemplateConfig = {
  // Header
  showLogo: boolean;
  logoUrl: string;
  logoSize: number;
  logoPosition: "right" | "center" | "left";
  companyName: string;
  companyNameSize: number;
  companyNameColor: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  taxNumber: string;
  tradeNumber: string;
  welcomeText: string;
  headerText: string;
  // Body
  columns: ColumnDef[];
  tableHeaderBg: string;
  tableHeaderColor: string;
  tableFontSize: number;
  // Footer
  footerThankYou: string;
  footerReturnPolicy: string;
  footerNotes: string;
  showInvoiceNumber: boolean;
  showDate: boolean;
  // General
  direction: "rtl" | "ltr";
  paperSize: "a4" | "a5" | "thermal80" | "thermal58";
  primaryColor: string;
  globalFont: string;
  templateStyle: "classic" | "modern" | "simple" | "professional";
};

export const DEFAULT_COLUMNS: Record<InvoiceType, ColumnDef[]> = {
  sales: [
    { key: "index",    label: "#",          show: true,  order: 0 },
    { key: "product",  label: "المنتج",      show: true,  order: 1 },
    { key: "qty",      label: "الكمية",      show: true,  order: 2 },
    { key: "price",    label: "السعر",       show: true,  order: 3 },
    { key: "discount", label: "الخصم",       show: true,  order: 4 },
    { key: "tax",      label: "الضريبة",     show: false, order: 5 },
    { key: "total",    label: "الإجمالي",    show: true,  order: 6 },
  ],
  purchase: [
    { key: "index",    label: "#",            show: true,  order: 0 },
    { key: "product",  label: "المنتج",        show: true,  order: 1 },
    { key: "qty",      label: "الكمية",        show: true,  order: 2 },
    { key: "cost",     label: "سعر الشراء",    show: true,  order: 3 },
    { key: "sell",     label: "سعر البيع",     show: false, order: 4 },
    { key: "discount", label: "الخصم",         show: true,  order: 5 },
    { key: "total",    label: "الإجمالي",      show: true,  order: 6 },
  ],
  pos: [
    { key: "product",  label: "الصنف",      show: true, order: 0 },
    { key: "qty",      label: "ك",          show: true, order: 1 },
    { key: "price",    label: "السعر",      show: true, order: 2 },
    { key: "total",    label: "الإجمالي",   show: true, order: 3 },
  ],
  delivery: [
    { key: "index",    label: "#",          show: true,  order: 0 },
    { key: "product",  label: "المنتج",      show: true,  order: 1 },
    { key: "qty",      label: "الكمية",      show: true,  order: 2 },
    { key: "price",    label: "السعر",       show: true,  order: 3 },
    { key: "total",    label: "الإجمالي",    show: true,  order: 4 },
  ],
};

export function getDefaultConfig(type: InvoiceType): InvoiceTemplateConfig {
  const isThermal = type === "pos";
  return {
    showLogo: true,
    logoUrl: "",
    logoSize: isThermal ? 60 : 80,
    logoPosition: isThermal ? "center" : "right",
    companyName: "",
    companyNameSize: isThermal ? 14 : 20,
    companyNameColor: "#111111",
    companyAddress: "",
    companyPhone: "",
    companyEmail: "",
    taxNumber: "",
    tradeNumber: "",
    welcomeText: "",
    headerText:
      type === "sales"    ? "فاتورة مبيعات"        :
      type === "purchase" ? "فاتورة مشتريات"       :
      type === "pos"      ? "إيصال نقطة البيع"     :
                            "فاتورة توصيل",
    columns: DEFAULT_COLUMNS[type].map(c => ({ ...c })),
    tableHeaderBg:    "#f5f5f5",
    tableHeaderColor: "#333333",
    tableFontSize: isThermal ? 11 : 13,
    footerThankYou:    "شكراً لتعاملكم معنا",
    footerReturnPolicy: "",
    footerNotes: "",
    showInvoiceNumber: true,
    showDate: true,
    direction: "rtl",
    paperSize: isThermal ? "thermal80" : "a4",
    primaryColor: "#c9a030",
    globalFont: "Cairo",
    templateStyle: "classic",
  };
}

// ─── Preset styles ───────────────────────────────────────────────────────────
export type PresetName = "classic" | "modern" | "simple" | "professional";

export const PRESET_OVERRIDES: Record<PresetName, Partial<InvoiceTemplateConfig>> = {
  classic: {
    templateStyle: "classic",
    primaryColor: "#c9a030",
    tableHeaderBg: "#f5f5f5",
    tableHeaderColor: "#333333",
  },
  modern: {
    templateStyle: "modern",
    primaryColor: "#2563eb",
    tableHeaderBg: "#eff6ff",
    tableHeaderColor: "#1e40af",
  },
  simple: {
    templateStyle: "simple",
    primaryColor: "#374151",
    tableHeaderBg: "#f0f0f0",
    tableHeaderColor: "#111111",
  },
  professional: {
    templateStyle: "professional",
    primaryColor: "#1a1a1a",
    tableHeaderBg: "#1a1a1a",
    tableHeaderColor: "#ffffff",
  },
};

// ─── Sample data for designer preview ────────────────────────────────────────
export const SAMPLE_DATA: Record<InvoiceType, any> = {
  sales: {
    invoiceNo: "INV-2024-0001",
    date: "2024-01-15",
    customerName: "أحمد محمد علي",
    customerPhone: "07701234567",
    items: [
      { productNameAr: "ثوب أبيض فاخر",   quantity: 2, unitPrice: 45000, discount: 5000, total: 85000 },
      { productNameAr: "عباءة سوداء فاخرة", quantity: 1, unitPrice: 75000, discount: 0,    total: 75000 },
    ],
    subtotal: "175000", discountAmount: "5000",
    total: "160000", paidAmount: "160000", remainingAmount: "0",
    paymentMethod: "cash", paymentStatus: "paid", notes: null,
  },
  purchase: {
    invoiceNo: "PUR-2024-0001",
    date: "2024-01-15",
    supplierName: "شركة الأقمشة الفاخرة",
    supplierPhone: "07709876543",
    items: [
      { productNameAr: "قماش قطني فاخر", quantity: 10, costPrice: 15000, sellPrice: 25000, discount: 0,    total: 150000 },
      { productNameAr: "خيط حرير",        quantity: 20, costPrice: 2000,  sellPrice: 4000,  discount: 1000, total: 39000  },
    ],
    subtotal: "189000", discountAmount: "1000", extraCosts: "5000",
    total: "193000", paidAmount: "100000", remainingAmount: "93000",
    paymentMethod: "transfer", paymentStatus: "partial", notes: null,
  },
  pos: {
    invoiceNo: "POS-20240115-001",
    date: "2024-01-15",
    customerName: "زبون",
    items: [
      { productNameAr: "وشاح ملون",  quantity: 1, unitPrice: 12000, discount: 0, total: 12000 },
      { productNameAr: "حزام جلدي",  quantity: 2, unitPrice: 8000,  discount: 0, total: 16000 },
    ],
    total: "28000", paidAmount: "30000", remainingAmount: "0",
    paymentMethod: "cash", paymentStatus: "paid", notes: null,
  },
  delivery: {
    invoiceNo: "DEL-2024-0001",
    date: "2024-01-15",
    customerName: "ليلى أحمد",
    customerPhone: "07701112233",
    deliveryAddress: "بغداد — الكرادة — شارع الرشيد",
    items: [
      { productNameAr: "فستان صيفي أنيق", quantity: 1, unitPrice: 35000, discount: 0, total: 35000 },
    ],
    subtotal: "35000", deliveryFee: "5000",
    total: "40000", paidAmount: "0", remainingAmount: "40000",
    paymentMethod: "cod", paymentStatus: "unpaid", notes: "يُرجى الاتصال قبل التوصيل",
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtNum(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  if (!Number.isFinite(v)) return "0";
  return v.toLocaleString("en-US");
}

function fmtCurrency(n: number | string | null | undefined): string {
  return `${fmtNum(n)} د.ع`;
}

function getCellValue(col: ColumnDef, item: any, index: number): string {
  switch (col.key) {
    case "index":    return String(index + 1);
    case "product":  return item.productNameAr ?? item.productName ?? "—";
    case "qty":      return String(item.quantity ?? 0);
    case "price":    return fmtCurrency(item.unitPrice ?? item.price ?? 0);
    case "cost":     return fmtCurrency(item.costPrice ?? 0);
    case "sell":     return fmtCurrency(item.sellPrice ?? 0);
    case "discount": return fmtCurrency(item.discount ?? 0);
    case "tax":      return "0%";
    case "total":    return fmtCurrency(item.total ?? 0);
    default:         return "—";
  }
}

// ─── CSS builder ─────────────────────────────────────────────────────────────
function buildCSS(cfg: InvoiceTemplateConfig): string {
  const { primaryColor, globalFont, direction, paperSize, templateStyle,
    tableHeaderBg, tableHeaderColor, tableFontSize } = cfg;
  const th = paperSize.startsWith("thermal");

  const pageRule =
    paperSize === "a4"         ? "@page { size: A4; margin: 12mm; }" :
    paperSize === "a5"         ? "@page { size: A5; margin: 8mm; }" :
    paperSize === "thermal80"  ? "@page { size: 80mm auto; margin: 3mm 2mm; }" :
                                 "@page { size: 58mm auto; margin: 2mm 1mm; }";

  const maxW =
    paperSize === "thermal80" ? "74mm" :
    paperSize === "thermal58" ? "54mm" : "100%";

  const base = `
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'${globalFont}',Cairo,sans-serif;direction:${direction};background:white;color:#111;
         font-size:${th ? 11 : 13}px;max-width:${maxW};margin:0 auto;}
    .page{padding:${th ? "4px" : "0"};}
    .sec{margin-bottom:${th ? 6 : 12}px;}
    .divider{border:none;border-top:1px dashed #aaa;margin:${th ? 4 : 8}px 0;}
    .frow{display:flex;justify-content:space-between;padding:2px 0;font-size:${th ? 11 : 13}px;}
    table{width:100%;border-collapse:collapse;font-size:${tableFontSize}px;margin:${th ? 4 : 8}px 0;}
    th,td{padding:${th ? "3px 4px" : "5px 8px"};text-align:${direction === "rtl" ? "right" : "left"};}
    .totals .trow{display:flex;justify-content:space-between;padding:${th ? "2px 0" : "4px 0"};font-size:${th ? 12 : 14}px;}
    .totals .grand{font-size:${th ? 14 : 16}px;font-weight:700;color:${primaryColor};border-top:2px solid ${primaryColor};padding-top:${th ? 4 : 6}px;margin-top:${th ? 4 : 6}px;}
    .inv-footer{text-align:center;font-size:${th ? 10 : 11}px;color:#666;margin-top:${th ? 8 : 16}px;padding-top:${th ? 4 : 8}px;border-top:1px solid #ddd;}
    @media print{body{margin:0;}}
    ${pageRule}
  `;

  if (templateStyle === "modern") return base + `
    .inv-header{background:${primaryColor};color:#fff;padding:${th ? "8px" : "16px"};margin-bottom:${th ? 6 : 12}px;}
    .inv-header,.inv-header *{color:#fff;}
    .inv-title{font-size:${th ? 15 : 20}px;font-weight:700;}
    .inv-num{font-size:${th ? 12 : 18}px;font-family:monospace;opacity:.9;}
    thead tr{background:${tableHeaderBg};}
    th{color:${tableHeaderColor};font-weight:600;}
    tbody tr:nth-child(even){background:#fafafa;}
    td{border-bottom:1px solid #eee;}
  `;

  if (templateStyle === "simple") return base + `
    .inv-header{border-bottom:1px dashed #aaa;padding-bottom:${th ? 6 : 10}px;margin-bottom:${th ? 6 : 12}px;}
    .inv-title{font-size:${th ? 14 : 18}px;font-weight:700;text-align:center;}
    .inv-num{font-family:monospace;font-size:${th ? 11 : 13}px;}
    thead th{border-bottom:2px solid #333;}
    td{border-bottom:1px dotted #ddd;}
  `;

  if (templateStyle === "professional") return base + `
    .inv-header{border-bottom:3px solid ${primaryColor};padding-bottom:${th ? 8 : 14}px;margin-bottom:${th ? 6 : 12}px;}
    .inv-title{font-size:${th ? 14 : 20}px;font-weight:700;color:${primaryColor};}
    .inv-num{font-size:${th ? 14 : 22}px;font-weight:700;font-family:monospace;}
    thead tr{background:${primaryColor};}
    th{color:#fff;font-weight:600;}
    tbody tr:nth-child(even){background:#f9f9f9;}
    td,th{border:1px solid #ddd;}
  `;

  // classic (default)
  return base + `
    .inv-header{border-bottom:2px solid ${primaryColor};padding-bottom:${th ? 8 : 14}px;margin-bottom:${th ? 6 : 12}px;}
    .inv-title{font-size:${th ? 15 : 20}px;font-weight:700;text-align:center;margin:${th ? "4px 0" : "6px 0"};}
    thead th{background:${tableHeaderBg};color:${tableHeaderColor};font-weight:600;border:1px solid #ddd;}
    td{border:1px solid #ddd;}
  `;
}

// ─── Section renderers ────────────────────────────────────────────────────────
function renderHeader(cfg: InvoiceTemplateConfig, data: any): string {
  const { showLogo, logoUrl, logoSize, logoPosition, companyName, companyNameSize, companyNameColor,
    companyAddress, companyPhone, companyEmail, taxNumber, tradeNumber,
    welcomeText, headerText, showInvoiceNumber, showDate, templateStyle, direction } = cfg;
  const th = cfg.paperSize.startsWith("thermal");

  const logoHtml = showLogo && logoUrl
    ? `<img src="${logoUrl}" style="width:${logoSize}px;height:auto;object-fit:contain;display:block;${th ? "margin:0 auto 4px;" : ""}"/>`
    : "";

  const nameHtml = companyName
    ? `<div style="font-size:${companyNameSize}px;font-weight:700;color:${companyNameColor};${th ? "text-align:center;" : ""}">${escHtml(companyName)}</div>`
    : "";

  const details = [
    companyAddress,
    companyPhone,
    companyEmail,
    taxNumber  ? `رقم ضريبي: ${taxNumber}`  : "",
    tradeNumber ? `سجل تجاري: ${tradeNumber}` : "",
    welcomeText,
  ].filter(Boolean);

  const detailHtml = details
    .map(d => `<div style="font-size:${th ? 10 : 11}px;color:#666;${th ? "text-align:center;" : ""}">${escHtml(d ?? "")}</div>`)
    .join("");

  const titleHtml = `<div class="inv-title">${escHtml(headerText)}</div>`;
  const numHtml   = showInvoiceNumber && data?.invoiceNo ? `<div class="inv-num">${escHtml(data.invoiceNo)}</div>` : "";
  const dateHtml  = showDate && data?.date ? `<div style="font-size:${th ? 10 : 11}px;color:#666;">${escHtml(data.date)}</div>` : "";

  // Thermal: vertical, centered
  if (th) return `
    <div class="inv-header sec" style="text-align:center;">
      ${logoHtml}${nameHtml}${detailHtml}
      <hr class="divider" style="margin:4px 0;"/>
      ${titleHtml}${numHtml}${dateHtml}
    </div>`;

  // Modern/Professional: two-column layout
  if (templateStyle === "modern") {
    return `
      <div class="inv-header sec">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;">
            ${logoHtml}
            <div>${nameHtml}${detailHtml}</div>
          </div>
          <div style="text-align:${direction === "rtl" ? "left" : "right"};">
            ${titleHtml}${numHtml}${dateHtml}
          </div>
        </div>
      </div>`;
  }

  if (templateStyle === "professional") {
    return `
      <div class="inv-header sec">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:12px;">
            ${logoHtml}
            <div>${nameHtml}${detailHtml}</div>
          </div>
          <div style="text-align:${direction === "rtl" ? "left" : "right"};">
            ${titleHtml}
            ${numHtml}
            ${dateHtml}
            ${taxNumber ? `<div style="font-size:11px;color:#666;margin-top:4px;">ض.م: ${escHtml(taxNumber)}</div>` : ""}
          </div>
        </div>
      </div>`;
  }

  // Classic / Simple: logo on one side, invoice info on other
  const logoSide = logoPosition === "left"
    ? `text-align:${direction === "rtl" ? "right" : "left"};`
    : logoPosition === "center" ? "text-align:center;" : `text-align:${direction === "rtl" ? "right" : "left"};`;

  return `
    <div class="inv-header sec">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="${logoSide}">
          ${logoHtml}${nameHtml}${detailHtml}
        </div>
        <div style="text-align:${direction === "rtl" ? "left" : "right"};">
          ${titleHtml}${numHtml}${dateHtml}
        </div>
      </div>
    </div>`;
}

function renderMeta(cfg: InvoiceTemplateConfig, data: any, type: InvoiceType): string {
  if (!data) return "";
  const th = cfg.paperSize.startsWith("thermal");
  const rows: string[] = [];

  if (type === "sales" || type === "pos" || type === "delivery") {
    if (data.customerName) rows.push(`الزبون: <b>${escHtml(data.customerName)}</b>`);
    if (data.customerPhone) rows.push(`الهاتف: ${escHtml(data.customerPhone)}`);
    if (data.deliveryAddress) rows.push(`العنوان: ${escHtml(data.deliveryAddress)}`);
  } else {
    if (data.supplierName) rows.push(`المورد: <b>${escHtml(data.supplierName)}</b>`);
    if (data.supplierPhone) rows.push(`الهاتف: ${escHtml(data.supplierPhone)}`);
  }

  if (!rows.length) return "";
  return `<div class="sec">${rows.map(r => `<div class="frow" style="font-size:${th ? 11 : 13}px;">${r}</div>`).join("")}</div>`;
}

function renderTable(cfg: InvoiceTemplateConfig, data: any): string {
  const { columns } = cfg;
  const th = cfg.paperSize.startsWith("thermal");
  const items: any[] = data?.items ?? [];
  if (!items.length) return "";

  const cols = [...columns].filter(c => c.show).sort((a, b) => a.order - b.order);
  if (!cols.length) return "";

  const thead = `<thead><tr>${cols.map(c => `<th style="background:${cfg.tableHeaderBg};color:${cfg.tableHeaderColor};">${c.label}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${items.map((item, i) =>
    `<tr>${cols.map(c => `<td>${getCellValue(c, item, i)}</td>`).join("")}</tr>`
  ).join("")}</tbody>`;

  const wrap = th ? "" : "overflow:auto;";
  return `<div class="sec" style="${wrap}"><table>${thead}${tbody}</table></div>`;
}

function renderTotals(cfg: InvoiceTemplateConfig, data: any, type: InvoiceType): string {
  if (!data) return "";
  const th = cfg.paperSize.startsWith("thermal");

  type TRow = [string, string, boolean];
  const rows: TRow[] = [];

  if (type === "purchase") {
    const sub = parseFloat(data.subtotal ?? "0");
    const dis = parseFloat(data.discountAmount ?? "0");
    const ext = parseFloat(data.extraCosts ?? "0");
    if (sub !== parseFloat(data.total ?? "0")) rows.push(["المجموع", fmtCurrency(sub), false]);
    if (dis > 0) rows.push(["الخصم", `- ${fmtCurrency(dis)}`, false]);
    if (ext > 0) rows.push(["تكاليف إضافية", fmtCurrency(ext), false]);
    rows.push(["الإجمالي النهائي", fmtCurrency(data.total), true]);
    const paid = parseFloat(data.paidAmount ?? "0");
    const rem  = parseFloat(data.remainingAmount ?? "0");
    if (paid > 0) rows.push(["المدفوع", fmtCurrency(paid), false]);
    if (rem  > 0) rows.push(["المتبقي", fmtCurrency(rem),  false]);
  } else if (type === "pos") {
    rows.push(["الإجمالي", fmtCurrency(data.total), true]);
    const paid = parseFloat(data.paidAmount ?? "0");
    const tot  = parseFloat(data.total ?? "0");
    if (paid > 0) rows.push(["المدفوع", fmtCurrency(paid), false]);
    const change = paid - tot;
    if (change > 0) rows.push(["الباقي", fmtCurrency(change), false]);
  } else {
    const sub = parseFloat(data.subtotal ?? "0");
    const dis = parseFloat(data.discountAmount ?? "0");
    const fee = parseFloat(data.deliveryFee ?? "0");
    if (sub !== parseFloat(data.total ?? "0")) rows.push(["المجموع", fmtCurrency(sub), false]);
    if (dis > 0) rows.push(["الخصم", `- ${fmtCurrency(dis)}`, false]);
    if (fee > 0) rows.push(["رسوم التوصيل", fmtCurrency(fee), false]);
    rows.push(["الإجمالي النهائي", fmtCurrency(data.total), true]);
    const paid = parseFloat(data.paidAmount ?? "0");
    const rem  = parseFloat(data.remainingAmount ?? "0");
    if (paid > 0) rows.push(["المدفوع", fmtCurrency(paid), false]);
    if (rem  > 0) rows.push(["المتبقي", fmtCurrency(rem),  false]);
  }

  const rowsHtml = rows
    .map(([label, val, bold]) =>
      `<div class="trow ${bold ? "grand" : ""}"${bold ? ` style="color:${cfg.primaryColor};font-weight:700;"` : ""}>
         <span>${label}</span><span>${val}</span>
       </div>`
    )
    .join("");

  return th
    ? `<div class="sec totals">${rowsHtml}</div>`
    : `<div class="sec totals" style="display:flex;justify-content:flex-${cfg.direction === "rtl" ? "start" : "end"}">
         <div style="min-width:250px;">${rowsHtml}</div>
       </div>`;
}

function renderFooter(cfg: InvoiceTemplateConfig, data: any): string {
  const parts = [
    data?.notes ? `<div style="margin-bottom:4px;font-size:12px;">ملاحظة: ${escHtml(data.notes)}</div>` : "",
    cfg.footerThankYou    ? `<div>${escHtml(cfg.footerThankYou)}</div>`    : "",
    cfg.footerReturnPolicy ? `<div style="margin-top:4px;font-size:10px;">${escHtml(cfg.footerReturnPolicy)}</div>` : "",
    cfg.footerNotes       ? `<div style="margin-top:4px;font-size:10px;">${escHtml(cfg.footerNotes)}</div>`       : "",
  ].filter(Boolean).join("");
  return parts ? `<div class="inv-footer sec">${parts}</div>` : "";
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Main generator ───────────────────────────────────────────────────────────
export function generateInvoicePrintHTML(
  config: InvoiceTemplateConfig,
  data: any,
  type: InvoiceType,
  opts: { autoPrint?: boolean } = {}
): string {
  const css    = buildCSS(config);
  const hdr    = renderHeader(config, data);
  const meta   = renderMeta(config, data, type);
  const table  = renderTable(config, data);
  const totals = renderTotals(config, data, type);
  const footer = renderFooter(config, data);
  const printJs = opts.autoPrint
    ? `<script>window.onload=function(){setTimeout(function(){window.print();},400);}</script>`
    : "";
  const fontSrc = config.globalFont.replace(/ /g, "+");

  return `<!DOCTYPE html>
<html dir="${config.direction}" lang="ar">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=${fontSrc}:wght@400;600;700&display=swap" rel="stylesheet">
  <style>${css}</style>
  <title>${escHtml(config.headerText)}</title>
</head>
<body>
  <div class="page">
    ${hdr}${meta}${table}${totals}${footer}
  </div>
  ${printJs}
</body>
</html>`;
}

// ─── Open print window helper ─────────────────────────────────────────────────
// Used by sales.tsx and purchases.tsx
export async function printInvoiceWithTemplate(
  type: InvoiceType,
  data: any,
  fetchFn: (url: string) => Promise<any>
): Promise<void> {
  let cfg: InvoiceTemplateConfig = getDefaultConfig(type);
  try {
    const templates: any[] = await fetchFn(`/admin/print-templates?type=${type}`);
    const tpl = Array.isArray(templates)
      ? (templates.find((t: any) => t.isDefault === 1) ?? templates[0])
      : null;
    if (tpl?.config && typeof tpl.config === "object") {
      cfg = { ...cfg, ...tpl.config };
    }
  } catch { /* use defaults */ }

  const html = generateInvoicePrintHTML(cfg, data, type, { autoPrint: true });
  const win = window.open("", "_blank", "width=860,height=720");
  if (!win) { alert("يُرجى السماح للنوافذ المنبثقة"); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
