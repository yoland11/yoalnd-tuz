import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, RefreshCw, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { baghdadDate, baghdadMoment, baghdadTime } from "@/lib/attendance-rules";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";

const GEOFENCE_PATH = "/admin/attendance/geofence";
const ADMIN_GEOFENCE_QUERY = ["admin", "attendance", "geofence"] as const;
const OWN_GEOFENCE_QUERY = ["staff", "attendance", "geofence"] as const;

const STATUS = {
  inside: { label: "داخل نطاق العمل", tone: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" },
  outside: { label: "خارج نطاق العمل", tone: "bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  returned: { label: "عاد إلى نطاق العمل", tone: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" },
  checked_out: { label: "انتهت المتابعة بالانصراف", tone: "bg-muted text-foreground" },
  unavailable: { label: "تعذر التحقق من الموقع", tone: "bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  exempt: { label: "مستثنى من المتابعة", tone: "bg-sky-500/10 text-sky-800 dark:text-sky-300" },
  inactive: { label: "المتابعة غير مفعّلة", tone: "bg-muted text-foreground" },
};
const REVIEW = { pending: "بانتظار المراجعة", approved: "معتمد في التقرير", rejected: "مرفوض في التقرير" };
const EXCEPTION = { temporary_exit: "خروج مؤقت", delivery: "توصيل", external_event: "مناسبة خارجية" };
type GeofenceStatus = keyof typeof STATUS;
type ExceptionKind = keyof typeof EXCEPTION;
type StaffStatus = { staffId: number; recordId: number | null; status: GeofenceStatus; workplace: string | null };
type GeofenceVisit = {
  id: number;
  staffId: number;
  staffName: string | null;
  workplace: string | null;
  exitAt: number;
  returnAt: number | null;
  endedAt: number | null;
  outsideSeconds: number | null;
  verification: "verified" | "interrupted" | "ongoing";
  reviewStatus: keyof typeof REVIEW;
};
type GeofenceException = {
  id: number;
  staffId: number;
  staffName: string | null;
  kind: ExceptionKind;
  startsAt: number;
  endsAt: number;
  reason: string;
  revokedAt: number | null;
};
type GeofenceDashboardData = { statuses: StaffStatus[]; visits: GeofenceVisit[]; exceptions: GeofenceException[] };
type OwnGeofence = {
  recordId: number | null;
  eligible: boolean;
  consented: boolean;
  status: GeofenceStatus;
  workplace: string | null;
  startsAt: number | null;
  endsAt: number | null;
};
type StaffOption = { id: number; fullName: string };
type DialogAction = { kind: "create" } | { kind: "review"; visit: GeofenceVisit } | { kind: "revoke"; exception: GeofenceException };
type GeofenceWrite =
  | { kind: "create"; body: { staffId: number; kind: ExceptionKind; startsAt: number; endsAt: number; reason: string } }
  | { kind: "review"; id: number; approved: boolean; note: string }
  | { kind: "revoke"; id: number };

export function useAttendanceGeofenceDashboard(date: string, enabled = true) {
  return useQuery<GeofenceDashboardData>({
    queryKey: [...ADMIN_GEOFENCE_QUERY, date],
    queryFn: ({ signal }) => adminFetch(`${GEOFENCE_PATH}/dashboard?date=${encodeURIComponent(date)}`, { signal }),
    enabled: enabled && Boolean(date),
    refetchInterval: 60_000,
    retry: false,
  });
}

export function GeofenceStatusBadge({ status }: { status: GeofenceStatus }) {
  const display = STATUS[status] ?? STATUS.unavailable;
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${display.tone}`}>{display.label}</span>;
}

export function GeofenceLoadError({ error, retry, busy }: { error: unknown; retry: () => void; busy: boolean }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      <span><strong>تعذّر تحميل متابعة نطاق العمل.</strong> {apiErrorMessage(error, "حاول تحديث حالة الموقع.")}</span>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={retry}>إعادة المحاولة</Button>
    </div>
  );
}

export function EmployeeGeofenceNotice({ enabled }: { enabled: boolean }) {
  const client = useQueryClient();
  const own = useQuery<OwnGeofence>({
    queryKey: OWN_GEOFENCE_QUERY,
    queryFn: ({ signal }) => adminFetch(GEOFENCE_PATH, { signal }),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
  const revoke = useMutation({
    mutationFn: (recordId: number) => adminFetch(`${GEOFENCE_PATH}/consent`, {
      method: "POST",
      body: JSON.stringify({ recordId, consent: false }),
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: OWN_GEOFENCE_QUERY }),
  });
  if (!enabled) return null;
  if (own.isError) {
    return (
      <div className="mt-4 space-y-2">
        {revoke.isSuccess ? <p role="status" className="text-sm font-medium">أوقفت متابعة موقعك</p> : null}
        <GeofenceLoadError error={own.error} busy={own.isFetching} retry={() => void own.refetch()} />
      </div>
    );
  }
  const state = own.data;
  if (!state) return null;
  const revoked = revoke.isSuccess && revoke.variables === state.recordId && !state.consented;
  if (!state.consented && !state.eligible && state.status === "inactive" && !revoked) return null;
  const consentedRecord = state.consented ? state.recordId : null;
  return (
    <section aria-label="متابعة نطاق العمل" className="mt-4 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><Shield className="h-4 w-4 text-primary" aria-hidden />متابعة نطاق العمل</h3>
        <GeofenceStatusBadge status={state.status} />
      </div>
      {state.workplace ? <p className="mt-2 break-words font-medium">{state.workplace}</p> : null}
      {state.startsAt != null && state.endsAt != null ? <p className="mt-1 text-xs text-muted-foreground">فترة الوردية بتوقيت بغداد <bdi dir="ltr" className="tabular-nums">{baghdadTime(state.startsAt)}–{baghdadTime(state.endsAt)}</bdi></p> : null}
      <p className="mt-2 text-muted-foreground">متابعة الدخول والخروج من نطاق العمل اختيارية وتعمل من تطبيق الموظف أثناء الوردية. يمكنك إيقافها في أي وقت.</p>
      {revoked ? <p role="status" className="mt-2 font-medium">أوقفت متابعة موقعك</p> : null}
      {revoke.isError && revoke.variables === state.recordId ? <p role="alert" className="mt-2 text-destructive">{apiErrorMessage(revoke.error, "تعذّر إيقاف متابعة الموقع")}</p> : null}
      {consentedRecord != null ? (
        <Button type="button" variant="outline" className="mt-3 min-h-11" disabled={revoke.isPending} onClick={() => revoke.mutate(consentedRecord)}>
          {revoke.isPending ? "جارٍ إيقاف المتابعة…" : "إيقاف متابعة موقعي"}
        </Button>
      ) : null}
    </section>
  );
}

function DateTime({ value }: { value: number }) {
  return <time dateTime={new Date(value).toISOString()} dir="ltr" className="inline-block tabular-nums">{baghdadDate(value)} {baghdadTime(value)}</time>;
}

function OutsideDuration({ seconds }: { seconds: number | null }) {
  if (seconds == null) return "المدة غير معروفة";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remaining = seconds % 60;
  return [hours ? `${hours} س` : "", minutes ? `${minutes} د` : "", remaining || (!hours && !minutes) ? `${remaining} ث` : ""].filter(Boolean).join(" ");
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{children}</dd></div>;
}

function EmployeeName({ name, id }: { name: string | null; id: number }) {
  return <span className="break-words font-semibold">{name ?? `موظف #${id}`}</span>;
}

function ExceptionForm({ staff, busy, error, submit }: { staff: StaffOption[]; busy: boolean; error: unknown; submit: (data: Extract<GeofenceWrite, { kind: "create" }>) => void }) {
  const [validation, setValidation] = useState("");
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const [startDate, startTime] = String(form.get("startsAt")).split("T");
    const [endDate, endTime] = String(form.get("endsAt")).split("T");
    const startsAt = startTime ? baghdadMoment(startDate, startTime).getTime() : NaN;
    const endsAt = endTime ? baghdadMoment(endDate, endTime).getTime() : NaN;
    const reason = String(form.get("reason") ?? "").trim();
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
      setValidation("حدد بداية الإذن ونهايته. يجب أن تكون النهاية بعد البداية.");
      return;
    }
    if (!reason) {
      setValidation("اكتب سبب الإذن.");
      return;
    }
    setValidation("");
    submit({ kind: "create", body: { staffId: Number(form.get("staffId")), kind: form.get("kind") as ExceptionKind, startsAt, endsAt, reason } });
  }
  return (
    <form className="space-y-3" onSubmit={save}>
      <div>
        <label htmlFor="attendance-exception-employee" className="block text-sm font-medium">الموظف</label>
        <select id="attendance-exception-employee" name="staffId" required className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-2 text-sm">
          <option value="">اختر الموظف</option>
          {staff.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="attendance-exception-kind" className="block text-sm font-medium">نوع الإذن</label>
        <select id="attendance-exception-kind" name="kind" className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-2 text-sm">
          {Object.entries(EXCEPTION).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset className="min-w-0 text-sm font-medium"><legend>بداية الإذن</legend><Input type="datetime-local" name="startsAt" aria-label="تاريخ البداية" required className="mt-1" /></fieldset>
        <fieldset className="min-w-0 text-sm font-medium"><legend>نهاية الإذن</legend><Input type="datetime-local" name="endsAt" aria-label="تاريخ النهاية" required className="mt-1" /></fieldset>
      </div>
      <label className="block text-sm font-medium">سبب الإذن<Textarea name="reason" required maxLength={500} className="mt-1" /></label>
      {validation || error ? <p role="alert" className="text-sm text-destructive">{validation || apiErrorMessage(error)}</p> : null}
      <Button type="submit" className="min-h-11" disabled={busy}>{busy ? "جارٍ حفظ الإذن…" : "حفظ الإذن"}</Button>
    </form>
  );
}

export function AttendanceGeofenceHistory({ date, onDateChange, staff, canManage, canReview }: { date: string; onDateChange: (date: string) => void; staff: StaffOption[]; canManage: boolean; canReview: boolean }) {
  const client = useQueryClient();
  const { toast } = useToast();
  const dashboard = useAttendanceGeofenceDashboard(date);
  const [action, setAction] = useState<DialogAction | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const write = useMutation({
    mutationFn: (input: GeofenceWrite) => {
      if (input.kind === "create") return adminFetch(`${GEOFENCE_PATH}/exceptions`, { method: "POST", body: JSON.stringify(input.body) });
      if (input.kind === "revoke") return adminFetch(`${GEOFENCE_PATH}/exceptions/${input.id}/revoke`, { method: "POST" });
      return adminFetch(`${GEOFENCE_PATH}/visits/${input.id}/review`, { method: "POST", body: JSON.stringify({ approved: input.approved, note: input.note }) });
    },
    onSuccess: async (_, input) => {
      await client.invalidateQueries({ queryKey: ADMIN_GEOFENCE_QUERY });
      const title = input.kind === "create" ? "حُفظ إذن الخروج" : input.kind === "revoke" ? "أُلغي إذن الخروج" : "حُفظت مراجعة الخروج";
      toast({ title });
      setAction(null);
    },
  });
  const openAction = (next: DialogAction | null, origin?: HTMLButtonElement) => {
    if (origin) trigger.current = origin;
    write.reset();
    setAction(next);
  };
  const title = action?.kind === "create" ? "إضافة إذن خروج" : action?.kind === "revoke" ? "إلغاء الإذن" : "مراجعة الخروج";
  const data = dashboard.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-0">
          <h2 ref={heading} tabIndex={-1} className="flex items-center gap-2 text-lg font-bold"><MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />سجل نطاق العمل</h2>
          <p className="mt-1 text-sm text-muted-foreground">أحداث الخروج والعودة وأذونات العمل خارج الموقع. الأوقات بتوقيت بغداد.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-col gap-1 text-xs font-medium">
            <label htmlFor="attendance-geofence-date">تاريخ السجل</label>
            <Input id="attendance-geofence-date" type="date" className="w-40" value={date} onChange={(event) => onDateChange(event.target.value)} />
          </div>
          <Button type="button" variant="outline" className="min-h-10" disabled={!date || dashboard.isFetching} onClick={() => void dashboard.refetch()}><RefreshCw className="h-4 w-4" aria-hidden />تحديث السجل</Button>
        </div>
      </div>
      {!date ? <p className="text-sm text-muted-foreground">اختر تاريخاً لعرض السجل.</p> : dashboard.isError ? (
        <GeofenceLoadError error={dashboard.error} busy={dashboard.isFetching} retry={() => void dashboard.refetch()} />
      ) : !data ? <Skeleton aria-label="جارٍ تحميل سجل نطاق العمل" className="h-32 w-full" /> : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <section aria-label="سجل الخروج والعودة" className="min-w-0 rounded-xl border border-border bg-card">
            <div className="p-4">
              <h3 className="font-bold">سجل الخروج والعودة</h3>
              <p className="mt-1 text-sm text-muted-foreground">تُعتمد الحالات في تقرير المتابعة فقط. لا يترتب عليها خصم من الراتب.</p>
            </div>
            {data.visits.length ? <ul className="divide-y divide-border border-t border-border">
              {data.visits.map((visit) => <li key={visit.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><EmployeeName id={visit.staffId} name={visit.staffName} /><p className="mt-1 break-words text-xs text-muted-foreground">{visit.workplace ?? "موقع العمل غير محدد"}</p></div>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{REVIEW[visit.reviewStatus]}</span>
                </div>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Detail label="الخروج"><DateTime value={visit.exitAt} /></Detail>
                  <Detail label="العودة">{visit.returnAt != null ? <DateTime value={visit.returnAt} /> : visit.verification === "ongoing" ? "لم تُسجّل العودة بعد" : "وقت العودة غير معروف"}</Detail>
                  <Detail label={visit.verification === "verified" ? "المدة خارج النطاق" : "المدة المتحقق منها"}><OutsideDuration seconds={visit.outsideSeconds} /></Detail>
                </dl>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{visit.verification === "interrupted" ? "تعذر التحقق من الموقع" : visit.verification === "ongoing" ? "خروج جارٍ" : "تم التحقق من الخروج والعودة"}</p>
                  {canReview && visit.endedAt != null && visit.reviewStatus === "pending" ? <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={(event) => openAction({ kind: "review", visit }, event.currentTarget)}>مراجعة الخروج</Button> : null}
                </div>
              </li>)}
            </ul> : <p className="border-t border-border p-4 text-sm text-muted-foreground">لا توجد أحداث خروج مسجّلة في هذا التاريخ.</p>}
          </section>
          <section aria-label="أذونات الخروج" className="min-w-0 rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 p-4">
              <h3 className="font-bold">أذونات الخروج</h3>
              {canManage ? <Button type="button" size="sm" className="min-h-10" onClick={(event) => openAction({ kind: "create" }, event.currentTarget)}><Plus className="h-4 w-4" aria-hidden />إضافة إذن خروج</Button> : null}
            </div>
            {data.exceptions.length ? <ul className="divide-y divide-border border-t border-border">
              {data.exceptions.map((exception) => <li key={exception.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <EmployeeName id={exception.staffId} name={exception.staffName} />
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{exception.revokedAt != null ? "إذن ملغى" : EXCEPTION[exception.kind]}</span>
                </div>
                <dl className="grid grid-cols-2 gap-3">
                  <Detail label="من"><DateTime value={exception.startsAt} /></Detail>
                  <Detail label="إلى"><DateTime value={exception.endsAt} /></Detail>
                </dl>
                <p className="break-words text-sm text-muted-foreground">{exception.reason}</p>
                {canManage && exception.revokedAt == null ? <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={(event) => openAction({ kind: "revoke", exception }, event.currentTarget)}>إلغاء الإذن</Button> : null}
              </li>)}
            </ul> : <p className="border-t border-border p-4 text-sm text-muted-foreground">لا توجد أذونات خروج في هذا التاريخ.</p>}
          </section>
        </div>
      )}
      <Dialog open={Boolean(action && (action.kind === "review" ? canReview : canManage))} onOpenChange={(open) => { if (!open && !write.isPending) openAction(null); }}>
        <DialogContent dir="rtl" className="max-h-[90dvh] w-[min(calc(100%-2rem),30rem)] overflow-y-auto" onCloseAutoFocus={(event) => {
          event.preventDefault();
          (trigger.current?.isConnected ? trigger.current : heading.current)?.focus();
          trigger.current = null;
        }}>
          <DialogHeader className="text-start">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {action?.kind === "create" ? "استثنِ الموظف من متابعة نطاق العمل في الوقت المحدد بتوقيت بغداد." : action?.kind === "review" ? "يُسجَّل القرار في تقرير المتابعة. لا يتغيّر الراتب أو سجل الحضور." : "ينتهي استثناء الموظف من متابعة نطاق العمل بعد تأكيد الإلغاء."}
            </DialogDescription>
          </DialogHeader>
          {action?.kind === "create" ? <ExceptionForm staff={staff} busy={write.isPending} error={write.error} submit={write.mutate} /> : null}
          {action?.kind === "review" ? (
            <form className="space-y-3" onSubmit={(event) => {
              event.preventDefault();
              const choice = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
              if (!choice) return;
              const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
              write.mutate({ kind: "review", id: action.visit.id, approved: choice === "approve", note });
            }}>
              <p><EmployeeName id={action.visit.staffId} name={action.visit.staffName} /> · <DateTime value={action.visit.exitAt} /></p>
              <label className="block text-sm font-medium">ملاحظة المراجعة <span className="text-muted-foreground">(اختيارية)</span><Textarea name="note" maxLength={500} className="mt-1" /></label>
              {write.isError ? <p role="alert" className="text-sm text-destructive">{apiErrorMessage(write.error)}</p> : null}
              <DialogFooter className="gap-2 sm:justify-start">
                <Button type="submit" value="approve" className="min-h-11" disabled={write.isPending}>{write.isPending && write.variables?.kind === "review" && write.variables.approved ? "جارٍ الاعتماد…" : "اعتماد السجل"}</Button>
                <Button type="submit" value="reject" variant="outline" className="min-h-11" disabled={write.isPending}>{write.isPending && write.variables?.kind === "review" && !write.variables.approved ? "جارٍ الرفض…" : "رفض السجل"}</Button>
              </DialogFooter>
            </form>
          ) : null}
          {action?.kind === "revoke" ? <>
            <p><EmployeeName id={action.exception.staffId} name={action.exception.staffName} /> · {EXCEPTION[action.exception.kind]}</p>
            {write.isError ? <p role="alert" className="text-sm text-destructive">{apiErrorMessage(write.error)}</p> : null}
            <DialogFooter className="gap-2 sm:justify-start">
              <Button type="button" variant="destructive" className="min-h-11" disabled={write.isPending} onClick={() => write.mutate({ kind: "revoke", id: action.exception.id })}>{write.isPending ? "جارٍ إلغاء الإذن…" : "تأكيد الإلغاء"}</Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={write.isPending} onClick={() => openAction(null)}>رجوع</Button>
            </DialogFooter>
          </> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
