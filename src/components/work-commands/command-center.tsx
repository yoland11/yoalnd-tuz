import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowRight,
  Building2,
  Camera,
  CheckCheck,
  ClipboardList,
  ClipboardPlus,
  Clapperboard,
  FileText,
  GraduationCap,
  Hash,
  Inbox,
  LayoutDashboard,
  Loader2,
  MessagesSquare,
  Mic,
  Paperclip,
  Plus,
  Printer,
  Reply,
  RotateCw,
  Search,
  Send,
  Settings2,
  Pencil,
  Archive,
  Sparkles,
  Square,
  Trash2,
  Truck,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { isSupportedTaskFile, uploadImageWithVariants, uploadTaskFile } from "@/lib/large-image-upload";
import { queryClient } from "@/lib/query-client";
import { PRIORITY_LABELS, type WorkOrderStatus } from "@/lib/work-commands";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import { CreateWorkOrderDialog, StaffPicker, type WorkOrderDefaults } from "./create-order-dialog";
import { WorkSettingsPanel } from "./settings-panel";
import { OrderDetailsPanel, WorkOrderCard, bookingHref } from "./order-panel";
import {
  Empty,
  Failure,
  StatusChip,
  dueText,
  fieldClass,
  formatDateTime,
  formatDay,
  formatTime,
  newClientKey,
  useWorkCatalog,
  useWorkMe,
  useWorkStaff,
  workKeys,
  type Attachment,
  type Channel,
  type Message,
  type WorkMe,
  type WorkOrder,
} from "./shared";

type Tab = "chat" | "board" | "mine" | "search" | "settings";
type Thread = { messages: Message[]; orders: WorkOrder[]; hasOlder: boolean };

const DEPARTMENT_ICONS: Record<string, typeof Building2> = {
  general: Building2,
  editing: Clapperboard,
  photography: Camera,
  printing: Printer,
  graduation: GraduationCap,
  koshas: Sparkles,
  warehouse: Warehouse,
  delivery: Truck,
};

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function readParam(name: string) {
  if (typeof window === "undefined") return null;
  const value = Number(new URLSearchParams(window.location.search).get(name));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function writeParams(values: Record<string, string | number | null>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function ChannelIcon({ channel, size = "md" }: { channel: Pick<Channel, "department" | "isDepartment">; size?: "md" | "sm" }) {
  const Icon = channel.isDepartment ? DEPARTMENT_ICONS[channel.department] ?? Building2 : Hash;
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ${size === "sm" ? "h-9 w-9" : "h-11 w-11"}`}>
      <Icon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
    </span>
  );
}

function lastMessagePreview(channel: Channel) {
  const last = channel.lastMessage;
  if (!last) return "لا توجد رسائل بعد";
  const text = last.type === "voice" ? "رسالة صوتية" : last.type === "attachment" ? "مرفق" : last.type === "work_order" ? `أمر عمل: ${last.body ?? ""}` : last.body ?? "";
  return last.type === "system" ? text : `${last.sender}: ${text}`;
}

// ─── Channel list ───────────────────────────────────────────────────────────

function ChannelList({
  channels,
  activeId,
  onSelect,
  me,
}: {
  channels: ReturnType<typeof useChannels>;
  activeId: number | null;
  onSelect: (id: number) => void;
  me: WorkMe;
}) {
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const rows = (channels.data ?? []).filter((channel) => !filter.trim() || channel.title.includes(filter.trim()));
  const departments = rows.filter((channel) => channel.isDepartment);
  const others = rows.filter((channel) => !channel.isDepartment);
  const renderRow = (channel: Channel) => {
    const active = channel.id === activeId;
    return (
      <li key={channel.id}>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onSelect(channel.id)}
          aria-current={active ? "true" : undefined}
          className={`flex h-auto min-h-16 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start ${active ? "bg-primary/10 hover:bg-primary/12" : ""}`}
        >
          <ChannelIcon channel={channel} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-extrabold text-foreground">{channel.title}</span>
              <span className="ms-auto shrink-0 text-[11px] font-normal text-muted-foreground">{channel.lastMessage ? formatTime(channel.lastMessage.at) : ""}</span>
            </span>
            <span className="mt-0.5 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground">{lastMessagePreview(channel)}</span>
              {channel.unread ? <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold tabular-nums text-primary-foreground" aria-label={`${channel.unread} غير مقروءة`}>{channel.unread > 99 ? "99+" : channel.unread}</span> : null}
            </span>
            {channel.pendingOrders ? <span className="mt-1 inline-flex text-[11px] font-bold text-amber-700 dark:text-amber-300">أوامر مفتوحة: {channel.pendingOrders}</span> : null}
          </span>
        </Button>
      </li>
    );
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-extrabold">المحادثات</h2>
          {me.access.canCreateChannel ? <Button type="button" size="compact" variant="outline" className="gap-1" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" />قناة</Button> : null}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="بحث في القنوات" aria-label="بحث في القنوات" className="min-h-10 pr-9" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {channels.isLoading ? (
          <div className="space-y-2 p-1" aria-busy="true">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : channels.isError ? (
          <Failure title="تعذر تحميل المحادثات" error={channels.error} onRetry={() => void channels.refetch()} />
        ) : (
          <>
            {departments.length ? <p className="px-2.5 pb-1 pt-1 text-[11px] font-bold text-muted-foreground">الأقسام</p> : null}
            <ul className="space-y-0.5">{departments.map(renderRow)}</ul>
            {others.length ? <p className="px-2.5 pb-1 pt-3 text-[11px] font-bold text-muted-foreground">قنوات أخرى</p> : null}
            <ul className="space-y-0.5">{others.map(renderRow)}</ul>
            {!rows.length ? <div className="p-2"><Empty>{filter ? "لا توجد قناة بهذا الاسم." : "لا توجد محادثات متاحة لك بعد."}</Empty></div> : null}
          </>
        )}
      </div>
      <CreateChannelDialog open={creating} onOpenChange={setCreating} onCreated={onSelect} />
    </div>
  );
}

function CreateChannelDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const staff = useWorkStaff(open);
  const departments = useWorkCatalog().departments.filter((item) => item.active);
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("general");
  const [members, setMembers] = useState<number[]>([]);
  useEffect(() => {
    if (open) {
      setTitle("");
      setDepartment("general");
      setMembers([]);
    }
  }, [open]);
  const create = useMutation({
    mutationFn: () => adminFetch<{ id: number }>("/admin/work-commands/channels", { method: "POST", body: JSON.stringify({ title, department, participantStaffIds: members }) }),
    onSuccess: (channel) => {
      void queryClient.invalidateQueries({ queryKey: workKeys.channels });
      toast({ title: "تم إنشاء القناة" });
      onCreated(channel.id);
      onOpenChange(false);
    },
    onError: (error) => toast({ variant: "destructive", title: "تعذر إنشاء القناة", description: apiErrorMessage(error) }),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => (create.isPending ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader className="text-start">
          <DialogTitle className="text-lg font-extrabold">قناة جديدة</DialogTitle>
          <DialogDescription>قناة لفريق أو مشروع. يراها أعضاؤها وموظفو القسم المختار والإدارة.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="اسم القناة" aria-label="اسم القناة" className="min-h-11" maxLength={180} />
          <select value={department} onChange={(event) => setDepartment(event.target.value)} className={fieldClass} aria-label="القسم">
            {departments.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          {staff.isError ? <Failure title="تعذر تحميل الموظفين" error={staff.error} /> : <StaffPicker staff={staff.data ?? []} selected={members} onChange={setMembers} label="الأعضاء" />}
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="button" className="min-h-11" disabled={title.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}إنشاء</Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditChannelDialog({ channel, open, onOpenChange }: { channel: Channel; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const staff = useWorkStaff(open);
  const departments = useWorkCatalog().departments.filter((item) => item.active || item.key === channel.department);
  const [title, setTitle] = useState(channel.title);
  const [department, setDepartment] = useState(channel.department);
  const [members, setMembers] = useState<number[]>(channel.participantStaffIds);
  const [confirmArchive, setConfirmArchive] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(channel.title);
    setDepartment(channel.department);
    setMembers(channel.participantStaffIds);
    setConfirmArchive(false);
  }, [open, channel]);
  const done = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: ["work-commands"] });
    toast({ title: message });
    onOpenChange(false);
  };
  const save = useMutation({
    mutationFn: () =>
      adminFetch(`/admin/work-commands/channels/${channel.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, participantStaffIds: members, ...(channel.isDepartment ? {} : { department }) }),
      }),
    onSuccess: () => done("تم حفظ المحادثة"),
    onError: (error) => toast({ variant: "destructive", title: "تعذر حفظ المحادثة", description: apiErrorMessage(error) }),
  });
  const archive = useMutation({
    mutationFn: () => adminFetch(`/admin/work-commands/channels/${channel.id}/archive`, { method: "POST" }),
    onSuccess: () => done("تمت أرشفة القناة"),
    onError: (error) => toast({ variant: "destructive", title: "تعذر أرشفة القناة", description: apiErrorMessage(error) }),
  });
  const busy = save.isPending || archive.isPending;
  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader className="text-start">
          <DialogTitle className="text-lg font-extrabold">{channel.isDepartment ? "تعديل قناة القسم" : "تعديل القناة"}</DialogTitle>
          <DialogDescription className="leading-6">
            {channel.isDepartment
              ? "اسم القناة هو اسم القسم في كل النظام. موظفو القسم يرونها تلقائياً؛ أضف هنا أعضاء من أقسام أخرى."
              : "يرى القناة أعضاؤها وموظفو القسم المختار والإدارة."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block space-y-1 text-sm font-bold">{channel.isDepartment ? "اسم القسم" : "اسم القناة"}
            <Input value={title} onChange={(event) => setTitle(event.target.value)} className="min-h-11 font-normal" maxLength={channel.isDepartment ? 60 : 180} />
          </label>
          {channel.isDepartment ? null : (
            <label className="block space-y-1 text-sm font-bold">القسم
              <select value={department} onChange={(event) => setDepartment(event.target.value)} className={`${fieldClass} font-normal`}>
                {departments.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </label>
          )}
          <div className="space-y-1.5">
            <p className="text-sm font-bold">{channel.isDepartment ? "أعضاء إضافيون" : "الأعضاء"}</p>
            {staff.isError ? <Failure title="تعذر تحميل الموظفين" error={staff.error} onRetry={() => void staff.refetch()} /> : <StaffPicker staff={staff.data ?? []} selected={members} onChange={setMembers} label="الأعضاء" />}
          </div>
          {channel.isDepartment ? (
            <p className="text-xs leading-5 text-muted-foreground">لإيقاف القسم أو ربط أقسام الموظفين به: تبويب «الإعدادات».</p>
          ) : confirmArchive ? (
            <div className="space-y-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-bold">تختفي القناة من القائمة وتبقى رسائلها محفوظة. لا تُؤرشف قناة فيها أوامر مفتوحة.</p>
              <div className="flex gap-2">
                <Button type="button" variant="destructive" size="compact" disabled={busy} onClick={() => archive.mutate()}>{archive.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}تأكيد الأرشفة</Button>
                <Button type="button" variant="outline" size="compact" disabled={busy} onClick={() => setConfirmArchive(false)}>تراجع</Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="quiet" size="compact" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setConfirmArchive(true)}><Archive className="h-3.5 w-3.5" />أرشفة القناة</Button>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="button" className="min-h-11" disabled={busy || title.trim().length < 2} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}حفظ</Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Thread ─────────────────────────────────────────────────────────────────

function useChannels(enabled: boolean) {
  return useQuery({
    queryKey: workKeys.channels,
    queryFn: () => adminFetch<{ data: Channel[] }>("/admin/work-commands/channels").then((result) => result.data),
    enabled,
    refetchInterval: 15_000,
  });
}

function mergeThread(current: Thread, incoming: { messages: Message[]; orders: WorkOrder[] }, position: "append" | "prepend", olderPage = false): Thread {
  const seen = new Set(current.messages.filter((item) => !item.pending).map((item) => item.id));
  const fresh = incoming.messages.filter((item) => !seen.has(item.id));
  const confirmed = current.messages.filter((item) => !item.pending);
  const pending = current.messages.filter((item) => item.pending);
  const messages = position === "append" ? [...confirmed, ...fresh, ...pending] : [...fresh, ...confirmed, ...pending];
  const orders = new Map(current.orders.map((order) => [order.id, order]));
  for (const order of incoming.orders) orders.set(order.id, order);
  return { messages, orders: [...orders.values()], hasOlder: olderPage ? incoming.messages.length >= 40 : current.hasOlder };
}

function useThread(channelId: number | null) {
  return useQuery({
    queryKey: workKeys.messages(channelId ?? 0),
    enabled: Boolean(channelId),
    refetchInterval: 4_000,
    queryFn: async (): Promise<Thread> => {
      const key = workKeys.messages(channelId!);
      const cached = queryClient.getQueryData<Thread>(key);
      const lastId = Math.max(0, ...(cached?.messages ?? []).filter((item) => !item.pending).map((item) => item.id));
      if (cached && lastId) {
        // Order cards refresh through the status messages each action posts.
        const next = await adminFetch<{ messages: Message[]; orders: WorkOrder[] }>(`/admin/work-commands/channels/${channelId}/messages?after=${lastId}&limit=100`);
        return mergeThread(cached, next, "append");
      }
      const first = await adminFetch<{ messages: Message[]; orders: WorkOrder[] }>(`/admin/work-commands/channels/${channelId}/messages?limit=40`);
      return { messages: first.messages, orders: first.orders, hasOlder: first.messages.length >= 40 };
    },
  });
}

function AttachmentView({ item }: { item: Attachment }) {
  const isImage = item.mediaType === "image" || item.mediaType.startsWith("image/");
  if (isImage)
    return (
      <a href={item.url} target="_blank" rel="noreferrer noopener" className="block overflow-hidden rounded-lg border border-border">
        <img src={item.thumbnailUrl || item.url} alt={item.caption || item.fileName || "صورة مرفقة"} className="max-h-56 w-full max-w-xs object-cover" loading="lazy" />
      </a>
    );
  if (item.mediaType.startsWith("video/")) return <video src={item.url} controls preload="metadata" className="max-h-56 w-full max-w-xs rounded-lg border border-border" />;
  return (
    <a href={item.url} target="_blank" rel="noreferrer noopener" className="flex min-h-11 max-w-xs items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-bold text-primary hover:bg-primary/5">
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.fileName || (item.mediaType === "link" ? item.url : "ملف مرفق")}</span>
    </a>
  );
}

/** Same sender, same day, within five minutes: one visual group. */
function sameRun(a: Message | undefined, b: Message | undefined) {
  if (!a || !b || a.type === "system" || b.type === "system" || a.type === "work_order" || b.type === "work_order") return false;
  if (a.senderId !== b.senderId || formatDay(a.createdAt) !== formatDay(b.createdAt)) return false;
  return Math.abs(new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()) < 5 * 60_000;
}

function MessageRow({
  message,
  mine,
  firstInRun = true,
  lastInRun = true,
  order,
  canCreate,
  onReply,
  onOpenOrder,
  onConvert,
  onRetry,
}: {
  message: Message;
  mine: boolean;
  /** Name above the first bubble of a run, photo beside the last one. */
  firstInRun?: boolean;
  lastInRun?: boolean;
  order: WorkOrder | undefined;
  canCreate: boolean;
  onReply: (message: Message) => void;
  onOpenOrder: (order: WorkOrder) => void;
  onConvert: (message: Message) => void;
  onRetry: (message: Message) => void;
}) {
  if (message.type === "system")
    return (
      <div className="flex justify-center px-2">
        <Button type="button" variant="ghost" size="flush" disabled={!order} onClick={() => order && onOpenOrder(order)} className="h-auto max-w-[90%] whitespace-normal rounded-full bg-muted px-3 py-1 text-center text-xs font-semibold leading-5 text-muted-foreground disabled:opacity-100">
          {message.body} · {formatTime(message.createdAt)}
        </Button>
      </div>
    );
  if (message.type === "work_order")
    return (
      <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <div className="flex w-full max-w-md items-end gap-1">
          {mine ? null : <EmployeeAvatar name={message.senderName} photoUrl={message.senderPhotoUrl} size={32} className="mb-0.5" />}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="px-1 text-[11px] font-bold text-muted-foreground">{mine ? "أصدرتَ" : `أصدر ${message.senderName}`} أمر عمل · {formatTime(message.createdAt)}</p>
            {order ? <WorkOrderCard order={order} onOpen={onOpenOrder} /> : <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">{message.body}</div>}
          </div>
        </div>
      </div>
    );
  const canConvert = canCreate && message.type !== "work_order" && !message.pending && Boolean(message.body || message.voiceUrl);
  return (
    <div className={`group flex ${mine ? "justify-end" : "justify-start"} ${!firstInRun ? "-mt-1" : ""}`}>
      <div className={`flex max-w-[85%] items-end gap-1 sm:max-w-[75%] ${mine ? "flex-row-reverse" : ""}`}>
        {mine ? null : lastInRun ? (
          <EmployeeAvatar name={message.senderName} photoUrl={message.senderPhotoUrl} size={32} className="mb-0.5" />
        ) : (
          <span className="w-8 shrink-0" aria-hidden />
        )}
        <div className={`min-w-0 rounded-2xl border px-3 py-2 ${mine ? "rounded-ee-md border-primary/20 bg-primary/10" : "rounded-es-md border-border bg-card"} ${message.pending === "failed" ? "border-destructive/50" : ""}`}>
          {!mine && firstInRun ? <p className="mb-0.5 text-xs font-extrabold text-primary">{message.senderName}</p> : null}
          {message.replyTo ? (
            <div className="mb-1.5 rounded-lg bg-background/80 px-2 py-1 text-xs">
              <span className="flex items-center gap-1 font-bold text-primary"><Reply className="h-3 w-3" />{message.replyTo.senderName}</span>
              <span className="line-clamp-2 text-muted-foreground">{message.replyTo.body || "رسالة صوتية أو مرفق"}</span>
            </div>
          ) : null}
          {message.voiceUrl ? <audio controls preload="none" src={message.voiceUrl} className="h-10 w-60 max-w-full" aria-label="رسالة صوتية" /> : null}
          {message.body ? <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{message.body}</p> : null}
          {message.attachments.length ? <div className="mt-1.5 grid gap-1.5">{message.attachments.map((item, index) => <AttachmentView key={`${item.url}-${index}`} item={item} />)}</div> : null}
          <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
            {message.pending === "sending" ? <><Loader2 className="h-3 w-3 animate-spin" />جارٍ الإرسال</> : null}
            {message.pending === "failed" ? <span className="font-bold text-destructive">لم تُرسل</span> : null}
            {!message.pending ? formatTime(message.createdAt) : null}
            {mine && !message.pending && message.readBy ? <span className="inline-flex items-center gap-0.5 text-primary"><CheckCheck className="h-3 w-3" />{message.readBy}</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-0.5 transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
          {message.pending === "failed" ? <Button type="button" variant="quiet" size="iconSm" aria-label="إعادة الإرسال" onClick={() => onRetry(message)}><RotateCw className="h-3.5 w-3.5" /></Button> : null}
          {!message.pending ? <Button type="button" variant="quiet" size="iconSm" aria-label="رد" onClick={() => onReply(message)}><Reply className="h-3.5 w-3.5" /></Button> : null}
          {canConvert ? <Button type="button" variant="quiet" size="iconSm" aria-label="تحويل إلى أمر عمل" title="تحويل إلى أمر عمل" onClick={() => onConvert(message)}><ClipboardPlus className="h-3.5 w-3.5" /></Button> : null}
        </div>
      </div>
    </div>
  );
}

type Draft = { attachments: Attachment[]; uploading: number };

function useVoiceRecorder(onError: (message: string) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const resolveRef = useRef<((value: { blob: Blob; seconds: number } | null) => void) | null>(null);
  const startedRef = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const elapsed = Math.round((Date.now() - startedRef.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= 180) recorderRef.current?.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  const start = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("هذا المتصفح لا يدعم تسجيل الصوت.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const type = (recorder.mimeType || "audio/webm").split(";")[0];
        const blob = new Blob(chunksRef.current, { type });
        resolveRef.current?.(blob.size ? { blob, seconds: Math.max(1, Math.round((Date.now() - startedRef.current) / 1000)) } : null);
        resolveRef.current = null;
      };
      recorderRef.current = recorder;
      startedRef.current = Date.now();
      setSeconds(0);
      recorder.start(1000);
      setRecording(true);
    } catch {
      onError("لم يُسمح باستخدام المايكروفون. فعّل الإذن من إعدادات المتصفح.");
    }
  }, [onError]);

  const finish = useCallback(
    (keep: boolean) =>
      new Promise<{ blob: Blob; seconds: number } | null>((resolve) => {
        const recorder = recorderRef.current;
        if (!recorder || recorder.state === "inactive") return resolve(null);
        resolveRef.current = keep ? resolve : () => resolve(null);
        recorder.stop();
      }),
    [],
  );

  return { recording, seconds, start, finish };
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("تعذر تجهيز التسجيل"));
    reader.readAsDataURL(blob);
  });
}

function Composer({
  channel,
  me,
  replyTo,
  onClearReply,
  onSend,
  onCreateOrder,
}: {
  channel: Channel;
  me: WorkMe;
  replyTo: Message | null;
  onClearReply: () => void;
  onSend: (payload: { body: string; attachments: Attachment[]; voice?: string; voiceDuration?: number }) => void;
  onCreateOrder: () => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft>({ attachments: [], uploading: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceRecorder(useCallback((message: string) => toast({ variant: "destructive", title: "تعذر التسجيل", description: message }), [toast]));
  const [sendingVoice, setSendingVoice] = useState(false);

  useEffect(() => {
    setText("");
    setDraft({ attachments: [], uploading: 0 });
  }, [channel.id]);
  useEffect(() => {
    if (replyTo) textRef.current?.focus();
  }, [replyTo]);

  const upload = async (files: File[]) => {
    for (const file of files) {
      if (!isSupportedTaskFile(file)) {
        toast({ variant: "destructive", title: "نوع الملف غير مدعوم", description: file.name });
        continue;
      }
      setDraft((current) => ({ ...current, uploading: current.uploading + 1 }));
      try {
        const attachment: Attachment = file.type.startsWith("image/")
          ? await uploadImageWithVariants(file, { folder: "uploads/tasks" }).then((result) => ({ url: result.originalUrl, thumbnailUrl: result.thumbnailUrl, fileName: file.name, mediaType: file.type || "image" }))
          : await uploadTaskFile(file, { folder: "uploads/tasks" }).then((result) => ({ url: result.url, fileName: file.name, mediaType: result.mime }));
        setDraft((current) => ({ attachments: [...current.attachments, attachment], uploading: current.uploading - 1 }));
      } catch (error) {
        setDraft((current) => ({ ...current, uploading: current.uploading - 1 }));
        toast({ variant: "destructive", title: "تعذر رفع الملف", description: `${file.name}: ${apiErrorMessage(error)}` });
      }
    }
  };

  const submit = () => {
    if (draft.uploading) return;
    const body = text.trim();
    if (!body && !draft.attachments.length) return;
    onSend({ body, attachments: draft.attachments });
    setText("");
    setDraft({ attachments: [], uploading: 0 });
  };

  const sendVoice = async () => {
    setSendingVoice(true);
    try {
      const result = await voice.finish(true);
      if (!result) return;
      onSend({ body: "", attachments: [], voice: await blobToDataUrl(result.blob), voiceDuration: result.seconds });
    } catch (error) {
      toast({ variant: "destructive", title: "تعذر إرسال التسجيل", description: apiErrorMessage(error) });
    } finally {
      setSendingVoice(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(hover: hover)").matches) {
      event.preventDefault();
      submit();
    }
  };

  const clock = `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, "0")}`;
  return (
    <div className="border-t border-border bg-card p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {replyTo ? (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs">
          <Reply className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate"><b>{replyTo.senderName}:</b> {replyTo.body || "رسالة صوتية أو مرفق"}</span>
          <Button type="button" variant="quiet" size="iconSm" aria-label="إلغاء الرد" onClick={onClearReply}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ) : null}
      {draft.attachments.length || draft.uploading ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {draft.attachments.map((item, index) => (
            <span key={`${item.url}-${index}`} className="inline-flex max-w-[12rem] items-center gap-1 rounded-lg border border-border bg-background ps-2 text-xs">
              <span className="truncate">{item.fileName || "مرفق"}</span>
              <Button type="button" variant="quiet" size="iconSm" aria-label={`إزالة ${item.fileName ?? "المرفق"}`} onClick={() => setDraft((current) => ({ ...current, attachments: current.attachments.filter((_, itemIndex) => itemIndex !== index) }))}><X className="h-3 w-3" /></Button>
            </span>
          ))}
          {draft.uploading ? <span className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-muted px-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />جارٍ الرفع ({draft.uploading})</span> : null}
        </div>
      ) : null}
      {voice.recording ? (
        <div className="flex min-h-12 items-center gap-2 rounded-xl bg-destructive/5 px-2">
          <span className="relative ms-1 flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-destructive opacity-60 motion-safe:animate-ping" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" /></span>
          <span className="text-sm font-bold tabular-nums" dir="ltr">{clock}</span>
          <span className="text-xs text-muted-foreground">يتوقف تلقائياً عند 3 دقائق</span>
          <Button type="button" variant="quiet" size="iconSm" className="ms-auto" aria-label="إلغاء التسجيل" onClick={() => void voice.finish(false)}><Trash2 className="h-4 w-4" /></Button>
          <Button type="button" size="icon" className="h-10 w-10 rounded-full" aria-label="إرسال التسجيل" disabled={sendingVoice} onClick={() => void sendVoice()}>{sendingVoice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 -scale-x-100" />}</Button>
        </div>
      ) : (
        <div className="flex items-end gap-1">
          <Button type="button" variant="quiet" size="iconSm" aria-label="إرفاق ملف أو صورة" onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /></Button>
          <input ref={fileRef} type="file" multiple className="hidden" accept="image/*,video/mp4,video/webm,video/quicktime,application/pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void upload(files); }} />
          {me.access.canCreate ? <Button type="button" variant="quiet" size="iconSm" aria-label="إصدار أمر عمل" title="إصدار أمر عمل" onClick={onCreateOrder}><ClipboardPlus className="h-4 w-4" /></Button> : null}
          <Textarea
            ref={textRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={`اكتب في ${channel.title}`}
            aria-label="نص الرسالة"
            className="max-h-36 min-h-10 flex-1 resize-none rounded-xl py-2.5 leading-5 [field-sizing:content]"
          />
          {text.trim() || draft.attachments.length ? (
            <Button type="button" size="icon" className="h-10 w-10 shrink-0 rounded-full" aria-label="إرسال" disabled={Boolean(draft.uploading)} onClick={submit}><Send className="h-4 w-4 -scale-x-100" /></Button>
          ) : (
            <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-full" aria-label="تسجيل رسالة صوتية" onClick={() => void voice.start()}><Mic className="h-4 w-4" /></Button>
          )}
        </div>
      )}
    </div>
  );
}

function ChatPanel({
  channel,
  me,
  onBack,
  onOpenOrder,
}: {
  channel: Channel;
  me: WorkMe;
  onBack?: () => void;
  onOpenOrder: (order: WorkOrder) => void;
}) {
  const { toast } = useToast();
  const thread = useThread(channel.id);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingChannel, setEditingChannel] = useState(false);
  const [orderDialog, setOrderDialog] = useState<{ voice: { messageId: number; url: string } | null; text: string | null } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastReadSent = useRef(0);
  const messages = thread.data?.messages ?? [];
  const orders = useMemo(() => new Map((thread.data?.orders ?? []).map((order) => [order.id, order])), [thread.data?.orders]);
  const lastConfirmed = Math.max(0, ...messages.filter((item) => !item.pending).map((item) => item.id));

  useEffect(() => {
    setReplyTo(null);
    stickToBottom.current = true;
    lastReadSent.current = 0;
  }, [channel.id]);

  // Follow new messages only while the reader is already at the bottom.
  useEffect(() => {
    const node = scrollRef.current;
    if (node && stickToBottom.current) node.scrollTop = node.scrollHeight;
  }, [messages.length, channel.id]);

  useEffect(() => {
    if (!lastConfirmed || lastConfirmed <= lastReadSent.current) return;
    lastReadSent.current = lastConfirmed;
    void adminFetch(`/admin/work-commands/channels/${channel.id}/read`, { method: "POST", body: JSON.stringify({ lastMessageId: lastConfirmed }) })
      .then(() => queryClient.setQueryData<Channel[]>(workKeys.channels, (rows) => rows?.map((row) => (row.id === channel.id ? { ...row, unread: 0 } : row))))
      .catch(() => {
        // Retried on the next poll; the unread badge stays as the server reported it.
        lastReadSent.current = 0;
      });
  }, [lastConfirmed, channel.id]);

  const key = workKeys.messages(channel.id);
  const setThread = (update: (thread: Thread) => Thread) =>
    queryClient.setQueryData<Thread>(key, (current) => update(current ?? { messages: [], orders: [], hasOlder: false }));

  const send = async (payload: { body: string; attachments: Attachment[]; voice?: string; voiceDuration?: number }, retryOf?: Message) => {
    const clientKey = retryOf ? String((retryOf as Message & { clientKey?: string }).clientKey) : newClientKey();
    const optimistic: Message & { clientKey: string; payload: typeof payload } = {
      id: -Date.now(),
      channelId: channel.id,
      senderId: me.user.id,
      senderName: me.user.name,
      body: payload.body || null,
      type: payload.voice ? "voice" : "text",
      voiceUrl: null,
      voiceDuration: payload.voiceDuration ?? null,
      attachments: payload.attachments,
      replyTo: replyTo ? { id: replyTo.id, senderName: replyTo.senderName, body: replyTo.body } : null,
      taskId: null,
      readBy: 0,
      createdAt: new Date().toISOString(),
      pending: "sending",
      clientKey,
      payload,
    };
    const replyId = retryOf ? (retryOf.replyTo?.id ?? null) : replyTo?.id ?? null;
    stickToBottom.current = true;
    setThread((current) => ({ ...current, messages: [...current.messages.filter((item) => item !== retryOf), optimistic] }));
    setReplyTo(null);
    try {
      const result = await adminFetch<{ message: Message }>(`/admin/work-commands/channels/${channel.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: payload.body, attachments: payload.attachments, voice: payload.voice, voiceDuration: payload.voiceDuration, replyToId: replyId, clientKey }),
      });
      setThread((current) => {
        const exists = current.messages.some((item) => !item.pending && item.id === result.message.id);
        const rest = current.messages.filter((item) => item !== optimistic);
        return { ...current, messages: exists ? rest : [...rest.filter((item) => !item.pending), result.message, ...rest.filter((item) => item.pending)] };
      });
      void queryClient.invalidateQueries({ queryKey: workKeys.channels });
    } catch (error) {
      setThread((current) => ({ ...current, messages: current.messages.map((item) => (item === optimistic ? { ...optimistic, pending: "failed" } : item)) }));
      toast({ variant: "destructive", title: "لم تُرسل الرسالة", description: apiErrorMessage(error) });
    }
  };

  const loadOlder = async () => {
    const firstId = Math.min(...messages.filter((item) => !item.pending).map((item) => item.id));
    if (!Number.isFinite(firstId)) return;
    setLoadingOlder(true);
    const node = scrollRef.current;
    const previousHeight = node?.scrollHeight ?? 0;
    try {
      const older = await adminFetch<{ messages: Message[]; orders: WorkOrder[] }>(`/admin/work-commands/channels/${channel.id}/messages?before=${firstId}&limit=40`);
      stickToBottom.current = false;
      setThread((current) => mergeThread(current, older, "prepend", true));
      requestAnimationFrame(() => {
        if (node) node.scrollTop = node.scrollHeight - previousHeight;
      });
    } catch (error) {
      toast({ variant: "destructive", title: "تعذر تحميل الرسائل الأقدم", description: apiErrorMessage(error) });
    } finally {
      setLoadingOlder(false);
    }
  };

  const openOrders = (thread.data?.orders ?? []).filter((order) => !order.parentId && ["new", "accepted", "in_progress", "needs_rework", "review"].includes(order.status));
  let lastDay = "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        {onBack ? <Button type="button" variant="quiet" size="iconSm" aria-label="رجوع للمحادثات" onClick={onBack}><ArrowRight className="h-4 w-4" /></Button> : null}
        <ChannelIcon channel={channel} size="sm" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-extrabold">{channel.title}</h2>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {channel.pendingOrders ? <span className="font-bold text-amber-700 dark:text-amber-300">أوامر مفتوحة: {channel.pendingOrders}</span> : <span>لا أوامر مفتوحة</span>}
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />نشطون اليوم: {channel.activeEmployees}</span>
          </p>
        </div>
        {me.access.canCreateChannel ? (
          <Button type="button" variant="quiet" size="iconSm" aria-label="تعديل المحادثة" title="تعديل المحادثة" onClick={() => setEditingChannel(true)}><Pencil className="h-4 w-4" /></Button>
        ) : null}
        {me.access.canCreate ? (
          <Button type="button" size="compact" className="gap-1.5" onClick={() => setOrderDialog({ voice: null, text: null })}>
            <ClipboardPlus className="h-4 w-4" /><span className="max-sm:hidden">إصدار أمر عمل</span><span className="sm:hidden">أمر</span>
          </Button>
        ) : null}
      </header>
      <EditChannelDialog channel={channel} open={editingChannel} onOpenChange={setEditingChannel} />

      {openOrders.length ? (
        <div className="flex gap-1.5 overflow-x-auto border-b border-border bg-muted/30 px-3 py-2 [scrollbar-width:thin]" aria-label="أوامر مفتوحة في هذه المحادثة">
          {openOrders.map((order) => (
            <Button key={order.id} type="button" size="compact" variant="outline" onClick={() => onOpenOrder(order)} className={`max-w-[15rem] shrink-0 gap-1.5 ${order.overdue ? "border-destructive/40" : ""}`}>
              <StatusChip status={order.status} /><span className="truncate">{order.title}</span>
            </Button>
          ))}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain bg-muted/20 px-3 py-3"
        aria-live="polite"
      >
        {thread.isLoading ? (
          <div className="space-y-3" aria-busy="true">{[60, 40, 70, 50].map((width, index) => <div key={index} className={`h-12 animate-pulse rounded-2xl bg-muted ${index % 2 ? "ms-auto" : ""}`} style={{ width: `${width}%` }} />)}</div>
        ) : thread.isError && !thread.data ? (
          <Failure title="تعذر تحميل الرسائل" error={thread.error} onRetry={() => void thread.refetch()} />
        ) : (
          <>
            {thread.data?.hasOlder ? (
              <div className="flex justify-center"><Button type="button" size="compact" variant="outline" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}تحميل رسائل أقدم</Button></div>
            ) : null}
            {thread.isError ? <Failure title="انقطع تحديث المحادثة" error={thread.error} onRetry={() => void thread.refetch()} /> : null}
            {!messages.length ? <Empty>ابدأ المحادثة أو أصدر أول أمر عمل لهذا القسم.</Empty> : null}
            {messages.map((message, index) => {
              const day = formatDay(message.createdAt);
              const separator = day !== lastDay ? day : null;
              lastDay = day;
              return (
                <div key={message.pending ? `p-${message.id}` : message.id} className="space-y-2">
                  {separator ? <div className="sticky top-0 z-[1] flex justify-center py-1"><span className="rounded-full border border-border bg-card px-3 py-0.5 text-[11px] font-bold text-muted-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.06)]">{separator}</span></div> : null}
                  <MessageRow
                    message={message}
                    mine={message.senderId === me.user.id}
                    firstInRun={!sameRun(messages[index - 1], message)}
                    lastInRun={!sameRun(message, messages[index + 1])}
                    order={message.taskId ? orders.get(message.taskId) : undefined}
                    canCreate={me.access.canCreate}
                    onReply={setReplyTo}
                    onOpenOrder={onOpenOrder}
                    onConvert={(item) => setOrderDialog({ voice: item.voiceUrl ? { messageId: item.id, url: item.voiceUrl } : null, text: item.body })}
                    onRetry={(item) => void send((item as Message & { payload: { body: string; attachments: Attachment[] } }).payload, item)}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>

      <Composer channel={channel} me={me} replyTo={replyTo} onClearReply={() => setReplyTo(null)} onSend={(payload) => void send(payload)} onCreateOrder={() => setOrderDialog({ voice: null, text: null })} />

      <CreateWorkOrderDialog
        open={Boolean(orderDialog)}
        onOpenChange={(open) => !open && setOrderDialog(null)}
        channelId={channel.id}
        defaults={{ department: channel.isDepartment ? channel.department : undefined, contextLabel: `في محادثة ${channel.title}`, description: orderDialog?.text ?? undefined }}
        voice={orderDialog?.voice ? { ...orderDialog.voice, transcript: null } : null}
        onCreated={() => {
          stickToBottom.current = true;
          void thread.refetch();
        }}
      />
    </div>
  );
}

// ─── Board, my orders, search ───────────────────────────────────────────────

type BoardData = {
  stats: { new: number; acknowledged: number; inProgress: number; review: number; completed: number; overdue: number; total: number };
  total: number;
  page: number;
  totalPages: number;
  orders: WorkOrder[];
};

function Board({ onOpenOrder, isWide, canOpenBookings }: { onOpenOrder: (order: WorkOrder) => void; isWide: boolean; canOpenBookings: boolean }) {
  const [filters, setFilters] = useState({ department: "", staffId: "", priority: "", status: "", from: "", to: "", customer: "", page: 1 });
  const staff = useWorkStaff(true);
  const catalog = useWorkCatalog();
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== "" && value !== null).map(([key, value]) => [key, String(value)]));
  const board = useQuery({
    queryKey: workKeys.dashboard(filters),
    queryFn: () => adminFetch<BoardData>(`/admin/work-commands/dashboard?${params.toString()}`),
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });
  const set = (patch: Partial<typeof filters>) => setFilters((current) => ({ ...current, page: 1, ...patch }));
  const stats = board.data?.stats;
  const tiles: Array<{ key: string; label: string; value: number | undefined; tone?: string }> = [
    { key: "new", label: "جديدة", value: stats?.new },
    { key: "accepted", label: "تم استلامها", value: stats?.acknowledged },
    { key: "in_progress", label: "قيد التنفيذ", value: stats?.inProgress },
    { key: "review", label: "بانتظار الاعتماد", value: stats?.review },
    { key: "done", label: "منجزة", value: stats?.completed },
    { key: "overdue", label: "متأخرة", value: stats?.overdue, tone: "text-destructive" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-6" role="group" aria-label="تصفية حسب الحالة">
        {tiles.map((tile) => {
          const active = filters.status === tile.key;
          return (
            <Button key={tile.key} type="button" variant="ghost" aria-pressed={active} onClick={() => set({ status: active ? "" : tile.key })} className={`flex h-auto min-h-16 flex-col items-start gap-0.5 rounded-none bg-card px-3 py-2.5 text-start ${active ? "bg-primary/10 hover:bg-primary/12" : ""}`}>
              <span className={`text-xl font-extrabold tabular-nums ${tile.tone ?? "text-foreground"}`}>{tile.value ?? "—"}</span>
              <span className="text-xs font-semibold text-muted-foreground">{tile.label}</span>
            </Button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <select value={filters.department} onChange={(event) => set({ department: event.target.value })} className={fieldClass} aria-label="القسم">
          <option value="">كل الأقسام</option>
          {catalog.departments.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <select value={filters.staffId} onChange={(event) => set({ staffId: event.target.value })} className={fieldClass} aria-label="الموظف">
          <option value="">كل الموظفين</option>
          {(staff.data ?? []).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
        <select value={filters.priority} onChange={(event) => set({ priority: event.target.value })} className={fieldClass} aria-label="الأولوية">
          <option value="">كل الأولويات</option>
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">من<Input type="date" value={filters.from} onChange={(event) => set({ from: event.target.value })} aria-label="من تاريخ" className="min-h-11 flex-1" dir="ltr" /></label>
        <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">إلى<Input type="date" value={filters.to} onChange={(event) => set({ to: event.target.value })} aria-label="إلى تاريخ" className="min-h-11 flex-1" dir="ltr" /></label>
        <Input value={filters.customer} onChange={(event) => set({ customer: event.target.value })} placeholder="اسم الزبون" aria-label="اسم الزبون" className="col-span-2 min-h-11 sm:col-span-1" />
      </div>

      {board.isError ? <Failure title="تعذر تحميل لوحة المتابعة" error={board.error} onRetry={() => void board.refetch()} /> : null}
      {staff.isError ? <Failure title="تعذر تحميل قائمة الموظفين للتصفية" error={staff.error} onRetry={() => void staff.refetch()} /> : null}
      {board.isLoading ? <div className="h-48 animate-pulse rounded-xl bg-muted" aria-busy="true" /> : null}

      {board.data ? (
        board.data.orders.length ? (
          isWide ? (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-right text-xs text-muted-foreground">
                  <tr>{["الأمر", "الزبون", "القسم", "المسؤول", "الحالة", "الموعد", "التأخير", "الحجز"].map((label) => <th key={label} scope="col" className="px-3 py-2.5 font-bold">{label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {board.data.orders.map((order) => (
                    <tr key={order.id} className="bg-card hover:bg-muted/30">
                      <td className="max-w-[18rem] px-3 py-2">
                        <Button type="button" variant="link" size="flush" onClick={() => onOpenOrder(order)} className="block h-auto max-w-full border-transparent truncate text-start font-extrabold text-foreground">{order.title}</Button>
                        <span className="text-[11px] tabular-nums text-muted-foreground" dir="ltr">{order.orderNo}</span>
                        {order.description ? <span className="line-clamp-2 text-xs leading-5 text-muted-foreground" title={order.description}>{order.description}</span> : null}
                      </td>
                      <td className="max-w-[10rem] truncate px-3 py-2 font-bold">{order.customer?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{order.departmentLabel}</td>
                      <td className="max-w-[10rem] truncate px-3 py-2">{order.assigneeNames ?? "—"}</td>
                      <td className="px-3 py-2"><StatusChip status={order.status} /></td>
                      <td className={`px-3 py-2 tabular-nums ${order.overdue ? "font-bold text-destructive" : ""}`}>{formatDateTime(order.dueAt)}</td>
                      <td className="px-3 py-2 tabular-nums">{order.delayMinutes ? <span className="font-bold text-destructive">{order.delayMinutes >= 60 ? `${Math.round(order.delayMinutes / 60)} س` : `${order.delayMinutes} د`}</span> : "—"}</td>
                      <td className="px-3 py-2">{order.booking ? canOpenBookings ? <Link href={bookingHref(order.booking)} className="font-bold text-primary underline-offset-4 hover:underline"><bdi dir="ltr">#{order.booking.id}</bdi></Link> : <bdi dir="ltr" className="tabular-nums">#{order.booking.id}</bdi> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid gap-2">{board.data.orders.map((order) => <WorkOrderCard key={order.id} order={order} onOpen={onOpenOrder} actionLimit={1} />)}</div>
          )
        ) : (
          <Empty>لا توجد أوامر مطابقة للتصفية.</Empty>
        )
      ) : null}

      {board.data && board.data.totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Button type="button" variant="outline" size="compact" disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>السابق</Button>
          <span className="text-xs font-bold tabular-nums text-muted-foreground">{board.data.page} / {board.data.totalPages}</span>
          <Button type="button" variant="outline" size="compact" disabled={filters.page >= board.data.totalPages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>التالي</Button>
        </div>
      ) : null}
    </div>
  );
}

const MY_GROUPS: Array<{ title: string; statuses: WorkOrderStatus[] }> = [
  { title: "بانتظار الاستلام", statuses: ["new"] },
  { title: "يحتاج تعديل", statuses: ["needs_rework"] },
  { title: "قيد التنفيذ", statuses: ["accepted", "in_progress"] },
  { title: "بانتظار الاعتماد", statuses: ["review"] },
  { title: "منجزة هذا الأسبوع", statuses: ["done", "approved"] },
];

function MyOrders({ onOpenOrder }: { onOpenOrder: (order: WorkOrder) => void }) {
  const mine = useQuery({
    queryKey: workKeys.my,
    queryFn: () => adminFetch<{ orders: WorkOrder[]; counts: Record<string, number> }>("/admin/work-commands/my"),
    refetchInterval: 20_000,
  });
  if (mine.isLoading) return <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((index) => <div key={index} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>;
  if (mine.isError) return <Failure title="تعذر تحميل أوامرك" error={mine.error} onRetry={() => void mine.refetch()} />;
  const orders = mine.data?.orders ?? [];
  if (!orders.length) return <Empty>لا توجد أوامر عمل مسندة إليك الآن.</Empty>;
  return (
    <div className="space-y-6">
      {mine.data!.counts.overdue ? <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-bold text-destructive">{mine.data!.counts.overdue === 1 ? "لديك أمر متأخر عن موعده" : `أوامر متأخرة عن موعدها: ${mine.data!.counts.overdue}`}</p> : null}
      {MY_GROUPS.map((group) => {
        const rows = orders.filter((order) => group.statuses.includes(order.status));
        if (!rows.length) return null;
        return (
          <section key={group.title} className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-extrabold">{group.title}<span className="rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">{rows.length}</span></h3>
            <div className="grid gap-2 lg:grid-cols-2">{rows.map((order) => <WorkOrderCard key={order.id} order={order} onOpen={onOpenOrder} actionLimit={3} />)}</div>
          </section>
        );
      })}
    </div>
  );
}

function SearchPanel({ onOpenOrder, onOpenChannel }: { onOpenOrder: (order: WorkOrder) => void; onOpenChannel: (id: number) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);
  const results = useQuery({
    queryKey: workKeys.search(debounced),
    queryFn: () => adminFetch<{ orders: WorkOrder[]; messages: Array<{ id: number; channelId: number; channelTitle: string; senderName: string; body: string | null; createdAt: string | null }> }>(`/admin/work-commands/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  });
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="رقم الأمر، اسم موظف، زبون، رقم حجز أو نص رسالة" aria-label="بحث" className="min-h-12 pr-9 text-base" autoFocus />
      </div>
      {debounced.length < 2 ? <p className="text-sm text-muted-foreground">اكتب حرفين على الأقل للبحث في الأوامر والرسائل التي يحق لك رؤيتها.</p> : null}
      {results.isFetching && !results.data ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />جارٍ البحث...</div> : null}
      {results.isError ? <Failure title="تعذر البحث" error={results.error} onRetry={() => void results.refetch()} /> : null}
      {results.data ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-2">
            <h3 className="text-sm font-extrabold">أوامر العمل ({results.data.orders.length})</h3>
            {results.data.orders.length ? results.data.orders.map((order) => <WorkOrderCard key={order.id} order={order} onOpen={onOpenOrder} actionLimit={0} />) : <Empty>لا توجد أوامر مطابقة.</Empty>}
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-extrabold">الرسائل ({results.data.messages.length})</h3>
            {results.data.messages.length ? (
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {results.data.messages.map((message) => (
                  <li key={message.id}>
                    <Button type="button" variant="ghost" onClick={() => onOpenChannel(message.channelId)} className="flex h-auto w-full flex-col items-start gap-0.5 rounded-none px-3 py-2.5 text-start">
                      <span className="text-xs font-bold text-muted-foreground">{message.channelTitle} · {message.senderName} · {formatDateTime(message.createdAt)}</span>
                      <span className="line-clamp-2 whitespace-normal text-sm font-normal leading-6">{message.body}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : <Empty>لا توجد رسائل مطابقة.</Empty>}
          </section>
        </div>
      ) : null}
    </div>
  );
}

// ─── Shell ──────────────────────────────────────────────────────────────────

function TabButton({ active, onClick, icon: Icon, children, badge }: { active: boolean; onClick: () => void; icon: typeof Inbox; children: ReactNode; badge?: number }) {
  return (
    <Button type="button" role="tab" aria-selected={active} variant={active ? "selected" : "quiet"} size="compact" onClick={onClick} className="shrink-0 gap-1.5">
      <Icon className="h-4 w-4" />{children}
      {badge ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] tabular-nums text-primary-foreground">{badge}</span> : null}
    </Button>
  );
}

export function WorkCommandCenter({ mode = "admin" }: { mode?: "admin" | "staff" }) {
  const me = useWorkMe();
  const isWide = useMediaQuery("(min-width: 1280px)");
  const isLarge = useMediaQuery("(min-width: 1024px)");
  // Every employee sees all orders; managers get it as the follow-up board.
  const showBoard = Boolean(me.data);
  const boardIsManagers = Boolean(me.data && (me.data.access.manager || me.data.access.canApprove));
  const showSettings = Boolean(me.data && (me.data.access.canManageCatalog || me.data.access.canGrant));
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "chat";
    const value = new URLSearchParams(window.location.search).get("view");
    return value === "board" || value === "mine" || value === "search" || value === "settings" ? value : "chat";
  });
  const [channelId, setChannelId] = useState<number | null>(() => readParam("channel"));
  const [orderId, setOrderId] = useState<number | null>(() => readParam("order"));
  const [mobileChat, setMobileChat] = useState(() => Boolean(readParam("channel")));
  const ready = Boolean(me.data?.ready);
  const channels = useChannels(ready);

  useEffect(() => {
    if (!channelId && channels.data?.length && isLarge) setChannelId(channels.data[0].id);
  }, [channels.data, channelId, isLarge]);

  const selectTab = (next: Tab) => {
    setTab(next);
    writeParams({ view: next === "chat" ? null : next });
  };
  const openChannel = (id: number) => {
    setChannelId(id);
    setMobileChat(true);
    setTab("chat");
    writeParams({ channel: id, view: null });
  };
  const openOrder = (order: WorkOrder | number) => {
    const id = typeof order === "number" ? order : order.id;
    setOrderId(id);
    writeParams({ order: id });
  };
  const closeOrder = () => {
    setOrderId(null);
    writeParams({ order: null });
  };

  if (me.isLoading) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (me.isError) return <Failure title="تعذر تحميل مركز أوامر العمل" error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data!.ready)
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-extrabold">مركز أوامر العمل غير مفعّل بعد</h2>
        <p className="mt-2 max-w-prose text-sm leading-7 text-muted-foreground">
          يلزم تطبيق ترقية قاعدة البيانات <span className="font-mono text-foreground" dir="ltr">0126_work_command_center</span> أولاً. المهام والمحادثات الحالية تعمل كالمعتاد ولم يتغير منها شيء.
        </p>
      </div>
    );
  const data = me.data!;
  const activeChannel = (channels.data ?? []).find((channel) => channel.id === channelId) ?? null;
  const unreadTotal = (channels.data ?? []).reduce((sum, channel) => sum + channel.unread, 0);
  const inlineDetails = tab === "chat" && isWide;
  // Leaves room for the page header, and on phones for the staff portal's fixed bottom bar.
  const panelHeight = mode === "staff" ? "h-[calc(100dvh-17rem)] lg:h-[calc(100dvh-12rem)]" : "h-[calc(100dvh-13rem)] lg:h-[calc(100dvh-12rem)]";

  return (
    <div className="space-y-3">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5" role="tablist" aria-label="أقسام مركز أوامر العمل">
        <TabButton active={tab === "chat"} onClick={() => selectTab("chat")} icon={MessagesSquare} badge={unreadTotal}>المحادثات</TabButton>
        {showBoard ? <TabButton active={tab === "board"} onClick={() => selectTab("board")} icon={LayoutDashboard}>{boardIsManagers ? <><span className="max-sm:hidden">لوحة </span>المتابعة</> : "كل الأوامر"}</TabButton> : null}
        <TabButton active={tab === "mine"} onClick={() => selectTab("mine")} icon={ClipboardList}>أوامري</TabButton>
        <TabButton active={tab === "search"} onClick={() => selectTab("search")} icon={Search}>بحث</TabButton>
        {showSettings ? <TabButton active={tab === "settings"} onClick={() => selectTab("settings")} icon={Settings2}>الإعدادات</TabButton> : null}
      </div>

      {tab === "chat" ? (
        <div className={`${panelHeight} min-h-[520px] overflow-hidden rounded-2xl border border-border bg-card lg:grid ${inlineDetails ? "lg:grid-cols-[18rem_minmax(0,1fr)_23rem]" : "lg:grid-cols-[18rem_minmax(0,1fr)]"}`}>
          <aside className={`h-full min-h-0 border-border lg:block lg:border-e ${mobileChat ? "hidden" : "block"}`} aria-label="قائمة المحادثات">
            <ChannelList channels={channels} activeId={channelId} onSelect={openChannel} me={data} />
          </aside>
          <section className={`h-full min-h-0 lg:block ${mobileChat ? "block" : "hidden"}`} aria-label="المحادثة">
            {activeChannel ? (
              <ChatPanel channel={activeChannel} me={data} onBack={isLarge ? undefined : () => { setMobileChat(false); writeParams({ channel: null }); }} onOpenOrder={openOrder} />
            ) : channels.isSuccess ? (
              <div className="grid h-full place-items-center p-6"><Empty>{channelId ? "هذه المحادثة غير متاحة لك." : "اختر محادثة من القائمة."}</Empty></div>
            ) : null}
          </section>
          {inlineDetails ? (
            <aside className="h-full min-h-0 overflow-y-auto overscroll-contain border-s border-border" aria-label="تفاصيل الأمر">
              {orderId ? (
                <>
                  <div className="flex justify-end p-2 pb-0"><Button type="button" variant="quiet" size="iconSm" aria-label="إغلاق التفاصيل" onClick={closeOrder}><X className="h-4 w-4" /></Button></div>
                  <OrderDetailsPanel orderId={orderId} onOpenOrder={openOrder} onOpenChannel={openChannel} />
                </>
              ) : (
                <div className="grid h-full place-items-center p-6 text-center">
                  <div className="space-y-2">
                    <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm font-bold">تفاصيل الأمر تظهر هنا</p>
                    <p className="text-xs leading-5 text-muted-foreground">اختر أمر عمل من المحادثة لرؤية حالته وسجله والإجراءات المتاحة.</p>
                  </div>
                </div>
              )}
            </aside>
          ) : null}
        </div>
      ) : null}

      {tab === "board" && showBoard ? <Board onOpenOrder={openOrder} isWide={isLarge} canOpenBookings={Boolean(me.data?.access.manager)} /> : null}
      {tab === "mine" ? <MyOrders onOpenOrder={openOrder} /> : null}
      {tab === "search" ? <SearchPanel onOpenOrder={openOrder} onOpenChannel={openChannel} /> : null}
      {tab === "settings" && showSettings ? <WorkSettingsPanel /> : null}

      <Sheet open={Boolean(orderId) && !inlineDetails} onOpenChange={(open) => !open && closeOrder()}>
        <SheetContent side={isLarge ? "left" : "bottom"} className={isLarge ? "w-[28rem] overflow-y-auto p-0 sm:max-w-md" : "max-h-[90dvh] overflow-y-auto rounded-t-2xl p-0 pt-4"}>
          <SheetTitle className="sr-only">تفاصيل أمر العمل</SheetTitle>
          {orderId ? <OrderDetailsPanel orderId={orderId} onOpenOrder={openOrder} onOpenChannel={(id) => { closeOrder(); openChannel(id); }} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export type { WorkOrderDefaults };
