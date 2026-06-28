import { useState, useEffect, useRef } from "react";
import { useRoute, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useTrackOrder, getTrackOrderQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Package, Search, CheckCircle, Phone, Hash, XCircle, MessageCircle, MapPin, Clock, Calendar, CalendarClock,
  CircleDot, ClipboardCheck, PackageCheck, Sparkles, Star, Truck, QrCode, Printer, Flower2, ShoppingBag,
  Camera, Images, Music2, GraduationCap, BriefcaseBusiness, ChevronLeft, ExternalLink,
  Fingerprint, Activity, Wrench,
} from "lucide-react";
import { getStagesFor, getStageIndex, getStageLabel, buildWhatsAppLink } from "@/lib/order-stages";
import { serviceDetailsToRows } from "@/lib/service-details";
import { formatIraqiPhoneInput, normalizeIraqiPhone } from "@/lib/phone";
import { usePublicSettings } from "@/lib/public-settings";
import { SelectedColorLabel } from "@/components/product-colors";
import { CelebrationEffect } from "@/components/interactive/celebration-effect";
import { EventCountdown } from "@/components/interactive/event-countdown";
import { LocationMapCard } from "@/components/interactive/location-map-card";
import { SmartSuggestions } from "@/components/interactive/smart-suggestions";
import { logCustomerActivity } from "@/lib/customer-activity";
import { useT } from "@/lib/i18n";
import { formatCurrency, formatMoney } from "@/lib/money";

type Mode = "code" | "phone";

type TrackingGroupKey = "koshas" | "storeOrders" | "photographyOrders" | "albums" | "djBookings" | "preparations" | "rentals" | "services";

type UnifiedTrackingItem = {
  id: number;
  code: string;
  type: string;
  title: string;
  status: string;
  date: string;
  createdAt: string;
  totalAmount: number | null;
  paidAmount: number | null;
  remainingAmount: number | null;
  paymentStatus: string;
  deliveryFee?: number;
  image?: string | null;
  trackingUrl?: string | null;
  qrScanUrl?: string | null;
  details?: Record<string, any>;
  statusHistory?: Array<{ status: string; createdAt: string }>;
};

type UnifiedTrackingResponse = {
  total: number;
  groups: Record<TrackingGroupKey, UnifiedTrackingItem[]>;
};

export default function Track() {
  const t = useT();
  const search = useSearch();
  const [, tokenParams] = useRoute<{ token: string }>("/track/:token");
  const secureToken = tokenParams?.token ?? "";
  const params = new URLSearchParams(search);
  const prefilledCode = params.get("code") ?? "";

  const [mode, setMode] = useState<Mode>("code");
  const [code, setCode] = useState(prefilledCode);
  const [phone, setPhone] = useState("");
  const [searchCode, setSearchCode] = useState(prefilledCode);
  const [searchPhone, setSearchPhone] = useState("");
  const [phoneValidationError, setPhoneValidationError] = useState("");
  const { data: settings } = usePublicSettings();
  const { data: secureTracking, isLoading: loadingSecure, error: errorSecure } = useQuery({
    queryKey: ["track", "secure-token", secureToken],
    queryFn: async () => {
      const res = await fetch(`/api/qr/${encodeURIComponent(secureToken)}/status`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? t("رمز QR غير صالح"));
      return data;
    },
    enabled: !!secureToken,
    refetchInterval: secureToken ? 30000 : false,
  });

  const { data: order, isLoading: loadingCode, error: errorCode } = useTrackOrder(searchCode || "_", {
    query: { queryKey: getTrackOrderQueryKey(searchCode || "_"), enabled: !!searchCode, refetchInterval: searchCode ? 30000 : false },
  });

  const { data: phoneResults, isLoading: loadingPhone, error: phoneError } = useQuery<UnifiedTrackingResponse>({
    queryKey: ["track", "by-phone", searchPhone],
    queryFn: async () => {
      const response = await fetch(`/api/track/by-phone?phone=${encodeURIComponent(searchPhone)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? t("تعذر البحث عن الطلبات"));
      return payload as UnifiedTrackingResponse;
    },
    enabled: Boolean(searchPhone),
    refetchInterval: searchPhone ? 30000 : false,
    retry: false,
  });
  const codeResults = Array.isArray(order) ? order : order ? [order] : [];

  useEffect(() => {
    if (prefilledCode) setSearchCode(prefilledCode);
  }, [prefilledCode]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "code") {
      setPhoneValidationError("");
      setSearchPhone("");
      setSearchCode(code.trim().toUpperCase());
    } else {
      setSearchCode("");
      const normalized = normalizeIraqiPhone(phone);
      if (!normalized) {
        setSearchPhone("");
        setPhoneValidationError(t("أدخل رقم هاتف عراقي صحيح مثل 0770xxxxxxx"));
        return;
      }
      setPhoneValidationError("");
      setSearchPhone(normalized);
    }
  }

  if (secureToken) {
    return (
      <div className="container mx-auto px-4 py-12 min-h-screen">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <Package className="w-12 h-12 text-primary mx-auto mb-3" />
            <h1 className="text-3xl font-bold text-foreground mb-2">{t("تتبع الطلب")}</h1>
            <p className="text-muted-foreground">{t("معلومات تتبع عامة وآمنة")}</p>
          </div>
          {loadingSecure && (
            <div className="text-center py-12 text-muted-foreground animate-pulse">{t("جاري فتح التتبع...")}</div>
          )}
          {errorSecure && (
            <div className="text-center py-12 bg-card rounded-xl border border-border/30">
              <XCircle className="w-10 h-10 text-status-danger mx-auto mb-3" />
              <p className="text-muted-foreground">{errorSecure instanceof Error ? errorSecure.message : t("رمز QR غير صالح")}</p>
            </div>
          )}
          {secureTracking && <div className="animate-scale-in"><SecureQrTrackingCard tracking={secureTracking} /></div>}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 min-h-screen">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10 animate-fade-up">
          <Package className="w-12 h-12 text-primary mx-auto mb-3" />
          <h1 className="text-3xl font-bold text-foreground mb-2">{t("تتبع الطلب")}</h1>
          <p className="text-muted-foreground">{t("أدخل رمز التتبع أو رقم هاتفك لعرض جميع طلباتك وحجوزاتك")}</p>
        </div>

        {/* Mode tabs */}
        <div className="grid grid-cols-2 gap-2 mb-4 bg-card border border-border/30 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setMode("code")}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition-colors ${mode === "code" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Hash className="w-4 h-4" /> {t("رمز التتبع")}
          </button>
          <button
            type="button"
            onClick={() => setMode("phone")}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition-colors ${mode === "phone" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Phone className="w-4 h-4" /> {t("رقم الهاتف")}
          </button>
        </div>

        {/* Search */}
        <form onSubmit={handleSubmit} className="flex gap-3 mb-10">
          {mode === "code" ? (
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="AJN-2089"
              className="flex-1 bg-card border border-border/40 rounded-xl px-5 py-4 text-foreground text-lg font-mono tracking-wider placeholder-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors uppercase"
            />
          ) : (
            <input
              value={phone}
              onChange={e => {
                setPhone(formatIraqiPhoneInput(e.target.value));
                if (phoneValidationError) setPhoneValidationError("");
              }}
              placeholder="0770xxxxxxx"
              inputMode="numeric"
              className="flex-1 bg-card border border-border/40 rounded-xl px-5 py-4 text-foreground text-lg tracking-wider placeholder-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
            />
          )}
          <Button type="submit" size="lg" className="px-6" disabled={loadingCode || loadingPhone}>
            <Search className="w-5 h-5" />
          </Button>
        </form>

        {mode === "phone" && phoneValidationError && (
          <p className="-mt-7 mb-8 text-sm text-status-danger" role="alert">{phoneValidationError}</p>
        )}

        {/* Loading */}
        {(loadingCode || loadingPhone) && <TrackingSearchSkeleton />}

        {/* Code mode — single order */}
        {mode === "code" && errorCode && searchCode && (
          <div className="text-center py-12 bg-card rounded-xl border border-border/30">
            <XCircle className="w-10 h-10 text-status-danger mx-auto mb-3" />
            <p className="text-muted-foreground">{t("لم يتم العثور على طلب برمز:")} <span className="text-foreground font-mono">{searchCode}</span></p>
          </div>
        )}
        {mode === "code" && codeResults.length > 0 && (
          <div className="space-y-6">
            {codeResults.length > 1 && (
              <p className="text-sm text-muted-foreground text-center">
                {t("يوجد أكثر من طلب بهذا الرمز. اختر الطلب حسب التاريخ والتفاصيل.")}
              </p>
            )}
            {codeResults.map((o: any, i: number) => (
              <div key={`${o.kind ?? "order"}-${o.id ?? i}`} className="animate-scale-in" style={{ animationDelay: `${i * 80}ms` }}>
                <OrderCard tracking={o as any} contactPhone={settings?.whatsapp || settings?.phone} />
              </div>
            ))}
          </div>
        )}

        {mode === "phone" && phoneError && searchPhone && (
          <div className="text-center py-12 bg-card rounded-xl border border-border/30">
            <XCircle className="w-10 h-10 text-status-danger mx-auto mb-3" />
            <p className="text-muted-foreground">{phoneError instanceof Error ? phoneError.message : t("تعذر البحث عن الطلبات")}</p>
          </div>
        )}

        {/* Phone mode — unified customer orders */}
        {mode === "phone" && phoneResults && phoneResults.total === 0 && (
          <div className="text-center py-12 bg-card rounded-xl border border-border/30">
            <XCircle className="w-10 h-10 text-status-danger mx-auto mb-3" />
            <p className="text-muted-foreground">{t("لا توجد طلبات مرتبطة بهذا الرقم")}</p>
          </div>
        )}
        {mode === "phone" && phoneResults && phoneResults.total > 0 && (
          <UnifiedPhoneResults data={phoneResults} contactPhone={settings?.whatsapp || settings?.phone} />
        )}
      </div>
    </div>
  );
}

const TRACKING_GROUPS: Array<{ key: TrackingGroupKey; label: string; icon: typeof Package }> = [
  { key: "koshas", label: "كوشات", icon: Flower2 },
  { key: "storeOrders", label: "المتجر", icon: ShoppingBag },
  { key: "photographyOrders", label: "تصوير", icon: Camera },
  { key: "albums", label: "ألبومات", icon: Images },
  { key: "djBookings", label: "دي جي", icon: Music2 },
  { key: "preparations", label: "تجهيزات", icon: GraduationCap },
  { key: "rentals", label: "إيجار", icon: CalendarClock },
  { key: "services", label: "خدمات أخرى", icon: BriefcaseBusiness },
];

function TrackingSearchSkeleton() {
  return (
    <div className="space-y-4 py-3" aria-label="جاري البحث">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-20 rounded-xl" />)}
      </div>
      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-36 rounded-2xl" />
    </div>
  );
}

function UnifiedPhoneResults({ data, contactPhone }: { data: UnifiedTrackingResponse; contactPhone?: string }) {
  const t = useT();
  const availableGroups = TRACKING_GROUPS.filter((group) => data.groups[group.key]?.length > 0);
  const [selectedGroup, setSelectedGroup] = useState<TrackingGroupKey>(availableGroups[0]?.key ?? "storeOrders");
  const [selectedItem, setSelectedItem] = useState<UnifiedTrackingItem | null>(null);
  const activeGroup = data.groups[selectedGroup]?.length ? selectedGroup : (availableGroups[0]?.key ?? selectedGroup);
  const rows = data.groups[activeGroup] ?? [];
  return (
    <div className="space-y-5 animate-fade-up pb-10">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border/30 bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">{t("جميع الطلبات والحجوزات المرتبطة برقمك")}</p>
        <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">{data.total}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="tablist" aria-label={t("أنواع الطلبات")}>
        {availableGroups.map((group) => {
          const Icon = group.icon;
          const active = activeGroup === group.key;
          return (
            <button
              key={group.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelectedGroup(group.key)}
              className={`min-w-0 rounded-xl border p-3 text-right transition-colors ${active ? "border-primary/60 bg-primary/10 text-primary" : "border-border/30 bg-card text-muted-foreground hover:border-primary/35 hover:text-foreground"}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <Icon className="h-5 w-5 shrink-0" />
                <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-primary text-primary-foreground" : "bg-background text-foreground"}`}>
                  {data.groups[group.key].length}
                </span>
              </div>
              <span className="block truncate text-sm font-semibold">{t(group.label)}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-3" role="tabpanel">
        {rows.map((item, index) => (
          <UnifiedTrackingCard
            key={`${item.type}-${item.id}-${item.code}`}
            item={item}
            onOpen={() => setSelectedItem(item)}
            style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
          />
        ))}
      </div>

      <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{t("تفاصيل الطلب")}</DialogTitle>
            <DialogDescription className="sr-only">{t("تفاصيل التتبع والدفع المسموح بعرضها لهذا الطلب")}</DialogDescription>
          </DialogHeader>
          {selectedItem && <UnifiedTrackingDetails item={selectedItem} contactPhone={contactPhone} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UnifiedTrackingCard({ item, onOpen, style }: { item: UnifiedTrackingItem; onOpen: () => void; style?: React.CSSProperties }) {
  const t = useT();
  return (
    <article className="animate-scale-in rounded-2xl border border-border/30 bg-card p-4 sm:p-5" style={style}>
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/30 bg-background">
          {item.image ? <img src={item.image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <Package className="h-7 w-7 text-primary" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-foreground">{item.title}</h2>
              <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">{item.code}</p>
            </div>
            <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${STATUS_TONES[item.status] ?? "border-border/30 bg-background text-foreground"}`}>
              <StatusIcon status={item.status} className="h-3.5 w-3.5" />
              {t(trackingStatusLabel(item.status))}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{formatTrackDate(item.date)}</span>
            {item.totalAmount !== null && <span className="font-semibold text-primary">{formatCurrency(item.totalAmount)}</span>}
            {item.totalAmount === null && <span>{t("بانتظار تحديد السعر")}</span>}
          </div>
        </div>
      </div>
      <Button type="button" variant="outline" className="mt-4 w-full justify-between" onClick={onOpen}>
        {t("عرض التفاصيل")}
        <ChevronLeft className="h-4 w-4" />
      </Button>
    </article>
  );
}

function UnifiedTrackingDetails({ item, contactPhone }: { item: UnifiedTrackingItem; contactPhone?: string }) {
  const t = useT();
  const details = item.details ?? {};
  const whatsappLink = buildWhatsAppLink(contactPhone || "07701234567", `استفسار عن الطلب ${item.code}`);
  const images = Array.from(new Set([item.image, ...(Array.isArray(details.venueImages) ? details.venueImages : [])].filter(Boolean))) as string[];
  const detailRows = unifiedDetailRows(item);
  const selectedLists = [
    { label: "الخدمات الإضافية", values: details.addons },
    { label: "بورد الترحيب", values: details.welcomeBoards },
    { label: "الإكسسوارات", values: details.accessories },
  ].filter((row) => Array.isArray(row.values) && row.values.length > 0);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border/30 bg-background/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{item.title}</p>
            <p className="mt-1 font-mono text-sm text-muted-foreground" dir="ltr">{item.code}</p>
          </div>
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${STATUS_TONES[item.status] ?? "border-border/30 bg-card text-foreground"}`}>
            <StatusIcon status={item.status} className="h-4 w-4" /> {t(trackingStatusLabel(item.status))}
          </span>
        </div>
      </div>

      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.slice(0, 8).map((src) => <img key={src} src={src} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-lg border border-border/30 object-cover" />)}
        </div>
      )}

      {item.totalAmount !== null ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <MoneySummary label={t("المبلغ الكلي")} value={item.totalAmount} />
          <MoneySummary label={t("المدفوع")} value={item.paidAmount ?? 0} />
          <MoneySummary label={t("المتبقي")} value={item.remainingAmount ?? 0} accent />
        </div>
      ) : (
        <div className="rounded-xl border border-primary/25 bg-primary/10 p-4 text-sm text-primary">{t("بانتظار تحديد السعر من الإدارة")}</div>
      )}

      {detailRows.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {detailRows.map((row) => (
            <div key={row.label} className="rounded-xl border border-border/30 bg-background/50 p-3">
              <p className="text-xs text-muted-foreground">{t(row.label)}</p>
              <p className="mt-1 break-words text-sm font-medium text-foreground">{row.value}</p>
            </div>
          ))}
        </div>
      )}

      {Array.isArray(details.items) && details.items.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t("المنتجات")}</h3>
          <div className="space-y-2">
            {details.items.map((product: any, index: number) => (
              <div key={product.id ?? index} className="flex items-center gap-3 rounded-xl border border-border/30 bg-background/50 p-3">
                {product.image && <img src={product.image} alt="" className="h-11 w-11 rounded-lg object-cover" />}
                <p className="min-w-0 flex-1 truncate text-sm text-foreground">{product.productNameAr || product.productName}</p>
                <span className="shrink-0 text-sm text-muted-foreground">× {product.quantity}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedLists.map((list) => (
        <div key={list.label}>
          <h3 className="mb-2 text-sm font-semibold text-foreground">{t(list.label)}</h3>
          <div className="flex flex-wrap gap-2">
            {(list.values as unknown[]).map((value, index) => (
              <span key={`${String(value)}-${index}`} className="rounded-full border border-border/30 bg-background px-3 py-1.5 text-xs text-foreground">
                {typeof value === "object" && value ? String((value as any).name ?? (value as any).title ?? "عنصر مختار") : String(value)}
              </span>
            ))}
          </div>
        </div>
      ))}

      {item.statusHistory && item.statusHistory.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><Clock className="h-4 w-4 text-primary" />{t("مراحل الطلب")}</h3>
          <ol className="space-y-3 border-r border-border/50 pr-4">
            {item.statusHistory.map((history, index) => (
              <li key={`${history.status}-${history.createdAt}-${index}`} className="relative">
                <span className={`absolute -right-[1.18rem] top-1.5 h-2.5 w-2.5 rounded-full ${index === 0 ? "bg-primary ring-4 ring-primary/15" : "bg-border"}`} />
                <p className={`text-sm ${index === 0 ? "font-semibold text-primary" : "text-foreground"}`}>{t(trackingStatusLabel(history.status))}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{formatTrackDate(history.createdAt)}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <a href={whatsappLink} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-status-success/30 bg-status-success/10 px-4 py-2.5 text-sm font-medium text-status-success hover:bg-status-success/20">
          <MessageCircle className="h-4 w-4" /> {t("تواصل بخصوص الطلب")}
        </a>
        {(item.trackingUrl || item.qrScanUrl) && (
          <a href={item.trackingUrl || item.qrScanUrl || "#"} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/20">
            {item.qrScanUrl ? <QrCode className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />} {t("فتح التتبع المباشر")}
          </a>
        )}
      </div>
    </div>
  );
}

function MoneySummary({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border/30 bg-background/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${accent ? "text-primary" : "text-foreground"}`}>{formatCurrency(value)}</p>
    </div>
  );
}

function unifiedDetailRows(item: UnifiedTrackingItem): Array<{ label: string; value: string }> {
  const details = item.details ?? {};
  const rows: Array<{ label: string; value: unknown }> = [
    { label: "التاريخ", value: formatTrackDate(String(details.eventDate || details.startDate || item.date)) },
    { label: "الوقت", value: details.eventTime },
    { label: "نوع المناسبة", value: details.eventType },
    { label: "الموقع", value: details.location || details.eventLocation },
    { label: "الباقة", value: details.packageName },
    { label: "عدد النسخ", value: details.copies },
    { label: "نوع الطباعة", value: details.printType },
    { label: "رقم الصورة", value: details.photoNumber },
    { label: "تاريخ البداية", value: details.startDate },
    { label: "تاريخ النهاية", value: details.endDate },
    { label: "عدد الأيام", value: details.days },
    { label: "سعر اليوم", value: details.pricePerDay !== undefined ? formatCurrency(details.pricePerDay) : null },
    { label: "التوصيل", value: item.deliveryFee ? formatCurrency(item.deliveryFee) : null },
  ];
  return rows.filter((row) => row.value !== null && row.value !== undefined && row.value !== "").map((row) => ({ label: row.label, value: String(row.value) }));
}

function trackingStatusLabel(status: string) {
  const labels: Record<string, string> = {
    new: "جديد",
    booked: "تم الحجز",
    pending: "قيد الانتظار",
    pending_pricing: "بانتظار التسعير",
    contacted: "تم التواصل",
    confirmed: "مؤكد",
    preparing: "جاري التجهيز",
    out_of_warehouse: "خرج من المخزن",
    on_the_way: "بالطريق",
    executing: "جاري التنفيذ",
    executed: "تم التنفيذ",
    return_pending: "بانتظار الإرجاع",
    processing: "قيد التنفيذ",
    in_progress: "قيد التنفيذ",
    en_route: "بالطريق",
    installed: "تم التنصيب",
    editing: "قيد المونتاج",
    ready_print: "جاهز للطباعة",
    ready_pickup: "جاهز للاستلام",
    shipped: "تم الشحن",
    active: "نشط",
    returned: "تم الإرجاع",
    delivered: "تم التسليم",
    completed: "مكتمل",
    cancelled: "ملغي",
    registered: "تم التسجيل",
  };
  return labels[status] ?? status;
}

function SecureQrTrackingCard({ tracking }: { tracking: any }) {
  const t = useT();
  if (tracking.kind === "asset") return <AssetQrCard tracking={tracking} />;
  const stages = getStagesFor(tracking.serviceType, tracking.kind);
  const currentIdx = getStageIndex(stages, tracking.status);
  const progress = stages.length > 1 ? Math.max(0, Math.min(100, (currentIdx / (stages.length - 1)) * 100)) : 0;
  const lastUpdate = tracking.statusHistory?.[0]?.createdAt ?? tracking.updatedAt ?? tracking.createdAt;

  return (
    <div className="bg-card border border-border/40 rounded-2xl p-6 shadow-lg shadow-black/5 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">{t("رقم الطلب")}</p>
          <p className="text-xl font-mono font-bold text-foreground tracking-widest">{tracking.trackingCode}</p>
          {tracking.serviceName && (
            <p className="text-sm text-muted-foreground mt-2">{tracking.serviceName}</p>
          )}
        </div>
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border ${STATUS_TONES[tracking.status] ?? "text-primary border-border/30 bg-background"}`}>
          <StatusIcon status={tracking.status} className="w-4 h-4" />
          <span className="text-sm font-medium">{t(getStageLabel(stages, tracking.status))}</span>
        </div>
      </div>

      <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${tracking.status === "cancelled" ? "bg-status-danger" : "bg-primary"}`}
          style={{ width: `${tracking.status === "cancelled" ? 100 : progress}%` }}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl bg-background/60 border border-border/30 p-4">
          <p className="text-xs text-muted-foreground mb-1">{t("اسم العميل")}</p>
          <p className="text-foreground font-semibold">{tracking.customerName || "—"}</p>
        </div>
        <div className="rounded-xl bg-background/60 border border-border/30 p-4">
          <p className="text-xs text-muted-foreground mb-1">{t("حالة الدفع")}</p>
          <p className="text-foreground font-semibold">{t(paymentLabel(tracking.paymentStatus))}</p>
        </div>
        <div className="rounded-xl bg-background/60 border border-border/30 p-4">
          <p className="text-xs text-muted-foreground mb-1">{t("تاريخ الطلب")}</p>
          <p className="text-foreground font-semibold">{formatTrackDate(tracking.createdAt)}</p>
        </div>
        <div className="rounded-xl bg-background/60 border border-border/30 p-4">
          <p className="text-xs text-muted-foreground mb-1">{t("آخر تحديث")}</p>
          <p className="text-foreground font-semibold">{formatTrackDate(lastUpdate)}</p>
        </div>
      </div>

      <RentalTrackingDetails tracking={tracking} embedded />

      {tracking.statusHistory && tracking.statusHistory.length > 0 && (
        <div className="border-t border-border/30 pt-5">
          <h3 className="font-semibold text-foreground mb-4">{t("سجل الحالة")}</h3>
          <div className="space-y-3">
            {tracking.statusHistory.map((item: any, idx: number) => (
              <div key={`${item.status}-${idx}`} className="flex items-start gap-3 animate-slide-in" style={{ animationDelay: `${idx * 50}ms` }}>
                <div className="mt-1 h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                <div>
                  <p className="text-sm text-foreground">{t(getStageLabel(stages, item.status))}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatTrackDate(item.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ASSET_STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  active: { label: "نشط — جاهز للاستخدام", tone: "text-status-success border-status-success/30 bg-status-success/10" },
  maintenance: { label: "قيد الصيانة", tone: "text-status-warning border-status-warning/30 bg-status-warning/10" },
  retired: { label: "مُستبعد من الخدمة", tone: "text-status-danger border-status-danger/30 bg-status-danger/10" },
};

// Public, financial-free asset card shown when a Scan&Go QR is scanned.
function AssetQrCard({ tracking }: { tracking: any }) {
  const t = useT();
  const statusInfo = ASSET_STATUS_LABEL[tracking.status] ?? ASSET_STATUS_LABEL.active;
  const lifePct = Math.max(0, Math.min(100, Number(tracking.lifePct ?? 0)));
  const lifeTone = lifePct >= 60 ? "bg-status-success" : lifePct >= 30 ? "bg-status-warning" : "bg-status-danger";
  return (
    <div className="bg-card border border-border/40 rounded-2xl p-6 shadow-lg shadow-black/5 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          {tracking.image ? (
            <img src={tracking.image} alt={tracking.assetName} className="h-16 w-16 rounded-xl object-cover border border-border/30 shrink-0" />
          ) : (
            <div className="h-16 w-16 rounded-xl bg-background/60 border border-border/30 flex items-center justify-center shrink-0">
              <Package className="w-7 h-7 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground mb-1">{t("جواز الأصل")}</p>
            <p className="text-lg font-bold text-foreground truncate">{tracking.assetName}</p>
            {tracking.category && <p className="text-sm text-muted-foreground mt-0.5">{tracking.category}</p>}
          </div>
        </div>
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border ${statusInfo.tone}`}>
          {tracking.status === "maintenance" ? <Wrench className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
          <span className="text-sm font-medium">{t(statusInfo.label)}</span>
        </div>
      </div>

      <div className="rounded-xl bg-background/60 border border-border/30 p-4 flex items-center gap-3">
        <Fingerprint className="w-5 h-5 text-primary shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground mb-0.5">{t("البصمة الرقمية")}</p>
          <p className="font-mono text-sm font-semibold text-foreground truncate tracking-wider">{tracking.trackingCode}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">{t("العمر المتبقي")}</span>
          <span className="text-sm font-semibold text-foreground">{lifePct}%</span>
        </div>
        <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${lifeTone}`} style={{ width: `${lifePct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground mt-2">{t("الاستخدام")}: {tracking.usageCount} / {tracking.expectedLifeUses}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {tracking.serialNumber && (
          <div className="rounded-xl bg-background/60 border border-border/30 p-4">
            <p className="text-xs text-muted-foreground mb-1">{t("الرقم التسلسلي")}</p>
            <p className="text-foreground font-semibold font-mono">{tracking.serialNumber}</p>
          </div>
        )}
        <div className="rounded-xl bg-background/60 border border-border/30 p-4">
          <p className="text-xs text-muted-foreground mb-1">{t("آخر تحديث")}</p>
          <p className="text-foreground font-semibold">{formatTrackDate(tracking.updatedAt ?? tracking.createdAt)}</p>
        </div>
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
  active: "text-primary border-primary/30 bg-primary/10",
  returned: "text-status-success border-status-success/30 bg-status-success/10",
  pending: "text-status-warning border-status-warning/30 bg-status-warning/10",
  confirmed: "text-primary border-primary/30 bg-primary/10",
  processing: "text-primary border-primary/30 bg-primary/10",
  en_route: "text-primary border-primary/30 bg-primary/10",
  shipped: "text-primary border-primary/30 bg-primary/10",
  delivered: "text-status-success border-status-success/30 bg-status-success/10",
  completed: "text-status-success border-status-success/30 bg-status-success/10",
  registered: "text-status-warning border-status-warning/30 bg-status-warning/10",
  editing: "text-primary border-primary/30 bg-primary/10",
  ready_print: "text-primary border-primary/30 bg-primary/10",
  ready_pickup: "text-primary border-primary/30 bg-primary/10",
  cancelled: "text-status-danger border-status-danger/30 bg-status-danger/10",
};

function StatusIcon({ status, className }: { status: string; className?: string }) {
  const icons: Record<string, typeof CircleDot> = {
    active: CalendarClock,
    returned: PackageCheck,
    pending: CircleDot,
    confirmed: ClipboardCheck,
    processing: Sparkles,
    en_route: Truck,
    shipped: Truck,
    delivered: PackageCheck,
    completed: PackageCheck,
    registered: ClipboardCheck,
    editing: Sparkles,
    ready_print: Printer,
    ready_pickup: PackageCheck,
    cancelled: XCircle,
  };
  const Icon = icons[status] ?? CheckCircle;
  return <Icon className={className} />;
}

const RENTAL_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  returned: "Returned",
  cancelled: "Cancelled",
};

function rentalDetailsFromTracking(tracking: any) {
  return tracking?.rental ?? tracking?.items?.map((item: any) => item?.rental).find(Boolean) ?? null;
}

function formatTrackMoney(value: unknown) {
  return formatCurrency(value as number | string | null | undefined);
}

function RentalTrackingDetails({ tracking, embedded = false }: { tracking: any; embedded?: boolean }) {
  const t = useT();
  const rental = rentalDetailsFromTracking(tracking);
  const isRental = tracking?.kind === "rental" || String(tracking?.serviceType ?? "").toLowerCase() === "rental";
  if (!isRental || !rental) return null;
  const rows = [
    { label: "تاريخ البداية", value: rental.startDate || "—" },
    { label: "تاريخ النهاية", value: rental.endDate || "—" },
    { label: "عدد الأيام", value: formatMoney(rental.days ?? 0) },
    { label: "سعر اليوم", value: formatTrackMoney(rental.pricePerDay) },
    { label: "السعر الكلي", value: formatTrackMoney(rental.totalAmount ?? tracking.total) },
    { label: "حالة الإيجار", value: RENTAL_STATUS_LABELS[String(rental.status ?? tracking.status)] ?? String(rental.status ?? tracking.status ?? "—") },
  ];
  return (
    <div className={embedded ? "border-t border-border/30 pt-5" : "bg-card rounded-2xl border border-primary/20 p-6"}>
      <h3 className="text-sm font-semibold text-foreground mb-5 flex items-center gap-2">
        <CalendarClock className="w-4 h-4 text-primary" /> {t("تفاصيل الإيجار")}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-lg bg-background/60 border border-border/25 p-3">
            <p className="text-xs text-muted-foreground mb-1">{t(row.label)}</p>
            <p className="text-sm font-semibold text-foreground break-words">{row.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderCard({ tracking, contactPhone }: { tracking: any; contactPhone?: string }) {
  const t = useT();
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
    logCustomerActivity({
      action: "track_page",
      entityType: tracking.kind === "service" ? "service_order" : "order",
      entityId: Number(tracking.id) || undefined,
      entityLabel: tracking.trackingCode,
    });
  }, [tracking.id, tracking.kind, tracking.trackingCode]);

  useEffect(() => {
    if (!previousStatus.current) {
      previousStatus.current = tracking.status;
      return undefined;
    }
    if (previousStatus.current !== tracking.status) {
      previousStatus.current = tracking.status;
      setLiveNotice(t("تم تحديث حالة الطلب الآن"));
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
        message={tracking.paymentStatus === "paid" ? t("تم تسجيل الدفع بنجاح") : t("اكتمل طلبك بنجاح")}
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
              <p className="text-xs text-muted-foreground mb-1">{t("رمز التتبع")}</p>
              <p className="text-xl font-mono font-bold text-foreground tracking-widest">{tracking.trackingCode}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{t("آخر تحديث:")} {formatTrackDate(lastUpdate)}</p>
            </div>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${STATUS_TONES[tracking.status] ?? "text-primary border-border/30 bg-background"} ${!isCancelled ? "animate-pulse" : ""}`}>
            <StatusIcon status={tracking.status} className="w-4 h-4" />
            <span className="text-sm font-medium">{t(getStageLabel(stages, tracking.status))}</span>
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
            <span className="text-primary font-bold">{formatCurrency(tracking.total)}</span>
          )}
        </div>
        {(Number(tracking.depositAmount ?? 0) > 0 || Number(tracking.remainingAmount ?? 0) > 0) && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-background/60 border border-border/25 p-3">
              <p className="text-muted-foreground mb-1">{t("العربون")}</p>
              <p className="text-foreground font-semibold">{formatCurrency(tracking.depositAmount)}</p>
            </div>
            <div className="rounded-lg bg-background/60 border border-border/25 p-3">
              <p className="text-muted-foreground mb-1">{t("المتبقي")}</p>
              <p className="text-primary font-semibold">{formatCurrency(tracking.remainingAmount)}</p>
            </div>
            <div className="rounded-lg bg-background/60 border border-border/25 p-3">
              <p className="text-muted-foreground mb-1">{t("حالة الدفع")}</p>
              <p className="text-foreground font-semibold">{t(paymentLabel(tracking.paymentStatus))}</p>
            </div>
          </div>
        )}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <a
            href={waLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-status-success/10 text-status-success border border-status-success/30 hover:bg-status-success/20 transition-colors rounded-lg py-2.5 text-sm font-medium"
          >
            <MessageCircle className="w-4 h-4" /> {t("تواصل عبر واتساب")}
          </a>
          {tracking.mapsUrl && (
            <a
              href={tracking.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors rounded-lg py-2.5 text-sm font-medium"
            >
              <MapPin className="w-4 h-4" /> {t("فتح الموقع في Google Maps")}
            </a>
          )}
        </div>
        {tracking.qrDataUrl && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-border/30 bg-background/50 p-3">
            <div className="w-20 h-20 rounded-lg bg-white p-1.5 shrink-0">
              <img src={tracking.qrDataUrl} alt="QR" className="w-full h-full object-contain" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <QrCode className="w-4 h-4 text-primary" /> {t("رمز QR للتتبع")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{t("يفتح صفحة التتبع لهذا الطلب مباشرة.")}</p>
              {tracking.qrScanUrl && (
                <a href={tracking.qrScanUrl} className="text-xs text-primary mt-2 inline-block" target="_blank" rel="noreferrer">
                  {t("فتح رابط QR")}
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      <RentalTrackingDetails tracking={tracking} />

      {isBooking && tracking.eventDate && (
        <EventCountdown targetDate={tracking.eventDate} title={t("متبقي على موعد الحجز")} />
      )}

      {isBooking && (tracking.eventDate || tracking.eventLocation || tracking.notes || detailRows.length > 0) && (
        <div className="bg-card rounded-2xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-5">{t("تفاصيل الخدمة")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tracking.eventDate && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("تاريخ الحجز")}</p>
                <p className="text-sm text-foreground break-words">{tracking.eventDate}</p>
              </div>
            )}
            {tracking.eventLocation && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("الموقع")}</p>
                <p className="text-sm text-foreground break-words">{tracking.eventLocation}</p>
              </div>
            )}
            {detailRows.map((row) => (
              <div key={row.key}>
                <p className="text-xs text-muted-foreground mb-1">{t(row.label)}</p>
                <p className="text-sm text-foreground break-words">{row.value}</p>
              </div>
            ))}
            {tracking.notes && (
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground mb-1">{t("ملاحظات")}</p>
                <p className="text-sm text-foreground break-words">{tracking.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <LocationMapCard
        mapUrl={tracking.mapsUrl}
        address={tracking.eventLocation || [tracking.governorate, tracking.area, tracking.address].filter(Boolean).join(" / ")}
        title={isBooking ? t("موقع المناسبة") : t("موقع التوصيل")}
      />

      {/* Progress Steps */}
      {!isCancelled && (
        <div className="bg-card rounded-2xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-5">{t("مراحل الطلب")}</h3>
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
                      {t(step.label)}
                    </span>
                    {active && <p className="text-[11px] text-primary/80 mt-0.5">{t("الحالة الحالية")}</p>}
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
            <Clock className="w-4 h-4 text-primary" /> {t("سجل التحديثات")}
          </h3>
          <ol className="space-y-4 border-r-2 border-border/40 pr-4">
            {tracking.statusHistory.map((h: any, idx: number) => (
              <li key={idx} className="relative">
                <span className={`absolute -right-[1.4rem] top-1.5 w-3 h-3 rounded-full ${idx === 0 ? "bg-primary ring-4 ring-primary/20" : "bg-border"}`} />
                <p className={`text-sm ${idx === 0 ? "text-primary font-bold" : "text-foreground"}`}>
                  {h.status === "cancelled" ? t("ملغي") : t(getStageLabel(stages, h.status))}
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
        <div className={`rounded-2xl border p-4 ${tracking.customerConfirmation === "confirmed" ? "bg-status-success/10 border-status-success/30 text-status-success" : "bg-status-warning/10 border-status-warning/30 text-status-warning"}`}>
          <p className="text-sm font-semibold">
            {tracking.customerConfirmation === "confirmed"
              ? t("✅ شكراً، تم تأكيد موعدك")
              : t("📅 تم استلام طلبك لتغيير الموعد")}
          </p>
          {tracking.requestedDate && (
            <p className="text-xs mt-1">{t("الموعد المقترح:")} <span dir="ltr">{tracking.requestedDate}</span></p>
          )}
          {tracking.confirmationNote && (
            <p className="text-xs mt-1 opacity-80">{tracking.confirmationNote}</p>
          )}
        </div>
      )}

      {/* Items */}
      {tracking.items && tracking.items.length > 0 && (
        <div className="bg-card rounded-2xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">{t("محتويات الطلب")}</h3>
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
                  <p className="text-primary text-xs">{formatCurrency(item.price)}</p>
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
        title={t("اقتراحات تناسب طلبك")}
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
  const t = useT();
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
      if (!res.ok) throw new Error(payload?.error ?? t("سجل دخولك حتى يتم حفظ التقييم"));
      setMessage(t("شكراً لك، تم حفظ تقييمك."));
    } catch (err: any) {
      setMessage(err?.message ?? t("تعذر حفظ التقييم"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-card rounded-2xl border border-border/30 p-6">
      <h3 className="text-sm font-semibold text-foreground mb-3">{t("تقييم الطلب بعد التسليم")}</h3>
      <div className="flex items-center gap-1 mb-3">
        {[1, 2, 3, 4, 5].map((value) => (
          <button key={value} type="button" onClick={() => setRating(value)} className={value <= rating ? "text-primary" : "text-muted-foreground"}>
            <Star className="w-5 h-5 fill-current" />
          </button>
        ))}
      </div>
      <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("اكتب ملاحظتك")} className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
      {message && <p className="text-xs text-muted-foreground mt-2">{message}</p>}
      <Button type="submit" size="sm" className="mt-3" disabled={saving}>{saving ? t("جاري الحفظ...") : t("إرسال التقييم")}</Button>
    </form>
  );
}

function TrackSuggestions({ products, services }: { products: any[]; services: any[] }) {
  const t = useT();
  const items = [
    ...products.map((product) => ({ key: `p-${product.id}`, title: product.nameAr, image: product.images?.[0], href: `/store/${product.id}` })),
    ...services.map((service) => ({ key: `s-${service.id}`, title: service.nameAr, image: service.image, href: `/services/${service.id}` })),
  ].slice(0, 4);
  if (items.length === 0) return null;
  return (
    <div className="bg-card rounded-2xl border border-border/30 p-6">
      <h3 className="text-sm font-semibold text-foreground mb-4">{t("اقتراحات مشابهة")}</h3>
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
  const t = useT();
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
      if (!res.ok) throw new Error(payload?.error ?? t("تعذر إرسال الرد، حاول مجدداً"));
      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getTrackOrderQueryKey(tracking.trackingCode) });
      setMode("idle");
      setRequestedDate("");
      setNote("");
      setError(null);
    },
    onError: (e: any) => setError(e?.message ?? t("تعذر إرسال الرد، حاول مجدداً")),
  });

  const alreadyResponded = !!tracking.customerConfirmation;
  const eventDate = tracking.eventDate as string | null;

  if (alreadyResponded) return null;

  return (
    <div className="bg-card rounded-2xl border border-primary/30 p-6">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-5 h-5 text-primary" />
        <h3 className="text-base font-bold text-foreground">{t("تأكيد الموعد")}</h3>
      </div>
      {eventDate ? (
        <p className="text-sm text-muted-foreground mb-4">
          {t("الموعد المسجل لحجزك:")} <span className="text-foreground font-medium" dir="ltr">{eventDate}</span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground mb-4">
          {t("الرجاء تأكيد الموعد أو طلب تغييره.")}
        </p>
      )}

      {mode === "idle" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            disabled={respond.isPending}
            onClick={() => respond.mutate({ action: "confirm" })}
            className="inline-flex items-center justify-center gap-2 bg-status-success/10 text-status-success border border-status-success/30 hover:bg-status-success/20 disabled:opacity-50 transition-colors rounded-lg py-2.5 text-sm font-medium"
          >
            <CheckCircle className="w-4 h-4" /> {t("تأكيد الموعد")}
          </button>
          <button
            type="button"
            onClick={() => setMode("reschedule")}
            className="inline-flex items-center justify-center gap-2 bg-status-warning/10 text-status-warning border border-status-warning/30 hover:bg-status-warning/20 transition-colors rounded-lg py-2.5 text-sm font-medium"
          >
            <CalendarClock className="w-4 h-4" /> {t("طلب تغيير الموعد")}
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!requestedDate) { setError(t("الرجاء اختيار الموعد الجديد")); return; }
            respond.mutate({ action: "reschedule", requestedDate, note: note || undefined });
          }}
          className="space-y-3"
        >
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t("الموعد الجديد المقترح")}</label>
            <input
              type="datetime-local"
              value={requestedDate}
              onChange={(e) => setRequestedDate(e.target.value)}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t("ملاحظة (اختياري)")}</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          {error && <p className="text-xs text-status-danger">{error}</p>}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={respond.isPending} size="sm">
              {respond.isPending ? t("جاري الإرسال...") : t("إرسال الطلب")}
            </Button>
            <button
              type="button"
              onClick={() => { setMode("idle"); setError(null); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("إلغاء")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
