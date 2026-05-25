import { useState, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useTrackOrder, getTrackOrderQueryKey,
  useTrackOrdersByPhone, getTrackOrdersByPhoneQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Package, Search, CheckCircle, Phone, Hash, XCircle, MessageCircle, MapPin, Clock, Calendar, CalendarClock,
  CircleDot, ClipboardCheck, PackageCheck, Sparkles, Star, Truck,
} from "lucide-react";
import { getStagesFor, getStageIndex, getStageLabel, buildWhatsAppLink } from "@/lib/order-stages";
import { serviceDetailsToRows } from "@/lib/service-details";
import { formatIraqiPhoneInput, normalizePhoneDigits } from "@/lib/phone";
import { usePublicSettings } from "@/lib/public-settings";
import { SelectedColorLabel } from "@/components/product-colors";
import { CelebrationEffect } from "@/components/interactive/celebration-effect";
import { EventCountdown } from "@/components/interactive/event-countdown";
import { LocationMapCard } from "@/components/interactive/location-map-card";
import { SmartSuggestions } from "@/components/interactive/smart-suggestions";

type Mode = "code" | "phone";

export default function Track() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const prefilledCode = params.get("code") ?? "";

  const [mode, setMode] = useState<Mode>("code");
  const [code, setCode] = useState(prefilledCode);
  const [phone, setPhone] = useState("");
  const [searchCode, setSearchCode] = useState(prefilledCode);
  const [searchPhone, setSearchPhone] = useState("");
  const { data: settings } = usePublicSettings();

  const { data: order, isLoading: loadingCode, error: errorCode } = useTrackOrder(searchCode || "_", {
    query: { queryKey: getTrackOrderQueryKey(searchCode || "_"), enabled: !!searchCode, refetchInterval: searchCode ? 30000 : false },
  });

  const { data: phoneResults, isLoading: loadingPhone } = useTrackOrdersByPhone(searchPhone || "_", {
    query: { queryKey: getTrackOrdersByPhoneQueryKey(searchPhone || "_"), enabled: !!searchPhone, refetchInterval: searchPhone ? 30000 : false },
  });
  const codeResults = Array.isArray(order) ? order : order ? [order] : [];

  useEffect(() => {
    if (prefilledCode) setSearchCode(prefilledCode);
  }, [prefilledCode]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "code") {
      setSearchPhone("");
      setSearchCode(code.trim().toUpperCase());
    } else {
      setSearchCode("");
      const last4 = normalizePhoneDigits(phone).slice(-4);
      if (last4.length === 4) setSearchPhone(last4);
    }
  }

  return (
    <div className="container mx-auto px-4 py-12 min-h-screen" dir="rtl">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <Package className="w-12 h-12 text-primary mx-auto mb-3" />
          <h1 className="text-3xl font-bold text-foreground mb-2">تتبع الطلب</h1>
          <p className="text-muted-foreground">أدخل رمز التتبع أو آخر 4 أرقام من رقم هاتفك</p>
        </div>

        {/* Mode tabs */}
        <div className="grid grid-cols-2 gap-2 mb-4 bg-card border border-border/30 rounded-xl p-1">
          <button
            onClick={() => setMode("code")}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition-colors ${mode === "code" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Hash className="w-4 h-4" /> رمز التتبع
          </button>
          <button
            onClick={() => setMode("phone")}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition-colors ${mode === "phone" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Phone className="w-4 h-4" /> رقم الهاتف
          </button>
        </div>

        {/* Search */}
        <form onSubmit={handleSubmit} className="flex gap-3 mb-10">
          {mode === "code" ? (
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="AJN-2089"
              className="flex-1 bg-card border border-border/40 rounded-xl px-5 py-4 text-foreground text-lg font-mono tracking-wider placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors uppercase"
            />
          ) : (
            <input
              value={phone}
              onChange={e => setPhone(formatIraqiPhoneInput(e.target.value))}
              placeholder="آخر 4 أرقام من رقمك"
              inputMode="numeric"
              className="flex-1 bg-card border border-border/40 rounded-xl px-5 py-4 text-foreground text-lg tracking-wider placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
            />
          )}
          <Button type="submit" size="lg" className="px-6" disabled={loadingCode || loadingPhone}>
            <Search className="w-5 h-5" />
          </Button>
        </form>

        {/* Loading */}
        {(loadingCode || loadingPhone) && (
          <div className="text-center py-12 text-muted-foreground animate-pulse">جاري البحث...</div>
        )}

        {/* Code mode — single order */}
        {mode === "code" && errorCode && searchCode && (
          <div className="text-center py-12 bg-card rounded-xl border border-border/30">
            <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-muted-foreground">لم يتم العثور على طلب برمز: <span className="text-foreground font-mono">{searchCode}</span></p>
          </div>
        )}
        {mode === "code" && codeResults.length > 0 && (
          <div className="space-y-6">
            {codeResults.length > 1 && (
              <p className="text-sm text-muted-foreground text-center">
                يوجد أكثر من طلب بهذا الرمز. اختر الطلب حسب التاريخ والتفاصيل.
              </p>
            )}
            {codeResults.map((o: any, i: number) => (
              <OrderCard key={`${o.kind ?? "order"}-${o.id ?? i}`} tracking={o as any} contactPhone={settings?.whatsapp || settings?.phone} />
            ))}
          </div>
        )}

        {/* Phone mode — list of orders */}
        {mode === "phone" && phoneResults && phoneResults.length === 0 && (
          <div className="text-center py-12 bg-card rounded-xl border border-border/30">
            <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-muted-foreground">لا توجد طلبات مرتبطة بهذا الرقم</p>
          </div>
        )}
        {mode === "phone" && phoneResults && phoneResults.length > 0 && (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground text-center">عدد الطلبات: {phoneResults.length}</p>
            {phoneResults.map((o: any, i: number) => (
              <OrderCard key={`${o.kind ?? "order"}-${o.id ?? i}`} tracking={o as any} contactPhone={settings?.whatsapp || settings?.phone} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTrackDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("ar-IQ", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_TONES: Record<string, string> = {
  pending: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  confirmed: "text-blue-300 border-blue-500/30 bg-blue-500/10",
  processing: "text-primary border-primary/30 bg-primary/10",
  en_route: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  shipped: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  delivered: "text-green-300 border-green-600/30 bg-green-600/10",
  completed: "text-green-300 border-green-600/30 bg-green-600/10",
  cancelled: "text-red-300 border-red-500/30 bg-red-500/10",
};

function StatusIcon({ status, className }: { status: string; className?: string }) {
  const icons: Record<string, typeof CircleDot> = {
    pending: CircleDot,
    confirmed: ClipboardCheck,
    processing: Sparkles,
    en_route: Truck,
    shipped: Truck,
    delivered: PackageCheck,
    completed: PackageCheck,
    cancelled: XCircle,
  };
  const Icon = icons[status] ?? CheckCircle;
  return <Icon className={className} />;
}

function OrderCard({ tracking, contactPhone }: { tracking: any; contactPhone?: string }) {
  const stages = getStagesFor(tracking.serviceType, tracking.kind);
  const currentIdx = getStageIndex(stages, tracking.status);
  const isCancelled = tracking.status === "cancelled";
  const isBooking = tracking.kind === "service";
  const detailRows = serviceDetailsToRows(tracking.serviceType, tracking.customFields);
  const progress = stages.length > 1 ? Math.max(0, Math.min(100, (currentIdx / (stages.length - 1)) * 100)) : 0;
  const heroImage = tracking.kind === "service" ? tracking.serviceImage : tracking.items?.[0]?.image;
  const lastUpdate = tracking.statusHistory?.[0]?.createdAt ?? tracking.createdAt;
  const previousStatus = useRef<string | null>(null);
  const [liveNotice, setLiveNotice] = useState("");
  const { data: recommendations } = useQuery({
    queryKey: ["track", "recommendations"],
    queryFn: async () => {
      const [productsRes, servicesRes] = await Promise.all([fetch("/api/products/featured"), fetch("/api/services")]);
      const [products, services] = await Promise.all([productsRes.json().catch(() => []), servicesRes.json().catch(() => [])]);
      return { products: Array.isArray(products) ? products.slice(0, 2) : [], services: Array.isArray(services) ? services.slice(0, 2) : [] };
    },
    staleTime: 5 * 60_000,
  });

  const waMsg = `استفسار عن الطلب ${tracking.trackingCode}`;
  const waLink = buildWhatsAppLink(contactPhone || "07701234567", waMsg);

  useEffect(() => {
    if (!previousStatus.current) {
      previousStatus.current = tracking.status;
      return undefined;
    }
    if (previousStatus.current !== tracking.status) {
      previousStatus.current = tracking.status;
      setLiveNotice("تم تحديث حالة الطلب الآن");
      const timer = window.setTimeout(() => setLiveNotice(""), 3500);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [tracking.status]);

  return (
    <div className="space-y-6">
      <CelebrationEffect
        active={["delivered", "completed"].includes(tracking.status) || tracking.paymentStatus === "paid"}
        storageKey={`ajn-track-celebration-${tracking.kind ?? "order"}-${tracking.id}-${tracking.status}-${tracking.paymentStatus}`}
        message={tracking.paymentStatus === "paid" ? "تم تسجيل الدفع بنجاح" : "اكتمل طلبك بنجاح"}
      />
      {liveNotice && (
        <div className="rounded-2xl border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
          {liveNotice}
        </div>
      )}
      {isBooking && !isCancelled && <BookingResponseCard tracking={tracking} />}
      {/* Status Header */}
      <div className="bg-card rounded-2xl border border-border/30 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-xl bg-background border border-border/30 overflow-hidden flex items-center justify-center shrink-0">
              {heroImage ? <img src={heroImage} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : <Package className="w-7 h-7 text-primary" />}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">رمز التتبع</p>
              <p className="text-xl font-mono font-bold text-foreground tracking-widest">{tracking.trackingCode}</p>
              <p className="text-[11px] text-muted-foreground mt-1">آخر تحديث: {formatTrackDate(lastUpdate)}</p>
            </div>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${STATUS_TONES[tracking.status] ?? "text-primary border-border/30 bg-background"} ${!isCancelled ? "animate-pulse" : ""}`}>
            <StatusIcon status={tracking.status} className="w-4 h-4" />
            <span className="text-sm font-medium">{getStageLabel(stages, tracking.status)}</span>
          </div>
        </div>
        {!isCancelled && (
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-background border border-border/20">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
        )}
        <div className="flex items-center justify-between text-sm text-muted-foreground flex-wrap gap-2">
          <span>{tracking.customerName}</span>
          {tracking.total > 0 && (
            <span className="text-primary font-bold">{Number(tracking.total).toLocaleString('ar-IQ')} د.ع</span>
          )}
        </div>
        {(Number(tracking.depositAmount ?? 0) > 0 || Number(tracking.remainingAmount ?? 0) > 0) && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-background/60 border border-border/25 p-3">
              <p className="text-muted-foreground mb-1">العربون</p>
              <p className="text-foreground font-semibold">{Number(tracking.depositAmount ?? 0).toLocaleString("ar-IQ")} د.ع</p>
            </div>
            <div className="rounded-lg bg-background/60 border border-border/25 p-3">
              <p className="text-muted-foreground mb-1">المتبقي</p>
              <p className="text-primary font-semibold">{Number(tracking.remainingAmount ?? 0).toLocaleString("ar-IQ")} د.ع</p>
            </div>
            <div className="rounded-lg bg-background/60 border border-border/25 p-3">
              <p className="text-muted-foreground mb-1">حالة الدفع</p>
              <p className="text-foreground font-semibold">{paymentLabel(tracking.paymentStatus)}</p>
            </div>
          </div>
        )}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <a
            href={waLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-green-600/10 text-green-400 border border-green-600/30 hover:bg-green-600/20 transition-colors rounded-lg py-2.5 text-sm font-medium"
          >
            <MessageCircle className="w-4 h-4" /> تواصل عبر واتساب
          </a>
          {tracking.mapsUrl && (
            <a
              href={tracking.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors rounded-lg py-2.5 text-sm font-medium"
            >
              <MapPin className="w-4 h-4" /> فتح الموقع في Google Maps
            </a>
          )}
        </div>
      </div>

      {isBooking && tracking.eventDate && (
        <EventCountdown targetDate={tracking.eventDate} title="متبقي على موعد الحجز" />
      )}

      {isBooking && (tracking.eventDate || tracking.eventLocation || tracking.notes || detailRows.length > 0) && (
        <div className="bg-card rounded-2xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-5">تفاصيل الخدمة</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tracking.eventDate && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">تاريخ الحجز</p>
                <p className="text-sm text-foreground break-words">{tracking.eventDate}</p>
              </div>
            )}
            {tracking.eventLocation && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">الموقع</p>
                <p className="text-sm text-foreground break-words">{tracking.eventLocation}</p>
              </div>
            )}
            {detailRows.map((row) => (
              <div key={row.key}>
                <p className="text-xs text-muted-foreground mb-1">{row.label}</p>
                <p className="text-sm text-foreground break-words">{row.value}</p>
              </div>
            ))}
            {tracking.notes && (
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground mb-1">ملاحظات</p>
                <p className="text-sm text-foreground break-words">{tracking.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <LocationMapCard
        mapUrl={tracking.mapsUrl}
        address={tracking.eventLocation || [tracking.governorate, tracking.area, tracking.address].filter(Boolean).join(" / ")}
        title={isBooking ? "موقع المناسبة" : "موقع التوصيل"}
      />

      {/* Progress Steps */}
      {!isCancelled && (
        <div className="bg-card rounded-2xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-5">مراحل الطلب</h3>
          <div className="space-y-4">
            {stages.map((step, i) => {
              const done = i <= currentIdx;
              const active = i === currentIdx;
              return (
                <div key={step.id} className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all shrink-0 ${
                    done ? "border-primary bg-primary text-primary-foreground" : "border-border/40 bg-background text-muted-foreground"
                  } ${active ? "ring-4 ring-primary/20 shadow-[0_0_18px_rgba(201,168,76,0.35)]" : ""}`}>
                    {done ? (
                      <StatusIcon status={step.id} className="w-4 h-4" />
                    ) : (
                      <StatusIcon status={step.id} className="w-4 h-4 opacity-60" />
                    )}
                  </div>
                  <div className="flex-1 pt-1">
                    <span className={`text-sm ${active ? "text-primary font-bold" : done ? "text-foreground" : "text-muted-foreground"}`}>
                      {step.label}
                    </span>
                    {active && <p className="text-[11px] text-primary/80 mt-0.5">الحالة الحالية</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Status History with timestamps */}
      {tracking.statusHistory && tracking.statusHistory.length > 0 && (
        <div className="bg-card rounded-2xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-5 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" /> سجل التحديثات
          </h3>
          <ol className="space-y-4 border-r-2 border-border/40 pr-4">
            {tracking.statusHistory.map((h: any, idx: number) => (
              <li key={idx} className="relative">
                <span className={`absolute -right-[1.4rem] top-1.5 w-3 h-3 rounded-full ${idx === 0 ? "bg-primary ring-4 ring-primary/20" : "bg-border"}`} />
                <p className={`text-sm ${idx === 0 ? "text-primary font-bold" : "text-foreground"}`}>
                  {h.status === "cancelled" ? "ملغي" : getStageLabel(stages, h.status)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatTrackDate(h.createdAt)}</p>
                {h.notes && <p className="text-xs text-muted-foreground/80 mt-1">{h.notes}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Booking confirmation status (already responded) */}
      {isBooking && tracking.customerConfirmation && (
        <div className={`rounded-2xl border p-4 ${tracking.customerConfirmation === "confirmed" ? "bg-green-600/10 border-green-600/30 text-green-300" : "bg-amber-500/10 border-amber-500/30 text-amber-300"}`}>
          <p className="text-sm font-semibold">
            {tracking.customerConfirmation === "confirmed"
              ? "✅ شكراً، تم تأكيد موعدك"
              : "📅 تم استلام طلبك لتغيير الموعد"}
          </p>
          {tracking.requestedDate && (
            <p className="text-xs mt-1">الموعد المقترح: <span dir="ltr">{tracking.requestedDate}</span></p>
          )}
          {tracking.confirmationNote && (
            <p className="text-xs mt-1 opacity-80">{tracking.confirmationNote}</p>
          )}
        </div>
      )}

      {/* Items */}
      {tracking.items && tracking.items.length > 0 && (
        <div className="bg-card rounded-2xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">محتويات الطلب</h3>
          <div className="space-y-3">
            {tracking.items.map((item: any) => (
              <div key={item.id} className="flex items-center gap-4">
                {item.image && (
                  <img src={item.image} alt={item.productNameAr} className="w-12 h-12 rounded-lg object-cover" />
                )}
                <div className="flex-1">
                  <p className="text-foreground text-sm font-medium">{item.productNameAr || item.productName}</p>
                  <SelectedColorLabel color={item.selectedColorData} fallback={item.selectedColor} className="flex text-xs text-muted-foreground" />
                </div>
                <div className="text-right">
                  <p className="text-foreground text-sm">× {item.quantity}</p>
                  <p className="text-primary text-xs">{Number(item.price).toLocaleString('ar-IQ')} د.ع</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {["delivered", "completed"].includes(tracking.status) && (
        <TrackingReviewBox tracking={tracking} />
      )}

      <SmartSuggestions
        contextServiceType={tracking.serviceType}
        products={recommendations?.products ?? []}
        services={recommendations?.services ?? []}
        title="اقتراحات تناسب طلبك"
      />
    </div>
  );
}

function paymentLabel(status?: string) {
  if (status === "paid") return "مدفوع";
  if (status === "partial") return "جزئي";
  return "غير مدفوع";
}

function TrackingReviewBox({ tracking }: { tracking: any }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/customer/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ orderKind: tracking.kind === "service" ? "service" : "product", orderId: tracking.id, rating, comment }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? "سجل دخولك حتى يتم حفظ التقييم");
      setMessage("شكراً لك، تم حفظ تقييمك.");
    } catch (err: any) {
      setMessage(err?.message ?? "تعذر حفظ التقييم");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-card rounded-2xl border border-border/30 p-6">
      <h3 className="text-sm font-semibold text-foreground mb-3">تقييم الطلب بعد التسليم</h3>
      <div className="flex items-center gap-1 mb-3">
        {[1, 2, 3, 4, 5].map((value) => (
          <button key={value} type="button" onClick={() => setRating(value)} className={value <= rating ? "text-primary" : "text-muted-foreground"}>
            <Star className="w-5 h-5 fill-current" />
          </button>
        ))}
      </div>
      <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="اكتب ملاحظتك" className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
      {message && <p className="text-xs text-muted-foreground mt-2">{message}</p>}
      <Button type="submit" size="sm" className="mt-3" disabled={saving}>{saving ? "جاري الحفظ..." : "إرسال التقييم"}</Button>
    </form>
  );
}

function TrackSuggestions({ products, services }: { products: any[]; services: any[] }) {
  const items = [
    ...products.map((product) => ({ key: `p-${product.id}`, title: product.nameAr, image: product.images?.[0], href: `/store/${product.id}` })),
    ...services.map((service) => ({ key: `s-${service.id}`, title: service.nameAr, image: service.image, href: `/services/${service.id}` })),
  ].slice(0, 4);
  if (items.length === 0) return null;
  return (
    <div className="bg-card rounded-2xl border border-border/30 p-6">
      <h3 className="text-sm font-semibold text-foreground mb-4">اقتراحات مشابهة</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item) => (
          <a key={item.key} href={item.href} className="rounded-xl bg-background/60 border border-border/25 p-3 flex items-center gap-3 hover:border-primary/40 transition-colors">
            <div className="w-14 h-14 rounded-lg bg-card border border-border/30 overflow-hidden shrink-0">
              {item.image ? <img src={item.image} alt="" loading="lazy" className="w-full h-full object-cover" /> : null}
            </div>
            <p className="text-sm font-semibold text-foreground">{item.title}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

function BookingResponseCard({ tracking }: { tracking: any }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"idle" | "reschedule">("idle");
  const [requestedDate, setRequestedDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const respond = useMutation({
    mutationFn: async (data: { action: "confirm" | "reschedule"; requestedDate?: string; note?: string }) => {
      const idQuery = tracking.id ? `?id=${encodeURIComponent(String(tracking.id))}` : "";
      const res = await fetch(`/api/service-orders/track/${encodeURIComponent(tracking.trackingCode)}/respond${idQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "تعذر إرسال الرد، حاول مجدداً");
      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getTrackOrderQueryKey(tracking.trackingCode) });
      setMode("idle");
      setRequestedDate("");
      setNote("");
      setError(null);
    },
    onError: (e: any) => setError(e?.message ?? "تعذر إرسال الرد، حاول مجدداً"),
  });

  const alreadyResponded = !!tracking.customerConfirmation;
  const eventDate = tracking.eventDate as string | null;

  if (alreadyResponded) return null;

  return (
    <div className="bg-card rounded-2xl border border-primary/30 p-6">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-5 h-5 text-primary" />
        <h3 className="text-base font-bold text-foreground">تأكيد الموعد</h3>
      </div>
      {eventDate ? (
        <p className="text-sm text-muted-foreground mb-4">
          الموعد المسجل لحجزك: <span className="text-foreground font-medium" dir="ltr">{eventDate}</span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground mb-4">
          الرجاء تأكيد الموعد أو طلب تغييره.
        </p>
      )}

      {mode === "idle" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            disabled={respond.isPending}
            onClick={() => respond.mutate({ action: "confirm" })}
            className="inline-flex items-center justify-center gap-2 bg-green-600/10 text-green-300 border border-green-600/30 hover:bg-green-600/20 disabled:opacity-50 transition-colors rounded-lg py-2.5 text-sm font-medium"
          >
            <CheckCircle className="w-4 h-4" /> تأكيد الموعد
          </button>
          <button
            type="button"
            onClick={() => setMode("reschedule")}
            className="inline-flex items-center justify-center gap-2 bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 transition-colors rounded-lg py-2.5 text-sm font-medium"
          >
            <CalendarClock className="w-4 h-4" /> طلب تغيير الموعد
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!requestedDate) { setError("الرجاء اختيار الموعد الجديد"); return; }
            respond.mutate({ action: "reschedule", requestedDate, note: note || undefined });
          }}
          className="space-y-3"
        >
          <div>
            <label className="block text-xs text-muted-foreground mb-1">الموعد الجديد المقترح *</label>
            <input
              type="datetime-local"
              value={requestedDate}
              onChange={(e) => setRequestedDate(e.target.value)}
              required
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">ملاحظة (اختياري)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={respond.isPending} size="sm">
              {respond.isPending ? "جاري الإرسال..." : "إرسال الطلب"}
            </Button>
            <button
              type="button"
              onClick={() => { setMode("idle"); setError(null); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
