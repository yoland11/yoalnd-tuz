import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { adminFetch, apiErrorMessage } from "./_lib";
import { formatIraqiPhone, formatIraqiPhoneInput } from "@/lib/phone";

export type QuickAddedCustomer = { id: number; name: string; fullName: string; phone: string };

/**
 * Shared "add new customer" dialog reused by the Sales POS and the Booking Center.
 * Full name + mobile (required), WhatsApp / address / notes (optional), a confirm
 * step, and a success toast. Reuses POST /admin/customers (duplicate-phone 409),
 * so the created customer is instantly available across the whole system — no
 * separate customer store.
 */
export function CustomerQuickAddDialog({
  open,
  onOpenChange,
  defaultPhone,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPhone?: string;
  onCreated: (customer: QuickAddedCustomer) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = fullName.trim().length >= 2 && phone.trim().length >= 6;

  // Seed the phone from the search box (users often search by number first).
  useEffect(() => {
    if (open && !phone && defaultPhone && /\d/.test(defaultPhone)) {
      setPhone(formatIraqiPhoneInput(defaultPhone));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function reset() {
    setFullName(""); setPhone(""); setWhatsapp(""); setAddress(""); setNotes("");
    setConfirming(false); setBusy(false);
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const created = await adminFetch<{ id: number; name: string; phone: string }>("/admin/customers", {
        method: "POST",
        body: JSON.stringify({
          name: fullName.trim(),
          fullName: fullName.trim(),
          phone: phone.trim(),
          address: address.trim() || undefined,
          whatsapp: whatsapp.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["admin", "customers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "customers-list"] });
      toast({ title: "تم إنشاء العميل وربطه بنجاح" });
      onCreated({ id: created.id, name: created.name, fullName: fullName.trim(), phone: created.phone });
      reset();
    } catch (error) {
      toast({ title: "تعذّر إنشاء العميل", description: apiErrorMessage(error), variant: "destructive" });
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>إضافة عميل جديد</DialogTitle>
          <DialogDescription className="sr-only">إنشاء عميل وربطه بالفاتورة الحالية</DialogDescription>
        </DialogHeader>
        {confirming ? (
          <div className="space-y-4 py-2 text-center">
            <p className="text-sm font-semibold text-foreground">هل تريد إضافة هذا الشخص إلى قاعدة بيانات العملاء؟</p>
            <div className="rounded-lg bg-muted/40 p-3 text-right text-xs">
              <p>الاسم: {fullName.trim()}</p>
              <p dir="ltr">الهاتف: {formatIraqiPhone(phone.trim())}</p>
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>لا</Button>
              <Button disabled={busy} onClick={create}>{busy ? "جارٍ الحفظ…" : "نعم"}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1"><Label>الاسم الكامل *</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>رقم الهاتف *</Label><Input value={phone} onChange={(e) => setPhone(formatIraqiPhoneInput(e.target.value))} dir="ltr" placeholder="0770xxxxxxx" inputMode="numeric" /></div>
              <div className="space-y-1"><Label>واتساب (اختياري)</Label><Input value={whatsapp} onChange={(e) => setWhatsapp(formatIraqiPhoneInput(e.target.value))} dir="ltr" placeholder="0770xxxxxxx" inputMode="numeric" /></div>
            </div>
            <div className="space-y-1"><Label>العنوان</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
            <div className="space-y-1"><Label>ملاحظات</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>إلغاء</Button>
              <Button disabled={!ready} onClick={() => setConfirming(true)}>حفظ</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
