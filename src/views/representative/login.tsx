import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Redirect, useLocation } from "wouter";
import { GraduationCap, Loader2, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { canEnterRepresentativePortal } from "@/lib/representative-login-routing";
import {
  adminFetch,
  apiErrorMessage,
  apiErrorStatus,
  isSessionDecision,
  loginAdmin,
  logoutAdmin,
  type AdminMe,
} from "@/views/admin/_lib";

export default function RepresentativeLogin() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data: settings } = usePublicSettings();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const session = useQuery({
    queryKey: ["representative", "login-session"],
    queryFn: async () => {
      try {
        return (await adminFetch<{ user: AdminMe }>("/admin/auth/me")).user;
      } catch (error) {
        if (apiErrorStatus(error) === 401) return null;
        throw error;
      }
    },
    retry: false,
  });

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError(null);
    setSubmitting(true);
    async function attempt(forceReplace: boolean) {
      const user = await loginAdmin(username.trim(), password, { forceReplace });
      if (!canEnterRepresentativePortal(user)) {
        await logoutAdmin();
        setLoginError("هذا الحساب لا يملك صلاحية بوابة الممثلين. تواصل مع الإدارة.");
        return;
      }
      queryClient.setQueryData(["representative", "login-session"], user);
      await queryClient.invalidateQueries({ queryKey: ["representative", "me"] });
      navigate("/representative");
    }
    try {
      await attempt(false);
    } catch (error) {
      if (isSessionDecision(error) && window.confirm(error.message)) {
        try {
          await attempt(true);
        } catch (retryError) {
          setLoginError(apiErrorMessage(retryError, "تعذر تسجيل الدخول"));
        }
      } else if (!isSessionDecision(error)) {
        setLoginError(apiErrorMessage(error, "تعذر تسجيل الدخول"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (session.isPending) return (
    <div className="grid min-h-dvh place-items-center bg-[#fff8fa]" dir="rtl">
      <Loader2 className="h-7 w-7 animate-spin text-[#b85c65]" aria-label="جاري التحقق من الحساب" />
    </div>
  );
  if (session.isError) return (
    <main className="grid min-h-dvh place-items-center bg-[#fff8fa] p-4" dir="rtl">
      <div className="w-full max-w-sm rounded-2xl border border-rose-100 bg-white p-7 text-center">
        <h1 className="text-lg font-bold">تعذر التحقق من جلسة الدخول</h1>
        <p className="mt-2 text-sm text-muted-foreground">{apiErrorMessage(session.error)}</p>
        <Button variant="outline" className="mt-5" onClick={() => void session.refetch()}>
          <RefreshCw className="ml-2 h-4 w-4" /> إعادة المحاولة
        </Button>
      </div>
    </main>
  );
  if (session.data && canEnterRepresentativePortal(session.data))
    return <Redirect to="/representative" />;

  return (
    <main className="grid min-h-dvh place-items-center bg-[#fff8fa] p-4" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-rose-100 bg-white shadow-sm">
            <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} className="h-12 w-12 object-contain" />
          </div>
          <h1 className="flex items-center justify-center gap-2 text-2xl font-bold text-slate-900">
            <GraduationCap className="h-6 w-6 text-[#b85c65]" /> بوابة الممثلين
          </h1>
          <p className="mt-2 text-sm text-slate-500">ادخل بحساب الموظف المخصص لمجموعتك</p>
        </div>
        <div className="rounded-[22px] border border-rose-100 bg-white p-6 shadow-[0_6px_24px_rgba(24,32,51,.04)]">
          {session.data ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-slate-700">الحساب الحالي لا يملك صلاحية بوابة الممثلين.</p>
              <Button variant="outline" className="w-full" onClick={async () => {
                await logoutAdmin();
                queryClient.setQueryData(["representative", "login-session"], null);
              }}><LogOut className="ml-2 h-4 w-4" /> استخدام حساب آخر</Button>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="representative-username" className="mb-1.5 block text-sm font-medium">اسم المستخدم</label>
                <input id="representative-username" autoComplete="username" dir="ltr" autoFocus
                  value={username} onChange={(event) => setUsername(event.target.value)}
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b85c65]" />
              </div>
              <div>
                <label htmlFor="representative-password" className="mb-1.5 block text-sm font-medium">كلمة المرور</label>
                <input id="representative-password" type="password" autoComplete="current-password" dir="ltr"
                  value={password} onChange={(event) => setPassword(event.target.value)}
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b85c65]" />
              </div>
              {loginError && <p role="alert" className="text-sm text-red-700">{loginError}</p>}
              <Button type="submit" disabled={submitting || !username.trim() || !password}
                className="h-12 w-full rounded-xl bg-[#b85c65] text-white hover:bg-[#9f4954]">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "دخول"}
              </Button>
            </form>
          )}
        </div>
        <p className="mt-5 text-center text-xs text-slate-500">
          ليس لديك حساب ممثل؟ اطلب من الإدارة ربط حساب الموظف بمجموعتك.
        </p>
        <Link href="/" className="mt-3 block text-center text-xs text-[#b85c65] hover:underline">العودة إلى الموقع</Link>
      </div>
    </main>
  );
}
