import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clapperboard, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch } from "@/views/admin/_lib";
import {
  PRODUCTION_STATUS_LABELS,
  allowedTransitions,
  isOverdue,
  type ProductionStatus,
} from "@/lib/photography-production";
import {
  KindBadge,
  PRODUCTION_API,
  PRODUCTION_QUERY_KEY,
  ProductionItemDialog,
  StatusBadge,
  errorText,
  readableDay,
  useUpdateProductionItem,
  type ProductionBookingRef,
  type ProductionItem,
  type ProductionPermissions,
} from "@/views/admin/photography-production-shared";

/**
 * Staff portal view of the Photography Production Center: only the work
 * assigned to the signed-in employee (enforced by the server), with one-tap
 * status moves. Same endpoints and rules as the admin center.
 */

type MyWork = {
  items: Array<ProductionItem & { booking: ProductionBookingRef }>;
  total: number;
  today: string;
  meId: number;
  permissions: ProductionPermissions;
  summary: { items: { total: number; remaining: number; inProgress: number; waitingFiles: number; completed: number; overdue: number } };
};

const FILTERS = [
  { key: "open", label: "غير المكتملة" },
  { key: "overdue", label: "المتأخرة" },
  { key: "waiting_files", label: "بانتظار الملفات" },
  { key: "completed", label: "المكتملة" },
] as const;

export function ProductionWorkPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("open");
  const [selected, setSelected] = useState<ProductionItem | null>(null);
  const work = useQuery<MyWork>({
    queryKey: [...PRODUCTION_QUERY_KEY, "mine"],
    queryFn: () => adminFetch(`${PRODUCTION_API}/board?mine=1&pageSize=300`),
  });
  const update = useUpdateProductionItem();
  const data = work.data;
  const visible = useMemo(() => {
    const items = data?.items ?? [];
    if (filter === "completed") return items.filter((item) => item.status === "completed");
    if (filter === "waiting_files") return items.filter((item) => item.status === "waiting_files");
    if (filter === "overdue") return items.filter((item) => data && isOverdue(item, data.today));
    return items.filter((item) => item.status !== "completed");
  }, [data, filter]);

  return (
    <div className="space-y-3 p-4" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-bold"><Clapperboard className="h-5 w-5 text-primary" /> أعمال الإنتاج</h1>
        <Button size="sm" variant="ghost" onClick={() => work.refetch()} disabled={work.isFetching} aria-label="تحديث"><RefreshCw className={`h-4 w-4 ${work.isFetching ? "animate-spin" : ""}`} /></Button>
      </div>

      {data ? (
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            ["متبقي", data.summary.items.remaining],
            ["قيد العمل", data.summary.items.inProgress],
            ["متأخر", data.summary.items.overdue],
            ["مكتمل", data.summary.items.completed],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-card p-2">
              <div className="text-xl font-bold tabular-nums">{value}</div>
              <div className="text-[11px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((entry) => (
          <Button key={entry.key} size="sm" variant={filter === entry.key ? "default" : "outline"} className="shrink-0 rounded-full" onClick={() => setFilter(entry.key)} aria-pressed={filter === entry.key}>{entry.label}</Button>
        ))}
      </div>

      {work.isLoading ? (
        <div className="space-y-2"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-28 rounded-xl" /></div>
      ) : work.isError ? (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{errorText(work.error)}</span>
          <Button size="sm" variant="outline" onClick={() => work.refetch()}>إعادة المحاولة</Button>
        </div>
      ) : !visible.length ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">لا توجد أعمال في هذه القائمة.</div>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => {
            const moves = item.status === "completed" ? [] : allowedTransitions(item.status);
            const overdue = data ? isOverdue(item, data.today) : false;
            return (
              <article key={item.id} className={`space-y-2 rounded-xl border bg-card p-3 ${overdue ? "border-rose-300 dark:border-rose-900" : ""}`}>
                <Button type="button" variant="ghost" size="flush" className="h-auto whitespace-normal font-normal leading-normal max-md:min-h-0 block w-full space-y-1 text-start hover:bg-transparent [&_svg]:size-3.5" onClick={() => setSelected(item)}>
                  <div className="flex items-center justify-between gap-2">
                    <KindBadge kind={item.kind} />
                    <StatusBadge status={item.status} dueDate={item.dueDate} today={data!.today} />
                  </div>
                  <div className="font-bold">{item.booking.customerName || "زبون"}</div>
                  <div className="text-xs text-muted-foreground"><span className="font-mono" dir="ltr">{item.booking.number}</span> · {item.booking.eventType || "تصوير"} · {readableDay(item.booking.eventDate)}</div>
                  <div className={`text-xs ${overdue ? "font-bold text-rose-600" : "text-muted-foreground"}`}>التسليم: {item.dueDate ? readableDay(item.dueDate) : "بدون موعد"}</div>
                </Button>
                {moves.length ? (
                  <div className="flex flex-wrap gap-2">
                    {moves.map((to: ProductionStatus) => (
                      <Button key={to} size="sm" variant={to === "completed" ? "default" : "outline"} disabled={update.isPending} onClick={() => update.mutate({ id: item.id, patch: { status: to, expectedStatus: item.status } })}>
                        {update.isPending && update.variables?.id === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {PRODUCTION_STATUS_LABELS[to]}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {data ? (
        <ProductionItemDialog item={selected} today={data.today} permissions={data.permissions} meId={data.meId} open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} showBookingLink={false} />
      ) : null}
    </div>
  );
}
