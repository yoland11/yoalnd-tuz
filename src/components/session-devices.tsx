import { useCallback, useEffect, useState } from "react";
import {
  LogOut,
  Loader2,
  Monitor,
  Smartphone,
  ShieldAlert,
  RefreshCw,
  UserRoundCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  apiErrorMessage,
  fetchSessions,
  revokeDeviceSession,
  logoutAllDevices,
  managerLogoutEmployee,
  switchEmployee,
  type DeviceSession,
} from "@/views/admin/_lib";

const PORTAL_LABEL: Record<string, string> = {
  admin: "الإدارة",
  photography: "المصورين",
  kosha: "الكوشات",
  sound: "الصوت",
  staff: "الكادر",
};

const STATUS_LABEL: Record<DeviceSession["status"], string> = {
  active: "نشطة",
  revoked: "ملغاة",
  expired: "منتهية",
};

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ar-IQ-u-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function isMobileDevice(device: string): boolean {
  return ["iPhone", "iPad", "Android"].includes(device);
}

/**
 * Shared "الأجهزة المسجل الدخول منها" panel + controlled account actions.
 * Used by every staff portal (admin / photography / kosha). It lists the
 * current user's sessions, lets them revoke another device, switch employee,
 * or sign out of every device — each scoped to this user only.
 *
 * `staffId` (managers only) lists a specific employee's sessions instead.
 * `onSwitched` fires after a switch/logout-all so the host can re-render its
 * inline login.
 */
export function SessionDevicesPanel({
  portal,
  staffId,
  onSwitched,
}: {
  portal?: string;
  staffId?: number;
  onSwitched?: () => void;
}) {
  const { toast } = useToast();
  const isManagerView = typeof staffId === "number";
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showAllReason, setShowAllReason] = useState(false);

  const load = useCallback(() => {
    setSessions(null);
    fetchSessions(staffId)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [staffId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onRevoke(session: DeviceSession) {
    if (!session.sessionId || busy) return;
    setBusy(session.sessionId);
    try {
      await revokeDeviceSession(session.sessionId);
      toast({ title: "تم إلغاء الجلسة" });
      if (session.current && !isManagerView) {
        // Revoked our own current device — behave like a normal logout.
        onSwitched?.();
        return;
      }
      load();
    } catch (err) {
      toast({
        title: apiErrorMessage(err, "تعذر إلغاء الجلسة"),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function onLogoutAll() {
    if (busy) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      toast({ title: "يجب إدخال سبب", variant: "destructive" });
      return;
    }
    setBusy("all");
    try {
      const count = await logoutAllDevices(trimmed);
      toast({
        title: "تم تسجيل الخروج من جميع أجهزتك.",
        description: `تم إنهاء ${count} جلسة`,
      });
      onSwitched?.();
    } catch (err) {
      toast({
        title: apiErrorMessage(err, "تعذر تسجيل الخروج من الأجهزة"),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function onSwitch() {
    if (busy) return;
    setBusy("switch");
    try {
      await switchEmployee();
      onSwitched?.();
    } catch (err) {
      toast({
        title: apiErrorMessage(err, "تعذر تبديل الموظف"),
        variant: "destructive",
      });
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-foreground">
          الأجهزة المسجل الدخول منها
        </h2>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" /> تحديث
        </button>
      </div>

      {sessions === null ? (
        <div className="p-6 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">
          لا توجد جلسات
        </div>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s, idx) => {
            const Icon = isMobileDevice(s.device) ? Smartphone : Monitor;
            const key = s.sessionId ?? `s-${idx}`;
            return (
              <li
                key={key}
                className={`rounded-xl border p-3 ${
                  s.current
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/30 bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {s.browser} · {s.device}
                        </span>
                        {s.current && (
                          <Badge variant="secondary" className="text-[10px]">
                            هذا الجهاز
                          </Badge>
                        )}
                        {s.status !== "active" && (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-muted-foreground"
                          >
                            {STATUS_LABEL[s.status]}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {s.portal
                          ? `بوابة ${PORTAL_LABEL[s.portal] ?? s.portal} · `
                          : ""}
                        آخر نشاط: {formatWhen(s.lastActiveAt)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        دخول: {formatWhen(s.createdAt)}
                        {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                      </div>
                    </div>
                  </div>
                  {s.status === "active" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={busy === s.sessionId}
                      onClick={() => onRevoke(s)}
                    >
                      {busy === s.sessionId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : s.current && !isManagerView ? (
                        "خروج"
                      ) : (
                        "إلغاء"
                      )}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!isManagerView && (
        <div className="space-y-3 border-t border-border/30 pt-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onSwitch}
              disabled={busy === "switch"}
            >
              {busy === "switch" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserRoundCog className="h-4 w-4" />
              )}
              تبديل الموظف
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setShowAllReason((v) => !v)}
            >
              <ShieldAlert className="h-4 w-4" />
              تسجيل الخروج من جميع الأجهزة
            </Button>
          </div>

          {showAllReason && (
            <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs text-muted-foreground">
                سيتم إنهاء جميع جلساتك على كل الأجهزة. أدخل السبب للمتابعة.
              </p>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="سبب تسجيل الخروج من جميع الأجهزة"
                rows={2}
                className="text-sm"
              />
              <Button
                variant="destructive"
                size="sm"
                onClick={onLogoutAll}
                disabled={busy === "all"}
              >
                {busy === "all" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}
                تأكيد الخروج من الكل
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Manager control for a specific employee: lists that employee's sessions and
 * can revoke ALL of them with a required reason (audited). Only that employee's
 * sessions are affected — never the manager's or anyone else's. Requires the
 * `staff` permission server-side.
 */
export function EmployeeSessionsManager({
  staffId,
  employeeName,
}: {
  staffId: number;
  employeeName?: string;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  async function onLogoutAll() {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast({ title: "يجب إدخال سبب", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const count = await managerLogoutEmployee(staffId, trimmed);
      toast({
        title: "تم تسجيل الخروج من جميع أجهزة الموظف.",
        description: `تم إنهاء ${count} جلسة`,
      });
      setReason("");
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast({
        title: apiErrorMessage(err, "تعذر تسجيل الخروج من أجهزة الموظف"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" dir="rtl">
      <SessionDevicesPanel key={reloadKey} staffId={staffId} />
      <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
        <p className="text-xs text-muted-foreground">
          إنهاء جميع جلسات {employeeName || "هذا الموظف"} على كل الأجهزة. أدخل السبب.
        </p>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="سبب إنهاء جلسات الموظف"
          rows={2}
          className="text-sm"
        />
        <Button
          variant="destructive"
          size="sm"
          onClick={onLogoutAll}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldAlert className="h-4 w-4" />
          )}
          تسجيل الخروج من جميع أجهزة الموظف
        </Button>
      </div>
    </div>
  );
}
