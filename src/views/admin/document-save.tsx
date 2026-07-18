import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, ScanText, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "./_lib";
import {
  extractFields, recognizeText, LOW_CONFIDENCE_THRESHOLD, OCR_LANGUAGES,
  type OcrLanguage,
} from "@/lib/document-ocr";
import type { Side } from "@/lib/a4-layout";

type SaveSource = { dataUrl: string; widthMm: number; heightMm: number };

/** Entities a scan may be attached to. */
const OWNER_TYPES: Array<{ value: string; label: string }> = [
  { value: "", label: "بدون ربط" },
  { value: "customer", label: "عميل" },
  { value: "staff", label: "موظف" },
  { value: "order", label: "طلب" },
  { value: "booking", label: "حجز" },
  { value: "graduation_order", label: "طلب تخرج" },
  { value: "printing_job", label: "عمل طباعة" },
];

const FIELD =
  "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function Field({
  label, value, onChange, ltr, type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ltr?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] text-muted-foreground mb-1">{label}</span>
      <input
        type={type}
        dir={ltr ? "ltr" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      />
    </label>
  );
}

/**
 * Optional persistence. Nothing is uploaded until the user presses save — the
 * scanner is print-first by design. Saved images go to a protected endpoint and
 * never receive a public URL.
 */
export default function DocumentSave({
  scans,
  pages = [],
  documentType,
  documentTypeLabel,
  prefill,
  onSaved,
}: {
  scans: Partial<Record<Side, SaveSource>>;
  /** Extra pages for multi-page documents, in display order. */
  pages?: Array<SaveSource & { widthPx?: number; heightPx?: number }>;
  documentType: string;
  documentTypeLabel: string;
  /** Owner carried over from a deep link (e.g. opened from a customer page). */
  prefill?: { ownerType?: string; ownerId?: string; ownerName?: string };
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const [ownerType, setOwnerType] = useState(prefill?.ownerType ?? "");
  const [ownerId, setOwnerId] = useState(prefill?.ownerId ?? "");
  const [ownerName, setOwnerName] = useState(prefill?.ownerName ?? "");
  const [notes, setNotes] = useState("");
  const [savedId, setSavedId] = useState<number | null>(null);

  // Document fields. When OCR runs it pre-fills these; the user always confirms
  // or corrects them here before anything is stored.
  const [fields, setFields] = useState({
    title: "", documentNumber: "", fullName: "", nationalId: "",
    passportNumber: "", phone: "", issueDate: "", expiryDate: "", tags: "",
  });
  const setField = (k: keyof typeof fields, v: string) => setFields((f) => ({ ...f, [k]: v }));

  // ── OCR ───────────────────────────────────────────────────────────────────
  const [ocrLangs, setOcrLangs] = useState<OcrLanguage[]>(["ara", "eng"]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrText, setOcrText] = useState("");
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [ocrFilled, setOcrFilled] = useState<string[]>([]);

  const firstImage = scans.front?.dataUrl ?? scans.back?.dataUrl ?? pages[0]?.dataUrl ?? null;

  /**
   * Reads the document and PRE-FILLS the form. Values are suggestions only —
   * they land in the same editable inputs the user would type into, and only
   * empty fields are touched so manual entry is never overwritten.
   */
  async function runOcr() {
    if (!firstImage) return;
    setOcrBusy(true);
    setOcrProgress(0);
    try {
      const result = await recognizeText(firstImage, ocrLangs, (p) =>
        setOcrProgress(Math.round(p.progress * 100)),
      );
      setOcrText(result.text);
      setOcrConfidence(result.confidence);

      const extracted = extractFields(result.text, documentType);
      const filled: string[] = [];
      setFields((prev) => {
        const next = { ...prev };
        for (const [key, value] of Object.entries(extracted)) {
          if (!value) continue;
          if (next[key as keyof typeof prev]) continue; // never overwrite the user
          next[key as keyof typeof prev] = String(value);
          filled.push(key);
        }
        return next;
      });
      setOcrFilled(filled);

      toast({
        title: filled.length ? `تم تعبئة ${filled.length} حقل` : "لم يُستخرج أي حقل",
        description: "راجع القيم وصحّحها قبل الحفظ — القراءة الآلية ليست مضمونة",
      });
    } catch (err: any) {
      toast({
        title: "تعذّر تشغيل القراءة الضوئية",
        description: err?.message ?? "تحقق من الاتصال — تُحمَّل بيانات اللغة عند أول استخدام",
        variant: "destructive",
      });
    } finally {
      setOcrBusy(false);
    }
  }

  function toggleLang(lang: OcrLanguage) {
    setOcrLangs((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang],
    );
  }

  const save = useMutation({
    mutationFn: () =>
      adminFetch<{ id: number }>("/admin/document-scanner", {
        method: "POST",
        body: JSON.stringify({
          documentType,
          ownerType: ownerType || null,
          ownerId: ownerId ? Number(ownerId) : null,
          ownerName: ownerName || null,
          notes: notes || null,
          frontImage: scans.front?.dataUrl ?? null,
          backImage: scans.back?.dataUrl ?? null,
          widthMm: scans.front?.widthMm ?? scans.back?.widthMm ?? null,
          heightMm: scans.front?.heightMm ?? scans.back?.heightMm ?? null,
          // Document fields — empty strings are sent as null, not "".
          title: fields.title || null,
          documentNumber: fields.documentNumber || null,
          fullName: fields.fullName || null,
          nationalId: fields.nationalId || null,
          passportNumber: fields.passportNumber || null,
          phone: fields.phone || null,
          issueDate: fields.issueDate || null,
          expiryDate: fields.expiryDate || null,
          tags: fields.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          // Stored so the document becomes searchable by its own text.
          ocrText: ocrText || null,
          ocrLanguage: ocrText ? ocrLangs.join("+") : null,
          pages: pages.map((p) => ({
            side: "page" as const,
            image: p.dataUrl,
            widthPx: p.widthPx ?? null,
            heightPx: p.heightPx ?? null,
            widthMm: p.widthMm ?? null,
            heightMm: p.heightMm ?? null,
          })),
        }),
      }),
    onSuccess: (res) => {
      setSavedId(res.id);
      toast({ title: "تم حفظ المستمسك", description: "محفوظ بمسار محمي — لا يوجد رابط عام" });
      onSaved?.();
    },
    onError: (err: any) =>
      toast({ title: "تعذر حفظ المستمسك", description: err?.message, variant: "destructive" }),
  });

  if (savedId) {
    return (
      <section className="bg-card rounded-xl border border-status-success/30 p-3 sm:p-4">
        <p className="text-sm text-status-success flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          تم حفظ المستمسك (رقم {savedId}) بمسار محمي — يتطلب عرضه صلاحية ويُسجَّل كل اطّلاع.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-foreground text-sm flex items-center gap-2">
          <Save className="w-4 h-4 text-primary" /> حفظ المستمسك (اختياري)
        </h2>
        <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" /> تخزين محمي بلا رابط عام
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        الطباعة لا تتطلب الحفظ. احفظ فقط إذا أردت الاحتفاظ بالمستمسك مرتبطاً بسجل في النظام.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="block text-xs text-muted-foreground mb-1.5">الربط بـ</span>
          <select value={ownerType} onChange={(e) => setOwnerType(e.target.value)} className={FIELD}>
            {OWNER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        {ownerType && (
          <>
            <label className="block">
              <span className="block text-xs text-muted-foreground mb-1.5">رقم السجل</span>
              <input
                type="number" dir="ltr" min={1}
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className="block text-xs text-muted-foreground mb-1.5">الاسم (للعرض)</span>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className={FIELD} />
            </label>
          </>
        )}
      </div>

      {/* OCR — pre-fills the fields below; every value stays editable. */}
      <div className="rounded-lg border border-border/20 bg-background/40 p-3 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <ScanText className="w-3.5 h-3.5 text-primary" /> قراءة ضوئية للنص (اختيارية)
          </p>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={ocrBusy || !firstImage || ocrLangs.length === 0}
            onClick={() => void runOcr()}
          >
            {ocrBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanText className="w-3.5 h-3.5" />}
            {ocrBusy ? `جارٍ القراءة ${ocrProgress}%` : "اقرأ المستمسك"}
          </Button>
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {OCR_LANGUAGES.map((l) => (
            <button
              key={l.value}
              type="button"
              onClick={() => toggleLang(l.value)}
              className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors ${
                ocrLangs.includes(l.value)
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border/30 text-muted-foreground hover:border-primary/30"
              }`}
              title={l.quality}
            >
              {l.label}
              <span className="opacity-70"> · {l.quality}</span>
            </button>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground">
          تُحمَّل بيانات اللغة عند أول استخدام (10–15 ميغابايت لكل لغة) وتُخزَّن في المتصفح.
          المعالجة كلها داخل جهازك — لا تُرسل الصورة لأي خادم.
        </p>

        {ocrConfidence !== null && (
          <div
            className={`rounded-lg border p-2 text-[11px] flex items-start gap-2 ${
              ocrConfidence < LOW_CONFIDENCE_THRESHOLD
                ? "border-status-warning/30 bg-status-warning/10 text-status-warning"
                : "border-border/30 text-muted-foreground"
            }`}
          >
            {ocrConfidence < LOW_CONFIDENCE_THRESHOLD && <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
            <span>
              ثقة القراءة {Math.round(ocrConfidence)}%
              {ocrConfidence < LOW_CONFIDENCE_THRESHOLD
                ? " — منخفضة، راجع كل حقل بدقة قبل الحفظ"
                : " — راجع الحقول قبل الحفظ على أي حال"}
            </span>
          </div>
        )}

        {ocrFilled.length > 0 && (
          <p className="text-[11px] text-primary">
            عُبّئت تلقائياً: {ocrFilled.length} حقل — كلها قابلة للتعديل أدناه.
          </p>
        )}

        {ocrText && (
          <details className="text-[11px]">
            <summary className="cursor-pointer text-muted-foreground">النص المستخرج كاملاً</summary>
            <textarea
              rows={5}
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              className={`${FIELD} mt-2 font-mono text-[11px]`}
            />
          </details>
        )}
      </div>

      {/* Document fields — used by search, expiry warnings and the dashboard. */}
      <div className="rounded-lg border border-border/20 bg-background/40 p-3 space-y-3">
        <p className="text-xs font-semibold text-foreground">بيانات المستمسك</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Field label="العنوان" value={fields.title} onChange={(v) => setField("title", v)} />
          <Field label="رقم المستمسك" value={fields.documentNumber} onChange={(v) => setField("documentNumber", v)} ltr />
          <Field label="الاسم الكامل" value={fields.fullName} onChange={(v) => setField("fullName", v)} />
          <Field label="الرقم الوطني" value={fields.nationalId} onChange={(v) => setField("nationalId", v)} ltr />
          <Field label="رقم الجواز" value={fields.passportNumber} onChange={(v) => setField("passportNumber", v)} ltr />
          <Field label="رقم الهاتف" value={fields.phone} onChange={(v) => setField("phone", v)} ltr />
          <Field label="تاريخ الإصدار" value={fields.issueDate} onChange={(v) => setField("issueDate", v)} type="date" />
          <Field label="تاريخ الانتهاء" value={fields.expiryDate} onChange={(v) => setField("expiryDate", v)} type="date" />
          <Field label="وسوم (بفاصلة)" value={fields.tags} onChange={(v) => setField("tags", v)} />
        </div>
        {fields.expiryDate && (
          <p className="text-[11px] text-muted-foreground">
            سيُنبّهك النظام قبل الانتهاء بـ 90 و30 و7 ويوم واحد.
          </p>
        )}
      </div>

      <label className="block">
        <span className="block text-xs text-muted-foreground mb-1.5">ملاحظات</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={FIELD} />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="gap-2"
          disabled={save.isPending || (!scans.front && !scans.back && pages.length === 0)}
          onClick={() => {
            if (!window.confirm(`سيتم حفظ صور «${documentTypeLabel}» على الخادم بمسار محمي. متابعة؟`)) return;
            save.mutate();
          }}
        >
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          حفظ المستمسك
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {[scans.front && "أمامي", scans.back && "خلفي"].filter(Boolean).join(" + ")} سيُحفظ
        </span>
      </div>
    </section>
  );
}
