"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Save, Eye, Printer, Upload, ChevronDown, ChevronUp,
  ArrowUp, ArrowDown, Download, RefreshCw, Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, compressImageFile } from "./_lib";
import { useToast } from "@/hooks/use-toast";
import {
  type InvoiceType,
  type InvoiceTemplateConfig,
  type ColumnDef,
  type PresetName,
  getDefaultConfig,
  generateInvoicePrintHTML,
  SAMPLE_DATA,
  PRESET_OVERRIDES,
  DEFAULT_COLUMNS,
} from "@/lib/invoice-print";

// ─── Types ────────────────────────────────────────────────────────────────────
type DBTemplate = {
  id: number;
  name: string;
  type: string;
  paperSize: string;
  isDefault: number;
  config: Record<string, unknown>;
  createdAt: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const TABS: { type: InvoiceType; label: string }[] = [
  { type: "sales",    label: "فاتورة المبيعات"  },
  { type: "purchase", label: "فاتورة الشراء"    },
  { type: "pos",      label: "فاتورة POS"       },
  { type: "delivery", label: "فاتورة التوصيل"   },
];

const PAPER_LABELS: Record<string, string> = {
  a4:         "A4 (210×297mm)",
  a5:         "A5 (148×210mm)",
  thermal80:  "حراري 80mm",
  thermal58:  "حراري 58mm",
};

const FONT_OPTIONS = ["Cairo", "Tajawal", "Arial", "Noto Kufi Arabic"];

const inp = "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50";

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function PrintDesignerPage() {
  const [activeTab, setActiveTab] = useState<InvoiceType>("sales");

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">مصمم الفاتورة</h1>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 border-b border-border/30">
        {TABS.map(t => (
          <button
            key={t.type}
            onClick={() => setActiveTab(t.type)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
              ${activeTab === t.type
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* One panel per type — re-mounts when type changes */}
      <DesignerPanel key={activeTab} type={activeTab} />
    </div>
  );
}

// ─── Designer Panel (one per invoice type) ─────────────────────────────────────
function DesignerPanel({ type }: { type: InvoiceType }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [config, setConfig] = useState<InvoiceTemplateConfig>(getDefaultConfig(type));
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  // Load existing template from DB
  const { data: templates, isLoading } = useQuery<DBTemplate[]>({
    queryKey: ["admin", "print-templates", type],
    queryFn: () => adminFetch<DBTemplate[]>(`/admin/print-templates?type=${type}`),
  });

  useEffect(() => {
    if (!templates) return;
    const tpl = templates.find(t => t.isDefault === 1) ?? templates[0];
    if (tpl) {
      setTemplateId(tpl.id);
      setConfig({ ...getDefaultConfig(type), ...(tpl.config as Partial<InvoiceTemplateConfig>) });
    } else {
      setTemplateId(null);
      setConfig(getDefaultConfig(type));
    }
    setDirty(false);
  }, [templates, type]);

  const updateConfig = useCallback(<K extends keyof InvoiceTemplateConfig>(
    key: K,
    value: InvoiceTemplateConfig[K]
  ) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  // Save mutation
  const saveMut = useMutation({
    mutationFn: async (cfg: InvoiceTemplateConfig) => {
      if (templateId) {
        return adminFetch<DBTemplate>(`/admin/print-templates/${templateId}`, {
          method: "PATCH",
          body: JSON.stringify({ config: cfg }),
        });
      } else {
        const typeLabels: Record<InvoiceType, string> = {
          sales: "فاتورة مبيعات", purchase: "فاتورة مشتريات",
          pos: "فاتورة POS", delivery: "فاتورة توصيل",
        };
        return adminFetch<DBTemplate>("/admin/print-templates", {
          method: "POST",
          body: JSON.stringify({
            name: typeLabels[type],
            type,
            paperSize: cfg.paperSize,
            isDefault: 1,
            config: cfg,
          }),
        });
      }
    },
    onSuccess: (tpl) => {
      setTemplateId(tpl.id);
      qc.invalidateQueries({ queryKey: ["admin", "print-templates"] });
      toast({ title: "✅ تم حفظ التصميم" });
      setDirty(false);
    },
    onError: (e: any) => toast({ title: "خطأ في الحفظ", description: e.message, variant: "destructive" }),
  });

  function applyPreset(preset: PresetName) {
    setConfig(prev => ({ ...prev, ...PRESET_OVERRIDES[preset] }));
    setDirty(true);
    toast({ title: `تم تطبيق قالب "${preset}"` });
  }

  function resetToDefault() {
    setConfig(getDefaultConfig(type));
    setDirty(true);
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-template-${type}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        setConfig(prev => ({ ...prev, ...parsed }));
        setDirty(true);
        toast({ title: "تم استيراد التصميم" });
      } catch {
        toast({ title: "ملف JSON غير صالح", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleFullPreview() {
    const html = generateInvoicePrintHTML(config, SAMPLE_DATA[type], type);
    const win = window.open("", "_blank", "width=860,height=720");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function handleTestPrint() {
    const html = generateInvoicePrintHTML(config, SAMPLE_DATA[type], type, { autoPrint: true });
    const win = window.open("", "_blank", "width=860,height=720");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />;

  const previewHtml = generateInvoicePrintHTML(config, SAMPLE_DATA[type], type);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
      {/* ─── Settings panel (left) ─── */}
      <div className="xl:col-span-2 space-y-3 max-h-[calc(100vh-180px)] overflow-y-auto pr-1">

        {/* Action bar */}
        <div className="bg-card rounded-xl border border-border/30 p-3 flex flex-wrap items-center justify-between gap-2">
          <span className={`text-xs ${dirty ? "text-yellow-400" : "text-muted-foreground"}`}>
            {dirty ? "⬤ يوجد تغييرات غير محفوظة" : templateId ? "✓ محفوظ" : "قالب جديد"}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={resetToDefault} className="gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> إعادة تعيين
            </Button>
            <Button size="sm" onClick={() => saveMut.mutate(config)} disabled={saveMut.isPending} className="gap-1">
              <Save className="w-3.5 h-3.5" />
              {saveMut.isPending ? "..." : "حفظ"}
            </Button>
          </div>
        </div>

        {/* Presets */}
        <Section title="القوالب الجاهزة" icon={<Palette className="w-4 h-4" />}>
          <div className="grid grid-cols-2 gap-2">
            {(["classic", "modern", "simple", "professional"] as PresetName[]).map(p => (
              <button key={p} onClick={() => applyPreset(p)}
                className={`p-2.5 rounded-lg border text-sm font-medium transition-colors
                  ${config.templateStyle === p
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/40 hover:border-primary/50 text-muted-foreground hover:text-foreground"}`}>
                {p === "classic" ? "كلاسيك" : p === "modern" ? "مودرن" : p === "simple" ? "بسيط" : "احترافي"}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={exportJSON}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border/40 hover:border-primary/50 text-muted-foreground hover:text-foreground transition-colors">
              <Download className="w-3.5 h-3.5" /> تصدير JSON
            </button>
            <button onClick={() => importRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border/40 hover:border-primary/50 text-muted-foreground hover:text-foreground transition-colors">
              <Upload className="w-3.5 h-3.5" /> استيراد JSON
            </button>
            <input ref={importRef} type="file" accept=".json" onChange={importJSON} className="hidden" />
          </div>
        </Section>

        {/* Header settings */}
        <Section title="رأس الفاتورة" defaultOpen>
          <LogoField config={config} update={updateConfig} />
          <FieldRow label="اسم الشركة">
            <input value={config.companyName} onChange={e => updateConfig("companyName", e.target.value)} className={inp} />
          </FieldRow>
          <div className="grid grid-cols-2 gap-2">
            <FieldRow label="حجم الاسم">
              <input type="number" min={10} max={40} value={config.companyNameSize}
                onChange={e => updateConfig("companyNameSize", parseInt(e.target.value) || 20)} className={inp} />
            </FieldRow>
            <FieldRow label="لون الاسم">
              <ColorInput value={config.companyNameColor} onChange={v => updateConfig("companyNameColor", v)} />
            </FieldRow>
          </div>
          <FieldRow label="عنوان الفاتورة (العنوان)">
            <input value={config.headerText} onChange={e => updateConfig("headerText", e.target.value)} className={inp} />
          </FieldRow>
          <FieldRow label="العنوان">
            <input value={config.companyAddress} onChange={e => updateConfig("companyAddress", e.target.value)} className={inp} />
          </FieldRow>
          <div className="grid grid-cols-2 gap-2">
            <FieldRow label="الهاتف">
              <input value={config.companyPhone} onChange={e => updateConfig("companyPhone", e.target.value)} className={inp} dir="ltr" />
            </FieldRow>
            <FieldRow label="البريد">
              <input value={config.companyEmail} onChange={e => updateConfig("companyEmail", e.target.value)} className={inp} dir="ltr" />
            </FieldRow>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FieldRow label="الرقم الضريبي">
              <input value={config.taxNumber} onChange={e => updateConfig("taxNumber", e.target.value)} className={inp} />
            </FieldRow>
            <FieldRow label="السجل التجاري">
              <input value={config.tradeNumber} onChange={e => updateConfig("tradeNumber", e.target.value)} className={inp} />
            </FieldRow>
          </div>
          <FieldRow label="نص ترحيبي">
            <input value={config.welcomeText} onChange={e => updateConfig("welcomeText", e.target.value)} className={inp} placeholder="اختياري" />
          </FieldRow>
          <div className="flex gap-4 mt-1">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={config.showInvoiceNumber}
                onChange={e => updateConfig("showInvoiceNumber", e.target.checked)} className="accent-primary" />
              إظهار رقم الفاتورة
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={config.showDate}
                onChange={e => updateConfig("showDate", e.target.checked)} className="accent-primary" />
              إظهار التاريخ
            </label>
          </div>
        </Section>

        {/* Body / Table settings */}
        <Section title="جسم الفاتورة (الجدول)">
          <p className="text-xs text-muted-foreground mb-2">الأعمدة — فعّل/أوقف واضبط الترتيب:</p>
          <ColumnsEditor
            columns={config.columns}
            type={type}
            onChange={cols => { updateConfig("columns", cols); }}
          />
          <div className="grid grid-cols-2 gap-2 mt-3">
            <FieldRow label="خلفية رأس الجدول">
              <ColorInput value={config.tableHeaderBg} onChange={v => updateConfig("tableHeaderBg", v)} />
            </FieldRow>
            <FieldRow label="لون نص الرأس">
              <ColorInput value={config.tableHeaderColor} onChange={v => updateConfig("tableHeaderColor", v)} />
            </FieldRow>
          </div>
          <FieldRow label="حجم خط الجدول (px)">
            <input type="number" min={9} max={18} value={config.tableFontSize}
              onChange={e => updateConfig("tableFontSize", parseInt(e.target.value) || 13)} className={inp} />
          </FieldRow>
        </Section>

        {/* Footer settings */}
        <Section title="تذييل الفاتورة">
          <FieldRow label="نص الشكر">
            <input value={config.footerThankYou} onChange={e => updateConfig("footerThankYou", e.target.value)} className={inp} />
          </FieldRow>
          <FieldRow label="سياسة الإرجاع">
            <textarea value={config.footerReturnPolicy}
              onChange={e => updateConfig("footerReturnPolicy", e.target.value)}
              rows={2} className={`w-full ${inp}`} placeholder="اختياري" />
          </FieldRow>
          <FieldRow label="ملاحظات إضافية">
            <textarea value={config.footerNotes}
              onChange={e => updateConfig("footerNotes", e.target.value)}
              rows={2} className={`w-full ${inp}`} placeholder="اختياري" />
          </FieldRow>
        </Section>

        {/* General settings */}
        <Section title="الإعدادات العامة">
          <div className="grid grid-cols-2 gap-2">
            <FieldRow label="اتجاه الصفحة">
              <select value={config.direction} onChange={e => updateConfig("direction", e.target.value as "rtl" | "ltr")} className={inp}>
                <option value="rtl">عربي (RTL)</option>
                <option value="ltr">إنجليزي (LTR)</option>
              </select>
            </FieldRow>
            <FieldRow label="حجم الورق">
              <select value={config.paperSize}
                onChange={e => updateConfig("paperSize", e.target.value as InvoiceTemplateConfig["paperSize"])} className={inp}>
                {Object.entries(PAPER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </FieldRow>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FieldRow label="اللون الرئيسي">
              <ColorInput value={config.primaryColor} onChange={v => updateConfig("primaryColor", v)} />
            </FieldRow>
            <FieldRow label="نوع الخط">
              <select value={config.globalFont} onChange={e => updateConfig("globalFont", e.target.value)} className={inp}>
                {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </FieldRow>
          </div>
        </Section>
      </div>

      {/* ─── Preview panel (right) ─── */}
      <div className="xl:col-span-3 space-y-3">
        <div className="bg-card rounded-xl border border-border/30 p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">معاينة مباشرة</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleFullPreview} className="gap-1">
              <Eye className="w-4 h-4" /> معاينة كاملة
            </Button>
            <Button variant="outline" size="sm" onClick={handleTestPrint} className="gap-1">
              <Printer className="w-4 h-4" /> طباعة تجريبية
            </Button>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border/30 overflow-hidden"
          style={{ minHeight: 500 }}>
          <iframe
            srcDoc={previewHtml}
            title="معاينة الفاتورة"
            className="w-full"
            style={{ height: "calc(100vh - 260px)", minHeight: 480, border: "none" }}
            sandbox="allow-same-origin"
          />
        </div>
        <p className="text-xs text-muted-foreground text-center">
          البيانات في المعاينة تجريبية — عند الطباعة الفعلية تُستخدم البيانات الحقيقية
        </p>
      </div>
    </div>
  );
}

// ─── Logo field ────────────────────────────────────────────────────────────────
function LogoField({
  config,
  update,
}: {
  config: InvoiceTemplateConfig;
  update: <K extends keyof InvoiceTemplateConfig>(k: K, v: InvoiceTemplateConfig[K]) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFile(file, 400, 0.85);
      update("logoUrl", dataUrl);
      update("showLogo", true);
    } catch {
      toast({ title: "تعذّر رفع الشعار", variant: "destructive" });
    }
    e.target.value = "";
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={config.showLogo}
            onChange={e => update("showLogo", e.target.checked)} className="accent-primary" />
          إظهار الشعار
        </label>
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border/40 hover:border-primary/50 text-muted-foreground hover:text-foreground transition-colors">
          <Upload className="w-3.5 h-3.5" /> رفع شعار
        </button>
        {config.logoUrl && (
          <button onClick={() => update("logoUrl", "")}
            className="text-xs text-red-400 hover:text-red-300">حذف</button>
        )}
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      </div>
      {config.logoUrl && (
        <img src={config.logoUrl} alt="شعار" className="h-12 object-contain rounded" />
      )}
      {config.showLogo && (
        <div className="grid grid-cols-2 gap-2">
          <FieldRow label="حجم الشعار (px)">
            <input type="number" min={30} max={200} value={config.logoSize}
              onChange={e => update("logoSize", parseInt(e.target.value) || 80)} className={inp} />
          </FieldRow>
          <FieldRow label="موضع الشعار">
            <select value={config.logoPosition}
              onChange={e => update("logoPosition", e.target.value as InvoiceTemplateConfig["logoPosition"])} className={inp}>
              <option value="right">يمين</option>
              <option value="center">وسط</option>
              <option value="left">يسار</option>
            </select>
          </FieldRow>
        </div>
      )}
    </div>
  );
}

// ─── Columns editor ────────────────────────────────────────────────────────────
function ColumnsEditor({
  columns,
  type,
  onChange,
}: {
  columns: ColumnDef[];
  type: InvoiceType;
  onChange: (cols: ColumnDef[]) => void;
}) {
  // Merge with defaults to ensure all default columns are present
  const defaultCols = DEFAULT_COLUMNS[type];
  const merged: ColumnDef[] = defaultCols.map(def => {
    const existing = columns.find(c => c.key === def.key);
    return existing ? { ...def, ...existing } : { ...def };
  });
  // Include any extra cols from config not in defaults (custom cols)
  columns.forEach(c => {
    if (!merged.find(m => m.key === c.key)) merged.push(c);
  });
  const sorted = [...merged].sort((a, b) => a.order - b.order);

  function toggle(key: string) {
    const next = merged.map(c => c.key === key ? { ...c, show: !c.show } : c);
    onChange(next);
  }

  function move(key: string, dir: -1 | 1) {
    const arr = [...sorted];
    const idx = arr.findIndex(c => c.key === key);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= arr.length) return;
    const tmp = arr[idx].order;
    arr[idx] = { ...arr[idx], order: arr[swapIdx].order };
    arr[swapIdx] = { ...arr[swapIdx], order: tmp };
    onChange(arr);
  }

  return (
    <div className="space-y-1">
      {sorted.map((col, i) => (
        <div key={col.key}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-card border border-border/20">
          <input type="checkbox" checked={col.show} onChange={() => toggle(col.key)} className="accent-primary" />
          <span className="flex-1 text-sm">{col.label}</span>
          <span className="text-xs text-muted-foreground font-mono bg-background px-1.5 rounded">{col.key}</span>
          <div className="flex gap-0.5">
            <button onClick={() => move(col.key, -1)} disabled={i === 0}
              className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ArrowUp className="w-3 h-3" />
            </button>
            <button onClick={() => move(col.key, 1)} disabled={i === sorted.length - 1}
              className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ArrowDown className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Section accordion ─────────────────────────────────────────────────────────
function Section({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-background/50 transition-colors"
      >
        <span className="flex items-center gap-2">{icon}{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border/20">{children}</div>}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        className="h-9 w-12 rounded-lg border border-border/40 bg-background cursor-pointer shrink-0" />
      <input value={value} onChange={e => onChange(e.target.value)}
        className={`${inp} flex-1 font-mono text-xs`} dir="ltr" maxLength={7} />
    </div>
  );
}
