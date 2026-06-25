import { useRef, useState } from "react";
import { Download, Upload, FileJson, FileText, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch } from "./_lib";

type EntityDef = { id: string; label: string };
const ENTITIES: EntityDef[] = [
  { id: "orders", label: "الطلبات" },
  { id: "order_items", label: "بنود الطلبات" },
  { id: "order_status_history", label: "تاريخ حالات الطلبات" },
  { id: "service_orders", label: "حجوزات الخدمات" },
  { id: "service_order_status_history", label: "تاريخ حالات الحجوزات" },
  { id: "products", label: "المنتجات (المخزون)" },
  { id: "categories", label: "الأقسام" },
  { id: "customers", label: "العملاء" },
  { id: "customer_reward_history", label: "سجل نقاط العملاء" },
  { id: "services", label: "الخدمات" },
  { id: "delivery_zones", label: "مناطق التوصيل" },
  { id: "gallery_items", label: "المعرض" },
  { id: "expense_categories", label: "أقسام المصروفات" },
  { id: "receipt_vouchers", label: "سندات القبض (حسابات)" },
  { id: "payment_vouchers", label: "سندات الصرف (حسابات)" },
  { id: "expenses", label: "المصروفات (حسابات)" },
];

const BASE = "";
function buildUrl(p: string) { return `${BASE}/api${p}`; }

async function downloadFile(url: string, fallbackName: string) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const blob = await r.blob();
  const cd = r.headers.get("content-disposition") ?? "";
  const m = cd.match(/filename="?([^";]+)"?/i);
  const name = m?.[1] ?? fallbackName;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export default function BackupPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<Record<string, { inserted: number; skipped: number; errors: number }> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function exportFull() {
    setError(null); setBusy("full");
    try { await downloadFile(buildUrl("/admin/backup/export"), "ajn-backup.json"); }
    catch (e: any) { setError(e?.message ?? "فشل التصدير"); }
    finally { setBusy(null); }
  }

  async function exportOne(entity: string, format: "json" | "csv") {
    setError(null); setBusy(`${entity}:${format}`);
    try { await downloadFile(buildUrl(`/admin/backup/export/${entity}?format=${format}`), `ajn-${entity}.${format}`); }
    catch (e: any) { setError(e?.message ?? "فشل التصدير"); }
    finally { setBusy(null); }
  }

  async function onImportFile(file: File) {
    setError(null); setImportReport(null);
    const ok = window.confirm(
      "هل أنت متأكد من استيراد البيانات؟\n\nسيتم إضافة السجلات الجديدة فقط — السجلات الموجودة بنفس المعرّف لن تتغيّر. ننصح بأخذ نسخة احتياطية قبل المتابعة.",
    );
    if (!ok) return;
    setBusy("import");
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const r = await adminFetch<{ ok: boolean; report: Record<string, { inserted: number; skipped: number; errors: number }> }>(
        "/admin/backup/import",
        { method: "POST", body: JSON.stringify({ confirm: "AJN-IMPORT-CONFIRMED", payload }) },
      );
      setImportReport(r.report);
    } catch (e: any) {
      setError(e?.message ?? "فشل الاستيراد — تأكد من صيغة الملف");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">النسخ الاحتياطي والتصدير</h1>
          <p className="text-sm text-muted-foreground mt-1">صدّر بياناتك (الطلبات، المنتجات، العملاء، الحسابات…) بصيغة JSON أو CSV، أو استورد نسخة سابقة.</p>
        </div>
        <Button onClick={exportFull} disabled={!!busy} className="gap-2">
          {busy === "full" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          نسخة احتياطية كاملة (JSON)
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-status-danger/30 bg-status-danger/10 p-3 text-status-danger text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      <section className="bg-card rounded-xl border border-border/30 p-6">
        <h2 className="font-semibold text-foreground mb-4">تصدير حسب الجدول</h2>
        <div className="grid gap-2">
          {ENTITIES.map(e => (
            <div key={e.id} className="flex items-center justify-between gap-3 bg-background/40 rounded-lg p-3 border border-border/20">
              <div className="text-sm text-foreground">{e.label}</div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => exportOne(e.id, "csv")} className="gap-1.5">
                  {busy === `${e.id}:csv` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} CSV
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => exportOne(e.id, "json")} className="gap-1.5">
                  {busy === `${e.id}:json` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileJson className="w-3.5 h-3.5" />} JSON
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-card rounded-xl border border-border/30 p-6">
        <h2 className="font-semibold text-foreground mb-2">استيراد نسخة احتياطية</h2>
        <p className="text-xs text-muted-foreground mb-4">
          ارفع ملف JSON ناتج من زر «نسخة احتياطية كاملة». السجلات الجديدة تُضاف، والموجودة بنفس المعرّف تُتجاهل تلقائياً.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={e => { const f = e.target.files?.[0]; if (f) onImportFile(f); }}
            className="text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
            disabled={!!busy}
          />
          {busy === "import" && <span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري الاستيراد…</span>}
        </div>

        {importReport && (
          <div className="mt-4 rounded-xl border border-status-success/30 bg-status-success/10 p-4">
            <div className="flex items-center gap-2 text-status-success text-sm font-semibold mb-3">
              <CheckCircle2 className="w-4 h-4" /> تم الاستيراد بنجاح
            </div>
            <div className="grid gap-1 text-xs">
              {Object.entries(importReport).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between bg-background/30 rounded px-2 py-1.5">
                  <span className="text-foreground">{ENTITIES.find(e => e.id === k)?.label ?? k}</span>
                  <span className="text-muted-foreground">
                    أُضيف: <span className="text-status-success">{v.inserted}</span> ·
                    تكرار: <span className="text-yellow-400">{v.skipped}</span> ·
                    أخطاء: <span className="text-status-danger">{v.errors}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="bg-card rounded-xl border border-border/30 p-6">
        <h2 className="font-semibold text-foreground mb-2 flex items-center gap-2">
          <Upload className="w-4 h-4 text-primary" /> ملاحظات
        </h2>
        <ul className="text-xs text-muted-foreground space-y-1.5 leading-7 list-disc pr-5">
          <li>ملفات CSV مفتوحة بأي برنامج جداول (Excel, Google Sheets) وتدعم العربية.</li>
          <li>الاستيراد لا يحذف أي شيء — يضيف فقط السجلات الجديدة.</li>
          <li>لمنع الالتباس، احتفظ بالنسخ الاحتياطية الأسبوعية في مكان آمن (سحابي أو خارجي).</li>
        </ul>
      </section>
    </div>
  );
}
