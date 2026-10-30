import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, Camera, ChevronLeft, ChevronRight, Crown, ExternalLink, Flower2, Gift, GraduationCap, Loader2, MonitorPlay, Music,
  PackageOpen, PartyPopper, Printer, RotateCcw, Search, SlidersHorizontal, Store, Truck, UtensilsCrossed, Wrench, type LucideIcon,
} from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { printStandaloneDocument } from "@/lib/pdf";
import {
  BOOKING_DEPARTMENTS,
  baghdadDay,
  bookingCountLabel,
  bookingDepartment,
  bookingStatusLabel,
  bookingStatusTone,
  calendarConflicts,
  calendarStaffOptions,
  calendarStatusOptions,
  calendarViewDays,
  eventServicesLabel,
  filterCalendarCards,
  formatCalendarRange,
  formatDayMonth,
  formatEventTime,
  formatLongDay,
  formatMonthYear,
  formatWeekday,
  formatWeekdayNarrow,
  isBookingDepartment,
  isCalendarDay,
  isSameCalendarMonth,
  shiftCalendarAnchor,
  summarizeCalendarDay,
  summarizeCalendarRange,
  type BookingCalendarEvent,
  type BookingStatusTone,
  type CalendarCardFilters,
  type CalendarView,
  type DaySummary,
  type DepartmentCount,
} from "@/lib/booking-calendar";
import { buildBookingSchedulePrintHtml } from "@/lib/booking-calendar-print";
import { AjNApiError, adminFetch, apiErrorMessage } from "./_lib";
import { EmptyState } from "./_layout";
import { DateField } from "@/components/ui/date-field";

type CalendarResponse = { events: BookingCalendarEvent[]; range: { from: string; to: string }; truncated: boolean };

export function calendarEventTarget(event: Pick<BookingCalendarEvent, "kind" | "id">): { href: string; label: string } | null {
  if (!Number.isSafeInteger(event.id) || event.id <= 0) return null;
  if (event.kind === "service") return { href: `/admin/invoice/${event.id}?type=booking`, label: "فتح الفاتورة" };
  if (event.kind === "kosha") return { href: `/admin/invoice/${event.id}?type=kosha`, label: "فتح الفاتورة" };
  if (event.kind === "order") return { href: `/admin/invoice/${event.id}`, label: "فتح الفاتورة" };
  return null;
}

type ButtonLook = Pick<ButtonProps, "variant" | "size">;

export function CalendarEventOpenButton({ event, canViewInvoices, variant, size }: { event: Pick<BookingCalendarEvent, "kind" | "id">; canViewInvoices: boolean } & ButtonLook) {
  const target = calendarEventTarget(event);
  if (!target) return <Button type="button" variant={variant} size={size} disabled>الطلب غير متاح</Button>;
  if (event.kind !== "kosha" && !canViewInvoices) {
    return <Button type="button" variant={variant} size={size} disabled title="صلاحية الفواتير مطلوبة">صلاحية الفواتير مطلوبة</Button>;
  }
  return <Button asChild variant={variant} size={size} className="gap-2">
    <a href={target.href}><ExternalLink className="w-4 h-4" /> {target.label}</a>
  </Button>;
}

export function CalendarServiceOrderButton({ event, variant, size }: { event: Pick<BookingCalendarEvent, "kind" | "id"> } & ButtonLook) {
  if (event.kind !== "service" || !Number.isSafeInteger(event.id) || event.id <= 0) return null;
  return <Button asChild variant={variant} size={size} className="gap-2">
    <a href={`/admin/orders?serviceOrder=${event.id}`}><ExternalLink className="w-4 h-4" /> فتح الطلب في الطلبات</a>
  </Button>;
}

const DEPARTMENT_STYLES: Record<string, { Icon: LucideIcon; tone: string }> = {
  kosha: { Icon: Crown, tone: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200" },
  photography: { Icon: Camera, tone: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200" },
  sound: { Icon: Music, tone: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" },
  transportation: { Icon: Truck, tone: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200" },
  graduation: { Icon: GraduationCap, tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" },
  gifts: { Icon: Gift, tone: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-200" },
  flowers: { Icon: Flower2, tone: "bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-200" },
  catering: { Icon: UtensilsCrossed, tone: "bg-orange-100 text-orange-900 dark:bg-orange-500/15 dark:text-orange-200" },
  led: { Icon: MonitorPlay, tone: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200" },
  decorations: { Icon: PartyPopper, tone: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-200" },
  rental: { Icon: PackageOpen, tone: "bg-slate-200 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200" },
};
const departmentStyle = (key: string) => DEPARTMENT_STYLES[key] ?? { Icon: PartyPopper, tone: "bg-muted text-foreground" };

const STATUS_STYLES: Record<BookingStatusTone, { dot: string; text: string }> = {
  confirmed: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
  pending: { dot: "bg-orange-500", text: "text-orange-700 dark:text-orange-300" },
  preparing: { dot: "bg-blue-500", text: "text-blue-700 dark:text-blue-300" },
  done: { dot: "bg-slate-500", text: "text-slate-600 dark:text-slate-300" },
  cancelled: { dot: "bg-slate-300 dark:bg-slate-600", text: "text-slate-500 dark:text-slate-400" },
  neutral: { dot: "bg-slate-400", text: "text-muted-foreground" },
};

function StatusLabel({ status }: { status: string }) {
  const style = STATUS_STYLES[bookingStatusTone(status)];
  return <span className={`inline-flex min-w-0 items-center gap-1 text-xs font-medium ${style.text}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden /><span className="truncate">{bookingStatusLabel(status)}</span></span>;
}

const control = "h-9 min-w-0 rounded-lg border border-border/50 bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CARD_LIMIT = 6;

// ── Counters ──────────────────────────────────────────────────────────────
function CounterRow({ row, activeDepartment, hiddenUntilWide }: { row: DepartmentCount; activeDepartment: string; hiddenUntilWide?: boolean }) {
  const { Icon, tone } = departmentStyle(row.key);
  const dimmed = activeDepartment && activeDepartment !== row.key;
  return (
    <li title={`${row.label}: ${bookingCountLabel(row.bookings)}`} className={`${hiddenUntilWide ? "hidden 2xl:flex" : "flex"} min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium ${tone} ${dimmed ? "opacity-40" : ""} ${activeDepartment === row.key ? "ring-1 ring-current" : ""}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{row.short}</span>
      <span className="font-bold tabular-nums">{row.bookings}</span>
    </li>
  );
}

function DepartmentCounters({ summary, activeDepartment, limit = 4 }: { summary: DaySummary; activeDepartment: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const rows = summary.departments;
  if (!rows.length) return null;
  const extra = rows.length - limit;
  return (
    <div>
      <ul className="space-y-1" aria-label="عدد الحجوزات حسب القسم">
        {rows.map((row, index) => <CounterRow key={row.key} row={row} activeDepartment={activeDepartment} hiddenUntilWide={!expanded && index >= limit} />)}
      </ul>
      {extra > 0 ? (
        <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="mt-1 w-full rounded-md px-1.5 py-1 text-start text-xs font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring 2xl:hidden">
          {expanded ? "إخفاء باقي الأقسام" : `+ باقي الأقسام (${extra})`}
        </button>
      ) : null}
    </div>
  );
}

function DepartmentChips({ rows, activeDepartment, onToggle }: { rows: readonly DepartmentCount[]; activeDepartment: string; onToggle: (key: string) => void }) {
  return (
    <>
      {rows.map((row) => {
        const { Icon, tone } = departmentStyle(row.key);
        const active = activeDepartment === row.key;
        return (
          <button key={row.key} type="button" aria-pressed={active} onClick={() => onToggle(row.key)} title={active ? "إلغاء تصفية القسم" : `عرض حجوزات ${row.label} فقط`}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone} ${activeDepartment && !active ? "opacity-50" : ""} ${active ? "ring-1 ring-current" : ""}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden />{row.label} <span className="font-bold tabular-nums">{row.bookings}</span>
          </button>
        );
      })}
    </>
  );
}

// ── Booking card ──────────────────────────────────────────────────────────
function BookingCard({ event, conflict }: { event: BookingCalendarEvent; conflict: boolean }) {
  return (
    <article className="relative min-w-0 rounded-lg border border-border/50 bg-background p-2 transition-colors duration-150 hover:border-primary/40">
      <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5">
        <span className="text-xs font-semibold tabular-nums text-foreground">{formatEventTime(event)}</span>
        {conflict ? <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-500/15 dark:text-rose-200">تعارض</span> : null}
      </div>
      <h3 className="mt-1 line-clamp-2 break-words text-sm font-bold leading-snug text-foreground">
        {event.detailHref
          ? <Link href={event.detailHref} className="rounded after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring">{event.customerName || "بدون اسم"}</Link>
          : event.customerName || "بدون اسم"}
      </h3>
      <p className="mt-0.5 line-clamp-2 text-xs text-foreground/80">{eventServicesLabel(event)}</p>
      {event.location ? <p className="mt-0.5 truncate text-xs text-muted-foreground" title={event.location}>{event.location}</p> : null}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        <StatusLabel status={event.status} />
        <bdi dir="ltr" className="truncate text-xs tabular-nums text-muted-foreground">{event.number}</bdi>
      </div>
      {event.workspaceHref ? (
        <Link href={event.workspaceHref} className="relative z-10 mt-1 inline-flex items-center gap-1 rounded text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Wrench className="h-3 w-3" aria-hidden /> فتح مساحة العمل
        </Link>
      ) : null}
    </article>
  );
}

// ── Week ──────────────────────────────────────────────────────────────────
type BoardProps = {
  days: string[];
  today: string;
  cardsByDay: Map<string, BookingCalendarEvent[]>;
  summaries: Map<string, DaySummary>;
  department: string;
  conflictKeys: Set<string>;
  onOpenDay: (day: string) => void;
};

const emptySummary = (day: string): DaySummary => ({ day, total: 0, departments: [], storeOrders: 0, staffAssignments: 0 });

function DayCards({ day, summary, cards, conflictKeys, onOpenDay, limit }: { day: string; summary: DaySummary; cards: BookingCalendarEvent[]; conflictKeys: Set<string>; onOpenDay: (day: string) => void; limit?: number }) {
  if (!cards.length) return <p className="py-2 text-center text-xs text-muted-foreground">{summary.total ? "لا بطاقات مطابقة للتصفية" : "لا حجوزات"}</p>;
  const shown = limit ? cards.slice(0, limit) : cards;
  return (
    <div className="space-y-1.5">
      {shown.map((event) => <BookingCard key={event.key} event={event} conflict={conflictKeys.has(event.key)} />)}
      {cards.length > shown.length ? (
        <button type="button" onClick={() => onOpenDay(day)} className="w-full rounded-md py-1.5 text-center text-xs font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          + {cards.length - shown.length} أخرى
        </button>
      ) : null}
    </div>
  );
}

function WeekBoard({ days, today, cardsByDay, summaries, department, conflictKeys, onOpenDay }: BoardProps) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border/40 bg-card shadow-sm">
      <div className="grid min-w-[1000px] grid-cols-7">
        {days.map((day) => {
          const summary = summaries.get(day) ?? emptySummary(day);
          const isToday = day === today;
          return (
            <section key={day} aria-label={formatLongDay(day)} className={`min-w-0 border-s border-border/40 first:border-s-0 ${isToday ? "bg-primary/[0.04]" : ""}`}>
              <button type="button" onClick={() => onOpenDay(day)} title="عرض حجوزات اليوم" className="w-full px-2.5 pb-1.5 pt-2.5 text-start transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <span className="flex items-center justify-between gap-1">
                  <span className={`text-sm font-bold ${isToday ? "text-primary" : "text-foreground"}`}>{formatWeekday(day)}</span>
                  {isToday ? <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">اليوم</span> : null}
                </span>
                <span className="block text-xs text-muted-foreground">{formatDayMonth(day)}</span>
                <span className="mt-1 block text-xs font-semibold text-foreground">{bookingCountLabel(summary.total)}</span>
              </button>
              <div className="px-2 pb-2"><DepartmentCounters summary={summary} activeDepartment={department} /></div>
              <div className="border-t border-border/30 p-2">
                <DayCards day={day} summary={summary} cards={cardsByDay.get(day) ?? []} conflictKeys={conflictKeys} onOpenDay={onOpenDay} limit={CARD_LIMIT} />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function MobileWeek({ days, today, cardsByDay, summaries, department, conflictKeys, onOpenDay, selected, onSelect }: BoardProps & { selected: string; onSelect: (day: string) => void }) {
  const summary = summaries.get(selected) ?? emptySummary(selected);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-1 rounded-2xl border border-border/40 bg-card p-1.5 shadow-sm" role="tablist" aria-label="أيام الأسبوع">
        {days.map((day) => {
          const active = day === selected;
          const total = summaries.get(day)?.total ?? 0;
          return (
            <button key={day} type="button" role="tab" aria-selected={active} aria-label={`${formatLongDay(day)}: ${bookingCountLabel(total)}`} onClick={() => onSelect(day)}
              className={`flex min-w-0 flex-col items-center gap-0.5 rounded-xl py-1.5 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-primary text-primary-foreground" : day === today ? "bg-primary/10 text-primary" : "text-foreground"}`}>
              <span aria-hidden>{formatWeekdayNarrow(day)}</span>
              <span className="text-sm font-bold tabular-nums" aria-hidden>{Number(day.slice(8))}</span>
              <span className={`tabular-nums ${active ? "" : "text-muted-foreground"}`} aria-hidden>{total}</span>
            </button>
          );
        })}
      </div>
      <section className="rounded-2xl border border-border/40 bg-card p-3 shadow-sm" aria-label={formatLongDay(selected)}>
        <button type="button" onClick={() => onOpenDay(selected)} className="mb-2 flex w-full items-center justify-between gap-2 rounded text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="text-sm font-bold text-foreground">{formatLongDay(selected)}</span>
          <span className="text-xs font-semibold text-foreground">{bookingCountLabel(summary.total)}</span>
        </button>
        <div className="mb-3"><DepartmentCounters summary={summary} activeDepartment={department} limit={summary.departments.length} /></div>
        <DayCards day={selected} summary={summary} cards={cardsByDay.get(selected) ?? []} conflictKeys={conflictKeys} onOpenDay={onOpenDay} />
      </section>
    </div>
  );
}

// ── Day ───────────────────────────────────────────────────────────────────
const hourOf = (time: string) => Number(time.slice(0, 2));

function DayTimeline({ day, cards, summary, conflictKeys, onOpenDay }: { day: string; cards: BookingCalendarEvent[]; summary: DaySummary; conflictKeys: Set<string>; onOpenDay: (day: string) => void }) {
  if (!cards.length) return <div className="rounded-2xl border border-border/40 bg-card shadow-sm"><EmptyState message={summary.total ? "لا حجوزات مطابقة للتصفية في هذا اليوم" : "لا توجد حجوزات في هذا اليوم"} /></div>;
  const timed = cards.filter((event) => event.startTime);
  const untimed = cards.filter((event) => !event.startTime);
  const firstHour = Math.min(8, ...timed.map((event) => hourOf(event.startTime!)));
  const lastHour = Math.max(23, ...timed.map((event) => hourOf(event.startTime!)));
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index);
  const row = (label: string, items: BookingCalendarEvent[]) => (
    <div key={label} className="flex gap-3 border-t border-border/30 px-3 py-1.5 first:border-t-0">
      <span className="w-14 shrink-0 pt-1 text-xs font-medium tabular-nums text-muted-foreground">{label}</span>
      {items.length ? (
        <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((event) => <BookingCard key={event.key} event={event} conflict={conflictKeys.has(event.key)} />)}
        </div>
      ) : <span className="min-h-5 flex-1" />}
    </div>
  );
  return (
    <section aria-label={`الجدول الزمني ليوم ${formatLongDay(day)}`} className="rounded-2xl border border-border/40 bg-card shadow-sm">
      <button type="button" onClick={() => onOpenDay(day)} className="flex w-full items-center justify-between gap-2 rounded-t-2xl border-b border-border/40 px-3 py-2 text-start hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className="text-sm font-bold text-foreground">{formatLongDay(day)}</span>
        <span className="text-xs font-semibold text-foreground">{bookingCountLabel(summary.total)}</span>
      </button>
      {untimed.length ? row("بدون وقت", untimed) : null}
      {hours.map((hour) => row(`${String(hour).padStart(2, "0")}:00`, timed.filter((event) => hourOf(event.startTime!) === hour)))}
    </section>
  );
}

// ── Month ─────────────────────────────────────────────────────────────────
function MonthBoard({ days, anchor, today, summaries, department, onOpenDay }: { days: string[]; anchor: string; today: string; summaries: Map<string, DaySummary>; department: string; onOpenDay: (day: string) => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/40 bg-card shadow-sm">
      <div className="grid grid-cols-7 border-b border-border/40" aria-hidden>
        {days.slice(0, 7).map((day) => (
          <div key={day} className="px-1 py-2 text-center text-xs font-semibold text-muted-foreground"><span className="hidden md:inline">{formatWeekday(day)}</span><span className="md:hidden">{formatWeekdayNarrow(day)}</span></div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const summary = summaries.get(day) ?? emptySummary(day);
          const shown = summary.departments.slice(0, 3);
          const outside = !isSameCalendarMonth(day, anchor);
          return (
            <button key={day} type="button" onClick={() => onOpenDay(day)} aria-label={`${formatLongDay(day)}: ${bookingCountLabel(summary.total)}${summary.departments.length ? `، ${summary.departments.map((row) => `${row.label} ${row.bookings}`).join("، ")}` : ""}`}
              className={`flex min-h-16 min-w-0 flex-col gap-1 border-b border-s border-border/30 p-1.5 text-start transition-colors duration-150 first:border-s-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-28 md:p-2 ${outside ? "bg-muted/20 opacity-60" : ""} ${day === today ? "bg-primary/[0.05]" : ""}`}>
              <span className="flex flex-wrap items-center justify-between gap-x-1">
                <span className={`text-sm font-bold tabular-nums ${day === today ? "grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground" : "text-foreground"}`}>{Number(day.slice(8))}</span>
                {summary.total ? <span className="text-xs font-semibold text-foreground"><span className="hidden md:inline">{bookingCountLabel(summary.total)}</span><span className="tabular-nums md:hidden">{summary.total}</span></span> : null}
              </span>
              {shown.length ? (
                <span className="hidden flex-wrap gap-1 md:flex">
                  {shown.map((row) => {
                    const { Icon, tone } = departmentStyle(row.key);
                    return <span key={row.key} title={`${row.label}: ${row.bookings}`} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${tone} ${department && department !== row.key ? "opacity-40" : ""}`}><Icon className="h-3 w-3" aria-hidden />{row.bookings}</span>;
                  })}
                  {summary.departments.length > 3 ? <span title={summary.departments.slice(3).map((row) => `${row.label}: ${row.bookings}`).join("، ")} className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">+{summary.departments.length - 3}</span> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Day panel ─────────────────────────────────────────────────────────────
function DayPanel({ day, summary, cards, filterNote, canViewInvoices, onClose, onPrint }: { day: string | null; summary: DaySummary | null; cards: BookingCalendarEvent[]; filterNote: string | null; canViewInvoices: boolean; onClose: () => void; onPrint: (day: string) => void }) {
  return (
    <Sheet open={day != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="left" dir="rtl" className="w-full overflow-y-auto sm:max-w-md">
        {day && summary ? (
          <>
            <SheetHeader>
              <SheetTitle>حجوزات يوم {formatLongDay(day)}</SheetTitle>
              <SheetDescription>إجمالي الحجوزات: {summary.total}</SheetDescription>
            </SheetHeader>
            {summary.departments.length ? (
              <dl className="mt-4 divide-y divide-border/30 rounded-xl border border-border/40">
                {summary.departments.map((row) => {
                  const { Icon, tone } = departmentStyle(row.key);
                  return (
                    <div key={row.key} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <dt className="flex min-w-0 items-center gap-2"><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${tone}`}><Icon className="h-3.5 w-3.5" aria-hidden /></span><span className="truncate">{row.label}</span></dt>
                      <dd className="shrink-0 text-end font-semibold">{bookingCountLabel(row.bookings)}{row.units !== row.bookings ? <span className="ms-1 text-xs font-normal text-muted-foreground">(وحدات الخدمة: {row.units})</span> : null}</dd>
                    </div>
                  );
                })}
              </dl>
            ) : null}
            {summary.staffAssignments || summary.storeOrders ? (
              <div className="mt-3 rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">عمليات اليوم (ليست حجوزات)</p>
                {summary.staffAssignments ? <p className="mt-0.5">تعيينات الموظفين: {summary.staffAssignments}</p> : null}
                {summary.storeOrders ? <p className="mt-0.5">طلبات المتجر: {summary.storeOrders}</p> : null}
              </div>
            ) : null}
            <div className="mt-4 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold">الحجوزات</h3>
              <Button type="button" variant="outline" size="sm" onClick={() => onPrint(day)}><Printer className="h-4 w-4" /> طباعة جدول اليوم</Button>
            </div>
            {filterNote ? <p className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{filterNote}</p> : null}
            {!cards.length ? <p className="py-8 text-center text-sm text-muted-foreground">{summary.total ? "لا حجوزات مطابقة للتصفية" : "لا توجد حجوزات في هذا اليوم"}</p> : (
              <ul className="mt-2 space-y-2">
                {cards.map((event) => (
                  <li key={event.key} className="rounded-xl border border-border/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{event.customerName || "بدون اسم"}</p>
                        <p className="mt-0.5 text-xs text-foreground/80">{eventServicesLabel(event)}</p>
                      </div>
                      <StatusLabel status={event.status} />
                    </div>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span className="tabular-nums">{formatEventTime(event)}</span><bdi dir="ltr" className="tabular-nums">{event.number}</bdi>{event.location ? <span>{event.location}</span> : null}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {event.detailHref ? <Button asChild size="sm"><Link href={event.detailHref} onClick={onClose}>فتح الحجز</Link></Button> : null}
                      {event.workspaceHref ? <Button asChild size="sm" variant="outline"><Link href={event.workspaceHref} onClick={onClose}>فتح مساحة العمل</Link></Button> : null}
                      {event.kind === "service" || event.kind === "kosha" || event.kind === "order" ? <CalendarEventOpenButton event={event} canViewInvoices={canViewInvoices} variant="ghost" size="sm" /> : null}
                      <CalendarServiceOrderButton event={event} variant="ghost" size="sm" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "day", label: "يومي" },
  { value: "week", label: "أسبوعي" },
  { value: "month", label: "شهري" },
];

/** Returning from a booking restores the same period and filters. */
function readUrlState() {
  const query = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const view = query.get("view");
  const date = query.get("date");
  const department = query.get("department");
  return {
    view: (view === "day" || view === "month" ? view : "week") as CalendarView,
    anchor: isCalendarDay(date) ? date : baghdadDay(),
    department: isBookingDepartment(department) ? department : "",
    status: query.get("status") ?? "",
    employee: Number(query.get("employee")) > 0 ? Number(query.get("employee")) : null,
    search: query.get("q") ?? "",
    showStoreOrders: query.get("store") === "1",
  };
}

const calendarKey = (from: string, to: string) => ["admin", "calendar", from, to] as const;
const fetchCalendar = (from: string, to: string) => adminFetch<CalendarResponse>(`/admin/calendar?${new URLSearchParams({ from, to })}`);

export default function CalendarPage({ canViewInvoices }: { canViewInvoices: boolean }) {
  const [initial] = useState(readUrlState);
  const [view, setView] = useState<CalendarView>(initial.view);
  const [anchor, setAnchor] = useState(initial.anchor);
  const [department, setDepartment] = useState(initial.department);
  const [status, setStatus] = useState(initial.status);
  const [employee, setEmployee] = useState<number | null>(initial.employee);
  const [search, setSearch] = useState(initial.search);
  const [showStoreOrders, setShowStoreOrders] = useState(initial.showStoreOrders);
  const [panelDay, setPanelDay] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const today = baghdadDay();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (key: string, value: string | null) => { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); };
    set("view", view === "week" ? null : view);
    set("date", anchor === today ? null : anchor);
    set("department", department || null);
    set("status", status || null);
    set("employee", employee ? String(employee) : null);
    set("q", search.trim() || null);
    set("store", showStoreOrders ? "1" : null);
    window.history.replaceState(window.history.state, "", url);
  }, [view, anchor, today, department, status, employee, search, showStoreOrders]);

  const days = useMemo(() => calendarViewDays(view, anchor), [view, anchor]);
  const from = days[0];
  const to = days[days.length - 1];
  // Bookings change on other screens: always re-read when coming back.
  const { data, isLoading, isError, error, refetch } = useQuery<CalendarResponse>({
    queryKey: calendarKey(from, to),
    queryFn: () => fetchCalendar(from, to),
    staleTime: 30_000,
    refetchOnMount: "always",
    placeholderData: keepPreviousData,
  });
  const showingOtherRange = Boolean(data && (data.range.from !== from || data.range.to !== to));
  const events = useMemo(() => data?.events ?? [], [data?.events]);

  const filters: CalendarCardFilters = useMemo(() => ({ status, department, employee, search, showStoreOrders }), [status, department, employee, search, showStoreOrders]);
  const summaries = useMemo(() => new Map(days.map((day) => [day, summarizeCalendarDay(day, events, status)])), [days, events, status]);
  const cardsByDay = useMemo(() => {
    const cards = new Map<string, BookingCalendarEvent[]>();
    for (const event of filterCalendarCards(events, filters)) cards.set(event.day, [...(cards.get(event.day) ?? []), event]);
    return cards;
  }, [events, filters]);
  const summaryDays = useMemo(() => (view === "month" ? days.filter((day) => isSameCalendarMonth(day, anchor)) : days), [view, days, anchor]);
  const rangeSummary = useMemo(() => summarizeCalendarRange(summaryDays, events, status), [summaryDays, events, status]);
  const visibleBookings = useMemo(() => summaryDays.reduce((sum, day) => sum + (cardsByDay.get(day) ?? []).filter((event) => event.countsAsBooking).length, 0), [summaryDays, cardsByDay]);
  const conflicts = useMemo(() => calendarConflicts(events), [events]);
  const conflictKeys = useMemo(() => new Set(conflicts.flatMap((group) => group.events.map((event) => event.key))), [conflicts]);
  const statusOptions = useMemo(() => {
    const options = calendarStatusOptions(events);
    return status && !options.includes(status) ? [status, ...options] : options;
  }, [events, status]);
  const staffOptions = useMemo(() => {
    const options = calendarStaffOptions(events);
    return employee && !options.some((member) => member.id === employee) ? [{ id: employee, name: `موظف #${employee}` }, ...options] : options;
  }, [events, employee]);

  const mobileDay = days.includes(anchor) ? anchor : days[0];
  const cardFiltersActive = Boolean(department || employee || search.trim());
  const anyFilter = cardFiltersActive || Boolean(status) || showStoreOrders;
  const activeFilterCount = [department, status, employee, showStoreOrders].filter(Boolean).length;
  const filterNote = [
    status ? `الأعداد والبطاقات حسب الحالة: ${status}.` : null,
    department ? `البطاقات تعرض ${bookingDepartment(department)?.label ?? ""} فقط؛ الأعداد تبقى لكل الأقسام.` : null,
    (employee || search.trim()) ? "البطاقات مصفّاة بالبحث أو الموظف؛ الأعداد تبقى لكامل اليوم." : null,
  ].filter(Boolean).join(" ") || null;
  const resetFilters = () => { setDepartment(""); setStatus(""); setEmployee(null); setSearch(""); setShowStoreOrders(false); };
  const toggleDepartment = (key: string) => setDepartment((current) => (current === key ? "" : key));

  const printSchedule = async (scope: "day" | "week", day: string) => {
    setPrinting(true);
    try {
      const printDays = scope === "day" ? [day] : calendarViewDays("week", day);
      const first = printDays[0];
      const last = printDays[printDays.length - 1];
      const result = await queryClient.fetchQuery({ queryKey: calendarKey(first, last), queryFn: () => fetchCalendar(first, last), staleTime: 0 });
      printStandaloneDocument(buildBookingSchedulePrintHtml({
        title: scope === "day" ? `جدول حجوزات يوم ${formatLongDay(day)}` : "جدول حجوزات الأسبوع",
        rangeLabel: formatCalendarRange(scope, day),
        days: printDays,
        events: result.events,
        filters,
        filterNote,
        generatedAt: new Date().toLocaleString("ar-EG-u-nu-latn", { timeZone: "Asia/Baghdad", dateStyle: "medium", timeStyle: "short" }),
      }));
    } catch (cause) {
      toast({ title: "تعذرت طباعة الجدول", description: apiErrorMessage(cause), variant: "destructive" });
    } finally {
      setPrinting(false);
    }
  };

  const boardProps: BoardProps = { days, today, cardsByDay, summaries, department, conflictKeys, onOpenDay: setPanelDay };
  const panelSummary = panelDay ? summarizeCalendarDay(panelDay, events, status) : null;
  const rangeTitle = view === "day" ? "إجمالي اليوم" : view === "week" ? "إجمالي الأسبوع" : `إجمالي ${formatMonthYear(anchor)}`;

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">تقويم الحجوزات</h1>
          <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">عدد حجوزات كل قسم في كل يوم، من سجلات الحجز الفعلية.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu dir="rtl">
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={printing}>{printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} طباعة</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void printSchedule("day", anchor)}>طباعة جدول اليوم ({formatDayMonth(anchor)})</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void printSchedule("week", anchor)}>طباعة جدول الأسبوع</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="inline-flex rounded-lg border border-border/40 bg-card p-1" role="group" aria-label="طريقة العرض">
            {VIEWS.map((item) => (
              <button key={item.value} type="button" aria-pressed={view === item.value} onClick={() => setView(item.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === item.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-2xl border border-border/40 bg-card p-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="السابق" onClick={() => setAnchor((current) => shiftCalendarAnchor(view, current, -1))}><ChevronRight className="h-4 w-4" /></Button>
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setAnchor(today)}>اليوم</Button>
            <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="التالي" onClick={() => setAnchor((current) => shiftCalendarAnchor(view, current, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          </div>
          <DateField type="date" aria-label="اختيار التاريخ" value={anchor} onChange={(event) => { if (isCalendarDay(event.target.value)) setAnchor(event.target.value); }} className={`${control} w-52`} />
          <span className="min-w-0 text-sm font-semibold text-foreground">{formatCalendarRange(view, anchor)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1 basis-48">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="بحث في الحجوزات" placeholder="العميل، رقم الحجز، أو الهاتف" className="h-9 pr-8" />
          </div>
          <Button type="button" variant="outline" size="sm" className="h-9 md:hidden" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>
            <SlidersHorizontal className="h-4 w-4" /> تصفية{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </Button>
          <div className={`${filtersOpen ? "flex" : "hidden"} w-full flex-wrap items-center gap-2 md:contents`}>
          <select aria-label="القسم" value={department} onChange={(event) => setDepartment(event.target.value)} className={`${control} basis-36`}>
            <option value="">كل الأقسام</option>
            {BOOKING_DEPARTMENTS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <select aria-label="الحالة" title="الملغي لا يُحسب إلا عند اختياره" value={status} onChange={(event) => setStatus(event.target.value)} className={`${control} basis-32`}>
            <option value="">كل الحالات</option>
            {statusOptions.map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
          <select aria-label="الموظف" value={employee ?? ""} onChange={(event) => setEmployee(Number(event.target.value) || null)} className={`${control} basis-32`}>
            <option value="">كل الموظفين</option>
            {staffOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
          <Button type="button" variant={showStoreOrders ? "default" : "outline"} size="sm" className="h-9" aria-pressed={showStoreOrders} onClick={() => setShowStoreOrders((value) => !value)}>
            <Store className="h-4 w-4" /> طلبات المتجر{rangeSummary.storeOrders ? ` (${rangeSummary.storeOrders})` : ""}
          </Button>
          {anyFilter ? <Button type="button" variant="ghost" size="sm" className="h-9" onClick={resetFilters}><RotateCcw className="h-4 w-4" /> إعادة التصفية</Button> : null}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-2 md:grid-cols-7">{Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-56 rounded-xl" />)}</div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center" role="alert">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <h2 className="font-semibold text-foreground">تعذر تحميل تقويم الحجوزات</h2>
          <p className="mt-2 text-sm text-muted-foreground">{apiErrorMessage(error, "تعذر الاتصال بسجل الحجوزات")}</p>
          {error instanceof AjNApiError && error.requestId ? <p className="mt-1 text-xs text-muted-foreground" dir="ltr">{error.requestId}</p> : null}
          <Button type="button" variant="outline" className="mt-4" onClick={() => void refetch()}>إعادة المحاولة</Button>
        </div>
      ) : (
        <div className={`space-y-3 transition-opacity duration-150 ${showingOtherRange ? "pointer-events-none opacity-50" : ""}`} aria-busy={showingOtherRange}>
          <div className="flex flex-col gap-1.5 md:flex-row md:flex-wrap md:items-center">
            <span className="me-1 text-sm font-bold text-foreground">{rangeTitle}: {bookingCountLabel(rangeSummary.total)}</span>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto overscroll-x-contain px-1 pb-1 md:contents">
              <DepartmentChips rows={rangeSummary.departments} activeDepartment={department} onToggle={toggleDepartment} />
            </div>
          </div>
          {filterNote ? <p className="rounded-lg bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">{filterNote}{cardFiltersActive ? ` يعرض ${bookingCountLabel(visibleBookings)} من ${rangeSummary.total}.` : ""}</p> : null}
          {data?.truncated ? <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">عدد السجلات في هذه الفترة أكبر من حد العرض؛ قد لا تظهر كل الحجوزات. اختر فترة أقصر.</p> : null}
          {conflicts.length ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-rose-300/60 bg-rose-50 px-3 py-1.5 text-xs dark:border-rose-500/30 dark:bg-rose-500/10">
              <span className="inline-flex items-center gap-1 font-semibold text-rose-800 dark:text-rose-200"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> تعارضات محتملة: {conflicts.length}</span>
              {conflicts.slice(0, 3).map((group) => (
                <button key={group.key} type="button" onClick={() => setPanelDay(group.events[0].day)} className="rounded px-1 text-rose-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-rose-200">
                  {formatDayMonth(group.events[0].day)}: {group.events.map((event) => event.customerName).join("، ")}
                </button>
              ))}
            </div>
          ) : null}

          {view === "month" ? <MonthBoard days={days} anchor={anchor} today={today} summaries={summaries} department={department} onOpenDay={setPanelDay} /> : null}
          {view === "day" ? <DayTimeline day={anchor} cards={cardsByDay.get(anchor) ?? []} summary={summaries.get(anchor) ?? emptySummary(anchor)} conflictKeys={conflictKeys} onOpenDay={setPanelDay} /> : null}
          {view === "week" && isMobile ? <MobileWeek {...boardProps} selected={mobileDay} onSelect={setAnchor} /> : null}
          {view === "week" && !isMobile ? <WeekBoard {...boardProps} /> : null}
        </div>
      )}

      <DayPanel
        day={panelDay}
        summary={panelSummary}
        cards={panelDay ? cardsByDay.get(panelDay) ?? [] : []}
        filterNote={filterNote}
        canViewInvoices={canViewInvoices}
        onClose={() => setPanelDay(null)}
        onPrint={(day) => void printSchedule("day", day)}
      />
    </div>
  );
}
