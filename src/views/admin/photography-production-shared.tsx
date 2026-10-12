import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  BookImage,
  Camera,
  CheckCircle2,
  Clapperboard,
  Clock3,
  ExternalLink,
  History,
  Loader2,
  Printer,
  RotateCcw,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmployeeSelect } from "@/components/employee-select";
import { useToast } from "@/hooks/use-toast";
import {
  OVERDUE_LABEL,
  PRODUCTION_KINDS,
  PRODUCTION_KIND_LABELS,
  PRODUCTION_STATUS_LABELS,
  allowedTransitions,
  isOverdue,
  type ProductionKind,
  type ProductionProgress,
  type ProductionStatus,
} from "@/lib/photography-production";
import { adminFetch } from "./_lib";

export const PRODUCTION_API = "/admin/photography-production";
export const PRODUCTION_QUERY_KEY = ["admin", "photography-production"] as const;

export type ProductionPermissions = { canManage: boolean; canOrder: boolean; canViewAll: boolean };

export type ProductionBookingRef = {
  id: number;
  number: string;
  customerName: string;
  phone: string;
  eventDate: string | null;
  eventType: string | null;
  hall: string | null;
  status: string | null;
};

export type ProductionItem = {
  id: number;
  bookingId: number;
  kind: ProductionKind;
  status: ProductionStatus;
  assigneeStaffId: number | null;
  assigneeName: string | null;
  assigneePhotoUrl?: string | null;
  dueDate: string | null;
  notes?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  statusChangedAt?: string | null;
  statusChangedByName?: string | null;
  createdByName?: string | null;
  booking?: ProductionBookingRef;
};

export type ProductionHistoryEntry = {
  id: number;
  title: string;
  body: string | null;
  actorName: string;
  metadata: Record<string, any>;
  createdAt: string;
};

export type BookingProduction = {
  booking: ProductionBookingRef & { archived: boolean; eventTime: string | null };
  eligible: { isPhotography: boolean; reasons: string[] };
  suggestedKinds: ProductionKind[];
  items: ProductionItem[];
  progress: ProductionProgress;
  history: ProductionHistoryEntry[];
  today: string;
  permissions: ProductionPermissions;
  meId: number;
};

export type ProductionStaff = {
  id: number;
  name: string;
  jobTitle: string | null;
  department: string | null;
  photoUrl: string | null;
  photography: boolean;
};

export const KIND_ICONS: Record<ProductionKind, typeof Camera> = {
  video: Clapperboard,
  photos: Camera,
  album: BookImage,
  printing: Printer,
};

export const STATUS_TONES: Record<ProductionStatus | "overdue", string> = {
  remaining: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
  in_progress: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  waiting_files: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  overdue: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
};

export function errorText(error: unknown) {
  const value = error as { message?: string; requestId?: string } | null;
  const message = value?.message || "تعذر تحميل بيانات الإنتاج";
  return value?.requestId ? `${message} (رقم الطلب ${value.requestId})` : message;
}

export function readableDay(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function shortDay(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { day: "numeric", month: "short" }).format(date);
}

export function readableMoment(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function StatusBadge({ status, dueDate, today, stacked = false, className = "" }: { status: ProductionStatus; dueDate?: string | null; today: string; stacked?: boolean; className?: string }) {
  const overdue = isOverdue({ status, dueDate }, today);
  return (
    <span className={`inline-flex gap-1 whitespace-nowrap ${stacked ? "flex-col items-start" : "items-center"} ${className}`}>
      <Badge variant="outline" className={STATUS_TONES[status]}>{PRODUCTION_STATUS_LABELS[status]}</Badge>
      {overdue ? <Badge variant="outline" className={STATUS_TONES.overdue}><AlertTriangle className="h-3 w-3" />{OVERDUE_LABEL}</Badge> : null}
    </span>
  );
}

export function KindBadge({ kind }: { kind: ProductionKind }) {
  const Icon = KIND_ICONS[kind];
  return <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary"><Icon className="h-3.5 w-3.5" />{PRODUCTION_KIND_LABELS[kind]}</span>;
}

export function ProgressBar({ percent, complete }: { percent: number; complete: boolean }) {
  return (
    <div className="flex min-w-20 items-center gap-2" aria-label={`نسبة الإنجاز ${percent}%`}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${complete ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>
      <span className="w-9 text-xs font-bold tabular-nums">{percent}%</span>
    </div>
  );
}

export function useProductionStaff(enabled: boolean) {
  return useQuery<{ staff: ProductionStaff[] }>({
    queryKey: [...PRODUCTION_QUERY_KEY, "staff"],
    queryFn: () => adminFetch(`${PRODUCTION_API}/staff`),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useBookingProduction(bookingId: number | null, enabled = true) {
  return useQuery<BookingProduction>({
    queryKey: [...PRODUCTION_QUERY_KEY, "booking", bookingId],
    queryFn: () => adminFetch(`${PRODUCTION_API}/booking/${bookingId}`),
    enabled: Boolean(bookingId) && enabled,
    retry: false,
  });
}

type ItemPatch = {
  status?: ProductionStatus;
  expectedStatus?: ProductionStatus;
  assigneeStaffId?: number | null;
  dueDate?: string | null;
  notes?: string | null;
  reason?: string;
};

export function useUpdateProductionItem(onDone?: () => void) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ItemPatch }) =>
      adminFetch<{ changed: boolean; item: ProductionItem | null; progress: ProductionProgress }>(`${PRODUCTION_API}/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: PRODUCTION_QUERY_KEY });
      toast({
        title: result.changed ? "تم تحديث عمل الإنتاج" : "لا يوجد تغيير",
        description: result.progress?.complete ? "الإنتاج مكتمل لهذا الحجز" : undefined,
      });
      onDone?.();
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: PRODUCTION_QUERY_KEY });
      toast({ title: "تعذر تحديث عمل الإنتاج", description: errorText(error), variant: "destructive" });
    },
  });
}

// ------------------------------------------------------------------ order dialog

type OrderDraft = Record<ProductionKind, { selected: boolean; assignee: string; dueDate: string }>;

function emptyDraft(suggested: ProductionKind[]): OrderDraft {
  return Object.fromEntries(
    PRODUCTION_KINDS.map((kind) => [kind, { selected: suggested.includes(kind), assignee: "", dueDate: "" }]),
  ) as OrderDraft;
}

/** «أمر إنتاج»: one work item per selected deliverable; existing items are shown, never re-created. */
export function ProductionOrderDialog({ bookingId, open, onOpenChange }: { bookingId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const detail = useBookingProduction(bookingId, open);
  const staff = useProductionStaff(open && Boolean(detail.data?.permissions.canOrder));
  const existing = useMemo(() => new Map((detail.data?.items ?? []).map((item) => [item.kind, item])), [detail.data?.items]);
  const [draft, setDraft] = useState<OrderDraft>(() => emptyDraft([]));
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || !detail.data) return;
    setDraft(emptyDraft(detail.data.suggestedKinds.filter((kind) => !existing.has(kind))));
    setNotes("");
  }, [open, detail.data, existing]);

  const chosen = PRODUCTION_KINDS.filter((kind) => draft[kind].selected && !existing.has(kind));
  const submit = useMutation({
    mutationFn: () =>
      adminFetch<{ created: ProductionKind[]; existing: ProductionKind[] }>(`${PRODUCTION_API}/booking/${bookingId}/order`, {
        method: "POST",
        body: JSON.stringify({
          kinds: chosen,
          items: Object.fromEntries(
            chosen.map((kind) => [
              kind,
              { assigneeStaffId: draft[kind].assignee ? Number(draft[kind].assignee) : null, dueDate: draft[kind].dueDate || null },
            ]),
          ),
          notes: notes.trim() || undefined,
        }),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: PRODUCTION_QUERY_KEY });
      toast({
        title: result.created.length ? `تم إرسال ${result.created.length} عمل للإنتاج` : "الأعمال موجودة مسبقاً",
        description: result.existing.length
          ? `موجود مسبقاً ولم يُكرّر: ${result.existing.map((kind) => PRODUCTION_KIND_LABELS[kind]).join("، ")}`
          : undefined,
      });
      onOpenChange(false);
    },
    onError: (error) => toast({ title: "تعذر إرسال الحجز للإنتاج", description: errorText(error), variant: "destructive" }),
  });

  const booking = detail.data?.booking;
  const employees = (staff.data?.staff ?? []).map((employee) => ({ ...employee, fullName: employee.name }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>أمر إنتاج</DialogTitle>
          <DialogDescription>اختر الأعمال المطلوبة. كل عمل يُتابع بحالة وموظف وموعد تسليم مستقل، ولا يؤثر على الفاتورة أو الدفعات أو حالة الحجز.</DialogDescription>
        </DialogHeader>
        {detail.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
        ) : detail.isError ? (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{errorText(detail.error)}</div>
        ) : booking ? (
          <div className="space-y-4">
            <div className="grid gap-2 rounded-xl border bg-muted/30 p-3 text-sm sm:grid-cols-2">
              <div><span className="text-muted-foreground">رقم الحجز: </span><b className="font-mono" dir="ltr">{booking.number}</b></div>
              <div><span className="text-muted-foreground">الزبون: </span><b>{booking.customerName || "—"}</b></div>
              <div><span className="text-muted-foreground">الهاتف: </span><b dir="ltr">{booking.phone || "—"}</b></div>
              <div><span className="text-muted-foreground">المناسبة: </span><b>{booking.eventType || "تصوير"} · {readableDay(booking.eventDate)}</b></div>
              {booking.hall ? <div className="sm:col-span-2"><span className="text-muted-foreground">المكان: </span><b>{booking.hall}</b></div> : null}
            </div>
            {!detail.data!.eligible.isPhotography ? (
              <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">لم يتعرّف النظام على هذا الحجز كحجز تصوير، لذلك لا يمكن إرساله للإنتاج.</div>
            ) : null}
            <div className="space-y-2">
              {PRODUCTION_KINDS.map((kind) => {
                const item = existing.get(kind);
                const Icon = KIND_ICONS[kind];
                const row = draft[kind];
                return (
                  <div key={kind} className={`rounded-xl border p-3 ${row.selected && !item ? "border-primary/50 bg-primary/5" : ""}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex cursor-pointer items-center gap-3 text-sm font-bold">
                        <Checkbox
                          checked={Boolean(item) || row.selected}
                          disabled={Boolean(item) || !detail.data!.eligible.isPhotography}
                          onCheckedChange={(checked) => setDraft((current) => ({ ...current, [kind]: { ...current[kind], selected: checked === true } }))}
                          aria-label={PRODUCTION_KIND_LABELS[kind]}
                        />
                        <Icon className="h-4 w-4 text-primary" />
                        {PRODUCTION_KIND_LABELS[kind]}
                      </label>
                      {item ? (
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">موجود مسبقاً <StatusBadge status={item.status} dueDate={item.dueDate} today={detail.data!.today} /></span>
                      ) : null}
                    </div>
                    {row.selected && !item ? (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">الموظف المسؤول (اختياري)</Label>
                          <EmployeeSelect employees={employees} value={row.assignee} onValueChange={(value) => setDraft((current) => ({ ...current, [kind]: { ...current[kind], assignee: value } }))} emptyLabel="بدون تعيين الآن" placeholder={staff.isLoading ? "جارٍ تحميل الموظفين..." : "اختر الموظف"} />
                          {staff.isError ? <p className="text-xs text-destructive">{errorText(staff.error)}</p> : null}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs" htmlFor={`due-${kind}`}>موعد التسليم (اختياري)</Label>
                          <Input id={`due-${kind}`} type="date" value={row.dueDate} onChange={(event) => setDraft((current) => ({ ...current, [kind]: { ...current[kind], dueDate: event.target.value } }))} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="space-y-1">
              <Label htmlFor="production-notes" className="text-xs">ملاحظات للإنتاج (اختياري)</Label>
              <Textarea id="production-notes" value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} placeholder="مثال: الأولوية لفيديو الريلز" />
            </div>
          </div>
        ) : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={() => submit.mutate()} disabled={!chosen.length || submit.isPending || !detail.data?.eligible.isPhotography}>
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            إرسال للإنتاج{chosen.length ? ` (${chosen.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ item dialog

export function ProductionItemDialog({
  item,
  today,
  permissions,
  meId,
  open,
  onOpenChange,
  showBookingLink = true,
}: {
  item: ProductionItem | null;
  today: string;
  permissions: ProductionPermissions;
  meId?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showBookingLink?: boolean;
}) {
  const detail = useBookingProduction(item?.bookingId ?? null, open);
  const staff = useProductionStaff(open && permissions.canManage);
  const update = useUpdateProductionItem();
  const [reason, setReason] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const live = detail.data?.items.find((entry) => entry.id === item?.id) ?? item;

  useEffect(() => {
    if (!open || !live) return;
    setAssignee(live.assigneeStaffId ? String(live.assigneeStaffId) : "");
    setDueDate(live.dueDate ?? "");
    setNotes(live.notes ?? "");
    setReason("");
  }, [open, live?.id, live?.assigneeStaffId, live?.dueDate, live?.notes]);

  if (!item || !live) return null;
  const booking = detail.data?.booking ?? item.booking;
  const viewer = meId ?? detail.data?.meId ?? null;
  const isAssignee = Boolean(viewer) && live.assigneeStaffId === viewer;
  const canChangeStatus = permissions.canManage || isAssignee;
  const moves = allowedTransitions(live.status).filter((to) => live.status !== "completed" || permissions.canManage);
  const history = (detail.data?.history ?? []).filter((entry) => Number(entry.metadata?.itemId) === live.id);
  const employees = (staff.data?.staff ?? []).map((employee) => ({ ...employee, fullName: employee.name }));
  const assignmentDirty = (assignee || "") !== (live.assigneeStaffId ? String(live.assigneeStaffId) : "") || (dueDate || "") !== (live.dueDate ?? "");
  const notesDirty = (notes.trim() || null) !== (live.notes ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2"><KindBadge kind={live.kind} /> <span>{booking?.customerName || "عمل إنتاج"}</span></DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span className="font-mono" dir="ltr">{booking?.number}</span>
            <span>·</span>
            <span>{booking?.eventType || "تصوير"} · {readableDay(booking?.eventDate)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid gap-2 rounded-xl border bg-muted/30 p-3 sm:grid-cols-2">
            <div className="flex items-center gap-2"><span className="text-muted-foreground">الحالة:</span><StatusBadge status={live.status} dueDate={live.dueDate} today={today} /></div>
            <div><span className="text-muted-foreground">الموظف: </span><b>{live.assigneeName || "غير مسند"}</b></div>
            <div><span className="text-muted-foreground">التسليم: </span><b>{readableDay(live.dueDate)}</b></div>
            <div><span className="text-muted-foreground">آخر تغيير: </span><b>{live.statusChangedByName || "—"}</b> <span className="text-xs text-muted-foreground">{readableMoment(live.statusChangedAt)}</span></div>
          </div>

          {canChangeStatus && moves.length ? (
            <section className="space-y-2">
              <h3 className="font-bold">تغيير الحالة</h3>
              {live.status === "completed" ? (
                <div className="space-y-1">
                  <Label htmlFor="reopen-reason" className="text-xs">سبب إعادة فتح العمل المكتمل (إلزامي)</Label>
                  <Input id="reopen-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="مثال: الزبون طلب تعديل المونتاج" />
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {moves.map((to) => (
                  <Button
                    key={to}
                    size="sm"
                    variant={to === "completed" ? "default" : "outline"}
                    disabled={update.isPending || (live.status === "completed" && !reason.trim())}
                    onClick={() => update.mutate({ id: live.id, patch: { status: to, expectedStatus: live.status, reason: reason.trim() || undefined } })}
                  >
                    {to === "completed" ? <CheckCircle2 className="h-4 w-4" /> : live.status === "completed" ? <RotateCcw className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                    {live.status === "completed" ? "إعادة فتح" : PRODUCTION_STATUS_LABELS[to]}
                  </Button>
                ))}
              </div>
            </section>
          ) : !canChangeStatus ? (
            <p className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">تغيير الحالة متاح للموظف المسند إليه العمل أو لمدير التصوير.</p>
          ) : null}

          {permissions.canManage ? (
            <section className="space-y-2">
              <h3 className="font-bold">التعيين وموعد التسليم</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <EmployeeSelect employees={employees} value={assignee} onValueChange={setAssignee} emptyLabel="بدون موظف" placeholder={staff.isLoading ? "جارٍ تحميل الموظفين..." : "اختر الموظف"} />
                <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="موعد التسليم" />
              </div>
              {staff.isError ? <p className="text-xs text-destructive">{errorText(staff.error)}</p> : null}
              <Button size="sm" variant="outline" disabled={!assignmentDirty || update.isPending} onClick={() => update.mutate({ id: live.id, patch: { assigneeStaffId: assignee ? Number(assignee) : null, dueDate: dueDate || null } })}>حفظ التعيين والموعد</Button>
            </section>
          ) : null}

          {canChangeStatus ? (
            <section className="space-y-2">
              <h3 className="font-bold">ملاحظات</h3>
              <Textarea value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظات العمل" />
              <Button size="sm" variant="outline" disabled={!notesDirty || update.isPending} onClick={() => update.mutate({ id: live.id, patch: { notes: notes.trim() || null } })}>حفظ الملاحظات</Button>
            </section>
          ) : live.notes ? <p className="rounded-lg bg-muted/40 p-2">{live.notes}</p> : null}

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 font-bold"><History className="h-4 w-4" /> سجل العمل</h3>
            {detail.isLoading ? <Skeleton className="h-16 rounded-lg" /> : detail.isError ? (
              <p role="alert" className="text-xs text-destructive">{errorText(detail.error)}</p>
            ) : history.length ? (
              <ol className="space-y-2 border-s ps-3">
                {history.map((entry) => (
                  <li key={entry.id} className="text-xs">
                    <div className="font-bold">{entry.title}</div>
                    {entry.body ? <div className="text-muted-foreground">{entry.body}</div> : null}
                    <div className="text-muted-foreground">{entry.actorName} · {readableMoment(entry.createdAt)}</div>
                  </li>
                ))}
              </ol>
            ) : <p className="text-xs text-muted-foreground">لا يوجد سجل لهذا العمل.</p>}
          </section>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {showBookingLink && permissions.canViewAll ? (
            <Button variant="ghost" asChild><Link href={`/admin/bookings/service/${live.bookingId}`}><ExternalLink className="h-4 w-4" /> تفاصيل الحجز</Link></Button>
          ) : <span />}
          <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ booking panel

/** «الإنتاج» section inside the booking details workspace. */
export function PhotographyProductionPanel({ bookingId }: { bookingId: number }) {
  const detail = useBookingProduction(bookingId);
  const [ordering, setOrdering] = useState(false);
  const [selected, setSelected] = useState<ProductionItem | null>(null);
  const data = detail.data;
  return (
    <section className="rounded-2xl border bg-card p-4" dir="rtl" aria-labelledby="booking-production-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Clapperboard className="h-5 w-5" /></span>
          <div>
            <h2 id="booking-production-title" className="font-bold">الإنتاج</h2>
            <p className="text-xs text-muted-foreground">متابعة الفيديو والصور والألبوم والطباعة — منفصلة عن الحالة المالية والتشغيلية للحجز</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {data?.permissions.canOrder ? <Button size="sm" onClick={() => setOrdering(true)}><Send className="h-4 w-4" /> أمر إنتاج</Button> : null}
          <Button size="sm" variant="outline" asChild><Link href={`/admin/photography-production?booking=${bookingId}`}><ExternalLink className="h-4 w-4" /> فتح مركز الإنتاج</Link></Button>
        </div>
      </div>
      <div className="mt-4">
        {detail.isLoading ? <Skeleton className="h-20 rounded-xl" /> : detail.isError ? (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errorText(detail.error)}</div>
        ) : data && data.items.length ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline" className={data.progress.complete ? STATUS_TONES.completed : STATUS_TONES.in_progress}>{data.progress.label}</Badge>
              <span className="text-xs text-muted-foreground">{data.progress.completed} من {data.progress.required} مكتمل</span>
              <div className="min-w-40 flex-1"><ProgressBar percent={data.progress.percent} complete={data.progress.complete} /></div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.items.map((item) => (
                <Button key={item.id} type="button" variant="ghost" size="flush" onClick={() => setSelected(item)} className="h-auto whitespace-normal font-normal leading-normal max-md:min-h-0 flex w-full items-center justify-between gap-2 rounded-xl border border-border p-3 text-start transition hover:bg-muted/40">
                  <span className="space-y-1">
                    <KindBadge kind={item.kind} />
                    <span className="block text-xs text-muted-foreground">{item.assigneeName || "غير مسند"} · {readableDay(item.dueDate)}</span>
                  </span>
                  <StatusBadge status={item.status} dueDate={item.dueDate} today={data.today} />
                </Button>
              ))}
            </div>
          </div>
        ) : data ? (
          <p className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
            {data.eligible.isPhotography ? "لم يُرسل هذا الحجز للإنتاج بعد." : "هذا الحجز غير مصنّف كحجز تصوير."}
          </p>
        ) : null}
      </div>
      {ordering ? <ProductionOrderDialog bookingId={bookingId} open={ordering} onOpenChange={setOrdering} /> : null}
      {data ? (
        <ProductionItemDialog item={selected} today={data.today} permissions={data.permissions} open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} showBookingLink={false} />
      ) : null}
    </section>
  );
}
