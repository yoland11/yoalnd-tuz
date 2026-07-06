import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CalendarClock, CheckCircle2, Upload, WalletCards, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  adminFetch,
  apiErrorMessage,
  compressImageFile,
  fetchAdminMe,
  formatCurrency,
  hasPerm,
} from "./_lib";

export type CollectionSourceType =
  | "order"
  | "service_order"
  | "sales_invoice"
  | "kosha_booking";

export type LastPayment = {
  amount: number;
  date: string;
  createdAt?: string;
  method: string;
  status: string;
  transactionNo?: string;
} | null;

const PAYMENT_METHODS = [
  { value: "cash", label: "نقدي" },
  { value: "transfer", label: "تحويل" },
  { value: "card", label: "بطاقة" },
] as const;

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: "مدفوع بالكامل",
  partial: "مدفوع جزئياً",
  unpaid: "غير مدفوع",
  pending: "بانتظار الاعتماد",
  executed: "معتمد",
};

const METHOD_LABELS: Record<string, string> = {
  cash: "نقدي",
  transfer: "تحويل",
  card: "بطاقة",
  pos: "بطاقة",
  paid: "نقدي",
  cod: "عند الاستلام",
};

type Props = {
  sourceType: CollectionSourceType;
  sourceId: number;
  total: number;
  discount?: number;
  paid: number;
  remaining: number;
  paymentStatus: string;
  lastPayment?: LastPayment;
  onCollected?: () => void;
  compact?: boolean;
};

export function AccountSummaryCard({
  sourceType,
  sourceId,
  total,
  discount = 0,
  paid,
  remaining,
  paymentStatus,
  lastPayment = null,
  onCollected,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const admin = useQuery({
    queryKey: ["admin", "me"],
    queryFn: () => fetchAdminMe(),
    staleTime: 60_000,
  });
  const canCollect = Boolean(
    admin.data &&
      (["admin", "manager", "accountant"].includes(admin.data.role) ||
        hasPerm(admin.data, "accounting")),
  );
  const statusTone =
    remaining <= 0
      ? "text-status-success"
      : paid > 0
        ? "text-status-warning"
        : "text-status-danger";
  const effectivePaymentStatus =
    remaining <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";

  return (
    <section className={`mt-3 rounded-xl border border-border/25 bg-background/35 ${compact ? "p-3" : "p-4"}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <WalletCards className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">ملخص الحساب</h3>
        </div>
        {remaining > 0 && canCollect ? (
          <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
            <Banknote className="h-4 w-4" /> تحصيل دفعة
          </Button>
        ) : remaining <= 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-success">
            <CheckCircle2 className="h-4 w-4" /> الحساب مسدد
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <SummaryValue label="الإجمالي" value={formatCurrency(total)} />
        <SummaryValue label="الخصم" value={formatCurrency(discount)} />
        <SummaryValue label="المدفوع" value={formatCurrency(paid)} tone="text-status-success" />
        <SummaryValue label="المتبقي" value={formatCurrency(remaining)} tone={statusTone} />
        <SummaryValue label="آخر دفعة" value={lastPayment ? formatCurrency(lastPayment.amount) : "—"} />
        <SummaryValue label="تاريخ الدفعة" value={lastPayment?.date || "—"} />
        <SummaryValue label="طريقة الدفع" value={lastPayment ? METHOD_LABELS[lastPayment.method] ?? lastPayment.method : "—"} />
        <SummaryValue
          label="حالة الدفع"
          value={PAYMENT_STATUS_LABELS[effectivePaymentStatus] ?? PAYMENT_STATUS_LABELS[paymentStatus] ?? paymentStatus}
          tone={statusTone}
        />
      </div>
      {open ? (
        <CollectPaymentDialog
          sourceType={sourceType}
          sourceId={sourceId}
          remaining={remaining}
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            onCollected?.();
          }}
        />
      ) : null}
    </section>
  );
}

function SummaryValue({ label, value, tone = "text-foreground" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/20 bg-card/70 p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-xs font-bold ${tone}`} title={value}>{value}</p>
    </div>
  );
}

function CollectPaymentDialog({
  sourceType,
  sourceId,
  remaining,
  onClose,
  onSuccess,
}: {
  sourceType: CollectionSourceType;
  sourceId: number;
  remaining: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(String(remaining));
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [receiptNo, setReceiptNo] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptImage, setReceiptImage] = useState("");
  const [processingImage, setProcessingImage] = useState(false);

  useEffect(() => setAmount(String(remaining)), [remaining]);

  const collect = useMutation({
    mutationFn: () =>
      adminFetch("/admin/collections", {
        method: "POST",
        body: JSON.stringify({
          sourceType,
          sourceId,
          amount: Number(amount),
          paymentMethod,
          receiptNo,
          notes,
          receiptImage,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "service-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "customers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "statement"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "master-cash"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "receipt-vouchers"] });
      toast({ title: "تم تسجيل الدفعة", description: "أُنشئ سند قبض وحركة مالية بانتظار الاعتماد حسب الصلاحيات." });
      onSuccess();
    },
    onError: (error) =>
      toast({
        title: "تعذر تسجيل الدفعة",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });

  async function selectReceipt(file?: File) {
    if (!file) return;
    setProcessingImage(true);
    try {
      setReceiptImage(await compressImageFile(file, 1400, 0.8));
    } catch (error) {
      toast({ title: "تعذر تجهيز صورة الوصل", description: apiErrorMessage(error), variant: "destructive" });
    } finally {
      setProcessingImage(false);
    }
  }

  const numericAmount = Number(amount);
  const invalid = !Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > remaining;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" dir="rtl">
      <div className="my-6 w-full max-w-lg rounded-xl border border-border/40 bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border/30 p-4">
          <div>
            <h2 className="font-bold text-foreground">تحصيل دفعة</h2>
            <p className="mt-1 text-xs text-muted-foreground">المتبقي الحالي: {formatCurrency(remaining)}</p>
          </div>
          <button type="button" onClick={onClose} disabled={collect.isPending} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-4">
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">المبلغ</span>
            <input type="number" min="1" max={remaining} value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            {numericAmount > remaining ? <span className="mt-1 block text-xs text-destructive">المبلغ أكبر من المتبقي</span> : null}
          </label>
          <div>
            <span className="mb-1 block text-xs text-muted-foreground">طريقة الدفع</span>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((method) => (
                <button key={method.value} type="button" onClick={() => setPaymentMethod(method.value)} className={`rounded-lg border px-3 py-2 text-sm ${paymentMethod === method.value ? "border-primary bg-primary/10 text-primary" : "border-border/30 text-muted-foreground"}`}>
                  {method.label}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">رقم الوصل</span>
            <input value={receiptNo} onChange={(event) => setReceiptNo(event.target.value)} placeholder="اختياري" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">ملاحظات</span>
            <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className="w-full resize-none rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-border/40 bg-background/50 p-3 text-sm">
            <span className="flex items-center gap-2"><Upload className="h-4 w-4 text-primary" />{receiptImage ? "تم تجهيز صورة الوصل" : "رفع صورة الوصل (اختياري)"}</span>
            <input type="file" accept="image/*" className="sr-only" onChange={(event) => selectReceipt(event.target.files?.[0])} />
            {processingImage ? <CalendarClock className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={collect.isPending}>إلغاء</Button>
          <Button onClick={() => collect.mutate()} disabled={collect.isPending || processingImage || invalid}>
            {collect.isPending ? "جارٍ الحفظ..." : "حفظ الدفعة"}
          </Button>
        </div>
      </div>
    </div>
  );
}
