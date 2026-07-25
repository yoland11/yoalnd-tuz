"use client";

/**
 * On-save "open a customer account?" prompt.
 *
 * Shown when an invoice (sales or purchase) is about to be saved with a name
 * that isn't a registered customer. Answering نعم opens a real customer account
 * (name + Iraqi phone) so every future invoice for that person aggregates under
 * one account; لا saves the invoice as-is; إلغاء aborts the save.
 *
 * A customer account requires a unique Iraqi phone (the customers table keys on
 * it), so the dialog collects/edits the phone before creating. If the phone
 * already belongs to an existing customer, that customer is linked instead of
 * erroring.
 */

import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage, apiErrorStatus } from "./_lib";

type CreatedCustomer = { id: number; name: string; phone: string };

const onlyDigits = (value: string) => value.replace(/[^\d]/g, "");

export default function CustomerAccountPrompt({
  name,
  initialPhone,
  onCancel,
  onDecline,
  onConfirm,
}: {
  name: string;
  initialPhone?: string;
  /** إلغاء — abort the save entirely. */
  onCancel: () => void;
  /** لا — proceed to save the invoice without opening an account. */
  onDecline: () => void;
  /** نعم — an account was opened (or an existing one linked). */
  onConfirm: (customerId: number, phone: string) => void;
}) {
  const { toast } = useToast();
  const [phone, setPhone] = useState(initialPhone?.trim() ?? "");
  const [busy, setBusy] = useState(false);

  async function openAccount() {
    if (!phone.trim()) {
      toast({ title: "رقم الهاتف مطلوب لفتح حساب", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const customer = await adminFetch<CreatedCustomer>("/admin/customers", {
        method: "POST",
        body: JSON.stringify({ name, phone: phone.trim() }),
      });
      toast({ title: "تم فتح حساب العميل", description: customer.name });
      onConfirm(customer.id, customer.phone);
    } catch (error) {
      // Phone already registered → link that existing customer instead of failing.
      if (apiErrorStatus(error) === 409) {
        try {
          const matches = await adminFetch<Array<{ id: number; name: string; phone: string }>>(
            `/admin/customers?search=${encodeURIComponent(phone.trim())}&limit=5`,
          );
          const wanted = onlyDigits(phone);
          const existing =
            matches.find((candidate) => onlyDigits(candidate.phone) === wanted) ?? matches[0];
          if (existing) {
            toast({ title: "الرقم مسجّل لعميل موجود — تم ربطه", description: existing.name });
            onConfirm(existing.id, existing.phone);
            return;
          }
        } catch {
          /* fall through to the generic message */
        }
        toast({ title: "رقم الهاتف مستخدم مسبقاً", variant: "destructive" });
        return;
      }
      toast({ title: "تعذر فتح الحساب", description: apiErrorMessage(error), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="فتح حساب عميل"
    >
      <div className="w-full max-w-md rounded-xl border border-border/40 bg-card p-5 shadow-2xl">
        <h3 className="text-lg font-bold text-foreground">فتح حساب عميل</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          «<span className="font-semibold text-foreground">{name}</span>» غير مسجّل كعميل. تفتح له
          حساباً حتى تتجمّع كل فواتيره تحت حساب واحد؟
        </p>

        <label className="mt-4 block text-xs text-muted-foreground">رقم الهاتف *</label>
        <input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          inputMode="tel"
          dir="ltr"
          placeholder="07XXXXXXXXX"
          autoFocus
          className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={busy}
            className="rounded-lg border border-border/40 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            لا، احفظ بدون حساب
          </button>
          <button
            type="button"
            onClick={openAccount}
            disabled={busy}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-black hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "جارٍ فتح الحساب…" : "نعم، افتح حساب"}
          </button>
        </div>
      </div>
    </div>
  );
}
