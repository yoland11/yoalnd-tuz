import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeDollarSign, Loader2, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";

type SaleContext = {
  asset: {
    productId: number;
    name: string;
    assetCode: string;
    category: string | null;
    serialNumber: string | null;
    purchaseDate: string | null;
    purchaseCost: number;
    bookValue: number;
    accumulatedDepreciation: number;
    marketValue: number | null;
    status: string;
  };
  blockers: string[];
  accounts: Array<{ id: number; code: string; name: string; type: "cash" | "bank" }>;
};

type FormState = {
  buyerName: string;
  buyerPhone: string;
  saleDate: string;
  salePrice: string;
  paymentMethod: "cash" | "bank_transfer" | "partial";
  collectionMethod: "cash" | "bank_transfer";
  financialAccountId: string;
  paidAmount: string;
  invoiceNumber: string;
  reason: string;
  notes: string;
};

const today = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

const emptyForm: FormState = {
  buyerName: "",
  buyerPhone: "",
  saleDate: today(),
  salePrice: "",
  paymentMethod: "cash",
  collectionMethod: "cash",
  financialAccountId: "",
  paidAmount: "",
  invoiceNumber: "",
  reason: "",
  notes: "",
};

const fieldClass =
  "mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60";

export function AssetSaleDialog({
  productId,
  open,
  onOpenChange,
  onSold,
}: {
  productId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSold?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(emptyForm);
  const query = useQuery<SaleContext>({
    queryKey: ["asset-sale-context", productId],
    queryFn: () => adminFetch(`/admin/assets/${productId}/sale`),
    enabled: open,
    retry: false,
  });

  useEffect(() => {
    if (!open) setForm({ ...emptyForm, saleDate: today() });
  }, [open]);

  useEffect(() => {
    const accounts = query.data?.accounts ?? [];
    if (!accounts.length || form.financialAccountId) return;
    const preferred =
      form.paymentMethod === "bank_transfer" ? accounts.find((row) => row.type === "bank") : accounts.find((row) => row.type === "cash");
    if (preferred) setForm((current) => ({ ...current, financialAccountId: String(preferred.id) }));
  }, [query.data?.accounts, form.financialAccountId, form.paymentMethod]);

  const bookValue = Number(query.data?.asset.bookValue ?? 0);
  const salePrice = Number(form.salePrice || 0);
  const result = useMemo(
    () => ({ profit: Math.max(0, salePrice - bookValue), loss: Math.max(0, bookValue - salePrice) }),
    [bookValue, salePrice],
  );

  const save = useMutation({
    mutationFn: () =>
      adminFetch(`/admin/assets/${productId}/sale`, {
        method: "POST",
        body: JSON.stringify({
          ...form,
          buyerPhone: form.buyerPhone || null,
          invoiceNumber: form.invoiceNumber || null,
          notes: form.notes || null,
          collectionMethod: form.paymentMethod === "partial" ? form.collectionMethod : null,
          paidAmount: form.paymentMethod === "partial" ? Number(form.paidAmount) : Number(form.salePrice),
          salePrice: Number(form.salePrice),
          financialAccountId: Number(form.financialAccountId),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "enterprise", "assets"] });
      qc.invalidateQueries({ queryKey: ["admin", "assets"] });
      qc.invalidateQueries({ queryKey: ["asset-timeline", productId] });
      qc.invalidateQueries({ queryKey: ["asset-sales"] });
      toast({ title: "تم بيع الأصل وحفظ القيد المحاسبي" });
      onOpenChange(false);
      onSold?.();
    },
    onError: (cause) =>
      toast({ title: "تعذّر بيع الأصل", description: apiErrorMessage(cause), variant: "destructive" }),
  });

  const accounts = (query.data?.accounts ?? []).filter((account) => {
    const method = form.paymentMethod === "partial" ? form.collectionMethod : form.paymentMethod;
    return method === "cash" ? account.type === "cash" : account.type === "bank";
  });
  const blockers = query.data?.blockers ?? [];
  const complete =
    form.buyerName.trim().length >= 2 &&
    form.saleDate &&
    salePrice > 0 &&
    Number(form.financialAccountId) > 0 &&
    form.reason.trim().length >= 3 &&
    (form.paymentMethod !== "partial" || (form.buyerPhone.trim().length > 0 && Number(form.paidAmount) > 0 && Number(form.paidAmount) < salePrice));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" dir="rtl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="flex items-center gap-2 text-right">
            <BadgeDollarSign className="h-5 w-5 text-primary" /> بيع الأصل
          </DialogTitle>
          <DialogDescription className="text-right">
            يبقى الأصل وسجله الكامل محفوظين، وتتوقف حركات الإهلاك الجديدة بعد اعتماد البيع.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <Skeleton className="h-96 rounded-xl" />
        ) : query.isError || !query.data ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {apiErrorMessage(query.error)}
          </div>
        ) : (
          <>
            <section className="grid gap-2 rounded-xl border border-border/40 bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["الأصل", query.data.asset.name],
                ["الكود", query.data.asset.assetCode],
                ["الفئة", query.data.asset.category || "—"],
                ["الرقم التسلسلي", query.data.asset.serialNumber || "—"],
                ["تاريخ الشراء", query.data.asset.purchaseDate || "—"],
                ["كلفة الشراء", formatCurrency(query.data.asset.purchaseCost)],
                ["القيمة الدفترية", formatCurrency(query.data.asset.bookValue)],
                ["مجمع الإهلاك", formatCurrency(query.data.asset.accumulatedDepreciation)],
                ["القيمة السوقية", query.data.asset.marketValue == null ? "—" : formatCurrency(query.data.asset.marketValue)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-background/60 p-2.5">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
                </div>
              ))}
            </section>

            {blockers.length ? (
              <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                <p className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> لا يمكن بيع الأصل حالياً</p>
                <ul className="list-disc space-y-1 pr-5">{blockers.map((message) => <li key={message}>{message}</li>)}</ul>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">اسم المشتري *<input className={fieldClass} value={form.buyerName} onChange={(event) => setForm({ ...form, buyerName: event.target.value })} /></label>
                <label className="text-sm">هاتف المشتري {form.paymentMethod === "partial" ? "* (مطلوب للذمة)" : "(اختياري)"}<input className={fieldClass} dir="ltr" value={form.buyerPhone} onChange={(event) => setForm({ ...form, buyerPhone: event.target.value })} /></label>
                <label className="text-sm">تاريخ البيع *<input className={fieldClass} type="date" value={form.saleDate} onChange={(event) => setForm({ ...form, saleDate: event.target.value })} /></label>
                <label className="text-sm">سعر البيع *<input className={fieldClass} type="number" min="0.01" step="0.01" dir="ltr" value={form.salePrice} onChange={(event) => setForm({ ...form, salePrice: event.target.value })} /></label>
                <label className="text-sm">طريقة الدفع *
                  <select className={fieldClass} value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value as FormState["paymentMethod"], financialAccountId: "" })}>
                    <option value="cash">نقدي</option><option value="bank_transfer">تحويل بنكي</option><option value="partial">دفع جزئي</option>
                  </select>
                </label>
                {form.paymentMethod === "partial" ? <label className="text-sm">طريقة استلام الدفعة *
                  <select className={fieldClass} value={form.collectionMethod} onChange={(event) => setForm({ ...form, collectionMethod: event.target.value as FormState["collectionMethod"], financialAccountId: "" })}>
                    <option value="cash">نقدي</option><option value="bank_transfer">تحويل بنكي</option>
                  </select>
                </label> : null}
                {form.paymentMethod === "partial" ? <label className="text-sm">المبلغ المستلم *<input className={fieldClass} type="number" min="0.01" step="0.01" dir="ltr" value={form.paidAmount} onChange={(event) => setForm({ ...form, paidAmount: event.target.value })} /></label> : null}
                <label className="text-sm">الصندوق / الحساب البنكي *
                  <select className={fieldClass} value={form.financialAccountId} onChange={(event) => setForm({ ...form, financialAccountId: event.target.value })}>
                    <option value="">اختر الحساب</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
                  </select>
                </label>
                <label className="text-sm">رقم الفاتورة (اختياري)<input className={fieldClass} value={form.invoiceNumber} onChange={(event) => setForm({ ...form, invoiceNumber: event.target.value })} /></label>
                <label className="text-sm sm:col-span-2">سبب البيع *<textarea className={fieldClass} rows={2} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
                <label className="text-sm sm:col-span-2">ملاحظات<textarea className={fieldClass} rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>

                {salePrice > 0 ? (
                  <div className="sm:col-span-2 grid gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3 sm:grid-cols-3">
                    <div><p className="text-xs text-muted-foreground">القيمة الدفترية</p><p className="font-bold">{formatCurrency(bookValue)}</p></div>
                    <div><p className="text-xs text-muted-foreground">نتيجة البيع</p><p className={result.profit ? "font-bold text-emerald-500" : result.loss ? "font-bold text-destructive" : "font-bold"}>{result.profit ? `ربح ${formatCurrency(result.profit)}` : result.loss ? `خسارة ${formatCurrency(result.loss)}` : "تعادل"}</p></div>
                    <div><p className="text-xs text-muted-foreground">المتبقي بذمة المشتري</p><p className="font-bold">{formatCurrency(form.paymentMethod === "partial" ? Math.max(0, salePrice - Number(form.paidAmount || 0)) : 0)}</p></div>
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}

        <DialogFooter className="gap-2 sm:justify-start sm:space-x-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button disabled={query.isLoading || blockers.length > 0 || !complete || save.isPending} onClick={() => save.mutate()} className="gap-2">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />} اعتماد بيع الأصل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
