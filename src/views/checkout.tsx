import { useEffect, useState } from "react";
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
import { SelectedColorLabel } from "@/components/product-colors";
import { CelebrationEffect } from "@/components/interactive/celebration-effect";
import { LocationMapCard } from "@/components/interactive/location-map-card";
import { SmartSuggestions } from "@/components/interactive/smart-suggestions";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/lib/i18n";

export default function Checkout() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const t = useT();
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
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discountAmount: number; message: string } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [rewards, setRewards] = useState<{ points: number; redeemValue: number } | null>(null);
  const [redeemPoints, setRedeemPoints] = useState("0");

  useEffect(() => {
    let alive = true;
    fetch("/api/customer/rewards", { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (alive && data) setRewards({ points: Number(data.points) || 0, redeemValue: Number(data.redeemValue) || 1000 }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  function detectLocation() {
    if (!navigator.geolocation) {
      setGeoState("denied");
      setGeoError(t("المتصفح لا يدعم تحديد الموقع — أدخل الرابط يدوياً"));
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
            ? t("تم رفض الإذن — يمكنك لصق رابط Google Maps يدوياً")
            : t("تعذّر تحديد الموقع — يمكنك لصق رابط Google Maps يدوياً")
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  const selectedZone = zones?.find(z => z.id === form.deliveryZoneId);
  const deliveryFee = selectedZone ? selectedZone.price : 0;
  const subtotal = Number(cart?.total ?? 0);
  const couponDiscount = coupon?.discountAmount ?? 0;
  const maxRedeemPoints = rewards ? Math.min(rewards.points, Math.floor(Math.max(subtotal + Number(deliveryFee) - couponDiscount, 0) / rewards.redeemValue)) : 0;
  const safeRedeemPoints = Math.min(Math.max(Number.parseInt(redeemPoints, 10) || 0, 0), maxRedeemPoints);
  const redeemDiscount = rewards ? safeRedeemPoints * rewards.redeemValue : 0;
  const total = Math.max(subtotal + Number(deliveryFee) - couponDiscount - redeemDiscount, 0);

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
      alert(t("أدخل رقم عراقي صحيح مثل 07700000000"));
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
          couponCode: coupon?.code,
          redeemPoints: safeRedeemPoints || undefined,
          mapsUrl: form.mapsUrl.trim() || undefined,
        },
      },
      {
        onSuccess: (order) => {
          queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
          setCompletedOrder({ trackingCode: order.trackingCode, total: Number(order.total) });
        },
        onError: (err: any) => toast({ title: t("تعذر إنشاء الطلب"), description: err?.message, variant: "destructive" }),
      }
    );
  }

  async function applyCoupon() {
    setCouponError("");
    setCoupon(null);
    if (!couponCode.trim()) {
      setCouponError(t("أدخل كود الخصم"));
      return;
    }
    setCouponLoading(true);
    try {
      const res = await fetch("/api/coupons/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: couponCode, subtotal, deliveryFee }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? t("تعذر تطبيق الكوبون"));
      setCoupon({ code: data.code, discountAmount: Number(data.discountAmount) || 0, message: data.message ?? t("تم تطبيق الكوبون") });
      setCouponCode(data.code);
    } catch (err: any) {
      setCouponError(err?.message ?? t("تعذر تطبيق الكوبون"));
    } finally {
      setCouponLoading(false);
    }
  }

  if (completedOrder) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <CelebrationEffect active storageKey={`ajn-checkout-${completedOrder.trackingCode}`} message={t("تم إنشاء طلبك بنجاح")} />
        <div className="max-w-md mx-auto bg-card rounded-2xl border border-border/30 p-10">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-foreground mb-2">{t("تم إنشاء طلبك بنجاح!")}</h2>
          <p className="text-muted-foreground mb-6">{t("يمكنك تتبع طلبك برمز التتبع أدناه")}</p>
          <div className="bg-background rounded-xl border border-primary/30 px-6 py-4 mb-6">
            <p className="text-xs text-muted-foreground mb-1">{t("رمز التتبع")}</p>
            <p className="text-3xl font-mono font-bold text-primary tracking-widest">{completedOrder.trackingCode}</p>
          </div>
          <p className="text-muted-foreground text-sm mb-8">
            {t("إجمالي الطلب:")} <span className="text-foreground font-bold">{completedOrder.total.toLocaleString('ar-IQ')} د.ع</span>
          </p>
          <div className="flex gap-3">
            <Button className="flex-1" onClick={() => navigate(`/track?code=${completedOrder.trackingCode}`)}>
              {t("تتبع الطلب")}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => navigate("/store")}>
              {t("العودة للمتجر")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-10 min-h-screen">
      <h1 className="text-3xl font-bold text-foreground mb-8 flex items-center gap-3">
        <Package className="w-7 h-7 text-primary" />
        {t("إتمام الطلب")}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form */}
        <form onSubmit={handleSubmit} className="lg:col-span-2 space-y-5">
          <div className="bg-card rounded-xl border border-border/30 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground mb-2">{t("بيانات التواصل")}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">{t("الاسم الكامل")}</label>
                <input
                  name="customerName"
                  value={form.customerName}
                  onChange={handleChange}
                  className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                  placeholder={t("محمد أحمد")}
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">{t("رقم الهاتف")}</label>
                <input
                  name="customerPhone"
                  value={form.customerPhone}
                  onChange={handleChange}
                  type="tel"
                  inputMode="numeric"
                  className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                  placeholder="07700000000"
                />
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border/30 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground mb-2">{t("بيانات التوصيل")}</h2>
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">{t("المحافظة")}</label>
              <select
                name="deliveryZoneId"
                value={form.deliveryZoneId}
                onChange={handleChange}
                className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground focus:outline-none focus:border-primary/50 transition-colors"
              >
                <option value={0}>{t("اختر المحافظة")}</option>
                {zones?.filter(z => z.isActive).map(z => (
                  <option key={z.id} value={z.id}>
                    {z.governorateAr} — {Number(z.price).toLocaleString('ar-IQ')} د.ع ({z.estimatedDays} {t("أيام")})
                  </option>
                ))}
              </select>
            </div>
            {selectedZone?.areas && selectedZone.areas.length > 0 && (
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">{t("المنطقة / الحي")}</label>
                <select
                  name="area"
                  value={form.area}
                  onChange={handleChange}
                  className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground focus:outline-none focus:border-primary/50 transition-colors"
                >
                  <option value="">{t("اختر المنطقة")}</option>
                  {selectedZone.areas.map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">{t("العنوان التفصيلي")}</label>
              <input
                name="address"
                value={form.address}
                onChange={handleChange}
                className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                placeholder={t("الحي، الشارع، رقم المنزل")}
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> {t("رابط الموقع على Google Maps (اختياري لكن يُسرّع التوصيل)")}
              </label>
              <div className="flex gap-2 mb-2 flex-wrap">
                <button
                  type="button"
                  onClick={detectLocation}
                  disabled={geoState === "loading"}
                  className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors disabled:opacity-60"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  {geoState === "loading" ? t("جاري التحديد...") : geoState === "ok" ? t("تم تحديد موقعك ✓") : t("حدد موقعي تلقائياً")}
                </button>
                {form.mapsUrl && (
                  <a href={form.mapsUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border/40 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
                    <ExternalLink className="w-3.5 h-3.5" /> {t("معاينة الرابط")}
                  </a>
                )}
              </div>
              <input
                name="mapsUrl"
                value={form.mapsUrl}
                onChange={handleChange}
                type="text"
                inputMode="url"
                dir="ltr"
                className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors text-sm"
                placeholder="https://www.google.com/maps?q=..."
              />
              {geoError && (
                <p className="text-xs text-amber-400 mt-1.5">{geoError}</p>
              )}
              <LocationMapCard mapUrl={form.mapsUrl || null} address={form.address || null} title={t("موقع التوصيل")} compact className="mt-3" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">{t("ملاحظات")}</label>
              <textarea
                name="notes"
                value={form.notes}
                onChange={handleChange}
                rows={3}
                className="w-full bg-background border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors resize-none"
                placeholder={t("أي تعليمات خاصة...")}
              />
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border/30 p-6 space-y-3">
            <h2 className="text-lg font-semibold text-foreground mb-2">{t("طريقة الدفع")}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { v: "cod", label: t("الدفع عند الاستلام"), desc: t("ادفع كاش للموصِّل") },
                { v: "transfer", label: t("حوالة (زين كاش / آسيا)"), desc: t("نتواصل معك بالتفاصيل") },
                { v: "paid", label: t("مدفوع مسبقاً"), desc: t("تم الدفع — أرفق الإيصال في الملاحظات") },
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
            {createOrder.isPending ? t("جاري تأكيد الطلب...") : t("تأكيد الطلب")}
          </Button>
        </form>

        {/* Summary */}
        <div className="lg:col-span-1">
          <div className="bg-card rounded-xl border border-border/30 p-6 sticky top-6">
            <h2 className="text-lg font-bold text-foreground mb-4">{t("ملخص الطلب")}</h2>
            <div className="space-y-2 mb-4">
              {cart?.items?.map(item => (
                <div key={item.id} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 text-muted-foreground">
                    <span className="block truncate">{item.product?.nameAr} × {item.quantity}</span>
                    <SelectedColorLabel color={(item as any).selectedColorData} fallback={item.selectedColor} className="mt-1 flex text-[11px] text-muted-foreground" />
                  </span>
                  <span className="text-foreground">{(Number(item.price) * item.quantity).toLocaleString('ar-IQ')}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border/30 pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("المجموع الفرعي")}</span>
                <span>{subtotal.toLocaleString('ar-IQ')} د.ع</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("التوصيل")}</span>
                <span>{Number(deliveryFee).toLocaleString('ar-IQ')} د.ع</span>
              </div>
              {coupon && (
                <div className="flex justify-between text-sm text-green-400">
                  <span>{t("كوبون")} {coupon.code}</span>
                  <span>- {coupon.discountAmount.toLocaleString("ar-IQ")} د.ع</span>
                </div>
              )}
              {rewards && rewards.points > 0 && (
                <div className="rounded-lg border border-border/30 bg-background/50 p-2 space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t("نقاطك:")} {rewards.points.toLocaleString("ar-IQ")}</span>
                    <span>{t("أقصى صرف:")} {maxRedeemPoints.toLocaleString("ar-IQ")}</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={maxRedeemPoints}
                    value={redeemPoints}
                    onChange={(e) => setRedeemPoints(e.target.value)}
                    className="w-full bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                    dir="ltr"
                    placeholder={t("نقاط للصرف")}
                  />
                  {redeemDiscount > 0 && (
                    <div className="flex justify-between text-sm text-primary">
                      <span>{t("خصم النقاط")}</span>
                      <span>- {redeemDiscount.toLocaleString("ar-IQ")} د.ع</span>
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-lg border border-border/30 bg-background/50 p-2 space-y-2">
                <div className="flex gap-2">
                  <input
                    value={couponCode}
                    onChange={(e) => { setCouponCode(e.target.value.toUpperCase().replace(/\s+/g, "")); setCoupon(null); setCouponError(""); }}
                    placeholder={t("كود الخصم")}
                    className="flex-1 bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={applyCoupon}
                    disabled={couponLoading || subtotal <= 0}
                    className="rounded-lg border border-primary/40 px-3 py-2 text-xs text-primary hover:bg-primary/10 disabled:opacity-50"
                  >
                    {couponLoading ? "..." : t("تطبيق")}
                  </button>
                </div>
                {couponError && <p className="text-xs text-red-400">{couponError}</p>}
                {coupon && <p className="text-xs text-green-400">{coupon.message}</p>}
              </div>
              <div className="flex justify-between font-bold text-lg border-t border-border/30 pt-2 mt-2">
                <span className="text-foreground">{t("الإجمالي")}</span>
                <span className="text-primary">{total.toLocaleString('ar-IQ')} د.ع</span>
              </div>
              {total > 0 && (
                <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
                  {t("بعد اكتمال الطلب تُضاف تقريباً")} <span className="font-semibold text-primary">{Math.max(1, Math.floor(total / 10000)).toLocaleString("ar-IQ")}</span> {t("نقطة إلى حسابك.")}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-8">
        <SmartSuggestions title={t("اقتراحات قبل تأكيد الطلب")} />
      </div>
    </div>
  );
}
