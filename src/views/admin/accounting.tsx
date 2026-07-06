import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Printer, Trash2, FileText, TrendingUp, Receipt, Wallet, Search, Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { adminFetch, apiErrorMessage, formatCurrency, formatMoney } from "./_lib";
import { EmptyState } from "./_layout";
import { formatIraqiPhone, formatIraqiPhoneInput, normalizeIraqiPhone } from "@/lib/phone";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";
import { downloadElementPdf } from "@/lib/pdf";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { printWhenImagesReadyScript, sheetReportCss } from "./print-helpers";

type Tab = "receipts" | "payments" | "expenses" | "categories" | "statement" | "receivables" | "pnl";

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "receipts",   label: "سندات القبض",  icon: Receipt },
  { id: "payments",   label: "سندات الصرف",  icon: Wallet },
  { id: "expenses",   label: "المصاريف",     icon: FileText },
  { id: "categories", label: "أنواع المصاريف", icon: FileText },
  { id: "statement",  label: "كشف حساب",     icon: FileText },
  { id: "receivables", label: "تقارير الذمم", icon: TrendingUp },
  { id: "pnl",        label: "ملخص التدفق النقدي", icon: TrendingUp },
];

const METHODS: { value: string; label: string }[] = [
  { value: "cash",     label: "نقدي" },
  { value: "transfer", label: "تحويل" },
  { value: "pos",      label: "بطاقة" },
];
function methodLabel(m: string): string {
  return METHODS.find(x => x.value === m)?.label ?? m;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

type ReceiptVoucher = {
  id: number; voucherNo: string; date: string; amount: string; payerName: string;
  customerId: number | null; orderId: number | null; bookingId: number | null;
  reference: string | null; method: string; notes: string | null;
  customerPhone?: string | null;
  createdByName: string; createdAt: string;
};
type PaymentVoucher = {
  id: number; voucherNo: string; date: string; amount: string; payeeName: string;
  customerId: number | null; customerPhone?: string | null;
  reference: string | null; method: string; notes: string | null;
  createdByName: string; createdAt: string;
};
type Expense = {
  id: number; date: string; amount: string; categoryId: number | null;
  categoryName: string; notes: string | null; createdByName: string;
};
type Category = { id: number; name: string; nameAr: string; isActive: number };

export default function AccountingPage() {
  const [tab, setTab] = useState<Tab>("receipts");
  const routeSearch = useSearch();
  useEffect(() => {
    const requested = new URLSearchParams(routeSearch).get("tab") as Tab | null;
    if (requested && TABS.some((item) => item.id === requested)) setTab(requested);
  }, [routeSearch]);
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">الحسابات</h1>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border/30">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-3 py-2 text-sm border-b-2 -mb-px transition-colors
                ${active ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <Icon className="w-4 h-4" />{t.label}
            </button>
          );
        })}
      </div>

      {tab === "receipts"   && <ReceiptsTab />}
      {tab === "payments"   && <PaymentsTab />}
      {tab === "expenses"   && <ExpensesTab />}
      {tab === "categories" && <CategoriesTab />}
      {tab === "statement"  && <StatementTab />}
      {tab === "receivables" && <ReceivablesTab />}
      {tab === "pnl"        && <PnLTab />}
    </div>
  );
}

// ───── Receipts ─────
function ReceiptsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<null | {
    date: string; amount: string; payerName: string; customerPhone: string; reference: string;
    customerId: number | null; method: string; notes: string;
  }>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "receipt-vouchers", deferredSearch],
    queryFn: () => adminFetch<ReceiptVoucher[]>(`/admin/receipt-vouchers${deferredSearch ? `?search=${encodeURIComponent(deferredSearch)}` : ""}`),
  });
  const create = useMutation({
    mutationFn: (b: any) => adminFetch<ReceiptVoucher>("/admin/receipt-vouchers", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["admin", "receipt-vouchers"] });
      setEditing(null);
      printReceipt(row);
    },
    onError: (err: any) => toast({ title: "تعذر حفظ سند القبض", description: apiErrorMessage(err, "تعذر حفظ سند القبض"), variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/receipt-vouchers/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "receipt-vouchers"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">إجمالي السندات: {data?.length ?? 0}</p>
        <Button onClick={() => setEditing({ date: todayStr(), amount: "", payerName: "", customerPhone: "", customerId: null, reference: "", method: "cash", notes: "" })}>
          <Plus className="w-4 h-4 ml-1" />سند قبض جديد
        </Button>
      </div>
      <VoucherListSearch value={search} onChange={setSearch} />

      {isLoading ? <Skeletons />
      : !data || data.length === 0 ? <EmptyState message="لا توجد سندات قبض بعد" />
      : (
        <DataTable
          columns={["الرقم", "التاريخ", "المبلغ", "الواصل من", "طريقة الدفع", "الموظف", ""]}
          rows={data.map(r => [
            <code className="text-primary text-xs">{r.voucherNo}</code>,
            r.date,
            <strong>{formatCurrency(r.amount)}</strong>,
            <div><div>{r.payerName}</div>{r.customerPhone && <div className="text-xs text-muted-foreground">{formatIraqiPhone(r.customerPhone)}</div>}</div>,
            methodLabel(r.method),
            r.createdByName || "—",
            <div className="flex gap-1 justify-end">
              <button onClick={() => printReceipt(r)} className="p-1.5 hover:bg-background/50 rounded text-muted-foreground hover:text-primary" title="طباعة"><Printer className="w-4 h-4" /></button>
              <button onClick={() => { if (confirm("حذف السند؟")) del.mutate(r.id); }} className="p-1.5 hover:bg-background/50 rounded text-destructive" title="حذف"><Trash2 className="w-4 h-4" /></button>
            </div>,
          ])}
        />
      )}

      {editing && (
        <Modal title="سند قبض جديد" onClose={() => setEditing(null)}>
          <div className="grid grid-cols-2 gap-3">
            <VoucherCustomerPicker
              selectedId={editing.customerId}
              onSelect={(customer) => setEditing({ ...editing, customerId: customer.id, payerName: customer.name, customerPhone: formatIraqiPhoneInput(customer.phone) })}
              onClear={() => setEditing({ ...editing, customerId: null })}
            />
            <Field label="التاريخ"><input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} className={inputCls} /></Field>
            <Field label="المبلغ (د.ع)"><input type="number" value={editing.amount} onChange={e => setEditing({ ...editing, amount: e.target.value })} className={inputCls} /></Field>
            <Field label="الواصل من"><input value={editing.payerName} onChange={e => setEditing({ ...editing, payerName: e.target.value })} className={inputCls} /></Field>
            <Field label="هاتف الزبون (لربط كشف الحساب)"><input value={editing.customerPhone} onChange={e => setEditing({ ...editing, customerId: null, customerPhone: formatIraqiPhoneInput(e.target.value) })} className={inputCls} placeholder="07XXXXXXXXX" /></Field>
            <Field label="طريقة الدفع">
              <select value={editing.method} onChange={e => setEditing({ ...editing, method: e.target.value })} className={inputCls}>
                {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="المرجع (رقم طلب/حجز)"><input value={editing.reference} onChange={e => setEditing({ ...editing, reference: e.target.value })} className={inputCls} placeholder="AJN-…" /></Field>
            <Field label="ملاحظات" className="col-span-2"><textarea value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} className={`${inputCls} min-h-20`} /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button disabled={create.isPending || !editing.amount}
              onClick={() => create.mutate({
                date: editing.date,
                amount: editing.amount,
                payerName: editing.payerName,
                customerId: editing.customerId,
                customerPhone: editing.customerPhone ? normalizeIraqiPhone(editing.customerPhone) ?? editing.customerPhone : undefined,
                reference: editing.reference || undefined,
                method: editing.method,
                notes: editing.notes || undefined,
              })}>{create.isPending ? "جارٍ الحفظ…" : "حفظ وطباعة"}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ───── Payments ─────
function PaymentsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<null | {
    date: string; amount: string; payeeName: string; customerPhone: string; customerId: number | null; reference: string; method: string; notes: string;
  }>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "payment-vouchers", deferredSearch],
    queryFn: () => adminFetch<PaymentVoucher[]>(`/admin/payment-vouchers${deferredSearch ? `?search=${encodeURIComponent(deferredSearch)}` : ""}`),
  });
  const create = useMutation({
    mutationFn: (b: any) => adminFetch<PaymentVoucher>("/admin/payment-vouchers", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["admin", "payment-vouchers"] });
      setEditing(null);
      printPayment(row);
    },
    onError: (err: any) => toast({ title: "تعذر حفظ سند الصرف", description: apiErrorMessage(err, "تعذر حفظ سند الصرف"), variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/payment-vouchers/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "payment-vouchers"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">إجمالي السندات: {data?.length ?? 0}</p>
        <Button onClick={() => setEditing({ date: todayStr(), amount: "", payeeName: "", customerPhone: "", customerId: null, reference: "", method: "cash", notes: "" })}>
          <Plus className="w-4 h-4 ml-1" />سند صرف جديد
        </Button>
      </div>
      <VoucherListSearch value={search} onChange={setSearch} />

      {isLoading ? <Skeletons />
      : !data || data.length === 0 ? <EmptyState message="لا توجد سندات صرف بعد" />
      : (
        <DataTable
          columns={["الرقم", "التاريخ", "المبلغ", "صُرف إلى", "طريقة الدفع", "الموظف", ""]}
          rows={data.map(r => [
            <code className="text-primary text-xs">{r.voucherNo}</code>,
            r.date,
            <strong>{formatCurrency(r.amount)}</strong>,
            <div><div>{r.payeeName}</div>{r.customerPhone && <div className="text-xs text-muted-foreground">{formatIraqiPhone(r.customerPhone)}</div>}</div>,
            methodLabel(r.method),
            r.createdByName || "—",
            <div className="flex gap-1 justify-end">
              <button onClick={() => printPayment(r)} className="p-1.5 hover:bg-background/50 rounded text-muted-foreground hover:text-primary"><Printer className="w-4 h-4" /></button>
              <button onClick={() => { if (confirm("حذف السند؟")) del.mutate(r.id); }} className="p-1.5 hover:bg-background/50 rounded text-destructive"><Trash2 className="w-4 h-4" /></button>
            </div>,
          ])}
        />
      )}

      {editing && (
        <Modal title="سند صرف جديد" onClose={() => setEditing(null)}>
          <div className="grid grid-cols-2 gap-3">
            <VoucherCustomerPicker
              selectedId={editing.customerId}
              onSelect={(customer) => setEditing({ ...editing, customerId: customer.id, payeeName: customer.name, customerPhone: formatIraqiPhoneInput(customer.phone) })}
              onClear={() => setEditing({ ...editing, customerId: null })}
            />
            <Field label="التاريخ"><input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} className={inputCls} /></Field>
            <Field label="المبلغ (د.ع)"><input type="number" value={editing.amount} onChange={e => setEditing({ ...editing, amount: e.target.value })} className={inputCls} /></Field>
            <Field label="صُرف إلى"><input value={editing.payeeName} onChange={e => setEditing({ ...editing, payeeName: e.target.value })} className={inputCls} /></Field>
            <Field label="هاتف العميل"><input value={editing.customerPhone} onChange={e => setEditing({ ...editing, customerId: null, customerPhone: formatIraqiPhoneInput(e.target.value) })} className={inputCls} placeholder="07XXXXXXXXX" /></Field>
            <Field label="طريقة الدفع">
              <select value={editing.method} onChange={e => setEditing({ ...editing, method: e.target.value })} className={inputCls}>
                {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="المرجع"><input value={editing.reference} onChange={e => setEditing({ ...editing, reference: e.target.value })} className={inputCls} /></Field>
            <Field label="ملاحظات" className="col-span-2"><textarea value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} className={`${inputCls} min-h-20`} /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button disabled={create.isPending || !editing.amount}
              onClick={() => create.mutate({
                date: editing.date,
                amount: editing.amount,
                payeeName: editing.payeeName,
                customerId: editing.customerId,
                customerPhone: editing.customerPhone ? normalizeIraqiPhone(editing.customerPhone) ?? editing.customerPhone : undefined,
                reference: editing.reference || undefined,
                method: editing.method,
                notes: editing.notes || undefined,
              })}>{create.isPending ? "جارٍ الحفظ…" : "حفظ وطباعة"}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ───── Expenses ─────
function ExpensesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const cats = useQuery({
    queryKey: ["admin", "expense-categories"],
    queryFn: () => adminFetch<Category[]>("/admin/expense-categories"),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "expenses"],
    queryFn: () => adminFetch<Expense[]>("/admin/expenses"),
  });
  const [editing, setEditing] = useState<null | { date: string; amount: string; categoryId: string; notes: string }>(null);
  const create = useMutation({
    mutationFn: (b: any) => adminFetch("/admin/expenses", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "expenses"] }); setEditing(null); },
    onError: (err: any) => toast({ title: "تعذر حفظ المصروف", description: err?.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/expenses/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "expenses"] }),
  });

  const total = useMemo(() => (data ?? []).reduce((s, e) => s + parseFloat(e.amount), 0), [data]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">إجمالي المصاريف المعروضة: <strong className="text-foreground">{formatCurrency(total)}</strong></p>
        <Button onClick={() => setEditing({ date: todayStr(), amount: "", categoryId: "", notes: "" })}>
          <Plus className="w-4 h-4 ml-1" />مصروف جديد
        </Button>
      </div>

      {isLoading ? <Skeletons />
      : !data || data.length === 0 ? <EmptyState message="لا توجد مصاريف بعد" />
      : (
        <DataTable
          columns={["التاريخ", "النوع", "المبلغ", "ملاحظات", "الموظف", ""]}
          rows={data.map(e => [
            e.date,
            e.categoryName || "—",
            <strong>{formatCurrency(e.amount)}</strong>,
            <span className="text-muted-foreground text-xs">{e.notes ?? ""}</span>,
            e.createdByName || "—",
            <div className="flex gap-1 justify-end">
              <button onClick={() => printExpense(e)} className="p-1.5 hover:bg-background/50 rounded text-muted-foreground hover:text-primary" title="طباعة"><Printer className="w-4 h-4" /></button>
              <button onClick={() => { if (confirm("حذف المصروف؟")) del.mutate(e.id); }} className="p-1.5 hover:bg-background/50 rounded text-destructive"><Trash2 className="w-4 h-4" /></button>
            </div>,
          ])}
        />
      )}

      {editing && (
        <Modal title="مصروف جديد" onClose={() => setEditing(null)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="التاريخ"><input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} className={inputCls} /></Field>
            <Field label="المبلغ (د.ع)"><input type="number" value={editing.amount} onChange={e => setEditing({ ...editing, amount: e.target.value })} className={inputCls} /></Field>
            <Field label="النوع" className="col-span-2">
              <select value={editing.categoryId} onChange={e => setEditing({ ...editing, categoryId: e.target.value })} className={inputCls}>
                <option value="">— اختر —</option>
                {(cats.data ?? []).filter(c => c.isActive === 1).map(c => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </select>
            </Field>
            <Field label="ملاحظات" className="col-span-2"><textarea value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} className={`${inputCls} min-h-20`} /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button disabled={create.isPending || !editing.amount}
              onClick={() => create.mutate({
                date: editing.date,
                amount: editing.amount,
                categoryId: editing.categoryId ? parseInt(editing.categoryId) : undefined,
                notes: editing.notes || undefined,
              })}>{create.isPending ? "جارٍ الحفظ…" : "حفظ"}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ───── Categories ─────
function CategoriesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "expense-categories"],
    queryFn: () => adminFetch<Category[]>("/admin/expense-categories"),
  });
  const [editing, setEditing] = useState<null | { id?: number; name: string; nameAr: string; isActive: boolean }>(null);
  const save = useMutation({
    mutationFn: (b: any) => b.id
      ? adminFetch(`/admin/expense-categories/${b.id}`, { method: "PATCH", body: JSON.stringify(b) })
      : adminFetch("/admin/expense-categories", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "expense-categories"] }); setEditing(null); },
    onError: (err: any) => toast({ title: "تعذر حفظ نوع المصروف", description: err?.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/expense-categories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "expense-categories"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">أنواع المصاريف المتاحة عند تسجيل مصروف جديد</p>
        <Button onClick={() => setEditing({ name: "", nameAr: "", isActive: true })}>
          <Plus className="w-4 h-4 ml-1" />نوع جديد
        </Button>
      </div>

      {isLoading ? <Skeletons />
      : !data || data.length === 0 ? <EmptyState message="لا توجد أنواع بعد" />
      : (
        <DataTable
          columns={["الاسم بالعربي", "الاسم بالإنجليزي", "الحالة", ""]}
          rows={data.map(c => [
            c.nameAr,
            <span className="text-muted-foreground text-xs">{c.name}</span>,
            c.isActive === 1
              ? <span className="text-status-success text-xs">مفعّل</span>
              : <span className="text-muted-foreground text-xs">معطّل</span>,
            <div className="flex gap-1 justify-end">
              <button onClick={() => setEditing({ id: c.id, name: c.name, nameAr: c.nameAr, isActive: c.isActive === 1 })} className="px-2 py-1 text-xs hover:bg-background/50 rounded text-muted-foreground hover:text-primary">تعديل</button>
              <button onClick={() => { if (confirm("حذف النوع؟")) del.mutate(c.id); }} className="p-1.5 hover:bg-background/50 rounded text-destructive"><Trash2 className="w-4 h-4" /></button>
            </div>,
          ])}
        />
      )}

      {editing && (
        <Modal title={editing.id ? "تعديل نوع مصروف" : "نوع مصروف جديد"} onClose={() => setEditing(null)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الاسم بالعربي"><input value={editing.nameAr} onChange={e => setEditing({ ...editing, nameAr: e.target.value })} className={inputCls} /></Field>
            <Field label="الاسم بالإنجليزي"><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className={inputCls} /></Field>
            <Field label="الحالة" className="col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })} /> مفعّل
              </label>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate(editing)}>
              {save.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ───── Statement ─────
type StatementEntry = {
  date: string; kind: "order" | "booking" | "receipt" | "invoice" | "invoice_payment";
  ref: string; description: string; debit: number; credit: number; balance: number;
  href?: string | null;
};
type StatementData = {
  customer: { id: number | null; name: string; phone: string };
  entries: StatementEntry[];
  totals: { totalCharges: number; totalPayments: number; balance: number };
};

type CustomerLite = { id: number; name: string; phone: string };

type CustomerAccountDetail = CustomerLite & {
  summary: {
    productOrders: number;
    serviceOrders: number;
    invoices: number;
    totalSpent: number;
    totalPaid?: number;
    remainingTotal: number;
    openInvoices?: number;
  };
  orders: Array<{ id: number; trackingCode: string; total: number; remainingAmount: number; createdAt: string }>;
  serviceOrders: Array<{ id: number; trackingCode: string; total: number; remainingAmount: number; createdAt: string }>;
  invoices: Array<{ id: number; invoiceNo: string; total: number; remainingAmount: number; createdAt: string }>;
};

function VoucherListSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative max-w-md">
      <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="بحث باسم العميل أو رقم الهاتف"
        className={`${inputCls} pr-10`}
      />
    </div>
  );
}

function VoucherCustomerPicker({
  selectedId,
  onSelect,
  onClear,
}: {
  selectedId: number | null;
  onSelect: (customer: CustomerLite) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const customers = useQuery({
    queryKey: ["admin", "voucher-customers", deferredSearch],
    queryFn: () => adminFetch<CustomerLite[]>(`/admin/customers?search=${encodeURIComponent(deferredSearch)}`),
    enabled: deferredSearch.length > 0,
    staleTime: 30_000,
  });
  const detail = useQuery({
    queryKey: ["admin", "voucher-customer-account", selectedId],
    queryFn: () => adminFetch<CustomerAccountDetail>(`/admin/customers/${selectedId}`),
    enabled: !!selectedId,
    staleTime: 30_000,
  });
  const recent = useMemo(() => {
    if (!detail.data) return [];
    return [
      ...detail.data.orders.map((row) => ({ code: row.trackingCode, kind: "طلب متجر", total: row.total, date: row.createdAt })),
      ...detail.data.serviceOrders.map((row) => ({ code: row.trackingCode, kind: "حجز خدمة", total: row.total, date: row.createdAt })),
      ...detail.data.invoices.map((row) => ({ code: row.invoiceNo, kind: "فاتورة", total: row.total, date: row.createdAt })),
    ].sort((left, right) => right.date.localeCompare(left.date)).slice(0, 5);
  }, [detail.data]);

  const summary = detail.data?.summary;
  const totalPaid = summary ? (summary.totalPaid ?? Math.max(summary.totalSpent - summary.remainingTotal, 0)) : 0;
  const linkedCount = summary ? summary.productOrders + summary.serviceOrders + summary.invoices : 0;

  return (
    <div className="col-span-2 rounded-xl border border-border/30 bg-background/35 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">بحث باسم العميل</div>
          <div className="text-xs text-muted-foreground">ابحث بالاسم أو الهاتف بصيغة 077 أو 964 أو +964</div>
        </div>
        {selectedId && <button type="button" onClick={onClear} className="text-xs text-destructive hover:underline">إزالة الربط</button>}
      </div>
      <div className="relative">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم العميل أو رقم الهاتف" className={`${inputCls} pr-10`} />
      </div>
      {deferredSearch && !selectedId && (
        <div className="max-h-44 overflow-y-auto rounded-lg border border-border/30 divide-y divide-border/20">
          {customers.isLoading ? <div className="p-3 text-xs text-muted-foreground">جارٍ البحث…</div>
          : !customers.data?.length ? <div className="p-3 text-xs text-muted-foreground">لا يوجد عميل مطابق</div>
          : customers.data.slice(0, 12).map((customer) => (
            <button
              key={customer.id}
              type="button"
              onClick={() => { onSelect(customer); setSearch(""); }}
              className="flex w-full items-center justify-between gap-3 p-3 text-right hover:bg-primary/5"
            >
              <span className="min-w-0 truncate text-sm text-foreground">{customer.name || "بدون اسم"}</span>
              <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">{formatIraqiPhone(customer.phone)}</span>
            </button>
          ))}
        </div>
      )}
      {selectedId && detail.isLoading && <div className="text-xs text-muted-foreground">جارٍ تحميل حساب العميل…</div>}
      {selectedId && detail.data && summary && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <strong className="text-primary">{detail.data.name || "بدون اسم"}</strong>
            <span className="text-muted-foreground" dir="ltr">{formatIraqiPhone(detail.data.phone)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniAccountStat label="الحجوزات والطلبات" value={String(linkedCount)} />
            <MiniAccountStat label="إجمالي الحساب" value={formatCurrency(summary.totalSpent)} />
            <MiniAccountStat label="إجمالي المدفوع" value={formatCurrency(totalPaid)} />
            <MiniAccountStat label="إجمالي المتبقي" value={formatCurrency(summary.remainingTotal)} />
          </div>
          {recent.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs text-muted-foreground">آخر العمليات المرتبطة</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {recent.map((row) => (
                  <div key={`${row.kind}-${row.code}`} className="flex items-center justify-between gap-2 rounded-lg border border-border/20 px-2.5 py-2 text-xs">
                    <span className="min-w-0 truncate"><span className="text-muted-foreground">{row.kind}</span> · {row.code}</span>
                    <strong className="shrink-0">{formatCurrency(row.total)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniAccountStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border/20 bg-card/70 p-2"><div className="text-[11px] text-muted-foreground">{label}</div><div className="mt-1 text-xs font-bold text-foreground">{value}</div></div>;
}

function StatementTab() {
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<CustomerLite | null>(null);

  const customers = useQuery({
    queryKey: ["admin", "customers-picker", search],
    queryFn: () => adminFetch<CustomerLite[]>(`/admin/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`),
    enabled: pickerOpen,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin", "statement", selected?.id],
    queryFn: () => adminFetch<StatementData>(`/admin/accounting/statement?customerId=${selected!.id}`),
    enabled: !!selected,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Button variant="outline" onClick={() => setPickerOpen(true)}>
          <Search className="w-4 h-4 ml-1" />
          {selected ? "تغيير الزبون" : "اختر زبون"}
        </Button>
        {selected && (
          <div className="text-sm text-foreground bg-card rounded-lg border border-border/30 px-3 py-2">
            <strong className="text-primary">{selected.name || "—"}</strong>
            <span className="text-muted-foreground mr-2">{formatIraqiPhone(selected.phone)}</span>
            <button onClick={() => setSelected(null)} className="text-destructive text-xs mr-3 hover:underline">إزالة</button>
          </div>
        )}
      </div>

      {pickerOpen && (
        <Modal title="اختر زبون" onClose={() => setPickerOpen(false)}>
          <div className="relative mb-3">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input autoFocus value={search} onChange={e => setSearch(formatIraqiPhoneInput(e.target.value) || e.target.value)}
              placeholder="ابحث بالاسم أو الهاتف..."
              className={`${inputCls} pr-10`} />
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-border/20 rounded-lg border border-border/30">
            {customers.isLoading ? <div className="p-4 text-sm text-muted-foreground">جارٍ التحميل…</div>
            : !customers.data || customers.data.length === 0 ? <div className="p-4 text-sm text-muted-foreground text-center">لا توجد نتائج</div>
            : customers.data.map(c => (
              <button key={c.id} onClick={() => { setSelected({ id: c.id, name: c.name, phone: c.phone }); setPickerOpen(false); }}
                className="w-full text-right p-3 hover:bg-background/50 flex justify-between items-center">
                <span className="text-foreground">{c.name || "—"}</span>
                <span className="text-xs text-muted-foreground">{formatIraqiPhone(c.phone)}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {!selected ? <EmptyState message="اختر زبون لعرض كشف الحساب" />
      : isLoading ? <Skeletons />
      : isError ? <div className="text-sm text-destructive">{(error as Error)?.message ?? "خطأ"}</div>
      : data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <StatCard label="الزبون" value={data.customer.name} />
            <StatCard label="إجمالي المستحق" value={formatCurrency(data.totals.totalCharges)} />
            <StatCard label="إجمالي المدفوع" value={formatCurrency(data.totals.totalPayments)} />
            <StatCard label="الرصيد" value={formatCurrency(data.totals.balance)}
              accent={data.totals.balance > 0 ? "text-status-warning" : "text-status-success"} />
          </div>

          {data.entries.length === 0 ? <EmptyState message="لا توجد حركات لهذا الزبون" />
          : <DataTable
              columns={["التاريخ", "النوع", "المرجع", "الوصف", "مدين", "دائن", "المبلغ المتبقي"]}
              rows={data.entries.map(e => [
                new Date(e.date).toLocaleDateString("ar-IQ"),
                e.kind === "order" ? "طلب" : e.kind === "booking" ? "حجز" : e.kind === "invoice" ? "فاتورة" : e.kind === "invoice_payment" ? "دفعة" : "قبض",
                <span className="inline-flex items-center gap-1.5 text-primary">
                  <code className="text-xs">{e.ref}</code>
                  {e.href ? <FileText className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                </span>,
                e.description,
                e.debit ? formatCurrency(e.debit) : "—",
                e.credit ? <span className="text-status-success">{formatCurrency(e.credit)}</span> : "—",
                <strong>{formatCurrency(e.balance)}</strong>,
              ])}
              rowHrefs={data.entries.map((entry) => entry.href ?? null)}
            />
          }
        </div>
      )}
    </div>
  );
}

type ReceivablesReportType =
  | "outstanding"
  | "paid"
  | "balances"
  | "ledger"
  | "daily-payments"
  | "monthly-payments"
  | "receipts"
  | "overdue";

type ReceivablesPayload = {
  type: ReceivablesReportType;
  from: string;
  to: string;
  rows: Record<string, any>[];
};

const RECEIVABLE_REPORTS: Array<{ value: ReceivablesReportType; label: string }> = [
  { value: "ledger", label: "دفتر حسابات العملاء" },
  { value: "outstanding", label: "العملاء المدينون" },
  { value: "paid", label: "العملاء المسددون" },
  { value: "balances", label: "الأرصدة المستحقة" },
  { value: "daily-payments", label: "الدفعات اليومية" },
  { value: "monthly-payments", label: "الدفعات الشهرية" },
  { value: "receipts", label: "تقرير سندات القبض" },
  { value: "overdue", label: "الدفعات المتأخرة" },
];

function ReceivablesTab() {
  const reportRef = useRef<HTMLDivElement>(null);
  const { data: settings } = usePublicSettings();
  const [type, setType] = useState<ReceivablesReportType>("outstanding");
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1);
    return date.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(todayStr());
  const [search, setSearch] = useState("");
  const report = useQuery({
    queryKey: ["admin", "accounting", "receivables", type, from, to],
    queryFn: () => adminFetch<ReceivablesPayload>(`/admin/accounting/receivables?type=${type}&from=${from}&to=${to}`),
  });
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return report.data?.rows ?? [];
    return (report.data?.rows ?? []).filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(term)));
  }, [report.data, search]);
  const customerReport = !["daily-payments", "monthly-payments", "receipts"].includes(type);
  const columns = customerReport
    ? [
        ["customer_name", "العميل"], ["phone", "الهاتف"], ["invoice_count", "الفواتير"],
        ["total", "الإجمالي"], ["paid", "المدفوع"], ["remaining", "المتبقي"],
        ["open_invoices", "المفتوحة"], ["last_invoice_date", "آخر فاتورة"], ["oldest_due_date", "الاستحقاق"],
      ]
    : type === "receipts"
      ? [["voucher_no", "السند"], ["date", "التاريخ"], ["payer_name", "العميل"], ["phone", "الهاتف"], ["amount", "المبلغ"], ["method", "الطريقة"], ["approval_status", "الحالة"]]
      : [["period", type === "daily-payments" ? "اليوم" : "الشهر"], ["payment_count", "عدد الدفعات"], ["total_paid", "إجمالي المدفوع"]];
  const total = rows.reduce((sum, row) => sum + Number(row.remaining ?? row.amount ?? row.total_paid ?? 0), 0);
  const paid = rows.reduce((sum, row) => sum + Number(row.paid ?? row.total_paid ?? 0), 0);

  function cell(row: Record<string, any>, key: string) {
    if (["total", "paid", "remaining", "amount", "total_paid"].includes(key)) return formatCurrency(row[key] ?? 0);
    if (key === "method") return methodLabel(String(row[key] ?? ""));
    if (key === "approval_status") return row[key] === "executed" ? "معتمد" : row[key] === "pending" ? "قيد الاعتماد" : String(row[key] ?? "—");
    return String(row[key] ?? "—");
  }

  function exportCsv() {
    const csvRows = [columns.map((column) => column[1]), ...rows.map((row) => columns.map((column) => cell(row, column[0])))];
    const csv = csvRows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ajn-${type}-${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    if (!reportRef.current) return;
    const popup = window.open("", "_blank", "width=1100,height=800");
    if (!popup) return;
    popup.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${RECEIVABLE_REPORTS.find((item) => item.value === type)?.label}</title><style>${sheetReportCss("a4")}</style></head><body>${reportRef.current.outerHTML}${printWhenImagesReadyScript()}</body></html>`);
    popup.document.close();
  }

  async function exportPdf() {
    if (!reportRef.current) return;
    await downloadElementPdf(reportRef.current, `ajn-${type}-${from}-${to}.pdf`, { format: "a4", margin: 8 });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/30 bg-card p-4">
        <Field label="نوع التقرير"><select value={type} onChange={(event) => setType(event.target.value as ReceivablesReportType)} className={inputCls}>{RECEIVABLE_REPORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <Field label="من تاريخ"><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={inputCls} /></Field>
        <Field label="إلى تاريخ"><input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={inputCls} /></Field>
        <Field label="بحث"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم، هاتف، سند..." className={inputCls} /></Field>
        <div className="mr-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={printReport}><Printer className="ml-1 h-4 w-4" />طباعة</Button>
          <Button variant="outline" onClick={exportPdf}><Download className="ml-1 h-4 w-4" />PDF</Button>
          <Button variant="outline" onClick={exportCsv}><FileSpreadsheet className="ml-1 h-4 w-4" />Excel / CSV</Button>
        </div>
      </div>
      {report.isLoading ? <Skeletons /> : (
        <div ref={reportRef} className="report-sheet rounded-xl border border-border/30 bg-card p-5">
          <div className="report-head flex items-center justify-between gap-4 border-b border-border/30 pb-4">
            <div><div className="report-company text-lg font-bold">{settings?.site_name ?? "مجموعة علي جان نهاد"}</div><div className="report-title mt-1 text-xl font-bold text-primary">{RECEIVABLE_REPORTS.find((item) => item.value === type)?.label}</div></div>
            <img className="report-logo h-12 w-auto object-contain" src={logoSrc(settings)} alt="AJN" />
          </div>
          <div className="report-meta my-3 text-xs text-muted-foreground">الفترة: {from} إلى {to} · تاريخ الإنشاء: {new Date().toLocaleString("ar-IQ")}</div>
          <div className="report-summary mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatCard label="عدد السجلات" value={rows.length.toLocaleString("ar-IQ")} />
            <StatCard label={customerReport ? "إجمالي المتبقي" : "إجمالي التقرير"} value={formatCurrency(total)} accent={total > 0 ? "text-status-warning" : "text-status-success"} />
            <StatCard label="إجمالي المدفوع" value={formatCurrency(paid)} accent="text-status-success" />
            <StatCard label="الفترة" value={`${from} — ${to}`} />
          </div>
          <div className="overflow-x-auto">
            <table className="report-table w-full text-sm">
              <thead><tr>{columns.map((column) => <th key={column[0]} className="border border-border/30 p-2 text-right">{column[1]}</th>)}</tr></thead>
              <tbody>{rows.length ? rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column[0]} className="border border-border/20 p-2">{cell(row, column[0])}</td>)}</tr>) : <tr><td colSpan={columns.length} className="p-8 text-center text-muted-foreground">لا توجد بيانات</td></tr>}</tbody>
            </table>
          </div>
          <div className="report-footer mt-4 border-t border-border/30 pt-3 text-center text-xs text-muted-foreground">تم إنشاء التقرير من نظام AJN</div>
        </div>
      )}
    </div>
  );
}

// ───── P&L ─────
type PnL = {
  from: string; to: string;
  totalSales: number; totalReceipts: number; totalPayments: number; totalExpenses: number;
  netProfit: number; // server returns this; we present as "صافي التدفق النقدي"
  expensesByCategory: { categoryId: number | null; categoryName: string; total: number }[];
};

function PnLTab() {
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => todayStr());
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "pnl", from, to],
    queryFn: () => adminFetch<PnL>(`/admin/accounting/pnl?from=${from}&to=${to}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <Field label="من تاريخ"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} /></Field>
        <Field label="إلى تاريخ"><input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} /></Field>
      </div>

      {isLoading ? <Skeletons /> : data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="مبيعات المتجر" value={formatCurrency(data.totalSales)} />
            <StatCard label="إجمالي القبض" value={formatCurrency(data.totalReceipts)} accent="text-status-success" />
            <StatCard label="إجمالي الصرف" value={formatCurrency(data.totalPayments)} accent="text-status-warning" />
            <StatCard label="إجمالي المصاريف" value={formatCurrency(data.totalExpenses)} accent="text-status-warning" />
            <StatCard label="صافي التدفق النقدي" value={formatCurrency(data.netProfit)}
              accent={data.netProfit >= 0 ? "text-status-success" : "text-destructive"} />
          </div>

          <div className="bg-card rounded-xl border border-border/30 p-4">
            <h3 className="text-sm font-medium mb-3">المصاريف حسب النوع</h3>
            {data.expensesByCategory.length === 0
              ? <p className="text-sm text-muted-foreground py-8 text-center">لا توجد مصاريف في هذه الفترة</p>
              : (
                <div style={{ width: "100%", height: 280 }}>
                  <ResponsiveContainer>
                    <BarChart data={data.expensesByCategory}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="categoryName" stroke="rgba(255,255,255,0.5)" fontSize={12} />
                      <YAxis stroke="rgba(255,255,255,0.5)" fontSize={11} tickFormatter={(value) => formatMoney(Number(value))} />
                      <Tooltip
                        contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(201,168,76,0.3)", borderRadius: 8 }}
                        formatter={(v: number) => formatCurrency(v)} />
                      <Bar dataKey="total" fill="#C9A84C" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
          </div>
        </>
      )}
    </div>
  );
}

// ───── Helpers ─────
const inputCls = "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border/40 w-full max-w-2xl my-6 p-5 space-y-3 max-h-[calc(100dvh-3rem)] overflow-y-auto pb-safe" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-card rounded-xl border border-border/30 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-1 ${accent ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}

function DataTable({ columns, rows, rowHrefs }: { columns: string[]; rows: React.ReactNode[][]; rowHrefs?: Array<string | null> }) {
  return (
    <div className="bg-card rounded-xl border border-border/30 overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-background/50">
          <tr className="text-muted-foreground border-b border-border/30">
            {columns.map((c, i) => <th key={i} className="text-right p-3 font-medium whitespace-nowrap">{c}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {rows.map((cells, i) => {
            const href = rowHrefs?.[i] ?? null;
            const openDocument = () => {
              if (href) window.open(href, "_blank", "noopener,noreferrer");
            };
            return (
            <tr
              key={i}
              className={href ? "cursor-pointer transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60" : "hover:bg-background/30"}
              role={href ? "link" : undefined}
              tabIndex={href ? 0 : undefined}
              title={href ? "فتح الفاتورة المرتبطة" : undefined}
              onClick={href ? openDocument : undefined}
              onKeyDown={href ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openDocument();
                }
              } : undefined}
            >
              {cells.map((cell, j) => <td key={j} className="p-3 align-middle">{cell}</td>)}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Skeletons() {
  return <div className="space-y-3">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>;
}

// ───── Print slips ─────
function buildVoucherHtml(opts: {
  kind: "قبض" | "صرف" | "مصروف";
  voucherNo: string;
  date: string;
  amount: string;
  party: string;
  partyLabel: string;
  method: string;
  reference: string | null;
  notes: string | null;
  createdByName: string;
}): string {
  const amountFmt = formatCurrency(opts.amount);
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>سند ${opts.kind} ${opts.voucherNo}</title>
<style>
  *{box-sizing:border-box;font-family:"Tajawal","Cairo",system-ui,sans-serif}
  body{margin:0;padding:30px;color:#111;background:#fff}
  .slip{max-width:720px;margin:0 auto;border:2px solid #C9A84C;border-radius:14px;padding:28px}
  .head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #C9A84C;padding-bottom:14px;margin-bottom:18px}
  .brand{font-size:22px;font-weight:800;color:#8a7637}
  .sub{font-size:12px;color:#666;margin-top:4px}
  .kind{font-size:20px;font-weight:800;color:#111;background:#C9A84C;border-radius:10px;padding:8px 16px}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #ddd;font-size:14px}
  .row b{color:#111}
  .amount{margin-top:20px;padding:18px;background:#fdf7e6;border:1px solid #C9A84C;border-radius:10px;text-align:center}
  .amount .label{font-size:12px;color:#8a7637;margin-bottom:6px}
  .amount .v{font-size:28px;font-weight:800;color:#111}
  .notes{margin-top:14px;padding:10px;background:#f8f8f8;border-radius:8px;font-size:13px;color:#444}
  .foot{margin-top:30px;display:flex;justify-content:space-between;font-size:12px;color:#666}
  .sig{border-top:1px solid #999;width:160px;text-align:center;padding-top:6px}
  @media print { body{padding:0} .slip{border-radius:0;border-width:1px} }
</style></head><body>
<div class="slip">
  <div class="head">
    <div>
      <div class="brand">مجموعة علي جان</div>
      <div class="sub">طوزخورماتو — صلاح الدين</div>
    </div>
    <div class="kind">سند ${opts.kind}</div>
  </div>
  <div class="row"><span>رقم السند</span><b>${escapeHtml(opts.voucherNo)}</b></div>
  <div class="row"><span>التاريخ</span><b>${escapeHtml(opts.date)}</b></div>
  <div class="row"><span>${escapeHtml(opts.partyLabel)}</span><b>${escapeHtml(opts.party)}</b></div>
  <div class="row"><span>طريقة الدفع</span><b>${escapeHtml(opts.method)}</b></div>
  ${opts.reference ? `<div class="row"><span>المرجع</span><b>${escapeHtml(opts.reference)}</b></div>` : ""}
  <div class="amount">
    <div class="label">المبلغ</div>
    <div class="v">${amountFmt}</div>
  </div>
  ${opts.notes ? `<div class="notes"><b>ملاحظات:</b> ${escapeHtml(opts.notes)}</div>` : ""}
  <div class="foot">
    <div class="sig">توقيع الموظف<br><b style="color:#111">${escapeHtml(opts.createdByName || "—")}</b></div>
    <div class="sig">توقيع المستلم</div>
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function openPrintWindow(html: string) {
  const w = window.open("", "_blank", "width=820,height=900");
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}

function printReceipt(r: ReceiptVoucher) {
  openPrintWindow(buildVoucherHtml({
    kind: "قبض",
    voucherNo: r.voucherNo, date: r.date, amount: r.amount,
    party: r.payerName, partyLabel: "الواصل من",
    method: methodLabel(r.method), reference: r.reference, notes: r.notes,
    createdByName: r.createdByName,
  }));
}
function printPayment(r: PaymentVoucher) {
  openPrintWindow(buildVoucherHtml({
    kind: "صرف",
    voucherNo: r.voucherNo, date: r.date, amount: r.amount,
    party: r.payeeName, partyLabel: "صُرف إلى",
    method: methodLabel(r.method), reference: r.reference, notes: r.notes,
    createdByName: r.createdByName,
  }));
}
function printExpense(e: Expense) {
  openPrintWindow(buildVoucherHtml({
    kind: "مصروف",
    voucherNo: `EXP-${String(e.id).padStart(4, "0")}`,
    date: e.date,
    amount: e.amount,
    party: e.categoryName || "غير مصنف",
    partyLabel: "نوع المصروف",
    method: "—",
    reference: null,
    notes: e.notes,
    createdByName: e.createdByName,
  }));
}
