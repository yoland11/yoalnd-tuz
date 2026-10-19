import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/views/admin/_lib";
import {
  PRIORITY_LABELS,
  WORK_ORDER_STATUS_LABELS,
  allowedActions,
  type WorkOrderAction,
  type WorkOrderStatus,
} from "@/lib/work-commands";

export type WorkAccess = { manager: boolean; canCreate: boolean; canApprove: boolean; canCreateChannel: boolean; department: string };
export type WorkMe = { ready: boolean; user: { id: number; name: string; department: string }; access: WorkAccess };
export type WorkStaff = { id: number; name: string; department: string; jobTitle: string | null };
export type Attachment = { url: string; thumbnailUrl?: string | null; fileName?: string | null; mediaType: string; caption?: string | null };

export type WorkOrder = {
  id: number;
  orderNo: string;
  title: string;
  description: string | null;
  taskStatus: string;
  status: WorkOrderStatus;
  statusLabel: string;
  priority: string;
  department: string;
  departmentLabel: string;
  dueAt: string | null;
  overdue: boolean;
  dueSoon: boolean;
  assignedStaffIds: number[];
  assigneeNames: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string | null;
  completedAt: string | null;
  approvedAt: string | null;
  returnReason: string | null;
  booking: { type: string; id: number } | null;
  channelId: number | null;
  parentId: number | null;
  mandatory: boolean;
  templateKey: string | null;
  requiresApproval: boolean;
  evidenceRequired: boolean;
  customer: { id: number | null; name: string | null } | null;
  product: { id: number; name: string | null } | null;
  source: { type: string; id: number } | null;
  pendingExtension: { dueAt: string | null; reason: string | null; requestedBy: number | null; requestedAt: string | null } | null;
  delayMinutes?: number;
  actions?: WorkOrderAction[];
};

export type Channel = {
  id: number;
  title: string;
  department: string;
  departmentLabel: string;
  entityType: string | null;
  isDepartment: boolean;
  participantStaffIds: number[];
  unread: number;
  pendingOrders: number;
  activeEmployees: number;
  lastMessage: { body: string | null; type: string; sender: string; at: string } | null;
  updatedAt: string | null;
};

export type Message = {
  id: number;
  channelId: number;
  senderId: number | null;
  senderName: string;
  body: string | null;
  type: string;
  voiceUrl: string | null;
  voiceDuration: number | null;
  attachments: Attachment[];
  replyTo: { id: number; senderName: string; body: string | null } | null;
  taskId: number | null;
  readBy: number;
  createdAt: string | null;
  /** Client-only: optimistic message awaiting the server. */
  pending?: "sending" | "failed";
};

export const workKeys = {
  me: ["work-commands", "me"] as const,
  staff: ["work-commands", "staff"] as const,
  channels: ["work-commands", "channels"] as const,
  messages: (channelId: number) => ["work-commands", "messages", channelId] as const,
  order: (id: number) => ["work-commands", "order", id] as const,
  my: ["work-commands", "my"] as const,
  dashboard: (filters: Record<string, unknown>) => ["work-commands", "dashboard", filters] as const,
  search: (q: string) => ["work-commands", "search", q] as const,
};

export function useWorkMe() {
  return useQuery({ queryKey: workKeys.me, queryFn: () => adminFetch<WorkMe>("/admin/work-commands/me"), staleTime: 60_000 });
}

export function useWorkStaff(enabled: boolean) {
  return useQuery({
    queryKey: workKeys.staff,
    queryFn: () => adminFetch<{ data: WorkStaff[] }>("/admin/work-commands/staff").then((result) => result.data),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Actions the viewer may take; the server re-validates every one. */
export function viewerActions(order: WorkOrder, me: WorkMe | undefined) {
  if (order.actions) return order.actions;
  if (!me) return [];
  return allowedActions({
    status: order.taskStatus,
    isAssignee: order.assignedStaffIds.includes(me.user.id),
    canManage: me.access.canApprove || order.createdBy === me.user.id,
    hasPendingExtension: Boolean(order.pendingExtension),
  });
}

const STATUS_TONE: Record<WorkOrderStatus, string> = {
  new: "bg-primary/10 text-primary",
  accepted: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  in_progress: "bg-amber-500/12 text-amber-800 dark:text-amber-300",
  needs_rework: "bg-destructive/10 text-destructive",
  review: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  done: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  approved: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-muted text-muted-foreground",
};

export function StatusChip({ status }: { status: WorkOrderStatus }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[status]}`}>{WORK_ORDER_STATUS_LABELS[status]}</span>;
}

export function PriorityChip({ priority }: { priority: string }) {
  const tone = priority === "urgent" || priority === "high" ? "text-destructive" : priority === "low" ? "text-muted-foreground" : "text-foreground/80";
  return <span className={`text-[11px] font-bold ${tone}`}>أولوية {PRIORITY_LABELS[priority] ?? PRIORITY_LABELS.medium}</span>;
}

const dateFormat = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { hour: "numeric", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { weekday: "long", day: "numeric", month: "long" });

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : "—";
}

export function formatTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? timeFormat.format(date) : "";
}

export function formatDay(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "اليوم";
  if (date.toDateString() === yesterday.toDateString()) return "أمس";
  return dayFormat.format(date);
}

/** "متبقي ٣ ساعات" / "متأخر ٢٠ دقيقة" for a deadline. */
export function dueText(order: Pick<WorkOrder, "dueAt" | "overdue" | "taskStatus">) {
  if (!order.dueAt) return "بدون موعد";
  if (!["new", "accepted", "in_progress"].includes(order.taskStatus)) return `الموعد ${formatDateTime(order.dueAt)}`;
  const minutes = Math.round((new Date(order.dueAt).getTime() - Date.now()) / 60_000);
  const span = (value: number) =>
    value < 60 ? `${value} دقيقة` : value < 48 * 60 ? `${Math.round(value / 60)} ساعة` : `${Math.round(value / 1440)} يوم`;
  return minutes < 0 ? `متأخر ${span(-minutes)}` : `متبقي ${span(minutes)}`;
}

export function Failure({ title, error, onRetry }: { title: string; error: unknown; onRetry?: () => void }) {
  const details = error instanceof Error ? error.message.replace(/^HTTP\s+\d+:\s*/, "") : "تعذر جلب البيانات حالياً";
  const requestId = typeof error === "object" && error && "requestId" in error ? String((error as { requestId?: string }).requestId ?? "") : "";
  return (
    <div role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4 shrink-0" />{title}</div>
      <div className="mt-1 leading-6">{details}</div>
      {requestId ? <div className="mt-2 font-mono text-[11px] text-destructive/80" dir="ltr">Request ID: {requestId}</div> : null}
      {onRetry ? <Button type="button" size="sm" variant="outline" className="mt-3 min-h-10 gap-2 border-destructive/30 bg-background" onClick={onRetry}><RotateCw className="h-3.5 w-3.5" />إعادة المحاولة</Button> : null}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-7 text-center text-sm leading-6 text-muted-foreground">
      {children}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export const fieldClass =
  "min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

/** Local datetime-local value for an ISO string (and back). */
export function toLocalInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function newClientKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
