import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Filter, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type ActivityLogRow = {
  id: number;
  staffId: number | null;
  userName: string;
  action: string;
  entityType: string | null;
  entityId: number | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
};

type ActivityLogResponse = {
  data: ActivityLogRow[];
  users: { id: number; name: string; username: string }[];
  total: number;
  page: number;
  limit: number;
};

const ACTION_LABELS: Record<string, string> = {
  admin_login_success: "تسجيل دخول ناجح",
  admin_login_failed: "فشل تسجيل دخول",
  admin_login_rate_limited: "تقييد دخول",
  admin_logout: "تسجيل خروج",
  telegram_settings_updated: "تحديث إعدادات Telegram",
  telegram_test_message: "اختبار رسالة Telegram",
  telegram_test_pdf: "اختبار PDF في Telegram",
  product_created: "إضافة منتج",
  product_updated: "تعديل منتج",
  product_deleted: "حذف منتج",
  order_created: "إنشاء طلب",
  order_updated: "تعديل طلب",
  order_deleted: "حذف طلب",
  order_restored: "استرجاع طلب",
  booking_updated: "تعديل حجز",
  booking_deleted: "حذف حجز",
  booking_restored: "استرجاع حجز",
  gallery_created: "إضافة صورة",
  gallery_deleted: "حذف صورة",
  whatsapp_test: "اختبار واتساب",
  whatsapp_resend: "إعادة إرسال واتساب",
};

const ENTITY_LABELS: Record<string, string> = {
  product: "منتج",
  order: "طلب",
  booking: "حجز",
  service_order: "حجز خدمة",
  gallery: "معرض",
  staff: "موظف",
  whatsapp: "واتساب",
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("ar-IQ", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function metadataText(value: Record<string, unknown>) {
  const entries = Object.entries(value ?? {}).filter(([, item]) => item !== undefined && item !== null && item !== "");
  if (entries.length === 0) return "—";
  return entries
    .slice(0, 4)
    .map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`)
    .join("، ");
}

export default function ActivityLogPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "25");
    if (search.trim()) params.set("search", search.trim());
    if (action) params.set("action", action);
    if (userId) params.set("userId", userId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [action, from, page, search, to, userId]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin", "activity-log", queryString],
    queryFn: () => adminFetch<ActivityLogResponse>(`/admin/activity-log?${queryString}`),
    staleTime: 30_000,
  });

  const totalPages = Math.max(Math.ceil((data?.total ?? 0) / (data?.limit ?? 25)), 1);
  const actionOptions = Object.entries(ACTION_LABELS);

  function resetFilters() {
    setSearch("");
    setAction("");
    setUserId("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">سجل النشاط</h1>
          <p className="text-sm text-muted-foreground mt-1">متابعة عمليات الإضافة والتعديل والحذف داخل لوحة الإدارة.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-primary" />
          {data?.total ?? 0} عملية
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-5">
          <div className="relative md:col-span-2">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="بحث بالعملية أو المستخدم أو التفاصيل..."
              className="w-full bg-background border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <select
            value={userId}
            onChange={(e) => { setUserId(e.target.value); setPage(1); }}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">كل المستخدمين</option>
            {data?.users.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">كل العمليات</option>
            {actionOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <Button type="button" variant="outline" onClick={resetFilters} className="gap-2">
            <Filter className="w-4 h-4" /> تصفية
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            من تاريخ
            <div className="relative mt-1">
              <CalendarDays className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="date"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setPage(1); }}
                className="w-full bg-background border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </label>
          <label className="text-xs text-muted-foreground">
            إلى تاريخ
            <div className="relative mt-1">
              <CalendarDays className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="date"
                value={to}
                onChange={(e) => { setTo(e.target.value); setPage(1); }}
                className="w-full bg-background border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-16 rounded-xl" />)}
        </div>
      ) : !data || data.data.length === 0 ? (
        <EmptyState message="لا توجد عمليات مطابقة" />
      ) : (
        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-right p-3 font-medium">الوقت</th>
                  <th className="text-right p-3 font-medium">المستخدم</th>
                  <th className="text-right p-3 font-medium">العملية</th>
                  <th className="text-right p-3 font-medium">القسم</th>
                  <th className="text-right p-3 font-medium">التفاصيل</th>
                  <th className="text-right p-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {data.data.map((row) => (
                  <tr key={row.id} className="hover:bg-background/30">
                    <td className="p-3 text-muted-foreground whitespace-nowrap">{formatDate(row.createdAt)}</td>
                    <td className="p-3 font-medium text-foreground whitespace-nowrap">{row.userName}</td>
                    <td className="p-3">
                      <span className="inline-flex rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs">
                        {ACTION_LABELS[row.action] ?? row.action}
                      </span>
                    </td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">
                      {row.entityType ? `${ENTITY_LABELS[row.entityType] ?? row.entityType}${row.entityId ? ` #${row.entityId}` : ""}` : "—"}
                    </td>
                    <td className="p-3 text-muted-foreground min-w-[260px]">{metadataText(row.metadata)}</td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">{row.ipAddress ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {isFetching ? "يتم تحديث السجل..." : `صفحة ${page} من ${totalPages}`}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(p - 1, 1))}>
            السابق
          </Button>
          <Button type="button" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(p + 1, totalPages))}>
            التالي
          </Button>
        </div>
      </div>
    </div>
  );
}
