import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchAdminMe, loginAdmin, hasPerm, type AdminMe } from "./_lib";
import { ADMIN_NAV } from "./_layout";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";

export default function AdminLogin({ onAuthed }: { onAuthed?: (me: AdminMe) => void }) {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { data: settings } = usePublicSettings();

  useEffect(() => {
    let alive = true;
    fetchAdminMe().then(me => {
      if (!alive) return;
      if (me) {
        onAuthed?.(me);
        const first = ADMIN_NAV.find(n => hasPerm(me, n.perm));
        setLocation(first?.href ?? "/admin/dashboard");
      }
    });
    return () => { alive = false; };
  }, [setLocation]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setSubmitting(true);
    try {
      const user = await loginAdmin(username.trim(), password);
      onAuthed?.(user);
      const first = ADMIN_NAV.find(n => hasPerm(user, n.perm));
      setLocation(first?.href ?? "/admin/dashboard");
    } catch (err: any) {
      setLoginError(err?.message?.includes("401") ? "بيانات الدخول غير صحيحة" : "تعذر تسجيل الدخول");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={48} height={48} decoding="async" className="h-12 w-12 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">دخول الإدارة</h1>
          <p className="text-muted-foreground text-sm mt-1">{settings?.site_name ?? "مجموعة علي جان"}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border/30 p-8">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-2">اسم المستخدم</label>
              <input
                type="text" value={username} autoFocus autoComplete="username"
                onChange={e => { setUsername(e.target.value); setLoginError(null); }}
                className="w-full bg-background border border-border/40 rounded-xl px-4 py-3.5 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="alijan"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-2">كلمة المرور</label>
              <input
                type="password" value={password} autoComplete="current-password"
                onChange={e => { setPassword(e.target.value); setLoginError(null); }}
                className="w-full bg-background border border-border/40 rounded-xl px-4 py-3.5 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="••••••••"
                dir="ltr"
              />
            </div>
            {loginError && <p className="text-status-danger text-sm text-center">{loginError}</p>}
            <Button type="submit" className="w-full py-5" disabled={submitting || !username || !password}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "دخول"}
            </Button>
          </form>
        </div>
        <div className="mt-6 text-center">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
            <ArrowRight className="w-3.5 h-3.5" />
            العودة إلى الموقع
          </Link>
        </div>
      </div>
    </div>
  );
}
