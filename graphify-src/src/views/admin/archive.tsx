import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getListOrdersQueryKey } from "@workspace/api-client-react";
import { ArchiveRestore, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatIraqiPhone, normalizePhoneDigits } from "@/lib/phone";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import { useToast } from "@/hooks/use-toast";

type ArchiveRow = {
  id: number;
  kind: "product" | "service";
  trackingCode: string | null;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  serviceType: string | null;
  status: string;
  total: number;
  depositAmount: number;
  remainingAmount: number;
  paymentStatus: string;
  governorate: string | null;
  archivedAt: string | null;
  createdAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار",
  confirmed: "مؤكد",
  processing: "قيد التجهيز",
  shipped: "في الطريق",
  delivered: "تم التوصيل",
  completed: "مكتمل",
  cancelled: "ملغي",
  reschedule_pending: "طلب تغيير موعد",
};

const PAYMENT_LABELS: Record<string, string> = {
  unpaid: "غير مدفوع",
  partial: "جزئي",
  paid: "مدفوع",
};

export default function ArchivePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("type", type);
    if (status) params.set("status", status);
    if (search.trim()) params.set("q", search.trim());
    return params.toString();
  }, [type, status, search]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "archive", queryString],
    queryFn: () => adminFetch<ArchiveRow[]>(`/admin/archive?${queryString}`),
  });

  const restore = useMutation({
    mutationFn: (row: ArchiveRow) =>
      adminFetch(`/admin/archive/${row.kind === "product" ? "orders" : "service-orders"}/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: false }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "archive"] });
      qc.invalidateQueries({ queryKey: ["admin", "service-orders"] });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "تم استرجاع الطلب من الأرشيف" });
    },
    onError: (err: any) => toast({ title: "تعذر استرجاع الطلب", description: err?.message, variant: "destructive" }),
  });

  const rows = data ?? [];
  const localRows = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.trim().toLowerCase();
    const digits = normalizePhoneDigits(search);
    return rows.filter((row) =>
      String(row.trackingCode ?? "").toLowerCase().includes(s) ||
      row.customerName.toLowerCase().includes(s) ||
      row.customerPhone.includes(digits || s) ||
      formatIraqiPhone(row.customerPhone).includes(digits || s) ||
      row.serviceName.toLowerCase().includes(s) ||
      String(row.governorate ?? "").toLowerCase().includes(s)
    );
  }, [rows, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">الأرشيف</h1>
          <p className="text-xs text-muted-foreground mt-1">الطلبات والحجوزات المؤرشفة تبقى محفوظة ويمكن استرجاعها.</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث: اسم، هاتف، تتبع، خدمة، محافظة..."
            className="w-full bg-card border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <option value="all">كل الأرشيف</option>
          <option value="products">طلبات المتجر</option>
          <option value="services">حجوزات الخدمات</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <option value="">كل الحالات</option>
          <option value="delivered">تم التوصيل</option>
          <option value="completed">مكتمل</option>
          <option value="cancelled">ملغي</option>
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : localRows.length === 0 ? (
        <EmptyState message="لا توجد طلبات مؤرشفة" />
      ) : (
        <div className="space-y-3">
          {localRows.map((row) => (
            <div key={`${row.kind}-${row.id}`} className="bg-card rounded-xl border border-border/30 p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-mono text-sm font-bold text-foreground">{row.trackingCode ?? "—"}</p>
                  <p className="text-sm text-muted-foreground">{row.customerName} — {formatIraqiPhone(row.customerPhone)}</p>
                  <p className="text-xs text-primary">{row.kind === "product" ? "طلب متجر" : row.serviceName}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {STATUS_LABELS[row.status] ?? row.status}
                    {row.archivedAt ? ` • أرشف في ${new Date(row.archivedAt).toLocaleDateString("ar-IQ")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs px-2 py-1 rounded-full border border-border/30 bg-background text-muted-foreground">
                    {PAYMENT_LABELS[row.paymentStatus] ?? "غير مدفوع"}
                  </span>
                  <span className="text-primary font-bold">{formatCurrency(row.total)}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(row)}
                  >
                    <ArchiveRestore className="w-4 h-4" /> استرجاع
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
                <div className="rounded-lg bg-background/50 border border-border/20 px-3 py-2">
                  <p className="text-muted-foreground">العربون</p>
                  <p className="text-foreground font-semibold mt-1">{formatCurrency(row.depositAmount)}</p>
                </div>
                <div className="rounded-lg bg-background/50 border border-border/20 px-3 py-2">
                  <p className="text-muted-foreground">المتبقي</p>
                  <p className="text-primary font-semibold mt-1">{formatCurrency(row.remainingAmount)}</p>
                </div>
                <div className="rounded-lg bg-background/50 border border-border/20 px-3 py-2">
                  <p className="text-muted-foreground">المحافظة</p>
                  <p className="text-foreground font-semibold mt-1 truncate">{row.governorate ?? "—"}</p>
                </div>
                <div className="rounded-lg bg-background/50 border border-border/20 px-3 py-2">
                  <p className="text-muted-foreground">تاريخ الطلب</p>
                  <p className="text-foreground font-semibold mt-1">{new Date(row.createdAt).toLocaleDateString("ar-IQ")}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
