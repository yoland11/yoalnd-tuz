import { useState } from "react";
import {
  useGetCart,
  useGetMe,
  useGetMyOrders,
  useRequestOtp,
  useVerifyOtp,
  useLogout,
  getGetMeQueryKey,
  getGetMyOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { User, Package, LogOut, Phone, CheckCircle, ShoppingCart } from "lucide-react";
import { clearAuthToken, getAuthToken, setAuthToken } from "@/lib/api-session";
import { formatIraqiPhone, formatIraqiPhoneInput, normalizeIraqiPhone, normalizePhoneDigits } from "@/lib/phone";

const STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار",
  confirmed: "مؤكد",
  processing: "قيد التجهيز",
  shipped: "في الطريق",
  delivered: "تم التوصيل",
  cancelled: "ملغي",
};

export default function Account() {
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState(() => getAuthToken());

  const { data: me, isLoading: meLoading } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!token,
      retry: false,
    },
  });
  const { data: myOrders, isLoading: ordersLoading } = useGetMyOrders({
    query: {
      queryKey: getGetMyOrdersQueryKey(),
      enabled: !!me,
    },
  });
  const { data: cart } = useGetCart();

  const requestOtp = useRequestOtp();
  const verifyOtp = useVerifyOtp();
  const logout = useLogout();

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalizedPhone = normalizeIraqiPhone(phone);
    if (!normalizedPhone) {
      setError("أدخل رقم عراقي صحيح مثل 07700000000");
      return;
    }
    requestOtp.mutate(
      { data: { phone: normalizedPhone } },
      {
        onSuccess: () => {
          setStep("otp");
        },
        onError: (err: any) => setError(err?.message?.replace(/^HTTP \d+:\s*/, "") || "تعذر إرسال الرمز عبر واتساب"),
      }
    );
  }

  function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalizedPhone = normalizeIraqiPhone(phone);
    const normalizedOtp = normalizePhoneDigits(otp).slice(0, 6);
    if (!normalizedPhone || normalizedOtp.length < 4) {
      setError("أدخل رمز التحقق بشكل صحيح");
      return;
    }
    verifyOtp.mutate(
      { data: { phone: normalizedPhone, otp: normalizedOtp } },
      {
        onSuccess: (res) => {
          setAuthToken(res.token);
          setTokenState(res.token);
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMyOrdersQueryKey() });
        },
        onError: (err: any) => setError(err?.message?.replace(/^HTTP \d+:\s*/, "") || "رمز التحقق غير صحيح"),
      }
    );
  }

  function handleLogout() {
    logout.mutate(undefined, {
      onSuccess: () => {
        clearAuthToken();
        setTokenState(null);
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        queryClient.clear();
      },
    });
  }

  if (meLoading) {
    return (
      <div className="container mx-auto px-4 py-12" dir="rtl">
        <Skeleton className="h-10 w-48 mb-8" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  // Logged in view
  if (me) {
    const rows = ((myOrders ?? []) as any[]);
    const productOrders = rows.filter(order => order.kind !== "service");
    const serviceOrders = rows.filter(order => order.kind === "service");
    return (
      <div className="container mx-auto px-4 py-10 min-h-screen" dir="rtl">
        <div className="max-w-2xl mx-auto">
          {/* Profile Card */}
          <div className="bg-card rounded-2xl border border-border/30 p-6 mb-6 flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
              <User className="w-8 h-8 text-primary" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-foreground">{me.name || formatIraqiPhone(me.phone)}</h2>
              <p className="text-muted-foreground text-sm flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" />
                {formatIraqiPhone(me.phone)}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive transition-colors"
            >
              <LogOut className="w-4 h-4" />
              خروج
            </button>
          </div>

          <div className="bg-card rounded-2xl border border-border/30 p-5 mb-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-foreground">السلة</p>
                <p className="text-xs text-muted-foreground">{cart?.items?.length ?? 0} منتج</p>
              </div>
            </div>
            <p className="text-primary font-bold">{Number(cart?.total ?? 0).toLocaleString("ar-IQ")} د.ع</p>
          </div>

          {/* Orders */}
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            طلباتي
          </h3>

          {ordersLoading ? (
            <div className="space-y-3">
              {[1,2].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          ) : productOrders.length > 0 ? (
            <div className="space-y-3">
              {productOrders.map(order => (
                <div key={order.id} className="bg-card rounded-xl border border-border/30 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono text-sm font-bold text-foreground">{order.trackingCode}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(order.createdAt).toLocaleDateString('ar-IQ', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-primary font-bold">{Number(order.total).toLocaleString('ar-IQ')} د.ع</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${
                        order.status === "delivered" ? "border-green-500/30 text-green-400" :
                        order.status === "cancelled" ? "border-red-500/30 text-red-400" :
                        "border-yellow-500/30 text-yellow-400"
                      }`}>
                        {STATUS_LABELS[order.status] ?? order.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-card rounded-xl border border-border/30">
              <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">لا توجد طلبات بعد</p>
            </div>
          )}

          <h3 className="text-lg font-semibold text-foreground mt-8 mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            حجوزاتي
          </h3>
          {ordersLoading ? (
            <div className="space-y-3">
              {[1,2].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          ) : serviceOrders.length > 0 ? (
            <div className="space-y-3">
              {serviceOrders.map(order => (
                <div key={`service-${order.id}`} className="bg-card rounded-xl border border-border/30 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono text-sm font-bold text-foreground">{order.trackingCode}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{order.serviceName ?? "حجز خدمة"}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full border border-yellow-500/30 text-yellow-400">
                      {STATUS_LABELS[order.status] ?? order.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-card rounded-xl border border-border/30">
              <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">لا توجد حجوزات بعد</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Login view
  return (
    <div className="container mx-auto px-4 py-20 min-h-screen flex items-start justify-center" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <User className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">تسجيل الدخول</h1>
          <p className="text-muted-foreground text-sm mt-1">سجّل دخولك لمتابعة طلباتك</p>
        </div>

        <div className="bg-card rounded-2xl border border-border/30 p-8">
          {step === "phone" ? (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-2">رقم الهاتف</label>
                <input
                  value={phone}
                  onChange={e => {
                    setPhone(formatIraqiPhoneInput(e.target.value));
                    setError(null);
                  }}
                  type="tel"
                  inputMode="numeric"
                  placeholder="07700000000"
                  className="w-full bg-background border border-border/40 rounded-xl px-4 py-3.5 text-foreground text-lg font-mono placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <Button type="submit" className="w-full py-5" disabled={requestOtp.isPending}>
                {requestOtp.isPending ? "جاري الإرسال..." : "إرسال رمز التحقق"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="text-center mb-2">
                <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">تم إرسال رمز التحقق إلى</p>
                <p className="font-mono text-foreground">{formatIraqiPhone(phone)}</p>
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-2">رمز التحقق</label>
                <input
                  value={otp}
                  onChange={e => setOtp(normalizePhoneDigits(e.target.value).slice(0, 6))}
                  placeholder="123456"
                  maxLength={6}
                  className="w-full bg-background border border-border/40 rounded-xl px-4 py-3.5 text-foreground text-2xl font-mono tracking-widest text-center placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              {error && <p className="text-red-400 text-sm text-center">{error}</p>}
              <Button type="submit" className="w-full py-5" disabled={verifyOtp.isPending}>
                {verifyOtp.isPending ? "جاري التحقق..." : "تأكيد الدخول"}
              </Button>
              <button
                type="button"
                onClick={() => { setStep("phone"); setError(null); }}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                تغيير رقم الهاتف
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
