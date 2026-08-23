import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, ChevronDown, PackageCheck, Store, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatIraqiPhoneInput } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { adminFetch, formatCurrency } from "./_lib";
import { useProvinces, type Province } from "./delivery-provinces";

export type DeliveryMethod = "pickup" | "city" | "province";

export type DeliveryInitialValue = {
  id?: number;
  method?: DeliveryMethod | string;
  provinceId?: number | null;
  provinceName?: string | null;
  city?: string | null;
  district?: string | null;
  area?: string | null;
  landmark?: string | null;
  fullAddress?: string | null;
  mapsUrl?: string | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverAltPhone?: string | null;
  deliveryCompany?: string | null;
  deliveryType?: string | null;
  deliveryFee?: number | string | null;
  feePaidBy?: string | null;
  codEnabled?: boolean;
  codFee?: number | string | null;
  preferredTime?: string | null;
  notes?: string | null;
  isFragile?: boolean;
  needsRefrigeration?: boolean;
  order?: { status?: string | null; statusLabel?: string | null } | null;
};

export type DeliveryOutput = {
  method: DeliveryMethod;
  deliveryFee: number;
  codFee: number;
  codEnabled: boolean;
  valid: boolean;
  dirty?: boolean;
  payload: Record<string, unknown> | null;
  summary: {
    receiverName: string;
    receiverPhone: string;
    provinceName: string;
    city: string;
    address: string;
    company: string;
    typeLabel: string;
    arrival: string | null;
  } | null;
};

const DELIVERY_TYPES = [
  { value: "standard", label: "عادي" },
  { value: "express", label: "سريع" },
  { value: "same_day", label: "نفس اليوم" },
  { value: "office_pickup", label: "استلام من مكتب شركة التوصيل" },
  { value: "door", label: "توصيل إلى باب المنزل" },
];
const TYPE_LABEL = new Map(DELIVERY_TYPES.map((type) => [type.value, type.label]));
const IRAQI_PHONE = /^(009647|9647|07|7)\d{8,9}$/;
const FIELD_CLS = "min-h-11 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55";
const STATUS_LABELS: Record<string, string> = {
  pending_prep: "بانتظار التجهيز", ready_to_ship: "جاهز للإرسال",
  handed_to_company: "تم التسليم لشركة التوصيل", in_transit: "في الطريق",
  arrived_province: "وصل إلى المحافظة", out_for_delivery: "خرج للتسليم",
  delivered: "تم التسليم", failed: "تعذر التسليم", returned: "مرتجع", cancelled: "ملغي",
};

type SavedAddress = {
  id: number; provinceId: number | null; governorate: string; city: string;
  district: string; area: string; address: string; landmark: string;
  fullName: string; phone: string; altPhone: string | null; mapsUrl: string | null;
};
type SearchOption = { value: string; label: string; keywords?: string };

function addDaysIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function quoteFee(province: Province | undefined, type: string, subtotal: number, cod: boolean) {
  if (!province) return { fee: 0, codFee: 0, days: 0, freeApplied: false };
  const standard = province.price || 0;
  const base = type === "express"
    ? (province.expressFee > 0 ? province.expressFee : standard)
    : type === "same_day"
      ? (province.sameDayFee > 0 ? province.sameDayFee : standard)
      : standard;
  const freeApplied = province.freeDeliveryThreshold > 0 && subtotal >= province.freeDeliveryThreshold;
  return { fee: freeApplied ? 0 : base, codFee: cod ? province.codFee || 0 : 0, days: province.estimatedDays, freeApplied };
}

export default function DeliverySection({
  subtotal, customerId, customerPhone, initialValue, lockInitialMethod = false, onChange,
}: {
  subtotal: number;
  customerId?: number | null;
  customerPhone?: string | null;
  initialValue?: DeliveryInitialValue | null;
  lockInitialMethod?: boolean;
  onChange: (output: DeliveryOutput) => void;
}) {
  const initialMethod: DeliveryMethod = initialValue?.method === "province" || initialValue?.method === "city" ? initialValue.method : "pickup";
  const [method, setMethod] = useState<DeliveryMethod>(initialMethod);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [provinceId, setProvinceId] = useState<number | null>(Number(initialValue?.provinceId) > 0 ? Number(initialValue?.provinceId) : null);
  const [deliveryType, setDeliveryType] = useState(initialValue?.deliveryType || "standard");
  const [f, setF] = useState({
    city: initialValue?.city || "", district: initialValue?.district || "",
    area: initialValue?.area || "", landmark: initialValue?.landmark || "",
    fullAddress: initialValue?.fullAddress || "", mapsUrl: initialValue?.mapsUrl || "",
    receiverName: initialValue?.receiverName || "",
    receiverPhone: formatIraqiPhoneInput(initialValue?.receiverPhone || ""),
    receiverAltPhone: formatIraqiPhoneInput(initialValue?.receiverAltPhone || ""),
    deliveryCompany: initialValue?.deliveryCompany || "",
    feePaidBy: initialValue?.feePaidBy || "customer",
    preferredTime: initialValue?.preferredTime || "", notes: initialValue?.notes || "",
  });
  const [codEnabled, setCodEnabled] = useState(Boolean(initialValue?.codEnabled));
  const [isFragile, setIsFragile] = useState(Boolean(initialValue?.isFragile));
  const [needsRefrigeration, setNeedsRefrigeration] = useState(Boolean(initialValue?.needsRefrigeration));
  const [saveAddress, setSaveAddress] = useState(false);
  const [savedAddressId, setSavedAddressId] = useState<number | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(Boolean(initialValue?.receiverPhone));
  const [autoFilled, setAutoFilled] = useState(false);

  const mainPhone = (customerPhone ?? "").trim();
  useEffect(() => {
    if (method !== "province" || phoneTouched || !mainPhone) return;
    setF((previous) => previous.receiverPhone === mainPhone ? previous : { ...previous, receiverPhone: formatIraqiPhoneInput(mainPhone) });
    setAutoFilled(true);
  }, [method, mainPhone, phoneTouched]);

  const { data: provinces } = useProvinces(false);
  const availableProvinces = useMemo(() => (provinces ?? []).filter((item) => item.isActive || item.id === provinceId), [provinces, provinceId]);
  const province = useMemo(() => availableProvinces.find((item) => item.id === provinceId), [availableProvinces, provinceId]);

  useEffect(() => {
    if (provinceId || !initialValue?.provinceName || !availableProvinces.length) return;
    const legacyName = initialValue.provinceName.trim();
    const match = availableProvinces.find((item) => item.governorateAr === legacyName || item.governorate === legacyName);
    if (match) setProvinceId(match.id);
  }, [availableProvinces, initialValue?.provinceName, provinceId]);

  const { data: savedAddresses } = useQuery<SavedAddress[]>({
    queryKey: ["admin", "customer-addresses", customerId],
    queryFn: () => adminFetch(`/admin/customers/${customerId}/addresses`),
    enabled: Boolean(customerId) && method === "province",
  });
  const provinceOptions = useMemo<SearchOption[]>(() => availableProvinces.map((item) => ({ value: String(item.id), label: item.governorateAr, keywords: item.governorate })), [availableProvinces]);
  const selectedDistrict = f.district || f.city;
  const districtOptions = useMemo<SearchOption[]>(() => {
    const areas = [...new Set((province?.areas ?? []).map((area) => area.trim()).filter(Boolean))];
    if (selectedDistrict && !areas.includes(selectedDistrict)) areas.unshift(selectedDistrict);
    return areas.map((area) => ({ value: area, label: area }));
  }, [province?.areas, selectedDistrict]);
  const quote = quoteFee(province, deliveryType, subtotal, codEnabled);
  const phoneValid = IRAQI_PHONE.test(f.receiverPhone.replace(/\s/g, ""));
  const provinceComplete = method !== "province" || Boolean(provinceId && selectedDistrict && phoneValid);

  useEffect(() => {
    if (method === "pickup") {
      onChange({ method, deliveryFee: 0, codFee: 0, codEnabled: false, valid: true, dirty, payload: null, summary: null });
      return;
    }
    const payload = method === "province" ? {
      method, provinceId, customerAddressId: savedAddressId, saveAddressToCustomer: saveAddress,
      // The existing delivery model keeps both fields for compatibility.  The
      // dependent selector is the single source of truth for new edits.
      city: selectedDistrict, district: selectedDistrict, area: f.area, landmark: f.landmark,
      fullAddress: f.fullAddress, mapsUrl: f.mapsUrl || null,
      receiverName: f.receiverName, receiverPhone: f.receiverPhone,
      receiverAltPhone: f.receiverAltPhone || null,
      deliveryCompany: f.deliveryCompany || province?.deliveryCompany || null,
      deliveryType, feePaidBy: f.feePaidBy, codEnabled,
      expectedShipDate: addDaysIso(0), expectedArrivalDate: addDaysIso(quote.days),
      preferredTime: f.preferredTime || null, notes: f.notes || null,
      isFragile, needsRefrigeration,
    } : { method, deliveryFee: 0, feePaidBy: f.feePaidBy, notes: f.notes || null };
    onChange({
      method,
      deliveryFee: method === "province" ? quote.fee : 0,
      codFee: method === "province" ? quote.codFee : 0,
      codEnabled: method === "province" ? codEnabled : false,
      valid: provinceComplete,
      dirty,
      payload,
      summary: method === "province" ? {
        receiverName: f.receiverName, receiverPhone: f.receiverPhone,
        provinceName: province?.governorateAr ?? initialValue?.provinceName ?? "",
        city: selectedDistrict, address: f.fullAddress,
        company: f.deliveryCompany || province?.deliveryCompany || "",
        typeLabel: TYPE_LABEL.get(deliveryType) ?? deliveryType,
        arrival: addDaysIso(quote.days),
      } : null,
    });
  }, [codEnabled, deliveryType, dirty, f, initialValue?.provinceName, isFragile, method, needsRefrigeration, onChange, province, provinceComplete, provinceId, quote.codFee, quote.days, quote.fee, saveAddress, savedAddressId, selectedDistrict]);

  function selectProvince(value: string) {
    setDirty(true);
    const nextId = Number(value);
    if (nextId === provinceId) return;
    setProvinceId(nextId);
    setSavedAddressId(null);
    setF((previous) => ({ ...previous, city: "", district: "" }));
  }
  function selectDistrict(value: string) {
    setDirty(true);
    setF((previous) => ({ ...previous, city: value, district: value }));
  }
  function applySavedAddress(address: SavedAddress) {
    setDirty(true);
    setSavedAddressId(address.id);
    if (address.provinceId) setProvinceId(address.provinceId);
    if (address.phone) { setPhoneTouched(true); setAutoFilled(false); }
    setF((previous) => ({
      ...previous,
      city: address.city || address.district || "",
      district: address.district || address.city || "",
      area: address.area || "", landmark: address.landmark || "",
      fullAddress: address.address || "", mapsUrl: address.mapsUrl || "",
      receiverName: address.fullName || previous.receiverName,
      receiverPhone: formatIraqiPhoneInput(address.phone || previous.receiverPhone),
      receiverAltPhone: formatIraqiPhoneInput(address.altPhone || ""),
    }));
  }

  const methodLocked = lockInitialMethod && Boolean(initialValue?.method);
  const deliveryStatus = initialValue?.order?.status || "pending_prep";

  return <div className="overflow-hidden rounded-xl border border-border/30 bg-card" dir="rtl" onChangeCapture={() => setDirty(true)}>
    <div className="space-y-3 p-3 sm:p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Truck className="h-4 w-4 text-primary" /> طريقة الاستلام <span className="text-status-danger">*</span></p>
      <div className="grid grid-cols-3 gap-2">{([
        ["pickup", "استلام من المحل", Store], ["city", "توصيل داخل المدينة", PackageCheck], ["province", "توصيل محافظات", Truck],
      ] as const).map(([value, label, Icon]) => <button key={value} type="button" disabled={methodLocked && method !== value} onClick={() => { setDirty(true); setMethod(value); }} className={cn("flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45", method === value ? "border-primary/60 bg-primary/10 text-primary" : "border-border/30 text-muted-foreground hover:border-primary/30")}><Icon className="h-4 w-4" /><span className="text-center leading-tight">{label}</span></button>)}</div>
    </div>

    {method === "province" ? <div className="space-y-4 border-t border-border/20 p-3 sm:p-4">
      {Boolean(customerId) && (savedAddresses?.length ?? 0) > 0 ? <div><label className="mb-1.5 block text-xs text-muted-foreground">عناوين محفوظة للعميل</label><div className="flex flex-wrap gap-2">{savedAddresses!.map((address) => <button key={address.id} type="button" onClick={() => applySavedAddress(address)} className={cn("min-h-9 rounded-lg border px-2.5 py-1.5 text-xs", savedAddressId === address.id ? "border-primary/60 bg-primary/10 text-primary" : "border-border/30 text-muted-foreground hover:border-primary/30")}>{(address.governorate || "عنوان") + (address.district || address.city ? ` — ${address.district || address.city}` : "")}</button>)}</div></div> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SearchableDeliverySelect label="المحافظة" required value={provinceId ? String(provinceId) : ""} options={provinceOptions} placeholder="اختر المحافظة" searchPlaceholder="ابحث عن محافظة..." emptyLabel="لا توجد محافظة مطابقة" onSelect={selectProvince} />
        <SearchableDeliverySelect label="القضاء / الناحية" required value={selectedDistrict} options={districtOptions} disabled={!provinceId} placeholder={!provinceId ? "اختر المحافظة أولاً" : districtOptions.length ? "اختر القضاء أو الناحية" : "لا توجد مناطق مضافة لهذه المحافظة"} searchPlaceholder="ابحث عن قضاء أو ناحية..." emptyLabel="لا توجد منطقة مطابقة ضمن المحافظة" onSelect={selectDistrict} />
        <Field label="رقم الهاتف" required dir="ltr" value={f.receiverPhone} placeholder="07XX XXX XXXX" onChange={(value) => { setPhoneTouched(true); setAutoFilled(false); setF((previous) => ({ ...previous, receiverPhone: formatIraqiPhoneInput(value) })); }} error={f.receiverPhone.length > 0 && !phoneValid ? "رقم هاتف عراقي غير صحيح" : undefined} hint={autoFilled && !phoneTouched && f.receiverPhone ? <span className="text-[11px] font-medium text-primary">تم نسخه تلقائياً من رقم العميل</span> : undefined} />
        <Field label="اسم المستلم (اختياري)" value={f.receiverName} onChange={(value) => setF((previous) => ({ ...previous, receiverName: value }))} />
      </div>

      <div className="overflow-hidden rounded-lg border border-border/30 bg-background/25">
        <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((value) => !value)} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-sm font-semibold text-foreground"><span>بقية تفاصيل التوصيل</span><ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", detailsOpen && "rotate-180")} /></button>
        {detailsOpen ? <div className="grid grid-cols-1 gap-3 border-t border-border/20 p-3 sm:grid-cols-2">
          <Field label="المنطقة / الحي" value={f.area} onChange={(value) => setF((previous) => ({ ...previous, area: value }))} />
          <Field label="أقرب نقطة دالة" value={f.landmark} onChange={(value) => setF((previous) => ({ ...previous, landmark: value }))} />
          <div className="sm:col-span-2"><Field label="العنوان التفصيلي" value={f.fullAddress} onChange={(value) => setF((previous) => ({ ...previous, fullAddress: value }))} /></div>
          <Field label="شركة التوصيل" value={f.deliveryCompany} placeholder={province?.deliveryCompany ?? ""} onChange={(value) => setF((previous) => ({ ...previous, deliveryCompany: value }))} />
          <Field label="أجرة التوصيل" value={formatCurrency(quote.fee)} readOnly hint={quote.freeApplied ? <span className="text-[11px] text-status-success">تم تطبيق حد التوصيل المجاني</span> : <span className="text-[11px] text-muted-foreground">تُحتسب من إعدادات المحافظة وتُراجع في الخادم</span>} />
          <SelectField label="طريقة الاستلام" value={deliveryType} onChange={setDeliveryType} options={DELIVERY_TYPES} />
          <SelectField label="حالة التوصيل" value={deliveryStatus} disabled onChange={() => undefined} options={[{ value: deliveryStatus, label: initialValue?.order?.statusLabel || STATUS_LABELS[deliveryStatus] || deliveryStatus }]} hint="تُحدّث الحالة من مركز التوصيل بعد حفظ الفاتورة" />
          <SelectField label="من يتحمل أجرة التوصيل" value={f.feePaidBy} onChange={(value) => setF((previous) => ({ ...previous, feePaidBy: value }))} options={[{ value: "customer", label: "العميل" }, { value: "store", label: "المحل" }]} />
          <div className="sm:col-span-2"><Field label="ملاحظات التوصيل" value={f.notes} onChange={(value) => setF((previous) => ({ ...previous, notes: value }))} /></div>
          <div className="flex flex-wrap gap-x-4 gap-y-3 sm:col-span-2"><Toggle label="قابل للكسر" checked={isFragile} onChange={setIsFragile} /><Toggle label="يحتاج تبريد" checked={needsRefrigeration} onChange={setNeedsRefrigeration} /><Toggle label="الدفع عند الاستلام" checked={codEnabled} onChange={setCodEnabled} />{Boolean(customerId) ? <Toggle label="حفظ العنوان للعميل" checked={saveAddress} onChange={setSaveAddress} /> : null}</div>
          <p className="text-xs text-muted-foreground sm:col-span-2">الوصول المتوقع: {quote.days} يوم ({addDaysIso(quote.days)}){codEnabled && quote.codFee > 0 ? ` · أجرة الدفع عند الاستلام ${formatCurrency(quote.codFee)}` : ""}</p>
        </div> : null}
      </div>
      {!provinceComplete ? <p className="text-xs text-status-danger">اختر المحافظة والقضاء أو الناحية وأدخل رقم هاتف عراقي صحيح للمتابعة.</p> : null}
    </div> : null}
  </div>;
}

function SearchableDeliverySelect({ label, value, options, onSelect, placeholder, searchPlaceholder, emptyLabel, required, disabled }: { label: string; value: string; options: SearchOption[]; onSelect: (value: string) => void; placeholder: string; searchPlaceholder: string; emptyLabel: string; required?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return <div><label className="mb-1.5 block text-xs text-muted-foreground">{label} {required ? <span className="text-status-danger">*</span> : null}</label><Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="min-h-11 w-full justify-between border-border/40 bg-background px-3 font-normal"><span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.label || placeholder}</span><ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" /></Button></PopoverTrigger><PopoverContent align="start" dir="rtl" className="w-[var(--radix-popover-trigger-width)] p-0"><Command><CommandInput placeholder={searchPlaceholder} /><CommandList><CommandEmpty>{emptyLabel}</CommandEmpty><CommandGroup>{options.map((option) => <CommandItem key={option.value} value={`${option.label} ${option.keywords || ""}`} onSelect={() => { onSelect(option.value); setOpen(false); }} className="min-h-10"><Check className={cn("h-4 w-4", value === option.value ? "opacity-100" : "opacity-0")} /><span>{option.label}</span></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover></div>;
}

function Field({ label, value, onChange, required, dir, error, placeholder, hint, readOnly }: { label: string; value: string; onChange?: (value: string) => void; required?: boolean; dir?: "ltr" | "rtl"; error?: string; placeholder?: string; hint?: ReactNode; readOnly?: boolean }) {
  return <div><label className="mb-1.5 block text-xs text-muted-foreground">{label} {required ? <span className="text-status-danger">*</span> : null}</label><input value={value} dir={dir} readOnly={readOnly} placeholder={placeholder} onChange={(event) => onChange?.(event.target.value)} className={cn(FIELD_CLS, error && "border-status-danger", readOnly && "bg-muted/35")} />{error ? <p className="mt-1 text-[11px] text-status-danger">{error}</p> : null}{!error && hint ? <div className="mt-1">{hint}</div> : null}</div>;
}

function SelectField({ label, value, onChange, options, disabled, hint }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; disabled?: boolean; hint?: string }) {
  return <div><label className="mb-1.5 block text-xs text-muted-foreground">{label}</label><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={FIELD_CLS}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}</div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex min-h-10 cursor-pointer items-center gap-2 text-xs"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-primary" /><span className="text-foreground">{label}</span></label>;
}
