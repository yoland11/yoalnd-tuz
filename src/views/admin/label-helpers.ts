// ─────────────────────────────────────────────────────────────────────────────
// AJN ERP — Label Printing Engine
//
// Thermal label engine for Xprinter XP-236B (203 DPI) using the installed
// Windows printer driver (browser / desktop print pipeline). Labels default to
// 40mm × 30mm landscape, 0 margin, auto-centered, high-contrast black ink.
//
// The same markup builder feeds BOTH the on-screen live preview and the print
// window, so what you see is exactly what prints.
//
// TSPL command generation is included as a future-ready path (direct-to-printer
// raw printing) but is NOT used by the default Windows-driver flow.
// ─────────────────────────────────────────────────────────────────────────────

import { printWhenImagesReadyScript } from "./print-helpers";

// ───── Types ─────

export type LabelKind = "asset" | "product" | "rental" | "warehouse" | "custom";

export type BarcodeFormat = "CODE128" | "CODE39" | "EAN13" | "AUTO";

/** Which fields the label shows. Mirrors the ASSET / PRODUCT / RENTAL / WAREHOUSE / CUSTOM specs. */
export type LabelFieldToggles = {
  brand: boolean; // top "AJN ERP" banner
  name: boolean; // asset / product name
  code: boolean; // readable code (e.g. SP-RCF-001)
  category: boolean;
  status: boolean;
  warehouse: boolean;
  shelf: boolean;
  employee: boolean;
  price: boolean;
  deposit: boolean;
  notes: boolean;
  qr: boolean;
  barcode: boolean;
};

export type LabelTemplateConfig = {
  kind: LabelKind;
  brandText: string; // top banner text
  barcodeFormat: BarcodeFormat;
  qrBaseUrl: string; // e.g. https://your-domain.com  → QR = {base}/assets/{code}
  fields: LabelFieldToggles;
};

/** Physical + quality settings. Defaults target the Xprinter XP-236B 40×30 stock. */
export type LabelSettings = {
  widthMm: number;
  heightMm: number;
  dpi: number;
  marginMm: number;
  gapMm: number;
  orientation: "landscape" | "portrait";
  autoCenter: boolean;
  highQuality: boolean;
  printerName: string;
  /** Print rotation in degrees (0/90/180/270) to compensate for the printer's feed direction. */
  rotation?: number;
};

/** Resolved, ready-to-render data for a single label. */
export type LabelData = {
  id: string;
  name: string;
  code: string; // readable / barcode value shown at the bottom
  barcodeValue: string;
  qrValue: string;
  category?: string;
  status?: string;
  warehouse?: string;
  shelf?: string;
  employee?: string;
  price?: string;
  deposit?: string;
  notes?: string;
};

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  widthMm: 40,
  heightMm: 60,
  dpi: 203,
  marginMm: 0,
  gapMm: 2,
  orientation: "landscape",
  autoCenter: true,
  highQuality: true,
  printerName: "Xprinter XP-236B",
  rotation: 0,
};

const BASE_FIELDS: LabelFieldToggles = {
  brand: true,
  name: true,
  code: true,
  category: false,
  status: false,
  warehouse: false,
  shelf: false,
  employee: false,
  price: false,
  deposit: false,
  notes: false,
  qr: true,
  barcode: true,
};

/** The five built-in templates from the spec. */
export const DEFAULT_TEMPLATES: Record<LabelKind, LabelTemplateConfig> = {
  asset: {
    kind: "asset",
    brandText: "AJN ERP",
    barcodeFormat: "CODE128",
    qrBaseUrl: "",
    fields: {
      ...BASE_FIELDS,
      category: true,
      status: true,
      warehouse: true,
      shelf: true,
    },
  },
  product: {
    kind: "product",
    brandText: "AJN ERP",
    barcodeFormat: "CODE128",
    qrBaseUrl: "",
    fields: { ...BASE_FIELDS, category: true, price: true },
  },
  rental: {
    kind: "rental",
    brandText: "AJN ERP",
    barcodeFormat: "CODE128",
    qrBaseUrl: "",
    fields: { ...BASE_FIELDS, status: true, deposit: true },
  },
  warehouse: {
    kind: "warehouse",
    brandText: "AJN ERP",
    barcodeFormat: "CODE128",
    qrBaseUrl: "",
    fields: { ...BASE_FIELDS, warehouse: true, shelf: true, name: false },
  },
  custom: {
    kind: "custom",
    brandText: "AJN ERP",
    barcodeFormat: "AUTO",
    qrBaseUrl: "",
    fields: {
      ...BASE_FIELDS,
      category: true,
      status: true,
      warehouse: true,
      shelf: true,
      employee: true,
      price: true,
      notes: true,
    },
  },
};

export const TEMPLATE_LABELS: Record<LabelKind, string> = {
  asset: "ملصق أصل",
  product: "ملصق منتج",
  rental: "ملصق إيجار",
  warehouse: "ملصق رف مخزن",
  custom: "ملصق مخصص",
};

// ───── QR + barcode generation ─────

/** Build the QR target URL. Opens the Asset Passport / Product page inside AJN ERP. */
export function labelQrUrl(config: LabelTemplateConfig, data: LabelData): string {
  if (data.qrValue) return data.qrValue;
  const base = (config.qrBaseUrl || window.location.origin).replace(/\/+$/, "");
  const segment = config.kind === "product" ? "products" : "assets";
  return `${base}/${segment}/${encodeURIComponent(data.code)}`;
}

export async function generateQrDataUrl(text: string, sizePx = 320): Promise<string> {
  const mod: any = await import("qrcode");
  const QR = mod.default ?? mod;
  return QR.toDataURL(text || " ", {
    errorCorrectionLevel: "M",
    margin: 1,
    width: sizePx,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/** Pick a concrete barcode symbology when the template is set to AUTO. */
export function resolveBarcodeFormat(format: BarcodeFormat, value: string): "CODE128" | "CODE39" | "EAN13" {
  if (format !== "AUTO") return format;
  if (/^\d{13}$/.test(value)) return "EAN13";
  if (/^[0-9A-Z\-. $/+%]+$/.test(value)) return "CODE39";
  return "CODE128";
}

let barcodeLibPromise: Promise<any> | null = null;
function loadBarcodeLib(): Promise<any> {
  if (!barcodeLibPromise) {
    barcodeLibPromise = import("jsbarcode").then((m: any) => m.default ?? m);
  }
  return barcodeLibPromise;
}

/**
 * Render a barcode to a standalone SVG string (crisp vector, no blur/stretch).
 * Returns "" if the value cannot be encoded so the label can degrade gracefully.
 */
export async function generateBarcodeSvg(
  value: string,
  format: BarcodeFormat,
  opts: { height?: number; displayValue?: boolean; fontSize?: number } = {},
): Promise<string> {
  if (!value) return "";
  const JsBarcode = await loadBarcodeLib();
  const resolved = resolveBarcodeFormat(format, value);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const render = (fmt: string, text: string) =>
    JsBarcode(svg, text, {
      format: fmt,
      displayValue: opts.displayValue ?? false,
      height: opts.height ?? 60,
      width: 2,
      margin: 0,
      fontSize: opts.fontSize ?? 12,
      background: "#ffffff",
      lineColor: "#000000",
    });
  try {
    render(resolved, value);
  } catch {
    // EAN13 (and friends) reject invalid input — fall back to the universal CODE128.
    try {
      render("CODE128", value);
    } catch {
      return "";
    }
  }
  svg.setAttribute("preserveAspectRatio", "none");
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  return new XMLSerializer().serializeToString(svg);
}

// ───── Label markup ─────

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build the inner HTML of a single label. Async because the QR + barcode are
 * generated as data-url / SVG. This exact markup is used by the live preview
 * AND the print window, so the preview is pixel-accurate.
 */
export async function buildLabelMarkup(
  data: LabelData,
  config: LabelTemplateConfig,
  opts: { qrPx?: number } = {},
): Promise<string> {
  const f = config.fields;
  const parts: string[] = [];

  if (f.brand) {
    parts.push(`<div class="lb-brand">${esc(config.brandText || "AJN ERP")}</div>`);
  }

  const [qrDataUrl, barcodeSvg] = await Promise.all([
    f.qr ? generateQrDataUrl(labelQrUrl(config, data), opts.qrPx ?? 320) : Promise.resolve(""),
    f.barcode ? generateBarcodeSvg(data.barcodeValue || data.code, config.barcodeFormat, { height: 60 }) : Promise.resolve(""),
  ]);

  const rows: string[] = [];
  const pushRow = (label: string, value?: string, cls = "") => {
    if (!value) return;
    rows.push(`<div class="lb-row ${cls}"><span class="lb-k">${esc(label)}</span><span class="lb-v">${esc(value)}</span></div>`);
  };
  if (f.name && data.name) rows.push(`<div class="lb-name">${esc(data.name)}</div>`);
  if (f.code && data.code) rows.push(`<div class="lb-row lb-code-row"><span class="lb-k">Code</span><span class="lb-v lb-mono">${esc(data.code)}</span></div>`);
  if (f.category) pushRow("الصنف", data.category);
  if (f.status) pushRow("الحالة", data.status);
  if (f.warehouse) pushRow("المخزن", data.warehouse);
  if (f.shelf) pushRow("الرف", data.shelf);
  if (f.employee) pushRow("الموظف", data.employee);
  if (f.price) pushRow("السعر", data.price);
  if (f.deposit) pushRow("التأمين", data.deposit);
  if (f.notes) pushRow("ملاحظة", data.notes);

  parts.push(`<div class="lb-body">
    ${f.qr && qrDataUrl ? `<div class="lb-qr"><img src="${qrDataUrl}" alt="QR" /></div>` : ""}
    <div class="lb-fields">${rows.join("")}</div>
  </div>`);

  if (f.barcode && barcodeSvg) {
    parts.push(`<div class="lb-footer">
      <div class="lb-barcode">${barcodeSvg}</div>
      <div class="lb-readable lb-mono">${esc(data.barcodeValue || data.code)}</div>
    </div>`);
  }

  return parts.join("");
}

// ───── Print CSS (203 DPI, exact mm sizing) ─────

/**
 * Stylesheet for the label sheet. Sizes are in millimetres so the physical
 * output matches the stock exactly regardless of screen DPI. `scoped` renders
 * the same look inside the on-screen preview (screen media).
 */
export function labelCss(settings: LabelSettings, opts: { screen?: boolean } = {}): string {
  const w = settings.widthMm;
  const h = settings.heightMm;
  const pad = Math.max(settings.marginMm, 0.8);
  // Quality knobs: crisp barcode/QR edges, forced black ink, no anti-alias blur.
  const rendering = settings.highQuality ? "crisp-edges" : "auto";
  const centerBody = settings.autoCenter && opts.screen ? "align-items:center;justify-content:center;" : "";
  // Print rotation to compensate for the printer's feed direction. When rotating
  // 90/270 the page bounding box swaps W↔H so the label still fits its page.
  const rot = (((settings.rotation ?? 0) % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const pageW = swap ? h : w;
  const pageH = swap ? w : h;
  // Tall labels (e.g. 40×60) use a vertical layout with a big centered QR so they
  // fill the stock instead of leaving the bottom blank.
  const portrait = h >= w * 1.35;
  const qrMm = portrait ? Math.min(w - 6, 28) : 13;

  return `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800;900&display=swap');
    ${opts.screen ? "" : `@page { size: ${pageW}mm ${pageH}mm; margin: 0; }`}
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    ${opts.screen ? "" : `html, body { margin: 0; padding: 0; background: #fff; }`}
    .lb-sheet { display: block; }
    ${opts.screen ? "" : `
    .lb-page {
      width: ${pageW}mm; height: ${pageH}mm;
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
      page-break-after: always; break-after: page;
    }
    .lb-page:last-child { page-break-after: auto; break-after: auto; }
    `}
    .lb-label {
      position: relative;
      width: ${w}mm;
      height: ${h}mm;
      padding: ${pad}mm;
      background: #fff;
      color: #000;
      direction: rtl;
      font-family: Cairo, Tahoma, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      ${opts.screen ? centerBody : `transform: rotate(${rot}deg); transform-origin: center center; flex: 0 0 auto;`}
    }
    .lb-label * { color: #000 !important; }
    .lb-brand {
      text-align: center;
      font-weight: 900;
      font-size: ${portrait ? "3.4mm" : "2.7mm"};
      line-height: 1.1;
      letter-spacing: 0.2mm;
      border-bottom: 0.35mm solid #000;
      padding-bottom: 0.5mm;
      margin-bottom: 0.8mm;
    }
    .lb-body { flex: 1; display: flex; gap: 1mm; min-height: 0; ${portrait ? "flex-direction: column; align-items: center; justify-content: center;" : ""} }
    .lb-qr { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; }
    .lb-qr img {
      width: ${qrMm}mm; height: ${qrMm}mm; object-fit: contain; display: block;
      image-rendering: ${rendering}; image-rendering: pixelated;
    }
    .lb-fields { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 0.3mm; ${portrait ? "width: 100%; text-align: center;" : ""} }
    .lb-name { font-weight: 800; font-size: ${portrait ? "3mm" : "2.4mm"}; line-height: 1.15; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .lb-row { display: flex; justify-content: ${portrait ? "center" : "space-between"}; gap: 1.5mm; font-size: ${portrait ? "2.6mm" : "1.9mm"}; line-height: 1.3; font-weight: 700; }
    .lb-row .lb-k { opacity: 0.85; flex: 0 0 auto; }
    .lb-row .lb-v { font-weight: 800; text-align: ${portrait ? "right" : "left"}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lb-mono { font-family: "Courier New", monospace; letter-spacing: 0.2mm; direction: ltr; }
    .lb-code-row .lb-v { font-size: ${portrait ? "2.6mm" : "2mm"}; }
    .lb-footer { margin-top: 0.8mm; text-align: center; }
    .lb-barcode { width: 100%; height: ${portrait ? "11mm" : "6.5mm"}; }
    .lb-barcode svg { width: 100%; height: 100%; display: block; image-rendering: ${rendering}; }
    .lb-readable { font-size: ${portrait ? "3mm" : "2.2mm"}; font-weight: 800; line-height: 1.1; margin-top: 0.3mm; }
    @media print { * { color: #000 !important; } body { background: #fff !important; } }
  `;
}

// ───── Print window ─────

/** Build the full printable HTML document for one or more labels. */
export async function buildLabelSheetHtml(
  labels: LabelData[],
  config: LabelTemplateConfig,
  settings: LabelSettings,
  opts: { title?: string; autoPrint?: boolean } = {},
): Promise<string> {
  const markups = await Promise.all(labels.map((d) => buildLabelMarkup(d, config)));
  const sheet = markups.map((m) => `<div class="lb-page"><div class="lb-label">${m}</div></div>`).join("\n");
  return `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8" />
    <title>${esc(opts.title ?? "طباعة الملصقات")}</title>
    <style>${labelCss(settings)}</style>
  </head><body>
    <div class="lb-sheet">${sheet}</div>
    ${opts.autoPrint === false ? "" : printWhenImagesReadyScript(true)}
  </body></html>`;
}

/** Open a print window and stream the label sheet into it (Windows-driver flow). */
export async function openLabelPrintWindow(
  labels: LabelData[],
  config: LabelTemplateConfig,
  settings: LabelSettings,
  opts: { title?: string } = {},
): Promise<void> {
  if (!labels.length) throw new Error("لا توجد ملصقات للطباعة");
  const html = await buildLabelSheetHtml(labels, config, settings, opts);
  const w = window.open("", "_blank", "width=420,height=560");
  if (!w) throw new Error("تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة.");
  w.document.write(html);
  w.document.close();
}

// ───── TSPL (future-ready raw printing) ─────

/**
 * Generate TSPL commands for direct-to-printer raw printing on the Xprinter
 * XP-236B. NOT used by the default Windows-driver flow — kept for a future
 * native/desktop bridge that can stream raw bytes to the device.
 */
export function generateTspl(labels: LabelData[], config: LabelTemplateConfig, settings: LabelSettings): string {
  const dots = (mm: number) => Math.round((mm / 25.4) * settings.dpi);
  const out: string[] = [];
  out.push(`SIZE ${settings.widthMm} mm,${settings.heightMm} mm`);
  out.push(`GAP ${settings.gapMm} mm,0 mm`);
  out.push("DIRECTION 1");
  out.push("CLS");
  for (const d of labels) {
    out.push("CLS");
    if (config.fields.brand) out.push(`TEXT ${dots(2)},${dots(1)},"2",0,1,1,"${config.brandText || "AJN ERP"}"`);
    if (config.fields.qr) out.push(`QRCODE ${dots(2)},${dots(6)},M,4,A,0,"${labelQrUrl(config, d)}"`);
    if (config.fields.name && d.name) out.push(`TEXT ${dots(18)},${dots(7)},"1",0,1,1,"${d.name}"`);
    if (config.fields.code && d.code) out.push(`TEXT ${dots(18)},${dots(11)},"1",0,1,1,"${d.code}"`);
    if (config.fields.barcode) {
      const value = d.barcodeValue || d.code;
      const fmt = resolveBarcodeFormat(config.barcodeFormat, value);
      const sym = fmt === "EAN13" ? "EAN13" : fmt === "CODE39" ? "39" : "128";
      out.push(`BARCODE ${dots(2)},${dots(21)},"${sym}",${dots(6)},1,0,2,2,"${value}"`);
    }
    out.push("PRINT 1,1");
  }
  return out.join("\n");
}

// ───── Label history (device-local; reuses no new tables/APIs) ─────

export type LabelHistoryEntry = {
  id: string;
  at: number; // epoch ms
  who: string;
  count: number;
  template: string;
  kind: LabelKind;
  printer: string;
  device: string;
  status: "printed" | "test" | "error";
  note?: string;
};

const HISTORY_KEY = "ajn-label-history";
const HISTORY_LIMIT = 300;

function deviceLabel(): string {
  if (typeof navigator === "undefined") return "غير معروف";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Mac/i.test(ua)) return "macOS";
  return "متصفح";
}

export function getLabelHistory(): LabelHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function recordLabelPrint(entry: Omit<LabelHistoryEntry, "id" | "at" | "device">): LabelHistoryEntry {
  const full: LabelHistoryEntry = {
    ...entry,
    id: `lh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    device: deviceLabel(),
  };
  try {
    const list = [full, ...getLabelHistory()].slice(0, HISTORY_LIMIT);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
  return full;
}

export function clearLabelHistory(): void {
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
}

export type LabelHistoryStats = {
  printedToday: number;
  totalPrinted: number;
  lastPrinter: string;
  errors: number;
};

export function labelHistoryStats(history = getLabelHistory()): LabelHistoryStats {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dayStart = startOfDay.getTime();
  let printedToday = 0;
  let totalPrinted = 0;
  let errors = 0;
  let lastPrinter = "";
  for (const e of history) {
    if (e.status === "error") errors += 1;
    else totalPrinted += e.count;
    if (e.at >= dayStart && e.status !== "error") printedToday += e.count;
    if (!lastPrinter && e.printer) lastPrinter = e.printer;
  }
  return { printedToday, totalPrinted, lastPrinter: lastPrinter || "—", errors };
}
