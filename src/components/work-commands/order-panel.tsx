import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  Contact,
  Clock3,
  ExternalLink,
  FileText,
  Hand,
  History,
  ImagePlus,
  Link2,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Pencil,
  MessageSquareText,
  PlayCircle,
  RotateCcw,
  StickyNote,
  UserRound,
  UsersRound,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TaskFileList, TaskFilePicker, TaskPhotoGallery, TaskPhotoPicker, type TaskFile, type TaskPhoto } from "@/components/task-photo-gallery";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/query-client";
import { PRIORITY_LABELS, WORK_ORDER_ACTION_LABELS, WORK_ORDER_STAGE_LABELS, workOrderSteps, type WorkOrderAction } from "@/lib/work-commands";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import { StaffPicker } from "./create-order-dialog";
import {
  Failure,
  PriorityBadge,
  PriorityChip,
  StageChip,
  StatusChip,
  dueText,
  orderDelay,
  orderStage,
  fieldClass,
  formatDateTime,
  fromLocalInput,
  toLocalInput,
  useWorkCatalog,
  useWorkMe,
  useWorkStaff,
  viewerActions,
  workKeys,
  type WorkMe,
  type WorkOrder,
} from "./shared";

type OrderDetails = {
  order: WorkOrder;
  actions: WorkOrderAction[];
  subtasks: WorkOrder[];
  progress: { total: number; completed: number; percent: number; blocking: number };
  parent: WorkOrder | null;
  history: Array<{ type: string; title: string; body: string | null; actor: string | null; at: string | null }>;
  attachments: Array<{ url: string; thumbnailUrl: string | null; fileName: string | null; mediaType: string; category: string; uploadedBy: string | null }>;
  comments: Array<{ body: string; at: string | null; name: string | null }>;
  checklist: Array<{ id: number; title: string; done: boolean }>;
};

/** Actions that need input open a dialog; the rest run with one tap. */
const DIRECT_ACTIONS: WorkOrderAction[] = ["acknowledge", "start", "approve"];
/** The step that moves the order forward (receive → start → deliver → approve). */
const PRIMARY_ACTIONS: WorkOrderAction[] = ["acknowledge", "start", "complete", "approve"];
const ACTION_ICONS: Partial<Record<WorkOrderAction, typeof CheckCircle2>> = {
  acknowledge: Hand,
  start: PlayCircle,
  complete: CheckCircle2,
  approve: CheckCircle2,
  return: RotateCcw,
  help: MessageSquareText,
  request_extension: CalendarClock,
  decide_extension: CalendarClock,
  reassign: UsersRound,
  cancel: XCircle,
};

export function bookingHref(booking: { type: string; id: number }) {
  return `/admin/bookings/${booking.type === "service_order" ? "service" : "kosha"}/${booking.id}`;
}

/** Assignee, management or the issuer: the people who may add notes and files (the server re-checks). */
export function canWorkOnOrder(order: WorkOrder, me: WorkMe | undefined) {
  if (!me) return false;
  return order.assignedStaffIds.includes(me.user.id) || me.access.canApprove || order.createdBy === me.user.id;
}

export function useOrderAction(orderId: number) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: (payload: Record<string, unknown> & { action: WorkOrderAction | "note" | "attach" }) =>
      adminFetch<{ order: WorkOrder; label: string }>(`/admin/work-commands/orders/${orderId}/actions`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["work-commands"] });
      void queryClient.invalidateQueries({ queryKey: ["staff-portal", "dashboard"] });
      toast({ title: `تم: ${result.label}`, description: `${result.order.orderNo} · ${result.order.statusLabel}` });
    },
    onError: (error) => toast({ variant: "destructive", title: "تعذر تنفيذ الإجراء", description: apiErrorMessage(error) }),
  });
}

export function ActionButtons({
  order,
  actions,
  onDialog,
  compact = false,
  limit,
  large = false,
  inline = false,
}: {
  order: WorkOrder;
  actions: WorkOrderAction[];
  onDialog: (action: WorkOrderAction) => void;
  compact?: boolean;
  limit?: number;
  /** Full-height buttons for the main step in the details panel. */
  large?: boolean;
  /** Buttons join the surrounding row instead of wrapping in their own. */
  inline?: boolean;
}) {
  const run = useOrderAction(order.id);
  const shown = typeof limit === "number" ? actions.slice(0, limit) : actions;
  if (!shown.length) return null;
  const primary: WorkOrderAction[] = PRIMARY_ACTIONS;
  return (
    <div className={inline ? "contents" : "flex flex-wrap gap-1.5"}>
      {shown.map((action) => {
        const Icon = ACTION_ICONS[action] ?? CheckCircle2;
        const busy = run.isPending && run.variables?.action === action;
        return (
          <Button
            key={action}
            type="button"
            size={large ? "lg" : "compact"}
            variant={primary.includes(action) ? "default" : action === "cancel" ? "destructive" : "outline"}
            disabled={run.isPending}
            className={compact ? "gap-1.5 px-2.5" : large ? "gap-2 max-sm:flex-1" : "gap-1.5"}
            onClick={() => (DIRECT_ACTIONS.includes(action) ? run.mutate({ action }) : onDialog(action))}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
            {WORK_ORDER_ACTION_LABELS[action]}
          </Button>
        );
      })}
    </div>
  );
}

export function OrderActionDialog({ order, action, onClose }: { order: WorkOrder; action: WorkOrderAction | null; onClose: () => void }) {
  const run = useOrderAction(order.id);
  const me = useWorkMe();
  const staff = useWorkStaff(action === "reassign" && Boolean(me.data?.access.canCreate));
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [link, setLink] = useState("");
  const [photos, setPhotos] = useState<TaskPhoto[]>([]);
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [assignees, setAssignees] = useState<number[]>([]);

  useEffect(() => {
    if (!action) return;
    setReason("");
    setNotes("");
    setDueAt("");
    setLink("");
    setPhotos([]);
    setFiles([]);
    setAssignees(order.assignedStaffIds);
  }, [action, order.assignedStaffIds]);

  if (!action) return null;
  const linkValid = !link.trim() || /^https:\/\/\S+$/i.test(link.trim());
  const evidence = [
    ...photos.map((item) => ({ url: item.url, thumbnailUrl: item.thumbnailUrl ?? null, fileName: item.fileName ?? null, mediaType: item.mediaType || "image", caption: item.caption || null })),
    ...files.map((item) => ({ url: item.url, fileName: item.fileName ?? null, mediaType: item.mediaType || "application/pdf", caption: item.caption || null })),
    ...(link.trim() && linkValid ? [{ url: link.trim(), mediaType: "link", fileName: "رابط التسليم" }] : []),
  ];
  const needsReason = ["return", "cancel", "help", "request_extension"].includes(action);
  const blocked =
    run.isPending ||
    !linkValid ||
    (needsReason && reason.trim().length < 3) ||
    (action === "request_extension" && !dueAt) ||
    (action === "reassign" && !assignees.length) ||
    (action === "complete" && order.evidenceRequired && !evidence.length);
  const submit = (extra: Record<string, unknown> = {}) =>
    run.mutate(
      { action, reason, notes, dueAt: fromLocalInput(dueAt), evidence, assigneeIds: assignees, ...extra },
      { onSuccess: onClose },
    );

  const descriptions: Partial<Record<WorkOrderAction, string>> = {
    complete: order.requiresApproval ? "بعد التأكيد ينتقل الأمر إلى «بانتظار الاعتماد»." : "بعد التأكيد يُسجّل الأمر منجزاً مباشرة.",
    return: "يعود الأمر للموظف بحالة «يحتاج تعديل» مع السبب.",
    cancel: "يبقى الأمر في السجل بحالة «ملغي» ولا يُحذف.",
    help: "تصل رسالتك للإدارة ومُصدر الأمر، وتُسجّل في المحادثة.",
    request_extension: "لا يتغير الموعد حتى توافق الإدارة.",
    decide_extension: "الموافقة تغيّر موعد الإنجاز؛ الرفض يبقي الموعد الحالي.",
    reassign: "يصل إشعار للموظف الجديد، ويُسجّل التغيير في السجل.",
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !run.isPending ? onClose() : undefined)}>
      <DialogContent className="w-[min(calc(100%-2rem),36rem)]">
        <DialogHeader className="text-start">
          <DialogTitle className="text-lg font-extrabold">{WORK_ORDER_ACTION_LABELS[action]}</DialogTitle>
          <DialogDescription className="leading-6">{order.orderNo} · {order.title}. {descriptions[action] ?? ""}</DialogDescription>
        </DialogHeader>

        {action === "complete" ? (
          <div className="space-y-4">
            {order.evidenceRequired ? <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-bold leading-5 text-amber-900 dark:text-amber-200">هذا الأمر يتطلب دليل إنجاز: صورة أو ملف أو رابط.</p> : null}
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="ملاحظات الإنجاز (اختياري)" aria-label="ملاحظات الإنجاز" />
            <TaskPhotoPicker photos={photos} onChange={setPhotos} label="صور الإنجاز" description="صور النتيجة النهائية." />
            <TaskFilePicker files={files} onChange={setFiles} label="ملفات الإنجاز" />
            <div className="space-y-1.5">
              <label htmlFor="evidence-link" className="flex items-center gap-1.5 text-sm font-bold"><Link2 className="h-4 w-4 text-primary" />رابط التسليم (اختياري)</label>
              <Input id="evidence-link" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" dir="ltr" className="min-h-11" />
              {!linkValid ? <p className="text-xs font-bold text-destructive">الرابط يجب أن يبدأ بـ https://</p> : null}
            </div>
          </div>
        ) : null}

        {action === "request_extension" ? (
          <div className="space-y-1.5">
            <label htmlFor="ext-due" className="text-sm font-bold">الموعد الجديد المطلوب</label>
            <Input id="ext-due" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="min-h-11" dir="ltr" />
            <p className="text-xs text-muted-foreground">الموعد الحالي: {formatDateTime(order.dueAt)}</p>
          </div>
        ) : null}

        {action === "decide_extension" && order.pendingExtension ? (
          <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">الموعد الحالي</dt><dd className="font-bold">{formatDateTime(order.dueAt)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">الموعد المطلوب</dt><dd className="font-bold">{formatDateTime(order.pendingExtension.dueAt)}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-muted-foreground">السبب</dt><dd className="leading-6">{order.pendingExtension.reason}</dd></div>
          </dl>
        ) : null}

        {action === "reassign" ? (
          staff.isError ? <Failure title="تعذر تحميل الموظفين" error={staff.error} onRetry={() => void staff.refetch()} /> : staff.isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />تحميل الموظفين...</div> : <StaffPicker staff={staff.data ?? []} selected={assignees} onChange={setAssignees} label="الموظفين" />
        ) : null}

        {action !== "complete" ? (
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            aria-label="السبب"
            placeholder={
              action === "return" ? "ما الذي يحتاج تعديل؟" : action === "cancel" ? "سبب الإلغاء" : action === "help" ? "ما نوع المساعدة المطلوبة؟" : action === "request_extension" ? "لماذا تحتاج وقتاً إضافياً؟" : "ملاحظة (اختياري)"
            }
          />
        ) : null}

        <DialogFooter className="gap-2 sm:justify-start">
          {action === "decide_extension" ? (
            <>
              <Button type="button" className="min-h-11" disabled={run.isPending} onClick={() => submit({ approve: true })}>{run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}الموافقة على التمديد</Button>
              <Button type="button" variant="destructive" className="min-h-11" disabled={run.isPending} onClick={() => submit({ approve: false })}>رفض الطلب</Button>
            </>
          ) : (
            <Button type="button" className="min-h-11 gap-2" variant={action === "cancel" ? "destructive" : "default"} disabled={blocked} onClick={() => submit()}>
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {action === "complete" ? "تأكيد الإنجاز" : WORK_ORDER_ACTION_LABELS[action]}
            </Button>
          )}
          <Button type="button" variant="outline" className="min-h-11" disabled={run.isPending} onClick={onClose}>رجوع</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CARD_ACTIONS: WorkOrderAction[] = ["acknowledge", "start", "complete", "approve", "return", "help"];

/** Compact order card used in the chat stream and lists. */
export function WorkOrderCard({ order, onOpen, actionLimit = 2 }: { order: WorkOrder; onOpen: (order: WorkOrder) => void; actionLimit?: number }) {
  const me = useWorkMe();
  const [dialog, setDialog] = useState<WorkOrderAction | null>(null);
  // Cards carry the everyday steps; reassign, cancel and deadline changes live in the details panel.
  const actions = viewerActions(order, me.data).filter((action) => CARD_ACTIONS.includes(action));
  return (
    <article className={`w-full rounded-xl border bg-card p-3 shadow-[0_1px_2px_hsl(var(--foreground)/0.06)] ${order.overdue ? "border-destructive/40" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold tabular-nums text-muted-foreground" dir="ltr">{order.orderNo}</span>
        <StageChip order={order} />
        {order.overdue ? <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-destructive-foreground">متأخر</span> : order.dueSoon ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300">قريب الموعد</span> : null}
        <span className="ms-auto text-[11px] text-muted-foreground">{order.departmentLabel}</span>
      </div>
      <Button type="button" variant="link" size="flush" onClick={() => onOpen(order)} className="mt-1.5 block h-auto border-transparent max-w-full whitespace-normal text-start text-[15px] font-extrabold leading-6 text-foreground">
        {order.title}
      </Button>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{order.assigneeNames || "—"}</span>
        <span className={`inline-flex items-center gap-1 ${order.overdue || orderDelay(order) ? "font-bold text-destructive" : order.dueSoon ? "font-bold text-amber-700 dark:text-amber-300" : ""}`}><Clock3 className="h-3.5 w-3.5" />{dueText(order)}</span>
        <PriorityChip priority={order.priority} />
      </div>
      <CustomerLine order={order} className="mt-1.5" />
      {order.description ? (
        <div className="mt-2 rounded-lg bg-muted/60 px-2.5 py-2">
          <p className="text-[11px] font-bold text-muted-foreground">تعليمات {order.createdByName || "الإدارة"}</p>
          <p className="line-clamp-3 whitespace-pre-line text-sm leading-6 text-foreground">{order.description}</p>
        </div>
      ) : null}
      {order.status === "needs_rework" && order.returnReason ? <p className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs leading-5 text-destructive">سبب الإرجاع: {order.returnReason}</p> : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <ActionButtons order={order} actions={actions} onDialog={setDialog} compact limit={actionLimit} />
        <Button type="button" size="compact" variant="quiet" onClick={() => onOpen(order)}>التفاصيل</Button>
      </div>
      <OrderActionDialog order={order} action={dialog} onClose={() => setDialog(null)} />
    </article>
  );
}

/** «الزبون: … · حجز #…» from the customer/booking the order was issued for. */
function CustomerLine({ order, className = "" }: { order: WorkOrder; className?: string }) {
  if (!order.customer?.name && !order.booking) return null;
  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 text-xs font-bold text-foreground ${className}`}>
      <Contact className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      الزبون: {order.customer?.name || "غير محدد"}
      {order.booking ? <span className="font-normal text-muted-foreground">· حجز <bdi dir="ltr">#{order.booking.id}</bdi></span> : null}
    </p>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-bold leading-6">{children}</dd>
    </div>
  );
}

/** Change an open order's title, type, department, priority, deadline or details. */
export function EditOrderDialog({ order, open, onClose }: { order: WorkOrder; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const catalog = useWorkCatalog();
  const [form, setForm] = useState({ title: "", description: "", templateKey: "", department: "", priority: "medium", dueAt: "" });
  useEffect(() => {
    if (open)
      setForm({
        title: order.title,
        description: order.description ?? "",
        templateKey: order.templateKey ?? "",
        department: order.department,
        priority: order.priority,
        dueAt: toLocalInput(order.dueAt),
      });
  }, [open, order]);
  const save = useMutation({
    mutationFn: () =>
      adminFetch<{ order: WorkOrder; changed: string[] }>(`/admin/work-commands/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          templateKey: form.templateKey || null,
          department: form.department,
          priority: form.priority,
          dueAt: fromLocalInput(form.dueAt),
        }),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["work-commands"] });
      toast({ title: result.changed.length ? "تم تعديل الأمر" : "لا توجد تغييرات", description: `${result.order.orderNo} · ${result.order.title}` });
      onClose();
    },
    onError: (error) => toast({ variant: "destructive", title: "تعذر تعديل الأمر", description: apiErrorMessage(error) }),
  });
  const types = catalog.orderTypes.filter((item) => item.active || item.key === order.templateKey);
  const departments = catalog.departments.filter((item) => item.active || item.key === order.department);
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !save.isPending ? onClose() : undefined)}>
      <DialogContent className="w-[min(calc(100%-2rem),36rem)]">
        <DialogHeader className="text-start">
          <DialogTitle className="text-lg font-extrabold">تعديل الأمر</DialogTitle>
          <DialogDescription className="leading-6">{order.orderNo}. يُسجّل التعديل في سجل الأمر ويصل إشعار للموظف إذا تغيّر الموعد أو المطلوب.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-sm font-bold">العنوان<Input value={form.title} onChange={(event) => set({ title: event.target.value })} className="min-h-11 font-normal" maxLength={500} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm font-bold">نوع الأمر
              <select value={form.templateKey} onChange={(event) => {
                const type = catalog.orderTypes.find((item) => item.key === event.target.value);
                set({ templateKey: event.target.value, ...(type ? { department: type.department } : {}) });
              }} className={`${fieldClass} font-normal`}>
                <option value="">عام</option>
                {types.map((item) => <option key={item.key} value={item.key}>{item.label}{item.active ? "" : " (متوقف)"}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-sm font-bold">القسم
              <select value={form.department} onChange={(event) => set({ department: event.target.value })} className={`${fieldClass} font-normal`}>
                {departments.map((item) => <option key={item.key} value={item.key}>{item.label}{item.active ? "" : " (متوقف)"}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-sm font-bold">الأولوية
              <select value={form.priority} onChange={(event) => set({ priority: event.target.value })} className={`${fieldClass} font-normal`}>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-sm font-bold">موعد الإنجاز<Input type="datetime-local" value={form.dueAt} onChange={(event) => set({ dueAt: event.target.value })} className="min-h-11 font-normal" dir="ltr" /></label>
          </div>
          <label className="block space-y-1 text-sm font-bold">تعليمات للموظف<Textarea value={form.description} onChange={(event) => set({ description: event.target.value })} rows={3} className="font-normal" /></label>
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="button" className="min-h-11 gap-2" disabled={save.isPending || form.title.trim().length < 2} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}حفظ التعديل</Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={save.isPending} onClick={onClose}>رجوع</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Board row: the next step as one button, the rest in a menu. */
export function QuickActions({ order, onOpen, className = "justify-end" }: { order: WorkOrder; onOpen: (order: WorkOrder) => void; className?: string }) {
  const me = useWorkMe();
  const run = useOrderAction(order.id);
  const [dialog, setDialog] = useState<WorkOrderAction | null>(null);
  const actions = viewerActions(order, me.data);
  const next = actions.find((action) => PRIMARY_ACTIONS.includes(action));
  const rest = actions.filter((action) => action !== next);
  const trigger = (action: WorkOrderAction) => (DIRECT_ACTIONS.includes(action) ? run.mutate({ action }) : setDialog(action));
  const NextIcon = next ? ACTION_ICONS[next] ?? CheckCircle2 : null;
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {next && NextIcon ? (
        <Button type="button" size="compact" variant="outline" className="gap-1.5 px-2" disabled={run.isPending} onClick={() => trigger(next)}>
          {run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <NextIcon className="h-3.5 w-3.5" />}
          {WORK_ORDER_ACTION_LABELS[next]}
        </Button>
      ) : null}
      <DropdownMenu dir="rtl">
        <DropdownMenuTrigger asChild>
          <Button type="button" size="iconSm" variant="quiet" aria-label={`إجراءات الأمر ${order.orderNo}`}><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[12rem]">
          <DropdownMenuItem onSelect={() => onOpen(order)}><FileText />فتح التفاصيل</DropdownMenuItem>
          {rest.length ? <DropdownMenuSeparator /> : null}
          {rest.map((action) => {
            const Icon = ACTION_ICONS[action] ?? CheckCircle2;
            return (
              <DropdownMenuItem key={action} onSelect={() => trigger(action)} className={action === "cancel" ? "text-destructive focus:text-destructive" : undefined}>
                <Icon />{WORK_ORDER_ACTION_LABELS[action]}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <OrderActionDialog order={order} action={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

/** Created → received → in progress → (awaiting approval) → completed. */
export function WorkflowStepper({ order }: { order: WorkOrder }) {
  const stage = orderStage(order);
  if (stage === "cancelled")
    return <p className="rounded-xl bg-muted px-3 py-2.5 text-sm font-bold text-muted-foreground">أُلغي هذا الأمر، ويبقى محفوظاً في السجل.</p>;
  // Older orders may wait for approval without the flag; still show that step.
  const steps = workOrderSteps(order.requiresApproval || stage === "pending_approval");
  const current = steps.indexOf(stage);
  const finished = stage === "completed";
  return (
    <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="مراحل الأمر">
      {steps.map((step, index) => {
        const done = finished || index < current;
        const active = !finished && index === current;
        return (
          <li key={step} className="relative flex flex-col items-center gap-1.5 text-center" aria-current={active ? "step" : undefined}>
            {index > 0 ? <span aria-hidden className={`absolute top-3 -start-1/2 h-0.5 w-full ${index <= current ? "bg-primary" : "bg-border"}`} /> : null}
            <span className={`relative z-[1] grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold tabular-nums ${done ? "bg-primary text-primary-foreground" : active ? "bg-card text-primary ring-2 ring-primary" : "bg-muted text-muted-foreground"}`}>
              {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className={`text-[11px] leading-4 ${active ? "font-extrabold text-foreground" : done ? "font-semibold text-foreground/80" : "text-muted-foreground"}`}>{WORK_ORDER_STAGE_LABELS[step]}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** An internal note on the order (task_comments); the text stays if sending fails. */
function NoteComposer({ order, inputRef }: { order: WorkOrder; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const run = useOrderAction(order.id);
  const [body, setBody] = useState("");
  const ready = body.trim().length >= 2 && !run.isPending;
  const submit = () => {
    if (ready) run.mutate({ action: "note", body: body.trim() }, { onSuccess: () => setBody("") });
  };
  return (
    <div className="space-y-2 rounded-xl border border-border p-2.5 focus-within:border-primary/40">
      <Textarea
        ref={inputRef}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          }
        }}
        rows={2}
        maxLength={2000}
        placeholder="اكتب ملاحظة للفريق…"
        aria-label="ملاحظة داخلية"
        className="min-h-16 resize-y border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] leading-4 text-muted-foreground">تُحفظ في سجل الأمر ويصل إشعار للمسؤول ومُصدر الأمر.</span>
        <Button type="button" size="compact" className="gap-1.5" disabled={!ready} onClick={submit}>
          {run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <StickyNote className="h-3.5 w-3.5" />}إضافة ملاحظة
        </Button>
      </div>
    </div>
  );
}

/** Photos or files on an open order: the assignee's become work photos, management's become references. */
function UploadFilesDialog({ order, open, onClose, asAssignee }: { order: WorkOrder; open: boolean; onClose: () => void; asAssignee: boolean }) {
  const run = useOrderAction(order.id);
  const [photos, setPhotos] = useState<TaskPhoto[]>([]);
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [caption, setCaption] = useState("");
  useEffect(() => {
    if (!open) return;
    setPhotos([]);
    setFiles([]);
    setCaption("");
  }, [open]);
  const items = [
    ...photos.map((item) => ({ url: item.url, thumbnailUrl: item.thumbnailUrl ?? null, fileName: item.fileName ?? null, mediaType: item.mediaType || "image", caption: item.caption || null })),
    ...files.map((item) => ({ url: item.url, fileName: item.fileName ?? null, mediaType: item.mediaType || "application/pdf", caption: item.caption || null })),
  ];
  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !run.isPending ? onClose() : undefined)}>
      <DialogContent className="w-[min(calc(100%-2rem),36rem)]">
        <DialogHeader className="text-start">
          <DialogTitle className="text-lg font-extrabold">رفع صور أو ملفات</DialogTitle>
          <DialogDescription className="leading-6">
            {order.orderNo} · {order.title}. {asAssignee ? "تظهر مع صور العمل في هذا الأمر." : "تظهر للموظف في مرفقات الأمر."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <TaskPhotoPicker photos={photos} onChange={setPhotos} label="الصور" description={asAssignee ? "صور مراحل العمل أو النتيجة." : "صور مرجعية توضح المطلوب."} disabled={run.isPending} />
          <TaskFilePicker files={files} onChange={setFiles} disabled={run.isPending} />
          <Input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} placeholder="وصف قصير (اختياري)" aria-label="وصف المرفقات" className="min-h-11" />
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="button" className="min-h-11 gap-2" disabled={!items.length || run.isPending} onClick={() => run.mutate({ action: "attach", files: items, caption }, { onSuccess: onClose })}>
            {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}رفع
          </Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={run.isPending} onClick={onClose}>رجوع</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OrderDetailsPanel({ orderId, onOpenOrder, onOpenChannel }: { orderId: number; onOpenOrder?: (id: number) => void; onOpenChannel?: (channelId: number) => void }) {
  const details = useQuery({
    queryKey: workKeys.order(orderId),
    queryFn: () => adminFetch<OrderDetails>(`/admin/work-commands/orders/${orderId}`),
    refetchInterval: 20_000,
  });
  const [dialog, setDialog] = useState<WorkOrderAction | null>(null);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const me = useWorkMe();

  if (details.isLoading)
    return (
      <div className="space-y-3 p-4" aria-busy="true">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-6 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-10 animate-pulse rounded-xl bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  if (details.isError) return <div className="p-4"><Failure title="تعذر تحميل أمر العمل" error={details.error} onRetry={() => void details.refetch()} /></div>;
  const data = details.data!;
  const { order } = data;
  const isAudio = (item: OrderDetails["attachments"][number]) => item.mediaType.startsWith("audio");
  const voiceNotes = data.attachments.filter((item) => !item.category.startsWith("employee_") && isAudio(item));
  const managerMedia = data.attachments.filter((item) => !item.category.startsWith("employee_") && !isAudio(item));
  const evidence = data.attachments.filter((item) => item.category.startsWith("employee_"));
  const asPhoto = (item: OrderDetails["attachments"][number]) => ({ url: item.url, thumbnailUrl: item.thumbnailUrl, fileName: item.fileName, mediaType: item.mediaType, caption: null });
  const isImage = (item: OrderDetails["attachments"][number]) => item.mediaType === "image" || item.mediaType.startsWith("image/");
  const canWork = canWorkOnOrder(order, me.data);
  const isAssignee = Boolean(me.data && order.assignedStaffIds.includes(me.data.user.id));
  const canEdit = Boolean(me.data && (me.data.access.canApprove || order.createdBy === me.data.user.id) && !["completed", "cancelled"].includes(order.taskStatus));
  const mainActions = data.actions.filter((action) => PRIMARY_ACTIONS.includes(action));
  const otherActions = data.actions.filter((action) => !PRIMARY_ACTIONS.includes(action));
  const delay = orderDelay(order);
  const focusNote = () => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    noteRef.current?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    noteRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="space-y-5 p-4">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold tabular-nums text-muted-foreground" dir="ltr">{order.orderNo}</span>
          <StageChip order={order} />
          <PriorityBadge priority={order.priority} />
          {order.overdue ? <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-destructive-foreground">متأخر</span> : null}
        </div>
        <h2 className="text-lg font-extrabold leading-7 [text-wrap:balance]">{order.title}</h2>
        {data.parent ? (
          <Button type="button" variant="link" size="flush" className="border-transparent text-xs" onClick={() => onOpenOrder?.(data.parent!.id)}>جزء من: {data.parent.title}</Button>
        ) : null}
        <CustomerLine order={order} className="pt-1 text-sm" />
      </header>

      <WorkflowStepper order={order} />

      {order.status === "needs_rework" && order.returnReason ? (
        <div className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-6 text-destructive"><b>يحتاج تعديل:</b> {order.returnReason}</div>
      ) : null}
      {order.pendingExtension ? (
        <div className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm leading-6 text-amber-900 dark:text-amber-200">
          <b>طلب تمديد</b> إلى {formatDateTime(order.pendingExtension.dueAt)}{order.pendingExtension.reason ? ` — ${order.pendingExtension.reason}` : ""}
        </div>
      ) : null}

      {mainActions.length || otherActions.length || canWork || canEdit ? (
        <section className="space-y-2" aria-label="إجراءات الأمر">
          {mainActions.length ? <ActionButtons order={order} actions={mainActions} onDialog={setDialog} large /> : null}
          <div className="flex flex-wrap gap-1.5">
            {canWork ? <Button type="button" variant="outline" size="compact" className="gap-1.5" onClick={focusNote}><StickyNote className="h-3.5 w-3.5" />إضافة ملاحظة</Button> : null}
            {canWork && order.taskStatus !== "cancelled" ? <Button type="button" variant="outline" size="compact" className="gap-1.5" onClick={() => setUploading(true)}><ImagePlus className="h-3.5 w-3.5" />رفع صورة</Button> : null}
            {canEdit ? <Button type="button" variant="outline" size="compact" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" />تعديل الأمر</Button> : null}
            <ActionButtons order={order} actions={otherActions} onDialog={setDialog} inline />
          </div>
        </section>
      ) : null}

      <section className="space-y-1.5 rounded-xl bg-muted/60 px-3 py-2.5" aria-label="تعليمات الأمر">
        <h3 className="flex items-center gap-1.5 text-xs font-extrabold text-muted-foreground"><FileText className="h-3.5 w-3.5" />تعليمات {order.createdByName || "الإدارة"}</h3>
        {order.description ? <p className="whitespace-pre-line text-sm leading-7 text-foreground">{order.description}</p> : null}
        {order.notes ? <p className="whitespace-pre-line text-sm leading-7 text-foreground"><b>ملاحظات: </b>{order.notes}</p> : null}
        {voiceNotes.map((item) => <audio key={item.url} controls preload="none" src={item.url} className="h-10 w-full" aria-label="رسالة صوتية من الإدارة" />)}
        {!order.description && !order.notes && !voiceNotes.length ? (
          <p className="text-sm text-muted-foreground">لم تُكتب تعليمات لهذا الأمر.{canEdit ? " أضفها من «تعديل الأمر»." : ""}</p>
        ) : null}
      </section>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border p-3">
        <Fact label="المسؤول">{order.assigneeNames || "—"}</Fact>
        <Fact label="أصدره">{order.createdByName || "—"}</Fact>
        <Fact label="موعد الإنجاز">
          <span className={order.overdue ? "text-destructive" : undefined}>{formatDateTime(order.dueAt)}</span>
          <span className={`block text-xs font-semibold ${delay ? "text-destructive" : "text-muted-foreground"}`}>{dueText(order)}</span>
        </Fact>
        {order.submittedAt ? <Fact label="تاريخ التسليم">{formatDateTime(order.submittedAt)}</Fact> : null}
        <Fact label="الأولوية">{PRIORITY_LABELS[order.priority] ?? order.priority}</Fact>
        <Fact label="القسم">{order.departmentLabel}</Fact>
        {order.templateLabel ? <Fact label="نوع الأمر">{order.templateLabel}</Fact> : null}
        <Fact label="الاعتماد">{order.requiresApproval ? "يتطلب اعتماد" : "بدون اعتماد"}{order.evidenceRequired ? " · دليل إنجاز" : ""}</Fact>
        {order.booking ? (
          <Fact label="الحجز">
            {me.data?.access.manager ? (
              <Link href={bookingHref(order.booking)} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"><bdi dir="ltr">#{order.booking.id}</bdi><ExternalLink className="h-3 w-3" /></Link>
            ) : (
              <bdi dir="ltr">#{order.booking.id}</bdi>
            )}
          </Fact>
        ) : null}
        {order.customer?.name ? <Fact label="الزبون">{order.customer.name}</Fact> : null}
        {order.product ? <Fact label="المنتج / الأصل"><Link href={`/admin/products/${order.product.id}`} className="text-primary underline-offset-4 hover:underline">{order.product.name ?? `#${order.product.id}`}</Link></Fact> : null}
        <Fact label="تاريخ الإصدار">{formatDateTime(order.createdAt)}</Fact>
      </dl>
      {order.channelId && onOpenChannel ? (
        <Button type="button" variant="outline" size="compact" className="gap-1.5" onClick={() => onOpenChannel(order.channelId!)}><MessageSquareText className="h-3.5 w-3.5" />عرض المحادثة</Button>
      ) : null}

      {data.subtasks.length ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-extrabold"><ListChecks className="h-4 w-4 text-muted-foreground" />المهام الفرعية</h3>
            <span className="text-xs font-bold tabular-nums text-muted-foreground">{data.progress.completed} من {data.progress.total} إلزامية</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={data.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="تقدم المهام الفرعية">
            <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${data.progress.percent}%` }} />
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {data.subtasks.map((item) => (
              <li key={item.id}>
                <Button type="button" variant="ghost" onClick={() => onOpenOrder?.(item.id)} className="flex h-auto min-h-12 w-full items-center justify-between gap-2 rounded-none px-3 py-2 text-start">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{item.title}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{item.assigneeNames || "—"}{item.mandatory ? "" : " · اختيارية"}</span>
                  </span>
                  <StatusChip status={item.status} />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.checklist.length ? (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold"><ListChecks className="h-4 w-4 text-muted-foreground" />قائمة التحقق</h3>
          <ul className="space-y-1">
            {data.checklist.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <CheckCircle2 className={`h-4 w-4 shrink-0 ${item.done ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/40"}`} />
                <span className={item.done ? "text-muted-foreground line-through" : undefined}>{item.title}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {managerMedia.length ? (
        <section className="space-y-2">
          <h3 className="text-sm font-extrabold">مرفقات الأمر</h3>
          {managerMedia.some(isImage) ? <TaskPhotoGallery photos={managerMedia.filter(isImage).map(asPhoto)} /> : null}
          {managerMedia.some((item) => !isImage(item)) ? <TaskFileList files={managerMedia.filter((item) => !isImage(item)).map(asPhoto)} /> : null}
        </section>
      ) : null}

      {evidence.length ? (
        <section className="space-y-2">
          <h3 className="text-sm font-extrabold">صور العمل ودليل الإنجاز</h3>
          {evidence.some(isImage) ? <TaskPhotoGallery photos={evidence.filter(isImage).map(asPhoto)} /> : null}
          {evidence.some((item) => !isImage(item) && item.mediaType !== "link") ? <TaskFileList files={evidence.filter((item) => !isImage(item) && item.mediaType !== "link").map(asPhoto)} /> : null}
          {evidence.filter((item) => item.mediaType === "link").map((item) => (
            <a key={item.url} href={item.url} target="_blank" rel="noreferrer noopener" className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-bold text-primary hover:bg-primary/5" dir="ltr"><Link2 className="h-4 w-4 shrink-0" /><span className="truncate">{item.url}</span></a>
          ))}
        </section>
      ) : null}

      {data.comments.length || canWork ? (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold"><StickyNote className="h-4 w-4 text-muted-foreground" />ملاحظات داخلية</h3>
          {data.comments.length ? (
            <ul className="space-y-2">
              {data.comments.map((item, index) => (
                <li key={`${item.at}-${index}`} className="rounded-lg bg-muted/40 px-3 py-2 text-sm leading-6">
                  <span className="block text-xs font-bold text-muted-foreground">{item.name ?? "—"} · {formatDateTime(item.at)}</span>
                  <span className="whitespace-pre-line">{item.body}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {canWork ? <NoteComposer order={order} inputRef={noteRef} /> : null}
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-extrabold"><History className="h-4 w-4 text-muted-foreground" />سجل الأمر</h3>
        {data.history.length ? (
          <ol className="relative space-y-3 border-s border-border ps-4">
            {data.history.map((event, index) => (
              <li key={`${event.type}-${event.at}-${index}`} className="relative">
                <span className="absolute -start-[21.5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" aria-hidden />
                <p className="text-sm font-bold leading-6">{event.title}</p>
                {event.body ? <p className="whitespace-pre-line text-sm leading-6 text-foreground/80">{event.body}</p> : null}
                <p className="text-[11px] text-muted-foreground">{event.actor ?? "النظام"} · {formatDateTime(event.at)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">لا توجد أحداث مسجلة بعد.</p>
        )}
      </section>

      <OrderActionDialog order={order} action={dialog} onClose={() => setDialog(null)} />
      <EditOrderDialog order={order} open={editing} onClose={() => setEditing(false)} />
      <UploadFilesDialog order={order} open={uploading} onClose={() => setUploading(false)} asAssignee={isAssignee} />
    </div>
  );
}
