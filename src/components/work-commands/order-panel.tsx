import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Hand,
  History,
  Link2,
  ListChecks,
  Loader2,
  MessageSquareText,
  PlayCircle,
  RotateCcw,
  UserRound,
  UsersRound,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TaskFileList, TaskFilePicker, TaskPhotoGallery, TaskPhotoPicker, type TaskFile, type TaskPhoto } from "@/components/task-photo-gallery";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/query-client";
import { PRIORITY_LABELS, WORK_ORDER_ACTION_LABELS, type WorkOrderAction } from "@/lib/work-commands";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import { StaffPicker } from "./create-order-dialog";
import {
  Failure,
  PriorityChip,
  StatusChip,
  dueText,
  formatDateTime,
  fromLocalInput,
  useWorkMe,
  useWorkStaff,
  viewerActions,
  workKeys,
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

export function useOrderAction(orderId: number) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: (payload: Record<string, unknown> & { action: WorkOrderAction }) =>
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
}: {
  order: WorkOrder;
  actions: WorkOrderAction[];
  onDialog: (action: WorkOrderAction) => void;
  compact?: boolean;
  limit?: number;
}) {
  const run = useOrderAction(order.id);
  const shown = typeof limit === "number" ? actions.slice(0, limit) : actions;
  if (!shown.length) return null;
  const primary: WorkOrderAction[] = ["acknowledge", "start", "complete", "approve"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((action) => {
        const Icon = ACTION_ICONS[action] ?? CheckCircle2;
        const busy = run.isPending && run.variables?.action === action;
        return (
          <Button
            key={action}
            type="button"
            size="compact"
            variant={primary.includes(action) ? "default" : action === "cancel" ? "destructive" : "outline"}
            disabled={run.isPending}
            className={compact ? "gap-1.5 px-2.5" : "gap-1.5"}
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
        <StatusChip status={order.status} />
        {order.overdue ? <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-destructive-foreground">متأخر</span> : order.dueSoon ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300">قريب الموعد</span> : null}
        <span className="ms-auto text-[11px] text-muted-foreground">{order.departmentLabel}</span>
      </div>
      <Button type="button" variant="link" size="flush" onClick={() => onOpen(order)} className="mt-1.5 block h-auto border-transparent max-w-full whitespace-normal text-start text-[15px] font-extrabold leading-6 text-foreground">
        {order.title}
      </Button>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{order.assigneeNames || "—"}</span>
        <span className={`inline-flex items-center gap-1 ${order.overdue ? "font-bold text-destructive" : order.dueSoon ? "font-bold text-amber-700 dark:text-amber-300" : ""}`}><Clock3 className="h-3.5 w-3.5" />{dueText(order)}</span>
        <PriorityChip priority={order.priority} />
      </div>
      {order.status === "needs_rework" && order.returnReason ? <p className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs leading-5 text-destructive">سبب الإرجاع: {order.returnReason}</p> : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <ActionButtons order={order} actions={actions} onDialog={setDialog} compact limit={actionLimit} />
        <Button type="button" size="compact" variant="quiet" onClick={() => onOpen(order)}>التفاصيل</Button>
      </div>
      <OrderActionDialog order={order} action={dialog} onClose={() => setDialog(null)} />
    </article>
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

export function OrderDetailsPanel({ orderId, onOpenOrder, onOpenChannel }: { orderId: number; onOpenOrder?: (id: number) => void; onOpenChannel?: (channelId: number) => void }) {
  const details = useQuery({
    queryKey: workKeys.order(orderId),
    queryFn: () => adminFetch<OrderDetails>(`/admin/work-commands/orders/${orderId}`),
    refetchInterval: 20_000,
  });
  const [dialog, setDialog] = useState<WorkOrderAction | null>(null);

  if (details.isLoading)
    return (
      <div className="space-y-3 p-4" aria-busy="true">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-6 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  if (details.isError) return <div className="p-4"><Failure title="تعذر تحميل أمر العمل" error={details.error} onRetry={() => void details.refetch()} /></div>;
  const data = details.data!;
  const { order } = data;
  const managerMedia = data.attachments.filter((item) => !item.category.startsWith("employee_"));
  const evidence = data.attachments.filter((item) => item.category.startsWith("employee_"));
  const asPhoto = (item: OrderDetails["attachments"][number]) => ({ url: item.url, thumbnailUrl: item.thumbnailUrl, fileName: item.fileName, mediaType: item.mediaType, caption: null });
  const isImage = (item: OrderDetails["attachments"][number]) => item.mediaType === "image" || item.mediaType.startsWith("image/");

  return (
    <div className="space-y-5 p-4">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold tabular-nums text-muted-foreground" dir="ltr">{order.orderNo}</span>
          <StatusChip status={order.status} />
          {order.overdue ? <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-destructive-foreground">متأخر</span> : null}
        </div>
        <h2 className="text-lg font-extrabold leading-7 [text-wrap:balance]">{order.title}</h2>
        {data.parent ? (
          <Button type="button" variant="link" size="flush" className="border-transparent text-xs" onClick={() => onOpenOrder?.(data.parent!.id)}>جزء من: {data.parent.title}</Button>
        ) : null}
      </header>

      {order.status === "needs_rework" && order.returnReason ? (
        <div className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-6 text-destructive"><b>يحتاج تعديل:</b> {order.returnReason}</div>
      ) : null}
      {order.pendingExtension ? (
        <div className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm leading-6 text-amber-900 dark:text-amber-200">
          <b>طلب تمديد</b> إلى {formatDateTime(order.pendingExtension.dueAt)}{order.pendingExtension.reason ? ` — ${order.pendingExtension.reason}` : ""}
        </div>
      ) : null}

      <ActionButtons order={order} actions={data.actions} onDialog={setDialog} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border p-3">
        <Fact label="المسؤول">{order.assigneeNames || "—"}</Fact>
        <Fact label="أصدره">{order.createdByName || "—"}</Fact>
        <Fact label="موعد الإنجاز"><span className={order.overdue ? "text-destructive" : undefined}>{formatDateTime(order.dueAt)}</span><span className="block text-xs font-semibold text-muted-foreground">{dueText(order)}</span></Fact>
        <Fact label="الأولوية">{PRIORITY_LABELS[order.priority] ?? order.priority}</Fact>
        <Fact label="القسم">{order.departmentLabel}</Fact>
        <Fact label="الاعتماد">{order.requiresApproval ? "يتطلب اعتماد" : "بدون اعتماد"}{order.evidenceRequired ? " · دليل إنجاز" : ""}</Fact>
        {order.booking ? <Fact label="الحجز"><Link href={bookingHref(order.booking)} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">#{order.booking.id}<ExternalLink className="h-3 w-3" /></Link></Fact> : null}
        {order.customer?.name ? <Fact label="الزبون">{order.customer.name}</Fact> : null}
        {order.product ? <Fact label="المنتج / الأصل"><Link href={`/admin/products/${order.product.id}`} className="text-primary underline-offset-4 hover:underline">{order.product.name ?? `#${order.product.id}`}</Link></Fact> : null}
        <Fact label="تاريخ الإصدار">{formatDateTime(order.createdAt)}</Fact>
      </dl>
      {order.channelId && onOpenChannel ? (
        <Button type="button" variant="outline" size="compact" className="gap-1.5" onClick={() => onOpenChannel(order.channelId!)}><MessageSquareText className="h-3.5 w-3.5" />عرض المحادثة</Button>
      ) : null}

      {order.description ? (
        <section className="space-y-1.5">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold"><FileText className="h-4 w-4 text-muted-foreground" />التفاصيل</h3>
          <p className="whitespace-pre-line text-sm leading-7 text-foreground/90">{order.description}</p>
        </section>
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
          <h3 className="text-sm font-extrabold">دليل الإنجاز</h3>
          {evidence.some(isImage) ? <TaskPhotoGallery photos={evidence.filter(isImage).map(asPhoto)} /> : null}
          {evidence.some((item) => !isImage(item) && item.mediaType !== "link") ? <TaskFileList files={evidence.filter((item) => !isImage(item) && item.mediaType !== "link").map(asPhoto)} /> : null}
          {evidence.filter((item) => item.mediaType === "link").map((item) => (
            <a key={item.url} href={item.url} target="_blank" rel="noreferrer noopener" className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-bold text-primary hover:bg-primary/5" dir="ltr"><Link2 className="h-4 w-4 shrink-0" /><span className="truncate">{item.url}</span></a>
          ))}
        </section>
      ) : null}

      {data.comments.length ? (
        <section className="space-y-2">
          <h3 className="text-sm font-extrabold">ملاحظات</h3>
          <ul className="space-y-2">
            {data.comments.map((item, index) => (
              <li key={`${item.at}-${index}`} className="rounded-lg bg-muted/40 px-3 py-2 text-sm leading-6">
                <span className="block text-xs font-bold text-muted-foreground">{item.name ?? "—"} · {formatDateTime(item.at)}</span>
                {item.body}
              </li>
            ))}
          </ul>
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
                {event.body ? <p className="text-sm leading-6 text-foreground/80">{event.body}</p> : null}
                <p className="text-[11px] text-muted-foreground">{event.actor ?? "النظام"} · {formatDateTime(event.at)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">لا توجد أحداث مسجلة بعد.</p>
        )}
      </section>

      <OrderActionDialog order={order} action={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

