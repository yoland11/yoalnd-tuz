import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Bell, CheckCheck, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type NotificationRow = {
  id: number;
  title: string;
  body: string;
  type: string;
  entityType: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationResponse = {
  data: NotificationRow[];
  unreadCount: number;
};

const TYPE_LABELS: Record<string, string> = {
  order_new: "طلب جديد",
  booking_new: "حجز جديد",
  message_new: "رسالة جديدة",
  task_assigned: "مهمة",
  inventory_low: "مخزون",
  order_cancelled: "إلغاء",
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("ar-IQ", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filters, setFilters] = useState({ status: "", type: "", q: "" });
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.type) params.set("type", filters.type);
    if (filters.q.trim()) params.set("q", filters.q.trim());
    return params.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<NotificationResponse>({
    queryKey: ["admin", "notifications", queryString],
    queryFn: () => adminFetch(`/admin/notifications${queryString ? `?${queryString}` : ""}`),
    staleTime: 15_000,
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => adminFetch(`/admin/notifications/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "notifications"] }),
    onError: (err: any) => toast({ title: "تعذر تحديث الإشعار", description: err?.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/notifications/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "تم حذف الإشعار" });
      qc.invalidateQueries({ queryKey: ["admin", "notifications"] });
    },
    onError: (err: any) => toast({ title: "تعذر حذف الإشعار", description: err?.message, variant: "destructive" }),
  });

  const markAll = useMutation({
    mutationFn: () => adminFetch("/admin/notifications/mark-all-read", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "notifications"] }),
  });

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">مركز الإشعارات</h1>
          <p className="text-sm text-muted-foreground mt-1">كل إشعارات الإدارة والطلبات والمهام والرسائل في مكان واحد.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-muted-foreground">
            <Bell className="w-4 h-4 text-primary" />
            {(data?.unreadCount ?? 0).toLocaleString("ar-IQ")} غير مقروء
          </div>
          <Button type="button" variant="outline" onClick={() => markAll.mutate()} className="gap-2">
            <CheckCheck className="w-4 h-4" /> تحديد الكل كمقروء
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border/30 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="بحث بعنوان أو نص الإشعار..."
              className="w-full bg-background border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
            <option value="">كل الحالات</option>
            <option value="unread">غير المقروءة</option>
            <option value="read">المقروءة</option>
          </select>
          <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
            <option value="">كل الأنواع</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-20 rounded-xl" />)}</div>
      ) : !data?.data.length ? (
        <EmptyState message="لا توجد إشعارات" />
      ) : (
        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-right p-3 font-medium">الإشعار</th>
                  <th className="text-right p-3 font-medium">النوع</th>
                  <th className="text-right p-3 font-medium">الحالة</th>
                  <th className="text-right p-3 font-medium">الوقت</th>
                  <th className="text-right p-3 font-medium">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {data.data.map((row) => (
                  <tr key={row.id} className="hover:bg-background/30">
                    <td className="p-3">
                      <a href={row.href ?? "#"} className="font-medium text-foreground hover:text-primary">{row.title}</a>
                      {row.body && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{row.body}</p>}
                    </td>
                    <td className="p-3"><span className="rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs">{TYPE_LABELS[row.type] ?? row.type}</span></td>
                    <td className="p-3 text-xs text-muted-foreground">{row.readAt ? "مقروء" : "غير مقروء"}</td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">{formatDate(row.createdAt)}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => patch.mutate({ id: row.id, body: { read: !row.readAt } })} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-primary">
                          <CheckCheck className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => patch.mutate({ id: row.id, body: { archived: true } })} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-primary">
                          <Archive className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => remove.mutate(row.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
