import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  BadgeDollarSign,
  Boxes,
  Camera,
  CheckCircle2,
  Database,
  Download,
  FileText,
  Fingerprint,
  Gauge,
  History,
  LifeBuoy,
  MapPin,
  Package,
  Pause,
  Pencil,
  Play,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  ScanLine,
  Search,
  ShieldCheck,
  Wrench,
  X,
  XCircle,
  Upload,
  UserRound,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "./_layout";
import {
  adminFetch,
  apiErrorMessage,
  compressImageFile,
  fetchAdminMe,
  formatCurrency,
  hasPerm,
} from "./_lib";
import { AssetSaleDialog } from "./asset-sale-dialog";

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
  depreciationRecordId?: number | null;
  depreciationRecordDate?: string | null;
  hasDepreciationRecord?: boolean;
  name: string;
  purchasePrice: number;
  expectedLifeUses: number;
  usageCount: number;
  currentValue: number;
  serialNumber?: string | null;
  dna?: string | null;
  category?: string | null;
  status: string;
  depreciationPaused?: boolean;
  maintenanceDue: boolean;
};

type MovementAsset = {
  productId: number;
  productName: string;
  assetCode: string;
  serialNumber?: string | null;
  barcode?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  stock: number;
  assetStatus: string;
  healthScore: number;
  healthLabel: string;
  lastLocation?: string | null;
  shelfCode?: string | null;
  custody?: Array<{
    id: number;
    staffId: number;
    staffName?: string | null;
    issuedAt?: string | null;
  }>;
};

type AssetMovementRow = {
  id: string;
  source: string;
  productId: number;
  productName: string;
  type: string;
  title: string;
  body?: string | null;
  quantityChange?: number | null;
  actorName?: string | null;
  relatedType?: string | null;
  relatedId?: number | null;
  createdAt: string;
};

type StaffOption = {
  id: number;
  fullName?: string | null;
  username: string;
  isActive: boolean;
};

type AssetQrResponse = { productId: number; name: string; serialNumber: string | null; dna: string; token: string; scanUrl: string; dataUrl: string };

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
  return "bg-status-warning/10 text-status-warning";
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

function StatCard({ label, value, icon: Icon, onClick, active }: { label: string; value: React.ReactNode; icon: any; onClick?: () => void; active?: boolean }) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-2 text-xl font-bold text-foreground">{value}</div>
    </>
  );
  const base = `rounded-xl border bg-card p-4 transition-colors ${active ? "border-primary/50" : "border-border/30"}`;
  if (onClick) return (
    <button type="button" onClick={onClick} aria-label={`${label}: ${typeof value === "string" || typeof value === "number" ? value : ""}`} className={`${base} block w-full text-right cursor-pointer hover:border-primary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}>{inner}</button>
  );
  return <div className={base}>{inner}</div>;
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
        <StatCard icon={Boxes} label="سيارات بالخارج" value={summary.vehiclesOutside ?? 0} />
        <StatCard icon={CheckCircle2} label="مهام مفتوحة" value={summary.tasksOpen ?? 0} />
      </div>
      {isLoading ? <LoadingRows /> : (
        <div className="grid gap-4 lg:grid-cols-4">
          <OperationList title="الكوشات المنصبة أو القادمة" rows={data?.koshas ?? []} />
          <OperationList title="المصورون بالميدان" rows={data?.photographers ?? []} />
          <OperationList title="السيارات بالخارج" rows={data?.vehicles ?? []} />
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

const ASSET_STATUS_LABEL: Record<string, string> = {
  sold: "تم البيع",
  disposed: "تم الاستبعاد",
  active: "نشط",
  reserved: "محجوز",
  maintenance: "صيانة",
  transferred: "منقول",
  lost: "مفقود",
  retired: "مُستبعد",
  locked: "🔒 مقفول",
};

export function AssetsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ data: AssetRow[] }>({ queryKey: ["admin", "assets"], queryFn: () => adminFetch("/admin/assets"), staleTime: 60_000 });
  const [adding, setAdding] = useState(false);
  const [saleTarget, setSaleTarget] = useState<number | null>(null);
  const meQuery = useQuery({ queryKey: ["admin", "me"], queryFn: () => fetchAdminMe(), staleTime: 60_000 });
  const rows = data?.data ?? [];
  const totalValue = rows.reduce((sum, row) => sum + row.currentValue, 0);
  const totalPurchase = rows.reduce((sum, row) => sum + row.purchasePrice, 0);
  const [filter, setFilter] = useState<"all" | "maintenance">("all");
  const [removeTarget, setRemoveTarget] = useState<AssetRow | null>(null);
  const filtered = filter === "maintenance" ? rows.filter((r) => r.maintenanceDue) : rows;
  // Removing an asset from depreciation keeps it in `rows` (the Assets page) but drops it
  // from every depreciation surface until a depreciation record is created again.
  const depreciationRows = [...rows]
    .filter((row) => row.hasDepreciationRecord && row.purchasePrice > 0)
    .sort(
      (a, b) =>
        1 - b.currentValue / b.purchasePrice -
        (1 - a.currentValue / a.purchasePrice),
    )
    .slice(0, 8);
  const toggleDepreciation = useMutation({
    mutationFn: ({ productId, paused }: { productId: number; paused: boolean }) =>
      adminFetch("/admin/assets/depreciation", {
        method: "POST",
        body: JSON.stringify({ productId, paused }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
      queryClient.invalidateQueries({
        queryKey: ["admin", "enterprise", "assets"],
      });
      queryClient.invalidateQueries({ queryKey: ["asset-depreciation-report"] });
      toast({
        title: variables.paused ? "تم إيقاف الإهلاك" : "تم استئناف الإهلاك",
      });
    },
    onError: (error) =>
      toast({
        title: "تعذّر تحديث الإهلاك",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  const removeDepreciation = useMutation({
    mutationFn: ({ recordId, reason }: { recordId: number; reason: string }) => adminFetch(`/admin/assets/depreciation/${recordId}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      // Refetch every depreciation surface so counters, totals and reports drop the asset
      // immediately, with no page reload. On failure nothing is invalidated and the asset stays.
      queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "enterprise", "assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-depreciation-report"] });
      queryClient.invalidateQueries({ queryKey: ["depreciation-categories"] });
      toast({ title: "تمت إزالة الأصل من نظام الإهلاك بنجاح", description: "الأصل ما زال موجوداً في صفحة الأصول، وتمت استعادة قيمته دون تغيير المخزون أو المنتج." });
      setRemoveTarget(null);
    },
    onError: (error) => toast({ title: "تعذّرت إزالة سجل الإهلاك", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader
        icon={Package}
        title="إهلاك الأصول"
        description="قيمة المواد الحالية وعدد مرات استخدامها وجدولة الصيانة."
        action={(
          <div className="flex items-center gap-2">
            <Link href="/admin/assets/new">
              <Button className="gap-1">
                <Plus className="h-4 w-4" /> إضافة أصل جديد
              </Button>
            </Link>
            <Button variant="outline" onClick={() => setAdding(true)} className="gap-1">
              <Plus className="h-4 w-4" /> سجل إهلاك
            </Button>
          </div>
        )}
      />
      <div className="grid gap-3 md:grid-cols-4">
        <StatCard icon={Package} label="عدد الأصول" value={rows.length.toLocaleString("ar-IQ")} onClick={() => setFilter("all")} active={filter === "all"} />
        <StatCard icon={Gauge} label="إجمالي الشراء" value={formatCurrency(totalPurchase)} onClick={() => setFilter("all")} />
        <StatCard icon={Gauge} label="القيمة الحالية" value={formatCurrency(totalValue)} onClick={() => setFilter("all")} />
        <StatCard icon={Wrench} label="تحتاج صيانة" value={rows.filter((row) => row.maintenanceDue).length.toLocaleString("ar-IQ")} onClick={() => setFilter("maintenance")} active={filter === "maintenance"} />
      </div>
      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-foreground">مخطط الإهلاك</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              نسبة القيمة المستهلكة للأصول الأعلى إهلاكاً.
            </p>
          </div>
          <BarChart3 className="h-5 w-5 text-primary" />
        </div>
        {!depreciationRows.length ? (
          <p className="text-sm text-muted-foreground">لا توجد قيم شراء مسجلة.</p>
        ) : (
          <div className="space-y-3">
            {depreciationRows.map((row) => {
              const percent = Math.max(
                0,
                Math.min(
                  100,
                  Math.round((1 - row.currentValue / row.purchasePrice) * 100),
                ),
              );
              return (
                <div key={row.productId}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-foreground">{row.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {percent}% · {formatCurrency(row.currentValue)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {isLoading ? <LoadingRows /> : !rows.length ? <EmptyState message="لا توجد أصول" /> : (
        <div className="overflow-hidden rounded-xl border border-border/30 bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50 text-muted-foreground">
                <tr>
                  <th className="p-3 text-right">الأصل</th>
                  <th className="p-3 text-right">سعر الشراء</th>
                  <th className="p-3 text-right">الاستخدام / العمر الافتراضي</th>
                  <th className="p-3 text-right">القيمة المتبقية</th>
                  <th className="p-3 text-right">الحالة</th>
                  <th className="p-3 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">لا توجد بيانات مطابقة</td></tr>
                ) : filtered.map((row) => (
                  <tr key={row.productId} className="hover:bg-background/40">
                    <td className="p-3">
                      <div className="font-medium text-foreground">{row.name}</div>
                      {row.serialNumber && <div className="font-mono text-[11px] text-muted-foreground">SN: {row.serialNumber}</div>}
                    </td>
                    <td className="p-3">{formatCurrency(row.purchasePrice)}</td>
                    <td className="p-3 text-muted-foreground">{row.usageCount} / {row.expectedLifeUses}</td>
                    <td className="p-3 text-primary">{formatCurrency(row.currentValue)}</td>
                      <td className="p-3">
                        <div>{row.maintenanceDue ? <span className="text-status-warning">صيانة</span> : (ASSET_STATUS_LABEL[row.status] ?? "نشط")}</div>
                        {row.depreciationPaused ? (
                          <span className="mt-1 inline-flex rounded-full bg-status-warning/10 px-2 py-0.5 text-[11px] text-status-warning">
                            الإهلاك متوقف
                          </span>
                        ) : null}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {row.status === "active" && hasPerm(meQuery.data ?? null, "asset.sell") ? (
                            <Button variant="ghost" size="sm" className="gap-1 text-primary" onClick={() => setSaleTarget(row.productId)}>
                              <BadgeDollarSign className="h-3.5 w-3.5" /> بيع الأصل
                            </Button>
                          ) : null}
                          <Link href={`/admin/assets/new?edit=${row.productId}&returnTo=depreciation`}>
                            <Button variant="ghost" size="sm" className="gap-1 text-primary">
                              <Pencil className="h-3.5 w-3.5" /> تعديل
                            </Button>
                          </Link>
                          <Link href={`/admin/print-labels?productId=${row.productId}&kind=asset`}>
                            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                              <QrCode className="h-3.5 w-3.5" /> طباعة ملصق
                            </Button>
                          </Link>
                          {!["sold", "disposed"].includes(row.status) ? <Button
                            variant="ghost"
                            size="sm"
                            disabled={toggleDepreciation.isPending}
                            onClick={() =>
                              toggleDepreciation.mutate({
                                productId: row.productId,
                                paused: !row.depreciationPaused,
                              })
                            }
                            className="gap-1 text-muted-foreground"
                          >
                            {row.depreciationPaused ? (
                              <Play className="h-3.5 w-3.5" />
                            ) : (
                              <Pause className="h-3.5 w-3.5" />
                            )}
                            {row.depreciationPaused ? "استئناف" : "إيقاف"}
                          </Button> : null}
                          {!["sold", "disposed"].includes(row.status) ? <Button
                            variant="ghost"
                            size="sm"
                            disabled={!row.hasDepreciationRecord || !row.depreciationRecordId || removeDepreciation.isPending}
                            title={row.hasDepreciationRecord ? "إزالة سجل الإهلاك فقط" : "لا يوجد سجل إهلاك نشط لهذا الأصل"}
                            onClick={() => setRemoveTarget(row)}
                            className="gap-1 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> إزالة الإهلاك
                          </Button> : null}
                        </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {adding && (
        <DepreciationModal
          asset={null}
          assets={rows}
          onClose={() => setAdding(false)}
        />
      )}
      <RemoveDepreciationDialog asset={removeTarget} busy={removeDepreciation.isPending} onClose={() => setRemoveTarget(null)} onConfirm={(reason) => removeTarget?.depreciationRecordId && removeDepreciation.mutate({ recordId: removeTarget.depreciationRecordId, reason })} />
      {saleTarget ? <AssetSaleDialog productId={saleTarget} open onOpenChange={(open) => !open && setSaleTarget(null)} /> : null}
    </div>
  );
}

function RemoveDepreciationDialog({ asset, busy, onClose, onConfirm }: { asset: AssetRow | null; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const depreciation = Math.max(0, (asset?.purchasePrice ?? 0) - (asset?.currentValue ?? 0));
  return <div className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 ${asset ? "" : "hidden"}`} dir="rtl" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-2xl border border-border/40 bg-card p-5 shadow-xl"><div className="mb-4"><h2 className="text-lg font-bold text-foreground">هل تريد إزالة سجل الإهلاك؟</h2><p className="mt-1 text-sm text-muted-foreground">سيُزال سجل الإهلاك فقط. لن يُحذف الأصل أو المنتج أو أي كمية مخزون.</p></div><dl className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3 text-sm"><dt>الأصل</dt><dd className="font-medium">{asset?.name}</dd><dt>رمز الأصل</dt><dd>AJN-A{String(asset?.productId ?? "").padStart(5, "0")}</dd><dt>القيمة الحالية</dt><dd>{formatCurrency(asset?.currentValue ?? 0)}</dd><dt>مبلغ الإهلاك</dt><dd>{formatCurrency(depreciation)}</dd><dt>القيمة بعد الإزالة</dt><dd>{formatCurrency(asset?.purchasePrice ?? 0)}</dd><dt>تاريخ السجل</dt><dd>{asset?.depreciationRecordDate ? new Date(asset.depreciationRecordDate).toLocaleDateString("ar-IQ") : "—"}</dd></dl><label className="mt-3 block text-sm"><span className="mb-1 block">سبب الإزالة <b className="text-destructive">*</b></span><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-20 w-full rounded-lg border border-border/40 bg-background p-2" placeholder="اكتب سبب إزالة سجل الإهلاك" /></label><div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>إلغاء</Button><Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}><Trash2 className="ms-1 h-4 w-4" /> إزالة الإهلاك</Button></div></div></div>;
}

function DepreciationModal({ asset, assets, onClose }: { asset: AssetRow | null; assets: AssetRow[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // When adding: only assets without a saved depreciation record (currentValue derived) — but every product is selectable.
  const [productId, setProductId] = useState<number>(asset?.productId ?? assets[0]?.productId ?? 0);
  const selected = asset ?? assets.find((row) => row.productId === productId) ?? null;
  const usageCount = selected?.usageCount ?? 0;
  const [purchasePrice, setPurchasePrice] = useState<string>(String(asset?.purchasePrice ?? selected?.purchasePrice ?? ""));
  const [expectedLifeUses, setExpectedLifeUses] = useState<string>(String(asset?.expectedLifeUses ?? selected?.expectedLifeUses ?? 50));
  const [currentValue, setCurrentValue] = useState<string>(String(asset?.currentValue ?? selected?.currentValue ?? ""));
  const [serialNumber, setSerialNumber] = useState<string>(asset?.serialNumber ?? selected?.serialNumber ?? "");
  const [status, setStatus] = useState<string>(asset?.status ?? selected?.status ?? "active");
  const [qr, setQr] = useState<AssetQrResponse | null>(null);
  const dna = asset?.dna ?? selected?.dna ?? null;
  // بحث الأصل (بدل القائمة المنسدلة): يفلتر بالاسم أو الرقم التسلسلي من نفس البيانات المحمّلة
  const [assetQuery, setAssetQuery] = useState<string>(asset ? "" : (assets.find((r) => r.productId === productId)?.name ?? ""));
  const [assetOpen, setAssetOpen] = useState(false);
  const assetResults = (() => {
    const q = assetQuery.trim().toLowerCase();
    const list = q ? assets.filter((r) => r.name.toLowerCase().includes(q) || String(r.serialNumber ?? "").toLowerCase().includes(q)) : assets;
    return list.slice(0, 50);
  })();

  // Keep fields in sync when switching the selected asset (add mode).
  function pick(id: number) {
    setProductId(id);
    setQr(null);
    const row = assets.find((r) => r.productId === id);
    if (row) {
      setPurchasePrice(String(row.purchasePrice));
      setExpectedLifeUses(String(row.expectedLifeUses));
      setCurrentValue(String(row.currentValue));
      setSerialNumber(row.serialNumber ?? "");
      setStatus(row.status);
    }
  }

  const price = Math.max(0, Number(purchasePrice) || 0);
  const life = Math.max(1, Math.floor(Number(expectedLifeUses) || 1));
  const computedValue = Math.max(0, price - (price * Math.min(usageCount, life) / life));

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => adminFetch("/admin/assets", { method: "POST", body: JSON.stringify({ productId, serialNumber: serialNumber.trim(), ...payload }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
      toast({ title: "تم حفظ سجل الإهلاك" });
      onClose();
    },
    onError: (err) => toast({ title: "تعذّر الحفظ", description: apiErrorMessage(err), variant: "destructive" }),
  });

  const loadQr = useMutation({
    mutationFn: () => adminFetch<AssetQrResponse>(`/admin/assets/qr?productId=${productId}`),
    onSuccess: (data) => setQr(data),
    onError: (err) => toast({ title: "تعذّر إنشاء رمز QR", description: apiErrorMessage(err), variant: "destructive" }),
  });

  function printQr(data: AssetQrResponse) {
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) return;
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${data.name}</title>
      <style>body{font-family:system-ui,Arial;text-align:center;padding:24px;color:#111}img{width:240px;height:240px}
      .name{font-size:18px;font-weight:700;margin:12px 0 4px}.dna{font-family:monospace;font-size:13px;color:#444}
      .sn{font-size:12px;color:#666;margin-top:4px}</style></head><body>
      <img src="${data.dataUrl}" alt="QR"/><div class="name">${data.name}</div>
      <div class="dna">${data.dna}</div>${data.serialNumber ? `<div class="sn">الرقم التسلسلي: ${data.serialNumber}</div>` : ""}
      <script>window.onload=function(){window.print();}</script></body></html>`);
    w.document.close();
  }

  const inputClass = "w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border/40 bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Package className="h-5 w-5 text-primary" />
            {asset ? "تعديل الإهلاك" : "إضافة سجل إهلاك"}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-background/60"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">الأصل</label>
            {asset ? (
              <div className="rounded-lg border border-border/30 bg-background/50 px-3 py-2 text-sm font-medium text-foreground">{asset.name}</div>
            ) : (
              <div className="relative">
                <input
                  className={inputClass}
                  value={assetQuery}
                  placeholder="ابحث عن الأصل بالاسم أو الرقم التسلسلي..."
                  onChange={(e) => { setAssetQuery(e.target.value); setAssetOpen(true); }}
                  onFocus={() => setAssetOpen(true)}
                  onBlur={() => setTimeout(() => setAssetOpen(false), 150)}
                />
                {assetOpen && (
                  <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border/40 bg-card shadow-xl">
                    {assetResults.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">لا توجد نتائج</div>
                    ) : assetResults.map((row) => (
                      <button
                        key={row.productId}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { pick(row.productId); setAssetQuery(row.name); setAssetOpen(false); }}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm hover:bg-background/60 ${row.productId === productId ? "bg-primary/5 text-primary" : "text-foreground"}`}
                      >
                        <span className="truncate">{row.name}</span>
                        {row.serialNumber ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">SN: {row.serialNumber}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">سعر الشراء</label>
              <input type="number" min={0} className={inputClass} value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">العمر الافتراضي (استخدامات)</label>
              <input type="number" min={1} className={inputClass} value={expectedLifeUses} onChange={(e) => setExpectedLifeUses(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">القيمة المتبقية</label>
            <div className="flex gap-2">
              <input type="number" min={0} className={inputClass} value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} />
              <button
                type="button"
                onClick={() => setCurrentValue(String(Math.round(computedValue)))}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-border/40 bg-background px-3 text-xs text-muted-foreground hover:text-primary"
                title="احتساب القيمة من سعر الشراء والاستخدام"
              >
                <RotateCcw className="h-3.5 w-3.5" /> احتساب
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">القيمة المحتسبة: {formatCurrency(computedValue)} · الاستخدام الحالي {usageCount} / {life}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">الرقم التسلسلي</label>
              <input className={inputClass} value={serialNumber} placeholder="اختياري — فريد لكل أصل" onChange={(e) => setSerialNumber(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">الحالة</label>
              <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">نشط</option>
                <option value="maintenance">صيانة</option>
                <option value="retired">مُستبعد</option>
                <option value="locked">🔒 مقفول</option>
              </select>
            </div>
          </div>
          {dna && (
            <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-background/50 px-3 py-2">
              <Fingerprint className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">البصمة الرقمية (Digital DNA)</p>
                <p className="font-mono text-sm font-semibold text-foreground truncate">{dna}</p>
              </div>
            </div>
          )}
          <div className="rounded-lg border border-border/30 bg-background/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><QrCode className="h-4 w-4 text-primary" /> رمز المسح Scan&Go</span>
              <Button variant="outline" size="sm" disabled={loadQr.isPending || !productId} onClick={() => loadQr.mutate()} className="gap-1">
                {qr ? "تحديث" : "إنشاء رمز"}
              </Button>
            </div>
            {qr && (
              <div className="mt-3 flex items-center gap-3">
                <img src={qr.dataUrl} alt="QR" className="h-24 w-24 rounded-md border border-border/30 bg-white p-1" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-mono text-xs text-foreground truncate">{qr.dna}</p>
                  <p className="text-[11px] text-muted-foreground">يفتح بطاقة حالة الأصل عند المسح</p>
                  <Button variant="ghost" size="sm" onClick={() => printQr(qr)} className="gap-1 text-primary"><Printer className="h-3.5 w-3.5" /> طباعة الملصق</Button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            disabled={save.isPending || !productId}
            onClick={() => save.mutate({ purchasePrice: price, expectedLifeUses: life, currentValue: Math.max(0, Number(currentValue) || 0), status })}
            className="flex-1 gap-1"
          >
            حفظ
          </Button>
          <Button
            variant="outline"
            disabled={save.isPending || !productId}
            onClick={() => save.mutate({ purchasePrice: price, expectedLifeUses: life, status, recalculate: true })}
            className="flex-1 gap-1"
          >
            <RotateCcw className="h-4 w-4" /> إعادة احتساب الإهلاك
          </Button>
        </div>
      </div>
    </div>
  );
}

const MOVEMENT_LABELS: Record<string, string> = {
  checkout: "إخراج من المخزن",
  checkin: "إدخال إلى المخزن",
  available: "متاح",
  reserved: "محجوز",
  maintenance: "صيانة",
  damage: "ضرر",
  repair: "إصلاح",
  inspection: "فحص",
  transferred: "تحويل مخزني",
  lost: "مفقود",
  retired: "مستبعد",
  stock_movement: "حركة مخزون",
  depreciation_paused: "إيقاف الإهلاك",
  depreciation_resumed: "استئناف الإهلاك",
};

function escapeMovementPrint(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function exportMovementCsv(rows: AssetMovementRow[]) {
  const data = [
    ["التاريخ", "الأصل", "الحركة", "التفاصيل", "الكمية", "المستخدم"],
    ...rows.map((row) => [
      formatDate(row.createdAt),
      row.productName,
      MOVEMENT_LABELS[row.type] ?? row.title,
      row.body ?? "",
      row.quantityChange ?? "",
      row.actorName ?? "النظام",
    ]),
  ];
  const csv = data
    .map((line) =>
      line
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `ajn-asset-movements-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function printMovementReport(rows: AssetMovementRow[]) {
  const popup = window.open("", "_blank", "width=1000,height=800");
  if (!popup) throw new Error("تعذّر فتح نافذة الطباعة");
  popup.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>تقرير حركة الأصول</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#000;margin:0}h1{font-size:22px;margin:0}.meta{font-size:12px;margin:6px 0 16px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #000;padding:6px;text-align:right}th{background:#eee}button{margin-bottom:12px}@media print{button{display:none}}</style></head><body><button onclick="window.print()">طباعة / حفظ PDF</button><h1>تقرير حركة الأصول والمخزن</h1><div class="meta">مجموعة علي جان نهاد · ${escapeMovementPrint(new Date().toLocaleString("ar-IQ"))}</div><table><thead><tr><th>التاريخ</th><th>الأصل</th><th>الحركة</th><th>التفاصيل</th><th>الكمية</th><th>المستخدم</th></tr></thead><tbody>${rows
    .map(
      (row) => `<tr><td>${escapeMovementPrint(formatDate(row.createdAt))}</td><td>${escapeMovementPrint(row.productName)}</td><td>${escapeMovementPrint(MOVEMENT_LABELS[row.type] ?? row.title)}</td><td>${escapeMovementPrint(row.body || "—")}</td><td>${escapeMovementPrint(row.quantityChange ?? "—")}</td><td>${escapeMovementPrint(row.actorName || "النظام")}</td></tr>`,
    )
    .join("")}</tbody></table></body></html>`);
  popup.document.close();
  popup.focus();
}

export function AssetMovementsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [scanCode, setScanCode] = useState("");
  const [multiCodes, setMultiCodes] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [scannedIds, setScannedIds] = useState<number[]>([]);
  const [staffId, setStaffId] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [cost, setCost] = useState("");
  const [photoCategory, setPhotoCategory] = useState("current");
  const [saleTarget, setSaleTarget] = useState<number | null>(null);
  const meQuery = useQuery({ queryKey: ["admin", "me"], queryFn: () => fetchAdminMe(), staleTime: 60_000 });

  const assetsQuery = useQuery<{ data: MovementAsset[] }>({
    queryKey: ["admin", "enterprise", "assets"],
    queryFn: () => adminFetch("/admin/enterprise/assets"),
    staleTime: 20_000,
  });
  const staffQuery = useQuery<StaffOption[]>({
    queryKey: ["admin", "staff", "asset-movements"],
    queryFn: () => adminFetch("/admin/staff"),
    staleTime: 60_000,
  });
  const movementsQuery = useQuery<{ data: AssetMovementRow[] }>({
    queryKey: ["admin", "asset-movements", selectedId],
    queryFn: () =>
      adminFetch(
        `/admin/assets/movements${selectedId ? `?productId=${selectedId}` : ""}`,
      ),
    staleTime: 10_000,
  });
  const advisorQuery = useQuery<{ checklist: string[] }>({
    queryKey: ["asset-advisor", selectedId],
    queryFn: () => adminFetch(`/admin/assets/advisor?productId=${selectedId}`),
    enabled: Boolean(selectedId),
    staleTime: 30_000,
  });
  const assets = assetsQuery.data?.data ?? [];
  const selected = assets.find((row) => row.productId === selectedId) ?? null;
  const scanned = scannedIds
    .map((id) => assets.find((row) => row.productId === id))
    .filter((row): row is MovementAsset => Boolean(row));
  const checklist = advisorQuery.data?.checklist ?? [];
  const checklistComplete =
    checklist.length > 0 && checklist.every((item) => checked[item]);

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: ["admin", "enterprise", "assets"],
    });
    queryClient.invalidateQueries({ queryKey: ["admin", "asset-movements"] });
    queryClient.invalidateQueries({ queryKey: ["asset-timeline"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
  };

  function selectAsset(asset: MovementAsset) {
    setSelectedId(asset.productId);
    setScannedIds((current) =>
      current.includes(asset.productId)
        ? current
        : [asset.productId, ...current].slice(0, 50),
    );
    setChecked({});
    setNotes("");
    setCost("");
  }

  const scan = useMutation({
    mutationFn: (code: string) =>
      adminFetch<{
        productId: number;
        name: string;
        assetCode: string;
      }>(`/admin/assets/scan?code=${encodeURIComponent(code)}`),
    onSuccess: (result) => {
      const asset = assets.find((row) => row.productId === result.productId);
      if (asset) selectAsset(asset);
      setScanCode("");
      toast({ title: `تم العثور على ${result.name}` });
    },
    onError: (error) =>
      toast({
        title: "لم يتم العثور على الأصل",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });

  const multiScan = useMutation({
    mutationFn: async (codes: string[]) => {
      const found: number[] = [];
      const failed: string[] = [];
      for (const code of codes) {
        try {
          const result = await adminFetch<{ productId: number }>(
            `/admin/assets/scan?code=${encodeURIComponent(code)}`,
          );
          found.push(result.productId);
        } catch {
          failed.push(code);
        }
      }
      return { found: Array.from(new Set(found)), failed };
    },
    onSuccess: ({ found, failed }) => {
      setScannedIds((current) =>
        Array.from(new Set([...found, ...current])).slice(0, 100),
      );
      if (found[0]) setSelectedId(found[0]);
      setMultiCodes("");
      toast({
        title: `تمت إضافة ${found.length.toLocaleString("ar-IQ")} أصل`,
        description: failed.length
          ? `تعذر التعرّف على ${failed.length.toLocaleString("ar-IQ")} رمز`
          : undefined,
      });
    },
  });

  const checkout = useMutation({
    mutationFn: () =>
      adminFetch("/admin/enterprise/custody", {
        method: "POST",
        body: JSON.stringify({
          productId: selectedId,
          staffId: Number(staffId),
          quantity: 1,
          checklistConfirmed: checklistComplete,
          notes: notes.trim() || null,
        }),
      }),
    onSuccess: () => {
      refresh();
      setChecked({});
      setNotes("");
      toast({ title: "تم إخراج الأصل وتسجيل العهدة" });
    },
    onError: (error) =>
      toast({
        title: "تعذّر إخراج الأصل",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });

  const checkin = useMutation({
    mutationFn: (custodyId: number) =>
      adminFetch(`/admin/enterprise/custody/${custodyId}`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      refresh();
      toast({ title: "تم إرجاع الأصل إلى المخزن" });
    },
    onError: (error) =>
      toast({
        title: "تعذّر إرجاع الأصل",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });

  const action = useMutation({
    mutationFn: (actionName: string) =>
      adminFetch("/admin/assets/action", {
        method: "POST",
        body: JSON.stringify({
          productId: selectedId,
          action: actionName,
          notes: notes.trim() || null,
          cost: Number(cost) || 0,
        }),
      }),
    onSuccess: (_data, actionName) => {
      refresh();
      setNotes("");
      setCost("");
      toast({ title: `تم تسجيل ${MOVEMENT_LABELS[actionName] ?? "الحركة"}` });
    },
    onError: (error) =>
      toast({
        title: "تعذّر تسجيل الحركة",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      const fileUrl = await compressImageFile(file, 1600, 0.82);
      return adminFetch("/admin/documents", {
        method: "POST",
        body: JSON.stringify({
          entityType: "asset",
          entityId: selectedId,
          documentType: "photo",
          title: file.name || "صورة أصل",
          fileName: file.name,
          mimeType: file.type,
          fileUrl,
          metadata: { category: photoCategory },
        }),
      });
    },
    onSuccess: () => {
      refresh();
      toast({ title: "تم حفظ صورة الأصل" });
    },
    onError: (error) =>
      toast({
        title: "تعذّر رفع الصورة",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });

  async function scanImage(file: File) {
    try {
      const Detector = (window as any).BarcodeDetector;
      if (!Detector) throw new Error("المتصفح لا يدعم قراءة QR من الكاميرا");
      const bitmap = await createImageBitmap(file);
      const detector = new Detector({
        formats: ["qr_code", "code_128", "ean_13", "ean_8"],
      });
      const results = await detector.detect(bitmap);
      bitmap.close();
      const value = String(results?.[0]?.rawValue ?? "").trim();
      if (!value) throw new Error("لم يظهر رمز واضح في الصورة");
      scan.mutate(value);
    } catch (error) {
      toast({
        title: "تعذّر قراءة الرمز",
        description: apiErrorMessage(error),
        variant: "destructive",
      });
    }
  }

  const statusCounts = {
    available: assets.filter(
      (row) => row.assetStatus === "active" && !row.custody?.length,
    ).length,
    reserved: assets.filter((row) => row.assetStatus === "reserved").length,
    checkedOut: assets.filter((row) => Boolean(row.custody?.length)).length,
    maintenance: assets.filter((row) => row.assetStatus === "maintenance").length,
    lost: assets.filter((row) => row.assetStatus === "lost").length,
  };
  const movementRows = movementsQuery.data?.data ?? [];

  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader
        icon={ScanLine}
        title="حركة الأصول والمخزن"
        description="مسح QR والباركود، إخراج وإرجاع الأصول، وتسجيل الصيانة والأضرار من شاشة واحدة."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard icon={CheckCircle2} label="متاح" value={statusCounts.available} />
        <StatCard icon={Package} label="محجوز" value={statusCounts.reserved} />
        <StatCard icon={ArrowUpFromLine} label="خارج المخزن" value={statusCounts.checkedOut} />
        <StatCard icon={Wrench} label="صيانة" value={statusCounts.maintenance} />
        <StatCard icon={AlertTriangle} label="مفقود" value={statusCounts.lost} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <ScanLine className="h-4 w-4 text-primary" /> المسح السريع
            </h2>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (scanCode.trim()) scan.mutate(scanCode.trim());
              }}
            >
              <input
                value={scanCode}
                onChange={(event) => setScanCode(event.target.value)}
                placeholder="QR / Barcode / Serial / AJN-A000001"
                autoFocus
                className="min-w-0 flex-1 rounded-lg border border-border/40 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <Button type="submit" size="icon" disabled={scan.isPending || !scanCode.trim()} title="مسح">
                <ScanLine className="h-4 w-4" />
              </Button>
              <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border/40 text-muted-foreground hover:border-primary hover:text-primary" title="التقاط QR بالكاميرا">
                <Camera className="h-4 w-4" />
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void scanImage(file);
                    event.target.value = "";
                  }}
                />
              </label>
            </form>
            <textarea
              value={multiCodes}
              onChange={(event) => setMultiCodes(event.target.value)}
              rows={4}
              placeholder="مسح متعدد: ضع كل رمز في سطر مستقل"
              className="mt-3 w-full resize-none rounded-lg border border-border/40 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <Button
              variant="outline"
              className="mt-2 w-full gap-2"
              disabled={multiScan.isPending || !multiCodes.trim()}
              onClick={() =>
                multiScan.mutate(
                  multiCodes
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean),
                )
              }
            >
              <Boxes className="h-4 w-4" /> إضافة الرموز دفعة واحدة
            </Button>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold text-foreground">قائمة المسح</h2>
              <span className="text-xs text-muted-foreground">{scanned.length}</span>
            </div>
            {!scanned.length ? (
              <p className="text-sm text-muted-foreground">امسح أول أصل لبدء الحركة.</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {scanned.map((asset) => (
                  <button
                    key={asset.productId}
                    type="button"
                    onClick={() => selectAsset(asset)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-right transition-colors ${selectedId === asset.productId ? "border-primary/50 bg-primary/5" : "border-border/30 bg-background/40 hover:border-primary/30"}`}
                  >
                    {asset.imageUrl ? (
                      <img src={asset.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Package className="h-4 w-4" /></span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{asset.productName}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground">{asset.assetCode}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {!selected ? (
            <Card className="min-h-64">
              <EmptyState message="اختر أصلاً من نتيجة المسح لعرض الإجراءات" />
            </Card>
          ) : (
            <>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {selected.imageUrl ? (
                      <img src={selected.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Package className="h-6 w-6" /></span>
                    )}
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-bold text-foreground">{selected.productName}</h2>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{selected.assetCode} · {selected.serialNumber || selected.barcode || "بدون تسلسلي"}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {selected.lastLocation || selected.shelfCode || "داخل المخزن"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected.assetStatus === "active" && hasPerm(meQuery.data ?? null, "asset.sell") ? (
                      <Button variant="outline" className="gap-2 border-primary/35 text-primary" onClick={() => setSaleTarget(selected.productId)}>
                        <BadgeDollarSign className="h-4 w-4" /> بيع الأصل
                      </Button>
                    ) : null}
                    <a href={`/admin/command-center?tab=assets&asset=${selected.productId}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-border/40 px-3 text-sm text-primary hover:border-primary/50">
                      <Fingerprint className="h-4 w-4" /> فتح جواز الأصل
                    </a>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg bg-background/50 p-3"><p className="text-[11px] text-muted-foreground">الحالة</p><p className="mt-1 text-sm font-semibold">{ASSET_STATUS_LABEL[selected.assetStatus] ?? selected.assetStatus}</p></div>
                  <div className="rounded-lg bg-background/50 p-3"><p className="text-[11px] text-muted-foreground">الصحة</p><p className="mt-1 text-sm font-semibold">{selected.healthScore}% · {selected.healthLabel}</p></div>
                  <div className="rounded-lg bg-background/50 p-3"><p className="text-[11px] text-muted-foreground">المخزون</p><p className="mt-1 text-sm font-semibold">{selected.stock}</p></div>
                  <div className="rounded-lg bg-background/50 p-3"><p className="text-[11px] text-muted-foreground">العهدة</p><p className="mt-1 truncate text-sm font-semibold">{selected.custody?.[0]?.staffName || "لا توجد"}</p></div>
                </div>
              </Card>

              <Card>
                <h2 className="mb-3 font-semibold text-foreground">الإجراءات السريعة</h2>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {[
                    ["reserved", "حجز", Package],
                    ["maintenance", "صيانة", Wrench],
                    ["inspection", "فحص", ShieldCheck],
                    ["transferred", "تحويل", Boxes],
                    ["available", "إتاحة", CheckCircle2],
                    ["damage", "ضرر", AlertTriangle],
                    ["repair", "إصلاح", LifeBuoy],
                    ["lost", "مفقود", XCircle],
                    ["retired", "استبعاد", Archive],
                  ].map(([key, label, Icon]) => (
                    <Button key={String(key)} variant="outline" size="sm" disabled={action.isPending || ["sold", "disposed"].includes(selected.assetStatus)} onClick={() => action.mutate(String(key))} className="gap-1.5">
                      <Icon className="h-3.5 w-3.5" /> {String(label)}
                    </Button>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_160px]">
                  <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظات الحركة أو وصف الضرر" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                  <input type="number" min="0" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="تكلفة الإصلاح" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <h2 className="flex items-center gap-2 font-semibold text-foreground"><ArrowUpFromLine className="h-4 w-4 text-primary" /> إخراج / إرجاع</h2>
                  {selected.custody?.length ? (
                    <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <p className="text-sm text-foreground">بعهدة {selected.custody[0].staffName || "موظف"}</p>
                      <Button className="mt-3 w-full gap-2" disabled={checkin.isPending} onClick={() => checkin.mutate(selected.custody![0].id)}>
                        <ArrowDownToLine className="h-4 w-4" /> Check-In إلى المخزن
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      <select value={staffId} onChange={(event) => setStaffId(event.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                        <option value="">اختر الموظف المستلم</option>
                        {(staffQuery.data ?? []).filter((staff) => staff.isActive).map((staff) => <option key={staff.id} value={staff.id}>{staff.fullName || staff.username}</option>)}
                      </select>
                      <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-border/30 p-3">
                        {advisorQuery.isLoading ? <Skeleton className="h-20" /> : checklist.map((item) => (
                          <label key={item} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                            <input type="checkbox" checked={Boolean(checked[item])} onChange={(event) => setChecked((current) => ({ ...current, [item]: event.target.checked }))} />
                            {item}
                          </label>
                        ))}
                      </div>
                      <Button className="w-full gap-2" disabled={checkout.isPending || !staffId || !checklistComplete || ["sold", "disposed"].includes(selected.assetStatus)} onClick={() => checkout.mutate()}>
                        <ArrowUpFromLine className="h-4 w-4" /> Check-Out وتسجيل العهدة
                      </Button>
                    </div>
                  )}
                </Card>

                <Card>
                  <h2 className="flex items-center gap-2 font-semibold text-foreground"><Camera className="h-4 w-4 text-primary" /> صورة الحركة</h2>
                  <select value={photoCategory} onChange={(event) => setPhotoCategory(event.target.value)} className="mt-3 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                    <option value="current">الحالة الحالية</option>
                    <option value="checkout">قبل الإخراج</option>
                    <option value="checkin">بعد الإرجاع</option>
                    <option value="damage">ضرر</option>
                    <option value="maintenance">صيانة</option>
                    <option value="before_repair">قبل الإصلاح</option>
                    <option value="after_repair">بعد الإصلاح</option>
                  </select>
                  <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border/50 py-8 text-sm text-muted-foreground hover:border-primary hover:text-primary">
                    <Upload className="h-4 w-4" /> {uploadPhoto.isPending ? "جارٍ الرفع..." : "رفع أو التقاط صورة"}
                    <input type="file" accept="image/*" capture="environment" className="hidden" disabled={uploadPhoto.isPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadPhoto.mutate(file); event.target.value = ""; }} />
                  </label>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-foreground"><History className="h-4 w-4 text-primary" /> سجل الحركات</h2>
            <p className="mt-1 text-xs text-muted-foreground">{selected ? `الحركات الخاصة بـ ${selected.productName}` : "آخر حركات جميع الأصول"}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1" disabled={!movementRows.length} onClick={() => printMovementReport(movementRows)}><Printer className="h-4 w-4" /> PDF / طباعة</Button>
            <Button variant="outline" size="sm" className="gap-1" disabled={!movementRows.length} onClick={() => exportMovementCsv(movementRows)}><Download className="h-4 w-4" /> Excel / CSV</Button>
          </div>
        </div>
        {movementsQuery.isLoading ? <LoadingRows /> : !movementRows.length ? <EmptyState message="لا توجد حركات مسجلة" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-background/50 text-muted-foreground"><tr><th className="p-3 text-right">التاريخ</th><th className="p-3 text-right">الأصل</th><th className="p-3 text-right">الحركة</th><th className="p-3 text-right">التفاصيل</th><th className="p-3 text-right">الكمية</th><th className="p-3 text-right">المستخدم</th></tr></thead>
              <tbody className="divide-y divide-border/20">
                {movementRows.map((row) => <tr key={row.id} className="hover:bg-background/30"><td className="p-3 text-xs text-muted-foreground">{formatDate(row.createdAt)}</td><td className="p-3 font-medium text-foreground">{row.productName}</td><td className="p-3">{MOVEMENT_LABELS[row.type] ?? row.title}</td><td className="max-w-xs truncate p-3 text-muted-foreground">{row.body || row.title}</td><td className="p-3">{row.quantityChange == null ? "—" : row.quantityChange > 0 ? `+${row.quantityChange}` : row.quantityChange}</td><td className="p-3 text-muted-foreground">{row.actorName || "النظام"}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {saleTarget ? <AssetSaleDialog productId={saleTarget} open onOpenChange={(open) => !open && setSaleTarget(null)} /> : null}
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
              <p className="mt-2 text-xs text-status-warning">مقترح إرسالها للصيانة الآن.</p>
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
  const restore = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/disaster-recovery/${id}/restore`, {
      method: "POST",
      body: JSON.stringify({ confirm: "AJN-RESTORE-CONFIRMED" }),
    }),
    onSuccess: () => {
      toast({ title: "تم استرجاع النسخة" });
      qc.invalidateQueries({ queryKey: ["admin", "disaster-recovery"] });
    },
    onError: (err) => toast({ title: "تعذر الاسترجاع", description: apiErrorMessage(err), variant: "destructive" }),
  });
  async function downloadSnapshot(row: any) {
    try {
      const res = await fetch(`/api/admin/disaster-recovery/${row.id}/download`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${row.snapshotNo || "ajn-backup"}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "تعذر تحميل النسخة", description: apiErrorMessage(err), variant: "destructive" });
    }
  }
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
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs ${statusClass(row.status)}`}>{STATUS_LABELS[row.status] ?? row.status}</span>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => downloadSnapshot(row)}><Download className="h-3.5 w-3.5" /> تنزيل</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    disabled={restore.isPending}
                    onClick={() => {
                      if (window.confirm("سيتم استرجاع البيانات المفقودة من هذه النسخة دون حذف البيانات الحالية. هل تريد المتابعة؟")) restore.mutate(row.id);
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> استرجاع
                  </Button>
                </div>
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
    queryKey: ["admin", "activity-timeline", entity],
    queryFn: () => adminFetch(`/admin/activity-timeline?entityType=${encodeURIComponent(entity.entityType)}&entityId=${encodeURIComponent(entity.entityId)}`),
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
          <TimelineList rows={(financialTimeline.data?.data ?? []).map((row: any) => ({ id: row.id, title: row.description || row.transactionNo, body: `${row.sourceEvent || row.type} · ${row.direction} · ${formatCurrency(row.amount)}${row.reversalTxnId || row.reversedTransactionId ? " · عكس مالي" : ""}`, actorName: row.executedByName || row.approvedByName || row.requestedByName || row.status, createdAt: row.createdAt }))} loading={financialTimeline.isFetching} empty={financeEnabled ? "لا توجد حركات مالية" : "حدد المصدر لعرض الحركات"} />
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold text-foreground">خط المخزون</h2>
          <input value={productId} onChange={(e) => setProductId(e.target.value.replace(/\D/g, ""))} placeholder="رقم المنتج" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
          <TimelineList rows={(inventoryTimeline.data?.data ?? []).map((row: any) => ({ id: row.id, title: row.eventLabel || row.reason, body: `${row.reason} · التغيير ${row.quantityChange} · ${row.productName || `المنتج ${row.productId}`}${row.stockSourceProductName ? ` · المصدر ${row.stockSourceProductName}` : ""}`, actorName: row.createdByName, createdAt: row.createdAt }))} loading={inventoryTimeline.isFetching} empty={inventoryEnabled ? "لا توجد حركات مخزون" : "أدخل رقم المنتج"} />
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
