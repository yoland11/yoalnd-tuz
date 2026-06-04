import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Bell,
  CreditCard,
  Download,
  Heart,
  HelpCircle,
  Home,
  Loader2,
  LogOut,
  MapPin,
  MessageCircle,
  Moon,
  Package,
  Pencil,
  Phone,
  Plus,
  Printer,
  RefreshCcw,
  Search,
  Settings,
  ShoppingBag,
  Star,
  Trash2,
  Trophy,
  User,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIraqiPhone, formatIraqiPhoneInput } from "@/lib/phone";
import { buildWhatsAppLink } from "@/lib/order-stages";
import { usePublicSettings } from "@/lib/public-settings";
import { getCartSessionId } from "@/lib/api-session";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import type { ImageMetadata } from "@/lib/image-tools";
import { SelectedColorLabel } from "@/components/product-colors";
import { CelebrationEffect } from "@/components/interactive/celebration-effect";
import { EventCountdown } from "@/components/interactive/event-countdown";
import { downloadElementPdf } from "@/lib/pdf";
import { subscribeToPushNotifications } from "@/lib/pwa";

const STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار",
  confirmed: "مؤكد",
  processing: "قيد التجهيز",
  en_route: "الكادر بالطريق",
  shipped: "في الطريق",
  delivered: "تم التوصيل",
  cancelled: "ملغي",
  ready: "جاهز",
  completed: "مكتمل",
};

type Customer = {
  id: number;
  phone: string;
  name: string;
  fullName?: string;
  email?: string;
  avatarUrl?: string;
  avatarMetadata?: ImageMetadata;
  address?: string;
  city?: string;
  rewardPoints?: number;
  rewardLevel?: string;
};

type CustomerAddress = {
  id: number;
  type: "home" | "work" | "other";
  fullName: string;
  phone: string;
  governorate: string;
  city: string;
  address: string;
  landmark: string;
  notes: string;
  isDefault: boolean;
};

type AddressForm = Omit<CustomerAddress, "id">;
type OrderReview = {
  id: number;
  orderKind: "product" | "service" | string;
  orderId: number;
  rating: number;
  comment: string;
};

type Recommendations = {
  products: any[];
  services: any[];
};

type Rewards = {
  points: number;
  level: string;
  levelLabel: string;
  history: { id: number; points: number; note: string; createdAt: string }[];
};

type CustomerNotification = {
  id: number;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

const emptyAddressForm: AddressForm = {
  type: "home",
  fullName: "",
  phone: "",
  governorate: "",
  city: "",
  address: "",
  landmark: "",
  notes: "",
  isDefault: false,
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (typeof window !== "undefined" && !headers.has("x-session-id")) headers.set("x-session-id", getCartSessionId());
  const res = await fetch(url, { credentials: "include", ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "تعذر تحميل البيانات");
  return json as T;
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-2xl border border-border/30 p-5">
      <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <Icon className="w-5 h-5 text-primary" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function InfoItem({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-xl bg-background/60 border border-border/25 p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm text-foreground break-words">{value || "غير مضاف"}</p>
    </div>
  );
}

function addressTypeLabel(type: string): string {
  if (type === "work") return "العمل";
  if (type === "other") return "عنوان آخر";
  return "المنزل";
}

function customerInitials(customer: Customer): string {
  const source = (customer.fullName || customer.name || formatIraqiPhone(customer.phone)).trim();
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function AddressInput({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        className="w-full bg-background border border-border/40 rounded-xl px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
      />
    </label>
  );
}

export default function Profile() {
  const [, navigate] = useLocation();
  const profileRef = useRef<HTMLDivElement>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [cart, setCart] = useState<any>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [reviews, setReviews] = useState<OrderReview[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendations>({ products: [], services: [] });
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [loading, setLoading] = useState(true);
  const [trackCode, setTrackCode] = useState("");
  const [trackResult, setTrackResult] = useState<any>(null);
  const [trackError, setTrackError] = useState("");
  const [trackLoading, setTrackLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({ fullName: "", email: "", address: "", city: "" });
  const [avatarDraft, setAvatarDraft] = useState("");
  const [avatarMetadata, setAvatarMetadata] = useState<ImageMetadata>({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [addressForm, setAddressForm] = useState<AddressForm>(emptyAddressForm);
  const [editingAddressId, setEditingAddressId] = useState<number | null>(null);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressError, setAddressError] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [profilePdfLoading, setProfilePdfLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushMessage, setPushMessage] = useState("");
  const [loginCelebration, setLoginCelebration] = useState(false);
  const { data: settings } = usePublicSettings();

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetchJson<Customer>("/api/auth/me"),
      fetchJson<any[]>("/api/orders/my").catch(() => []),
      fetchJson<any>("/api/cart").catch(() => null),
      fetchJson<CustomerAddress[]>("/api/customer/addresses").catch(() => []),
      fetchJson<{ defaultPaymentMethod: "cash" | "card" }>("/api/customer/preferences").catch(() => ({ defaultPaymentMethod: "cash" as const })),
      fetchJson<OrderReview[]>("/api/customer/reviews").catch(() => []),
      fetchJson<Recommendations>("/api/customer/recommendations").catch(() => ({ products: [], services: [] })),
      fetchJson<Rewards>("/api/customer/rewards").catch(() => null),
      fetchJson<CustomerNotification[]>("/api/notifications/customer").catch(() => []),
    ])
      .then(([me, myOrders, myCart, savedAddresses, preferences, savedReviews, suggested, rewardInfo, customerNotifications]) => {
        if (!mounted) return;
        setCustomer(me);
        setProfileForm({
          fullName: me.fullName || me.name || "",
          email: me.email || "",
          address: me.address || "",
          city: me.city || "",
        });
        setAvatarDraft(me.avatarUrl || "");
        setAvatarMetadata(me.avatarMetadata ?? {});
        setOrders(myOrders);
        setCart(myCart);
        setAddresses(savedAddresses);
        setPaymentMethod(preferences.defaultPaymentMethod);
        setReviews(savedReviews);
        setRecommendations(suggested);
        setRewards(rewardInfo);
        setNotifications(customerNotifications);
        if (window.sessionStorage.getItem("ajn-profile-login-celebration")) {
          window.sessionStorage.removeItem("ajn-profile-login-celebration");
          setLoginCelebration(true);
        }
      })
      .catch(() => navigate("/login"))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const productOrders = useMemo(() => orders.filter((order) => order.kind !== "service"), [orders]);
  const serviceOrders = useMemo(() => orders.filter((order) => order.kind === "service"), [orders]);
  const latestCompletedOrder = useMemo(
    () => orders.find((order) => ["delivered", "completed"].includes(order.status)),
    [orders],
  );
  const ajnWhatsApp = buildWhatsAppLink(settings?.whatsapp || settings?.phone || "07701234567", "مرحباً، أحتاج مساعدة بخصوص حسابي");

  async function logout() {
    await fetchJson("/api/auth/logout", { method: "POST" }).catch(() => null);
    navigate("/login");
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileError("");
    try {
      const updated = await fetchJson<Customer>("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...profileForm, avatarUrl: avatarDraft, avatarMetadata }),
      });
      setCustomer(updated);
      setEditing(false);
    } catch (err: any) {
      setProfileError(err?.message || "تعذر حفظ الملف");
    } finally {
      setSavingProfile(false);
    }
  }

  function handleAvatarResult(results: ImageEditResult[]) {
    const result = results[0];
    if (!result) return;
    setAvatarDraft(result.dataUrl);
    setAvatarMetadata(result.metadata);
  }

  function startAddressCreate(type: AddressForm["type"] = "home") {
    setEditingAddressId(null);
    setAddressError("");
    setAddressForm({
      ...emptyAddressForm,
      type,
      fullName: customer?.fullName || customer?.name || "",
      phone: customer?.phone ? formatIraqiPhone(customer.phone) : "",
      city: customer?.city || "",
      address: customer?.address || "",
    });
    setShowAddressForm(true);
  }

  function startAddressEdit(address: CustomerAddress) {
    setEditingAddressId(address.id);
    setAddressError("");
    setAddressForm({ ...address, phone: formatIraqiPhone(address.phone) });
    setShowAddressForm(true);
  }

  async function saveAddress(e: React.FormEvent) {
    e.preventDefault();
    setSavingAddress(true);
    setAddressError("");
    try {
      const method = editingAddressId ? "PATCH" : "POST";
      const url = editingAddressId ? `/api/customer/addresses/${editingAddressId}` : "/api/customer/addresses";
      const saved = await fetchJson<CustomerAddress>(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addressForm),
      });
      setAddresses((rows) => {
        const next = editingAddressId ? rows.map((row) => row.id === saved.id ? saved : row) : [saved, ...rows];
        return saved.isDefault ? next.map((row) => ({ ...row, isDefault: row.id === saved.id })) : next;
      });
      setShowAddressForm(false);
      setEditingAddressId(null);
    } catch (err: any) {
      setAddressError(err?.message || "تعذر حفظ العنوان");
    } finally {
      setSavingAddress(false);
    }
  }

  async function deleteAddress(id: number) {
    setAddressError("");
    try {
      await fetchJson(`/api/customer/addresses/${id}`, { method: "DELETE" });
      setAddresses((rows) => rows.filter((row) => row.id !== id));
    } catch (err: any) {
      setAddressError(err?.message || "تعذر حذف العنوان");
    }
  }

  async function makeDefaultAddress(address: CustomerAddress) {
    setAddressError("");
    try {
      const saved = await fetchJson<CustomerAddress>(`/api/customer/addresses/${address.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      setAddresses((rows) => rows.map((row) => ({ ...row, isDefault: row.id === saved.id })));
    } catch (err: any) {
      setAddressError(err?.message || "تعذر تعيين العنوان الافتراضي");
    }
  }

  async function savePaymentPreference(method: "cash" | "card") {
    setSavingPayment(true);
    try {
      const saved = await fetchJson<{ defaultPaymentMethod: "cash" | "card" }>("/api/customer/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultPaymentMethod: method }),
      });
      setPaymentMethod(saved.defaultPaymentMethod);
    } catch (err: any) {
      alert(err?.message || "تعذر حفظ طريقة الدفع");
    } finally {
      setSavingPayment(false);
    }
  }

  async function trackOrder(e: React.FormEvent) {
    e.preventDefault();
    const code = trackCode.trim().toUpperCase();
    if (!code) return;
    setTrackLoading(true);
    setTrackError("");
    setTrackResult(null);
    try {
      setTrackResult(await fetchJson(`/api/orders/track/${encodeURIComponent(code)}`));
    } catch (err: any) {
      setTrackError(err?.message || "لم يتم العثور على الطلب");
    } finally {
      setTrackLoading(false);
    }
  }

  async function submitReview(order: any, rating: number, comment: string) {
    const saved = await fetchJson<OrderReview>("/api/customer/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderKind: order.kind === "service" ? "service" : "product", orderId: order.id, rating, comment }),
    });
    setReviews((rows) => [saved, ...rows.filter((row) => !(row.orderKind === saved.orderKind && row.orderId === saved.orderId))]);
  }

  async function reorder(order: any) {
    await fetchJson("/api/customer/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: order.id }),
    });
    navigate("/cart");
  }

  async function downloadProfilePdf() {
    setProfilePdfLoading(true);
    try {
      await downloadElementPdf(profileRef.current, `ajn-profile-${customer?.phone ?? "customer"}.pdf`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "تعذر تحميل PDF، جرّب الطباعة أو إعادة المحاولة.");
    } finally {
      setProfilePdfLoading(false);
    }
  }

  async function enableCustomerPush() {
    setPushLoading(true);
    setPushMessage("");
    try {
      await subscribeToPushNotifications();
      setPushMessage("تم تفعيل الإشعارات على هذا الجهاز");
    } catch (err: any) {
      setPushMessage(err?.message || "تعذر تفعيل الإشعارات");
    } finally {
      setPushLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-12 min-h-screen" dir="rtl">
        <div className="max-w-5xl mx-auto bg-card rounded-2xl border border-border/30 p-8 text-center text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
          جاري تحميل ملف الزبون...
        </div>
      </div>
    );
  }

  if (!customer) return null;

  return (
    <div className="container mx-auto px-4 py-10 min-h-screen" dir="rtl">
      <CelebrationEffect
        active={!!latestCompletedOrder}
        storageKey={latestCompletedOrder ? `ajn-profile-complete-${latestCompletedOrder.kind ?? "order"}-${latestCompletedOrder.id}` : undefined}
        message="شكراً لك، اكتمل طلبك بنجاح"
      />
      <CelebrationEffect
        active={loginCelebration}
        storageKey={`ajn-profile-login-${customer.id}`}
        message="أهلاً بك في حسابك"
      />
      <div ref={profileRef} className="max-w-6xl mx-auto space-y-6">
        <div className="bg-card rounded-2xl border border-border/30 p-6 flex flex-col md:flex-row md:items-center gap-5">
          <div className="relative w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden">
            {(avatarDraft || customer.avatarUrl) ? (
              <img src={avatarDraft || customer.avatarUrl} alt="" width={80} height={80} loading="lazy" decoding="async" className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-bold text-primary">{customerInitials(customer)}</span>
            )}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-foreground">{customer.fullName || customer.name || formatIraqiPhone(customer.phone)}</h1>
            <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
              <Phone className="w-4 h-4" />
              {customer.email || formatIraqiPhone(customer.phone)}
            </p>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => setEditing((value) => !value)}>
            <Pencil className="w-4 h-4" />
            تعديل الملف
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6">
          <div className="space-y-6">
            <Section title="معلوماتي" icon={User}>
              {editing ? (
                <form onSubmit={saveProfile} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      ["fullName", "الاسم الكامل"],
                      ["email", "البريد الإلكتروني"],
                      ["address", "العنوان"],
                      ["city", "المدينة / المحافظة"],
                    ].map(([key, label]) => (
                      <label key={key} className="block">
                        <span className="block text-xs text-muted-foreground mb-1">{label}</span>
                        <input
                          value={profileForm[key as keyof typeof profileForm]}
                          onChange={(e) => setProfileForm((form) => ({ ...form, [key]: e.target.value }))}
                          className="w-full bg-background border border-border/40 rounded-xl px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="rounded-xl bg-background/60 border border-border/25 p-4">
                    <ImageUploadEditor
                      kind="avatar"
                      label="رفع صورة بروفايل"
                      currentImage={avatarDraft}
                      currentMetadata={avatarMetadata}
                      settings={settings?.image_settings}
                      onComplete={handleAvatarResult}
                      onRemove={() => { setAvatarDraft(""); setAvatarMetadata({}); }}
                    />
                  </div>
                  {profileError && <p className="text-sm text-red-400">{profileError}</p>}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button type="submit" disabled={savingProfile} className="gap-2">
                      {savingProfile && <Loader2 className="w-4 h-4 animate-spin" />}
                      حفظ التعديل
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                      إلغاء
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <InfoItem label="الاسم الكامل" value={customer.fullName || customer.name} />
                  <InfoItem label="رقم الهاتف" value={formatIraqiPhone(customer.phone)} />
                  <InfoItem label="البريد الإلكتروني" value={customer.email} />
                  <InfoItem label="العنوان" value={customer.address} />
                  <InfoItem label="المدينة / المحافظة" value={customer.city} />
                </div>
              )}
            </Section>

            <Section title="طلباتي / مشترياتي" icon={Package}>
              <OrderList rows={productOrders} empty="لا توجد مشتريات حتى الآن" reviews={reviews} onReview={submitReview} onReorder={reorder} contactPhone={settings?.whatsapp || settings?.phone} />
              {serviceOrders.length > 0 && (
                <div className="mt-5">
                  <p className="text-sm font-semibold text-foreground mb-3">الحجوزات السابقة</p>
                  <OrderList rows={serviceOrders} empty="" reviews={reviews} onReview={submitReview} contactPhone={settings?.whatsapp || settings?.phone} />
                </div>
              )}
            </Section>

            <Section title="اقتراحات لك" icon={Star}>
              <SuggestionGrid products={recommendations.products} services={recommendations.services} />
            </Section>

            <Section title="تتبع الطلب" icon={Search}>
              <form onSubmit={trackOrder} className="flex flex-col sm:flex-row gap-3">
                <input
                  value={trackCode}
                  onChange={(e) => setTrackCode(e.target.value.toUpperCase())}
                  placeholder="AJN-2089"
                  className="flex-1 bg-background border border-border/40 rounded-xl px-4 py-3 text-foreground font-mono placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                />
                <Button type="submit" disabled={trackLoading} className="gap-2">
                  {trackLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  تتبع
                </Button>
              </form>
              {trackError && <p className="text-sm text-red-400 mt-3">{trackError}</p>}
              {trackResult && (
                <div className="mt-4 space-y-3">
                  {(Array.isArray(trackResult) ? trackResult : [trackResult]).map((result: any, index: number) => (
                    <div key={`${result.kind ?? "order"}-${result.id ?? index}`} className="rounded-xl bg-background/60 border border-border/25 p-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-mono font-bold text-foreground">{result.trackingCode}</p>
                        <p className="text-sm text-muted-foreground">{STATUS_LABELS[result.status] ?? result.status}</p>
                      </div>
                      <Link href={`/track?code=${result.trackingCode}`} className="text-primary text-sm font-medium">
                        عرض التفاصيل
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="الفواتير" icon={Download}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button variant="outline" className="gap-2" onClick={() => window.print()}>
                  <Printer className="w-4 h-4" />
                  طباعة الفاتورة
                </Button>
                <Button variant="outline" className="gap-2" onClick={downloadProfilePdf} disabled={profilePdfLoading}>
                  {profilePdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {profilePdfLoading ? "جاري التحميل..." : "تحميل الفاتورة PDF"}
                </Button>
              </div>
            </Section>
          </div>

          <div className="space-y-6">
            <Section title="السلة" icon={ShoppingBag}>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{cart?.itemCount ?? cart?.items?.length ?? 0} منتج</p>
                <p className="font-bold text-primary">{Number(cart?.total ?? 0).toLocaleString("ar-IQ")} د.ع</p>
              </div>
              <Link href="/cart" className="mt-4 inline-flex text-sm text-primary font-medium">فتح السلة</Link>
            </Section>

            <Section title="نقاطي ومكافآتي" icon={Trophy}>
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
                <p className="text-xs text-muted-foreground mb-1">المستوى الحالي</p>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-lg font-bold text-primary">{rewards?.levelLabel ?? "برونزي"}</p>
                  <p className="text-2xl font-bold text-foreground">{Number(rewards?.points ?? customer.rewardPoints ?? 0).toLocaleString("ar-IQ")}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">النقاط تظهر بعد اكتمال الطلب أو الحجز.</p>
              </div>
              <div className="mt-3 space-y-2">
                {rewards?.history?.length ? rewards.history.slice(0, 3).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between rounded-xl border border-border/25 bg-background/60 p-3 text-xs">
                    <span className="text-muted-foreground">{entry.note || "تحديث نقاط"}</span>
                    <span className={entry.points >= 0 ? "text-primary font-semibold" : "text-red-300 font-semibold"}>
                      {entry.points > 0 ? "+" : ""}{entry.points.toLocaleString("ar-IQ")}
                    </span>
                  </div>
                )) : (
                  <div className="rounded-xl border border-border/25 bg-background/60 p-3 text-sm text-muted-foreground">
                    لا يوجد سجل نقاط بعد.
                  </div>
                )}
              </div>
            </Section>

            <Section title="المفضلة" icon={Heart}>
              <div className="rounded-xl bg-background/60 border border-border/25 p-4 text-sm text-muted-foreground">
                المنتجات المحفوظة ستظهر هنا عند إضافتها للمفضلة.
              </div>
            </Section>

            <Section title="العناوين المحفوظة" icon={MapPin}>
              <div className="space-y-3">
                {addresses.length === 0 && !showAddressForm && (
                  <div className="rounded-xl bg-background/60 border border-border/25 p-4 text-sm text-muted-foreground">
                    لا توجد عناوين محفوظة بعد.
                  </div>
                )}
                {addresses.map((address) => (
                  <div key={address.id} className="rounded-xl bg-background/60 border border-border/25 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-semibold text-foreground">{addressTypeLabel(address.type)}</p>
                          {address.isDefault && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">افتراضي</span>}
                        </div>
                        <p className="text-sm text-muted-foreground">{address.fullName} · {formatIraqiPhone(address.phone)}</p>
                        <p className="text-sm text-foreground mt-1">{address.governorate} / {address.city}</p>
                        <p className="text-xs text-muted-foreground mt-1 break-words">{address.address}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!address.isDefault && (
                          <button type="button" onClick={() => makeDefaultAddress(address)} className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10" title="تعيين افتراضي">
                            <Star className="w-4 h-4" />
                          </button>
                        )}
                        <button type="button" onClick={() => startAddressEdit(address)} className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10" title="تعديل">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => deleteAddress(address.id)} className="p-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10" title="حذف">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {showAddressForm && (
                  <form onSubmit={saveAddress} className="rounded-xl bg-background/60 border border-border/25 p-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="block text-xs text-muted-foreground mb-1">نوع العنوان</span>
                        <select value={addressForm.type} onChange={(e) => setAddressForm((form) => ({ ...form, type: e.target.value as AddressForm["type"] }))} className="w-full bg-background border border-border/40 rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-primary/50">
                          <option value="home">المنزل</option>
                          <option value="work">العمل</option>
                          <option value="other">عنوان آخر</option>
                        </select>
                      </label>
                      <AddressInput label="الاسم الكامل" value={addressForm.fullName} onChange={(fullName) => setAddressForm((form) => ({ ...form, fullName }))} />
                      <AddressInput label="رقم الهاتف" value={addressForm.phone} onChange={(phone) => setAddressForm((form) => ({ ...form, phone: formatIraqiPhoneInput(phone) }))} inputMode="numeric" />
                      <AddressInput label="المحافظة" value={addressForm.governorate} onChange={(governorate) => setAddressForm((form) => ({ ...form, governorate }))} />
                      <AddressInput label="المدينة" value={addressForm.city} onChange={(city) => setAddressForm((form) => ({ ...form, city }))} />
                      <AddressInput label="العنوان التفصيلي" value={addressForm.address} onChange={(address) => setAddressForm((form) => ({ ...form, address }))} />
                      <AddressInput label="أقرب نقطة دالة" value={addressForm.landmark} onChange={(landmark) => setAddressForm((form) => ({ ...form, landmark }))} />
                      <AddressInput label="ملاحظات" value={addressForm.notes} onChange={(notes) => setAddressForm((form) => ({ ...form, notes }))} />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={addressForm.isDefault} onChange={(e) => setAddressForm((form) => ({ ...form, isDefault: e.target.checked }))} />
                      عنوان افتراضي
                    </label>
                    {addressError && <p className="text-sm text-red-400">{addressError}</p>}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button type="submit" disabled={savingAddress} className="gap-2">
                        {savingAddress && <Loader2 className="w-4 h-4 animate-spin" />}
                        حفظ العنوان
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setShowAddressForm(false)}>إلغاء</Button>
                    </div>
                  </form>
                )}
                {!showAddressForm && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Button variant="outline" className="gap-2" onClick={() => startAddressCreate("home")}>
                      <Home className="w-4 h-4" />
                      المنزل
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={() => startAddressCreate("work")}>
                      <MapPin className="w-4 h-4" />
                      العمل
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={() => startAddressCreate("other")}>
                      <Plus className="w-4 h-4" />
                      عنوان جديد
                    </Button>
                  </div>
                )}
              </div>
            </Section>

            <Section title="طرق الدفع" icon={Wallet}>
              <div className="grid grid-cols-2 gap-3">
                {(["cash", "card"] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => savePaymentPreference(method)}
                    disabled={savingPayment}
                    className={`rounded-xl border p-4 text-right transition-colors ${paymentMethod === method ? "border-primary bg-primary/10 text-primary" : "border-border/25 bg-background/60 text-foreground hover:border-primary/40"}`}
                  >
                    <p className="text-xs text-muted-foreground mb-1">{method === "cash" ? "كاش" : "بطاقة"}</p>
                    <p className="text-sm font-semibold">{paymentMethod === method ? "طريقة افتراضية" : method === "cash" ? "متاح دائماً" : "اختياري"}</p>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3 rounded-xl bg-background/60 border border-border/25 p-3">
                لا يتم حفظ بيانات البطاقة داخل النظام.
              </p>
              <Button variant="outline" className="w-full mt-3 gap-2" onClick={() => savePaymentPreference(paymentMethod)} disabled={savingPayment}>
                <CreditCard className="w-4 h-4" />
                حفظ طريقة الدفع
              </Button>
            </Section>

            <Section title="الإشعارات" icon={Bell}>
              <div className="space-y-3 text-sm text-foreground">
                <div className="space-y-2">
                  <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> تحديث حالة الطلب</label>
                  <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> العروض والخصومات</label>
                  <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> رسائل الإدارة</label>
                </div>
                <Button type="button" variant="outline" className="w-full gap-2" onClick={enableCustomerPush} disabled={pushLoading}>
                  {pushLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                  تفعيل إشعارات الجهاز
                </Button>
                {pushMessage && <p className="rounded-xl border border-border/25 bg-background/60 p-3 text-xs text-muted-foreground">{pushMessage}</p>}
                {notifications.length > 0 && (
                  <div className="space-y-2">
                    {notifications.slice(0, 3).map((item) => (
                      <div key={item.id} className={`rounded-xl border p-3 ${item.readAt ? "border-border/25 bg-background/60" : "border-primary/25 bg-primary/10"}`}>
                        <p className="text-sm font-semibold text-foreground">{item.title}</p>
                        {item.body && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{item.body}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>

            <Section title="الدعم والمساعدة" icon={HelpCircle}>
              <div className="grid grid-cols-1 gap-3">
                <a href={ajnWhatsApp} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl border border-green-600/30 bg-green-600/10 text-green-400 py-3 text-sm font-medium">
                  <MessageCircle className="w-4 h-4" />
                  تواصل واتساب
                </a>
                <Button variant="outline" className="gap-2">إرسال شكوى</Button>
                <Button variant="outline" className="gap-2">الأسئلة الشائعة</Button>
              </div>
            </Section>

            <Section title="الإعدادات" icon={Settings}>
              <div className="grid grid-cols-1 gap-3">
                <Button variant="outline">تغيير كلمة المرور</Button>
                <Button variant="outline">اللغة</Button>
                <Button variant="outline" className="gap-2">
                  <Moon className="w-4 h-4" />
                  الوضع الليلي
                </Button>
              </div>
            </Section>

            <Button onClick={logout} variant="destructive" size="lg" className="w-full gap-2">
              <LogOut className="w-5 h-5" />
              تسجيل الخروج
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderList({
  rows,
  empty,
  reviews,
  onReview,
  onReorder,
  contactPhone,
}: {
  rows: any[];
  empty: string;
  reviews: OrderReview[];
  onReview: (order: any, rating: number, comment: string) => Promise<void>;
  onReorder?: (order: any) => Promise<void>;
  contactPhone?: string;
}) {
  if (rows.length === 0) {
    return empty ? (
      <div className="text-center py-10 bg-background/60 rounded-xl border border-border/25">
        <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-muted-foreground">{empty}</p>
        <Link href="/store" className="inline-flex mt-3 text-sm text-primary font-medium">تصفح المتجر</Link>
      </div>
    ) : null;
  }

  return (
    <div className="space-y-3">
      {rows.map((order) => (
        <div key={`${order.kind ?? "order"}-${order.id}`} className="rounded-xl bg-background/60 border border-border/25 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex gap-3">
              <OrderThumb order={order} />
              <div>
                <p className="font-mono text-sm font-bold text-foreground">{order.trackingCode}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(order.createdAt).toLocaleDateString("ar-IQ", { year: "numeric", month: "long", day: "numeric" })}
              </p>
              {["delivered", "completed"].includes(order.status) && (
                <p className="text-xs text-green-300 mt-1">شكراً لك، اكتمل الطلب بنجاح.</p>
              )}
              {order.kind !== "service" && order.items?.[0] && (
                <SelectedColorLabel
                  color={order.items[0].selectedColorData}
                  fallback={order.items[0].selectedColor}
                  className="mt-2 flex text-xs text-muted-foreground"
                />
              )}
              <div className="mt-3 flex items-center gap-2">
                {["pending", "confirmed", "processing", "shipped", "delivered", "completed"].slice(0, order.kind === "service" ? 4 : 6).map((status, index) => {
                  const current = ["pending", "confirmed", "processing", "shipped", "delivered", "completed"].indexOf(order.status);
                  const active = current >= index;
                  return <span key={status} className={`h-1.5 flex-1 min-w-6 rounded-full ${active ? "bg-primary" : "bg-border/40"}`} />;
                })}
              </div>
              </div>
            </div>
            <div className="flex items-center gap-3 sm:justify-end">
              <div className="text-right">
                <p className="font-bold text-primary">{Number(order.total ?? 0).toLocaleString("ar-IQ")} د.ع</p>
                <p className="text-xs text-muted-foreground">{STATUS_LABELS[order.status] ?? order.status}</p>
                {Number(order.remainingAmount ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground">المتبقي: {Number(order.remainingAmount ?? 0).toLocaleString("ar-IQ")} د.ع</p>
                )}
              </div>
              {order.kind !== "service" && (
                <button type="button" onClick={() => onReorder?.(order)} className="hidden sm:inline-flex items-center justify-center rounded-lg border border-border/40 px-3 py-2 text-sm text-foreground hover:text-primary transition-colors">
                  <RefreshCcw className="w-4 h-4" />
                </button>
              )}
              <a href={buildWhatsAppLink(contactPhone || "07701234567", `استفسار بخصوص الطلب ${order.trackingCode}`)} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-lg border border-green-600/30 bg-green-600/10 px-3 py-2 text-sm text-green-400 hover:bg-green-600/20 transition-colors">
                <MessageCircle className="w-4 h-4" />
              </a>
              <Link href={`/track?code=${order.trackingCode}`} className="inline-flex items-center justify-center rounded-lg border border-border/40 px-3 py-2 text-sm text-foreground hover:text-primary transition-colors">
                عرض التفاصيل
              </Link>
            </div>
          </div>
          {order.kind === "service" && order.eventDate && (
            <EventCountdown targetDate={order.eventDate} compact className="mt-4" />
          )}
          {["delivered", "completed"].includes(order.status) && (
            <ReviewBox
              review={reviews.find((review) => review.orderKind === (order.kind === "service" ? "service" : "product") && review.orderId === order.id)}
              onSubmit={(rating, comment) => onReview(order, rating, comment)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function OrderThumb({ order }: { order: any }) {
  const image = order.kind === "service" ? order.serviceImage : order.items?.[0]?.image;
  return (
    <div className="w-14 h-14 rounded-xl bg-card border border-border/30 overflow-hidden flex items-center justify-center shrink-0">
      {image ? <img src={image} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : <Package className="w-6 h-6 text-primary" />}
    </div>
  );
}

function ReviewBox({ review, onSubmit }: { review?: OrderReview; onSubmit: (rating: number, comment: string) => Promise<void> }) {
  const [rating, setRating] = useState(review?.rating ?? 5);
  const [comment, setComment] = useState(review?.comment ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRating(review?.rating ?? 5);
    setComment(review?.comment ?? "");
  }, [review?.rating, review?.comment]);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await onSubmit(rating, comment);
        } finally {
          setSaving(false);
        }
      }}
      className="mt-4 rounded-xl bg-card/70 border border-border/25 p-3"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-foreground">تقييمك بعد التسليم</p>
          <div className="flex items-center gap-1 mt-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button key={value} type="button" onClick={() => setRating(value)} className={value <= rating ? "text-primary" : "text-muted-foreground"}>
                <Star className="w-4 h-4 fill-current" />
              </button>
            ))}
          </div>
        </div>
        <Button type="submit" size="sm" disabled={saving}>{review ? "تحديث التقييم" : "إرسال التقييم"}</Button>
      </div>
      <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="ملاحظتك عن الطلب" className="mt-3 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
    </form>
  );
}

function SuggestionGrid({ products, services }: Recommendations) {
  const items = [
    ...products.map((product) => ({ key: `p-${product.id}`, title: product.nameAr, image: product.images?.[0], href: `/store/${product.id}`, meta: "منتج مقترح" })),
    ...services.map((service) => ({ key: `s-${service.id}`, title: service.nameAr, image: service.image, href: `/services/${service.id}`, meta: "خدمة مقترحة" })),
  ].slice(0, 4);
  if (items.length === 0) {
    return <div className="rounded-xl bg-background/60 border border-border/25 p-4 text-sm text-muted-foreground">لا توجد اقتراحات حالياً.</div>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map((item) => (
        <Link key={item.key} href={item.href} className="rounded-xl bg-background/60 border border-border/25 p-3 flex items-center gap-3 hover:border-primary/40 transition-colors">
          <div className="w-14 h-14 rounded-lg bg-card border border-border/30 overflow-hidden shrink-0">
            {item.image ? <img src={item.image} alt="" loading="lazy" className="w-full h-full object-cover" /> : null}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{item.title}</p>
            <p className="text-xs text-muted-foreground mt-1">{item.meta}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
