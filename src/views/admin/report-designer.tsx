import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FileText, Printer, Star, Trash2, Upload, AlertTriangle, RotateCcw, Save, Image as ImageIcon, Plus, Square, QrCode, Barcode as BarcodeIcon, Type, Minus, Table } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "./_layout";
import { adminFetch, apiErrorMessage } from "./_lib";

type RepxFont = { family: string; size: number; bold: boolean; italic: boolean; underline: boolean };
type RepxElement = {
  id: string; type: string; controlType: string; name: string;
  x: number; y: number; width: number; height: number; text: string;
  font: RepxFont | null; foreColor: string | null; backColor: string | null;
  borders: string | null; borderColor: string | null; textAlignment: string | null;
  expression: string | null; dataField: string | null; format: string | null;
  symbology: string | null; angle: number; rows: RepxElement[][]; imageUrl: string | null;
  visible?: boolean;
};
type RepxBand = { type: string; controlType: string; name: string; height: number; elements: RepxElement[] };
type RepxModel = {
  reportName: string;
  page: { paperKind: string; landscape: boolean; widthPx: number; heightPx: number; marginLeft: number; marginRight: number; marginTop: number; marginBottom: number; measureUnit: string };
  bands: RepxBand[]; parameters: Array<{ name: string; type: string; description: string }>; dataFields: string[]; warnings: string[];
};
type TemplateRow = { id: number; name: string; category: string; paperKind: string; version: number; isDefault: boolean; fileName: string | null; warnings: number; createdByName: string; updatedAt: string };
type TemplateDetail = { id: number; name: string; category: string; paperKind: string; version: number; isDefault: boolean; repxXml: string; model: RepxModel; mapping: Record<string, string>; warnings: string[]; history: Array<{ version: number; updatedAt: string }> };

const CATEGORY_LABEL: Record<string, string> = {
  invoice: "فواتير", receipt: "سندات قبض", voucher: "سندات صرف", barcode: "باركود",
  qr: "QR", booking: "حجوزات", contract: "عقود", report: "تقارير", label: "ملصقات", custom: "مخصّص",
};
const CATEGORIES = ["all", ...Object.keys(CATEGORY_LABEL)];
const AJN_PATHS = [
  "product.name", "product.price", "product.barcode", "product.costPrice",
  "customer.fullName", "customer.phone", "customer.address",
  "invoice.invoiceNo", "invoice.date", "invoice.total", "invoice.paid", "invoice.remaining",
  "booking.code", "booking.date", "booking.customerName", "order.code", "order.date",
  "item.name", "item.price", "item.qty", "item.total", "item.barcode",
];

function ptToPx(pt: number) { return Math.round(pt * (96 / 72)); }
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function safeCssColor(value: string | null | undefined, fallback = "#333"): string {
  const color = String(value ?? "").trim();
  return /^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,\s%]+\)|[a-z]{3,20})$/i.test(color)
    ? color
    : fallback;
}
function safeFontFamily(value: string | null | undefined): string {
  const family = String(value ?? "").trim();
  return /^[a-z0-9 ,_-]{1,80}$/i.test(family) ? family : "Tahoma";
}
function alignToCss(a: string | null): { h: "left" | "center" | "right"; v: string } {
  const s = (a ?? "TopLeft").toLowerCase();
  const h = s.includes("center") ? "center" : s.includes("right") ? "right" : "left";
  const v = s.includes("middle") ? "center" : s.includes("bottom") ? "flex-end" : "flex-start";
  return { h, v };
}
function bordersToCss(b: string | null, color: string | null): string {
  if (!b) return "";
  const c = safeCssColor(color);
  const has = (k: string) => new RegExp(k, "i").test(b);
  if (has("all")) return `border:1px solid ${c};`;
  let css = "";
  if (has("left")) css += `border-left:1px solid ${c};`;
  if (has("right")) css += `border-right:1px solid ${c};`;
  if (has("top")) css += `border-top:1px solid ${c};`;
  if (has("bottom")) css += `border-bottom:1px solid ${c};`;
  return css;
}
function bindText(el: RepxElement, mapping: Record<string, string>, sample: Record<string, string>): string {
  const raw = el.text || el.expression || "";
  return raw.replace(/\[([A-Za-z_][\w.]*)\]/g, (_m, f) => (sample[f]?.trim() ? sample[f] : `«${mapping[f] || f}»`));
}

function safeBindText(el: RepxElement, mapping: Record<string, string>, sample: Record<string, string>): string {
  return escapeHtml(bindText(el, mapping, sample));
}

// ---- HTML string renderer (print + PNG/SVG export) ----
function elHtml(el: RepxElement, mapping: Record<string, string>, sample: Record<string, string>): string {
  if (el.visible === false) return "";
  const align = alignToCss(el.textAlignment);
  const fontPx = el.font ? ptToPx(el.font.size) : 12;
  const foreColor = safeCssColor(el.foreColor, "#111");
  const backColor = el.backColor ? safeCssColor(el.backColor, "transparent") : "";
  const fontFamily = safeFontFamily(el.font?.family);
  const style = [
    "position:absolute", `left:${el.x}px`, `top:${el.y}px`, `width:${el.width}px`, `min-height:${el.height}px`,
    el.foreColor ? `color:${foreColor}` : "", backColor ? `background:${backColor}` : "",
    el.font ? `font-family:'${fontFamily}',sans-serif` : "", `font-size:${fontPx}px`,
    el.font?.bold ? "font-weight:700" : "", el.font?.italic ? "font-style:italic" : "", el.font?.underline ? "text-decoration:underline" : "",
    el.angle ? `transform:rotate(${-el.angle}deg)` : "",
    "display:flex", "overflow:hidden", "box-sizing:border-box", "padding:1px 2px",
    `justify-content:${align.h === "center" ? "center" : align.h === "right" ? "flex-end" : "flex-start"}`,
    `align-items:${align.v}`, `text-align:${align.h}`, bordersToCss(el.borders, el.borderColor),
  ].filter(Boolean).join(";");
  if (el.type === "line") return `<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.width}px;border-top:1px solid ${foreColor};"></div>`;
  if (el.type === "qrcode" || el.type === "barcode")
    return `<div style="${style};flex-direction:column;border:1px dashed #999;color:#666;font-size:10px;"><span>${escapeHtml(el.dataField || el.symbology || "")}</span></div>`;
  if (el.type === "picture") return `<div style="${style};border:1px dashed #999;color:#666;font-size:10px;">🖼️</div>`;
  if (el.type === "table") {
    const rows = el.rows.map((cells) => `<tr>${cells.map((c) => { const a = alignToCss(c.textAlignment); const background = c.backColor ? safeCssColor(c.backColor, "transparent") : ""; return `<td style="border:1px solid #999;padding:2px 4px;text-align:${a.h};font-size:${c.font ? ptToPx(c.font.size) : 11}px;${c.font?.bold ? "font-weight:700;" : ""}${background ? `background:${background};` : ""}">${safeBindText(c, mapping, sample) || "&nbsp;"}</td>`; }).join("")}</tr>`).join("");
    return `<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.width}px;"><table style="width:100%;border-collapse:collapse;table-layout:fixed;">${rows}</table></div>`;
  }
  return `<div style="${style}">${safeBindText(el, mapping, sample) || ""}</div>`;
}
function bandHtml(band: RepxBand, mapping: Record<string, string>, vals: Record<string, string>): string {
  return `<div style="position:relative;width:100%;height:${Math.max(band.height, 16)}px;">${band.elements.map((e) => elHtml(e, mapping, vals)).join("")}</div>`;
}
function repxModelToHtml(model: RepxModel, mapping: Record<string, string>, sample: Record<string, string>, rows: Array<Record<string, string>> = []): string {
  const bands = model.bands.map((band) =>
    band.type === "detail" && rows.length
      ? rows.map((r) => bandHtml(band, mapping, { ...sample, ...r })).join("")
      : bandHtml(band, mapping, sample),
  ).join("");
  return `<div dir="ltr" style="position:relative;width:${model.page.widthPx}px;background:#fff;color:#111;padding:${model.page.marginTop}px ${model.page.marginRight}px ${model.page.marginBottom}px ${model.page.marginLeft}px;box-sizing:border-box;font-family:Tahoma,sans-serif;">${bands}</div>`;
}
function bandLabel(t: string): string {
  const map: Record<string, string> = { topmargin: "هامش علوي", bottommargin: "هامش سفلي", reportheader: "ترويسة التقرير", reportfooter: "تذييل التقرير", pageheader: "ترويسة الصفحة", pagefooter: "تذييل الصفحة", detail: "التفاصيل", groupheader: "ترويسة مجموعة", groupfooter: "تذييل مجموعة" };
  return map[t] || t;
}

const NEW_ELEMENT_DEFAULTS: Record<string, Partial<RepxElement>> = {
  label: { type: "label", controlType: "XRLabel", text: "نص جديد", width: 150, height: 24 },
  table: { type: "table", controlType: "XRTable", width: 300, height: 48, rows: [[{ id: "", type: "cell", controlType: "XRTableCell", name: "خلية", x: 0, y: 0, width: 150, height: 24, text: "خلية", font: null, foreColor: null, backColor: null, borders: "All", borderColor: null, textAlignment: "MiddleCenter", expression: null, dataField: null, format: null, symbology: null, angle: 0, rows: [], imageUrl: null }, { id: "", type: "cell", controlType: "XRTableCell", name: "خلية", x: 0, y: 0, width: 150, height: 24, text: "خلية", font: null, foreColor: null, backColor: null, borders: "All", borderColor: null, textAlignment: "MiddleCenter", expression: null, dataField: null, format: null, symbology: null, angle: 0, rows: [], imageUrl: null }]] },
  barcode: { type: "barcode", controlType: "XRBarCode", width: 150, height: 60, symbology: "Code128" },
  qrcode: { type: "qrcode", controlType: "XRQRCode", width: 90, height: 90, symbology: "QRCode" },
  picture: { type: "picture", controlType: "XRPictureBox", width: 120, height: 90 },
  line: { type: "line", controlType: "XRLine", width: 200, height: 2 },
  shape: { type: "shape", controlType: "XRShape", width: 120, height: 60, borders: "All" },
};
const ADD_PALETTE: Array<{ key: string; label: string; icon: typeof Type }> = [
  { key: "label", label: "نص", icon: Type }, { key: "table", label: "جدول", icon: Table },
  { key: "barcode", label: "باركود", icon: BarcodeIcon }, { key: "qrcode", label: "QR", icon: QrCode },
  { key: "picture", label: "صورة", icon: ImageIcon }, { key: "line", label: "خط", icon: Minus }, { key: "shape", label: "مستطيل", icon: Square },
];

function newElement(kind: string, idSeq: number): RepxElement {
  const base: RepxElement = { id: `new_${idSeq}`, type: "label", controlType: "XRLabel", name: `عنصر ${idSeq}`, x: 24, y: 12, width: 150, height: 24, text: "", font: { family: "Tahoma", size: 9.75, bold: false, italic: false, underline: false }, foreColor: "#111111", backColor: null, borders: null, borderColor: null, textAlignment: "TopLeft", expression: null, dataField: null, format: null, symbology: null, angle: 0, rows: [], imageUrl: null, visible: true };
  return { ...base, ...NEW_ELEMENT_DEFAULTS[kind], id: `new_${idSeq}`, name: `${kind}_${idSeq}` } as RepxElement;
}

export function ReportDesignerPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<RepxModel | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<{ band: number; el: string } | null>(null);
  const [sample, setSample] = useState<Record<string, string>>({});
  const [idSeq, setIdSeq] = useState(1);
  const [recordType, setRecordType] = useState("invoice");
  const [recordQuery, setRecordQuery] = useState("");
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const drag = useRef<{ band: number; el: string; mode: "move" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);

  const list = useQuery<{ data: TemplateRow[] }>({ queryKey: ["admin", "report-templates", category], queryFn: () => adminFetch(`/admin/report-templates${category !== "all" ? `?category=${category}` : ""}`) });
  const detail = useQuery<TemplateDetail>({ queryKey: ["admin", "report-template", selectedId], queryFn: () => adminFetch(`/admin/report-templates/${selectedId}`), enabled: !!selectedId });

  useEffect(() => {
    if (detail.data?.model) { setDraft(JSON.parse(JSON.stringify(detail.data.model))); setDirty(false); setSel(null); }
  }, [detail.data?.id, detail.data?.version]);

  const upload = useMutation({
    mutationFn: async (file: File) => { const repxXml = await file.text(); return adminFetch<{ id: number }>("/admin/report-templates", { method: "POST", body: JSON.stringify({ repxXml, fileName: file.name }) }); },
    onSuccess: (res) => { queryClient.invalidateQueries({ queryKey: ["admin", "report-templates"] }); setSelectedId(res.id); toast({ title: "تم استيراد القالب" }); },
    onError: (e) => toast({ title: "تعذّر الاستيراد", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const act = useMutation({
    mutationFn: ({ id, path, method = "POST", body }: { id: number; path?: string; method?: string; body?: any }) => adminFetch(`/admin/report-templates/${id}${path ? `/${path}` : ""}`, { method, body: body ? JSON.stringify(body) : undefined }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin", "report-templates"] }); queryClient.invalidateQueries({ queryKey: ["admin", "report-template", selectedId] }); },
    onError: (e) => toast({ title: "تعذّر التنفيذ", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const records = useQuery<{ data: Array<{ id: number; label: string }> }>({
    queryKey: ["report-records", recordType, recordQuery],
    queryFn: () => adminFetch(`/admin/report-templates/records?type=${recordType}&q=${encodeURIComponent(recordQuery)}`),
    enabled: !!selectedId,
  });
  const loadRecord = useMutation({
    mutationFn: (recordId: number) => adminFetch<{ values: Record<string, string>; rows: Array<Record<string, string>>; label: string }>(`/admin/report-templates/${selectedId}/data?type=${recordType}&recordId=${recordId}`),
    onSuccess: (res) => { setSample((p) => ({ ...p, ...res.values })); setRows(res.rows ?? []); toast({ title: `تم تحميل بيانات: ${res.label}${res.rows?.length ? ` (${res.rows.length} بند)` : ""}` }); },
    onError: (e) => toast({ title: "تعذّر تحميل البيانات", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const save = useMutation({
    mutationFn: () => adminFetch(`/admin/report-templates/${selectedId}`, { method: "PATCH", body: JSON.stringify({ model: draft }) }),
    onSuccess: () => { setDirty(false); queryClient.invalidateQueries({ queryKey: ["admin", "report-template", selectedId] }); queryClient.invalidateQueries({ queryKey: ["admin", "report-templates"] }); toast({ title: "تم حفظ التصميم (إصدار جديد)" }); },
    onError: (e) => toast({ title: "تعذّر الحفظ", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const mapping = detail.data?.mapping ?? {};
  const model = draft;
  const selectedEl = useMemo(() => {
    if (!model || !sel) return null;
    return model.bands[sel.band]?.elements.find((e) => e.id === sel.el) ?? null;
  }, [model, sel]);

  function patchEl(patch: Partial<RepxElement>) {
    if (!model || !sel) return;
    setDraft({ ...model, bands: model.bands.map((b, bi) => bi !== sel.band ? b : { ...b, elements: b.elements.map((e) => e.id === sel.el ? { ...e, ...patch } : e) }) });
    setDirty(true);
  }
  function deleteSel() {
    if (!model || !sel) return;
    setDraft({ ...model, bands: model.bands.map((b, bi) => bi !== sel.band ? b : { ...b, elements: b.elements.filter((e) => e.id !== sel.el) }) });
    setSel(null); setDirty(true);
  }
  function addElement(kind: string) {
    if (!model) return;
    const bandIdx = Math.max(0, model.bands.findIndex((b) => b.type === "detail"));
    if (!model.bands.length) return;
    const el = newElement(kind, idSeq);
    setIdSeq((n) => n + 1);
    setDraft({ ...model, bands: model.bands.map((b, bi) => bi !== bandIdx ? b : { ...b, elements: [...b.elements, el] }) });
    setSel({ band: bandIdx, el: el.id }); setDirty(true);
  }

  function onPointerDownEl(e: React.PointerEvent, band: number, el: RepxElement, mode: "move" | "resize") {
    e.stopPropagation();
    setSel({ band, el: el.id });
    drag.current = { band, el: el.id, mode, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y, ow: el.width, oh: el.height };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current; if (!d || !model) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    setDraft({ ...model, bands: model.bands.map((b, bi) => bi !== d.band ? b : { ...b, elements: b.elements.map((el) => el.id !== d.el ? el : (d.mode === "move" ? { ...el, x: Math.max(0, Math.round(d.ox + dx)), y: Math.max(0, Math.round(d.oy + dy)) } : { ...el, width: Math.max(8, Math.round(d.ow + dx)), height: Math.max(8, Math.round(d.oh + dy)) })) }) });
  }
  function onPointerUp() { if (drag.current) { drag.current = null; setDirty(true); } }

  function exportSvg(download: boolean): string {
    if (!model) return "";
    const html = repxModelToHtml(model, mapping, sample, rows);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${model.page.widthPx}" height="${model.page.heightPx}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${html}</div></foreignObject></svg>`;
    if (download) { const blob = new Blob([svg], { type: "image/svg+xml" }); triggerDownload(URL.createObjectURL(blob), `${detail.data?.name ?? "report"}.svg`); }
    return svg;
  }
  function exportPng() {
    if (!model) return;
    const svg = exportSvg(false);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = model.page.widthPx; canvas.height = model.page.heightPx;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      try { triggerDownload(canvas.toDataURL("image/png"), `${detail.data?.name ?? "report"}.png`); }
      catch { toast({ title: "تعذّر تصدير PNG", description: "قد تمنع الصور الخارجية التصدير.", variant: "destructive" }); }
    };
    img.onerror = () => toast({ title: "تعذّر إنشاء PNG", variant: "destructive" });
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  function print() {
    if (!model) return;
    const w = window.open("", "_blank", "width=900,height=1100"); if (!w) return;
    const sizeCss = `@page { size: ${model.page.widthPx > model.page.heightPx ? "landscape" : "portrait"}; margin: 0; }`;
    w.document.write(`<!doctype html><html dir="ltr"><head><meta charset="utf-8"><title>${escapeHtml(detail.data?.name ?? "تقرير")}</title><style>${sizeCss} body{margin:0;}</style></head><body onload="window.print()">${repxModelToHtml(model, mapping, sample, rows)}</body></html>`);
    w.document.close();
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><FileText className="h-5 w-5 text-primary" /> مصمم التقارير (REPX)</h1>
          <p className="mt-1 text-sm text-muted-foreground">استيراد · تصميم بصري بالسحب · ربط البيانات · معاينة · طباعة · تصدير.</p>
        </div>
        <div>
          <input ref={fileRef} type="file" accept=".repx,.xml,text/xml,application/xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
          <Button onClick={() => fileRef.current?.click()} disabled={upload.isPending} className="gap-1"><Upload className="h-4 w-4" /> {upload.isPending ? "جارٍ الاستيراد..." : "رفع ملف REPX"}</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => <button key={c} onClick={() => setCategory(c)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${category === c ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-background/60 border border-border/30"}`}>{c === "all" ? "الكل" : CATEGORY_LABEL[c]}</button>)}
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-2">
          {list.isLoading ? <Skeleton className="h-64 rounded-xl" /> : !list.data?.data.length ? <EmptyState message="لا توجد قوالب. ارفع ملف REPX للبدء." /> : (
            list.data.data.map((t) => (
              <button key={t.id} onClick={() => setSelectedId(t.id)} className={`w-full rounded-xl border p-3 text-right transition-colors ${selectedId === t.id ? "border-primary bg-primary/5" : "border-border/30 bg-card hover:border-primary/40"}`}>
                <div className="flex items-center justify-between gap-2"><span className="truncate font-semibold text-foreground">{t.name}</span>{t.isDefault ? <Star className="h-4 w-4 shrink-0 fill-status-warning text-status-warning" /> : null}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span className="rounded-full bg-background/60 px-2 py-0.5">{CATEGORY_LABEL[t.category] ?? t.category}</span><span>{t.paperKind}</span><span>v{t.version}</span>{t.warnings ? <span className="flex items-center gap-0.5 text-status-warning"><AlertTriangle className="h-3 w-3" /> {t.warnings}</span> : null}</div>
              </button>
            ))
          )}
        </div>

        <div>
          {!selectedId ? <EmptyState message="اختر قالباً للتصميم والمعاينة." /> : detail.isLoading || !model ? <Skeleton className="h-96 rounded-xl" /> : (
            <div className="space-y-3">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/30 bg-card p-3">
                <span className="font-semibold text-foreground">{detail.data?.name}</span>
                <span className="text-xs text-muted-foreground">· {model.bands.length} نطاق · {model.dataFields.length} حقل · {model.page.paperKind}{dirty ? " · غير محفوظ" : ""}</span>
                <div className="ms-auto flex flex-wrap gap-1.5">
                  <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className="gap-1"><Save className="h-3.5 w-3.5" /> حفظ</Button>
                  <Button variant="outline" size="sm" onClick={print} className="gap-1"><Printer className="h-3.5 w-3.5" /> طباعة</Button>
                  <Button variant="outline" size="sm" onClick={exportPng} className="gap-1"><ImageIcon className="h-3.5 w-3.5" /> PNG</Button>
                  <Button variant="outline" size="sm" onClick={() => exportSvg(true)} className="gap-1"><FileText className="h-3.5 w-3.5" /> SVG</Button>
                  <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: selectedId, path: "default" }, { onSuccess: () => toast({ title: "تم التعيين كافتراضي" }) })} className="gap-1"><Star className="h-3.5 w-3.5" /></Button>
                  <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: selectedId, path: "clone" }, { onSuccess: (r: any) => { setSelectedId(r.id); toast({ title: "تم الاستنساخ" }); } })} className="gap-1"><Copy className="h-3.5 w-3.5" /></Button>
                  <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => { if (confirm("حذف القالب؟")) act.mutate({ id: selectedId, method: "DELETE" }, { onSuccess: () => { setSelectedId(null); toast({ title: "تم الحذف" }); } }); }} className="gap-1 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>

              {/* Add palette */}
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/30 bg-card p-2">
                <span className="px-1 text-xs text-muted-foreground">إضافة عنصر:</span>
                {ADD_PALETTE.map(({ key, label, icon: Icon }) => <Button key={key} variant="outline" size="sm" onClick={() => addElement(key)} className="gap-1"><Icon className="h-3.5 w-3.5" /> {label}</Button>)}
              </div>

              {detail.data?.warnings?.length ? (
                <div className="rounded-xl border border-status-warning/30 bg-status-warning/5 p-3 text-xs text-status-warning"><p className="mb-1 flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> تحذيرات الاستيراد ({detail.data.warnings.length}) — استُورد الباقي:</p><ul className="list-disc space-y-0.5 pe-4">{detail.data.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}</ul></div>
              ) : null}

              <div className="grid gap-3 xl:grid-cols-[1fr_260px]">
                {/* Canvas */}
                <div className="overflow-auto rounded-xl border border-border/30 bg-neutral-200 p-4" style={{ maxHeight: 620 }} onClick={() => setSel(null)} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
                  <div dir="ltr" className="mx-auto shadow-lg" style={{ position: "relative", width: model.page.widthPx, background: "#fff", padding: `${model.page.marginTop}px ${model.page.marginRight}px ${model.page.marginBottom}px ${model.page.marginLeft}px`, boxSizing: "border-box", fontFamily: "Tahoma, sans-serif" }}>
                    {model.bands.map((band, bi) => (
                      <div key={bi} style={{ position: "relative", width: "100%", height: Math.max(band.height, 16), borderBottom: "1px dashed #e2e8f0" }}>
                        <span style={{ position: "absolute", left: 0, top: 0, fontSize: 9, color: "#94a3b8", background: "#f1f5f9", padding: "0 4px" }}>{bandLabel(band.type)}</span>
                        {band.elements.map((el) => {
                          if (el.visible === false) return null;
                          const isSel = sel?.band === bi && sel?.el === el.id;
                          const align = alignToCss(el.textAlignment);
                          if (el.type === "line") return <div key={el.id} onPointerDown={(e) => onPointerDownEl(e, bi, el, "move")} style={{ position: "absolute", left: el.x, top: el.y, width: el.width, borderTop: `1px solid ${el.foreColor || "#333"}`, cursor: "move", outline: isSel ? "2px solid #6366f1" : "none" }} />;
                          return (
                            <div key={el.id} onPointerDown={(e) => onPointerDownEl(e, bi, el, "move")} style={{
                              position: "absolute", left: el.x, top: el.y, width: el.width, minHeight: el.height,
                              color: el.foreColor || undefined, background: el.backColor || undefined,
                              fontFamily: el.font ? `'${el.font.family}',sans-serif` : undefined, fontSize: el.font ? ptToPx(el.font.size) : 12,
                              fontWeight: el.font?.bold ? 700 : undefined, fontStyle: el.font?.italic ? "italic" : undefined, textDecoration: el.font?.underline ? "underline" : undefined,
                              display: "flex", overflow: "hidden", boxSizing: "border-box", padding: "1px 2px", cursor: "move",
                              justifyContent: align.h === "center" ? "center" : align.h === "right" ? "flex-end" : "flex-start", alignItems: align.v as any, textAlign: align.h,
                              border: isSel ? "2px solid #6366f1" : (el.borders ? "1px solid #94a3b8" : "1px solid transparent"),
                              transform: el.angle ? `rotate(${-el.angle}deg)` : undefined,
                            }} dir="rtl">
                              {el.type === "qrcode" ? "▣ QR" : el.type === "barcode" ? "❘❘❘❘" : el.type === "picture" ? "🖼️" : el.type === "table" ? `جدول (${el.rows.length}×${el.rows[0]?.length ?? 0})` : bindText(el, mapping, sample) || el.name}
                              {isSel ? <span onPointerDown={(e) => onPointerDownEl(e, bi, el, "resize")} style={{ position: "absolute", left: -4, bottom: -4, width: 10, height: 10, background: "#6366f1", borderRadius: 2, cursor: "nwse-resize" }} /> : null}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right panel: properties OR mapping/sample/versions */}
                <div className="space-y-3">
                  {selectedEl ? (
                    <div className="rounded-xl border border-border/30 bg-card p-3">
                      <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold text-foreground">خصائص العنصر</span><Button variant="ghost" size="sm" onClick={deleteSel} className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button></div>
                      <div className="space-y-2 text-xs">
                        <PropText label="الاسم" value={selectedEl.name} onChange={(v) => patchEl({ name: v })} />
                        <div className="grid grid-cols-2 gap-2">
                          <PropNum label="X" value={selectedEl.x} onChange={(v) => patchEl({ x: v })} />
                          <PropNum label="Y" value={selectedEl.y} onChange={(v) => patchEl({ y: v })} />
                          <PropNum label="العرض" value={selectedEl.width} onChange={(v) => patchEl({ width: v })} />
                          <PropNum label="الارتفاع" value={selectedEl.height} onChange={(v) => patchEl({ height: v })} />
                        </div>
                        <PropText label="النص" value={selectedEl.text} onChange={(v) => patchEl({ text: v })} />
                        <div className="grid grid-cols-2 gap-2">
                          <PropNum label="حجم الخط" value={selectedEl.font?.size ?? 9.75} onChange={(v) => patchEl({ font: { ...(selectedEl.font ?? { family: "Tahoma", size: 9.75, bold: false, italic: false, underline: false }), size: v } })} />
                          <PropNum label="التدوير" value={selectedEl.angle} onChange={(v) => patchEl({ angle: v })} />
                        </div>
                        <div className="flex gap-1">
                          {(["bold", "italic", "underline"] as const).map((k) => <button key={k} onClick={() => patchEl({ font: { ...(selectedEl.font ?? { family: "Tahoma", size: 9.75, bold: false, italic: false, underline: false }), [k]: !selectedEl.font?.[k] } })} className={`flex-1 rounded border px-2 py-1 ${selectedEl.font?.[k] ? "border-primary bg-primary/10 text-primary" : "border-border/40"}`}>{k === "bold" ? "B" : k === "italic" ? "I" : "U"}</button>)}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">اللون<input type="color" value={selectedEl.foreColor || "#111111"} onChange={(e) => patchEl({ foreColor: e.target.value })} className="mt-0.5 h-7 w-full rounded border border-border/40" /></label>
                          <label className="block">الخلفية<input type="color" value={selectedEl.backColor || "#ffffff"} onChange={(e) => patchEl({ backColor: e.target.value })} className="mt-0.5 h-7 w-full rounded border border-border/40" /></label>
                        </div>
                        <label className="block">المحاذاة
                          <select value={selectedEl.textAlignment ?? "TopLeft"} onChange={(e) => patchEl({ textAlignment: e.target.value })} className="mt-0.5 w-full rounded border border-border/40 bg-background px-2 py-1">
                            {["TopLeft", "TopCenter", "TopRight", "MiddleLeft", "MiddleCenter", "MiddleRight", "BottomLeft", "BottomCenter", "BottomRight"].map((a) => <option key={a} value={a}>{a}</option>)}
                          </select>
                        </label>
                        <PropText label="ربط/Expression" value={selectedEl.expression ?? ""} onChange={(v) => patchEl({ expression: v || null, dataField: (v.match(/\[([A-Za-z_][\w.]*)\]/)?.[1]) ?? null })} placeholder="[FIELD]" />
                        <PropText label="Format" value={selectedEl.format ?? ""} onChange={(v) => patchEl({ format: v || null })} placeholder="{0:n0}" />
                        <label className="flex items-center gap-2"><input type="checkbox" checked={selectedEl.visible !== false} onChange={(e) => patchEl({ visible: e.target.checked })} /> ظاهر</label>
                      </div>
                    </div>
                  ) : <div className="rounded-xl border border-dashed border-border/40 p-4 text-center text-xs text-muted-foreground">اضغط عنصراً في اللوحة لتعديل خصائصه، أو اسحبه لتحريكه.</div>}

                  {/* Live data picker */}
                  {model.dataFields.length ? (
                    <div className="rounded-xl border border-border/30 bg-card p-3">
                      <p className="mb-2 text-sm font-semibold text-foreground">بيانات حقيقية</p>
                      <div className="flex gap-1.5">
                        <select value={recordType} onChange={(e) => setRecordType(e.target.value)} className="rounded border border-border/40 bg-background px-2 py-1 text-xs">
                          <option value="invoice">فاتورة</option><option value="product">منتج</option><option value="booking">حجز كوشة</option><option value="order">طلب</option><option value="customer">زبون</option>
                        </select>
                        <input value={recordQuery} onChange={(e) => setRecordQuery(e.target.value)} placeholder="بحث..." className="flex-1 rounded border border-border/40 bg-background px-2 py-1 text-xs" />
                      </div>
                      <div className="mt-2 max-h-36 space-y-0.5 overflow-auto">
                        {(records.data?.data ?? []).map((r) => (
                          <button key={r.id} disabled={loadRecord.isPending} onClick={() => loadRecord.mutate(r.id)} className="block w-full truncate rounded px-2 py-1 text-right text-xs text-foreground hover:bg-background/60">{r.label}</button>
                        ))}
                        {!records.data?.data?.length ? <p className="px-2 text-[11px] text-muted-foreground">لا نتائج</p> : null}
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">اختر سجلاً ليُعبّأ القالب ببياناته الفعلية حسب الربط.{rows.length ? ` نطاق التفاصيل سيُكرَّر ${rows.length} مرة عند الطباعة/التصدير.` : ""}</p>
                    </div>
                  ) : null}

                  {/* Sample data */}
                  {model.dataFields.length ? (
                    <div className="rounded-xl border border-border/30 bg-card p-3">
                      <p className="mb-2 text-sm font-semibold text-foreground">قيم تجريبية</p>
                      <div className="space-y-1.5">
                        {model.dataFields.slice(0, 12).map((f) => (
                          <div key={f} className="flex items-center gap-2">
                            <span className="w-24 shrink-0 truncate font-mono text-[11px] text-muted-foreground" title={mapping[f] ? `${f} ← ${mapping[f]}` : f}>{f}</span>
                            <input value={sample[f] ?? ""} onChange={(e) => setSample((p) => ({ ...p, [f]: e.target.value }))} placeholder="قيمة تجريبية" className="flex-1 rounded border border-border/40 bg-background px-2 py-1 text-[11px]" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Mapping + versions (full width) */}
              {model.dataFields.length ? (
                <div className="rounded-xl border border-border/30 bg-card p-3">
                  <p className="mb-2 text-sm font-semibold text-foreground">ربط الحقول ببيانات AJN</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {model.dataFields.map((f) => (
                      <div key={f} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 truncate font-mono text-xs text-muted-foreground">{f}</span><span className="text-muted-foreground">←</span>
                        <input list="ajn-paths" defaultValue={mapping[f] ?? ""} placeholder="مسار AJN" onBlur={(e) => { const v = e.target.value.trim(); if (v !== (mapping[f] ?? "") && selectedId) act.mutate({ id: selectedId, method: "PATCH", body: { mapping: { ...mapping, [f]: v } } }, { onSuccess: () => toast({ title: "تم حفظ الربط" }) }); }} className="flex-1 rounded-lg border border-border/40 bg-background px-2 py-1 text-xs" />
                      </div>
                    ))}
                  </div>
                  <datalist id="ajn-paths">{AJN_PATHS.map((p) => <option key={p} value={p} />)}</datalist>
                </div>
              ) : null}

              {detail.data?.history?.length ? (
                <div className="rounded-xl border border-border/30 bg-card p-3">
                  <p className="mb-2 text-sm font-semibold text-foreground">الإصدارات</p>
                  <div className="flex flex-wrap gap-2">
                    {detail.data.history.map((h) => <button key={h.version} disabled={act.isPending} onClick={() => act.mutate({ id: selectedId!, path: "revert", body: { version: h.version } }, { onSuccess: () => toast({ title: `تم الرجوع للإصدار ${h.version}` }) })} className="flex items-center gap-1 rounded-full border border-border/40 px-2.5 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"><RotateCcw className="h-3 w-3" /> v{h.version}</button>)}
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">v{detail.data.version} (الحالي)</span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function triggerDownload(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href; a.download = name; a.click();
  if (href.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(href), 2000);
}

function PropText({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <label className="block">{label}<input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="mt-0.5 w-full rounded border border-border/40 bg-background px-2 py-1" /></label>;
}
function PropNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <label className="block">{label}<input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} className="mt-0.5 w-full rounded border border-border/40 bg-background px-2 py-1" /></label>;
}
