// AJN REPX Import Engine — a dependency-free parser for DevExpress XtraReports (.repx) files.
// Reads the report XML and produces a normalized, render-friendly model. It never throws on
// unsupported content: unknown controls are collected as warnings and the rest is imported.

export type RepxXmlNode = { tag: string; attrs: Record<string, string>; children: RepxXmlNode[]; text: string };

export type RepxFont = { family: string; size: number; bold: boolean; italic: boolean; underline: boolean };

export type RepxElement = {
  id: string;
  type: string; // label | table | cell | picture | barcode | qrcode | line | shape | pageinfo | richtext | checkbox | unknown
  controlType: string; // original DevExpress ControlType
  name: string;
  x: number; y: number; width: number; height: number; // px @96dpi (approx)
  text: string;
  font: RepxFont | null;
  foreColor: string | null;
  backColor: string | null;
  borders: string | null;
  borderColor: string | null;
  textAlignment: string | null;
  expression: string | null; // data-binding expression e.g. [ITEM_NAME]
  dataField: string | null; // primary extracted field
  format: string | null;
  symbology: string | null; // barcode symbology
  angle: number; // rotation
  rows: RepxElement[][]; // table rows of cells
  imageUrl: string | null;
};

export type RepxBand = { type: string; controlType: string; name: string; height: number; elements: RepxElement[] };

export type RepxModel = {
  reportName: string;
  page: {
    paperKind: string;
    landscape: boolean;
    widthPx: number;
    heightPx: number;
    marginLeft: number; marginRight: number; marginTop: number; marginBottom: number;
    measureUnit: string;
  };
  bands: RepxBand[];
  parameters: Array<{ name: string; type: string; description: string }>;
  dataFields: string[];
  warnings: string[];
};

// ----------------------- generic XML parser (no deps) -----------------------

export function parseXml(xml: string): RepxXmlNode | null {
  // Strip BOM, XML declaration, comments, CDATA markers (keep CDATA content), DOCTYPE.
  let s = xml.replace(/^﻿/, "");
  s = s.replace(/<\?xml[\s\S]*?\?>/g, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, c) => String(c));

  const root: RepxXmlNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack: RepxXmlNode[] = [root];
  const tagRe = /<\s*(\/?)\s*([A-Za-z_][\w.\-:]*)((?:\s+[^<>]*?)?)\s*(\/?)\s*>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(s)) !== null) {
    const between = s.slice(lastIndex, m.index).trim();
    if (between) stack[stack.length - 1].text += decodeEntities(between);
    lastIndex = tagRe.lastIndex;
    const closing = m[1] === "/";
    const tag = m[2];
    const attrText = m[3] || "";
    const selfClose = m[4] === "/";
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node: RepxXmlNode = { tag, attrs: parseAttrs(attrText), children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root.children.length ? root : null;
}

function parseAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w.\-:]*)\s*=\s*"([^"]*)"|([A-Za-z_][\w.\-:]*)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = m[1] ?? m[3];
    const val = m[2] ?? m[4] ?? "";
    if (key) attrs[key] = decodeEntities(val);
  }
  return attrs;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

// ----------------------- helpers -----------------------

function walk(node: RepxXmlNode, fn: (n: RepxXmlNode) => void) {
  fn(node);
  for (const c of node.children) walk(c, fn);
}

function findFirst(node: RepxXmlNode, pred: (n: RepxXmlNode) => boolean): RepxXmlNode | null {
  let found: RepxXmlNode | null = null;
  walk(node, (n) => { if (!found && pred(n)) found = n; });
  return found;
}

const KNOWN_CONTROLS: Record<string, string> = {
  XRLabel: "label", XRTable: "table", XRTableRow: "row", XRTableCell: "cell",
  XRPictureBox: "picture", XRBarCode: "barcode", XRQRCode: "qrcode", XRLine: "line",
  XRShape: "shape", XRPageInfo: "pageinfo", XRRichText: "richtext", XRCheckBox: "checkbox",
  XRPanel: "panel", XRSubreport: "subreport", XRZipCode: "zipcode", XRChart: "chart",
};
const BAND_TYPES = new Set([
  "TopMarginBand", "BottomMarginBand", "ReportHeaderBand", "ReportFooterBand",
  "PageHeaderBand", "PageFooterBand", "DetailBand", "GroupHeaderBand", "GroupFooterBand",
  "DetailReportBand", "SubBand", "VerticalHeaderBand", "VerticalDetailBand",
]);

function num(v: string | undefined): number { const n = parseFloat(String(v ?? "").split(",")[0]); return Number.isFinite(n) ? n : 0; }
function pair(v: string | undefined): [number, number] {
  const parts = String(v ?? "").split(",").map((p) => parseFloat(p.trim()));
  return [Number.isFinite(parts[0]) ? parts[0] : 0, Number.isFinite(parts[1]) ? parts[1] : 0];
}

function unitFactor(measureUnit: string): number {
  // Convert the report's measure unit to CSS pixels at 96dpi (approximate).
  switch (measureUnit) {
    case "TenthsOfAMillimeter": return 96 / 254; // 1/10 mm → px
    case "Pixel":
    case "Pixels": return 1;
    case "HundredthsOfAnInch":
    default: return 0.96; // 1/100 inch → px
  }
}

function parseFont(v: string | undefined): RepxFont | null {
  if (!v) return null;
  const parts = v.split(",").map((p) => p.trim());
  const family = parts[0] || "inherit";
  const sizeMatch = (parts[1] || "").match(/([\d.]+)\s*(pt|px)?/);
  const size = sizeMatch ? parseFloat(sizeMatch[1]) : 9.75;
  const styleText = v.toLowerCase();
  return {
    family,
    size,
    bold: /style=.*bold/.test(styleText) || /\bbold\b/.test(styleText),
    italic: /italic/.test(styleText),
    underline: /underline/.test(styleText),
  };
}

function parseColor(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t || /transparent/i.test(t)) return null;
  // ARGB or RGB integers
  const nums = t.split(",").map((p) => parseInt(p.trim(), 10)).filter((n) => Number.isFinite(n));
  if (nums.length === 4) return `rgba(${nums[1]}, ${nums[2]}, ${nums[3]}, ${(nums[0] / 255).toFixed(3)})`;
  if (nums.length === 3) return `rgb(${nums[0]}, ${nums[1]}, ${nums[2]})`;
  // Named color like "Red" or hex
  if (/^#?[0-9a-fA-F]{6}$/.test(t)) return t.startsWith("#") ? t : `#${t}`;
  return t; // CSS named color
}

function extractFields(...sources: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const src of sources) {
    if (!src) continue;
    const re = /\[([A-Za-z_][\w.]*)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) found.add(m[1]);
  }
  return [...found];
}

function expressionOf(node: RepxXmlNode): string | null {
  // Newer: <ExpressionBindings><Item1 Expression="[FIELD]" PropertyName="Text"/></ExpressionBindings>
  // Older: <DataBindings><Item1 DataMember="FIELD" PropertyName="Text"/></DataBindings>
  let expr: string | null = null;
  walk(node, (n) => {
    if (expr) return;
    if (n.attrs.Expression && /text/i.test(n.attrs.PropertyName ?? "Text")) expr = n.attrs.Expression;
    else if (n.attrs.DataMember && /text/i.test(n.attrs.PropertyName ?? "Text")) expr = `[${n.attrs.DataMember}]`;
  });
  return expr;
}

// ----------------------- element + band extraction -----------------------

let _idSeq = 0;

function toElement(node: RepxXmlNode, factor: number, dataFields: Set<string>): RepxElement {
  const ct = node.attrs.ControlType || node.tag;
  const type = KNOWN_CONTROLS[ct] ?? "unknown";
  const [w, h] = pair(node.attrs.SizeF);
  const [x, y] = pair(node.attrs.LocationFloat);
  const text = node.attrs.Text ?? "";
  const expression = expressionOf(node);
  for (const f of extractFields(text, expression)) dataFields.add(f);
  const el: RepxElement = {
    id: `el_${++_idSeq}`,
    type,
    controlType: ct,
    name: node.attrs.Name || ct,
    x: Math.round(x * factor),
    y: Math.round(y * factor),
    width: Math.round(w * factor),
    height: Math.round(h * factor),
    text,
    font: parseFont(node.attrs.Font),
    foreColor: parseColor(node.attrs.ForeColor),
    backColor: parseColor(node.attrs.BackColor),
    borders: node.attrs.Borders ?? null,
    borderColor: parseColor(node.attrs.BorderColor),
    textAlignment: node.attrs.TextAlignment ?? null,
    expression,
    dataField: extractFields(expression, text)[0] ?? null,
    format: node.attrs.TextFormatString ?? node.attrs.FormatString ?? null,
    symbology: node.attrs.Symbology ?? (type === "qrcode" ? "QRCode" : null),
    angle: num(node.attrs.Angle),
    rows: [],
    imageUrl: null,
  };
  // Tables: collect rows → cells
  if (type === "table") {
    const rowNodes: RepxXmlNode[] = [];
    walk(node, (n) => { if ((n.attrs.ControlType || n.tag) === "XRTableRow") rowNodes.push(n); });
    for (const rn of rowNodes) {
      const cells: RepxElement[] = [];
      for (const cn of rn.children) {
        const cct = cn.attrs.ControlType || cn.tag;
        if (cct === "XRTableCell") cells.push(toElement(cn, factor, dataFields));
      }
      if (cells.length) el.rows.push(cells);
    }
  }
  return el;
}

// Direct child controls of a band (avoids double-counting nested table cells).
function bandControls(bandNode: RepxXmlNode, factor: number, dataFields: Set<string>): RepxElement[] {
  const out: RepxElement[] = [];
  const controlsNode = bandNode.children.find((c) => c.tag === "Controls") ?? bandNode;
  for (const c of controlsNode.children) {
    const ct = c.attrs.ControlType || c.tag;
    if (KNOWN_CONTROLS[ct] || /^XR/.test(ct)) out.push(toElement(c, factor, dataFields));
  }
  return out;
}

export function parseRepx(xml: string, fallbackName = "REPX Template"): RepxModel {
  _idSeq = 0;
  const warnings: string[] = [];
  const dataFields = new Set<string>();
  const tree = parseXml(xml);
  if (!tree) {
    return {
      reportName: fallbackName,
      page: { paperKind: "A4", landscape: false, widthPx: 794, heightPx: 1123, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, measureUnit: "HundredthsOfAnInch" },
      bands: [], parameters: [], dataFields: [], warnings: ["تعذّر قراءة ملف REPX (XML غير صالح)."],
    };
  }

  // Report root = the node carrying page attributes (PaperKind / Margins / Bands child).
  const reportNode = findFirst(tree, (n) => Boolean(n.attrs.PaperKind || n.attrs.Margins || n.children.some((c) => c.tag === "Bands")))
    ?? tree.children[0] ?? tree;

  const measureUnit = reportNode.attrs.Measurement || reportNode.attrs.MeasureUnit || "HundredthsOfAnInch";
  const factor = unitFactor(measureUnit);
  const landscape = /true/i.test(reportNode.attrs.Landscape ?? "");
  const margins = String(reportNode.attrs.Margins ?? "100,100,100,100").split(",").map((p) => Math.round(parseFloat(p.trim() || "0") * factor));
  const paperKind = reportNode.attrs.PaperKind || "Custom";
  const [pgW, pgH] = pair(reportNode.attrs.PageWidth ? `${reportNode.attrs.PageWidth},${reportNode.attrs.PageHeight}` : "");
  const paper = paperSizePx(paperKind, landscape, pgW * factor, pgH * factor);

  // Bands
  const bandsContainer = findFirst(reportNode, (n) => n.tag === "Bands") ?? reportNode;
  const bands: RepxBand[] = [];
  walk(bandsContainer, (n) => {
    const ct = n.attrs.ControlType || "";
    if (BAND_TYPES.has(ct)) {
      bands.push({
        type: ct.replace(/Band$/, "").toLowerCase(),
        controlType: ct,
        name: n.attrs.Name || ct,
        height: Math.round(num(n.attrs.HeightF) * factor),
        elements: bandControls(n, factor, dataFields),
      });
    }
  });

  // Unknown controls → warnings
  walk(reportNode, (n) => {
    const ct = n.attrs.ControlType || "";
    if (/^XR/.test(ct) && !KNOWN_CONTROLS[ct]) warnings.push(`عنصر غير مدعوم بالكامل: ${ct} (${n.attrs.Name ?? ""}) — تم استيراده كعنصر عام.`);
  });

  // Parameters
  const parameters: Array<{ name: string; type: string; description: string }> = [];
  walk(reportNode, (n) => {
    if ((n.attrs.ControlType || n.tag) === "Parameter" || n.tag === "Parameter") {
      if (n.attrs.Name) parameters.push({ name: n.attrs.Name, type: n.attrs.Type ?? "String", description: n.attrs.Description ?? "" });
    }
  });

  return {
    reportName: reportNode.attrs.Name || fallbackName,
    page: { paperKind, landscape, widthPx: paper.w, heightPx: paper.h, marginLeft: margins[0] ?? 0, marginRight: margins[1] ?? 0, marginTop: margins[2] ?? 0, marginBottom: margins[3] ?? 0, measureUnit },
    bands,
    parameters,
    dataFields: [...dataFields].sort(),
    warnings: [...new Set(warnings)],
  };
}

function paperSizePx(kind: string, landscape: boolean, customW: number, customH: number): { w: number; h: number } {
  // px @96dpi
  const sizes: Record<string, [number, number]> = {
    A4: [794, 1123], A5: [559, 794], A6: [397, 559], Letter: [816, 1056],
  };
  let [w, h] = sizes[kind] ?? [customW || 794, customH || 1123];
  if (landscape) [w, h] = [h, w];
  return { w: Math.round(w), h: Math.round(h) };
}

export const REPORT_CATEGORIES = ["invoice", "receipt", "barcode", "qr", "voucher", "booking", "contract", "report", "label", "custom"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

// Heuristic category from the file name / report name.
export function guessCategory(name: string): ReportCategory {
  const s = name.toLowerCase();
  if (/(invoice|فاتور)/.test(s)) return "invoice";
  if (/(receipt|سند\s*قبض|قبض)/.test(s)) return "receipt";
  if (/(صرف|payment|voucher|سند)/.test(s)) return "voucher";
  if (/(qr)/.test(s)) return "qr";
  if (/(barcode|باركود)/.test(s)) return "barcode";
  if (/(label|ملصق|بطاق)/.test(s)) return "label";
  if (/(booking|حجز|كوش|تصوير)/.test(s)) return "booking";
  if (/(contract|عقد)/.test(s)) return "contract";
  if (/(report|تقرير)/.test(s)) return "report";
  return "custom";
}
