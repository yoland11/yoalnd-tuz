import { useEffect, useState, type FormEvent } from "react";
import { Camera, CheckCircle2, Clock3, Loader2, RefreshCw, Send, Undo2, X, XCircle } from "lucide-react";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import { processImageFile } from "@/lib/image-tools";
import { money } from "./lib";

// Kosha staff expenses. Same fields as /admin/expenses; the server files each
// one through the same code path as the admin screen, so it appears in the
// admin expenses list and as a PENDING request in the main cash box. Nothing
// is paid until an administrator approves it ("منفّذ").

type ExpenseCategory = { id: number; name: string };

type StaffExpense = {
  key: string;
  date: string | null;
  name: string | null;
  amount: number;
  categoryName: string | null;
  paymentMethod: string;
  notes: string | null;
  receiptImage: string | null;
  status: string;
  transactionNo: string | null;
  executedAt: string | null;
  rejectionReason: string | null;
  createdAt: string | null;
};

const PAYMENT_METHODS = [
  { value: "cash", label: "نقد" },
  { value: "pos", label: "بطاقة / POS" },
  { value: "transfer", label: "تحويل" },
];

const STATUS: Record<string, { label: string; className: string; icon: typeof Clock3 }> = {
  draft: { label: "مسودة", className: "bg-muted text-muted-foreground", icon: Clock3 },
  pending: { label: "بانتظار الموافقة", className: "bg-status-warning/15 text-status-warning", icon: Clock3 },
  approved: { label: "معتمد — بانتظار الصرف", className: "bg-status-warning/15 text-status-warning", icon: Clock3 },
  executed: { label: "منفّذ — انصرف", className: "bg-status-success/15 text-status-success", icon: CheckCircle2 },
  rejected: { label: "مرفوض", className: "bg-status-danger/15 text-status-danger", icon: XCircle },
  reversed: { label: "معكوس", className: "bg-muted text-muted-foreground", icon: Undo2 },
};

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const today = () => new Date().toISOString().slice(0, 10);

function normalizeAmountInput(value: string): string {
  const latin = value.replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
  return latin.replace(/[^0-9.]/g, "");
}

function formatDateTime(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "short", timeStyle: "short" });
}

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";

export default function StaffExpenseRequests() {
  const bookingId = Number(new URLSearchParams(window.location.search).get("booking") || 0) || null;
  const blank = () => ({ date: today(), name: "", categoryId: "", amount: "", paymentMethod: "cash", notes: "", receiptImage: "" });
  const [form, setForm] = useState(blank);
  const [categories, setCategories] = useState<ExpenseCategory[] | null>(null);
  const [categoriesError, setCategoriesError] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [sentMessage, setSentMessage] = useState("");
  const [rows, setRows] = useState<StaffExpense[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    adminFetch<{ data: ExpenseCategory[] }>("/staff/koshas/expense-categories")
      .then((result) => { if (active) setCategories(result.data); })
      .catch((error) => { if (active) setCategoriesError(apiErrorMessage(error)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoadError("");
    adminFetch<{ data: StaffExpense[] }>("/staff/koshas/expense-requests")
      .then((result) => { if (active) setRows(result.data); })
      .catch((error) => { if (active) setLoadError(apiErrorMessage(error)); });
    return () => { active = false; };
  }, [reloadKey]);

  // Statuses change when an administrator acts, so refresh while open.
  useEffect(() => {
    const timer = window.setInterval(() => setReloadKey((key) => key + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const set = (key: keyof ReturnType<typeof blank>, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const numericAmount = Number(form.amount);
  const valid =
    Boolean(form.date) &&
    Boolean(form.categoryId) &&
    Number.isFinite(numericAmount) &&
    numericAmount > 0 &&
    form.name.trim().length >= 2;

  async function pickReceipt(file: File | undefined) {
    if (!file) return;
    setImageBusy(true);
    setFormError("");
    try {
      set("receiptImage", await processImageFile(file, { maxSize: 1600, quality: 0.82 }));
    } catch (error) {
      setFormError(apiErrorMessage(error, "تعذر قراءة صورة الإيصال"));
    } finally {
      setImageBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || submitting || imageBusy) return;
    setSubmitting(true);
    setFormError("");
    setSentMessage("");
    try {
      const result = await adminFetch<{ duplicate?: boolean }>("/staff/koshas/expense-requests", {
        method: "POST",
        body: JSON.stringify({
          date: form.date,
          name: form.name.trim(),
          categoryId: Number(form.categoryId),
          amount: numericAmount,
          paymentMethod: form.paymentMethod,
          notes: form.notes.trim() || null,
          receiptImage: form.receiptImage || null,
          bookingId,
        }),
      });
      setForm(blank());
      setSentMessage(
        result?.duplicate
          ? "هذا المصروف مسجّل قبل قليل ولم يُكرَّر."
          : "تم تسجيل المصروف وإرساله للإدارة. ما ينصرف من الصندوق قبل الموافقة.",
      );
      setReloadKey((key) => key + 1);
    } catch (error) {
      setFormError(apiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-bold">إضافة مصروف</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          يظهر المصروف في مصاريف الإدارة ويبقى معلّقاً، وما ينصرف من الصندوق قبل موافقة المدير.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-4">
        {bookingId ? (
          <div className="rounded-lg bg-primary/10 px-3 py-2 text-xs font-bold text-primary">
            مرتبط بالحجز رقم {bookingId}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">التاريخ *</span>
            <input type="date" value={form.date} onChange={(event) => set("date", event.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">طريقة الدفع</span>
            <select value={form.paymentMethod} onChange={(event) => set("paymentMethod", event.target.value)} className={inputClass}>
              {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">عنوان المصروف *</span>
          <input
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            maxLength={200}
            placeholder="مثلاً: شراء ورد طبيعي للكوشة"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">التصنيف *</span>
          {categoriesError ? (
            <p role="alert" className="text-sm text-status-danger">تعذر تحميل التصنيفات: {categoriesError}</p>
          ) : (
            <select
              value={form.categoryId}
              onChange={(event) => set("categoryId", event.target.value)}
              disabled={categories === null}
              className={inputClass}
            >
              <option value="">{categories === null ? "جارٍ تحميل التصنيفات..." : "اختر التصنيف"}</option>
              {(categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">المبلغ (دينار) *</span>
          <input
            value={form.amount}
            onChange={(event) => set("amount", normalizeAmountInput(event.target.value))}
            inputMode="decimal"
            placeholder="25000"
            dir="ltr"
            className={`${inputClass} text-lg font-bold`}
          />
          {numericAmount > 0 ? <span className="mt-1 block text-xs text-muted-foreground">{money(numericAmount)}</span> : null}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">ملاحظات (اختياري)</span>
          <textarea
            value={form.notes}
            onChange={(event) => set("notes", event.target.value)}
            maxLength={1000}
            className="min-h-16 w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
          />
        </label>
        <div>
          <span className="mb-1 block text-xs text-muted-foreground">صورة الإيصال (اختياري)</span>
          {form.receiptImage ? (
            <div className="relative inline-block">
              <img src={form.receiptImage} alt="صورة الإيصال" className="h-24 w-24 rounded-lg border border-border object-cover" />
              <button
                type="button"
                onClick={() => set("receiptImage", "")}
                aria-label="حذف صورة الإيصال"
                className="absolute -top-2 -left-2 grid h-6 w-6 place-items-center rounded-full bg-status-danger text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-primary">
              {imageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              تصوير أو اختيار الإيصال
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => { void pickReceipt(event.target.files?.[0]); event.target.value = ""; }}
              />
            </label>
          )}
        </div>
        {formError ? <p role="alert" className="text-sm text-status-danger">{formError}</p> : null}
        {sentMessage ? <p className="text-sm text-status-success">{sentMessage}</p> : null}
        <button
          type="submit"
          disabled={!valid || submitting || imageBusy}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          إضافة المصروف
        </button>
      </form>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold">مصاريفي</h2>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="inline-flex items-center gap-1 text-xs font-bold text-primary">
            <RefreshCw className="h-3.5 w-3.5" /> تحديث
          </button>
        </div>
        {loadError ? (
          <div role="alert" className="rounded-xl border border-status-danger/30 bg-status-danger/10 p-4 text-center text-sm text-status-danger">
            تعذر تحميل مصاريفك: {loadError}
          </div>
        ) : rows === null ? (
          <div className="p-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" /></div>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">ما عندك مصاريف مسجّلة بعد.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => {
              const status = STATUS[row.status] ?? { label: row.status, className: "bg-muted text-muted-foreground", icon: Clock3 };
              const StatusIcon = status.icon;
              return (
                <div key={row.key} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold">{money(row.amount)}</div>
                      <div className="break-words text-sm">{row.name}</div>
                      {row.categoryName ? <div className="text-xs text-muted-foreground">{row.categoryName}</div> : null}
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${status.className}`}>
                      <StatusIcon className="h-3.5 w-3.5" />
                      {status.label}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    {row.transactionNo ? <><span dir="ltr">{row.transactionNo}</span> · </> : null}
                    {row.date || formatDateTime(row.createdAt)}
                    {row.status === "executed" && row.executedAt ? ` · انصرف ${formatDateTime(row.executedAt)}` : ""}
                    {row.receiptImage ? <> · <a href={row.receiptImage} target="_blank" rel="noreferrer" className="text-primary underline">الإيصال</a></> : null}
                  </div>
                  {row.status === "rejected" && row.rejectionReason ? (
                    <div className="mt-1 text-xs text-status-danger">سبب الرفض: {row.rejectionReason}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
