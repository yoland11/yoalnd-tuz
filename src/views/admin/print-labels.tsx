import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Printer,
  Search,
  QrCode,
  Tag,
  Layers,
  Copy,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Moon,
  Sun,
  FlaskConical,
  Save,
  History,
  CheckSquare,
  Square,
  Trash2,
  Settings2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import {
  DEFAULT_TEMPLATES,
  DEFAULT_LABEL_SETTINGS,
  TEMPLATE_LABELS,
  buildLabelMarkup,
  openLabelPrintWindow,
  labelCss,
  getLabelHistory,
  recordLabelPrint,
  clearLabelHistory,
  labelHistoryStats,
  type LabelKind,
  type LabelData,
  type LabelTemplateConfig,
  type LabelSettings,
  type LabelFieldToggles,
  type BarcodeFormat,
  type LabelHistoryEntry,
} from "./label-helpers";

type Product = {
  id: number;
  name: string;
  nameAr: string;
  price: string;
  barcode?: string;
  stock: string;
  isRental?: boolean;
  pricePerDay?: number;
  category?: string;
};

type SavedTemplate = {
  id: number;
  name: string;
  type: string;
  paperSize: string;
  config: string;
};

const KIND_ORDER: LabelKind[] = ["asset", "product", "rental", "warehouse", "custom"];

const SETTINGS_KEY = "ajn-label-settings";

function assetCode(id: number) {
  return `AJN-A${String(id).padStart(6, "0")}`;
}

function loadSettings(): LabelSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_LABEL_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_LABEL_SETTINGS };
}

/** Map a product row to label data for the active template kind. */
function productToLabel(product: Product, kind: LabelKind): LabelData {
  const name = product.nameAr || product.name;
  const code = product.barcode || assetCode(product.id);
  const base: LabelData = {
    id: String(product.id),
    name,
    code,
    barcodeValue: product.barcode || assetCode(product.id),
    qrValue: "",
    category: product.category || undefined,
    status: (product.stock ?? "0") !== "0" ? "متوفر" : "غير متوفر",
    price: product.price ? formatCurrency(product.price) : undefined,
  };
  if (kind === "asset") {
    return { ...base, code: assetCode(product.id), barcodeValue: product.barcode || assetCode(product.id) };
  }
  if (kind === "rental") {
    return { ...base, deposit: product.pricePerDay ? formatCurrency(product.pricePerDay) : undefined, status: "للإيجار" };
  }
  return base;
}

const FIELD_ROWS: { key: keyof LabelFieldToggles; label: string }[] = [
  { key: "brand", label: "شعار AJN ERP" },
  { key: "name", label: "الاسم" },
  { key: "code", label: "الرمز" },
  { key: "category", label: "الصنف" },
  { key: "status", label: "الحالة" },
  { key: "warehouse", label: "المخزن" },
  { key: "shelf", label: "الرف" },
  { key: "employee", label: "الموظف" },
  { key: "price", label: "السعر" },
  { key: "deposit", label: "التأمين" },
  { key: "notes", label: "ملاحظات" },
  { key: "qr", label: "QR" },
  { key: "barcode", label: "الباركود" },
];

export default function PrintLabelsPage() {
  const [kind, setKind] = useState<LabelKind>("asset");
  const [config, setConfig] = useState<LabelTemplateConfig>(() => ({ ...DEFAULT_TEMPLATES.asset }));
  const [settings, setSettings] = useState<LabelSettings>(loadSettings);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [quantity, setQuantity] = useState("2");
  const [tab, setTab] = useState<"design" | "settings" | "history">("design");

  // Preview controls
  const [zoom, setZoom] = useState(4);
  const [rotate, setRotate] = useState(0);
  const [darkPreview, setDarkPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");

  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [history, setHistory] = useState<LabelHistoryEntry[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");

  // Warehouse shelf label manual fields (no product source)
  const [wh, setWh] = useState({ warehouse: "", room: "", shelf: "", position: "" });

  const lastPrintRef = useRef<{ labels: LabelData[]; config: LabelTemplateConfig } | null>(null);

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["admin", "label-products"],
    queryFn: () => adminFetch("/admin/products?limit=1000"),
    staleTime: 3 * 60 * 1000,
  });

  useEffect(() => {
    setHistory(getLabelHistory());
  }, []);

  useEffect(() => {
    let alive = true;
    adminFetch<SavedTemplate[]>("/admin/print-templates?type=label")
      .then((rows) => alive && setSavedTemplates(Array.isArray(rows) ? rows : []))
      .catch(() => {
        /* template store optional / needs accounting perm */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Switching template kind resets the config to that kind's defaults.
  function switchKind(next: LabelKind) {
    setKind(next);
    setConfig({ ...DEFAULT_TEMPLATES[next] });
  }

  function flash(kindMsg: "ok" | "err", msg: string) {
    setNotice({ kind: kindMsg, msg });
    window.setTimeout(() => setNotice(null), 4000);
  }

  function persistSettings(next: LabelSettings) {
    setSettings(next);
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  const isRentalKind = kind === "rental";
  const isWarehouseKind = kind === "warehouse";

  const sourceProducts = useMemo(
    () => (isRentalKind ? products.filter((p) => p.isRental) : products),
    [products, isRentalKind],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? sourceProducts.filter(
          (p) =>
            p.nameAr?.toLowerCase().includes(q) ||
            p.name?.toLowerCase().includes(q) ||
            p.barcode?.toLowerCase().includes(q),
        )
      : sourceProducts;
    return list.slice(0, 120);
  }, [sourceProducts, search]);

  const selectedProducts = useMemo(
    () => products.filter((p) => selectedIds.has(p.id)),
    [products, selectedIds],
  );

  // The single label shown in the live preview.
  const previewLabel: LabelData = useMemo(() => {
    if (isWarehouseKind) {
      const code = [wh.warehouse, wh.shelf, wh.position].filter(Boolean).join("-") || "WH-A-01";
      return {
        id: "wh",
        name: wh.warehouse || "المخزن",
        code,
        barcodeValue: code,
        qrValue: "",
        warehouse: wh.warehouse || "المخزن الرئيسي",
        shelf: [wh.room, wh.shelf, wh.position].filter(Boolean).join(" / ") || "A / 01",
      };
    }
    const src = selectedProducts[0] || filtered[0];
    if (!src) {
      return {
        id: "sample",
        name: "اسم العنصر",
        code: "SP-RCF-001",
        barcodeValue: "SPRCF001",
        qrValue: "",
        category: "معدات",
        status: "متوفر",
      };
    }
    return productToLabel(src, kind);
  }, [isWarehouseKind, wh, selectedProducts, filtered, kind]);

  // Regenerate the preview markup whenever inputs change (async QR/barcode).
  useEffect(() => {
    let alive = true;
    buildLabelMarkup(previewLabel, config)
      .then((html) => alive && setPreviewHtml(html))
      .catch(() => alive && setPreviewHtml(""));
    return () => {
      alive = false;
    };
  }, [previewLabel, config]);

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds(new Set(filtered.map((p) => p.id)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  function buildLabels(source: Product[], copies = 1): LabelData[] {
    const out: LabelData[] = [];
    for (const p of source) {
      const label = productToLabel(p, kind);
      for (let i = 0; i < copies; i += 1) out.push(label);
    }
    return out;
  }

  function warehouseLabels(copies = 1): LabelData[] {
    return Array.from({ length: copies }, () => previewLabel);
  }

  // The single "current" product used by Print / Duplicate / Preview (first selected, else first listed).
  function currentProducts(): Product[] {
    const p = selectedProducts[0] || filtered[0];
    return p ? [p] : [];
  }

  async function runPrint(labels: LabelData[], status: "printed" | "test", note?: string) {
    if (!labels.length) {
      flash("err", "لا توجد عناصر محددة للطباعة");
      return;
    }
    try {
      await openLabelPrintWindow(labels, config, settings, {
        title: `${TEMPLATE_LABELS[kind]} — ${labels.length} ملصق`,
      });
      lastPrintRef.current = { labels, config };
      const entry = recordLabelPrint({
        who: "المسؤول",
        count: labels.length,
        template: TEMPLATE_LABELS[kind],
        kind,
        printer: settings.printerName,
        status,
        note,
      });
      setHistory((h) => [entry, ...h]);
      flash("ok", status === "test" ? "تم إرسال صفحة الاختبار" : `تم إرسال ${labels.length} ملصق للطباعة`);
    } catch (err) {
      recordLabelPrint({
        who: "المسؤول",
        count: labels.length,
        template: TEMPLATE_LABELS[kind],
        kind,
        printer: settings.printerName,
        status: "error",
        note: apiErrorMessage(err),
      });
      setHistory(getLabelHistory());
      flash("err", apiErrorMessage(err, "تعذرت الطباعة"));
    }
  }

  const copies = Math.min(Math.max(Number.parseInt(quantity, 10) || 1, 1), 200);

  const printCurrent = () =>
    runPrint(isWarehouseKind ? warehouseLabels(1) : buildLabels(currentProducts(), 1), "printed");
  const printSelected = () =>
    runPrint(isWarehouseKind ? warehouseLabels(1) : buildLabels(selectedProducts, 1), "printed");
  const printMultiple = () =>
    runPrint(isWarehouseKind ? warehouseLabels(copies) : buildLabels(selectedProducts, copies), "printed");
  const printAll = () =>
    runPrint(isWarehouseKind ? warehouseLabels(copies) : buildLabels(sourceProducts, 1), "printed");
  const duplicateCurrent = () =>
    runPrint(isWarehouseKind ? warehouseLabels(copies) : buildLabels(currentProducts(), copies), "printed");
  const preview = async () => {
    const labels = isWarehouseKind ? warehouseLabels(1) : buildLabels(currentProducts(), 1);
    if (!labels.length) return flash("err", "اختر عنصراً للمعاينة");
    try {
      const { buildLabelSheetHtml } = await import("./label-helpers");
      const html = await buildLabelSheetHtml(labels, config, settings, { title: "معاينة الملصق", autoPrint: false });
      const w = window.open("", "_blank", "width=420,height=560");
      if (!w) return flash("err", "تعذر فتح نافذة المعاينة");
      w.document.write(html);
      w.document.close();
    } catch (err) {
      flash("err", apiErrorMessage(err));
    }
  };
  const reprint = () => {
    const last = lastPrintRef.current;
    if (!last) return flash("err", "لا توجد طباعة سابقة");
    runPrint(last.labels, "printed", "إعادة طباعة");
  };
  const testPrint = () => {
    const testLabel: LabelData = {
      id: "test",
      name: "اختبار المحاذاة 40×30",
      code: "TEST-0000",
      barcodeValue: "TEST0000",
      qrValue: window.location.origin,
      category: "اختبار الجودة",
      status: "معايرة",
    };
    runPrint([testLabel], "test", "صفحة اختبار");
  };

  async function saveTemplate() {
    if (!templateName.trim()) return flash("err", "أدخل اسم القالب");
    try {
      const payload = {
        name: templateName.trim(),
        type: "label",
        paperSize: `${settings.widthMm}x${settings.heightMm}`,
        config: JSON.stringify({ kind, config, settings }),
      };
      const row = await adminFetch<SavedTemplate>("/admin/print-templates", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSavedTemplates((t) => [row, ...t.filter((x) => x.id !== row.id)]);
      setTemplateName("");
      flash("ok", "تم حفظ القالب");
    } catch (err) {
      flash("err", apiErrorMessage(err, "تعذر حفظ القالب (يتطلب صلاحية الحسابات)"));
    }
  }

  function applySavedTemplate(t: SavedTemplate) {
    try {
      const parsed = JSON.parse(t.config || "{}");
      if (parsed.kind) setKind(parsed.kind);
      if (parsed.config) setConfig(parsed.config);
      if (parsed.settings) persistSettings({ ...DEFAULT_LABEL_SETTINGS, ...parsed.settings });
      flash("ok", `تم تطبيق قالب: ${t.name}`);
    } catch {
      flash("err", "تعذر قراءة القالب");
    }
  }

  async function deleteSavedTemplate(id: number) {
    try {
      await adminFetch(`/admin/print-templates/${id}`, { method: "DELETE" });
      setSavedTemplates((t) => t.filter((x) => x.id !== id));
      flash("ok", "تم حذف القالب");
    } catch (err) {
      flash("err", apiErrorMessage(err));
    }
  }

  function setField(key: keyof LabelFieldToggles, value: boolean) {
    setConfig((c) => ({ ...c, fields: { ...c.fields, [key]: value } }));
  }

  const stats = useMemo(() => labelHistoryStats(history), [history]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <QrCode className="w-6 h-6 text-primary" /> طباعة الملصقات
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            ملصقات QR وباركود احترافية — Xprinter XP-236B ‏· 40×30 مم ‏· 203 DPI
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={printSelected} disabled={!selectedIds.size && !isWarehouseKind} className="gap-2">
            <Printer className="w-4 h-4" /> طباعة المحدد
          </Button>
          <Button variant="outline" onClick={testPrint} className="gap-2">
            <FlaskConical className="w-4 h-4" /> اختبار
          </Button>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            notice.kind === "ok"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
              : "border-red-500/40 bg-red-500/10 text-red-500"
          }`}
        >
          {notice.msg}
        </div>
      )}

      {/* Template kinds */}
      <div className="flex items-center gap-2 flex-wrap">
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => switchKind(k)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              kind === k
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border/40 bg-background/50 text-muted-foreground hover:border-primary/35"
            }`}
          >
            {TEMPLATE_LABELS[k]}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/40">
        {([
          ["design", "التصميم والطباعة", Layers],
          ["settings", "الإعدادات", Settings2],
          ["history", "سجل الطباعة", History],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "design" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(260px,340px)_1fr_minmax(300px,360px)]">
          {/* Source list / warehouse fields */}
          <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
            {isWarehouseKind ? (
              <div className="space-y-3">
                <p className="font-semibold text-sm text-foreground">بيانات رف المخزن</p>
                {([
                  ["warehouse", "المخزن"],
                  ["room", "الغرفة"],
                  ["shelf", "الرف"],
                  ["position", "الموضع"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="block text-xs text-muted-foreground">
                    {label}
                    <input
                      value={wh[key]}
                      onChange={(e) => setWh((w) => ({ ...w, [key]: e.target.value }))}
                      className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </label>
                ))}
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="بحث بالاسم أو الباركود..."
                    className="w-full bg-background border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <button type="button" onClick={selectAllFiltered} className="text-primary hover:underline">
                    تحديد الكل
                  </button>
                  <span className="text-muted-foreground">{selectedIds.size} محدد</span>
                  <button type="button" onClick={clearSelection} className="text-muted-foreground hover:underline">
                    مسح
                  </button>
                </div>
                <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                  {isLoading ? (
                    [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)
                  ) : filtered.length === 0 ? (
                    <EmptyState message="لا توجد عناصر" />
                  ) : (
                    filtered.map((p) => {
                      const active = selectedIds.has(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => toggleSelect(p.id)}
                          className={`w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-right transition-colors ${
                            active ? "border-primary/60 bg-primary/10" : "border-border/30 bg-background/50 hover:border-primary/35"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-foreground truncate">{p.nameAr || p.name}</p>
                            <p className="text-xs text-muted-foreground font-mono" dir="ltr">
                              {p.barcode || assetCode(p.id)}
                            </p>
                          </div>
                          {active ? (
                            <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>

          {/* Live preview */}
          <div className="bg-card rounded-xl border border-border/30 p-4 flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <p className="font-semibold text-foreground flex items-center gap-2">
                <Maximize2 className="w-4 h-4 text-primary" /> معاينة مباشرة
              </p>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(1.5, z - 0.5))}>
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(zoom * 100) / 100}x</span>
                <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(9, z + 0.5))}>
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setZoom(4)} title="ملاءمة">
                  <Maximize2 className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRotate((r) => (r + 90) % 360)} title="تدوير">
                  <RotateCw className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDarkPreview((d) => !d)} title="الوضع الداكن">
                  {darkPreview ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <div
              className={`flex-1 min-h-[300px] rounded-lg border border-dashed border-border/40 grid place-items-center overflow-auto p-6 transition-colors ${
                darkPreview ? "bg-zinc-900" : "bg-zinc-100"
              }`}
            >
              <style>{labelCss(settings, { screen: true })}</style>
              <div
                style={{
                  transform: `scale(${zoom}) rotate(${rotate}deg)`,
                  transformOrigin: "center",
                  transition: "transform 0.15s ease",
                  boxShadow: "0 2px 14px rgba(0,0,0,0.25)",
                }}
              >
                <div className="lb-label" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            </div>

            {/* Print buttons */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Button onClick={printCurrent} className="gap-2" size="sm">
                <Printer className="w-4 h-4" /> طباعة
              </Button>
              <Button onClick={printSelected} variant="outline" size="sm" className="gap-2">
                <Layers className="w-4 h-4" /> المحدد
              </Button>
              <Button onClick={printMultiple} variant="outline" size="sm" className="gap-2">
                <Copy className="w-4 h-4" /> متعدد
              </Button>
              <Button onClick={printAll} variant="outline" size="sm" className="gap-2">
                <Layers className="w-4 h-4" /> الكل
              </Button>
              <Button onClick={preview} variant="ghost" size="sm" className="gap-2">
                <Maximize2 className="w-4 h-4" /> معاينة
              </Button>
              <Button onClick={testPrint} variant="ghost" size="sm" className="gap-2">
                <FlaskConical className="w-4 h-4" /> اختبار
              </Button>
              <Button onClick={duplicateCurrent} variant="ghost" size="sm" className="gap-2">
                <Copy className="w-4 h-4" /> تكرار
              </Button>
              <Button onClick={reprint} variant="ghost" size="sm" className="gap-2">
                <RefreshCw className="w-4 h-4" /> إعادة
              </Button>
            </div>
            <div className="mt-2">
              <label className="text-xs text-muted-foreground flex items-center gap-2">
                عدد النسخ للطباعة المتعددة / التكرار:
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-20 bg-background border border-border/40 rounded-lg px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
            </div>
          </div>

          {/* Design panel */}
          <div className="bg-card rounded-xl border border-border/30 p-4 space-y-4">
            <div>
              <p className="font-semibold text-sm text-foreground flex items-center gap-2 mb-2">
                <Tag className="w-4 h-4 text-primary" /> عناصر الملصق
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {FIELD_ROWS.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.fields[key]}
                      onChange={(e) => setField(key, e.target.checked)}
                      disabled={kind !== "custom" && (key === "qr" || key === "barcode" || key === "brand" || key === "name" || key === "code")}
                      className="accent-primary"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <label className="block text-xs text-muted-foreground">
              نص الشعار العلوي
              <input
                value={config.brandText}
                onChange={(e) => setConfig((c) => ({ ...c, brandText: e.target.value }))}
                className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-muted-foreground">
                نوع الباركود
                <select
                  value={config.barcodeFormat}
                  onChange={(e) => setConfig((c) => ({ ...c, barcodeFormat: e.target.value as BarcodeFormat }))}
                  className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm"
                >
                  {(["CODE128", "CODE39", "EAN13", "AUTO"] as BarcodeFormat[]).map((f) => (
                    <option key={f} value={f}>
                      {f === "AUTO" ? "تلقائي" : f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-muted-foreground">
                رابط QR الأساسي
                <input
                  value={config.qrBaseUrl}
                  onChange={(e) => setConfig((c) => ({ ...c, qrBaseUrl: e.target.value }))}
                  placeholder={typeof window !== "undefined" ? window.location.origin : ""}
                  className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm ltr:text-left"
                  dir="ltr"
                />
              </label>
            </div>

            {/* Save / load templates */}
            <div className="border-t border-border/40 pt-3 space-y-2">
              <p className="font-semibold text-sm text-foreground flex items-center gap-2">
                <Save className="w-4 h-4 text-primary" /> القوالب المحفوظة
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="اسم القالب"
                  className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <Button size="sm" onClick={saveTemplate} className="gap-1">
                  <Save className="w-4 h-4" /> حفظ
                </Button>
              </div>
              <div className="space-y-1 max-h-[140px] overflow-y-auto">
                {savedTemplates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">لا توجد قوالب محفوظة بعد.</p>
                ) : (
                  savedTemplates.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/30 bg-background/50 px-3 py-1.5">
                      <button type="button" onClick={() => applySavedTemplate(t)} className="text-sm text-foreground hover:text-primary truncate text-right flex-1">
                        {t.name}
                      </button>
                      <button type="button" onClick={() => deleteSavedTemplate(t.id)} className="text-muted-foreground hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div className="bg-card rounded-xl border border-border/30 p-5 max-w-2xl space-y-4">
          <p className="font-semibold text-foreground">إعدادات الطابعة والملصق</p>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-xs text-muted-foreground">
              الطابعة
              <input
                value={settings.printerName}
                onChange={(e) => persistSettings({ ...settings, printerName: e.target.value })}
                className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              الدقة DPI
              <input
                type="number"
                value={settings.dpi}
                onChange={(e) => persistSettings({ ...settings, dpi: Number(e.target.value) || 203 })}
                className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              العرض (مم)
              <input
                type="number"
                value={settings.widthMm}
                onChange={(e) => persistSettings({ ...settings, widthMm: Number(e.target.value) || 40 })}
                className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              الارتفاع (مم)
              <input
                type="number"
                value={settings.heightMm}
                onChange={(e) => persistSettings({ ...settings, heightMm: Number(e.target.value) || 30 })}
                className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              الهامش (مم)
              <input
                type="number"
                step="0.5"
                value={settings.marginMm}
                onChange={(e) => persistSettings({ ...settings, marginMm: Number(e.target.value) || 0 })}
                className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              الفجوة بين الملصقات (مم)
              <input
                type="number"
                step="0.5"
                value={settings.gapMm}
                onChange={(e) => persistSettings({ ...settings, gapMm: Number(e.target.value) || 2 })}
                className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4 pt-2">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" checked={settings.autoCenter} onChange={(e) => persistSettings({ ...settings, autoCenter: e.target.checked })} className="accent-primary" />
              توسيط تلقائي
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" checked={settings.highQuality} onChange={(e) => persistSettings({ ...settings, highQuality: e.target.checked })} className="accent-primary" />
              طباعة عالية الجودة
            </label>
            <span className="text-sm text-muted-foreground self-center">الاتجاه: أفقي (Landscape)</span>
          </div>
          <div className="pt-2 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => persistSettings({ ...DEFAULT_LABEL_SETTINGS })}>
              استعادة الافتراضي (40×30 / 203DPI)
            </Button>
            <Button variant="ghost" size="sm" onClick={testPrint} className="gap-2">
              <FlaskConical className="w-4 h-4" /> طباعة صفحة اختبار
            </Button>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["طُبع اليوم", stats.printedToday],
              ["إجمالي الملصقات", stats.totalPrinted],
              ["آخر طابعة", stats.lastPrinter],
              ["أخطاء الطباعة", stats.errors],
            ].map(([label, value]) => (
              <div key={label as string} className="bg-card rounded-xl border border-border/30 p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-bold text-foreground mt-1">{value}</p>
              </div>
            ))}
          </div>
          <div className="bg-card rounded-xl border border-border/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-foreground">سجل الطباعة</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearLabelHistory();
                  setHistory([]);
                }}
                className="gap-1 text-red-500"
              >
                <Trash2 className="w-4 h-4" /> مسح السجل
              </Button>
            </div>
            {history.length === 0 ? (
              <EmptyState message="لا يوجد سجل طباعة بعد" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs border-b border-border/40">
                      <th className="text-right py-2 font-medium">التاريخ</th>
                      <th className="text-right py-2 font-medium">القالب</th>
                      <th className="text-right py-2 font-medium">العدد</th>
                      <th className="text-right py-2 font-medium">الطابعة</th>
                      <th className="text-right py-2 font-medium">الجهاز</th>
                      <th className="text-right py-2 font-medium">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice(0, 100).map((h) => (
                      <tr key={h.id} className="border-b border-border/20">
                        <td className="py-2 text-muted-foreground">{new Date(h.at).toLocaleString("ar")}</td>
                        <td className="py-2 text-foreground">{h.template}</td>
                        <td className="py-2 text-foreground">{h.count}</td>
                        <td className="py-2 text-muted-foreground">{h.printer}</td>
                        <td className="py-2 text-muted-foreground">{h.device}</td>
                        <td className="py-2">
                          <span
                            className={`text-xs rounded px-2 py-0.5 ${
                              h.status === "error"
                                ? "bg-red-500/10 text-red-500"
                                : h.status === "test"
                                  ? "bg-amber-500/10 text-amber-500"
                                  : "bg-emerald-500/10 text-emerald-500"
                            }`}
                          >
                            {h.status === "error" ? "خطأ" : h.status === "test" ? "اختبار" : "طُبع"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
