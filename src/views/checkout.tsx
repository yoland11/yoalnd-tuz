import { useState } from "react";
import { useLocation } from "wouter";
import {
  useGetCart,
  useCreateOrder,
  useListDeliveryZones,
  getGetCartQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CheckCircle, Package, MapPin, ExternalLink } from "lucide-react";
import { formatIraqiPhoneInput, normalizeIraqiPhone } from "@/lib/phone";

export default function Checkout() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data: cart } = useGetCart();
  const { data: zones } = useListDeliveryZones();
  const createOrder = useCreateOrder();

  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    governorate: "",
    area: "",
    address: "",
    notes: "",
    paymentMethod: "cod",
    deliveryZoneId: 0,
    mapsUrl: "",
  });
  const [completedOrder, setCompletedOrder] = useState<{ trackingCode: string; total: number } | null>(null);
  const [geoState, setGeoState] = useState<"idle" | "loading" | "ok" | "denied">("idle");
  const [geoError, setGeoError] = useState<string>("");

  function detectLocation() {
    if (!navigator.geolocation) {
      setGeoState("denied");
      setGeoError("المتصفح لا يدعم تحديد الموقع — أدخل الرابط يدوياً");
      return;
    }
    setGeoState("loading");
    setGeoError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const url = `https://www.google.com/maps?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
        setForm(f => ({ ...f, mapsUrl: url }));
        setGeoState("ok");
      },
      (err) => {
        setGeoState("denied");
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "تم رفض الإذن — يمكنك لصق رابط Google Maps يدوياً"
            : "تعذّر تحديد الموقع — يمكنك لصق رابط Google Maps يدوياً"
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  const selectedZone = zones?.find(z => z.id === form.deliveryZoneId);
  const deliveryFee = selectedZone ? selectedZone.price : 0;
  const subtotal = Number(cart?.total ?? 0);
  const total = subtotal + Number(deliveryFee);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    const nextValue = name === "customerPhone" ? formatIraqiPhoneInput(value) : value;
    setForm(f => ({
      ...f,
      [name]: name === "deliveryZoneId" ? parseInt(value) : nextValue,
      ...(name === "deliveryZoneId" ? { governorate: zones?.find(z => z.id === parseInt(value))?.governorateAr ?? "", area: "" } : {}),
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const customerPhone = normalizeIraqiPhone(form.customerPhone);
    if (!customerPhone) {
      alert("أدخل رقم عراقي صحيح مثل 07700000000");
      return;
    }
    createOrder.mutate(
      {
        data: {
          customerName: form.customerName,
          customerPhone,
          governorate: form.governorate,
          area: form.area || undefined,
          address: form.address,
          notes: form.notes,
          paymentMethod: form.paymentMethod as "cod" | "transfer" | "paid",
          deliveryZoneId: form.deliveryZoneId || undefined,
          mapsUrl: form.mapsUrl.trim() || undefined,
        },
      },
      {
        onSuccess: (order) => {
          queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
          setCompletedOrder({ trackingCode: order.trackingCode, total: Number(order.total) });
        },
      }
    );
  }

  if (completedOrder) {
    return (
      <div className="container mx-auto px-4 py-20 text-center" dir="rtl">
        <div className="max-w-md mx-auto bg-card rounded-2xl border border-border/30 p-10">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-foreground mb-2">تم إنشاء طلبك بنجاح!</h2>
          <p className="text-muted-foreground mb-6">يمكنك تتبع طلبك برمز التتبع أدناه</p>
          <div className="bg-background rounded-xl border border-primary/30 px-6 py-4 mb-6">
            <p className="text-xs text-muted-foreground mb-1">رمز التتبع</p>
            <p className="text-3xl font-mono font-bold text-primary tracking-widest">{completedOrder.trackingCode}</p>
          </div>
          <p className="text-muted-foreground text-sm mb-8">
            إجمالي الطلب: <span className="text-foreground font-bold">{completedOrder.total.toLocaleString('ar-IQ')} د.ع</span>
          </p>
          <div className="flex gap-3">
            <Button className="flex-1" onClick={() => navigate(`/track?code=${completedOrder.trackingCode}`)}>
              تتبع الطلب
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => navigate("/store")}>
              العودة للمتجر
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-10 min-h-screen" dir="rtl">
      <h1 className="text-3xl font-bold text-foreground mb-8 flex items-center gap-3">
        <Package className="w-7 h-7 text-primary" />
        إتمام الطلب
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form */}
        <form onSubmit={handleSubmit} className="lg:col-span-2 space-y-5">
          <div className="bg-card rounded-xl border border-border/30 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground mb-2">بيانات التواصل</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">الاسم الكامل *</label>
                <input
                  name="customerName"
                  value={form.customerName}
                  onChange={handleChange}
                  required
                  className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                  placeholder="محمد أحمد"
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">رقم الهاتف *</label>
                <input
                  name="customerPhone"
                  value={form.customerPhone}
                  onChange={handleChange}
                  required
                  type="tel"
                  inputMode="numeric"
                  className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                  placeholder="07700000000"
                />
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border/30 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground mb-2">بيانات التوصيل</h2>
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">المحافظة *</label>
              <select
                name="deliveryZoneId"
                value={form.deliveryZoneId}
                onChange={handleChange}
                required
                className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground focus:outline-none focus:border-primary/50 transition-colors"
              >
                <option value={0}>اختر المحافظة</option>
                {zones?.filter(z => z.isActive).map(z => (
                  <option key={z.id} value={z.id}>
                    {z.governorateAr} — {Number(z.price).toLocaleString('ar-IQ')} د.ع ({z.estimatedDays} أيام)
                  </option>
                ))}
              </select>
            </div>
            {selectedZone?.areas && selectedZone.areas.length > 0 && (
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">المنطقة / الحي</label>
                <select
                  name="area"
                  value={form.area}
                  onChange={handleChange}
                  className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground focus:outline-none focus:border-primary/50 transition-colors"
                >
                  <option value="">اختر المنطقة</option>
                  {selectedZone.areas.map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">العنوان التفصيلي</label>
              <input
                name="address"
                value={form.address}
                onChange={handleChange}
                className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="الحي، الشارع، رقم المنزل"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> رابط الموقع على Google Maps (اختياري لكن يُسرّع التوصيل)
              </label>
              <div className="flex gap-2 mb-2 flex-wrap">
                <button
                  type="button"
                  onClick={detectLocation}
                  disabled={geoState === "loading"}
                  className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors disabled:opacity-60"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  {geoState === "loading" ? "جاري التحديد..." : geoState === "ok" ? "تم تحديد موقعك ✓" : "حدد موقعي تلقائياً"}
                </button>
                {form.mapsUrl && (
                  <a href={form.mapsUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border/40 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
                    <ExternalLink className="w-3.5 h-3.5" /> معاينة الرابط
                  </a>
                )}
              </div>
              <input
                name="mapsUrl"
                value={form.mapsUrl}
                onChange={handleChange}
                type="url"
                inputMode="url"
                dir="ltr"
                className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors text-sm"
                placeholder="https://www.google.com/maps?q=..."
              />
              {geoError && (
                <p className="text-xs text-amber-400 mt-1.5">{geoError}</p>
              )}
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">ملاحظات</label>
              <textarea
                name="notes"
                value={form.notes}
                onChange={handleChange}
                rows={3}
                className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors resize-none"
                placeholder="أي تعليمات خاصة..."
              />
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border/30 p-6 space-y-3">
            <h2 className="text-lg font-semibold text-foreground mb-2">طريقة الدفع</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { v: "cod", label: "الدفع عند الاستلام", desc: "ادفع كاش للموصِّل" },
                { v: "transfer", label: "حوالة (زين كاش / آسيا)", desc: "نتواصل معك بالتفاصيل" },
                { v: "paid", label: "مدفوع مسبقاً", desc: "تم الدفع — أرفق الإيصال في الملاحظات" },
              ].map(opt => (
                <label key={opt.v} className={`cursor-pointer rounded-xl border p-3 text-sm transition-colors ${form.paymentMethod === opt.v ? "border-primary bg-primary/5" : "border-border/40 hover:border-primary/40"}`}>
                  <input type="radio" name="paymentMethod" value={opt.v}
                    checked={form.paymentMethod === opt.v}
                    onChange={handleChange}
                    className="sr-only" />
                  <p className="text-foreground font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{opt.desc}</p>
                </label>
              ))}
            </div>
          </div>

          <Button type="submit" className="w-full py-5 text-base" disabled={createOrder.isPending}>
            {createOrder.isPending ? "جاري تأكيد الطلب..." : "تأكيد الطلب"}
          </Button>
        </form>

        {/* Summary */}
        <div className="lg:col-span-1">
          <div className="bg-card rounded-xl border border-border/30 p-6 sticky top-6">
            <h2 className="text-lg font-bold text-foreground mb-4">ملخص الطلب</h2>
            <div className="space-y-2 mb-4">
              {cart?.items?.map(item => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-muted-foreground truncate max-w-[60%]">
                    {item.product?.nameAr} × {item.quantity}
                  </span>
                  <span className="text-foreground">{(Number(item.price) * item.quantity).toLocaleString('ar-IQ')}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border/30 pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">المجموع الفرعي</span>
                <span>{subtotal.toLocaleString('ar-IQ')} د.ع</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">التوصيل</span>
                <span>{Number(deliveryFee).toLocaleString('ar-IQ')} د.ع</span>
              </div>
              <div className="flex justify-between font-bold text-lg border-t border-border/30 pt-2 mt-2">
                <span className="text-foreground">الإجمالي</span>
                <span className="text-primary">{total.toLocaleString('ar-IQ')} د.ع</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
