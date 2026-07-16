"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";
import { PAYMENT_METHOD_LABELS } from "./booking-shared";

/**
 * Shared Booking Center dialogs, used by both the list page and the booking
 * details page so the two never drift apart.
 */

function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      {/* max-h + overflow-y keep the dialog usable on short mobile viewports
          instead of clipping its buttons off-screen. */}
      <div
        dir="rtl"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border/40 bg-card p-5 shadow-2xl sm:rounded-2xl"
      >
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
        ) : null}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function AddPaymentDialog({
  bookingId,
  bookingNo,
  remaining,
  onClose,
}: {
  bookingId: number;
  bookingNo: string;
  remaining?: string | number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch(`/admin/booking-center/bookings/${bookingId}/payments`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("تم إنشاء سند القبض — بانتظار اعتماد المدير", {
        description: "لن يتغير رصيد الحجز أو الصندوق قبل الاعتماد.",
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Modal
      title="إضافة دفعة"
      description={`الحجز ${bookingNo}${
        remaining != null ? ` · المتبقي ${formatCurrency(remaining)}` : ""
      }`}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(amount);
          if (!Number.isFinite(value) || value <= 0) {
            toast.error("أدخل مبلغاً صحيحاً");
            return;
          }
          mutation.mutate({
            amount: value,
            method,
            reference: reference.trim() || null,
            notes: notes.trim() || null,
          });
        }}
      >
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          placeholder="المبلغ *"
          aria-label="المبلغ"
          autoFocus
          className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
        />
        <select
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          aria-label="طريقة الدفع"
          className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
        >
          {["cash", "transfer", "pos", "other"].map((key) => (
            <option key={key} value={key}>
              {PAYMENT_METHOD_LABELS[key]}
            </option>
          ))}
        </select>
        <input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="رقم المرجع (اختياري)"
          aria-label="رقم المرجع"
          className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
        />
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="ملاحظات (اختياري)"
          aria-label="ملاحظات"
          rows={2}
          className="w-full resize-none rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
        />
        <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          يُنشأ سند قبض ويُرسل إلى الصندوق الرئيسي. لا يتأثر رصيد الحجز ولا الصندوق إلا بعد اعتماد المدير.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-border/40 px-4 py-2 text-sm font-medium text-muted-foreground"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex-1 rounded-lg bg-gradient-to-l from-rose-400 to-pink-400 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {mutation.isPending ? "جارٍ الإرسال…" : "إرسال للاعتماد"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CancelBookingDialog({
  bookingId,
  bookingNo,
  paid,
  onClose,
}: {
  bookingId: number;
  bookingNo: string;
  paid?: string | number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch(`/admin/booking-center/bookings/${bookingId}/cancel`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (row: any) => {
      toast.success("تم إلغاء الحجز", {
        description:
          Number(row?.refundableAmount) > 0
            ? `مبلغ قابل للاسترجاع: ${formatCurrency(row.refundableAmount)}`
            : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Modal title="إلغاء الحجز" description={`الحجز ${bookingNo}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim().length < 3) {
            toast.error("سبب الإلغاء مطلوب");
            return;
          }
          mutation.mutate({ reason: reason.trim() });
        }}
      >
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="سبب الإلغاء *"
          aria-label="سبب الإلغاء"
          rows={3}
          autoFocus
          className="w-full resize-none rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
        />
        <p className="rounded-lg bg-red-50 p-2 text-[11px] text-red-800 dark:bg-red-500/10 dark:text-red-300">
          لا يُحذف أي سجل مالي. السندات والقيود المحاسبية تبقى كما هي، ويُحتسب المبلغ القابل للاسترجاع
          {Number(paid) > 0 ? ` (${formatCurrency(paid ?? 0)} مدفوع حالياً)` : ""} ليُعالج بسند صرف منفصل.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-border/40 px-4 py-2 text-sm font-medium text-muted-foreground"
          >
            تراجع
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {mutation.isPending ? "جارٍ الإلغاء…" : "تأكيد الإلغاء"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
