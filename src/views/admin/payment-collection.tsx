import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CalendarClock, CheckCircle2, RefreshCw, Upload, WalletCards, X } from "lucide-react";
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
  overpaid: "مدفوع أكثر من المطلوب",
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
  onRepairInvoiceStatus?: () => void;
  compact?: boolean;
};

type CustomerLinkCandidate = {
  id: number;
  name: string;
  phone: string;
  customerCode: string | null;
  secondaryPhone: string | null;
  balance: number;
  matchMethod: "phone" | "account_phone" | "manual";
};

type InvoiceCustomerLinkPrecheck = {
  invoice: { id: number; invoiceNo: string; customerId: number | null; customerName: string; customerPhone: string | null; status: string };
  candidates: CustomerLinkCandidate[];
  resolution: "linked" | "missing_data" | "no_match" | "single_match" | "multiple_matches";
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
  onRepairInvoiceStatus,
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
    paid > total
      ? "text-status-warning"
      : remaining <= 0
      ? "text-status-success"
      : paid > 0
        ? "text-status-warning"
        : "text-status-danger";
  const effectivePaymentStatus =
    paid > total ? "overpaid" : remaining <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";

  return (
    <section className={`mt-3 rounded-xl border border-border/25 bg-background/35 ${compact ? "p-3" : "p-4"}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <WalletCards className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">ملخص الحساب</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sourceType === "sales_invoice" && onRepairInvoiceStatus ? (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onRepairInvoiceStatus}>
              <RefreshCw className="h-4 w-4" /> تحديث حالة الفاتورة
            </Button>
          ) : null}
          {remaining > 0 && canCollect ? (
            <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
              <Banknote className="h-4 w-4" /> تحصيل دفعة
            </Button>
          ) : remaining <= 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-success">
              <CheckCircle2 className="h-4 w-4" /> {effectivePaymentStatus === "overpaid" ? "يوجد مبلغ زائد" : "الحساب مسدد"}
            </span>
          ) : null}
        </div>
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
  const linkPrecheck = useQuery<InvoiceCustomerLinkPrecheck>({
    queryKey: ["admin", "sales-invoice-customer-link", sourceId],
    queryFn: () => adminFetch(`/admin/sales-invoices/${sourceId}/customer-link`),
    enabled: sourceType === "sales_invoice",
    staleTime: 0,
  });

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
  const invalid = !Number.isFinite(numericAmount) || numericAmount <= 0 || (sourceType !== "sales_invoice" && numericAmount > remaining);
  const requiresCustomerLink = sourceType === "sales_invoice" && !linkPrecheck.isLoading && !linkPrecheck.data?.invoice.customerId;

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
          {sourceType === "sales_invoice" && linkPrecheck.isLoading ? (
            <div className="rounded-lg border border-border/30 bg-background/50 p-3 text-sm text-muted-foreground">جارٍ التحقق من ربط العميل…</div>
          ) : null}
          {requiresCustomerLink && linkPrecheck.data ? (
            <InvoiceCustomerLinker
              sourceId={sourceId}
              precheck={linkPrecheck.data}
              onLinked={() => {
                queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoice-customer-link", sourceId] });
                queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoice", sourceId] });
                queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoices"] });
                void linkPrecheck.refetch();
              }}
            />
          ) : null}
          {!requiresCustomerLink && !linkPrecheck.isLoading ? <>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">المبلغ</span>
            <input type="number" min="1" max={remaining} value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            {numericAmount > remaining ? <span className={`mt-1 block text-xs ${sourceType === "sales_invoice" ? "text-status-warning" : "text-destructive"}`}>{sourceType === "sales_invoice" ? "سيُسجل المبلغ الزائد وفق سياسة الحسابات." : "المبلغ أكبر من المتبقي"}</span> : null}
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
          </> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={collect.isPending}>إلغاء</Button>
          <Button onClick={() => collect.mutate()} disabled={collect.isPending || processingImage || invalid || requiresCustomerLink || linkPrecheck.isLoading}>
            {collect.isPending ? "جارٍ الحفظ..." : "حفظ الدفعة"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function InvoiceCustomerLinker({
  sourceId,
  precheck,
  onLinked,
}: {
  sourceId: number;
  precheck: InvoiceCustomerLinkPrecheck;
  onLinked: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState(precheck.invoice.customerName ?? "");
  const [phone, setPhone] = useState(precheck.invoice.customerPhone ?? "");
  const results = useQuery<{ candidates: CustomerLinkCandidate[] }>({
    queryKey: ["admin", "sales-invoice-customer-link-search", sourceId, search.trim()],
    queryFn: () => adminFetch(`/admin/sales-invoices/${sourceId}/customer-link/search?q=${encodeURIComponent(search.trim())}`),
    enabled: search.trim().length >= 2,
    staleTime: 15_000,
  });
  const link = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch(`/admin/sales-invoices/${sourceId}/customer-link`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast({ title: "تم ربط الفاتورة بالعميل بنجاح" });
      onLinked();
    },
    onError: (error) => toast({
      title: "تعذر ربط الفاتورة بالعميل",
      description: apiErrorMessage(error),
      variant: "destructive",
    }),
  });

  const candidateButton = (candidate: CustomerLinkCandidate) => (
    <button
      key={candidate.id}
      type="button"
      disabled={link.isPending}
      onClick={() => link.mutate({ action: "link", customerId: candidate.id, matchMethod: candidate.matchMethod })}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/30 bg-background/50 px-3 py-2.5 text-right transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-foreground">{candidate.name}</span>
        <span className="block text-xs text-muted-foreground" dir="ltr">{candidate.phone}{candidate.customerCode ? ` · ${candidate.customerCode}` : ""}</span>
      </span>
      <span className="shrink-0 text-xs font-medium text-status-warning">{formatCurrency(candidate.balance)}</span>
    </button>
  );

  return (
    <section className="space-y-3 rounded-xl border border-status-warning/35 bg-status-warning/5 p-3">
      <div>
        <h3 className="text-sm font-bold text-foreground">هذه الفاتورة غير مرتبطة بملف عميل</h3>
        <p className="mt-1 text-xs text-muted-foreground">يجب تأكيد العميل قبل تسجيل الدفعة وتخصيصها في الحسابات.</p>
      </div>
      {precheck.resolution === "single_match" ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-status-success">تم العثور على عميل مطابق برقم الهاتف</p>
          {precheck.candidates.map(candidateButton)}
        </div>
      ) : null}
      {precheck.resolution === "multiple_matches" ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-status-warning">اختر العميل الصحيح؛ لم يتم الربط تلقائياً.</p>
          {precheck.candidates.map(candidateButton)}
        </div>
      ) : null}
      {(precheck.resolution === "no_match" || precheck.resolution === "missing_data") && !showCreate ? (
        <p className="rounded-lg bg-background/50 p-2 text-xs text-muted-foreground">لم يتم العثور على عميل مطابق. ابحث يدوياً أو أنشئ عميلاً جديداً بعد التحقق من البيانات.</p>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setSearch((value) => value || precheck.invoice.customerPhone || precheck.invoice.customerName || "")}>البحث عن عميل</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate((value) => !value)}>إنشاء عميل جديد</Button>
        <Button type="button" variant="outline" size="sm" disabled={link.isPending} onClick={() => link.mutate({ action: "cash" })}>استخدام العميل النقدي</Button>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">بحث يدوي بالاسم أو الهاتف أو كود العميل</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" placeholder="ابدأ البحث…" />
      </label>
      {results.isFetching ? <p className="text-xs text-muted-foreground">جارٍ البحث…</p> : null}
      {results.data?.candidates?.length ? <div className="max-h-48 space-y-2 overflow-y-auto">{results.data.candidates.map(candidateButton)}</div> : null}
      {showCreate ? (
        <div className="space-y-2 rounded-lg border border-border/30 bg-background/40 p-3">
          <p className="text-xs font-semibold text-foreground">إنشاء عميل من بيانات الفاتورة</p>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="اسم العميل" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
          <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" dir="ltr" placeholder="07XXXXXXXXX" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
          <Button type="button" size="sm" disabled={link.isPending || !name.trim() || !phone.trim()} onClick={() => link.mutate({ action: "create", name, phone })}>إنشاء وربط العميل</Button>
        </div>
      ) : null}
    </section>
  );
}
