import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import type { FollowupSummary } from "@/lib/customer-followups";

/** An assigned-only live reminder, not another notification producer. */
export function CustomerFollowupReminder() {
  const query = useQuery({
    queryKey: ["customer-followups", "assigned-reminder"],
    queryFn: () => adminFetch<{ summary: FollowupSummary }>("/admin/customer-followups/summary?scope=mine"),
    staleTime: 30_000, refetchInterval: 60_000, retry: false,
  });
  const summary = query.data?.summary;
  return <section aria-label="تذكير متابعات العملاء" className="mb-4 rounded-xl border border-border bg-card p-3" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm"><CalendarClock className="h-4 w-4 shrink-0 text-primary" /><span className="font-semibold">متابعاتي</span>
        {summary ? <span className={summary.overdue ? "text-destructive" : "text-muted-foreground"}>{summary.today} اليوم · {summary.overdue} متأخرة</span> : query.isPending ? <span aria-busy="true" className="text-muted-foreground">جارٍ تحميل التذكير…</span> : null}
      </div>
      <Button variant="outline" size="sm" asChild><Link href="/staff?tab=followups">فتح المتابعات</Link></Button>
    </div>
    {query.isError ? <div className="mt-2 flex flex-wrap items-center gap-2"><p role="alert" className="text-sm text-destructive">تعذر تحميل تذكير المتابعات: {apiErrorMessage(query.error)}</p><Button size="sm" variant="ghost" onClick={() => void query.refetch()}>إعادة المحاولة</Button></div> : null}
  </section>;
}
