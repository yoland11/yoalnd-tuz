import { useEffect, useMemo, useState } from "react";
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
  Search,
  Settings,
  ShoppingBag,
  Star,
  Trash2,
  User,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIraqiPhone, formatIraqiPhoneInput } from "@/lib/phone";
import { buildWhatsAppLink } from "@/lib/order-stages";
import { usePublicSettings } from "@/lib/public-settings";

const STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار",
  confirmed: "مؤكد",
  processing: "قيد التجهيز",
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
  address?: string;
  city?: string;
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
  const res = await fetch(url, { credentials: "include", ...init });
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
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [cart, setCart] = useState<any>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [loading, setLoading] = useState(true);
  const [trackCode, setTrackCode] = useState("");
  const [trackResult, setTrackResult] = useState<any>(null);
  const [trackError, setTrackError] = useState("");
  const [trackLoading, setTrackLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({ fullName: "", email: "", address: "", city: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [addressForm, setAddressForm] = useState<AddressForm>(emptyAddressForm);
  const [editingAddressId, setEditingAddressId] = useState<number | null>(null);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressError, setAddressError] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const { data: settings } = usePublicSettings();

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetchJson<Customer>("/api/auth/me"),
      fetchJson<any[]>("/api/orders/my").catch(() => []),
      fetchJson<any>("/api/cart").catch(() => null),
      fetchJson<CustomerAddress[]>("/api/customer/addresses").catch(() => []),
      fetchJson<{ defaultPaymentMethod: "cash" | "card" }>("/api/customer/preferences").catch(() => ({ defaultPaymentMethod: "cash" as const })),
    ])
      .then(([me, myOrders, myCart, savedAddresses, preferences]) => {
        if (!mounted) return;
        setCustomer(me);
        setProfileForm({
          fullName: me.fullName || me.name || "",
          email: me.email || "",
          address: me.address || "",
          city: me.city || "",
        });
        setOrders(myOrders);
        setCart(myCart);
        setAddresses(savedAddresses);
        setPaymentMethod(preferences.defaultPaymentMethod);
      })
      .catch(() => navigate("/login"))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const productOrders = useMemo(() => orders.filter((order) => order.kind !== "service"), [orders]);
  const serviceOrders = useMemo(() => orders.filter((order) => order.kind === "service"), [orders]);
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
        body: JSON.stringify(profileForm),
      });
      setCustomer(updated);
      setEditing(false);
    } catch (err: any) {
      setProfileError(err?.message || "تعذر حفظ الملف");
    } finally {
      setSavingProfile(false);
    }
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
    await fetchJson(`/api/customer/addresses/${id}`, { method: "DELETE" });
    setAddresses((rows) => rows.filter((row) => row.id !== id));
  }

  async function makeDefaultAddress(address: CustomerAddress) {
    const saved = await fetchJson<CustomerAddress>(`/api/customer/addresses/${address.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    setAddresses((rows) => rows.map((row) => ({ ...row, isDefault: row.id === saved.id })));
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
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-card rounded-2xl border border-border/30 p-6 flex flex-col md:flex-row md:items-center gap-5">
          <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden">
            {customer.avatarUrl ? <img src={customer.avatarUrl} alt="" className="w-full h-full object-cover" /> : <User className="w-10 h-10 text-primary" />}
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
              <OrderList rows={productOrders} empty="لا توجد مشتريات حتى الآن" />
              {serviceOrders.length > 0 && (
                <div className="mt-5">
                  <p className="text-sm font-semibold text-foreground mb-3">الحجوزات السابقة</p>
                  <OrderList rows={serviceOrders} empty="" />
                </div>
              )}
            </Section>

            <Section title="تتبع الطلب" icon={Search}>
              <form onSubmit={trackOrder} className="flex flex-col sm:flex-row gap-3">
                <input
                  value={trackCode}
                  onChange={(e) => setTrackCode(e.target.value.toUpperCase())}
                  placeholder="AJN1234567"
                  className="flex-1 bg-background border border-border/40 rounded-xl px-4 py-3 text-foreground font-mono placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                />
                <Button type="submit" disabled={trackLoading} className="gap-2">
                  {trackLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  تتبع
                </Button>
              </form>
              {trackError && <p className="text-sm text-red-400 mt-3">{trackError}</p>}
              {trackResult && (
                <div className="mt-4 rounded-xl bg-background/60 border border-border/25 p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono font-bold text-foreground">{trackResult.trackingCode}</p>
                    <p className="text-sm text-muted-foreground">{STATUS_LABELS[trackResult.status] ?? trackResult.status}</p>
                  </div>
                  <Link href={`/track?code=${trackResult.trackingCode}`} className="text-primary text-sm font-medium">
                    عرض التفاصيل
                  </Link>
                </div>
              )}
            </Section>

            <Section title="الفواتير" icon={Download}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button variant="outline" className="gap-2" onClick={() => window.print()}>
                  <Printer className="w-4 h-4" />
                  طباعة الفاتورة
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => window.print()}>
                  <Download className="w-4 h-4" />
                  تحميل الفاتورة PDF
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
              <div className="space-y-2 text-sm text-foreground">
                <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> تحديث حالة الطلب</label>
                <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> العروض والخصومات</label>
                <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> رسائل الإدارة</label>
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

function OrderList({ rows, empty }: { rows: any[]; empty: string }) {
  if (rows.length === 0) {
    return empty ? (
      <div className="text-center py-10 bg-background/60 rounded-xl border border-border/25">
        <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-muted-foreground">{empty}</p>
      </div>
    ) : null;
  }

  return (
    <div className="space-y-3">
      {rows.map((order) => (
        <div key={`${order.kind ?? "order"}-${order.id}`} className="rounded-xl bg-background/60 border border-border/25 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="font-mono text-sm font-bold text-foreground">{order.trackingCode}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(order.createdAt).toLocaleDateString("ar-IQ", { year: "numeric", month: "long", day: "numeric" })}
              </p>
            </div>
            <div className="flex items-center gap-3 sm:justify-end">
              <div className="text-right">
                <p className="font-bold text-primary">{Number(order.total ?? 0).toLocaleString("ar-IQ")} د.ع</p>
                <p className="text-xs text-muted-foreground">{STATUS_LABELS[order.status] ?? order.status}</p>
              </div>
              <Link href={`/track?code=${order.trackingCode}`} className="inline-flex items-center justify-center rounded-lg border border-border/40 px-3 py-2 text-sm text-foreground hover:text-primary transition-colors">
                عرض التفاصيل
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
