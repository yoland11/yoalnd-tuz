import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Palette, Type, Layout, Save, Download, Upload, Trash2, Plus,
  Eye, Settings2, FileText, RotateCcw, CheckCircle2, Copy,
} from "lucide-react";
import { adminFetch, formatCurrency } from "./_lib";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";

// ─── Types ───────────────────────────────────────────────────────────────────

interface InvoiceConfig {
  showLogo: boolean;
  showCompanyName: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showTaxNo: boolean;
  taxNoValue: string;
  showDate: boolean;
  showInvoiceNo: boolean;
  showCustomerName: boolean;
  showNotes: boolean;
  primaryColor: string;
  headerBg: string;
  headerTextColor: string;
  bodyBg: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  borderColor: string;
  fontFamily: string;
  tableStyle: "bordered" | "striped" | "minimal";
  customHeader: string;
  customFooter: string;
  paperSize: "a4" | "a5" | "thermal80";
}

interface PrintTemplate {
  id: number;
  name: string;
  type: string;
  paperSize: string;
  isDefault: number;
  config: string;
  createdAt: string;
}

// ─── Presets ─────────────────────────────────────────────────────────────────

const PRESET_TEMPLATES: { key: string; label: string; config: InvoiceConfig }[] = [
  {
    key: "classic",
    label: "كلاسيك",
    config: {
      showLogo: true, showCompanyName: true, showAddress: true, showPhone: true,
      showTaxNo: false, taxNoValue: "", showDate: true, showInvoiceNo: true,
      showCustomerName: true, showNotes: true,
      primaryColor: "#C9A84C", headerBg: "#1a1210", headerTextColor: "#C9A84C",
      bodyBg: "#ffffff", tableHeaderBg: "#C9A84C", tableHeaderText: "#1a1210",
      borderColor: "#C9A84C",
      fontFamily: "Cairo", tableStyle: "bordered",
      customHeader: "", customFooter: "شكراً لتعاملكم معنا",
      paperSize: "a4",
    },
  },
  {
    key: "modern",
    label: "مودرن",
    config: {
      showLogo: true, showCompanyName: true, showAddress: true, showPhone: true,
      showTaxNo: false, taxNoValue: "", showDate: true, showInvoiceNo: true,
      showCustomerName: true, showNotes: true,
      primaryColor: "#2563eb", headerBg: "#1e3a5f", headerTextColor: "#e0f2fe",
      bodyBg: "#f8fafc", tableHeaderBg: "#1e3a5f", tableHeaderText: "#e0f2fe",
      borderColor: "#2563eb",
      fontFamily: "Tajawal", tableStyle: "striped",
      customHeader: "", customFooter: "نشكرك على ثقتك بنا",
      paperSize: "a4",
    },
  },
  {
    key: "simple",
    label: "بسيط",
    config: {
      showLogo: false, showCompanyName: true, showAddress: true, showPhone: true,
      showTaxNo: false, taxNoValue: "", showDate: true, showInvoiceNo: true,
      showCustomerName: true, showNotes: false,
      primaryColor: "#374151", headerBg: "#f9fafb", headerTextColor: "#111827",
      bodyBg: "#ffffff", tableHeaderBg: "#f3f4f6", tableHeaderText: "#111827",
      borderColor: "#d1d5db",
      fontFamily: "Cairo", tableStyle: "minimal",
      customHeader: "", customFooter: "",
      paperSize: "a4",
    },
  },
];

const DEFAULT_CONFIG: InvoiceConfig = PRESET_TEMPLATES[0].config;

const FONT_OPTIONS = [
  { value: "Cairo", label: "Cairo" },
  { value: "Tajawal", label: "Tajawal" },
  { value: "Amiri", label: "Amiri" },
  { value: "sans-serif", label: "افتراضي" },
];

const PAPER_SIZES = [
  { value: "a4", label: "A4" },
  { value: "a5", label: "A5" },
  { value: "thermal80", label: "Thermal 80mm" },
];

// ─── Sample Data for Preview ─────────────────────────────────────────────────

const SAMPLE_ITEMS = [
  { name: "منتج تجريبي أول", qty: 2, price: 25000, total: 50000 },
  { name: "منتج تجريبي ثاني", qty: 1, price: 75000, total: 75000 },
  { name: "منتج تجريبي ثالث", qty: 3, price: 15000, total: 45000 },
];
const SAMPLE_SUBTOTAL = 170000;
const SAMPLE_DISCOUNT = 10000;
const SAMPLE_GRAND = 160000;

// ─── Live Preview ─────────────────────────────────────────────────────────────

function InvoicePreview({ cfg, settings }: { cfg: InvoiceConfig; settings: any }) {
  const logo = logoSrc(settings);
  const companyName = settings?.site_name ?? "مجموعة علي جان";
  const companyAddress = settings?.address ?? "بغداد، العراق";
  const companyPhone = settings?.phones?.[0] ?? "07700000000";

  const paperH = cfg.paperSize === "a5" ? 560 : cfg.paperSize === "thermal80" ? 700 : 792;

  const tableRows = SAMPLE_ITEMS.map((item, i) => {
    const rowBg = cfg.tableStyle === "striped" && i % 2 === 0 ? cfg.tableHeaderBg + "18" : "transparent";
    return (
      <tr key={i} style={{ background: rowBg }}>
        <td style={{ padding: "5px 8px", border: cfg.tableStyle === "bordered" ? `1px solid ${cfg.borderColor}` : "none", borderBottom: `1px solid ${cfg.borderColor}30` }}>{item.name}</td>
        <td style={{ padding: "5px 8px", textAlign: "center", border: cfg.tableStyle === "bordered" ? `1px solid ${cfg.borderColor}` : "none", borderBottom: `1px solid ${cfg.borderColor}30` }}>{item.qty}</td>
        <td style={{ padding: "5px 8px", textAlign: "center", border: cfg.tableStyle === "bordered" ? `1px solid ${cfg.borderColor}` : "none", borderBottom: `1px solid ${cfg.borderColor}30` }}>{formatCurrency(item.price)}</td>
        <td style={{ padding: "5px 8px", textAlign: "center", border: cfg.tableStyle === "bordered" ? `1px solid ${cfg.borderColor}` : "none", borderBottom: `1px solid ${cfg.borderColor}30` }}>{formatCurrency(item.total)}</td>
      </tr>
    );
  });

  return (
    <div
      dir="rtl"
      style={{
        width: 595,
        minHeight: paperH,
        background: cfg.bodyBg,
        fontFamily: cfg.fontFamily,
        fontSize: 11,
        color: "#1a1a1a",
        boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
        borderRadius: 4,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Header */}
      <div style={{ background: cfg.headerBg, color: cfg.headerTextColor, padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {cfg.showLogo && logo && (
              <img src={logo} alt="logo" style={{ height: 44, objectFit: "contain" }} />
            )}
            <div>
              {cfg.showCompanyName && (
                <div style={{ fontSize: 16, fontWeight: 700, color: cfg.primaryColor }}>{companyName}</div>
              )}
              {cfg.showAddress && (
                <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>{companyAddress}</div>
              )}
              {cfg.showPhone && (
                <div style={{ fontSize: 10, opacity: 0.8 }}>{companyPhone}</div>
              )}
              {cfg.showTaxNo && cfg.taxNoValue && (
                <div style={{ fontSize: 10, opacity: 0.8 }}>الرقم الضريبي: {cfg.taxNoValue}</div>
              )}
            </div>
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: cfg.primaryColor }}>فاتورة</div>
            {cfg.showInvoiceNo && <div style={{ fontSize: 10, opacity: 0.8 }}>#INV-2024-001</div>}
            {cfg.showDate && <div style={{ fontSize: 10, opacity: 0.8 }}>١ يناير ٢٠٢٤</div>}
          </div>
        </div>
        {cfg.customHeader && (
          <div style={{ marginTop: 8, fontSize: 10, opacity: 0.85, borderTop: `1px solid ${cfg.primaryColor}40`, paddingTop: 6 }}>
            {cfg.customHeader}
          </div>
        )}
      </div>

      {/* Customer Info */}
      {cfg.showCustomerName && (
        <div style={{ padding: "10px 20px", background: cfg.primaryColor + "12", borderBottom: `1px solid ${cfg.borderColor}30` }}>
          <span style={{ fontSize: 10, color: cfg.primaryColor, fontWeight: 600 }}>العميل: </span>
          <span style={{ fontSize: 10 }}>محمد أحمد (نموذج تجريبي)</span>
        </div>
      )}

      {/* Items Table */}
      <div style={{ padding: "12px 20px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ background: cfg.tableHeaderBg, color: cfg.tableHeaderText }}>
              <th style={{ padding: "6px 8px", textAlign: "right", border: cfg.tableStyle === "bordered" ? `1px solid ${cfg.borderColor}` : "none" }}>المنتج</th>
              <th style={{ padding: "6px 8px", textAlign: "center", border: cfg.tableStyle === "bordered" ? `1px solid ${cfg.borderColor}` : "none" }}>الكمية</th>
              <th style={{ padding: "6px 8px", textAlign: "center", border: cfg.tableStyle === "bordered" ? `1px solid ${cfg.borderColor}` : "none" }}>السعر</th>
              <th style={{ padding: "6px 8px", textAlign: "center", border: cfg.tableStyle === "bordered" ? `1px solid ${cfg.borderColor}` : "none" }}>الإجمالي</th>
            </tr>
          </thead>
          <tbody>{tableRows}</tbody>
        </table>
      </div>

      {/* Totals */}
      <div style={{ padding: "0 20px 12px", display: "flex", justifyContent: "flex-start" }}>
        <div style={{ width: 220, fontSize: 11 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${cfg.borderColor}20` }}>
            <span>المجموع الفرعي</span>
            <span>{formatCurrency(SAMPLE_SUBTOTAL)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${cfg.borderColor}20`, color: "#dc2626" }}>
            <span>خصم</span>
            <span>- {formatCurrency(SAMPLE_DISCOUNT)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontWeight: 700, fontSize: 13, color: cfg.primaryColor }}>
            <span>الإجمالي</span>
            <span>{formatCurrency(SAMPLE_GRAND)}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      {cfg.showNotes && (
        <div style={{ padding: "0 20px 12px", fontSize: 10, color: "#666" }}>
          <span style={{ color: cfg.primaryColor, fontWeight: 600 }}>ملاحظات: </span>
          يرجى مراجعة البضاعة عند الاستلام.
        </div>
      )}

      {/* Footer */}
      {cfg.customFooter && (
        <div style={{ margin: "0 20px", borderTop: `2px solid ${cfg.primaryColor}`, paddingTop: 8, paddingBottom: 12, textAlign: "center", fontSize: 11, color: cfg.primaryColor, fontWeight: 600 }}>
          {cfg.customFooter}
        </div>
      )}
    </div>
  );
}

// ─── Helper UI Components ─────────────────────────────────────────────────────

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-sm text-muted-foreground flex-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border border-border/40 bg-transparent"
        />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-20 text-xs bg-background border border-border/40 rounded px-2 py-1 font-mono text-foreground"
        />
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full py-1.5 group"
    >
      <span className="text-sm text-foreground/80">{label}</span>
      <div className={`w-9 h-5 rounded-full transition-colors relative ${checked ? "bg-primary" : "bg-muted"}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? "right-0.5" : "left-0.5"}`} />
      </div>
    </button>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border/30">
      <Icon className="w-4 h-4 text-primary" />
      <span className="text-sm font-semibold text-foreground">{title}</span>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "templates" | "fields" | "style" | "layout";

export default function InvoiceDesignerPage() {
  const queryClient = useQueryClient();
  const { data: settings } = usePublicSettings();

  const [activeTab, setActiveTab] = useState<Tab>("templates");
  const [config, setConfig] = useState<InvoiceConfig>(DEFAULT_CONFIG);
  const [templateName, setTemplateName] = useState("قالب جديد");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [previewScale, setPreviewScale] = useState(0.65);
  const importRef = useRef<HTMLInputElement>(null);

  const cfg = (patch: Partial<InvoiceConfig>) => setConfig(prev => ({ ...prev, ...patch }));

  // ─── Fetch saved templates ───────────────────────────────────────────────
  const { data: templates = [] } = useQuery<PrintTemplate[]>({
    queryKey: ["print-templates", "sales"],
    queryFn: () => adminFetch("/admin/print-templates?type=sales"),
  });

  // ─── Load active template when list loads ────────────────────────────────
  useEffect(() => {
    if (!templates.length) return;
    const def = templates.find(t => t.isDefault === 1) ?? templates[0];
    if (activeId === null) {
      loadTemplate(def);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  function loadTemplate(t: PrintTemplate) {
    setActiveId(t.id);
    setTemplateName(t.name);
    try {
      const parsed = JSON.parse(t.config);
      setConfig({ ...DEFAULT_CONFIG, ...parsed });
    } catch { /* ignore */ }
  }

  // ─── Save mutation ───────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        name: templateName,
        type: "sales",
        paperSize: config.paperSize,
        isDefault: 1,
        config: JSON.stringify(config),
      };
      if (activeId) {
        return adminFetch(`/admin/print-templates/${activeId}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        return adminFetch("/admin/print-templates", { method: "POST", body: JSON.stringify(body) });
      }
    },
    onSuccess: (res: PrintTemplate) => {
      queryClient.invalidateQueries({ queryKey: ["print-templates", "sales"] });
      setActiveId(res.id);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  // ─── Delete mutation ─────────────────────────────────────────────────────
  const deleteMut = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/print-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["print-templates", "sales"] });
      setActiveId(null);
      setConfig(DEFAULT_CONFIG);
      setTemplateName("قالب جديد");
    },
  });

  // ─── Export JSON ─────────────────────────────────────────────────────────
  function exportJson() {
    const data = { name: templateName, config };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-template-${templateName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Import JSON ─────────────────────────────────────────────────────────
  function importJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (parsed.config) {
          setConfig({ ...DEFAULT_CONFIG, ...parsed.config });
          if (parsed.name) setTemplateName(parsed.name);
          setActiveId(null);
        }
      } catch { /* ignore */ }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // ─── New blank template ──────────────────────────────────────────────────
  function newTemplate() {
    setActiveId(null);
    setConfig(DEFAULT_CONFIG);
    setTemplateName("قالب جديد");
    setActiveTab("fields");
  }

  // ─── Apply preset ────────────────────────────────────────────────────────
  function applyPreset(preset: typeof PRESET_TEMPLATES[0]) {
    setConfig(preset.config);
    setTemplateName(preset.label);
    setActiveId(null);
    setActiveTab("fields");
  }

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: "templates", label: "القوالب", icon: FileText },
    { key: "fields", label: "الحقول", icon: Eye },
    { key: "style", label: "التصميم", icon: Palette },
    { key: "layout", label: "التخطيط", icon: Layout },
  ];

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">مصمم الفاتورة</h1>
          <p className="text-sm text-muted-foreground">صمم وخصص قالب طباعة الفاتورة</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={importJson} />
          <button
            onClick={() => importRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-muted/60 hover:bg-muted text-foreground border border-border/40 transition-colors"
          >
            <Upload className="w-4 h-4" />
            استيراد
          </button>
          <button
            onClick={exportJson}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-muted/60 hover:bg-muted text-foreground border border-border/40 transition-colors"
          >
            <Download className="w-4 h-4" />
            تصدير JSON
          </button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors disabled:opacity-60"
          >
            {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? "تم الحفظ" : saveMut.isPending ? "جاري الحفظ..." : "حفظ القالب"}
          </button>
        </div>
      </div>

      {/* Template Name + Default Badge */}
      <div className="flex items-center gap-3">
        <div className="flex-1 max-w-xs">
          <input
            type="text"
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            placeholder="اسم القالب"
            className="w-full bg-card border border-border/40 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        {activeId && (
          <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded-full">
            قالب محفوظ #{activeId}
          </span>
        )}
        {!activeId && (
          <span className="text-xs text-muted-foreground bg-muted/60 px-2 py-1 rounded-full">
            غير محفوظ
          </span>
        )}
      </div>

      {/* Main Layout: Left Panel + Right Preview */}
      <div className="flex gap-4 items-start">
        {/* ── Left Panel ── */}
        <div className="w-72 shrink-0 space-y-3">
          {/* Saved Templates List */}
          {templates.length > 0 && (
            <div className="bg-card border border-border/30 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">القوالب المحفوظة</span>
                <button onClick={newTemplate} className="text-xs text-primary hover:text-primary/80 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> جديد
                </button>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {templates.map(t => (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${activeId === t.id ? "bg-primary/10 text-primary" : "hover:bg-muted/60 text-foreground/80"}`}
                    onClick={() => loadTemplate(t)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm truncate">{t.name}</span>
                      {t.isDefault === 1 && (
                        <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full shrink-0">افتراضي</span>
                      )}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); if (confirm("حذف هذا القالب؟")) deleteMut.mutate(t.id); }}
                      className="text-muted-foreground hover:text-destructive ml-1 shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="bg-card border border-border/30 rounded-xl overflow-hidden">
            <div className="flex border-b border-border/30">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors ${activeTab === tab.key ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-4 space-y-4 max-h-[560px] overflow-y-auto">
              {/* ── Templates Tab ── */}
              {activeTab === "templates" && (
                <div className="space-y-3">
                  <SectionTitle icon={FileText} title="قوالب جاهزة" />
                  <div className="space-y-2">
                    {PRESET_TEMPLATES.map(preset => (
                      <button
                        key={preset.key}
                        onClick={() => applyPreset(preset)}
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-border/30 hover:border-primary/50 hover:bg-primary/5 transition-all text-right group"
                      >
                        <div
                          className="w-8 h-8 rounded-md shrink-0 flex items-center justify-center"
                          style={{ background: preset.config.headerBg }}
                        >
                          <div className="w-4 h-4 rounded-sm" style={{ background: preset.config.primaryColor }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-foreground group-hover:text-primary">{preset.label}</div>
                          <div className="text-[11px] text-muted-foreground">{preset.config.fontFamily} · {preset.config.tableStyle}</div>
                        </div>
                        <Copy className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary" />
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={newTemplate}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-border/40 hover:border-primary/40 hover:bg-primary/5 text-sm text-muted-foreground hover:text-primary transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    قالب فارغ جديد
                  </button>
                </div>
              )}

              {/* ── Fields Tab ── */}
              {activeTab === "fields" && (
                <div className="space-y-4">
                  <div>
                    <SectionTitle icon={Eye} title="حقول الرأسية" />
                    <div className="space-y-0.5">
                      <Toggle checked={config.showLogo} onChange={v => cfg({ showLogo: v })} label="الشعار (Logo)" />
                      <Toggle checked={config.showCompanyName} onChange={v => cfg({ showCompanyName: v })} label="اسم الشركة" />
                      <Toggle checked={config.showAddress} onChange={v => cfg({ showAddress: v })} label="العنوان" />
                      <Toggle checked={config.showPhone} onChange={v => cfg({ showPhone: v })} label="رقم الهاتف" />
                      <Toggle checked={config.showTaxNo} onChange={v => cfg({ showTaxNo: v })} label="الرقم الضريبي" />
                    </div>
                    {config.showTaxNo && (
                      <input
                        type="text"
                        value={config.taxNoValue}
                        onChange={e => cfg({ taxNoValue: e.target.value })}
                        placeholder="أدخل الرقم الضريبي"
                        className="mt-2 w-full bg-background border border-border/40 rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                      />
                    )}
                  </div>
                  <div>
                    <SectionTitle icon={Eye} title="حقول الفاتورة" />
                    <div className="space-y-0.5">
                      <Toggle checked={config.showDate} onChange={v => cfg({ showDate: v })} label="التاريخ" />
                      <Toggle checked={config.showInvoiceNo} onChange={v => cfg({ showInvoiceNo: v })} label="رقم الفاتورة" />
                      <Toggle checked={config.showCustomerName} onChange={v => cfg({ showCustomerName: v })} label="اسم العميل" />
                      <Toggle checked={config.showNotes} onChange={v => cfg({ showNotes: v })} label="الملاحظات" />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Style Tab ── */}
              {activeTab === "style" && (
                <div className="space-y-4">
                  <div>
                    <SectionTitle icon={Palette} title="الألوان" />
                    <div className="space-y-3">
                      <ColorField label="اللون الرئيسي" value={config.primaryColor} onChange={v => cfg({ primaryColor: v })} />
                      <ColorField label="خلفية الرأسية" value={config.headerBg} onChange={v => cfg({ headerBg: v })} />
                      <ColorField label="نص الرأسية" value={config.headerTextColor} onChange={v => cfg({ headerTextColor: v })} />
                      <ColorField label="خلفية الصفحة" value={config.bodyBg} onChange={v => cfg({ bodyBg: v })} />
                      <ColorField label="رأس الجدول" value={config.tableHeaderBg} onChange={v => cfg({ tableHeaderBg: v })} />
                      <ColorField label="نص رأس الجدول" value={config.tableHeaderText} onChange={v => cfg({ tableHeaderText: v })} />
                      <ColorField label="لون الحدود" value={config.borderColor} onChange={v => cfg({ borderColor: v })} />
                    </div>
                  </div>
                  <div>
                    <SectionTitle icon={Type} title="الخط" />
                    <div className="grid grid-cols-2 gap-2">
                      {FONT_OPTIONS.map(f => (
                        <button
                          key={f.value}
                          onClick={() => cfg({ fontFamily: f.value })}
                          style={{ fontFamily: f.value }}
                          className={`py-2 px-3 rounded-lg border text-sm transition-all ${config.fontFamily === f.value ? "border-primary bg-primary/10 text-primary" : "border-border/30 text-foreground/70 hover:border-primary/40"}`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <SectionTitle icon={Settings2} title="نمط الجدول" />
                    <div className="grid grid-cols-3 gap-2">
                      {(["bordered", "striped", "minimal"] as const).map(style => (
                        <button
                          key={style}
                          onClick={() => cfg({ tableStyle: style })}
                          className={`py-2 px-2 rounded-lg border text-xs transition-all ${config.tableStyle === style ? "border-primary bg-primary/10 text-primary" : "border-border/30 text-foreground/70 hover:border-primary/40"}`}
                        >
                          {style === "bordered" ? "حدود" : style === "striped" ? "مخطط" : "بسيط"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => setConfig(DEFAULT_CONFIG)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground border border-border/30 hover:border-border transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    إعادة الضبط الافتراضي
                  </button>
                </div>
              )}

              {/* ── Layout Tab ── */}
              {activeTab === "layout" && (
                <div className="space-y-4">
                  <div>
                    <SectionTitle icon={Layout} title="حجم الورق" />
                    <div className="grid grid-cols-3 gap-2">
                      {PAPER_SIZES.map(p => (
                        <button
                          key={p.value}
                          onClick={() => cfg({ paperSize: p.value as InvoiceConfig["paperSize"] })}
                          className={`py-2 px-2 rounded-lg border text-xs transition-all ${config.paperSize === p.value ? "border-primary bg-primary/10 text-primary" : "border-border/30 text-foreground/70 hover:border-primary/40"}`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <SectionTitle icon={FileText} title="نص مخصص" />
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">نص الرأسية (اختياري)</label>
                        <textarea
                          rows={2}
                          value={config.customHeader}
                          onChange={e => cfg({ customHeader: e.target.value })}
                          placeholder="نص يظهر تحت معلومات الشركة..."
                          className="w-full bg-background border border-border/40 rounded px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">نص التذييل</label>
                        <textarea
                          rows={2}
                          value={config.customFooter}
                          onChange={e => cfg({ customFooter: e.target.value })}
                          placeholder="شكراً لتعاملكم معنا..."
                          className="w-full bg-background border border-border/40 rounded px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <SectionTitle icon={Eye} title="حجم المعاينة" />
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0.3}
                        max={1}
                        step={0.05}
                        value={previewScale}
                        onChange={e => setPreviewScale(parseFloat(e.target.value))}
                        className="flex-1 accent-primary"
                      />
                      <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(previewScale * 100)}%</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right Preview ── */}
        <div className="flex-1 min-w-0">
          <div className="bg-muted/20 border border-border/20 rounded-xl overflow-auto" style={{ minHeight: 580 }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/20">
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-2">
                <Eye className="w-3.5 h-3.5" />
                معاينة مباشرة
              </span>
              <span className="text-[11px] text-muted-foreground">
                {config.paperSize === "a4" ? "A4 · 595×842" : config.paperSize === "a5" ? "A5 · 420×595" : "Thermal · 226px"}
              </span>
            </div>
            <div className="p-6 flex justify-center">
              <div
                style={{
                  transform: `scale(${previewScale})`,
                  transformOrigin: "top center",
                  width: 595,
                  marginBottom: `calc((${previewScale} - 1) * 792px)`,
                }}
              >
                <InvoicePreview cfg={config} settings={settings} />
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="mt-3 bg-primary/5 border border-primary/20 rounded-xl p-4 text-sm text-foreground/70 space-y-1">
            <p className="font-semibold text-primary text-xs">كيفية الربط بالفواتير</p>
            <p className="text-xs">بعد الحفظ، سيتم تطبيق هذا القالب تلقائياً عند طباعة أي فاتورة مبيعات من قسم <strong>فواتير المبيعات</strong>. يُعدّ القالب المحفوظ افتراضياً هو الذي يظهر عند الطباعة.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
