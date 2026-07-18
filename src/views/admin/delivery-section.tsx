import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, MapPin, PackageCheck, Store, Truck } from "lucide-react";
import { adminFetch, formatCurrency } from "./_lib";
import { useProvinces, type Province } from "./delivery-provinces";

// ─── Public contract (parent reads this) ─────────────────────────────────────

export type DeliveryMethod = "pickup" | "city" | "province";

export type DeliveryOutput = {
  method: DeliveryMethod;
  deliveryFee: number;
  codFee: number;
  codEnabled: boolean;
  /** false when province is chosen but required fields are incomplete. */
  valid: boolean;
  /** The `delivery` object to send with the invoice, or null for plain pickup. */
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

const DELIVERY_TYPES: Array<{ value: string; label: string }> = [
  { value: "standard", label: "عادي" },
  { value: "express", label: "سريع" },
  { value: "same_day", label: "نفس اليوم" },
  { value: "office_pickup", label: "استلام من مكتب شركة التوصيل" },
  { value: "door", label: "توصيل إلى باب المنزل" },
];

const TYPE_LABEL = new Map(DELIVERY_TYPES.map((t) => [t.value, t.label]));

type SavedAddress = {
  id: number;
  provinceId: number | null;
  governorate: string;
  city: string;
  district: string;
  area: string;
  address: string;
  landmark: string;
  fullName: string;
  phone: string;
  altPhone: string | null;
  mapsUrl: string | null;
};

const IRAQI_PHONE = /^(009647|9647|07|7)\d{8,9}$/;

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Mirrors the server's resolveDeliveryFee for live display; server is authoritative. */
function quoteFee(province: Province | undefined, type: string, subtotal: number, cod: boolean) {
  if (!province) return { fee: 0, codFee: 0, days: 0, freeApplied: false };
  const standard = province.price || 0;
  const base =
    type === "express"
      ? province.expressFee > 0
        ? province.expressFee
        : standard
      : type === "same_day"
        ? province.sameDayFee > 0
          ? province.sameDayFee
          : standard
        : standard;
  const freeApplied = province.freeDeliveryThreshold > 0 && subtotal >= province.freeDeliveryThreshold;
  return {
    fee: freeApplied ? 0 : base,
    codFee: cod ? province.codFee || 0 : 0,
    days: province.estimatedDays,
    freeApplied,
  };
}

const FIELD_CLS =
  "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function DeliverySection({
  subtotal,
  customerId,
  onChange,
}: {
  subtotal: number;
  customerId?: number | null;
  onChange: (output: DeliveryOutput) => void;
}) {
  const [method, setMethod] = useState<DeliveryMethod>("pickup");
  const [open, setOpen] = useState(false);
  const [provinceId, setProvinceId] = useState<number | null>(null);
  const [provinceSearch, setProvinceSearch] = useState("");
  const [deliveryType, setDeliveryType] = useState("standard");
  const [f, setF] = useState({
    city: "", district: "", area: "", landmark: "", fullAddress: "", mapsUrl: "",
    receiverName: "", receiverPhone: "", receiverAltPhone: "", deliveryCompany: "",
    feePaidBy: "customer", preferredTime: "", notes: "",
  });
  const [codEnabled, setCodEnabled] = useState(false);
  const [isFragile, setIsFragile] = useState(false);
  const [needsRefrigeration, setNeedsRefrigeration] = useState(false);
  const [saveAddress, setSaveAddress] = useState(false);
  const [savedAddressId, setSavedAddressId] = useState<number | null>(null);

  const { data: provinces } = useProvinces(true);
  const province = useMemo(() => provinces?.find((p) => p.id === provinceId), [provinces, provinceId]);

  const { data: savedAddresses } = useQuery<SavedAddress[]>({
    queryKey: ["admin", "customer-addresses", customerId],
    queryFn: () => adminFetch(`/admin/customers/${customerId}/addresses`),
    enabled: Boolean(customerId) && method === "province",
  });

  const filteredProvinces = useMemo(() => {
    const q = provinceSearch.trim();
    const list = provinces ?? [];
    if (!q) return list;
    return list.filter(
      (p) => p.governorateAr.includes(q) || p.governorate.toLowerCase().includes(q.toLowerCase()),
    );
  }, [provinces, provinceSearch]);

  const quote = quoteFee(province, deliveryType, subtotal, codEnabled);

  const phoneValid = IRAQI_PHONE.test(f.receiverPhone.replace(/\s/g, ""));
  const provinceComplete =
    method !== "province" ||
    Boolean(
      provinceId && f.city.trim() && f.area.trim() && f.fullAddress.trim() && f.receiverName.trim() && phoneValid,
    );

  // Report the current output up whenever anything relevant changes.
  useEffect(() => {
    if (method === "pickup") {
      onChange({ method, deliveryFee: 0, codFee: 0, codEnabled: false, valid: true, payload: null, summary: null });
      return;
    }
    const payload =
      method === "province"
        ? {
            method,
            provinceId,
            customerAddressId: savedAddressId,
            saveAddressToCustomer: saveAddress,
            city: f.city, district: f.district, area: f.area, landmark: f.landmark,
            fullAddress: f.fullAddress, mapsUrl: f.mapsUrl || null,
            receiverName: f.receiverName, receiverPhone: f.receiverPhone,
            receiverAltPhone: f.receiverAltPhone || null,
            deliveryCompany: f.deliveryCompany || province?.deliveryCompany || null,
            deliveryType, feePaidBy: f.feePaidBy, codEnabled,
            expectedShipDate: addDaysIso(0),
            expectedArrivalDate: addDaysIso(quote.days),
            preferredTime: f.preferredTime || null, notes: f.notes || null,
            isFragile, needsRefrigeration,
          }
        : { method, deliveryFee: 0, feePaidBy: f.feePaidBy, notes: f.notes || null };

    onChange({
      method,
      deliveryFee: method === "province" ? quote.fee : 0,
      codFee: method === "province" ? quote.codFee : 0,
      codEnabled: method === "province" ? codEnabled : false,
      valid: provinceComplete,
      payload,
      summary:
        method === "province"
          ? {
              receiverName: f.receiverName, receiverPhone: f.receiverPhone,
              provinceName: province?.governorateAr ?? "", city: f.city,
              address: f.fullAddress,
              company: f.deliveryCompany || province?.deliveryCompany || "",
              typeLabel: TYPE_LABEL.get(deliveryType) ?? deliveryType,
              arrival: addDaysIso(quote.days),
            }
          : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    method, provinceId, deliveryType, f, codEnabled, isFragile, needsRefrigeration,
    saveAddress, savedAddressId, quote.fee, quote.codFee, provinceComplete,
  ]);

  function applySavedAddress(a: SavedAddress) {
    setSavedAddressId(a.id);
    if (a.provinceId) setProvinceId(a.provinceId);
    setF((prev) => ({
      ...prev,
      city: a.city || "", district: a.district || "", area: a.area || "",
      landmark: a.landmark || "", fullAddress: a.address || "", mapsUrl: a.mapsUrl || "",
      receiverName: a.fullName || prev.receiverName, receiverPhone: a.phone || prev.receiverPhone,
      receiverAltPhone: a.altPhone || "",
    }));
  }

  return (
    <div className="rounded-xl border border-border/30 bg-card overflow-hidden" dir="rtl">
      <div className="p-3 sm:p-4 space-y-3">
        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Truck className="w-4 h-4 text-primary" /> طريقة الاستلام <span className="text-status-danger">*</span>
        </p>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["pickup", "استلام من المحل", Store],
              ["city", "توصيل داخل المدينة", PackageCheck],
              ["province", "توصيل إلى محافظة", Truck],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMethod(value);
                if (value === "province") setOpen(true);
              }}
              className={`flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-xs font-medium transition-colors ${
                method === value
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border/30 text-muted-foreground hover:border-primary/30"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-center leading-tight">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {method === "province" && (
        <div className="border-t border-border/20">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full flex items-center justify-between p-3 sm:p-4 text-sm font-semibold text-foreground"
          >
            <span className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" /> تفاصيل توصيل المحافظة
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>

          {open && (
            <div className="p-3 sm:p-4 pt-0 space-y-3">
              {Boolean(customerId) && (savedAddresses?.length ?? 0) > 0 && (
                <div>
                  <label className="block text-xs text-muted-foreground mb-1.5">عناوين محفوظة للعميل</label>
                  <div className="flex gap-2 flex-wrap">
                    {savedAddresses!.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => applySavedAddress(a)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                          savedAddressId === a.id
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-border/30 text-muted-foreground hover:border-primary/30"
                        }`}
                      >
                        {(a.governorate || "عنوان") + (a.city ? ` — ${a.city}` : "")}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">
                  المحافظة <span className="text-status-danger">*</span>
                </label>
                <input
                  value={provinceSearch}
                  onChange={(e) => setProvinceSearch(e.target.value)}
                  placeholder="ابحث عن محافظة..."
                  className={`${FIELD_CLS} mb-2`}
                />
                <div className="flex gap-1.5 flex-wrap max-h-32 overflow-y-auto">
                  {filteredProvinces.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setProvinceId(p.id);
                        setSavedAddressId(null);
                      }}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                        provinceId === p.id
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-border/30 text-muted-foreground hover:border-primary/30"
                      }`}
                    >
                      {p.governorateAr}
                    </button>
                  ))}
                  {filteredProvinces.length === 0 && <span className="text-xs text-muted-foreground">لا نتائج</span>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="القضاء / المدينة" required value={f.city} onChange={(v) => setF({ ...f, city: v })} />
                <Field label="الناحية" value={f.district} onChange={(v) => setF({ ...f, district: v })} />
                <Field label="الحي / المنطقة" required value={f.area} onChange={(v) => setF({ ...f, area: v })} />
                <Field label="أقرب نقطة دالة" value={f.landmark} onChange={(v) => setF({ ...f, landmark: v })} />
              </div>
              <Field
                label="العنوان التفصيلي"
                required
                value={f.fullAddress}
                onChange={(v) => setF({ ...f, fullAddress: v })}
              />
              <Field label="رابط Google Maps" value={f.mapsUrl} onChange={(v) => setF({ ...f, mapsUrl: v })} dir="ltr" />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field
                  label="اسم المستلم"
                  required
                  value={f.receiverName}
                  onChange={(v) => setF({ ...f, receiverName: v })}
                />
                <Field
                  label="رقم هاتف المستلم"
                  required
                  dir="ltr"
                  value={f.receiverPhone}
                  onChange={(v) => setF({ ...f, receiverPhone: v })}
                  error={f.receiverPhone.length > 0 && !phoneValid ? "رقم هاتف عراقي غير صحيح" : undefined}
                />
                <Field
                  label="رقم هاتف بديل"
                  dir="ltr"
                  value={f.receiverAltPhone}
                  onChange={(v) => setF({ ...f, receiverAltPhone: v })}
                />
                <Field
                  label="شركة التوصيل"
                  value={f.deliveryCompany}
                  onChange={(v) => setF({ ...f, deliveryCompany: v })}
                  placeholder={province?.deliveryCompany ?? ""}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1.5">
                    نوع التوصيل <span className="text-status-danger">*</span>
                  </label>
                  <select value={deliveryType} onChange={(e) => setDeliveryType(e.target.value)} className={FIELD_CLS}>
                    {DELIVERY_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1.5">من يتحمل أجور التوصيل</label>
                  <select
                    value={f.feePaidBy}
                    onChange={(e) => setF({ ...f, feePaidBy: e.target.value })}
                    className={FIELD_CLS}
                  >
                    <option value="customer">العميل</option>
                    <option value="store">المحل</option>
                  </select>
                </div>
                <Field
                  label="وقت التوصيل المفضل"
                  value={f.preferredTime}
                  onChange={(v) => setF({ ...f, preferredTime: v })}
                />
              </div>

              <Field label="ملاحظات التوصيل" value={f.notes} onChange={(v) => setF({ ...f, notes: v })} />

              <div className="flex flex-wrap gap-4">
                <Toggle label="قابل للكسر" checked={isFragile} onChange={setIsFragile} />
                <Toggle label="يحتاج تبريد" checked={needsRefrigeration} onChange={setNeedsRefrigeration} />
                <Toggle label="الدفع عند الاستلام" checked={codEnabled} onChange={setCodEnabled} />
                {Boolean(customerId) && (
                  <Toggle label="حفظ هذا العنوان للعميل" checked={saveAddress} onChange={setSaveAddress} />
                )}
              </div>

              {province && (
                <div className="rounded-lg border border-border/20 bg-background/40 p-3 text-sm space-y-1">
                  <Row label="أجور التوصيل" value={formatCurrency(quote.fee)} accent={quote.freeApplied} />
                  {quote.freeApplied && <p className="text-[11px] text-status-success">تجاوز حد التوصيل المجاني</p>}
                  {codEnabled && <Row label="أجور الدفع عند الاستلام" value={formatCurrency(quote.codFee)} />}
                  <Row label="الوصول المتوقع" value={`${quote.days} يوم (${addDaysIso(quote.days)})`} />
                </div>
              )}

              {!provinceComplete && (
                <p className="text-xs text-status-danger">
                  أكمل الحقول الإلزامية (المحافظة، المدينة، الحي، العنوان، اسم ورقم المستلم).
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, required, dir, error, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  dir?: "ltr" | "rtl";
  error?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1.5">
        {label} {required && <span className="text-status-danger">*</span>}
      </label>
      <input
        value={value}
        dir={dir}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD_CLS} ${error ? "border-status-danger" : ""}`}
      />
      {error && <p className="text-[11px] text-status-danger mt-1">{error}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-primary" />
      <span className="text-foreground">{label}</span>
    </label>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${accent ? "text-status-success" : "text-foreground"}`}>{value}</span>
    </div>
  );
}
