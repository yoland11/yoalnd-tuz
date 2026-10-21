import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, CalendarCheck, ClipboardCheck, Loader2, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage } from "./_lib";

/** Quantity fields returned by the booking assets API for a quantity-based asset. */
export type QuantityBookingTarget = {
  productId: number;
  custodyId?:number|null;
  trackingMode?:"individual"|"quantity";
  name: string;
  unit?: string | null;
  /** Units this booking can hold in total for its date (other bookings excluded). */
  available?: number;
  inWarehouse?: number;
  quantity?: number;
  reserved?: number;
  prepared?: number;
  checkedOutTotal?: number;
  outstanding?: number;
  returnedGood?: number;
  damaged?: number;
  missing?: number;
  stage?: string;
};

type Mode = "reserve" | "pick" | "checkout" | "return";

const MODES: Array<{ value: Mode; label: string; icon: any }> = [
  { value: "reserve", label: "حجز", icon: CalendarCheck },
  { value: "pick", label: "تجهيز", icon: PackageCheck },
  { value: "checkout", label: "إخراج", icon: ArrowUpFromLine },
  { value: "return", label: "إرجاع", icon: ArrowDownToLine },
];

function newRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const n = (value: unknown) => Number(value ?? 0).toLocaleString("ar-IQ-u-nu-latn");

export function QuantityBookingAssetDialog({
  endpoint,
  target,
  initialMode,
  onClose,
  onDone,
  scannedCode,
  allowedModes,
}: {
  /** The booking assets endpoint, e.g. /admin/booking-operations/kosha/125/assets */
  endpoint: string;
  target: QuantityBookingTarget | null;
  initialMode?: Mode;
  onClose: () => void;
  onDone: () => void;
  scannedCode?: string;
  allowedModes?: Mode[];
}) {
  const { toast } = useToast();
  const unit = target?.unit || "قطعة";
  const outstanding = Number(target?.outstanding ?? 0);
  const reserved = Number(target?.reserved ?? 0);
  const checkedOut = Number(target?.checkedOutTotal ?? 0);
  const defaultMode: Mode = initialMode ?? (outstanding > 0 ? "return" : reserved > checkedOut ? "checkout" : "reserve");
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [requestId, setRequestId] = useState(newRequestId);
  const [form, setForm] = useState({ quantity: "", good: "", damaged: "", missing: "", description: "", estimatedCost: "", managerApproval: false, vehicle: "", note: "" });

  useEffect(() => {
    if (!target) return;
    setMode(defaultMode);
    setRequestId(newRequestId());
    setForm({
      quantity: String(
        defaultMode === "reserve"
          ? Math.max(1, Number(target.quantity ?? target.reserved ?? 1))
          : defaultMode === "checkout"
            ? Math.max(1, reserved - checkedOut)
            : "",
      ),
      good: defaultMode === "return" ? String(outstanding) : "",
      damaged: "",
      missing: "",
      description: "",
      estimatedCost: "",
      managerApproval: false,
      vehicle: "",
      note: "",
    });
    // Every opening is a new request; a retry inside one opening reuses its id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const action = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch<{ ok: boolean; replayed?: boolean; warning?: string | null }>(endpoint, {
        method: "POST",
        body: JSON.stringify({ ...payload, productId: target?.productId, custodyId:target?.custodyId??undefined, requestId, confirmation: true, scannedCode }),
      }),
    onSuccess: (result) => {
      toast({
        title: result.replayed ? "تم تنفيذ هذا الإجراء مسبقاً" : "تم تحديث كمية الأصل",
        description: result.replayed ? "لم تُسجل حركة مكررة." : result.warning ?? undefined,
      });
      onDone();
      onClose();
    },
    onError: (error) => {
      // Keep the request id: a retry after a timeout that did commit is replayed,
      // and a rejected attempt committed nothing, so the same id stays safe.
      toast({ title: "تعذّر تنفيذ الإجراء", description: apiErrorMessage(error), variant: "destructive" });
    },
  });

  function submit() {
    const quantity = Math.floor(Number(form.quantity) || 0);
    if (mode === "return") {
      const good = Math.floor(Number(form.good) || 0);
      const damaged = Math.floor(Number(form.damaged) || 0);
      const missing = Math.floor(Number(form.missing) || 0);
      if (good + damaged + missing <= 0) { toast({ title: "أدخل كمية الإرجاع", variant: "destructive" }); return; }
      if (good + damaged + missing > outstanding)
        { toast({ title: "الكمية أكبر من الخارج", description: `الخارج حالياً ${outstanding} ${unit}`, variant: "destructive" }); return; }
      if ((damaged || missing) && !form.description.trim()) { toast({ title: "اكتب وصف التلف أو النقص", variant: "destructive" }); return; }
      if (missing && !form.managerApproval) { toast({ title: "تسجيل النقص يتطلب اعتماد المدير", variant: "destructive" }); return; }
      action.mutate({
        mode: "return",
        quantity: good + damaged + missing,
        goodQuantity: good,
        damagedQuantity: damaged,
        missingQuantity: missing,
        problem: missing ? "missing" : damaged ? "damaged" : "none",
        description: form.description.trim() || undefined,
        estimatedCost: Number(form.estimatedCost || 0),
        managerApproval: form.managerApproval,
        photoUrls: [],
      });
      return;
    }
    if (quantity <= 0) { toast({ title: "أدخل كمية صحيحة", variant: "destructive" }); return; }
    action.mutate({
      mode,
      quantity,
      vehicle: mode === "checkout" ? form.vehicle.trim() || undefined : undefined,
      note: mode === "checkout" ? form.note.trim() || undefined : undefined,
    });
  }

  const returnTotal = (Number(form.good) || 0) + (Number(form.damaged) || 0) + (Number(form.missing) || 0);
  const inputClass = "mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm";

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && !action.isPending && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{target?.name ?? ""}</DialogTitle>
          <DialogDescription>{target?.trackingMode==="individual"?"إرجاع الأصل إلى عهدته الأصلية؛ تُراجع هوية الصرف وحالة الإرجاع قبل الحفظ.":"أصل متعدد الكمية — أدخل الكمية بدلاً من مسح كل قطعة. يتحقق النظام من التوفر في تاريخ الحجز قبل الحفظ."}</DialogDescription>
        </DialogHeader>
        {target ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-6">
              {[
                ["المتاح للحجز", target.available],
                ["المحجوز", target.reserved],
                ["المجهّز", target.prepared],
                ["الخارج", target.outstanding],
                ["مرتجع سليم", target.returnedGood],
                ["تالف / مفقود", Number(target.damaged ?? 0) + Number(target.missing ?? 0)],
              ].filter(([label])=>!(allowedModes?.length===1&&allowedModes[0]==="return")||["الخارج","مرتجع سليم","تالف / مفقود"].includes(String(label))).map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-border/40 bg-background/60 p-2">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="font-bold tabular-nums">{n(value)}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="نوع الإجراء">
              {MODES.filter(item=>!allowedModes||allowedModes.includes(item.value)).map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={mode === value ? "default" : "outline"}
                  className="gap-1"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => {
                    setMode(value);
                    setRequestId(newRequestId());
                  }}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </Button>
              ))}
            </div>
            {mode === "return" ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">الخارج حالياً {n(outstanding)} {unit}. يجب أن يُحسب كل جزء: سليم يعود للمستودع، تالف يذهب لإجراءات التلف، مفقود يتطلب اعتماد المدير.</p>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-xs">سليم
                    <input type="number" min={0} inputMode="numeric" value={form.good} onChange={(event) => setForm({ ...form, good: event.target.value })} className={inputClass} />
                  </label>
                  <label className="block text-xs">تالف
                    <input type="number" min={0} inputMode="numeric" value={form.damaged} onChange={(event) => setForm({ ...form, damaged: event.target.value })} className={inputClass} />
                  </label>
                  <label className="block text-xs">مفقود
                    <input type="number" min={0} inputMode="numeric" value={form.missing} onChange={(event) => setForm({ ...form, missing: event.target.value })} className={inputClass} />
                  </label>
                </div>
                <p className={`text-xs ${returnTotal > outstanding ? "text-red-600" : "text-muted-foreground"}`}>
                  المجموع {n(returnTotal)} من {n(outstanding)} · سيبقى خارجاً {n(Math.max(0, outstanding - returnTotal))} {unit}
                </p>
                {(Number(form.damaged) || 0) + (Number(form.missing) || 0) > 0 ? (
                  <>
                    <label className="block text-xs">وصف التلف أو النقص *
                      <textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={inputClass} />
                    </label>
                    <label className="block text-xs">التكلفة التقديرية
                      <input type="number" min={0} value={form.estimatedCost} onChange={(event) => setForm({ ...form, estimatedCost: event.target.value })} className={inputClass} />
                    </label>
                    {(Number(form.missing) || 0) > 0 ? (
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={form.managerApproval} onChange={(event) => setForm({ ...form, managerApproval: event.target.checked })} /> اعتماد المدير على تسجيل النقص
                      </label>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs">
                  {mode === "reserve" ? "الكمية المطلوب حجزها لهذا الحجز" : mode === "pick" ? "الكمية المجهزة" : "الكمية الخارجة الآن"} ({unit})
                  <input type="number" min={1} inputMode="numeric" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className={inputClass} />
                </label>
                <p className="text-xs text-muted-foreground">
                  {mode === "reserve"
                    ? `الحجز يحدد إجمالي ما يحتاجه هذا الحجز (المتاح في تاريخه ${n(target.available)} ${unit}).`
                    : mode === "pick"
                      ? `لا يتجاوز المحجوز (${n(reserved)} ${unit}).`
                      : `يُخصم من المستودع${target.inWarehouse != null ? ` (فيه الآن ${n(target.inWarehouse)} ${unit})` : ""}؛ ما يتجاوز المحجوز يُحجز تلقائياً إن توفر.`}
                </p>
                {mode === "checkout" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs">المركبة (اختياري)
                      <input value={form.vehicle} onChange={(event) => setForm({ ...form, vehicle: event.target.value })} className={inputClass} />
                    </label>
                    <label className="block text-xs">ملاحظات
                      <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} className={inputClass} />
                    </label>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={action.isPending}>إلغاء</Button>
          <Button onClick={submit} disabled={action.isPending} className="gap-1">
            {action.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />} تأكيد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
