import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  AlertTriangle, ArrowRight, BarChart3, Check, ChevronDown, ChevronLeft, ClipboardCheck, FileText, Loader2, PackageCheck,
  Pencil, Plus, Printer, RefreshCw, RotateCcw, Search, Send, ShieldCheck, Undo2, Wallet, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";
import { useSalesReturnPrint, settlementLine } from "@/components/sales-return-print";
import {
  INVENTORY_STATE_LABELS, RETURN_CONDITIONS, RETURN_REASONS, RETURN_STATUS_LABELS, allocateFifo, fromCents, fromMilli,
  returnAmountCents, returnConditionLabel, returnReasonLabel, toCents, toMilli, validateAllocation, type ReturnCondition, type ReturnableLine,
} from "@/lib/sales-returns";
import { DateField } from "@/components/ui/date-field";

// ── Types (server DTOs) ──────────────────────────────────────────────────
type PurchaseLine = { invoiceItemId: number; invoiceId: number; invoiceNo: string; invoiceDate: string; quantity: number; returned: number; reserved: number; available: number; unitPrice: number; netUnit: number; refundable: number; refundableRemaining: number; trackInventory: boolean };
type PurchaseProduct = { key: string; productId: number | null; productName: string; unit: string | null; image: string | null; barcode: string | null; purchased: number; returned: number; reserved: number; available: number; lines: PurchaseLine[] };
type Purchases = { customer: { id: number; name: string; phone: string; code: string | null; customerType: string; isCashCustomer: boolean; purchases: number; payments: number; outstanding: number; approvedReturns: number; availableCredit: number }; scopeInvoices: { id: number; invoiceNo: string; date: string; buyerName: string | null; buyerPhone: string | null }[]; products: PurchaseProduct[]; canOverrideAllocation: boolean };
type SearchCustomer = { id: number; name: string; phone: string; code: string; customerType: string; invoices: number; outstanding: number; lastInvoiceDate: string | null; matchedInvoiceId: number | null };
type SearchInvoice = { id: number; invoiceNo: string; date: string; buyerName: string | null; buyerPhone: string | null; total: number; customerId: number | null };
type CustomerSearchResult = { customers: SearchCustomer[]; walkInInvoices: SearchInvoice[]; unlinkedInvoices: SearchInvoice[] };
type Options = { warehouses: { id: number; name: string }[]; staff: { id: number; name: string }[]; permissions: Record<string, boolean> };
type ListRow = { id: number; returnNo: string; reversalNo: string | null; customerId: number; customerName: string; customerPhone: string; returnDate: string; productCount: number; invoiceCount: number; totalQuantity: number; totalAmount: number; settlementKinds: string[]; status: string; received: boolean; pendingInventory: number; settlementStatus: string; employeeName: string };
type ListResponse = { rows: ListRow[]; total: number; truncated: boolean; page: number; pageSize: number; summary: { totalReturns: number; pending: number; completed: number; value: number; refundsPaid: number; openCredit: number } };
type DetailItem = { id: number; invoiceId: number; invoiceNo: string; invoiceDate: string; invoiceItemId: number; productId: number | null; productKey: string; productName: string; unit: string | null; quantity: number; originalUnitPrice: number; netUnitAmount: number; amount: number; condition: string; inventoryState: string; trackInventory: boolean };
type DetailSettlement = { id: number; kind: string; invoiceId: number | null; invoiceNo: string | null; parentSettlementId: number | null; amount: number; used: number; status: string; isExchange: boolean; paymentMethod: string | null; financialTransactionId: number | null; transactionNo: string | null; transactionStatus: string | null; note: string | null; createdByName: string; createdAt: string | null; reversedAt: string | null; reversalReason: string | null };
type Detail = {
  return: { id: number; returnNo: string; status: string; returnDate: string; warehouseId: number | null; warehouseName: string | null; reasonCode: string; notes: string | null; attachmentUrl: string | null; employeeId: number | null; employeeName: string; totalQuantity: number; totalAmount: number; settled: number; unsettled: number; settlementStatus: string; settlementPlan: Record<string, unknown>; version: number; createdByName: string; createdAt: string | null; submittedAt: string | null; receivedAt: string | null; receivedByName: string | null; approvedAt: string | null; approvedByName: string | null; approvalNote: string | null; rejectedAt: string | null; rejectionReason: string | null; cancelledAt: string | null; cancellationReason: string | null; inventoryCompletedAt: string | null; completedAt: string | null; reversedAt: string | null; reversedByName: string | null; reversalReason: string | null; reversalNo: string | null };
  customer: { id: number; name: string; phone: string; code: string | null; isCashCustomer?: boolean };
  items: DetailItem[];
  settlements: DetailSettlement[];
  events: { id: number; event: string; actorName: string; note: string | null; metadata: Record<string, unknown>; createdAt: string | null }[];
  permissions: Record<"edit" | "submit" | "receive" | "approve" | "cancel" | "inventory" | "settle" | "reverse" | "print", boolean>;
};
type CustomerSummary = { openInvoices: { id: number; invoiceNo: string; date: string; total: number; remaining: number }[]; approvedReturns: number; refundsPaid: number; refundsPending: number; debtDeducted: number; availableCredit: number; history: { id: number; returnNo: string; reversalNo: string | null; status: string; returnDate: string; totalQuantity: number; totalAmount: number; invoices: string; products: string; conditions: string[]; settlementStatus: string; employeeName: string }[] };

const SETTLEMENT_STATUS_LABELS: Record<string, string> = { not_started: "لم تبدأ", unsettled: "غير مسوّى", partial: "مسوّى جزئياً", refund_pending: "بانتظار صرف المبلغ", settled: "مسوّى", reversed: "معكوس" };
const SETTLEMENT_KIND_LABELS: Record<string, string> = { invoice_credit: "خصم من المديونية", customer_credit: "رصيد دائن", refund: "استرجاع مبلغ" };
const EVENT_LABELS: Record<string, string> = { created: "إنشاء المرتجع", edited: "تعديل المسودة", submitted: "إرسال للموافقة", received: "استلام البضاعة", approved: "اعتماد المرتجع", rejected: "رفض المرتجع", cancelled: "إلغاء المرتجع", amount_recalculated: "إعادة احتساب المبلغ", inventory_accepted: "قبول المخزون", inspection_resolved: "قرار الفحص", settled: "تسوية مالية", credit_applied: "استخدام رصيد على فاتورة", settlement_reversed: "عكس خصم من المديونية", completed: "اكتمل المرتجع", reversed: "عكس المرتجع" };
const PLAN_OPTIONS = [
  { value: "debt", label: "خصم من مديونية العميل", hint: "يُخصم المبلغ من الفواتير المفتوحة، الأقدم أولاً." },
  { value: "credit", label: "إضافة رصيد دائن", hint: "رصيد يستخدمه العميل على فواتيره القادمة." },
  { value: "refund", label: "استرجاع مبلغ", hint: "طلب صرف عبر الموافقات المالية؛ لا يُدفع قبل اعتماده." },
  { value: "exchange", label: "استبدال منتج", hint: "رصيد للاستبدال يُستخدم على فاتورة المنتج البديل." },
] as const;
type PlanValue = (typeof PLAN_OPTIONS)[number]["value"];

const qty = (value: number) => new Intl.NumberFormat("ar-IQ-u-nu-latn", { maximumFractionDigits: 3 }).format(value);
const newKey = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
const today = () => new Date().toISOString().slice(0, 10);
const shortDate = (value: string | null | undefined) => (value ? String(value).slice(0, 10) : "—");
const dateTime = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "short", timeStyle: "short" }) : "—");

// ── Shared presentation ─────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return <div dir="rtl" className="mx-auto w-full max-w-7xl space-y-4 p-4 lg:p-6">{children}</div>;
}
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-2xl border border-border/40 bg-card p-4 shadow-sm ${className}`}>{children}</section>;
}
function SectionTitle({ index, title, children }: { index?: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
        {index ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground tabular-nums">{index}</span> : null}
        {title}
      </h2>
      {children}
    </div>
  );
}
function Stat({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/40 bg-card px-3 py-2.5 shadow-sm">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-lg font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
const STATUS_TONES: Record<string, string> = {
  draft: "bg-muted text-foreground ring-border/60",
  pending_approval: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  approved: "bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30",
  completed: "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  rejected: "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  cancelled: "bg-muted text-muted-foreground ring-border/60",
  reversed: "bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30",
};
function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_TONES[status] ?? STATUS_TONES.draft}`}>{RETURN_STATUS_LABELS[status] ?? status}</span>;
}
function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const tones = {
    neutral: "bg-muted text-foreground ring-border/60",
    good: "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
    warn: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
    bad: "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}
function Money({ value, className = "" }: { value: number; className?: string }) {
  return <bdi dir="ltr" className={`whitespace-nowrap tabular-nums ${className}`}>{formatCurrency(value)}</bdi>;
}
function ErrorState({ error, onRetry, title = "تعذر تحميل البيانات" }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <div className="min-w-0"><p className="font-semibold text-foreground">{title}</p><p className="mt-1 break-words text-muted-foreground">{apiErrorMessage(error)}</p></div>
      {onRetry ? <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw className="h-4 w-4" /> إعادة المحاولة</Button> : null}
    </div>
  );
}
const field = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid min-w-0 gap-1 text-xs text-muted-foreground ${className}`}><span>{label}</span>{children}</label>;
}

function useOptions() {
  return useQuery<Options>({ queryKey: ["admin", "sales-returns", "options"], queryFn: () => adminFetch("/admin/sales-returns/options"), staleTime: 60_000 });
}

// ── Router ───────────────────────────────────────────────────────────────
export default function SalesReturnsPage() {
  const [location] = useLocation();
  if (/^\/admin\/sales-returns\/new\/?$/.test(location)) return <ReturnEditor returnId={null} />;
  const match = location.match(/^\/admin\/sales-returns\/(\d+)(\/edit)?\/?$/);
  if (match && match[2]) return <ReturnEditor returnId={Number(match[1])} />;
  if (match) return <ReturnDetail id={Number(match[1])} />;
  return <ReturnsCenter />;
}

// ── Center: list + reports ───────────────────────────────────────────────
function ReturnsCenter() {
  const options = useOptions();
  const [tab, setTab] = useState<"returns" | "reports">("returns");
  const canCreate = options.data?.permissions["sales_returns.create"] ?? false;
  return (
    <Shell>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">مركز مرتجعات المبيعات</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">مرتجع واحد يجمع منتجات من عدة فواتير لنفس العميل، بأسعار الفواتير الأصلية ومراحل اعتماد واضحة.</p>
        </div>
        {canCreate ? <Button asChild className="gap-2"><Link href="/admin/sales-returns/new"><Undo2 className="h-4 w-4" /> إنشاء مرتجع مجمّع</Link></Button> : null}
      </header>
      <nav aria-label="أقسام المرتجعات" className="flex gap-2 border-b border-border/40">
        {([["returns", "المرتجعات", ClipboardCheck], ["reports", "التقارير", BarChart3]] as const).map(([value, label, Icon]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${tab === value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </nav>
      {options.isError ? <ErrorState error={options.error} onRetry={() => void options.refetch()} /> : tab === "returns" ? <ReturnsList options={options.data} /> : <ReturnsReports />}
    </Shell>
  );
}

function ReturnsList({ options }: { options?: Options }) {
  const [filters, setFilters] = useState({ q: "", invoiceNo: "", product: "", from: "", to: "", status: "", settlement: "", employeeId: "" });
  const [page, setPage] = useState(1);
  const params = new URLSearchParams(Object.entries({ ...filters, page: String(page) }).filter(([, value]) => value));
  const list = useQuery<ListResponse>({ queryKey: ["admin", "sales-returns", "list", params.toString()], queryFn: () => adminFetch(`/admin/sales-returns?${params.toString()}`) });
  const set = (key: keyof typeof filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setFilters((current) => ({ ...current, [key]: event.target.value })); setPage(1); };
  const summary = list.data?.summary;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="إجمالي المرتجعات" value={summary ? summary.totalReturns : "…"} />
        <Stat label="بانتظار الموافقة" value={summary ? summary.pending : "…"} tone="text-amber-700 dark:text-amber-300" />
        <Stat label="المرتجعات المكتملة" value={summary ? summary.completed : "…"} tone="text-emerald-700 dark:text-emerald-300" />
        <Stat label="قيمة المرتجعات" value={summary ? formatCurrency(summary.value) : "…"} />
        <Stat label="المبالغ المستردة" value={summary ? formatCurrency(summary.refundsPaid) : "…"} />
        <Stat label="الأرصدة الدائنة المتبقية" value={summary ? formatCurrency(summary.openCredit) : "…"} tone="text-primary" />
      </div>
      <Card>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2"><Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-muted-foreground" /><input aria-label="بحث برقم المرتجع أو العميل" value={filters.q} onChange={set("q")} placeholder="رقم المرتجع، اسم العميل أو هاتفه" className={`${field} ps-9`} /></div>
          <input aria-label="رقم الفاتورة" value={filters.invoiceNo} onChange={set("invoiceNo")} placeholder="رقم الفاتورة" className={field} />
          <input aria-label="المنتج" value={filters.product} onChange={set("product")} placeholder="اسم المنتج" className={field} />
          <Field label="من تاريخ"><DateField type="date" value={filters.from} onChange={set("from")} className={field} /></Field>
          <Field label="إلى تاريخ"><DateField type="date" value={filters.to} onChange={set("to")} className={field} /></Field>
          <Field label="حالة المرتجع"><select value={filters.status} onChange={set("status")} className={field}><option value="">كل الحالات</option>{Object.entries(RETURN_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="حالة التسوية"><select value={filters.settlement} onChange={set("settlement")} className={field}><option value="">كل حالات التسوية</option>{Object.entries(SETTLEMENT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="الموظف" className="sm:col-span-2 lg:col-span-1"><select value={filters.employeeId} onChange={set("employeeId")} className={field}><option value="">كل الموظفين</option>{(options?.staff ?? []).map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select></Field>
        </div>
      </Card>
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} title="تعذر تحميل المرتجعات" /> : list.isLoading ? <Card><Skeleton className="h-40" /></Card> : !list.data?.rows.length ? (
        <Card><div className="py-12 text-center text-sm text-muted-foreground">لا توجد مرتجعات مطابقة للبحث.</div></Card>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-border/40 bg-card shadow-sm lg:block">
            <table className="w-full min-w-[1100px] text-right text-sm">
              <thead className="border-b border-border/40 bg-muted/40 text-xs text-muted-foreground">
                <tr>{["رقم المرتجع", "العميل", "تاريخ المرتجع", "عدد المنتجات", "الكمية الإجمالية", "مبلغ المرتجع", "نوع التسوية", "حالة الموافقة", "حالة الاستلام", "حالة التسوية", "الموظف", "الإجراءات"].map((head) => <th key={head} className="px-3 py-2.5 font-semibold">{head}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {list.data.rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5 font-semibold tabular-nums"><Link href={`/admin/sales-returns/${row.id}`} className="text-primary hover:underline">{row.returnNo}</Link>{row.reversalNo ? <span className="block text-[11px] text-muted-foreground">{row.reversalNo}</span> : null}</td>
                    <td className="px-3 py-2.5"><span className="font-medium">{row.customerName}</span><span className="block text-[11px] text-muted-foreground tabular-nums" dir="ltr">{row.customerPhone}</span></td>
                    <td className="px-3 py-2.5 tabular-nums">{row.returnDate}</td>
                    <td className="px-3 py-2.5 tabular-nums">{row.productCount}<span className="block text-[11px] text-muted-foreground">{row.invoiceCount} فاتورة</span></td>
                    <td className="px-3 py-2.5 tabular-nums">{qty(row.totalQuantity)}</td>
                    <td className="px-3 py-2.5 font-semibold"><Money value={row.totalAmount} /></td>
                    <td className="px-3 py-2.5 text-xs">{row.settlementKinds.length ? row.settlementKinds.map((kind) => SETTLEMENT_KIND_LABELS[kind] ?? kind).join("، ") : "—"}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={row.status} /></td>
                    <td className="px-3 py-2.5">{row.received ? <Pill tone="good">مستلم</Pill> : ["draft", "rejected", "cancelled"].includes(row.status) ? "—" : <Pill tone="warn">بانتظار الاستلام</Pill>}</td>
                    <td className="px-3 py-2.5"><Pill tone={row.settlementStatus === "settled" ? "good" : ["partial", "refund_pending", "unsettled"].includes(row.settlementStatus) ? "warn" : "neutral"}>{SETTLEMENT_STATUS_LABELS[row.settlementStatus] ?? row.settlementStatus}</Pill></td>
                    <td className="px-3 py-2.5 text-xs">{row.employeeName || "—"}</td>
                    <td className="px-3 py-2.5"><Button asChild variant="outline" size="sm"><Link href={`/admin/sales-returns/${row.id}`}>عرض التفاصيل</Link></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 lg:hidden">
            {list.data.rows.map((row) => (
              <li key={row.id}>
                <Link href={`/admin/sales-returns/${row.id}`} className="block rounded-2xl border border-border/40 bg-card p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-bold tabular-nums text-primary">{row.returnNo}</p><p className="truncate text-sm">{row.customerName}</p></div>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">{row.returnDate} · {row.productCount} منتج · {qty(row.totalQuantity)} قطعة</span>
                    <Money value={row.totalAmount} className="text-sm font-bold text-foreground" />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5"><Pill tone={row.settlementStatus === "settled" ? "good" : "warn"}>{SETTLEMENT_STATUS_LABELS[row.settlementStatus] ?? row.settlementStatus}</Pill>{row.received ? <Pill tone="good">مستلم</Pill> : null}</div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span className="tabular-nums">{list.data.total} مرتجع{list.data.truncated ? " (أول 2000)" : ""}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ArrowRight className="h-4 w-4" /> السابق</Button>
              <span className="tabular-nums">{page} / {pages}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>التالي <ChevronLeft className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type ReportRow = { label: string; returns: number; quantity: number; amount: number };
type Reports = { totals: { returns: number; quantity: number; amount: number; refundsPaid: number; openCredit: number }; byCustomer: ReportRow[]; byProduct: ReportRow[]; byInvoice: ReportRow[]; byEmployee: ReportRow[]; byReason: ReportRow[]; byDate: ReportRow[]; byWarehouse: ReportRow[]; byCondition: ReportRow[]; reversals: { id: number; returnNo: string; reversalNo: string | null; reversedAt: string | null; reversedByName: string | null; reason: string | null; amount: number; customerName: string }[] };
function ReturnsReports() {
  const [range, setRange] = useState({ from: "", to: "" });
  const params = new URLSearchParams(Object.entries(range).filter(([, value]) => value));
  const reports = useQuery<Reports>({ queryKey: ["admin", "sales-returns", "reports", params.toString()], queryFn: () => adminFetch(`/admin/sales-returns/reports?${params.toString()}`) });
  const groups: [string, keyof Reports, (label: string) => string][] = [
    ["حسب العميل", "byCustomer", (label) => label],
    ["حسب المنتج", "byProduct", (label) => label],
    ["حسب الفاتورة", "byInvoice", (label) => label],
    ["حسب الموظف", "byEmployee", (label) => label],
    ["حسب السبب", "byReason", returnReasonLabel],
    ["حسب حالة المنتج", "byCondition", returnConditionLabel],
    ["حسب المخزن", "byWarehouse", (label) => label],
    ["حسب التاريخ", "byDate", (label) => label],
  ];
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="من تاريخ"><DateField type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} className={field} /></Field>
          <Field label="إلى تاريخ"><DateField type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} className={field} /></Field>
          <p className="max-w-prose pb-2 text-xs text-muted-foreground">تشمل التقارير المرتجعات المعتمدة والمكتملة فقط. المبالغ المستردة هي المدفوعة فعلياً.</p>
        </div>
      </Card>
      {reports.isError ? <ErrorState error={reports.error} onRetry={() => void reports.refetch()} title="تعذر تحميل التقارير" /> : !reports.data ? <Card><Skeleton className="h-48" /></Card> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="عدد المرتجعات" value={reports.data.totals.returns} />
            <Stat label="إجمالي الكميات" value={qty(reports.data.totals.quantity)} />
            <Stat label="إجمالي القيمة" value={formatCurrency(reports.data.totals.amount)} />
            <Stat label="المبالغ المدفوعة فعلياً" value={formatCurrency(reports.data.totals.refundsPaid)} />
            <Stat label="الأرصدة الدائنة القائمة" value={formatCurrency(reports.data.totals.openCredit)} tone="text-primary" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {groups.map(([title, key, label]) => {
              const rows = reports.data[key] as ReportRow[];
              return (
                <Card key={key}>
                  <SectionTitle title={title} />
                  {!rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">لا توجد بيانات للفترة.</p> : (
                    <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="py-1.5 font-semibold">البند</th><th className="py-1.5 font-semibold">المرتجعات</th><th className="py-1.5 font-semibold">الكمية</th><th className="py-1.5 font-semibold">القيمة</th></tr></thead>
                      <tbody className="divide-y divide-border/30">{rows.slice(0, 12).map((row) => <tr key={row.label}><td className="max-w-[16rem] truncate py-1.5">{label(row.label)}</td><td className="py-1.5 tabular-nums">{row.returns}</td><td className="py-1.5 tabular-nums">{qty(row.quantity)}</td><td className="py-1.5"><Money value={row.amount} /></td></tr>)}</tbody></table></div>
                  )}
                </Card>
              );
            })}
          </div>
          <Card>
            <SectionTitle title="سجل عكس المرتجعات" />
            {!reports.data.reversals.length ? <p className="py-6 text-center text-sm text-muted-foreground">لا توجد مرتجعات معكوسة في الفترة.</p> : (
              <ul className="divide-y divide-border/30">{reports.data.reversals.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0"><Link href={`/admin/sales-returns/${row.id}`} className="font-semibold text-primary tabular-nums hover:underline">{row.returnNo}</Link> <span className="text-muted-foreground">← {row.reversalNo}</span><p className="truncate text-xs text-muted-foreground">{row.customerName} · {row.reversedByName} · {row.reason}</p></div>
                  <div className="text-xs text-muted-foreground">{dateTime(row.reversedAt)} · <Money value={row.amount} className="font-semibold text-foreground" /></div>
                </li>
              ))}</ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ── Editor: create / edit draft ─────────────────────────────────────────
type Selection = { quantity: string; condition: ReturnCondition; manual: Record<number, string> | null };

function asReturnable(product: PurchaseProduct): ReturnableLine[] {
  return product.lines.map((line) => ({ invoiceItemId: line.invoiceItemId, invoiceId: line.invoiceId, invoiceNo: line.invoiceNo, invoiceDate: line.invoiceDate, quantityMilli: toMilli(line.quantity), consumedMilli: toMilli(line.returned + line.reserved) }));
}
/** Same rules as the server: FIFO (or a validated manual split) at original prices. */
function previewProduct(product: PurchaseProduct, selection: Selection | undefined) {
  const requested = toMilli(selection?.quantity ?? 0);
  if (!selection || requested <= 0) return { allocations: [] as { line: PurchaseLine; quantityMilli: number; amountCents: number }[], amountCents: 0, error: null as string | null, requested: 0 };
  try {
    const lines = asReturnable(product);
    const allocations = selection.manual
      ? validateAllocation(lines, requested, Object.entries(selection.manual).map(([id, value]) => ({ invoiceItemId: Number(id), quantityMilli: toMilli(value || 0) })))
      : allocateFifo(lines, requested);
    const rows = allocations.map((allocation) => {
      const line = product.lines.find((row) => row.invoiceItemId === allocation.invoiceItemId)!;
      const refundableCents = toCents(line.refundable);
      const amountCents = returnAmountCents({ lineQuantityMilli: toMilli(line.quantity), lineRefundableCents: refundableCents, quantityMilli: allocation.quantityMilli, consumedQuantityMilli: toMilli(line.returned + line.reserved), consumedAmountCents: refundableCents - toCents(line.refundableRemaining) });
      return { line, quantityMilli: allocation.quantityMilli, amountCents };
    });
    return { allocations: rows, amountCents: rows.reduce((sum, row) => sum + row.amountCents, 0), error: null, requested };
  } catch (cause) {
    return { allocations: [], amountCents: 0, error: cause instanceof Error ? cause.message : "توزيع غير صالح", requested };
  }
}

// ── Customer search: returns permission only, Arabic-insensitive ──────────
function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
const resultRow = "flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-border/40 bg-background px-3 py-2.5 text-right transition-[border-color,background-color,transform] duration-150 ease-out hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]";
function ResultGroup({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div><p className="text-xs font-semibold text-foreground">{title}</p>{hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}</div>
      {children}
    </section>
  );
}

function ReturnCustomerSearch({ onPick }: { onPick: (customerId: number, invoiceId: number | null) => void }) {
  const [term, setTerm] = useState("");
  const query = useDebounced(term.trim());
  const result = useQuery<CustomerSearchResult>({
    queryKey: ["admin", "sales-returns", "customer-search", query],
    queryFn: () => adminFetch(`/admin/sales-returns/customers?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0,
    staleTime: 15_000,
  });
  const data = result.data;
  const empty = data && !data.customers.length && !data.walkInInvoices.length && !data.unlinkedInvoices.length;
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus value={term} onChange={(event) => setTerm(event.target.value)} aria-label="بحث عن عميل المرتجع" placeholder="اسم العميل أو هاتفه، رقم الفاتورة، أو اسم المشتري على الفاتورة" className="h-11 pr-9 pl-9" />
        {result.isFetching ? <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
      </div>
      {!query ? null : result.isError ? <ErrorState error={result.error} onRetry={() => void result.refetch()} title="تعذر البحث عن العميل" /> : !data ? <Skeleton className="h-16 rounded-xl" /> : empty ? (
        <div className="rounded-xl border border-dashed border-border/60 p-4 text-center">
          <p className="text-sm font-semibold text-foreground">لا يوجد عميل أو فاتورة تطابق «{query}»</p>
          <p className="mt-1 text-xs text-muted-foreground">جرّب رقم الفاتورة أو رقم الهاتف؛ المرتجع يحتاج فاتورة مبيعات فعّالة.</p>
        </div>
      ) : (
        <div className="max-h-[440px] space-y-4 overflow-y-auto overscroll-contain">
          {data.customers.length ? (
            <ResultGroup title="العملاء">
              {data.customers.map((row) => (
                <button key={row.id} type="button" className={resultRow} onClick={() => onPick(row.id, row.matchedInvoiceId)}>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2"><span className="truncate font-bold text-foreground">{row.name}</span>{row.matchedInvoiceId ? <Pill>فاتورة مطابقة</Pill> : null}</span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span className="tabular-nums">{row.code}</span>
                      <bdi dir="ltr" className="tabular-nums">{row.phone}</bdi>
                      <span>{row.invoices ? `${row.invoices} فاتورة قابلة للإرجاع` : "لا توجد فواتير قابلة للإرجاع"}</span>
                      {row.lastInvoiceDate ? <span className="tabular-nums">آخر فاتورة {row.lastInvoiceDate}</span> : null}
                    </span>
                  </span>
                  <span className="text-left"><Money value={row.outstanding} className={`text-sm font-bold ${row.outstanding > 0 ? "text-destructive" : "text-foreground"}`} /><span className="block text-[11px] text-muted-foreground">المتبقي عليه</span></span>
                </button>
              ))}
            </ResultGroup>
          ) : null}
          {data.walkInInvoices.length ? (
            <ResultGroup title="فواتير العميل النقدي" hint="يُفتح المرتجع على الفاتورة نفسها فقط، لأن العميل النقدي يشترك فيه أكثر من مشترٍ.">
              {data.walkInInvoices.map((invoice) => (
                <button key={invoice.id} type="button" className={resultRow} onClick={() => onPick(invoice.customerId!, invoice.id)}>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2"><span className="font-bold tabular-nums text-foreground">{invoice.invoiceNo}</span><span className="truncate text-sm text-foreground">{invoice.buyerName || "بدون اسم مشترٍ"}</span></span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span className="tabular-nums">{invoice.date}</span>{invoice.buyerPhone ? <bdi dir="ltr" className="tabular-nums">{invoice.buyerPhone}</bdi> : null}</span>
                  </span>
                  <span className="text-left"><Money value={invoice.total} className="text-sm font-bold" /><span className="block text-[11px] text-muted-foreground">إجمالي الفاتورة</span></span>
                </button>
              ))}
            </ResultGroup>
          ) : null}
          {data.unlinkedInvoices.length ? (
            <ResultGroup title="فواتير غير مربوطة بعميل" hint="لا يمكن إرجاعها قبل ربطها: من سجل الفواتير اضغط «ربط الفواتير القديمة بالعملاء» ثم ابحث مجدداً.">
              {data.unlinkedInvoices.map((invoice) => (
                <div key={invoice.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-dashed border-border/60 px-3 py-2.5 text-muted-foreground">
                  <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold tabular-nums text-foreground">{invoice.invoiceNo}</span><span className="truncate text-sm">{invoice.buyerName || "بدون اسم"}</span><Pill tone="warn">غير مربوطة</Pill></span><span className="mt-0.5 block text-xs tabular-nums">{invoice.date}</span></span>
                  <Money value={invoice.total} className="text-sm" />
                </div>
              ))}
            </ResultGroup>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ReturnEditor({ returnId }: { returnId: number | null }) {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const options = useOptions();
  const existing = useQuery<Detail>({ queryKey: ["admin", "sales-returns", "detail", returnId], queryFn: () => adminFetch(`/admin/sales-returns/${returnId}`), enabled: returnId != null });
  const [customerId, setCustomerId] = useState<number | null>(() => Number(params.get("customerId")) || null);
  const [sourceInvoiceId, setSourceInvoiceId] = useState<number | null>(() => Number(params.get("invoiceId")) || null);
  const purchases = useQuery<Purchases>({
    queryKey: ["admin", "sales-returns", "purchases", customerId, returnId, sourceInvoiceId],
    queryFn: () => {
      const query = new URLSearchParams();
      if (returnId) query.set("excludeReturnId", String(returnId));
      if (sourceInvoiceId) query.set("invoiceId", String(sourceInvoiceId));
      const suffix = query.toString();
      return adminFetch(`/admin/sales-returns/customers/${customerId}/purchases${suffix ? `?${suffix}` : ""}`);
    },
    enabled: customerId != null,
  });
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [header, setHeader] = useState({ returnDate: today(), warehouseId: "", reasonCode: "", notes: "", attachmentUrl: "", employeeId: "" });
  const [plan, setPlan] = useState<PlanValue>("debt");
  const [refundMethod, setRefundMethod] = useState<"cash" | "transfer" | "card">("cash");
  const idempotencyKey = useRef(newKey());
  const hydrated = useRef(false);

  // Editing a draft: hydrate once from the saved return.
  useEffect(() => {
    if (!existing.data || hydrated.current) return;
    hydrated.current = true;
    const ret = existing.data.return;
    setCustomerId(existing.data.customer.id);
    setHeader({ returnDate: ret.returnDate || today(), warehouseId: ret.warehouseId ? String(ret.warehouseId) : "", reasonCode: ret.reasonCode, notes: ret.notes ?? "", attachmentUrl: ret.attachmentUrl ?? "", employeeId: ret.employeeId ? String(ret.employeeId) : "" });
    const savedPlan = String(ret.settlementPlan?.preferred ?? "debt") as PlanValue;
    if (PLAN_OPTIONS.some((option) => option.value === savedPlan)) setPlan(savedPlan);
    if (["cash", "transfer", "card"].includes(String(ret.settlementPlan?.refundMethod))) setRefundMethod(ret.settlementPlan.refundMethod as "cash" | "transfer" | "card");
    const next: Record<string, Selection> = {};
    for (const item of existing.data.items) {
      const current = next[item.productKey] ?? { quantity: "0", condition: item.condition as ReturnCondition, manual: {} };
      current.quantity = String(fromMilli(toMilli(current.quantity) + toMilli(item.quantity)));
      current.manual![item.invoiceItemId] = String(item.quantity);
      next[item.productKey] = current;
    }
    setSelections(next);
  }, [existing.data]);

  useEffect(() => {
    if (purchases.data?.customer.isCashCustomer && (plan === "credit" || plan === "exchange")) setPlan("debt");
  }, [purchases.data, plan]);

  // Drop a saved manual split when it equals FIFO (no override permission needed).
  useEffect(() => {
    if (!purchases.data) return;
    setSelections((current) => {
      let changed = false;
      const next = { ...current };
      for (const [key, selection] of Object.entries(current)) {
        if (!selection.manual) continue;
        const product = purchases.data!.products.find((row) => row.key === key);
        if (!product) continue;
        try {
          const fifo = allocateFifo(asReturnable(product), toMilli(selection.quantity));
          const same = fifo.length === Object.values(selection.manual).filter((value) => toMilli(value) > 0).length && fifo.every((row) => toMilli(selection.manual![row.invoiceItemId]) === row.quantityMilli);
          if (same) { next[key] = { ...selection, manual: null }; changed = true; }
        } catch { /* keep the manual split; its error shows in the table */ }
      }
      return changed ? next : current;
    });
  }, [purchases.data]);

  const products = useMemo(() => {
    const all = purchases.data?.products ?? [];
    const filtered = productQuery.trim() ? all.filter((product) => `${product.productName} ${product.barcode ?? ""}`.toLowerCase().includes(productQuery.trim().toLowerCase())) : all;
    // Opened from an invoice: its products first.
    return sourceInvoiceId ? [...filtered].sort((a, b) => Number(b.lines.some((line) => line.invoiceId === sourceInvoiceId)) - Number(a.lines.some((line) => line.invoiceId === sourceInvoiceId))) : filtered;
  }, [purchases.data, productQuery, sourceInvoiceId]);
  const previews = useMemo(() => Object.fromEntries((purchases.data?.products ?? []).map((product) => [product.key, previewProduct(product, selections[product.key])])), [purchases.data, selections]);
  const chosen = (purchases.data?.products ?? []).filter((product) => toMilli(selections[product.key]?.quantity ?? 0) > 0);
  const totalCents = chosen.reduce((sum, product) => sum + previews[product.key].amountCents, 0);
  const totalMilli = chosen.reduce((sum, product) => sum + toMilli(selections[product.key].quantity), 0);
  const invoiceCount = new Set(chosen.flatMap((product) => previews[product.key].allocations.map((row) => row.line.invoiceId))).size;
  const errors = chosen.map((product) => previews[product.key].error).filter(Boolean) as string[];
  const focus = (purchases.data?.products ?? []).find((product) => product.key === (focusKey ?? chosen[0]?.key));
  const canOverride = purchases.data?.canOverrideAllocation ?? false;
  const steps = [
    { label: "اختيار العميل", done: customerId != null },
    { label: "اختيار المنتجات والكميات", done: chosen.length > 0 && !errors.length },
    { label: "توزيع الكميات على الفواتير", done: chosen.length > 0 && !errors.length },
    { label: "تفاصيل المرتجع", done: Boolean(header.reasonCode) && (header.reasonCode !== "other" || Boolean(header.notes.trim())) },
    { label: "التسوية المالية", done: Boolean(plan) },
    { label: "المراجعة والاعتماد", done: false },
  ];

  const update = (key: string, patch: Partial<Selection>) => setSelections((current) => {
    const base: Selection = current[key] ?? { quantity: "0", condition: "good", manual: null };
    return { ...current, [key]: { ...base, ...patch } };
  });
  const save = useMutation({
    mutationFn: (submit: boolean) => {
      if (!customerId) throw new Error("اختر العميل أولاً");
      if (!chosen.length) throw new Error("اختر منتجاً واحداً على الأقل وحدد كمية الإرجاع");
      if (errors.length) throw new Error(errors[0]);
      if (!header.reasonCode) throw new Error("حدد سبب الإرجاع");
      const body = {
        customerId,
        returnDate: header.returnDate || null,
        warehouseId: header.warehouseId ? Number(header.warehouseId) : null,
        reasonCode: header.reasonCode,
        notes: header.notes.trim() || null,
        attachmentUrl: header.attachmentUrl.trim() || null,
        employeeId: header.employeeId ? Number(header.employeeId) : null,
        settlementPlan: { preferred: plan, refundMethod: plan === "refund" ? refundMethod : null },
        submit,
        expectedVersion: existing.data?.return.version ?? null,
        idempotencyKey: idempotencyKey.current,
        invoiceId: sourceInvoiceId,
        items: chosen.map((product) => {
          const selection = selections[product.key];
          return {
            productKey: product.key,
            quantity: Number(selection.quantity),
            condition: selection.condition,
            allocations: selection.manual ? Object.entries(selection.manual).filter(([, value]) => toMilli(value) > 0).map(([id, value]) => ({ invoiceItemId: Number(id), quantity: Number(value) })) : null,
          };
        }),
      };
      return adminFetch<{ id: number }>(returnId ? `/admin/sales-returns/${returnId}` : "/admin/sales-returns", { method: returnId ? "PUT" : "POST", body: JSON.stringify(body) });
    },
    onSuccess: (result, submit) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "sales-returns"] });
      toast({ title: submit ? "أُرسل المرتجع للموافقة" : "حُفظ المرتجع كمسودة" });
      setLocation(`/admin/sales-returns/${result.id}`);
    },
    onError: (error) => toast({ title: "تعذر حفظ المرتجع", description: apiErrorMessage(error), variant: "destructive" }),
  });

  if (returnId && existing.isError) return <Shell><ErrorState error={existing.error} onRetry={() => void existing.refetch()} title="تعذر تحميل المرتجع" /></Shell>;
  if (returnId && existing.data && existing.data.return.status !== "draft") return <Shell><Card><p className="text-sm">يمكن تعديل المرتجع وهو مسودة فقط.</p><Button asChild variant="outline" className="mt-3"><Link href={`/admin/sales-returns/${returnId}`}>عرض المرتجع</Link></Button></Card></Shell>;
  const customer = purchases.data?.customer;
  const outstanding = customer?.outstanding ?? 0;
  const planOptions = customer?.isCashCustomer ? PLAN_OPTIONS.filter((option) => option.value === "debt" || option.value === "refund") : PLAN_OPTIONS;
  return (
    <Shell>
      <nav className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-label="مسار التنقل">
        <Link href="/admin/sales-returns" className="hover:text-foreground">مرتجعات المبيعات</Link><ChevronLeft className="h-4 w-4" />
        <span className="font-semibold text-foreground">{returnId ? `تعديل ${existing.data?.return.returnNo ?? "المسودة"}` : "إنشاء مرتجع مبيعات مجمّع"}</span>
      </nav>

      {/* Customer summary */}
      {customerId == null ? (
        <Card>
          <SectionTitle index={1} title="اختيار العميل" />
          <p className="mb-3 text-sm text-muted-foreground">ابحث عن العميل أو الفاتورة؛ تظهر بعدها منتجاته من فواتيره القابلة للإرجاع.</p>
          <ReturnCustomerSearch onPick={(pickedCustomer, pickedInvoice) => { setCustomerId(pickedCustomer); setSourceInvoiceId(pickedInvoice); setSelections({}); }} />
        </Card>
      ) : purchases.isError ? <ErrorState error={purchases.error} onRetry={() => void purchases.refetch()} title="تعذر تحميل مشتريات العميل" /> : !customer ? <Card><Skeleton className="h-24" /></Card> : (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">{customer.name.slice(0, 1)}</span>
              <div className="min-w-0">
                <p className="truncate text-xl font-bold">{customer.name}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span className="tabular-nums">{customer.code ?? `#${customer.id}`}</span><span dir="ltr" className="tabular-nums">{customer.phone}</span><span>{customer.customerType === "wholesale" ? "عميل جملة" : "عميل مفرد"}</span></p>
              </div>
              {!returnId ? <Button variant="ghost" size="sm" onClick={() => { setCustomerId(null); setSourceInvoiceId(null); setSelections({}); }}>تغيير العميل</Button> : null}
            </div>
            <div className="grid w-full grid-cols-2 gap-2 md:grid-cols-4 xl:w-auto xl:max-w-3xl xl:flex-1">
              <Stat label="إجمالي المشتريات" value={formatCurrency(customer.purchases)} />
              <Stat label="إجمالي الدفعات" value={formatCurrency(customer.payments)} />
              <Stat label="المرتجعات المعتمدة" value={formatCurrency(customer.approvedReturns)} />
              <Stat label="الرصيد الحالي" value={formatCurrency(customer.outstanding)} tone="text-primary" />
            </div>
          </div>
          {customer.isCashCustomer ? (
            <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              عميل نقدي: المرتجع من {purchases.data!.scopeInvoices.map((invoice) => `${invoice.invoiceNo}${invoice.buyerName ? ` (${invoice.buyerName})` : ""}`).join("، ")} فقط، ولا يُحفظ له رصيد دائن.
            </p>
          ) : sourceInvoiceId ? <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">فُتح من فاتورة محددة: منتجاتها تظهر أولاً، ويمكن إضافة منتجات من فواتير أخرى لنفس العميل.</p> : null}
        </Card>
      )}

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="مراحل المرتجع">
        {steps.map((step, index) => (
          <li key={step.label} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${step.done ? "border-primary/30 bg-primary/5 text-foreground" : "border-border/40 bg-card text-muted-foreground"}`}>
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] tabular-nums ${step.done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
            <span className="min-w-0 leading-tight">{step.label}</span>
          </li>
        ))}
      </ol>

      {customer ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            {/* Products */}
            <Card>
              <SectionTitle index={2} title="المنتجات المشتراة من العميل">
                <div className="relative w-full sm:w-64"><Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-muted-foreground" /><input aria-label="بحث عن منتج" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="ابحث عن منتج" className={`${field} ps-9`} /></div>
              </SectionTitle>
              {!products.length ? <p className="py-8 text-center text-sm text-muted-foreground">{purchases.data?.products.length ? "لا يوجد منتج مطابق." : "لا توجد فواتير نشطة لهذا العميل يمكن الإرجاع منها."}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-right text-sm">
                    <thead className="border-b border-border/40 text-xs text-muted-foreground"><tr><th className="py-2 font-semibold">المنتج</th><th className="py-2 font-semibold">المشتراة</th><th className="py-2 font-semibold">المرتجعة سابقاً</th><th className="py-2 font-semibold">المتاح للإرجاع</th><th className="py-2 font-semibold">الكمية المرتجعة</th><th className="py-2 font-semibold">مبلغ الإرجاع</th></tr></thead>
                    <tbody className="divide-y divide-border/30">
                      {products.map((product) => {
                        const selection = selections[product.key];
                        const preview = previews[product.key];
                        const active = toMilli(selection?.quantity ?? 0) > 0;
                        return (
                          <tr key={product.key} className={active ? "bg-primary/[0.03]" : ""}>
                            <td className="py-2">
                              <button type="button" onClick={() => setFocusKey(product.key)} className="flex min-w-0 items-center gap-2 text-start">
                                {product.image ? <img src={product.image} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted"><PackageCheck className="h-4 w-4 text-muted-foreground" /></span>}
                                <span className="min-w-0"><span className="block truncate font-semibold">{product.productName}</span><span className="block text-[11px] text-muted-foreground">{product.barcode || product.unit || `${product.lines.length} فاتورة`}{sourceInvoiceId && product.lines.some((line) => line.invoiceId === sourceInvoiceId) ? " · من الفاتورة المحددة" : ""}</span></span>
                              </button>
                            </td>
                            <td className="py-2 tabular-nums">{qty(product.purchased)}</td>
                            <td className="py-2 tabular-nums">{qty(product.returned + product.reserved)}{product.reserved > 0 ? <span className="block text-[11px] text-amber-700 dark:text-amber-300">{qty(product.reserved)} بانتظار الموافقة</span> : null}</td>
                            <td className="py-2 font-semibold tabular-nums">{qty(product.available)}</td>
                            <td className="py-2">
                              <input inputMode="decimal" aria-label={`كمية إرجاع ${product.productName}`} disabled={product.available <= 0 && !active} value={selection?.quantity ?? ""} placeholder="0"
                                onFocus={() => setFocusKey(product.key)}
                                onChange={(event) => update(product.key, { quantity: event.target.value.replace(/[^0-9.]/g, ""), manual: null })}
                                className={`${field} w-24 text-center tabular-nums ${preview.error ? "border-destructive" : ""}`} />
                              {preview.error ? <span role="alert" className="mt-1 block max-w-[14rem] text-[11px] text-destructive">{preview.error}</span> : null}
                            </td>
                            <td className="py-2 font-semibold">{active && !preview.error ? <Money value={fromCents(preview.amountCents)} /> : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">الأسعار من الفواتير الأصلية بعد خصم السطر ونصيبه من خصم الفاتورة وضريبتها؛ أجور التوصيل لا تُسترجع.</p>
            </Card>

            {/* Allocation */}
            <Card>
              <SectionTitle index={3} title="توزيع الكميات على الفواتير">
                {chosen.length > 1 ? <select aria-label="المنتج المعروض" value={focus?.key ?? ""} onChange={(event) => setFocusKey(event.target.value)} className={`${field} w-auto`}>{chosen.map((product) => <option key={product.key} value={product.key}>{product.productName}</option>)}</select> : null}
              </SectionTitle>
              {!focus || !toMilli(selections[focus.key]?.quantity ?? 0) ? <p className="py-6 text-center text-sm text-muted-foreground">أدخل كمية إرجاع لمنتج لعرض توزيعها التلقائي على فواتيره (الأقدم أولاً).</p> : (() => {
                const selection = selections[focus.key];
                const preview = previews[focus.key];
                const manual = selection.manual;
                const allocated = manual ? Object.values(manual).reduce((sum, value) => sum + toMilli(value || 0), 0) : preview.allocations.reduce((sum, row) => sum + row.quantityMilli, 0);
                const requested = toMilli(selection.quantity);
                return (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{focus.productName}</span>
                      <Pill>المطلوبة: {qty(fromMilli(requested))}</Pill>
                      <Pill tone={allocated === requested ? "good" : "bad"}>الموزعة: {qty(fromMilli(allocated))}</Pill>
                      <Pill tone={allocated === requested ? "good" : "bad"}>الفرق: {qty(fromMilli(requested - allocated))}</Pill>
                      {canOverride ? (
                        <Button type="button" variant="outline" size="sm" className="ms-auto" onClick={() => update(focus.key, { manual: manual ? null : Object.fromEntries(focus.lines.map((line) => [line.invoiceItemId, String(fromMilli(preview.allocations.find((row) => row.line.invoiceItemId === line.invoiceItemId)?.quantityMilli ?? 0))])) })}>
                          <Pencil className="h-4 w-4" /> {manual ? "رجوع للتوزيع التلقائي" : "تعديل التوزيع يدوياً"}
                        </Button>
                      ) : null}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-right text-sm">
                        <thead className="border-b border-border/40 text-xs text-muted-foreground"><tr><th className="py-2 font-semibold">رقم الفاتورة</th><th className="py-2 font-semibold">تاريخها</th><th className="py-2 font-semibold">الكمية المباعة</th><th className="py-2 font-semibold">المرتجعة سابقاً</th><th className="py-2 font-semibold">المتاحة</th><th className="py-2 font-semibold">الكمية المخصصة</th><th className="py-2 font-semibold">سعر القطعة الأصلي</th><th className="py-2 font-semibold">مبلغ الإرجاع</th></tr></thead>
                        <tbody className="divide-y divide-border/30">
                          {focus.lines.map((line) => {
                            const row = preview.allocations.find((allocation) => allocation.line.invoiceItemId === line.invoiceItemId);
                            return (
                              <tr key={line.invoiceItemId}>
                                <td className="py-2 font-semibold tabular-nums text-primary">{line.invoiceNo}</td>
                                <td className="py-2 tabular-nums">{line.invoiceDate}</td>
                                <td className="py-2 tabular-nums">{qty(line.quantity)}</td>
                                <td className="py-2 tabular-nums">{qty(line.returned + line.reserved)}</td>
                                <td className="py-2 tabular-nums">{qty(line.available)}</td>
                                <td className="py-2">{manual ? <input inputMode="decimal" aria-label={`الكمية من ${line.invoiceNo}`} value={manual[line.invoiceItemId] ?? ""} onChange={(event) => update(focus.key, { manual: { ...manual, [line.invoiceItemId]: event.target.value.replace(/[^0-9.]/g, "") } })} className={`${field} w-20 text-center tabular-nums`} /> : <span className="font-semibold tabular-nums">{row ? qty(fromMilli(row.quantityMilli)) : "0"}</span>}</td>
                                <td className="py-2"><Money value={line.netUnit} /></td>
                                <td className="py-2 font-semibold">{row ? <Money value={fromCents(row.amountCents)} /> : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {preview.error ? <p role="alert" className="text-xs font-semibold text-destructive">{preview.error}</p> : null}
                  </div>
                );
              })()}
            </Card>

            {/* Condition per product */}
            <Card>
              <SectionTitle index={4} title="حالة المنتجات الراجعة" />
              {!chosen.length ? <p className="py-6 text-center text-sm text-muted-foreground">لم تُحدد منتجات بعد.</p> : (
                <ul className="divide-y divide-border/30">
                  {chosen.map((product) => (
                    <li key={product.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0"><p className="truncate font-semibold">{product.productName}</p><p className="text-xs text-muted-foreground tabular-nums">{qty(Number(selections[product.key].quantity))} قطعة</p></div>
                      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`حالة ${product.productName}`}>
                        {RETURN_CONDITIONS.map((condition) => (
                          <button key={condition.code} type="button" role="radio" aria-checked={selections[product.key].condition === condition.code} onClick={() => update(product.key, { condition: condition.code })}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${selections[product.key].condition === condition.code ? "border-primary bg-primary text-primary-foreground" : "border-border/50 bg-background text-foreground hover:border-primary/40"}`}>{condition.label}</button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground">السليم يرجع للمخزون القابل للبيع بعد قبول المخزون. «يحتاج فحص» يُحجز خارج البيع حتى قرار الفحص. التالف وغير القابل للبيع لا يزيد المخزون.</p>
            </Card>

            {/* Settlement preference */}
            <Card>
              <SectionTitle index={5} title="التسوية المالية المقترحة" />
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="طريقة التسوية">
                {planOptions.map((option) => (
                  <button key={option.value} type="button" role="radio" aria-checked={plan === option.value} onClick={() => setPlan(option.value)}
                    className={`rounded-xl border p-3 text-start transition-colors ${plan === option.value ? "border-primary bg-primary/5" : "border-border/40 hover:border-primary/40"}`}>
                    <span className="flex items-center gap-2 text-sm font-semibold"><span className={`h-4 w-4 shrink-0 rounded-full border-2 ${plan === option.value ? "border-[5px] border-primary" : "border-muted-foreground/50"}`} />{option.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{customer?.isCashCustomer && option.value === "debt" ? "يُخصم من متبقي هذه الفاتورة نفسها فقط." : option.hint}</span>
                  </button>
                ))}
              </div>
              {plan === "refund" ? <Field label="طريقة الاسترجاع" className="mt-3 max-w-xs"><select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value as "cash" | "transfer" | "card")} className={field}><option value="cash">نقداً</option><option value="transfer">تحويل</option><option value="card">بطاقة</option></select></Field> : null}
              {plan === "debt" && totalCents > toCents(outstanding) ? <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">{customer?.isCashCustomer ? `متبقي الفاتورة ${formatCurrency(outstanding)} أقل من قيمة المرتجع؛ الباقي يُسترجع نقداً عند التسوية.` : `مديونية العميل المفتوحة ${formatCurrency(outstanding)} أقل من قيمة المرتجع؛ الباقي يُقترح كرصيد دائن عند التسوية.`}</p> : null}
              <p className="mt-3 text-xs text-muted-foreground">هذا اقتراح يُحفظ مع المرتجع. التنفيذ الفعلي يكون بعد الاعتماد، ويمكن تقسيمه على أكثر من طريقة.</p>
            </Card>

            {/* Details */}
            <Card>
              <SectionTitle index={6} title="معلومات إضافية" />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="سبب الإرجاع *"><select value={header.reasonCode} onChange={(event) => setHeader((current) => ({ ...current, reasonCode: event.target.value }))} className={field}><option value="">اختر السبب</option>{RETURN_REASONS.map((reason) => <option key={reason.code} value={reason.code}>{reason.label}</option>)}</select></Field>
                <Field label="تاريخ الاستلام"><DateField type="date" value={header.returnDate} onChange={(event) => setHeader((current) => ({ ...current, returnDate: event.target.value }))} className={field} /></Field>
                <Field label="الموظف المسؤول"><select value={header.employeeId} onChange={(event) => setHeader((current) => ({ ...current, employeeId: event.target.value }))} className={field}><option value="">—</option>{(options.data?.staff ?? []).map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select></Field>
                <Field label="المخزن المستلم"><select value={header.warehouseId} onChange={(event) => setHeader((current) => ({ ...current, warehouseId: event.target.value }))} className={field}><option value="">المخزون الرئيسي</option>{(options.data?.warehouses ?? []).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></Field>
                <Field label="رابط مرفق أو صورة (اختياري)" className="lg:col-span-2"><input type="url" dir="ltr" value={header.attachmentUrl} onChange={(event) => setHeader((current) => ({ ...current, attachmentUrl: event.target.value }))} placeholder="https://" className={field} /></Field>
                <Field label={header.reasonCode === "other" ? "ملاحظات * (اذكر السبب)" : "ملاحظات"} className="sm:col-span-2 lg:col-span-3"><Textarea value={header.notes} onChange={(event) => setHeader((current) => ({ ...current, notes: event.target.value }))} rows={2} /></Field>
              </div>
            </Card>
          </div>

          {/* Summary */}
          <aside className="min-w-0 space-y-4 xl:sticky xl:top-20 xl:self-start">
            <Card>
              <SectionTitle title="ملخص المرتجع" />
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">عدد المنتجات</dt><dd className="font-semibold tabular-nums">{chosen.length}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">الكمية الإجمالية</dt><dd className="font-semibold tabular-nums">{qty(fromMilli(totalMilli))}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">الفواتير المرتبطة</dt><dd className="font-semibold tabular-nums">{invoiceCount}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">نوع التسوية</dt><dd><Pill tone="bad">{PLAN_OPTIONS.find((option) => option.value === plan)?.label}</Pill></dd></div>
                <div className="flex justify-between gap-2 border-t border-border/40 pt-2"><dt className="font-semibold">مبلغ المرتجع</dt><dd className="text-lg font-bold text-primary"><Money value={fromCents(totalCents)} /></dd></div>
              </dl>
              {errors.length ? <p role="alert" className="mt-3 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">{errors[0]}</p> : null}
              <p className="mt-3 text-xs text-muted-foreground">الحفظ لا يحرك المخزون ولا الأموال. الإرسال للموافقة يحجز الكميات من الفواتير الأصلية.</p>
            </Card>
          </aside>
        </div>
      ) : null}

      <footer className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 bg-background/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
        <Button asChild variant="outline"><Link href={returnId ? `/admin/sales-returns/${returnId}` : "/admin/sales-returns"}><X className="h-4 w-4" /> إلغاء</Link></Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={save.isPending || !customerId} onClick={() => save.mutate(false)}>{save.isPending && save.variables === false ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} حفظ كمسودة</Button>
          <Button disabled={save.isPending || !customerId || !chosen.length || errors.length > 0} onClick={() => save.mutate(true)}>{save.isPending && save.variables === true ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} إرسال للموافقة</Button>
        </div>
      </footer>
    </Shell>
  );
}

// ── Detail: actions, settlement, print, audit ───────────────────────────
type ReasonAction = "reject" | "cancel" | "reverse";
function ReturnDetail({ id }: { id: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const printReturn = useSalesReturnPrint();
  const detail = useQuery<Detail>({ queryKey: ["admin", "sales-returns", "detail", id], queryFn: () => adminFetch(`/admin/sales-returns/${id}`) });
  const customerId = detail.data?.customer.id;
  const summary = useQuery<CustomerSummary>({ queryKey: ["admin", "sales-returns", "customer-summary", customerId], queryFn: () => adminFetch(`/admin/sales-returns/customers/${customerId}/summary`), enabled: customerId != null });
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [inspectionNote, setInspectionNote] = useState("");
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["admin", "sales-returns"] }); };
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: Record<string, unknown> }) => adminFetch(`/admin/sales-returns/${path}`, { method: "POST", body: JSON.stringify(body ?? {}) }),
    onSuccess: (_, variables) => { refresh(); setReasonAction(null); setReasonText(""); toast({ title: ACTION_DONE[variables.path.split("/").pop() ?? ""] ?? "تم التنفيذ" }); },
    onError: (error) => toast({ title: "تعذر تنفيذ العملية", description: apiErrorMessage(error), variant: "destructive" }),
  });

  if (detail.isError) return <Shell><ErrorState error={detail.error} onRetry={() => void detail.refetch()} title="تعذر تحميل المرتجع" /></Shell>;
  if (!detail.data) return <Shell><Skeleton className="h-24" /><Skeleton className="h-64" /></Shell>;
  const { return: ret, customer, items, settlements, events, permissions } = detail.data;
  const pendingInventory = items.filter((item) => item.inventoryState === "pending").length;
  const grouped = Object.values(items.reduce<Record<string, DetailItem[]>>((acc, item) => { (acc[item.productKey] ??= []).push(item); return acc; }, {}));
  const print = () => void printReturn({
    returnNo: ret.returnNo, reversalNo: ret.reversalNo, status: ret.status, returnDate: ret.returnDate, customerName: customer.name, customerPhone: customer.phone,
    employeeName: ret.employeeName || ret.createdByName, reasonCode: ret.reasonCode, notes: ret.notes, totalQuantity: ret.totalQuantity, totalAmount: ret.totalAmount,
    items: items.map((item) => ({ productName: item.productName, unit: item.unit, quantity: item.quantity, netUnitAmount: item.netUnitAmount, amount: item.amount, invoiceNo: item.invoiceNo, condition: item.condition })),
    settlements: settlements.map((settlement) => ({ kind: settlement.kind, amount: settlement.amount, status: settlement.status, invoiceNo: settlement.invoiceNo, transactionStatus: settlement.transactionStatus, isExchange: settlement.isExchange, parentSettlementId: settlement.parentSettlementId })),
  });
  const progress = [
    { label: "إنشاء", at: ret.createdAt },
    { label: "إرسال للموافقة", at: ret.submittedAt },
    { label: "استلام البضاعة", at: ret.receivedAt },
    { label: "الاعتماد", at: ret.approvedAt },
    { label: "قبول المخزون", at: ret.inventoryCompletedAt && !pendingInventory ? ret.inventoryCompletedAt : null },
    { label: "التسوية", at: ret.settlementStatus === "settled" || ret.settlementStatus === "refund_pending" ? ret.completedAt ?? "done" : null },
  ];
  return (
    <Shell>
      <nav className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-label="مسار التنقل">
        <Link href="/admin/sales-returns" className="hover:text-foreground">مرتجعات المبيعات</Link><ChevronLeft className="h-4 w-4" /><span className="font-semibold text-foreground tabular-nums">{ret.returnNo}</span>
      </nav>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tabular-nums">{ret.returnNo}</h1><StatusBadge status={ret.status} />{ret.reversalNo ? <Pill>{ret.reversalNo}</Pill> : null}</div>
            <p className="mt-1 text-sm text-muted-foreground"><span className="font-semibold text-foreground">{customer.name}</span> · <span dir="ltr" className="tabular-nums">{customer.phone}</span> · {ret.returnDate} · {returnReasonLabel(ret.reasonCode)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {permissions.print ? <Button variant="outline" onClick={print}><Printer className="h-4 w-4" /> طباعة وصل مرتجع</Button> : null}
            {permissions.edit ? <Button asChild variant="outline"><Link href={`/admin/sales-returns/${id}/edit`}><Pencil className="h-4 w-4" /> تعديل</Link></Button> : null}
            {permissions.submit ? <Button disabled={action.isPending} onClick={() => action.mutate({ path: `${id}/submit` })}><Send className="h-4 w-4" /> إرسال للموافقة</Button> : null}
            {permissions.receive ? <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate({ path: `${id}/receive` })}><PackageCheck className="h-4 w-4" /> تأكيد استلام البضاعة</Button> : null}
            {permissions.approve ? <><Button disabled={action.isPending} onClick={() => action.mutate({ path: `${id}/approve` })}><ShieldCheck className="h-4 w-4" /> اعتماد</Button><Button variant="outline" onClick={() => setReasonAction("reject")}>رفض</Button></> : null}
            {permissions.cancel ? <Button variant="ghost" className="text-destructive" onClick={() => setReasonAction("cancel")}>إلغاء</Button> : null}
            {permissions.reverse ? <Button variant="ghost" className="text-destructive" onClick={() => setReasonAction("reverse")}><RotateCcw className="h-4 w-4" /> عكس المرتجع</Button> : null}
          </div>
        </div>
        <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="مراحل المرتجع">
          {progress.map((step, index) => (
            <li key={step.label} className={`rounded-xl border px-3 py-2 text-xs ${step.at ? "border-primary/30 bg-primary/5" : "border-border/40"}`}>
              <span className="flex items-center gap-1.5 font-semibold"><span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] tabular-nums ${step.at ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{step.at ? <Check className="h-3 w-3" /> : index + 1}</span>{step.label}</span>
              {step.at && step.at !== "done" ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{dateTime(step.at)}</span> : null}
            </li>
          ))}
        </ol>
        {ret.rejectionReason ? <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-300">سبب الرفض: {ret.rejectionReason}</p> : null}
        {ret.cancellationReason ? <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">سبب الإلغاء: {ret.cancellationReason}</p> : null}
        {ret.reversalReason ? <p className="mt-3 rounded-lg bg-violet-500/10 px-3 py-2 text-sm text-violet-800 dark:text-violet-300">عُكس بواسطة {ret.reversedByName}: {ret.reversalReason}</p> : null}
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="مبلغ المرتجع" value={formatCurrency(ret.totalAmount)} tone="text-primary" />
        <Stat label="الكمية" value={qty(ret.totalQuantity)} />
        <Stat label="المسوّى" value={formatCurrency(ret.settled)} />
        <Stat label="غير المسوّى" value={formatCurrency(ret.unsettled)} tone={ret.unsettled > 0 && ["approved", "completed"].includes(ret.status) ? "text-amber-700 dark:text-amber-300" : ""} />
      </div>

      <Card>
        <SectionTitle title="المنتجات والفواتير الأصلية">
          {permissions.inventory && pendingInventory > 0 ? <Button disabled={action.isPending} onClick={() => action.mutate({ path: `${id}/inventory`, body: { items: [] } })}><PackageCheck className="h-4 w-4" /> قبول المخزون ({pendingInventory})</Button> : null}
        </SectionTitle>
        {!ret.receivedAt && ["approved", "completed"].includes(ret.status) ? <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">أكّد استلام البضاعة فعلياً قبل قبول المخزون.</p> : null}
        <div className="space-y-4">
          {grouped.map((rows) => (
            <div key={rows[0].productKey} className="rounded-xl border border-border/40">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 bg-muted/30 px-3 py-2">
                <span className="font-semibold">{rows[0].productName}{rows[0].unit ? <span className="text-xs text-muted-foreground"> ({rows[0].unit})</span> : null}</span>
                <span className="text-sm"><span className="tabular-nums">{qty(rows.reduce((sum, row) => sum + row.quantity, 0))}</span> قطعة · <Money value={rows.reduce((sum, row) => sum + row.amount, 0)} className="font-semibold" /></span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-right text-sm">
                  <thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-1.5 font-semibold">الفاتورة</th><th className="px-3 py-1.5 font-semibold">الكمية</th><th className="px-3 py-1.5 font-semibold">سعر القطعة الأصلي</th><th className="px-3 py-1.5 font-semibold">صافي القطعة</th><th className="px-3 py-1.5 font-semibold">المبلغ</th><th className="px-3 py-1.5 font-semibold">الحالة</th><th className="px-3 py-1.5 font-semibold">المخزون</th></tr></thead>
                  <tbody className="divide-y divide-border/30">
                    {rows.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 tabular-nums">{item.invoiceNo}<span className="block text-[11px] text-muted-foreground">{item.invoiceDate}</span></td>
                        <td className="px-3 py-2 tabular-nums">{qty(item.quantity)}</td>
                        <td className="px-3 py-2"><Money value={item.originalUnitPrice} /></td>
                        <td className="px-3 py-2"><Money value={item.netUnitAmount} /></td>
                        <td className="px-3 py-2 font-semibold"><Money value={item.amount} /></td>
                        <td className="px-3 py-2">{returnConditionLabel(item.condition)}</td>
                        <td className="px-3 py-2">
                          <Pill tone={item.inventoryState === "restocked" ? "good" : item.inventoryState === "pending" || item.inventoryState === "inspection" ? "warn" : "neutral"}>{INVENTORY_STATE_LABELS[item.inventoryState] ?? item.inventoryState}</Pill>
                          {item.inventoryState === "inspection" && permissions.inventory ? (
                            <span className="mt-1.5 flex gap-1.5">
                              <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate({ path: `${id}/inspection`, body: { itemId: item.id, decision: "restock", note: inspectionNote || null } })}>سليم: للمخزون</Button>
                              <Button size="sm" variant="ghost" className="text-destructive" disabled={action.isPending} onClick={() => action.mutate({ path: `${id}/inspection`, body: { itemId: item.id, decision: "damaged", note: inspectionNote || null } })}>تالف</Button>
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
        {items.some((item) => item.inventoryState === "inspection") && permissions.inventory ? <Field label="ملاحظة قرار الفحص (اختياري)" className="mt-3 max-w-md"><Input value={inspectionNote} onChange={(event) => setInspectionNote(event.target.value)} /></Field> : null}
      </Card>

      <SettlementPanel detail={detail.data} summary={summary.data} summaryError={summary.isError ? summary.error : null} onDone={refresh} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="بيانات المرتجع" />
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">الموظف المسؤول</dt><dd>{ret.employeeName || "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">أنشأه</dt><dd>{ret.createdByName || "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">المخزن المستلم</dt><dd>{ret.warehouseName || "المخزون الرئيسي"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">استلمها</dt><dd>{ret.receivedByName || "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">اعتمده</dt><dd>{ret.approvedByName || "—"}{ret.approvalNote ? <span className="block text-xs text-muted-foreground">{ret.approvalNote}</span> : null}</dd></div>
            <div><dt className="text-xs text-muted-foreground">التسوية المقترحة</dt><dd>{PLAN_OPTIONS.find((option) => option.value === ret.settlementPlan?.preferred)?.label ?? "—"}</dd></div>
            {ret.notes ? <div className="col-span-2"><dt className="text-xs text-muted-foreground">ملاحظات</dt><dd className="whitespace-pre-wrap">{ret.notes}</dd></div> : null}
            {ret.attachmentUrl ? <div className="col-span-2"><dt className="text-xs text-muted-foreground">المرفق</dt><dd><a href={ret.attachmentUrl} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">{ret.attachmentUrl}</a></dd></div> : null}
          </dl>
        </Card>
        <Card>
          <SectionTitle title="سجل العمليات" />
          <ol className="space-y-2.5">
            {events.map((event) => (
              <li key={event.id} className="flex gap-2.5 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div className="min-w-0"><p className="font-semibold">{EVENT_LABELS[event.event] ?? event.event}</p><p className="text-xs text-muted-foreground">{event.actorName} · {dateTime(event.createdAt)}</p>{event.note ? <p className="mt-0.5 break-words text-xs">{event.note}</p> : null}</div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Dialog open={reasonAction != null} onOpenChange={(open) => { if (!open && !action.isPending) setReasonAction(null); }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{reasonAction === "reject" ? "رفض المرتجع" : reasonAction === "cancel" ? "إلغاء المرتجع" : "عكس المرتجع"}</DialogTitle>
            <DialogDescription>
              {reasonAction === "reverse"
                ? "يبقى المرتجع الأصلي محفوظاً ويُنشأ رقم عكس. يُعاد خصم المديونية، ويُلغى الرصيد غير المستخدم وطلب الاسترجاع غير المصروف، وتخرج البضاعة المعادة للمخزون. لا يُعكس تلقائياً مبلغ صُرف فعلاً أو رصيد استُخدم أو بضاعة بيعت؛ سيظهر لك السبب."
                : reasonAction === "reject" ? "تتحرر الكميات المحجوزة ولا يتغير المخزون أو الحسابات." : "تتحرر الكميات المحجوزة. المرتجع الملغي يبقى في السجل."}
            </DialogDescription>
          </DialogHeader>
          <Field label="السبب *"><Textarea value={reasonText} onChange={(event) => setReasonText(event.target.value)} rows={3} /></Field>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={action.isPending} onClick={() => setReasonAction(null)}>رجوع</Button>
            <Button variant="destructive" disabled={action.isPending || reasonText.trim().length < 3} onClick={() => reasonAction && action.mutate({ path: `${id}/${reasonAction}`, body: { reason: reasonText.trim() } })}>{action.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} تأكيد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
const ACTION_DONE: Record<string, string> = { submit: "أُرسل المرتجع للموافقة", receive: "تم تأكيد استلام البضاعة", approve: "تم اعتماد المرتجع", reject: "تم رفض المرتجع", cancel: "تم إلغاء المرتجع", inventory: "تم قبول المخزون", inspection: "تم تسجيل قرار الفحص", reverse: "تم عكس المرتجع" };

function SettlementPanel({ detail, summary, summaryError, onDone }: { detail: Detail; summary?: CustomerSummary; summaryError: unknown; onDone: () => void }) {
  const { toast } = useToast();
  const { return: ret, settlements, permissions, customer } = detail;
  // The walk-in customer's other open invoices belong to other buyers.
  const cash = customer.isCashCustomer === true;
  const sourceInvoices = new Set(detail.items.map((item) => item.invoiceId));
  const outstanding = (summary?.openInvoices ?? []).filter((invoice) => !cash || sourceInvoices.has(invoice.id)).reduce((sum, invoice) => sum + invoice.remaining, 0);
  const preferred = String(ret.settlementPlan?.preferred ?? "debt");
  const suggestion = useMemo(() => {
    const unsettled = toCents(ret.unsettled);
    if (preferred === "debt") {
      const debt = Math.min(unsettled, toCents(outstanding));
      return cash
        ? { invoiceCredit: fromCents(debt), customerCredit: 0, refund: fromCents(unsettled - debt), exchange: false }
        : { invoiceCredit: fromCents(debt), customerCredit: fromCents(unsettled - debt), refund: 0, exchange: false };
    }
    if (cash) return { invoiceCredit: 0, customerCredit: 0, refund: fromCents(unsettled), exchange: false };
    if (preferred === "refund") return { invoiceCredit: 0, customerCredit: 0, refund: fromCents(unsettled), exchange: false };
    return { invoiceCredit: 0, customerCredit: fromCents(unsettled), refund: 0, exchange: preferred === "exchange" };
  }, [ret.unsettled, outstanding, preferred, cash]);
  const [form, setForm] = useState({ invoiceCredit: "", customerCredit: "", refund: "", refundMethod: String(ret.settlementPlan?.refundMethod ?? "cash"), exchange: false, note: "" });
  const [open, setOpen] = useState(false);
  const key = useRef(newKey());
  const creditKey = useRef(newKey());
  const [credit, setCredit] = useState({ invoiceId: "", amount: "" });
  useEffect(() => { setForm((current) => ({ ...current, invoiceCredit: String(suggestion.invoiceCredit), customerCredit: String(suggestion.customerCredit), refund: String(suggestion.refund), exchange: suggestion.exchange })); }, [suggestion]);
  const totalCents = toCents(form.invoiceCredit || 0) + toCents(form.customerCredit || 0) + toCents(form.refund || 0);
  const settle = useMutation({
    mutationFn: () => adminFetch(`/admin/sales-returns/${ret.id}/settle`, { method: "POST", body: JSON.stringify({ invoiceCredit: Number(form.invoiceCredit || 0), customerCredit: Number(form.customerCredit || 0), refund: Number(form.refund || 0), refundMethod: Number(form.refund || 0) > 0 ? form.refundMethod : null, exchange: form.exchange, note: form.note.trim() || null, idempotencyKey: key.current }) }),
    onSuccess: () => { key.current = newKey(); setOpen(false); onDone(); toast({ title: "تم تنفيذ التسوية المالية" }); },
    onError: (error) => toast({ title: "تعذر تنفيذ التسوية", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const applyCredit = useMutation({
    mutationFn: () => adminFetch("/admin/sales-returns/credits/apply", { method: "POST", body: JSON.stringify({ customerId: customer.id, invoiceId: Number(credit.invoiceId), amount: Number(credit.amount), idempotencyKey: creditKey.current }) }),
    onSuccess: () => { creditKey.current = newKey(); setCredit({ invoiceId: "", amount: "" }); onDone(); toast({ title: "استُخدم الرصيد على الفاتورة" }); },
    onError: (error) => toast({ title: "تعذر استخدام الرصيد", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const reverseUse = useMutation({
    mutationFn: (settlementId: number) => adminFetch(`/admin/sales-returns/settlements/${settlementId}/reverse`, { method: "POST", body: JSON.stringify({ reason: "تصحيح من تفاصيل المرتجع" }) }),
    onSuccess: () => { onDone(); toast({ title: "عُكس الخصم وعادت المديونية" }); },
    onError: (error) => toast({ title: "تعذر العكس", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const availableCredit = summary?.availableCredit ?? 0;
  return (
    <Card>
      <SectionTitle title="التسوية المالية">
        {permissions.settle && ret.unsettled > 0 ? <Button onClick={() => setOpen((value) => !value)}><Wallet className="h-4 w-4" /> تنفيذ التسوية <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} /></Button> : null}
      </SectionTitle>
      {summaryError ? <ErrorState error={summaryError} title="تعذر تحميل حساب العميل" /> : null}
      {open ? (
        <div className="mb-4 space-y-3 rounded-xl border border-primary/30 bg-primary/[0.03] p-3">
          <p className="text-xs text-muted-foreground">غير المسوّى <Money value={ret.unsettled} className="font-semibold text-foreground" /> · {cash ? "متبقي الفاتورة" : "مديونية العميل المفتوحة"} <Money value={outstanding} className="font-semibold text-foreground" />. يمكن التقسيم على أكثر من طريقة؛ المجموع لا يتجاوز غير المسوّى.{cash ? " العميل النقدي لا يُحفظ له رصيد دائن." : ""}</p>
          <div className={`grid gap-3 ${cash ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
            <Field label={cash ? "خصم من متبقي الفاتورة" : "خصم من المديونية"}><input inputMode="decimal" value={form.invoiceCredit} onChange={(event) => setForm((current) => ({ ...current, invoiceCredit: event.target.value.replace(/[^0-9.]/g, "") }))} className={`${field} tabular-nums`} /></Field>
            {cash ? null : <Field label={form.exchange ? "رصيد للاستبدال" : "رصيد دائن"}><input inputMode="decimal" value={form.customerCredit} onChange={(event) => setForm((current) => ({ ...current, customerCredit: event.target.value.replace(/[^0-9.]/g, "") }))} className={`${field} tabular-nums`} /></Field>}
            <Field label="استرجاع مبلغ"><div className="flex gap-2"><input inputMode="decimal" value={form.refund} onChange={(event) => setForm((current) => ({ ...current, refund: event.target.value.replace(/[^0-9.]/g, "") }))} className={`${field} tabular-nums`} /><select aria-label="طريقة الاسترجاع" value={form.refundMethod} onChange={(event) => setForm((current) => ({ ...current, refundMethod: event.target.value }))} className={`${field} w-28`}><option value="cash">نقداً</option><option value="transfer">تحويل</option><option value="card">بطاقة</option></select></div></Field>
          </div>
          {cash ? null : <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.exchange} onChange={(event) => setForm((current) => ({ ...current, exchange: event.target.checked }))} className="h-4 w-4 accent-[hsl(var(--primary))]" /> الرصيد مخصص لاستبدال منتج (يُستخدم على فاتورة المنتج البديل)</label>}
          <Field label="ملاحظة"><Input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} /></Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-sm font-semibold ${totalCents > toCents(ret.unsettled) ? "text-destructive" : ""}`}>المجموع <Money value={fromCents(totalCents)} /> من <Money value={ret.unsettled} /></span>
            <Button disabled={settle.isPending || totalCents <= 0 || totalCents > toCents(ret.unsettled)} onClick={() => settle.mutate()}>{settle.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} تأكيد التسوية</Button>
          </div>
          <p className="text-xs text-muted-foreground">الاسترجاع النقدي يُنشئ طلب صرف في الموافقات المالية ولا يخصم من الصندوق قبل اعتماده وتنفيذه.</p>
        </div>
      ) : null}
      {!settlements.length ? <p className="py-4 text-center text-sm text-muted-foreground">{["approved", "completed"].includes(ret.status) ? "لم تُنفّذ التسوية بعد." : "تُنفّذ التسوية بعد اعتماد المرتجع."}</p> : (
        <ul className="divide-y divide-border/30">
          {settlements.map((settlement) => {
            const line = settlementLine(settlement);
            return (
              <li key={settlement.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">{settlement.parentSettlementId ? `استخدام رصيد على ${settlement.invoiceNo ?? "فاتورة"}` : line.label}</p>
                  <p className="text-xs text-muted-foreground">{settlement.createdByName} · {dateTime(settlement.createdAt)}{settlement.transactionNo ? ` · ${settlement.transactionNo}` : ""}{settlement.kind === "customer_credit" && settlement.used > 0 ? ` · المستخدم ${formatCurrency(settlement.used)}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={/تم الدفع|منفذ|متاح/.test(line.state) ? "good" : /بانتظار/.test(line.state) ? "warn" : "neutral"}>{line.state}</Pill>
                  <Money value={settlement.amount} className="font-semibold" />
                  {permissions.settle && settlement.kind === "invoice_credit" && settlement.status === "applied" ? <Button size="sm" variant="ghost" className="text-destructive" disabled={reverseUse.isPending} onClick={() => reverseUse.mutate(settlement.id)}><Undo2 className="h-4 w-4" /> عكس</Button> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {permissions.settle && availableCredit > 0 ? (
        <div className="mt-4 rounded-xl border border-border/40 p-3">
          <p className="text-sm font-semibold">استخدام الرصيد الدائن على فاتورة <span className="text-xs font-normal text-muted-foreground">(المتاح <Money value={availableCredit} />)</span></p>
          {!summary?.openInvoices.length ? <p className="mt-2 text-xs text-muted-foreground">لا توجد فواتير مفتوحة للعميل الآن. للاستبدال: أنشئ فاتورة المنتج البديل ثم ارجع هنا.</p> : (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Field label="الفاتورة" className="min-w-48 flex-1"><select value={credit.invoiceId} onChange={(event) => setCredit((current) => ({ ...current, invoiceId: event.target.value }))} className={field}><option value="">اختر فاتورة مفتوحة</option>{summary.openInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNo} — المتبقي {formatCurrency(invoice.remaining)}</option>)}</select></Field>
              <Field label="المبلغ" className="w-36"><input inputMode="decimal" value={credit.amount} onChange={(event) => setCredit((current) => ({ ...current, amount: event.target.value.replace(/[^0-9.]/g, "") }))} className={`${field} tabular-nums`} /></Field>
              <Button variant="outline" disabled={applyCredit.isPending || !credit.invoiceId || !(Number(credit.amount) > 0)} onClick={() => applyCredit.mutate()}>{applyCredit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} استخدام</Button>
            </div>
          )}
        </div>
      ) : null}
      {settlements.some((settlement) => settlement.kind === "refund" && settlement.status === "requested" && settlement.transactionStatus !== "executed") ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> طلب الاسترجاع بانتظار الموافقات المالية؛ لم يُدفع للعميل بعد. <Link href="/admin/financial-approvals" className="font-semibold underline">فتح الموافقات</Link></p>
      ) : null}
    </Card>
  );
}

// ── Embeds for the customer file and invoice details ────────────────────
export function CustomerReturnsHistory({ customerId }: { customerId: number }) {
  const summary = useQuery<CustomerSummary>({ queryKey: ["admin", "sales-returns", "customer-summary", customerId], queryFn: () => adminFetch(`/admin/sales-returns/customers/${customerId}/summary`), retry: false });
  const [query, setQuery] = useState("");
  const options = useOptions();
  const canCreate = options.data?.permissions["sales_returns.create"] ?? false;
  if (summary.isError) {
    const forbidden = /صلاحية/.test(apiErrorMessage(summary.error));
    if (forbidden) return null;
    return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} title="تعذر تحميل سجل المرتجعات" />;
  }
  const rows = (summary.data?.history ?? []).filter((row) => !query.trim() || `${row.returnNo} ${row.products} ${row.invoices}`.includes(query.trim()));
  return (
    <div className="rounded-xl border border-border/25 bg-background/40 p-4" dir="rtl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Undo2 className="h-4 w-4 text-primary" /> سجل المرتجعات</h4>
        {canCreate ? <Button asChild size="sm"><Link href={`/admin/sales-returns/new?customerId=${customerId}`}><Plus className="h-4 w-4" /> إنشاء مرتجع مجمّع</Link></Button> : null}
      </div>
      {!summary.data ? <Skeleton className="h-20" /> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="المرتجعات المعتمدة" value={formatCurrency(summary.data.approvedReturns)} />
            <Stat label="خُصم من المديونية" value={formatCurrency(summary.data.debtDeducted)} />
            <Stat label="المبالغ المستردة" value={formatCurrency(summary.data.refundsPaid)} />
            <Stat label="الرصيد الدائن" value={formatCurrency(summary.data.availableCredit)} tone="text-primary" />
          </div>
          {summary.data.history.length > 5 ? <input aria-label="بحث في المرتجعات" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="رقم المرتجع، المنتج أو الفاتورة" className={`${field} mb-2`} /> : null}
          {!rows.length ? <p className="py-4 text-center text-xs text-muted-foreground">لا توجد مرتجعات لهذا العميل.</p> : (
            <ul className="divide-y divide-border/30">
              {rows.slice(0, 50).map((row) => (
                <li key={row.id} className="py-2">
                  <Link href={`/admin/sales-returns/${row.id}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="min-w-0"><span className="font-semibold tabular-nums text-primary">{row.returnNo}</span> <span className="text-xs text-muted-foreground">{row.returnDate} · {row.employeeName}</span><span className="block truncate text-xs text-muted-foreground">{row.products} · {row.invoices}{row.conditions.length ? ` · ${row.conditions.map(returnConditionLabel).join("، ")}` : ""}</span></span>
                    <span className="flex items-center gap-1.5"><StatusBadge status={row.status} /><Pill>{SETTLEMENT_STATUS_LABELS[row.settlementStatus] ?? row.settlementStatus}</Pill><Money value={row.totalAmount} className="font-semibold" /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
