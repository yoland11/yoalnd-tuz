import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "./_lib";
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

/**
 * Optional persistence. Nothing is uploaded until the user presses save — the
 * scanner is print-first by design. Saved images go to a protected endpoint and
 * never receive a public URL.
 */
export default function DocumentSave({
  scans,
  documentType,
  documentTypeLabel,
  prefill,
  onSaved,
}: {
  scans: Partial<Record<Side, SaveSource>>;
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

      <label className="block">
        <span className="block text-xs text-muted-foreground mb-1.5">ملاحظات</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={FIELD} />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="gap-2"
          disabled={save.isPending || (!scans.front && !scans.back)}
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
