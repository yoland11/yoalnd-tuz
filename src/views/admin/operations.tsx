import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Boxes,
  CheckCircle2,
  Database,
  FileText,
  Gauge,
  History,
  LifeBuoy,
  Package,
  Search,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "./_layout";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";

type ApprovalRow = {
  id: number;
  requestNo: string;
  type: string;
  title: string;
  description: string | null;
  entityType: string | null;
  entityId: number | null;
  amount: string | null;
  status: string;
  requestedByName: string;
  reviewedByName: string;
  createdAt: string | null;
};

type DocumentRow = {
  id: number;
  entityType: string;
  entityId: number;
  documentType: string;
  title: string;
  fileUrl: string;
  fileName: string | null;
  uploadedByName: string;
  createdAt: string | null;
};

type TimelineRow = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  actorName: string;
  createdAt: string | null;
};

type WarehouseTransfer = {
  id: number;
  transferNo: string;
  productName: string;
  quantity: number;
  status: string;
  requestedByName: string;
  reviewedByName: string;
  createdAt: string | null;
};

type Warehouse = { id: number; name: string; isActive: number };

type AssetRow = {
  productId: number;
  name: string;
  purchasePrice: number;
  expectedLifeUses: number;
  usageCount: number;
  currentValue: number;
  status: string;
  maintenanceDue: boolean;
};

type MaintenanceRow = {
  productId: number;
  name: string;
  usageCount: number;
  maintenanceEveryUses: number;
  nextMaintenanceAt: number;
  due: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "بانتظار الموافقة",
  approved: "موافق عليه",
  rejected: "مرفوض",
  draft: "مسودة",
  created: "تم الإنشاء",
  completed: "مكتمل",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ar-IQ", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusClass(status: string) {
  if (status === "approved" || status === "completed" || status === "created") return "bg-primary/10 text-primary";
  if (status === "rejected") return "bg-destructive/10 text-destructive";
  return "bg-amber-500/10 text-amber-500";
}

function PageHeader({ icon: Icon, title, description, action }: { icon: any; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Icon className="h-5 w-5 text-primary" />
          {title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon: any }) {
  return (
    <div className="rounded-xl border border-border/30 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-2 text-xl font-bold text-foreground">{value}</div>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border/30 bg-card p-4 ${className}`}>{children}</div>;
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((item) => <Skeleton key={item} className="h-20 rounded-xl" />)}
    </div>
  );
}

function JsonPreview({ value }: { value: unknown }) {
  return (
    <pre className="max-h-40 overflow-auto rounded-lg border border-border/30 bg-background/60 p-3 text-xs text-muted-foreground">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

export default function ApprovalCenterPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filters, setFilters] = useState({ status: "", type: "", q: "" });
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.status) p.set("status", filters.status);
    if (filters.type) p.set("type", filters.type);
    if (filters.q.trim()) p.set("q", filters.q.trim());
    return p.toString();
  }, [filters]);
  const { data, isLoading } = useQuery<{ data: ApprovalRow[] }>({
    queryKey: ["admin", "approvals", query],
    queryFn: () => adminFetch(`/admin/approvals${query ? `?${query}` : ""}`),
    staleTime: 20_000,
  });
  const review = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "approved" | "rejected" }) => adminFetch(`/admin/approvals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
    onSuccess: () => {
      toast({ title: "تم تحديث طلب الموافقة" });
      qc.invalidateQueries({ queryKey: ["admin", "approvals"] });
    },
    onError: (err) => toast({ title: "تعذر تحديث الموافقة", description: apiErrorMessage(err), variant: "destructive" }),
  });

  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader icon={ShieldCheck} title="مركز الموافقات" description="طلبات الخصم والحذف والتحويلات والعمليات الحساسة قبل تنفيذها." />
      <Card>
        <div className="grid gap-3 md:grid-cols-4">
          <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="بحث برقم الطلب أو العنوان..." className="md:col-span-2 rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">
            <option value="">كل الحالات</option>
            <option value="pending">بانتظار الموافقة</option>
            <option value="approved">موافق عليه</option>
            <option value="rejected">مرفوض</option>
          </select>
          <input value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} placeholder="نوع العملية" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
        </div>
      </Card>
      {isLoading ? <LoadingRows /> : !data?.data.length ? <EmptyState message="لا توجد طلبات موافقة" /> : (
        <div className="overflow-hidden rounded-xl border border-border/30 bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50 text-muted-foreground">
                <tr>
                  <th className="p-3 text-right font-medium">الطلب</th>
                  <th className="p-3 text-right font-medium">النوع</th>
                  <th className="p-3 text-right font-medium">المبلغ</th>
                  <th className="p-3 text-right font-medium">الحالة</th>
                  <th className="p-3 text-right font-medium">بواسطة</th>
                  <th className="p-3 text-right font-medium">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {data.data.map((row) => (
                  <tr key={row.id} className="hover:bg-background/30">
                    <td className="p-3">
                      <p className="font-semibold text-foreground">{row.requestNo}</p>
                      <p className="text-xs text-muted-foreground">{row.title}</p>
                    </td>
                    <td className="p-3 text-muted-foreground">{row.type}</td>
                    <td className="p-3">{row.amount ? formatCurrency(row.amount) : "—"}</td>
                    <td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs ${statusClass(row.status)}`}>{STATUS_LABELS[row.status] ?? row.status}</span></td>
                    <td className="p-3 text-muted-foreground">{row.requestedByName || "النظام"}<br /><span className="text-xs">{formatDate(row.createdAt)}</span></td>
                    <td className="p-3">
                      {row.status === "pending" ? (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => review.mutate({ id: row.id, status: "approved" })} className="gap-1"><CheckCircle2 className="h-4 w-4" /> موافقة</Button>
                          <Button size="sm" variant="outline" onClick={() => review.mutate({ id: row.id, status: "rejected" })} className="gap-1"><XCircle className="h-4 w-4" /> رفض</Button>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">{row.reviewedByName || "تمت المراجعة"}</span>}
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

export function DocumentCenterPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filters, setFilters] = useState({ entityType: "", entityId: "" });
  const [form, setForm] = useState({ entityType: "", entityId: "", title: "", documentType: "file", fileUrl: "" });
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.entityType) p.set("entityType", filters.entityType);
    if (filters.entityId) p.set("entityId", filters.entityId);
    return p.toString();
  }, [filters]);
  const { data, isLoading } = useQuery<{ data: DocumentRow[] }>({
    queryKey: ["admin", "documents", query],
    queryFn: () => adminFetch(`/admin/documents${query ? `?${query}` : ""}`),
    staleTime: 20_000,
  });
  const save = useMutation({
    mutationFn: () => adminFetch("/admin/documents", { method: "POST", body: JSON.stringify({ ...form, entityId: Number(form.entityId) || null }) }),
    onSuccess: () => {
      toast({ title: "تم حفظ المستند" });
      setForm({ entityType: "", entityId: "", title: "", documentType: "file", fileUrl: "" });
      qc.invalidateQueries({ queryKey: ["admin", "documents"] });
    },
    onError: (err) => toast({ title: "تعذر حفظ المستند", description: apiErrorMessage(err), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "تم إرسال طلب الحذف للموافقة" });
      qc.invalidateQueries({ queryKey: ["admin", "documents"] });
      qc.invalidateQueries({ queryKey: ["admin", "approvals"] });
    },
    onError: (err) => toast({ title: "تعذر إرسال طلب الحذف", description: apiErrorMessage(err), variant: "destructive" }),
  });

  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader icon={FileText} title="مركز المستندات" description="العقود والفواتير والوصولات والصور المرتبطة بكل حجز أو طلب." />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <h2 className="font-semibold text-foreground">إضافة مستند</h2>
            <input value={form.entityType} onChange={(e) => setForm({ ...form, entityType: e.target.value })} placeholder="نوع الربط: order / kosha_booking" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            <input value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value.replace(/\D/g, "") })} placeholder="رقم السجل" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="عنوان المستند" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            <input value={form.fileUrl} onChange={(e) => setForm({ ...form, fileUrl: e.target.value })} placeholder="رابط الملف" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            <Button type="submit" className="w-full">حفظ المستند</Button>
          </form>
        </Card>
        <div className="space-y-3">
          <Card>
            <div className="grid gap-3 md:grid-cols-3">
              <input value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })} placeholder="نوع السجل" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
              <input value={filters.entityId} onChange={(e) => setFilters({ ...filters, entityId: e.target.value.replace(/\D/g, "") })} placeholder="رقم السجل" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
              <Button variant="outline" onClick={() => setFilters({ entityType: "", entityId: "" })}>مسح الفلترة</Button>
            </div>
          </Card>
          {isLoading ? <LoadingRows /> : !data?.data.length ? <EmptyState message="لا توجد مستندات" /> : data.data.map((row) => (
            <Card key={row.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a className="font-semibold text-foreground hover:text-primary" href={row.fileUrl} target="_blank" rel="noreferrer">{row.title}</a>
                  <p className="mt-1 text-xs text-muted-foreground">{row.entityType} #{row.entityId} · {row.uploadedByName || "النظام"} · {formatDate(row.createdAt)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => remove.mutate(row.id)} className="gap-1"><Archive className="h-4 w-4" /> طلب حذف</Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LiveOperationsPage() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["admin", "live-operations"],
    queryFn: () => adminFetch("/admin/live-operations"),
    refetchInterval: 60_000,
  });
  const summary = data?.summary ?? {};
  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader icon={Gauge} title="شاشة العمليات المباشرة" description="متابعة الكوشات والمصورين والمهام المفتوحة بشكل مباشر." />
      <div className="grid gap-3 md:grid-cols-4">
        <StatCard icon={Package} label="كوشات فعالة" value={summary.koshasActive ?? 0} />
        <StatCard icon={Gauge} label="مصورو اليوم" value={summary.photographersField ?? 0} />
        <StatCard icon={CheckCircle2} label="مهام مفتوحة" value={summary.tasksOpen ?? 0} />
        <StatCard icon={AlertTriangle} label="حجوزات متأخرة" value={summary.finishedBookings ?? 0} />
      </div>
      {isLoading ? <LoadingRows /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <OperationList title="الكوشات المنصبة أو القادمة" rows={data?.koshas ?? []} />
          <OperationList title="المصورون بالميدان" rows={data?.photographers ?? []} />
          <OperationList title="مهام اليوم" rows={data?.tasks ?? []} />
        </div>
      )}
    </div>
  );
}

function OperationList({ title, rows }: { title: string; rows: any[] }) {
  return (
    <Card>
      <h2 className="mb-3 font-semibold text-foreground">{title}</h2>
      {!rows.length ? <EmptyState message="لا توجد بيانات" /> : (
        <div className="space-y-2">
          {rows.slice(0, 12).map((row) => (
            <a key={`${title}-${row.id}`} href={row.href ?? "#"} className="block rounded-lg border border-border/30 bg-background/40 p-3 hover:border-primary/40">
              <p className="font-medium text-foreground">{row.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{row.customerName ?? row.location ?? row.status ?? ""} {row.date ? `· ${row.date}` : ""}</p>
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}

export function SmartSearchPage() {
  const [q, setQ] = useState("");
  const { data, isFetching } = useQuery<{ data: any[] }>({
    queryKey: ["admin", "smart-search", q],
    queryFn: () => adminFetch(`/admin/smart-search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 15_000,
  });
  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader icon={Search} title="البحث الذكي" description="بحث واحد يعرض الزبون والطلب والمنتج والفاتورة والمستند." />
      <Card>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتب اسم، هاتف، رقم تتبع، منتج، فاتورة..." className="w-full rounded-lg border border-border/40 bg-background py-3 pl-3 pr-10 text-sm" />
        </div>
      </Card>
      {isFetching ? <LoadingRows /> : q.trim().length < 2 ? <EmptyState message="ابدأ البحث بكتابة حرفين أو أكثر" /> : !data?.data.length ? <EmptyState message="لا توجد نتائج" /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.data.map((row) => (
            <a key={`${row.type}-${row.id}`} href={row.href} className="rounded-xl border border-border/30 bg-card p-4 hover:border-primary/40">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{row.title}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{row.subtitle || row.type}</p>
                </div>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">{row.type}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function BusinessAnalyticsPage() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["admin", "business-analytics"],
    queryFn: () => adminFetch("/admin/business-analytics"),
    staleTime: 60_000,
  });
  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader icon={BarChart3} title="تحليلات الأعمال" description="الخدمات الأكثر ربحاً، المواد الأكثر استخداماً، العملاء المتكررون، ونشاط الموظفين." />
      {isLoading ? <LoadingRows /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <AnalyticsList title="أكثر الخدمات طلباً" rows={data?.profitableServices ?? []} amount />
          <AnalyticsList title="أكثر المواد استخداماً" rows={data?.usedProducts ?? []} amount />
          <AnalyticsList title="أكثر العملاء تكراراً" rows={data?.frequentCustomers ?? []} amount />
          <AnalyticsList title="أكثر الموظفين نشاطاً" rows={data?.activeStaff ?? []} />
          <AnalyticsList title="أكثر الأشهر ازدحاماً" rows={data?.busyMonths ?? []} />
        </div>
      )}
    </div>
  );
}

function AnalyticsList({ title, rows, amount = false }: { title: string; rows: any[]; amount?: boolean }) {
  return (
    <Card>
      <h2 className="mb-3 font-semibold text-foreground">{title}</h2>
      {!rows.length ? <EmptyState message="لا توجد بيانات" /> : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={`${title}-${row.label}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/30 bg-background/40 p-3">
              <span className="truncate text-sm text-foreground">{row.label || "غير محدد"}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{Number(row.count ?? 0).toLocaleString("ar-IQ")}{amount ? ` · ${formatCurrency(row.total ?? 0)}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function WarehouseTransfersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ productName: "", productId: "", fromWarehouseId: "", toWarehouseId: "", quantity: "1", notes: "" });
  const { data, isLoading } = useQuery<{ data: WarehouseTransfer[]; warehouses: Warehouse[] }>({
    queryKey: ["admin", "warehouse-transfers"],
    queryFn: () => adminFetch("/admin/warehouse-transfers"),
    staleTime: 30_000,
  });
  const save = useMutation({
    mutationFn: () => adminFetch("/admin/warehouse-transfers", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      toast({ title: "تم إرسال التحويل للموافقة" });
      setForm({ productName: "", productId: "", fromWarehouseId: "", toWarehouseId: "", quantity: "1", notes: "" });
      qc.invalidateQueries({ queryKey: ["admin", "warehouse-transfers"] });
      qc.invalidateQueries({ queryKey: ["admin", "approvals"] });
    },
    onError: (err) => toast({ title: "تعذر حفظ التحويل", description: apiErrorMessage(err), variant: "destructive" }),
  });
  const review = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => adminFetch(`/admin/warehouse-transfers/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "warehouse-transfers"] }),
  });
  const warehouses = data?.warehouses ?? [];
  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader icon={Boxes} title="تحويل المخازن" description="طلب تحويل المواد بين المخازن مع موافقة المدير قبل التنفيذ." />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <input value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value.replace(/\D/g, "") })} placeholder="رقم المنتج إن وجد" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            <input value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} placeholder="اسم المادة" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            <select value={form.fromWarehouseId} onChange={(e) => setForm({ ...form, fromWarehouseId: e.target.value })} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">
              <option value="">من مخزن</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select value={form.toWarehouseId} onChange={(e) => setForm({ ...form, toWarehouseId: e.target.value })} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">
              <option value="">إلى مخزن</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value.replace(/\D/g, "") || "1" })} placeholder="الكمية" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات" rows={3} className="w-full resize-none rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            <Button className="w-full">حفظ التحويل</Button>
          </form>
        </Card>
        {isLoading ? <LoadingRows /> : !data?.data.length ? <EmptyState message="لا توجد تحويلات" /> : (
          <div className="space-y-2">
            {data.data.map((row) => (
              <Card key={row.id}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{row.transferNo} · {row.productName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">الكمية {row.quantity} · {row.requestedByName || "النظام"} · {formatDate(row.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs ${statusClass(row.status)}`}>{STATUS_LABELS[row.status] ?? row.status}</span>
                    {row.status === "pending" && (
                      <>
                        <Button size="sm" onClick={() => review.mutate({ id: row.id, status: "approved" })}>اعتماد</Button>
                        <Button size="sm" variant="outline" onClick={() => review.mutate({ id: row.id, status: "rejected" })}>رفض</Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AssetsPage() {
  const { data, isLoading } = useQuery<{ data: AssetRow[] }>({ queryKey: ["admin", "assets"], queryFn: () => adminFetch("/admin/assets"), staleTime: 60_000 });
  const totalValue = (data?.data ?? []).reduce((sum, row) => sum + row.currentValue, 0);
  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader icon={Package} title="إهلاك الأصول" description="قيمة المواد الحالية وعدد مرات استخدامها وجدولة الصيانة." />
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard icon={Package} label="عدد الأصول" value={(data?.data.length ?? 0).toLocaleString("ar-IQ")} />
        <StatCard icon={Gauge} label="القيمة الحالية" value={formatCurrency(totalValue)} />
        <StatCard icon={Wrench} label="تحتاج صيانة" value={(data?.data.filter((row) => row.maintenanceDue).length ?? 0).toLocaleString("ar-IQ")} />
      </div>
      {isLoading ? <LoadingRows /> : !data?.data.length ? <EmptyState message="لا توجد أصول" /> : (
        <div className="overflow-hidden rounded-xl border border-border/30 bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50 text-muted-foreground">
                <tr>
                  <th className="p-3 text-right">الأصل</th>
                  <th className="p-3 text-right">سعر الشراء</th>
                  <th className="p-3 text-right">الاستخدام</th>
                  <th className="p-3 text-right">القيمة الحالية</th>
                  <th className="p-3 text-right">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {data.data.map((row) => (
                  <tr key={row.productId}>
                    <td className="p-3 font-medium text-foreground">{row.name}</td>
                    <td className="p-3">{formatCurrency(row.purchasePrice)}</td>
                    <td className="p-3 text-muted-foreground">{row.usageCount} / {row.expectedLifeUses}</td>
                    <td className="p-3 text-primary">{formatCurrency(row.currentValue)}</td>
                    <td className="p-3">{row.maintenanceDue ? <span className="text-amber-500">صيانة</span> : "نشط"}</td>
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

export function MaintenanceSchedulerPage() {
  const { data, isLoading } = useQuery<{ data: MaintenanceRow[] }>({ queryKey: ["admin", "maintenance-scheduler"], queryFn: () => adminFetch("/admin/maintenance-scheduler"), staleTime: 60_000 });
  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader icon={Wrench} title="جدولة الصيانة" description="اقتراح صيانة المواد حسب عدد مرات الاستخدام." />
      {isLoading ? <LoadingRows /> : !data?.data.length ? <EmptyState message="لا توجد مواد تحتاج صيانة حالياً" /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.data.map((row) => (
            <Card key={row.productId}>
              <p className="font-semibold text-foreground">{row.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">الاستخدام الحالي: {row.usageCount} · الصيانة كل {row.maintenanceEveryUses} استخدام</p>
              <p className="mt-2 text-xs text-amber-500">مقترح إرسالها للصيانة الآن.</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function PurchaseComparisonPage() {
  const [q, setQ] = useState("");
  const { data, isFetching } = useQuery<any>({
    queryKey: ["admin", "purchase-comparison", q],
    queryFn: () => adminFetch(`/admin/purchase-comparison?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader icon={Search} title="مقارنة المشتريات" description="آخر سعر وأفضل مورد وأقل سعر قبل شراء المادة." />
      <Card><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم المادة..." className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /></Card>
      {data?.summary && (
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard icon={Package} label="آخر سعر" value={formatCurrency(data.summary.lastPrice)} />
          <StatCard icon={CheckCircle2} label="أقل سعر" value={formatCurrency(data.summary.bestPrice)} />
          <StatCard icon={FileText} label="أفضل مورد" value={data.summary.bestSupplier || "—"} />
        </div>
      )}
      {isFetching ? <LoadingRows /> : q.trim().length < 2 ? <EmptyState message="اكتب اسم المادة لعرض المقارنة" /> : !data?.data.length ? <EmptyState message="لا توجد فواتير شراء لهذه المادة" /> : (
        <div className="space-y-2">
          {data.data.map((row: any, index: number) => (
            <Card key={`${row.productName}-${index}`}>
              <div className="flex justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{row.productName}</p>
                  <p className="text-xs text-muted-foreground">{row.supplierName || "مورد غير محدد"} · {row.date}</p>
                </div>
                <p className="text-primary">{formatCurrency(row.costPrice)}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function DisasterRecoveryPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<any>({ queryKey: ["admin", "disaster-recovery"], queryFn: () => adminFetch("/admin/disaster-recovery"), staleTime: 30_000 });
  const create = useMutation({
    mutationFn: () => adminFetch("/admin/disaster-recovery", { method: "POST" }),
    onSuccess: () => {
      toast({ title: "تم إنشاء لقطة طوارئ" });
      qc.invalidateQueries({ queryKey: ["admin", "disaster-recovery"] });
    },
    onError: (err) => toast({ title: "تعذر إنشاء اللقطة", description: apiErrorMessage(err), variant: "destructive" }),
  });
  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader icon={Database} title="الطوارئ والاسترجاع" description="سجل لقطات الطوارئ ومؤشرات النسخ الحالية." action={<Button onClick={() => create.mutate()} className="gap-2"><Database className="h-4 w-4" /> إنشاء لقطة</Button>} />
      {isLoading ? <LoadingRows /> : !data?.data.length ? <EmptyState message="لا توجد لقطات طوارئ" /> : (
        <div className="space-y-2">
          {data.data.map((row: any) => (
            <Card key={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{row.snapshotNo}</p>
                  <p className="text-xs text-muted-foreground">{row.createdByName || "النظام"} · {formatDate(row.createdAt)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs ${statusClass(row.status)}`}>{STATUS_LABELS[row.status] ?? row.status}</span>
              </div>
              <div className="mt-3"><JsonPreview value={row.summary} /></div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function TimelinesPage() {
  const [entity, setEntity] = useState({ entityType: "kosha_booking", entityId: "" });
  const [finance, setFinance] = useState({ entityType: "", entityId: "" });
  const [productId, setProductId] = useState("");
  const entityEnabled = Boolean(entity.entityType && entity.entityId);
  const financeEnabled = Boolean(finance.entityType || finance.entityId);
  const inventoryEnabled = Boolean(productId);
  const entityTimeline = useQuery<{ data: TimelineRow[] }>({
    queryKey: ["admin", "entity-timeline", entity],
    queryFn: () => adminFetch(`/admin/entity-timeline?entityType=${encodeURIComponent(entity.entityType)}&entityId=${encodeURIComponent(entity.entityId)}`),
    enabled: entityEnabled,
  });
  const financialTimeline = useQuery<any>({
    queryKey: ["admin", "financial-timeline", finance],
    queryFn: () => {
      const p = new URLSearchParams();
      if (finance.entityType) p.set("entityType", finance.entityType);
      if (finance.entityId) p.set("entityId", finance.entityId);
      return adminFetch(`/admin/financial-timeline?${p.toString()}`);
    },
    enabled: financeEnabled,
  });
  const inventoryTimeline = useQuery<any>({
    queryKey: ["admin", "inventory-timeline", productId],
    queryFn: () => adminFetch(`/admin/inventory-timeline?productId=${encodeURIComponent(productId)}`),
    enabled: inventoryEnabled,
  });
  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader icon={History} title="التايملاين" description="خط زمني للحجز والمال والمخزون بدون حذف أو تعديل البيانات الأصلية." />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h2 className="mb-3 font-semibold text-foreground">نشاط الحجز أو الطلب</h2>
          <div className="grid gap-2">
            <input value={entity.entityType} onChange={(e) => setEntity({ ...entity, entityType: e.target.value })} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            <input value={entity.entityId} onChange={(e) => setEntity({ ...entity, entityId: e.target.value.replace(/\D/g, "") })} placeholder="رقم السجل" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
          </div>
          <TimelineList rows={entityTimeline.data?.data ?? []} loading={entityTimeline.isFetching} empty={entityEnabled ? "لا يوجد نشاط" : "أدخل نوع ورقم السجل"} />
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold text-foreground">الخط المالي</h2>
          <div className="grid gap-2">
            <input value={finance.entityType} onChange={(e) => setFinance({ ...finance, entityType: e.target.value })} placeholder="نوع المصدر" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            <input value={finance.entityId} onChange={(e) => setFinance({ ...finance, entityId: e.target.value })} placeholder="رقم المصدر" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
          </div>
          <TimelineList rows={(financialTimeline.data?.data ?? []).map((row: any) => ({ id: row.id, title: row.description || row.transactionNo, body: `${row.direction} · ${formatCurrency(row.amount)}`, actorName: row.status, createdAt: row.createdAt }))} loading={financialTimeline.isFetching} empty={financeEnabled ? "لا توجد حركات مالية" : "حدد المصدر لعرض الحركات"} />
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold text-foreground">خط المخزون</h2>
          <input value={productId} onChange={(e) => setProductId(e.target.value.replace(/\D/g, ""))} placeholder="رقم المنتج" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
          <TimelineList rows={(inventoryTimeline.data?.data ?? []).map((row: any) => ({ id: row.id, title: row.reason, body: `التغيير ${row.quantityChange} · المنتج ${row.productId}`, actorName: row.createdByName, createdAt: row.createdAt }))} loading={inventoryTimeline.isFetching} empty={inventoryEnabled ? "لا توجد حركات مخزون" : "أدخل رقم المنتج"} />
        </Card>
      </div>
    </div>
  );
}

function TimelineList({ rows, loading, empty }: { rows: TimelineRow[]; loading: boolean; empty: string }) {
  return (
    <div className="mt-4 space-y-2">
      {loading ? <Skeleton className="h-28 rounded-xl" /> : !rows.length ? <EmptyState message={empty} /> : rows.slice(0, 12).map((row) => (
        <div key={row.id} className="rounded-lg border border-border/30 bg-background/40 p-3">
          <p className="font-medium text-foreground">{row.title}</p>
          {row.body && <p className="mt-1 text-xs text-muted-foreground">{row.body}</p>}
          <p className="mt-2 text-[11px] text-muted-foreground">{row.actorName || "النظام"} · {formatDate(row.createdAt)}</p>
        </div>
      ))}
    </div>
  );
}
