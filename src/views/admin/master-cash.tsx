import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CircleDollarSign,
  FileDown,
  FileSpreadsheet,
  Filter,
  History,
  Landmark,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  Wallet,
  X,
  RotateCcw,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { downloadElementPdf } from "@/lib/pdf";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, formatCurrency, formatMoney, type AdminMe } from "./_lib";
import { EmptyState } from "./_layout";

type CashBoxDashboard = {
  cashBox: {
    id: number;
    name: string;
    openingBalance: number;
    currentBalance: number;
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    availableBalance: number;
    updatedAt: string;
  };
  today: { revenue: number; expenses: number; net: number };
  pending: { count: number; amount: number };
  outstanding: number;
  overdue: number;
  damageLosses: number;
  departments: Array<{ department: string; revenue: number; expenses: number; profit: number }>;
  trend: Array<{ month: string; revenue: number; expenses: number }>;
};

type FinancialTransaction = {
  id: number;
  transactionNo: string;
  transactionDate: string;
  direction: "revenue" | "expense";
  amount: string;
  department: string;
  transactionType: string;
  description: string;
  paymentMethod: string;
  sourceType: string | null;
  sourceId: string | null;
  approvalStatus: "draft" | "pending" | "approved" | "rejected" | "executed";
  requestedByName: string;
  approvedByName: string;
  executedByName: string;
  rejectionReason: string | null;
  balanceBefore: string | null;
  balanceAfter: string | null;
  notes: string | null;
  createdAt: string;
  reversedAt?: string | null;
  reversalTxnId?: number | null;
  reversedTransactionId?: number | null;
  reversalReason?: string | null;
  reversedByName?: string | null;
};

type TransactionList = {
  data: FinancialTransaction[];
  page: number;
  limit: number;
  total: number;
  totals: { revenue: number; expenses: number; net: number; pending: number };
};

type TransactionDetail = FinancialTransaction & {
  entries: Array<{ id: number; side: "debit" | "credit"; amount: string; accountCode: string; accountName: string; description: string }>;
  audits: Array<{ id: number; action: string; actorName: string; reason: string | null; createdAt: string }>;
};

const DEPARTMENTS = [
  { value: "general", label: "عام" },
  { value: "store", label: "المتجر" },
  { value: "koshas", label: "الكوشات" },
  { value: "photography", label: "التصوير" },
  { value: "audio", label: "الصوتيات" },
  { value: "gifts", label: "الهدايا والتوزيعات" },
  { value: "inventory", label: "المخزون والخسائر" },
] as const;

const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  approved: "معتمدة",
  rejected: "مرفوضة",
  executed: "منفذة",
};

const STATUS_CLASSES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending: "bg-status-warning/10 text-status-warning",
  approved: "bg-primary/10 text-primary",
  rejected: "bg-destructive/10 text-destructive",
  executed: "bg-status-success/10 text-status-success",
};

const inputClass = "h-10 w-full rounded-lg border border-border/40 bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/10";
const textareaClass = `${inputClass} h-auto min-h-20 py-2 resize-y`;

function todayBaghdad() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(day: string, value: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + value);
  return date.toISOString().slice(0, 10);
}

function departmentLabel(value: string) {
  return DEPARTMENTS.find((item) => item.value === value)?.label ?? value;
}

function downloadCsv(rows: FinancialTransaction[]) {
  const headers = ["رقم الحركة", "التاريخ", "القسم", "النوع", "الاتجاه", "المبلغ", "الحالة", "بواسطة", "الوصف"];
  const values = rows.map((row) => [
    row.transactionNo,
    row.transactionDate,
    departmentLabel(row.department),
    row.transactionType,
    row.direction === "revenue" ? "إيراد" : "مصروف",
    row.amount,
    STATUS_LABELS[row.approvalStatus] ?? row.approvalStatus,
    row.requestedByName,
    row.description,
  ]);
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...values].map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `master-cash-${todayBaghdad()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Stat({ label, value, icon: Icon, tone = "text-primary" }: { label: string; value: string; icon: typeof Wallet; tone?: string }) {
  return (
    <div className="min-w-0 border-b border-border/25 px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-l sm:last:border-l-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
      </div>
      <p className={`truncate text-base font-bold ${tone}`} title={value}>{value}</p>
    </div>
  );
}

function TransactionForm({ onSaved, compact = false }: { onSaved: () => void; compact?: boolean }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    transactionDate: todayBaghdad(),
    direction: "expense",
    amount: "",
    department: "general",
    transactionType: "general_expense",
    description: "",
    paymentMethod: "cash",
    approvalStatus: "pending",
    customerName: "",
    dueDate: "",
    notes: "",
  });
  const save = useMutation({
    mutationFn: (status: "draft" | "pending") => adminFetch("/admin/master-cash/transactions", {
      method: "POST",
      body: JSON.stringify({ ...form, approvalStatus: status, amount: Number(form.amount), dueDate: form.dueDate || null }),
    }),
    onSuccess: (_data, status) => {
      setForm((current) => ({ ...current, amount: "", description: "", customerName: "", dueDate: "", notes: "" }));
      toast({ title: status === "draft" ? "تم حفظ المسودة" : "تم إرسال الطلب المالي للموافقة" });
      onSaved();
    },
    onError: (error: Error) => toast({ title: "تعذر حفظ الطلب المالي", description: error.message, variant: "destructive" }),
  });

  return (
    <form onSubmit={(event) => { event.preventDefault(); save.mutate("pending"); }} className={compact ? "space-y-3" : "grid gap-3 md:grid-cols-2 xl:grid-cols-4"}>
      <label className="space-y-1 text-xs text-muted-foreground">التاريخ<input type="date" value={form.transactionDate} onChange={(event) => setForm({ ...form, transactionDate: event.target.value })} className={inputClass} /></label>
      <label className="space-y-1 text-xs text-muted-foreground">نوع الحركة<select value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value, transactionType: event.target.value === "revenue" ? "manual_revenue" : "general_expense" })} className={inputClass}><option value="revenue">إيراد</option><option value="expense">مصروف</option></select></label>
      <label className="space-y-1 text-xs text-muted-foreground">المبلغ<input inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value.replace(/[^0-9.]/g, "") })} placeholder="0" className={inputClass} /></label>
      <label className="space-y-1 text-xs text-muted-foreground">القسم<select value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} className={inputClass}>{DEPARTMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="space-y-1 text-xs text-muted-foreground">نوع المعاملة<input value={form.transactionType} onChange={(event) => setForm({ ...form, transactionType: event.target.value.replace(/[^a-zA-Z0-9_-]/g, "") })} className={inputClass} /></label>
      <label className="space-y-1 text-xs text-muted-foreground">طريقة الدفع<select value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })} className={inputClass}><option value="cash">نقد</option><option value="transfer">تحويل</option><option value="pos">بطاقة / POS</option><option value="other">أخرى</option></select></label>
      <label className="space-y-1 text-xs text-muted-foreground">الزبون / المستفيد<input value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} className={inputClass} /></label>
      <label className="space-y-1 text-xs text-muted-foreground">تاريخ الاستحقاق<input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} className={inputClass} /></label>
      <label className={compact ? "block space-y-1 text-xs text-muted-foreground" : "space-y-1 text-xs text-muted-foreground md:col-span-2 xl:col-span-3"}>الوصف<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={inputClass} placeholder="سبب الحركة أو مرجعها" /></label>
      <label className={compact ? "block space-y-1 text-xs text-muted-foreground" : "space-y-1 text-xs text-muted-foreground md:col-span-2 xl:col-span-3"}>ملاحظات<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className={textareaClass} /></label>
      <div className={compact ? "flex gap-2" : "flex items-end gap-2"}>
        <Button type="submit" disabled={save.isPending || !form.amount || !form.transactionType} className="flex-1 gap-1.5">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} إرسال للموافقة
        </Button>
        <Button type="button" variant="outline" disabled={save.isPending || !form.amount || !form.transactionType} onClick={() => save.mutate("draft")}>مسودة</Button>
      </div>
    </form>
  );
}

export function FinancialRequestPage() {
  const queryClient = useQueryClient();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div><h1 className="text-2xl font-bold text-foreground">طلب حركة مالية</h1><p className="mt-1 text-sm text-muted-foreground">يُرسل الطلب للمدير، ولا يتغير رصيد الصندوق قبل الاعتماد.</p></div>
      <div className="rounded-xl border border-border/30 bg-card p-5"><TransactionForm compact onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin", "master-cash"] })} /></div>
    </div>
  );
}

export default function MasterCashBoxPage({ me }: { me: AdminMe }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const reportRef = useRef<HTMLDivElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ from: addDays(todayBaghdad(), -30), to: todayBaghdad(), status: "", direction: "", department: "", search: "" });
  const isManager = me.role === "admin" || me.role === "manager";

  const dashboard = useQuery({
    queryKey: ["admin", "master-cash", "dashboard"],
    queryFn: () => adminFetch<CashBoxDashboard>("/admin/master-cash/dashboard"),
    refetchInterval: 15_000,
  });
  const queryString = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    page: String(page),
    limit: "20",
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.department ? { department: filters.department } : {}),
    ...(filters.search ? { search: filters.search } : {}),
  }).toString();
  const transactions = useQuery({
    queryKey: ["admin", "master-cash", "transactions", queryString],
    queryFn: () => adminFetch<TransactionList>(`/admin/master-cash/transactions?${queryString}`),
    refetchInterval: 15_000,
  });
  const detail = useQuery({
    queryKey: ["admin", "master-cash", "transaction", selectedId],
    queryFn: () => adminFetch<TransactionDetail>(`/admin/master-cash/transactions/${selectedId}`),
    enabled: selectedId !== null,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "master-cash"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "finance"] });
  };
  const approve = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/master-cash/transactions/${id}/approve`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => { invalidate(); toast({ title: "تم اعتماد وتنفيذ المعاملة" }); },
    onError: (error: Error) => toast({ title: "تعذر اعتماد المعاملة", description: error.message, variant: "destructive" }),
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => adminFetch(`/admin/master-cash/transactions/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidate(); toast({ title: "تم رفض المعاملة" }); },
    onError: (error: Error) => toast({ title: "تعذر رفض المعاملة", description: error.message, variant: "destructive" }),
  });
  const recalculate = useMutation({
    mutationFn: () => adminFetch("/admin/master-cash/recalculate", { method: "POST" }),
    onSuccess: () => { invalidate(); toast({ title: "تمت مطابقة الصندوق مع القيود المنفذة" }); },
    onError: (error: Error) => toast({ title: "تعذر إعادة الاحتساب", description: error.message, variant: "destructive" }),
  });
  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => adminFetch(`/admin/master-cash/transactions/${id}/reverse`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidate(); queryClient.invalidateQueries({ queryKey: ["admin", "master-cash", "transaction"] }); toast({ title: "تم عكس الحركة المالية" }); },
    onError: (error: Error) => toast({ title: "تعذر عكس الحركة", description: error.message, variant: "destructive" }),
  });

  const rows = transactions.data?.data ?? [];
  const pendingRows = useMemo(() => rows.filter((row) => row.approvalStatus === "pending"), [rows]);

  if (dashboard.isLoading || !dashboard.data) {
    return <div className="space-y-4"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-64 rounded-xl" /><Skeleton className="h-80 rounded-xl" /></div>;
  }

  const data = dashboard.data;
  return (
    <div ref={reportRef} className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-foreground">الصندوق الرئيسي</h1><p className="mt-1 text-sm text-muted-foreground">كل حركة تمر بالموافقة ثم تُسجل بقيد مدين ودائن.</p></div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button size="sm" onClick={() => setShowForm((value) => !value)} className="gap-1.5"><Plus className="h-4 w-4" /> طلب مالي</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()} className="gap-1.5"><Printer className="h-4 w-4" /> طباعة</Button>
          <Button size="sm" variant="outline" onClick={() => reportRef.current && downloadElementPdf(reportRef.current, `master-cash-${todayBaghdad()}.pdf`)} className="gap-1.5"><FileDown className="h-4 w-4" /> PDF</Button>
          <Button size="sm" variant="outline" onClick={() => downloadCsv(rows)} className="gap-1.5"><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
          {isManager && <Button size="icon" variant="outline" title="إعادة احتساب الصندوق" disabled={recalculate.isPending} onClick={() => recalculate.mutate()}>{recalculate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</Button>}
        </div>
      </div>

      {showForm && <div className="rounded-xl border border-primary/25 bg-card p-4 print:hidden"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold text-foreground">طلب حركة مالية جديدة</h2><p className="text-xs text-muted-foreground">لن يتغير الرصيد قبل موافقة المدير.</p></div><Button size="icon" variant="ghost" onClick={() => setShowForm(false)}><X className="h-4 w-4" /></Button></div><TransactionForm onSaved={() => { invalidate(); setShowForm(false); }} /></div>}

      <div className="overflow-hidden rounded-xl border border-border/30 bg-card">
        <div className="grid sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="الرصيد الحالي" value={formatCurrency(data.cashBox.currentBalance)} icon={Wallet} />
          <Stat label="الرصيد المتاح" value={formatCurrency(data.cashBox.availableBalance)} icon={CircleDollarSign} />
          <Stat label="إجمالي الإيرادات" value={formatCurrency(data.cashBox.totalRevenue)} icon={ArrowUpRight} tone="text-status-success" />
          <Stat label="إجمالي المصاريف" value={formatCurrency(data.cashBox.totalExpenses)} icon={ArrowDownLeft} tone="text-destructive" />
          <Stat label="صافي الربح" value={formatCurrency(data.cashBox.netProfit)} icon={Landmark} tone={data.cashBox.netProfit >= 0 ? "text-primary" : "text-destructive"} />
          <Stat label="بانتظار الموافقة" value={`${data.pending.count.toLocaleString("ar-IQ")} · ${formatCurrency(data.pending.amount)}`} icon={ShieldCheck} tone="text-status-warning" />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.4fr]">
        <div className="rounded-xl bg-card p-4"><p className="text-xs text-muted-foreground">حركة اليوم</p><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div><p className="text-xs text-muted-foreground">إيراد</p><p className="mt-1 font-bold text-status-success">{formatCurrency(data.today.revenue)}</p></div><div><p className="text-xs text-muted-foreground">مصروف</p><p className="mt-1 font-bold text-destructive">{formatCurrency(data.today.expenses)}</p></div><div><p className="text-xs text-muted-foreground">الصافي</p><p className="mt-1 font-bold text-primary">{formatCurrency(data.today.net)}</p></div></div></div>
        <div className="rounded-xl bg-card p-4"><p className="text-xs text-muted-foreground">ذمم الزبائن</p><div className="mt-3 flex items-end justify-between gap-4"><div><p className="text-xs text-muted-foreground">المتبقي</p><p className="mt-1 font-bold text-foreground">{formatCurrency(data.outstanding)}</p></div><div className="text-left"><p className="text-xs text-muted-foreground">المتأخر</p><p className="mt-1 font-bold text-status-warning">{formatCurrency(data.overdue)}</p></div></div></div>
        <div className="rounded-xl bg-card p-4"><div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">التلف والخسائر هذا الشهر</p><TriangleAlert className="h-4 w-4 text-status-warning" /></div><p className="mt-3 text-xl font-bold text-foreground">{formatCurrency(data.damageLosses)}</p><p className="mt-1 text-xs text-muted-foreground">تُسجل مع المنتج والموظف المسؤول ضمن حركة مالية مدققة.</p></div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="print:hidden"><TabsTrigger value="overview">الملخص</TabsTrigger><TabsTrigger value="ledger">دفتر الحركات</TabsTrigger><TabsTrigger value="approvals">الموافقات ({data.pending.count})</TabsTrigger></TabsList>
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <div className="rounded-xl border border-border/30 bg-card p-4"><h2 className="mb-4 font-semibold text-foreground">اتجاه الإيرادات والمصاريف</h2>{data.trend.length === 0 ? <EmptyState message="لا توجد حركات منفذة لعرض الاتجاه" /> : <div className="h-72" dir="ltr"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.trend}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} /><YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickFormatter={(value) => formatMoney(Number(value))} /><Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={(value) => formatCurrency(Number(value))} /><Legend /><Bar dataKey="revenue" name="الإيرادات" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /><Bar dataKey="expenses" name="المصاريف" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}</div>
            <div className="rounded-xl border border-border/30 bg-card p-4"><h2 className="mb-4 font-semibold text-foreground">ربحية الأقسام هذا الشهر</h2>{data.departments.length === 0 ? <EmptyState message="لا توجد حركات منفذة حسب الأقسام" /> : <div className="space-y-2">{data.departments.map((row) => <div key={row.department} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg bg-background/55 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{departmentLabel(row.department)}</p><p className="mt-0.5 text-xs text-muted-foreground">إيراد {formatCurrency(row.revenue)} · مصروف {formatCurrency(row.expenses)}</p></div><p className={`text-sm font-bold ${row.profit >= 0 ? "text-primary" : "text-destructive"}`}>{formatCurrency(row.profit)}</p></div>)}</div>}</div>
          </div>
        </TabsContent>

        <TabsContent value="ledger" className="space-y-3">
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border/30 bg-card p-3 print:hidden"><Filter className="mb-2 h-4 w-4 text-muted-foreground" /><input type="date" value={filters.from} onChange={(event) => { setFilters({ ...filters, from: event.target.value }); setPage(1); }} className={`${inputClass} w-auto`} /><input type="date" value={filters.to} onChange={(event) => { setFilters({ ...filters, to: event.target.value }); setPage(1); }} className={`${inputClass} w-auto`} /><select value={filters.status} onChange={(event) => { setFilters({ ...filters, status: event.target.value }); setPage(1); }} className={`${inputClass} w-auto`}><option value="">كل الحالات</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={filters.department} onChange={(event) => { setFilters({ ...filters, department: event.target.value }); setPage(1); }} className={`${inputClass} w-auto`}><option value="">كل الأقسام</option>{DEPARTMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><label className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" /><input value={filters.search} onChange={(event) => { setFilters({ ...filters, search: event.target.value }); setPage(1); }} placeholder="رقم الحركة أو الوصف أو الزبون" className={`${inputClass} pr-9`} /></label></div>
          <TransactionTable rows={rows} loading={transactions.isLoading} isManager={isManager} onOpen={setSelectedId} onApprove={(id) => approve.mutate(id)} onReject={(id) => { const reason = window.prompt("سبب رفض المعاملة"); if (reason) reject.mutate({ id, reason }); }} busy={approve.isPending || reject.isPending} />
          {(transactions.data?.total ?? 0) > 20 && <div className="flex items-center justify-between print:hidden"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</Button><span className="text-xs text-muted-foreground">صفحة {page.toLocaleString("ar-IQ")} من {Math.ceil((transactions.data?.total ?? 0) / 20).toLocaleString("ar-IQ")}</span><Button variant="outline" size="sm" disabled={page * 20 >= (transactions.data?.total ?? 0)} onClick={() => setPage((value) => value + 1)}>التالي</Button></div>}
        </TabsContent>

        <TabsContent value="approvals"><TransactionTable rows={pendingRows} loading={transactions.isLoading} isManager={isManager} onOpen={setSelectedId} onApprove={(id) => approve.mutate(id)} onReject={(id) => { const reason = window.prompt("سبب رفض المعاملة"); if (reason) reject.mutate({ id, reason }); }} busy={approve.isPending || reject.isPending} emptyMessage="لا توجد معاملات بانتظار الموافقة ضمن الصفحة الحالية" /></TabsContent>
      </Tabs>

      <Dialog open={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}><DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto" dir="rtl"><DialogHeader><DialogTitle>تفاصيل الحركة المالية</DialogTitle></DialogHeader>{detail.isLoading || !detail.data ? <Skeleton className="h-72 rounded-xl" /> : <TransactionDetailView data={detail.data} isManager={isManager} busy={reverse.isPending} onReverse={(reason) => reverse.mutate({ id: detail.data!.id, reason })} />}</DialogContent></Dialog>
    </div>
  );
}

function TransactionTable({ rows, loading, isManager, onOpen, onApprove, onReject, busy, emptyMessage = "لا توجد حركات ضمن الفلاتر" }: { rows: FinancialTransaction[]; loading: boolean; isManager: boolean; onOpen: (id: number) => void; onApprove: (id: number) => void; onReject: (id: number) => void; busy: boolean; emptyMessage?: string }) {
  return <div className="overflow-x-auto rounded-xl border border-border/30 bg-card">{loading ? <div className="p-5"><Skeleton className="h-56 rounded-xl" /></div> : rows.length === 0 ? <EmptyState message={emptyMessage} /> : <table className="w-full min-w-[920px] text-sm"><thead><tr className="border-b border-border/30 text-xs text-muted-foreground">{["رقم الحركة", "التاريخ", "القسم", "البيان", "الاتجاه", "المبلغ", "الحالة", "بواسطة", "إجراء"].map((label) => <th key={label} className="px-3 py-3 text-center font-medium">{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-border/15 transition-colors hover:bg-primary/[0.025]"><td className="px-3 py-3 text-center font-mono text-xs text-primary"><button onClick={() => onOpen(row.id)} className="hover:underline">{row.transactionNo}</button></td><td className="px-3 py-3 text-center text-muted-foreground">{row.transactionDate}</td><td className="px-3 py-3 text-center">{departmentLabel(row.department)}</td><td className="max-w-56 px-3 py-3"><p className="truncate text-foreground" title={row.description}>{row.description || row.transactionType}</p><p className="text-xs text-muted-foreground">{row.transactionType}</p></td><td className={`px-3 py-3 text-center font-medium ${row.direction === "revenue" ? "text-status-success" : "text-destructive"}`}>{row.direction === "revenue" ? "إيراد" : "مصروف"}</td><td className="px-3 py-3 text-center font-bold text-foreground">{formatCurrency(row.amount)}</td><td className="px-3 py-3 text-center"><span className={`inline-flex rounded-full px-2 py-1 text-[11px] ${STATUS_CLASSES[row.approvalStatus] ?? "bg-muted text-muted-foreground"}`}>{STATUS_LABELS[row.approvalStatus] ?? row.approvalStatus}</span></td><td className="px-3 py-3 text-center text-xs text-muted-foreground">{row.requestedByName || "النظام"}</td><td className="px-3 py-3"><div className="flex justify-center gap-1"><Button size="sm" variant="outline" onClick={() => onOpen(row.id)}><History className="h-3.5 w-3.5" /></Button>{isManager && row.approvalStatus === "pending" && <><Button size="sm" disabled={busy} onClick={() => onApprove(row.id)} className="gap-1"><Check className="h-3.5 w-3.5" /> اعتماد</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => onReject(row.id)} className="text-destructive hover:text-destructive"><X className="h-3.5 w-3.5" /></Button></>}</div></td></tr>)}</tbody></table>}</div>;
}

function TransactionDetailView({ data, isManager, busy, onReverse }: { data: TransactionDetail; isManager: boolean; busy: boolean; onReverse: (reason: string) => void }) {
  const isReversed = !!data.reversedAt;
  const isReversalEntry = data.transactionType.endsWith("_reversal") || !!data.reversedTransactionId;
  const canReverse = isManager && data.approvalStatus === "executed" && !isReversed && !isReversalEntry;
  return <div className="space-y-4">
    {isReversed && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">تم عكس هذه الحركة{data.reversedByName ? ` بواسطة ${data.reversedByName}` : ""}{data.reversalReason ? ` · السبب: ${data.reversalReason}` : ""}.</div>}
    {isReversalEntry && <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-sm text-status-warning">هذه حركة عكسية (تصحيح){data.reversedTransactionId ? ` للحركة رقم ${data.reversedTransactionId}` : ""}.</div>}
    {canReverse && <button type="button" disabled={busy} onClick={() => { const reason = window.prompt("سبب عكس الحركة (إلزامي، 3 أحرف فأكثر):"); if (reason === null) return; if (reason.trim().length < 3) { window.alert("يجب إدخال سبب لا يقل عن 3 أحرف"); return; } onReverse(reason.trim()); }} className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"><RotateCcw className="h-4 w-4" /> عكس الحركة (إلغاء أثرها)</button>}
    <div className="grid gap-3 rounded-xl bg-background/55 p-4 sm:grid-cols-2"><p className="text-sm"><span className="text-muted-foreground">رقم الحركة: </span><b className="font-mono text-primary">{data.transactionNo}</b></p><p className="text-sm"><span className="text-muted-foreground">الحالة: </span>{STATUS_LABELS[data.approvalStatus] ?? data.approvalStatus}</p><p className="text-sm"><span className="text-muted-foreground">القسم: </span>{departmentLabel(data.department)}</p><p className="text-sm"><span className="text-muted-foreground">المبلغ: </span><b>{formatCurrency(data.amount)}</b></p><p className="text-sm"><span className="text-muted-foreground">الرصيد قبل: </span>{data.balanceBefore == null ? "—" : formatCurrency(data.balanceBefore)}</p><p className="text-sm"><span className="text-muted-foreground">الرصيد بعد: </span>{data.balanceAfter == null ? "—" : formatCurrency(data.balanceAfter)}</p></div><section><h3 className="mb-2 text-sm font-semibold text-foreground">القيد المزدوج</h3>{data.entries.length === 0 ? <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">لم تُنفذ المعاملة بعد، لذلك لم تُنشأ القيود.</p> : <div className="overflow-hidden rounded-lg border border-border/30"><table className="w-full text-sm"><thead><tr className="bg-background/60 text-xs text-muted-foreground"><th className="px-3 py-2 text-right">الحساب</th><th className="px-3 py-2">مدين</th><th className="px-3 py-2">دائن</th></tr></thead><tbody>{data.entries.map((entry) => <tr key={entry.id} className="border-t border-border/20"><td className="px-3 py-2"><span className="font-mono text-xs text-primary">{entry.accountCode}</span> · {entry.accountName}</td><td className="px-3 py-2 text-center">{entry.side === "debit" ? formatCurrency(entry.amount) : "—"}</td><td className="px-3 py-2 text-center">{entry.side === "credit" ? formatCurrency(entry.amount) : "—"}</td></tr>)}</tbody></table></div>}</section><section><h3 className="mb-2 text-sm font-semibold text-foreground">سجل التدقيق</h3><div className="space-y-2">{data.audits.map((audit) => <div key={audit.id} className="flex items-start justify-between gap-3 rounded-lg bg-background/55 px-3 py-2"><div><p className="text-sm text-foreground">{audit.action}</p><p className="text-xs text-muted-foreground">{audit.actorName || "النظام"}{audit.reason ? ` · ${audit.reason}` : ""}</p></div><time className="shrink-0 text-xs text-muted-foreground">{new Date(audit.createdAt).toLocaleString("ar-IQ")}</time></div>)}</div></section></div>;
}
