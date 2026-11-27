import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Link2, Loader2, Paperclip, Search, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { albumCents, centsToAmount, type AlbumCatalogKind } from "@/lib/albums";
import { uploadImageWithVariants, uploadTaskFile } from "@/lib/large-image-upload";
import { queryClient } from "@/lib/query-client";
import { AjNApiError, adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import { CatalogSelect, Field, StaffSelect, albumKeys, money, newKey, useAlbumMeta, type AlbumDetail, type Attachment, type CatalogOption } from "./shared";

type Booking = { id: number; code: string; customerId: number | null; customerName: string; phone: string; eventDate: string | null; status: string; albumIncluded: boolean; albumOrders: number };
type Customer = { id: number; name: string; phone: string };

const SPEC_KINDS: Array<{ kind: AlbumCatalogKind; field: keyof Form }> = [
  { kind: "type", field: "albumType" }, { kind: "size", field: "albumSize" }, { kind: "cover_type", field: "coverType" },
  { kind: "cover_color", field: "coverColor" }, { kind: "paper", field: "paperType" }, { kind: "page_count", field: "pageCountOption" }, { kind: "box", field: "boxType" },
];
// Where each specification's manufacturing cost lands in the album's cost fields.
const COST_FIELD: Record<AlbumCatalogKind, "printingCost" | "coverCost" | "extraCosts"> = {
  type: "printingCost", size: "printingCost", paper: "printingCost", page_count: "printingCost", cover_type: "coverCost", cover_color: "coverCost", box: "extraCosts",
};

type Form = {
  customerId: number | null; customerName: string; phone: string; bookingId: number | null; occasionType: string;
  albumType: string; albumSize: string; pageCountOption: string; pageCount: string; photoCount: string; copies: string;
  coverType: string; coverColor: string; paperType: string; boxType: string; coverNames: string;
  occasionDate: string; orderDate: string; dueDate: string; designerStaffId: number | null; printerStaffId: number | null;
  customerNotes: string; internalNotes: string; financeMode: "invoice" | "package" | "free"; extraAlbumCharge: boolean;
  salePrice: string; designCost: string; printingCost: string; coverCost: string; bindingCost: string; extraCosts: string;
};
const emptyForm = (today: string): Form => ({
  customerId: null, customerName: "", phone: "", bookingId: null, occasionType: "", albumType: "", albumSize: "", pageCountOption: "", pageCount: "",
  photoCount: "", copies: "1", coverType: "", coverColor: "", paperType: "", boxType: "", coverNames: "", occasionDate: "", orderDate: today, dueDate: "",
  designerStaffId: null, printerStaffId: null, customerNotes: "", internalNotes: "", financeMode: "invoice", extraAlbumCharge: false,
  salePrice: "", designCost: "", printingCost: "", coverCost: "", bindingCost: "", extraCosts: "",
});

export function CreateAlbumDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const meta = useAlbumMeta();
  const access = meta.data?.access;
  const catalog = useMemo(() => meta.data?.catalog ?? [], [meta.data?.catalog]);
  const [form, setForm] = useState<Form>(() => emptyForm(""));
  const [more, setMore] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [booking, setBooking] = useState<Booking | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [priceTouched, setPriceTouched] = useState<Record<string, boolean>>({});
  const keyRef = useRef(newKey());

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm(meta.data?.today ?? new Date().toISOString().slice(0, 10)));
    setErrors({}); setBooking(null); setAttachments([]); setMore(false); setPriceTouched({});
    keyRef.current = newKey();
  }, [open, meta.data?.today]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const picked = (kind: AlbumCatalogKind, label: string) => catalog.find((option) => option.kind === kind && option.label === label && option.isActive);

  // Suggested price and costs from the administrator's defaults; any field the user typed stays theirs.
  // Keyed on the spec selections only, so writing the suggestion back never re-triggers it.
  const specKey = `${SPEC_KINDS.map(({ field }) => String(form[field] ?? "")).join("|")}|${form.copies}`;
  const suggestion = useMemo(() => {
    const copies = Math.max(1, Number(form.copies) || 1);
    const totals = { salePrice: 0, printingCost: 0, coverCost: 0, extraCosts: 0 };
    for (const { kind, field } of SPEC_KINDS) {
      const option = picked(kind, String(form[field] ?? ""));
      if (!option) continue;
      totals.salePrice += albumCents(option.defaultPrice) * copies;
      totals[COST_FIELD[kind]] += albumCents(option.manufacturingCost) * copies;
    }
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, catalog]);
  const { salePrice: suggestedSale, printingCost: suggestedPrinting, coverCost: suggestedCover, extraCosts: suggestedExtra } = suggestion;
  useEffect(() => {
    const next: Partial<Form> = {};
    if (!priceTouched.salePrice) next.salePrice = suggestedSale ? centsToAmount(suggestedSale) : "";
    if (!priceTouched.printingCost) next.printingCost = suggestedPrinting ? centsToAmount(suggestedPrinting) : "";
    if (!priceTouched.coverCost) next.coverCost = suggestedCover ? centsToAmount(suggestedCover) : "";
    if (!priceTouched.extraCosts) next.extraCosts = suggestedExtra ? centsToAmount(suggestedExtra) : "";
    setForm((current) => ((Object.keys(next) as Array<keyof Form>).some((key) => current[key] !== next[key]) ? { ...current, ...next } : current));
  }, [suggestedSale, suggestedPrinting, suggestedCover, suggestedExtra, priceTouched]);

  const create = useMutation({
    mutationFn: () => {
      const pageCount = form.pageCount || form.pageCountOption.replace(/\D/g, "");
      return adminFetch<AlbumDetail & { duplicate: boolean }>("/admin/albums", {
        method: "POST",
        body: JSON.stringify({
          ...form, pageCount: pageCount || null, attachments, idempotencyKey: keyRef.current,
          ...(access?.financials ? {} : { salePrice: undefined, designCost: undefined, printingCost: undefined, coverCost: undefined, bindingCost: undefined, extraCosts: undefined }),
        }),
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: albumKeys.all });
      toast({ title: result.duplicate ? "الطلب محفوظ مسبقاً" : `تم إنشاء ${result.album.albumNo}`, description: result.album.invoiceNo ? `فاتورة ${result.album.invoiceNo}` : undefined });
      onOpenChange(false);
      onCreated(result.album.id);
    },
    onError: (error) => {
      const fieldErrors = error instanceof AjNApiError ? error.fieldErrors ?? {} : {};
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).some((key) => ["photoCount", "coverNames", "boxType", "paperType", "customerNotes"].includes(key))) setMore(true);
      toast({ title: "لم يُحفظ الطلب", description: apiErrorMessage(error), variant: "destructive" });
    },
  });

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        const stored = file.type.startsWith("image/")
          ? await uploadImageWithVariants(file, { folder: "uploads/albums" }).then((result) => ({ url: result.originalUrl, fileName: file.name, mediaType: file.type }))
          : await uploadTaskFile(file, { folder: "uploads/albums" }).then((result) => ({ url: result.url, fileName: file.name, mediaType: result.mime }));
        setAttachments((current) => [...current, stored]);
      }
    } catch (error) {
      toast({ title: "تعذّر رفع الملف", description: apiErrorMessage(error), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const pickBooking = (value: Booking | null) => {
    setBooking(value);
    if (!value) {
      setForm((current) => ({ ...current, bookingId: null, financeMode: current.financeMode === "package" ? "invoice" : current.financeMode }));
      return;
    }
    setForm((current) => ({
      ...current, bookingId: value.id, customerId: value.customerId, customerName: value.customerName || current.customerName, phone: value.phone || current.phone,
      occasionDate: current.occasionDate || (value.eventDate ? String(value.eventDate).slice(0, 10) : ""),
      financeMode: value.albumIncluded ? "package" : current.financeMode,
    }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const missing: Record<string, string> = {};
    if (!form.customerName.trim()) missing.customerName = "اسم الزبون مطلوب";
    if (!form.customerId && !form.phone.trim()) missing.phone = "رقم الهاتف مطلوب";
    if (!form.albumType) missing.albumType = "نوع الألبوم مطلوب";
    if (!form.albumSize) missing.albumSize = "قياس الألبوم مطلوب";
    setErrors(missing);
    if (Object.keys(missing).length) return;
    create.mutate();
  };

  const err = (key: string) => errors[key];
  const optionsMissing = !meta.isLoading && !catalog.some((option) => option.kind === "type" && option.isActive);

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[92dvh] w-[min(calc(100%-2rem),48rem)] overflow-y-auto p-0" dir="rtl">
        <form onSubmit={submit} noValidate>
          <DialogHeader className="sticky top-0 z-10 border-b border-border bg-background px-5 py-4 text-right">
            <DialogTitle>طلب ألبوم جديد</DialogTitle>
            <DialogDescription>طلب مستقل أو مربوط بحجز تصوير. بيانات الزبون تُملأ تلقائياً من الحجز أو سجل الزبائن.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 px-5 py-4">
            {optionsMissing ? <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-xs font-bold text-status-warning">أضف أنواع وقياسات الألبومات من «إعدادات الألبومات» قبل إنشاء أول طلب.</p> : null}

            <section className="space-y-3">
              <h3 className="text-sm font-bold">الزبون والحجز</h3>
              <BookingPicker value={booking} onChange={pickBooking} />
              {booking?.albumIncluded ? <p className="rounded-lg border border-border bg-muted/60 p-2.5 text-xs text-foreground">باقة هذا الحجز تشمل ألبوماً، لذلك يُسجل الألبوم «مشمولاً بالباقة» ولا يُحاسب الزبون عليه مرة ثانية.</p> : null}
              {booking && booking.albumOrders > 0 ? <p className="rounded-lg bg-status-warning/10 p-2.5 text-xs text-status-warning">لهذا الحجز {booking.albumOrders} طلب ألبوم مسجل مسبقاً.</p> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <CustomerField form={form} set={set} error={err("customerName")} locked={Boolean(booking?.customerId)} />
                <Field label="رقم الهاتف" htmlFor="album-phone" required={!form.customerId} error={err("phone")}>
                  <Input id="album-phone" inputMode="tel" dir="ltr" className="text-right" value={form.phone} disabled={Boolean(form.customerId)} onChange={(event) => set("phone", event.target.value)} placeholder="07xx xxx xxxx" />
                </Field>
                <Field label="نوع المناسبة" htmlFor="album-occasion">
                  <Input id="album-occasion" value={form.occasionType} onChange={(event) => set("occasionType", event.target.value)} placeholder="زفاف، خطوبة، تخرج…" />
                </Field>
                <Field label="تاريخ المناسبة" htmlFor="album-occasion-date">
                  <DateField id="album-occasion-date" type="date" value={form.occasionDate} onChange={(event) => set("occasionDate", event.target.value)} />
                </Field>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-bold">مواصفات الألبوم</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <div><CatalogSelect id="album-type" kind="type" label="نوع الألبوم" required value={form.albumType} catalog={catalog} onChange={(value) => set("albumType", value)} />{err("albumType") ? <p className="mt-1 text-xs font-bold text-destructive">{err("albumType")}</p> : null}</div>
                <div><CatalogSelect id="album-size" kind="size" label="قياس الألبوم" required value={form.albumSize} catalog={catalog} onChange={(value) => set("albumSize", value)} />{err("albumSize") ? <p className="mt-1 text-xs font-bold text-destructive">{err("albumSize")}</p> : null}</div>
                <CatalogSelect id="album-pages" kind="page_count" label="عدد الصفحات" value={form.pageCountOption} catalog={catalog} onChange={(value) => setForm((current) => ({ ...current, pageCountOption: value, pageCount: value.replace(/\D/g, "") }))} />
                <CatalogSelect id="album-cover-type" kind="cover_type" label="نوع الغلاف" value={form.coverType} catalog={catalog} onChange={(value) => set("coverType", value)} />
                <CatalogSelect id="album-cover-color" kind="cover_color" label="لون الغلاف" value={form.coverColor} catalog={catalog} onChange={(value) => set("coverColor", value)} />
                <Field label="عدد النسخ" htmlFor="album-copies" error={err("copies")}>
                  <Input id="album-copies" type="number" min={1} max={50} inputMode="numeric" value={form.copies} onChange={(event) => set("copies", event.target.value)} />
                </Field>
              </div>
              <Field label="الأسماء على الغلاف" htmlFor="album-names" error={err("coverNames")}>
                <Input id="album-names" value={form.coverNames} onChange={(event) => set("coverNames", event.target.value)} placeholder="مثال: علي & زينب" />
              </Field>
            </section>

            <section className="grid gap-3 sm:grid-cols-3">
              <Field label="تاريخ الطلب" htmlFor="album-order-date">
                <DateField id="album-order-date" type="date" value={form.orderDate} onChange={(event) => set("orderDate", event.target.value)} />
              </Field>
              <Field label="موعد التسليم" htmlFor="album-due" error={err("dueDate")}>
                <DateField id="album-due" type="date" value={form.dueDate} min={form.orderDate || undefined} onChange={(event) => set("dueDate", event.target.value)} />
              </Field>
              <StaffSelect id="album-designer" label="المصمم المسؤول" value={form.designerStaffId} staff={meta.data?.staff ?? []} onChange={(value) => set("designerStaffId", value)} />
            </section>

            {access?.financials ? (
              <section className="space-y-3 rounded-xl border border-border p-3">
                <h3 className="text-sm font-bold">الحساب</h3>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="طريقة الحساب">
                  {([["invoice", "فاتورة مستقلة"], ["package", "مشمول بباقة الحجز"], ["free", "بدون مبلغ"]] as const).map(([key, label]) => (
                    <label key={key} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${form.financeMode === key ? "border-primary bg-primary/5 font-bold" : "border-border"} ${key === "package" && !form.bookingId ? "cursor-not-allowed opacity-50" : ""}`}>
                      <input type="radio" name="financeMode" value={key} checked={form.financeMode === key} disabled={key === "package" && !form.bookingId} onChange={() => set("financeMode", key)} />{label}
                    </label>
                  ))}
                </div>
                {err("financeMode") ? <p className="text-xs font-bold text-destructive">{err("financeMode")}</p> : null}
                {booking?.albumIncluded && form.financeMode === "invoice" ? (
                  <label className="flex items-center gap-2 text-xs font-bold text-status-warning">
                    <input type="checkbox" checked={form.extraAlbumCharge} onChange={(event) => set("extraAlbumCharge", event.target.checked)} />
                    ألبوم إضافي بسعر مستقل (غير ألبوم الباقة)
                  </label>
                ) : null}
                {form.financeMode === "invoice" ? (
                  <Field label="سعر البيع" htmlFor="album-price" error={err("salePrice")} hint={suggestion.salePrice ? `المقترح من الإعدادات: ${money(centsToAmount(suggestion.salePrice))}` : "تُنشأ فاتورة مبيعات للألبوم وتُسجل الدفعات عليها عبر اعتماد الصندوق"}>
                    <Input id="album-price" inputMode="decimal" dir="ltr" className="text-right tabular-nums" value={form.salePrice} onChange={(event) => { setPriceTouched((current) => ({ ...current, salePrice: true })); set("salePrice", event.target.value); }} />
                  </Field>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-5">
                  {([["designCost", "تكلفة التصميم"], ["printingCost", "تكلفة الطباعة"], ["coverCost", "تكلفة الغلاف"], ["bindingCost", "تكلفة التجليد"], ["extraCosts", "مصاريف إضافية"]] as const).map(([key, label]) => (
                    <Field key={key} label={label} htmlFor={`album-${key}`} error={err(key)}>
                      <Input id={`album-${key}`} inputMode="decimal" dir="ltr" className="text-right tabular-nums" value={form[key]} onChange={(event) => { setPriceTouched((current) => ({ ...current, [key]: true })); set(key, event.target.value); }} />
                    </Field>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="rounded-xl border border-border">
              <button type="button" onClick={() => setMore((value) => !value)} aria-expanded={more} className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-bold">
                تفاصيل إضافية (اختياري)
                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ease-out ${more ? "rotate-180" : ""}`} />
              </button>
              {more ? (
                <div className="space-y-3 border-t border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <CatalogSelect id="album-paper" kind="paper" label="نوع ورق الطباعة" value={form.paperType} catalog={catalog} onChange={(value) => set("paperType", value)} />
                    <CatalogSelect id="album-box" kind="box" label="العلبة" value={form.boxType} catalog={catalog} onChange={(value) => set("boxType", value)} />
                    <Field label="عدد الصور" htmlFor="album-photos" error={err("photoCount")}>
                      <Input id="album-photos" type="number" min={0} inputMode="numeric" value={form.photoCount} onChange={(event) => set("photoCount", event.target.value)} />
                    </Field>
                    <Field label="عدد الصفحات (رقم مخصص)" htmlFor="album-pages-custom" error={err("pageCount")}>
                      <Input id="album-pages-custom" type="number" min={1} inputMode="numeric" value={form.pageCount} onChange={(event) => set("pageCount", event.target.value)} />
                    </Field>
                    <StaffSelect id="album-printer" label="مسؤول الطباعة" value={form.printerStaffId} staff={meta.data?.staff ?? []} onChange={(value) => set("printerStaffId", value)} />
                  </div>
                  <Field label="ملاحظات الزبون" htmlFor="album-customer-notes">
                    <Textarea id="album-customer-notes" rows={2} value={form.customerNotes} onChange={(event) => set("customerNotes", event.target.value)} />
                  </Field>
                  <Field label="ملاحظات داخلية" htmlFor="album-internal-notes">
                    <Textarea id="album-internal-notes" rows={2} value={form.internalNotes} onChange={(event) => set("internalNotes", event.target.value)} />
                  </Field>
                  <div className="space-y-2">
                    <span className="text-xs font-bold">الصور والمرفقات</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {attachments.map((file, index) => (
                        <span key={file.url} className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs">
                          <Paperclip className="h-3 w-3 flex-none" /><span className="truncate">{file.fileName ?? "ملف"}</span>
                          <button type="button" aria-label={`إزالة ${file.fileName ?? "الملف"}`} onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-bold hover:bg-muted/50">
                        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                        إرفاق صور أو ملفات
                        <input type="file" multiple className="sr-only" accept="image/*,application/pdf,video/*" disabled={uploading} onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} />
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
          <DialogFooter className="sticky bottom-0 flex-row-reverse gap-2 border-t border-border bg-background px-5 py-3 sm:justify-start">
            <Button type="submit" disabled={create.isPending || uploading}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}حفظ الطلب</Button>
            <Button type="button" variant="outline" disabled={create.isPending} onClick={() => onOpenChange(false)}>إلغاء</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomerField({ form, set, error, locked }: { form: Form; set: <K extends keyof Form>(key: K, value: Form[K]) => void; error?: string; locked: boolean }) {
  const [term, setTerm] = useState("");
  const [focused, setFocused] = useState(false);
  const query = useQuery({
    queryKey: ["albums", "customers", term],
    queryFn: () => adminFetch<{ customers: Customer[] }>(`/admin/albums/customers?q=${encodeURIComponent(term)}`),
    enabled: focused && term.trim().length >= 2 && !locked,
    staleTime: 30_000,
  });
  return (
    <Field label="اسم الزبون" htmlFor="album-customer" required error={error} hint={form.customerId ? "زبون مسجل — بياناته من سجل الزبائن" : undefined}>
      <div className="relative">
        <UserRound className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="album-customer" className="pr-9" value={form.customerName} disabled={locked} autoComplete="off"
          onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onChange={(event) => { set("customerName", event.target.value); set("customerId", null); setTerm(event.target.value); }}
          placeholder="ابحث بالاسم أو الهاتف أو اكتب زبوناً جديداً"
        />
        {form.customerId && !locked ? (
          <button type="button" aria-label="فك ربط الزبون" onClick={() => { set("customerId", null); set("phone", ""); }} className="absolute left-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        ) : null}
        {focused && (query.data?.customers.length ?? 0) > 0 ? (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
            {query.data!.customers.map((customer) => (
              <li key={customer.id}>
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { set("customerId", customer.id); set("customerName", customer.name); set("phone", customer.phone); setFocused(false); }} className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-right text-sm hover:bg-muted">
                  <span className="truncate font-bold">{customer.name}</span><span className="tabular-nums text-xs text-muted-foreground" dir="ltr">{customer.phone}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Field>
  );
}

function BookingPicker({ value, onChange }: { value: Booking | null; onChange: (booking: Booking | null) => void }) {
  const [term, setTerm] = useState("");
  const query = useQuery({
    queryKey: ["albums", "bookings", term],
    queryFn: () => adminFetch<{ bookings: Booking[] }>(`/admin/albums/bookings?q=${encodeURIComponent(term)}`),
    enabled: term.trim().length >= 2 && !value,
    staleTime: 30_000,
  });
  if (value)
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-2"><Link2 className="h-4 w-4 flex-none text-primary" /><b className="tabular-nums" dir="ltr">{value.code}</b><span className="truncate">{value.customerName}</span>{value.eventDate ? <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">{String(value.eventDate).slice(0, 10)}</span> : null}</span>
        <button type="button" onClick={() => onChange(null)} className="text-xs font-bold text-primary">فك الربط</button>
      </div>
    );
  return (
    <div className="relative">
      <Field label="ربط بحجز تصوير (اختياري)" htmlFor="album-booking">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="album-booking" className="pr-9" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="رقم الحجز أو اسم الزبون أو الهاتف" autoComplete="off" />
        </div>
      </Field>
      {term.trim().length >= 2 ? (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {query.isLoading ? <li className="px-3 py-2 text-xs text-muted-foreground">جارٍ البحث…</li> : null}
          {query.isError ? <li className="px-3 py-2 text-xs text-destructive">{apiErrorMessage(query.error)}</li> : null}
          {query.data && !query.data.bookings.length ? <li className="px-3 py-2 text-xs text-muted-foreground">لا توجد حجوزات مطابقة</li> : null}
          {query.data?.bookings.map((booking) => (
            <li key={booking.id}>
              <button type="button" onClick={() => { onChange(booking); setTerm(""); }} className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-right text-sm hover:bg-muted">
                <span className="min-w-0"><b className="tabular-nums" dir="ltr">{booking.code}</b> · <span className="truncate">{booking.customerName}</span></span>
                <span className="flex flex-none items-center gap-1.5 text-xs text-muted-foreground">{booking.albumIncluded ? <span className="rounded-full bg-muted px-2 py-0.5 font-bold text-foreground">ألبوم بالباقة</span> : null}<span className="tabular-nums" dir="ltr">{booking.eventDate ? String(booking.eventDate).slice(0, 10) : ""}</span></span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export type { CatalogOption };
