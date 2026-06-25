import { useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle, Loader2, MessageCircle, Phone, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIraqiPhone, formatIraqiPhoneInput, normalizeIraqiPhone, normalizePhoneDigits } from "@/lib/phone";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";

type Step = "phone" | "otp";

async function postJson<T>(url: string, data: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "تعذر إكمال الطلب");
  return json as T;
}

export default function Login() {
  const [, navigate] = useLocation();
  const { data: settings } = usePublicSettings();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sentPhone, setSentPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const normalized = normalizeIraqiPhone(phone);
    if (!normalized) {
      setError("أدخل رقم عراقي صحيح مثل 07700000000");
      return;
    }
    setLoading(true);
    try {
      await postJson("/api/auth/whatsapp/request-otp", { phone: normalized });
      setSentPhone(normalized);
      setStep("otp");
    } catch (err: any) {
      setError(err?.message || "تعذر إرسال رمز التحقق عبر واتساب");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const normalized = normalizeIraqiPhone(sentPhone || phone);
    const code = normalizePhoneDigits(otp).slice(0, 6);
    if (!normalized || code.length !== 6) {
      setError("أدخل رمز التحقق المكون من 6 أرقام");
      return;
    }
    setLoading(true);
    try {
      await postJson("/api/auth/whatsapp/verify-otp", { phone: normalized, otp: code });
      window.sessionStorage.setItem("ajn-profile-login-celebration", "1");
      navigate("/profile");
    } catch (err: any) {
      setError(err?.message || "رمز التحقق غير صحيح");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-12 min-h-screen" dir="rtl">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
            <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={48} height={48} decoding="async" className="h-12 w-12 object-contain" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">تسجيل الدخول</h1>
          <p className="text-muted-foreground">ادخل برقم هاتفك العراقي واستلم رمز التحقق على واتساب</p>
        </div>

        <div className="bg-card rounded-2xl border border-border/30 p-6 shadow-sm">
          {step === "phone" ? (
            <form onSubmit={requestOtp} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">رقم الهاتف</label>
                <div className="relative">
                  <Phone className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    value={phone}
                    onChange={(e) => setPhone(formatIraqiPhoneInput(e.target.value))}
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="07700000000"
                    className="w-full bg-background border border-border/40 rounded-xl pr-12 pl-4 py-4 text-foreground text-lg placeholder-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
                  />
                </div>
              </div>
              {error && <p className="text-sm text-status-danger text-center">{error}</p>}
              <Button type="submit" size="lg" className="w-full h-12" disabled={loading}>
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <MessageCircle className="w-5 h-5" />}
                إرسال رمز واتساب
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} className="space-y-5">
              <div className="rounded-xl bg-primary/5 border border-primary/15 p-4 flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                <p className="text-sm text-muted-foreground">
                  تم إرسال الرمز إلى <span className="text-foreground font-semibold">{formatIraqiPhone(sentPhone)}</span>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">رمز التحقق</label>
                <div className="relative">
                  <ShieldCheck className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    value={otp}
                    onChange={(e) => setOtp(normalizePhoneDigits(e.target.value).slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    className="w-full bg-background border border-border/40 rounded-xl pr-12 pl-4 py-4 text-foreground text-lg tracking-[0.4em] text-center placeholder-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
                  />
                </div>
              </div>
              {error && <p className="text-sm text-status-danger text-center">{error}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button type="submit" size="lg" className="h-12" disabled={loading}>
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                  تحقق
                </Button>
                <Button type="button" variant="outline" size="lg" className="h-12" disabled={loading} onClick={() => setStep("phone")}>
                  تغيير الرقم
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
