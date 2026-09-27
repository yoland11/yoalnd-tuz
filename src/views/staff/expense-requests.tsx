import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Clock3, Loader2, RefreshCw, Send, Undo2, XCircle } from "lucide-react";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import { money } from "./lib";

// Kosha staff "طلب مصروف". The server records each request as a PENDING
// financial transaction in the main cash box; nothing is paid out until the
// principal administrator approves it there, which executes it ("انصرف").

type ExpenseRequest = {
  id: number;
  transactionNo: string;
  amount: number;
  description: string | null;
  notes: string | null;
  bookingId: string | null;
  status: string;
  rejectionReason: string | null;
  executedAt: string | null;
  executedByName: string | null;
  reversedAt: string | null;
  createdAt: string | null;
};

const STATUS: Record<string, { label: string; className: string; icon: typeof Clock3 }> = {
  draft: { label: "مسودة", className: "bg-muted text-muted-foreground", icon: Clock3 },
  pending: { label: "بانتظار موافقة المدير", className: "bg-status-warning/15 text-status-warning", icon: Clock3 },
  approved: { label: "معتمد — بانتظار الصرف", className: "bg-status-warning/15 text-status-warning", icon: Clock3 },
  executed: { label: "انصرف", className: "bg-status-success/15 text-status-success", icon: CheckCircle2 },
  rejected: { label: "مرفوض", className: "bg-status-danger/15 text-status-danger", icon: XCircle },
  reversed: { label: "معكوس", className: "bg-muted text-muted-foreground", icon: Undo2 },
};

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function newRequestKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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

export default function StaffExpenseRequests() {
  const bookingId = Number(new URLSearchParams(window.location.search).get("booking") || 0) || null;
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  // Kept across failed attempts so a retry can never create a second request;
  // renewed only after a successful submission.
  const [requestKey, setRequestKey] = useState(newRequestKey);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [sentMessage, setSentMessage] = useState("");
  const [rows, setRows] = useState<ExpenseRequest[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadError("");
    adminFetch<{ data: ExpenseRequest[] }>("/staff/koshas/expense-requests")
      .then((result) => { if (active) setRows(result.data); })
      .catch((error) => { if (active) setLoadError(apiErrorMessage(error)); });
    return () => { active = false; };
  }, [reloadKey]);

  // Statuses change when the manager acts, so refresh while the page is open.
  useEffect(() => {
    const timer = window.setInterval(() => setReloadKey((key) => key + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const numericAmount = Number(amount);
  const valid = Number.isFinite(numericAmount) && numericAmount > 0 && description.trim().length >= 3;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setFormError("");
    setSentMessage("");
    try {
      await adminFetch("/staff/koshas/expense-requests", {
        method: "POST",
        body: JSON.stringify({
          amount: numericAmount,
          description: description.trim(),
          notes: notes.trim(),
          bookingId,
          requestKey,
        }),
      });
      setAmount("");
      setDescription("");
      setNotes("");
      setRequestKey(newRequestKey());
      setSentMessage("تم إرسال الطلب للمدير. ما ينصرف أي مبلغ قبل موافقته.");
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
        <h1 className="text-lg font-bold">طلب مصروف</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          يرسل الطلب للمدير، وما ينصرف أي مبلغ من الصندوق قبل موافقته.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-4">
        {bookingId ? (
          <div className="rounded-lg bg-primary/10 px-3 py-2 text-xs font-bold text-primary">
            مرتبط بالحجز رقم {bookingId}
          </div>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">تفاصيل المصروف *</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={400}
            placeholder="مثلاً: شراء ورد طبيعي لتنسيق الكوشة"
            className="min-h-20 w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">المبلغ (دينار) *</span>
          <input
            value={amount}
            onChange={(event) => setAmount(normalizeAmountInput(event.target.value))}
            inputMode="decimal"
            placeholder="25000"
            dir="ltr"
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-lg font-bold outline-none focus:border-primary"
          />
          {numericAmount > 0 ? (
            <span className="mt-1 block text-xs text-muted-foreground">{money(numericAmount)}</span>
          ) : null}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">ملاحظات (اختياري)</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={1000}
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          />
        </label>
        {formError ? <p role="alert" className="text-sm text-status-danger">{formError}</p> : null}
        {sentMessage ? <p className="text-sm text-status-success">{sentMessage}</p> : null}
        <button
          type="submit"
          disabled={!valid || submitting}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          إرسال للمدير
        </button>
      </form>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold">طلباتي</h2>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="inline-flex items-center gap-1 text-xs font-bold text-primary"
          >
            <RefreshCw className="h-3.5 w-3.5" /> تحديث
          </button>
        </div>
        {loadError ? (
          <div role="alert" className="rounded-xl border border-status-danger/30 bg-status-danger/10 p-4 text-center text-sm text-status-danger">
            تعذر تحميل طلباتك: {loadError}
          </div>
        ) : rows === null ? (
          <div className="p-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" /></div>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            ما عندك طلبات مصروف بعد.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => {
              const status = STATUS[row.status] ?? { label: row.status, className: "bg-muted text-muted-foreground", icon: Clock3 };
              const StatusIcon = status.icon;
              return (
                <div key={row.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold">{money(row.amount)}</div>
                      <div className="break-words text-sm">{row.description}</div>
                      {row.notes ? <div className="mt-0.5 break-words text-xs text-muted-foreground">{row.notes}</div> : null}
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${status.className}`}>
                      <StatusIcon className="h-3.5 w-3.5" />
                      {status.label}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-muted-foreground" dir="rtl">
                    <span dir="ltr">{row.transactionNo}</span> · {formatDateTime(row.createdAt)}
                    {row.status === "executed" && row.executedAt ? ` · انصرف ${formatDateTime(row.executedAt)}` : ""}
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
