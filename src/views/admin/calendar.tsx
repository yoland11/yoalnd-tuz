import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Clock, ExternalLink, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type CalendarEvent = {
  id: number;
  kind: "service" | "order";
  title: string;
  customerName: string;
  trackingCode: string | null;
  status: string;
  serviceId?: number;
  serviceType?: string | null;
  crewName?: string;
  date: string;
  location: string;
};

type Service = { id: number; nameAr: string; name: string };

const STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار",
  confirmed: "مؤكد",
  processing: "قيد التجهيز",
  shipped: "في الطريق",
  delivered: "تم التوصيل",
  completed: "مكتمل",
  cancelled: "ملغي",
  reschedule_pending: "تغيير موعد",
};

const STATUS_TONES: Record<string, string> = {
  pending: "border-status-warning/30 bg-status-warning/10 text-status-warning",
  confirmed: "border-primary/30 bg-primary/10 text-primary",
  processing: "border-accent/30 bg-accent/10 text-accent",
  completed: "border-status-success/30 bg-status-success/10 text-status-success",
  delivered: "border-status-success/30 bg-status-success/10 text-status-success",
  cancelled: "border-status-danger/30 bg-status-danger/10 text-status-danger",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function conflictKey(event: CalendarEvent) {
  if (event.kind !== "service" || ["cancelled", "completed", "delivered"].includes(event.status)) return "";
  const dateKey = (event.date ?? "").slice(0, 16) || (event.date ?? "").slice(0, 10);
  const resource = (event.crewName || event.location || `service-${event.serviceId ?? "general"}`).trim();
  return dateKey && resource ? `${dateKey}::${resource}` : "";
}

export default function CalendarPage() {
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [from, setFrom] = useState(todayIso());
  const [serviceId, setServiceId] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<CalendarEvent | null>(null);

  const to = useMemo(() => {
    if (view === "day") return from;
    if (view === "month") return addDays(from, 30);
    return addDays(from, 7);
  }, [from, view]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ from, to });
    if (serviceId) params.set("serviceId", serviceId);
    if (status) params.set("status", status);
    return params.toString();
  }, [from, serviceId, status, to]);

  const { data, isLoading } = useQuery<{ events: CalendarEvent[]; services: Service[] }>({
    queryKey: ["admin", "calendar", queryString],
    queryFn: () => adminFetch(`/admin/calendar?${queryString}`),
    staleTime: 30_000,
  });

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of data?.events ?? []) {
      const key = (event.date ?? "").slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [data?.events]);

  const conflicts = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of data?.events ?? []) {
      const key = conflictKey(event);
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return Array.from(map.entries())
      .filter(([, events]) => events.length > 1)
      .map(([key, events]) => ({ key, events }));
  }, [data?.events]);
  const conflictIds = useMemo(() => new Set(conflicts.flatMap((item) => item.events.map((event) => `${event.kind}-${event.id}`))), [conflicts]);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">تقويم الحجوزات</h1>
          <p className="text-sm text-muted-foreground mt-1">عرض يومي وأسبوعي وشهري للحجوزات والطلبات القريبة.</p>
        </div>
        <div className="inline-flex rounded-lg border border-border/30 bg-card p-1">
          {(["day", "week", "month"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setView(item)}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${view === item ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item === "day" ? "يومي" : item === "week" ? "أسبوعي" : "شهري"}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border/30 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value || todayIso())} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
            <option value="">كل الخدمات</option>
            {(data?.services ?? []).map((service) => <option key={service.id} value={service.id}>{service.nameAr || service.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
            <option value="">كل الحالات</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Button type="button" variant="outline" onClick={() => { setServiceId(""); setStatus(""); }} className="gap-2 md:col-span-2">
            <Filter className="w-4 h-4" /> إعادة التصفية
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-28 rounded-xl" />)}</div>
      ) : grouped.length === 0 ? (
        <EmptyState message="لا توجد حجوزات ضمن الفترة" />
      ) : (
        <div className="space-y-3">
          {conflicts.length > 0 && (
            <div className="rounded-xl border border-status-warning/30 bg-status-warning/10 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-status-warning">
                <AlertTriangle className="h-4 w-4" />
                تنبيهات تعارض محتملة
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {conflicts.slice(0, 4).map(({ key, events }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelected(events[0])}
                    className="rounded-lg border border-status-warning/25 bg-background/45 px-3 py-2 text-right text-xs text-foreground transition-colors hover:border-status-warning/60"
                  >
                    <p className="font-semibold">{events.length} حجوزات بنفس المورد/الموعد</p>
                    <p className="mt-1 truncate text-muted-foreground">{events.map((event) => event.customerName).join("، ")}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
          {grouped.map(([day, events]) => (
            <div key={day} className="bg-card rounded-xl border border-border/30 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                <CalendarDays className="w-4 h-4 text-primary" />
                {new Date(`${day}T00:00:00`).toLocaleDateString("ar-IQ", { weekday: "long", month: "long", day: "numeric" })}
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {events.map((event) => (
                  <button
                    key={`${event.kind}-${event.id}`}
                    type="button"
                    onClick={() => setSelected(event)}
                    className={`text-right rounded-xl border p-3 transition-colors hover:border-primary/40 ${STATUS_TONES[event.status] ?? "border-border/30 bg-background/50 text-foreground"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm">{event.title}</p>
                      {conflictIds.has(`${event.kind}-${event.id}`) && (
                        <span className="rounded-full border border-status-warning/30 bg-status-warning/10 px-2 py-0.5 text-[11px] text-status-warning">تعارض</span>
                      )}
                    </div>
                    <p className="text-xs opacity-80 mt-1">{event.customerName}</p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] opacity-80">
                      <span>{STATUS_LABELS[event.status] ?? event.status}</span>
                      <span className="font-mono">{event.trackingCode ?? `#${event.id}`}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="w-full max-w-md bg-card rounded-2xl border border-border/40 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-foreground">{selected.title}</h2>
                <p className="text-sm text-muted-foreground mt-1">{selected.customerName}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs ${STATUS_TONES[selected.status] ?? "border-border/30 text-muted-foreground"}`}>
                {STATUS_LABELS[selected.status] ?? selected.status}
              </span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-muted-foreground">
              <p className="flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> {selected.date}</p>
              {selected.crewName && <p>الكادر: {selected.crewName}</p>}
              {selected.location && <p>الموقع: {selected.location}</p>}
              <p>التتبع: <span className="font-mono text-foreground">{selected.trackingCode ?? `#${selected.id}`}</span></p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={() => setSelected(null)}>إغلاق</Button>
              <Button asChild className="gap-2">
                <a href="/admin/orders"><ExternalLink className="w-4 h-4" /> فتح الطلبات</a>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
