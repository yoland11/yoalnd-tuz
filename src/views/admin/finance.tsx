import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Wallet, TrendingUp, TrendingDown, Coins, Scale, PiggyBank, ShoppingBag, Receipt, CircleDollarSign,
  Lock, Unlock, ShieldCheck, FileSpreadsheet, Printer, FileText, Plus, Trash2, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, formatCurrency, type AdminMe } from "./_lib";
import { EmptyState } from "./_layout";

const inputCls = "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50";

const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: "cash", label: "نقد" },
  { value: "transfer", label: "حوالة" },
  { value: "pos", label: "بطاقة / POS" },
];

const STATUS_LABEL: Record<string, string> = {
  balanced: "مطابق",
  surplus: "زيادة نقدية",
  shortage: "عجز نقدي",
  not_reconciled: "لم يُجرَد",
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function printDocument(title: string, tableHtml: string, thermal = false) {
  const win = window.open("", "_blank", "width=820,height=900");
  if (!win) return;
  const width = thermal ? "80mm" : "auto";
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:'Cairo',Tahoma,sans-serif;color:#111;margin:${thermal ? "4mm" : "16mm"};width:${width}}
    h1{font-size:${thermal ? "14px" : "20px"};margin:0 0 8px}.muted{color:#666;font-size:12px;margin:0 0 14px}
    table{width:100%;border-collapse:collapse;font-size:${thermal ? "11px" : "13px"}}
    th,td{border:1px solid #ccc;padding:${thermal ? "3px 4px" : "6px 8px"};text-align:center}
    th{background:#f3f3f3}</style></head><body>
    <h1>${title}</h1><p class="muted">مجموعة علي جان · ${todayStr()}</p>${tableHtml}
    <script>window.onload=function(){window.print();}</script></body></html>`);
  win.document.close();
}

// ===================== لوحة الإدارة المالية =====================
type FinanceDashboard = {
  reportDate: string;
  suggestedOpeningBalance: number;
  cards: {
    todaySales: number; todayExpenses: number; openingBalance: number; closingBalance: number;
    cashDifference: number | null; netProfit: number; totalOrders: number; totalInvoices: number;
  };
  reportStatus: "open" | "closed";
  reconciliationStatus: string;
  approvalStatus: "none" | "pending" | "approved";
  needsApproval: boolean;
  actualCashInDrawer: number | null;
};

export function FinanceDashboardPage({ me }: { me: AdminMe }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [approvalNote, setApprovalNote] = useState("");
  const isManager = me.role === "admin";

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "finance", "dashboard"],
    queryFn: () => adminFetch<FinanceDashboard>("/admin/daily-cash/dashboard"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "finance", "dashboard"] });
    qc.invalidateQueries({ queryKey: ["admin", "daily-cash"] });
  };

  const closeDay = useMutation({
    mutationFn: () => adminFetch("/admin/daily-cash/close", { method: "POST", body: JSON.stringify({ reportDate: data?.reportDate }) }),
    onSuccess: () => { invalidate(); toast({ title: "تم إقفال اليوم" }); },
    onError: (e: any) => toast({ title: "تعذّر الإقفال", description: e?.message, variant: "destructive" }),
  });
  const reopenDay = useMutation({
    mutationFn: () => adminFetch("/admin/daily-cash/reopen", { method: "POST", body: JSON.stringify({ reportDate: data?.reportDate }) }),
    onSuccess: () => { invalidate(); toast({ title: "تمت إعادة فتح اليوم" }); },
    onError: (e: any) => toast({ title: "تعذّرت إعادة الفتح", description: e?.message, variant: "destructive" }),
  });
  const approve = useMutation({
    mutationFn: () => adminFetch("/admin/daily-cash/approve", { method: "POST", body: JSON.stringify({ reportDate: data?.reportDate, note: approvalNote }) }),
    onSuccess: () => { invalidate(); setApprovalNote(""); toast({ title: "تم اعتماد الفرق" }); },
    onError: (e: any) => toast({ title: "تعذّر الاعتماد", description: e?.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>;
  }

  const c = data.cards;
  const cards = [
    { label: "مبيعات اليوم", value: formatCurrency(c.todaySales), icon: TrendingUp, tone: "text-green-400" },
    { label: "مصاريف اليوم", value: formatCurrency(c.todayExpenses), icon: TrendingDown, tone: "text-red-400" },
    { label: "رصيد الافتتاح", value: formatCurrency(c.openingBalance), icon: Wallet, tone: "text-primary" },
    { label: "رصيد الإغلاق", value: formatCurrency(c.closingBalance), icon: Coins, tone: "text-primary" },
    { label: "فرق الصندوق", value: c.cashDifference == null ? "—" : formatCurrency(c.cashDifference), icon: Scale, tone: c.cashDifference && Math.abs(c.cashDifference) >= 0.005 ? "text-amber-400" : "text-green-400" },
    { label: "صافي الربح", value: formatCurrency(c.netProfit), icon: PiggyBank, tone: "text-green-400" },
    { label: "عدد الطلبات", value: c.totalOrders.toLocaleString("ar-IQ"), icon: ShoppingBag, tone: "text-foreground" },
    { label: "عدد الفواتير", value: c.totalInvoices.toLocaleString("ar-IQ"), icon: Receipt, tone: "text-foreground" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">الإدارة المالية</h1>
          <p className="text-sm text-muted-foreground">تقرير اليوم {data.reportDate} · الرصيد المرحَّل المقترح: {formatCurrency(data.suggestedOpeningBalance)}</p>
        </div>
        <div className="flex items-center gap-2">
          {data.reportStatus === "closed" ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"><Lock className="w-3.5 h-3.5" /> اليوم مقفل</span>
              {isManager && <Button variant="outline" size="sm" className="gap-1.5" disabled={reopenDay.isPending} onClick={() => reopenDay.mutate()}><Unlock className="w-4 h-4" /> إعادة فتح</Button>}
            </>
          ) : (
            <Button size="sm" className="gap-1.5" disabled={closeDay.isPending} onClick={() => { if (confirm("إقفال اليوم؟ لن يمكن تعديله بعدها إلا بصلاحية مدير.")) closeDay.mutate(); }}>
              <Lock className="w-4 h-4" /> إقفال اليوم
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="bg-card rounded-xl border border-border/30 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <card.icon className={`w-4 h-4 ${card.tone}`} />
            </div>
            <p className={`text-lg font-bold ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {data.needsApproval && (
        <div className="bg-card rounded-xl border border-amber-500/30 p-5">
          <div className="flex items-center gap-2 mb-2"><ShieldCheck className="w-5 h-5 text-amber-400" /><h2 className="font-semibold text-foreground">يتطلب موافقة المدير</h2></div>
          <p className="text-sm text-muted-foreground mb-3">يوجد فرق في الصندوق ({STATUS_LABEL[data.reconciliationStatus] ?? data.reconciliationStatus} = {formatCurrency(data.cards.cashDifference ?? 0)}). يلزم اعتماد المدير.</p>
          {isManager ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)} placeholder="ملاحظة الاعتماد (اختياري)" className={`${inputCls} flex-1`} />
              <Button className="gap-1.5" disabled={approve.isPending} onClick={() => approve.mutate()}><ShieldCheck className="w-4 h-4" /> اعتماد الفرق</Button>
            </div>
          ) : (
            <p className="text-xs text-amber-400">بانتظار اعتماد المدير.</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { href: "/admin/finance/master-cash", label: "الصندوق الرئيسي", icon: CircleDollarSign },
          { href: "/admin/finance/daily-report", label: "التقرير اليومي", icon: Receipt },
          { href: "/admin/finance/reconciliation", label: "جرد الصندوق", icon: Scale },
          { href: "/admin/expenses", label: "المصاريف", icon: TrendingDown },
          { href: "/admin/finance/reports", label: "التقارير والتصدير", icon: FileText },
          { href: "/admin/accounting", label: "الحسابات", icon: Wallet },
        ].map((link) => (
          <Link key={link.href} href={link.href} className="bg-card rounded-xl border border-border/30 p-4 flex flex-col items-center gap-2 text-center hover:border-primary/50 transition-colors">
            <link.icon className="w-6 h-6 text-primary" />
            <span className="text-sm text-foreground">{link.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ===================== إدارة المصاريف =====================
type ExpenseRow = { id: number; date: string; name: string; amount: string; categoryId: number | null; categoryName: string; paymentMethod: string; receiptImage: string | null; notes: string | null; createdByName: string };
type ExpenseCategory = { id: number; nameAr: string };

export function FinanceExpensesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [from, setFrom] = useState(addDays(todayStr(), -30));
  const [to, setTo] = useState(todayStr());
  const [methodFilter, setMethodFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [form, setForm] = useState({ date: todayStr(), name: "", amount: "", categoryId: "", paymentMethod: "cash", notes: "", receiptImage: "" });

  const { data: categories } = useQuery({ queryKey: ["admin", "expense-categories"], queryFn: () => adminFetch<ExpenseCategory[]>("/admin/expense-categories") });
  const { data: expenses, isLoading } = useQuery({
    queryKey: ["admin", "expenses", from, to],
    queryFn: () => adminFetch<ExpenseRow[]>(`/admin/expenses?from=${from}&to=${to}`),
  });

  const save = useMutation({
    mutationFn: () => adminFetch("/admin/expenses", { method: "POST", body: JSON.stringify({ ...form, categoryId: form.categoryId ? Number(form.categoryId) : null, amount: Number(form.amount) }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "expenses"] }); setForm({ date: todayStr(), name: "", amount: "", categoryId: "", paymentMethod: "cash", notes: "", receiptImage: "" }); toast({ title: "تمت إضافة المصروف" }); },
    onError: (e: any) => toast({ title: "تعذّر الحفظ", description: e?.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/expenses/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "expenses"] }); toast({ title: "تم الحذف" }); },
  });

  async function onReceipt(file: File) {
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, receiptImage: String(reader.result || "") }));
    reader.readAsDataURL(file);
  }

  const rows = useMemo(() => (expenses ?? []).filter((e) =>
    (!methodFilter || e.paymentMethod === methodFilter) &&
    (!catFilter || String(e.categoryId ?? "") === catFilter),
  ), [expenses, methodFilter, catFilter]);
  const total = rows.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">إدارة المصاريف</h1>

      <form onSubmit={(e) => { e.preventDefault(); if (!form.amount) return; save.mutate(); }} className="bg-card rounded-xl border border-border/30 p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div><label className="block text-xs text-muted-foreground mb-1">التاريخ</label><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} /></div>
        <div><label className="block text-xs text-muted-foreground mb-1">اسم المصروف</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="مثال: إيجار شهر" /></div>
        <div><label className="block text-xs text-muted-foreground mb-1">المبلغ (د.ع)</label><input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} placeholder="0" /></div>
        <div><label className="block text-xs text-muted-foreground mb-1">التصنيف</label>
          <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className={inputCls}>
            <option value="">— بدون تصنيف —</option>
            {(categories ?? []).map((cat) => <option key={cat.id} value={cat.id}>{cat.nameAr}</option>)}
          </select>
        </div>
        <div><label className="block text-xs text-muted-foreground mb-1">طريقة الدفع</label>
          <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className={inputCls}>
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div><label className="block text-xs text-muted-foreground mb-1">صورة الإيصال</label>
          <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onReceipt(e.target.files[0])} className="text-xs text-muted-foreground file:ml-2 file:rounded file:border-0 file:bg-primary/10 file:text-primary file:px-2 file:py-1" />
        </div>
        <div className="lg:col-span-2"><label className="block text-xs text-muted-foreground mb-1">ملاحظات</label><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} /></div>
        <div className="flex items-end"><Button type="submit" className="w-full gap-1.5" disabled={save.isPending}><Plus className="w-4 h-4" /> إضافة المصروف</Button></div>
      </form>

      <div className="flex flex-wrap items-center gap-2 bg-card/60 border border-border/30 rounded-xl p-3">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} w-auto`} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputCls} w-auto`} />
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="">كل التصنيفات</option>
          {(categories ?? []).map((cat) => <option key={cat.id} value={cat.id}>{cat.nameAr}</option>)}
        </select>
        <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="">كل طرق الدفع</option>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <span className="text-sm text-muted-foreground mr-auto">الإجمالي: <span className="font-bold text-foreground">{formatCurrency(total)}</span></span>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => downloadCsv(`expenses-${from}_${to}.csv`, ["التاريخ", "الاسم", "التصنيف", "طريقة الدفع", "المبلغ", "بواسطة", "ملاحظات"], rows.map((e) => [e.date, e.name, e.categoryName, PAYMENT_METHODS.find((m) => m.value === e.paymentMethod)?.label ?? e.paymentMethod, e.amount, e.createdByName, e.notes ?? ""]))}><FileSpreadsheet className="w-4 h-4" /> Excel</Button>
      </div>

      <div className="bg-card rounded-xl border border-border/30 overflow-x-auto">
        {isLoading ? <div className="p-6"><Skeleton className="h-40 rounded-lg" /></div> : rows.length === 0 ? <EmptyState message="لا توجد مصاريف ضمن الفترة" /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-muted-foreground border-b border-border/30 text-xs">
              {["التاريخ", "الاسم", "التصنيف", "طريقة الدفع", "المبلغ", "إيصال", "بواسطة", ""].map((h) => <th key={h} className="px-3 py-2.5 text-center font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-border/15">
                  <td className="px-3 py-2.5 text-center text-muted-foreground">{e.date}</td>
                  <td className="px-3 py-2.5 text-center text-foreground">{e.name || "—"}</td>
                  <td className="px-3 py-2.5 text-center">{e.categoryName || "—"}</td>
                  <td className="px-3 py-2.5 text-center">{PAYMENT_METHODS.find((m) => m.value === e.paymentMethod)?.label ?? e.paymentMethod}</td>
                  <td className="px-3 py-2.5 text-center font-semibold text-foreground">{formatCurrency(e.amount)}</td>
                  <td className="px-3 py-2.5 text-center">{e.receiptImage ? <a href={e.receiptImage} target="_blank" rel="noreferrer" className="text-primary text-xs underline">عرض</a> : "—"}</td>
                  <td className="px-3 py-2.5 text-center text-muted-foreground text-xs">{e.createdByName}</td>
                  <td className="px-3 py-2.5 text-center"><button onClick={() => confirm("حذف المصروف؟") && remove.mutate(e.id)} className="text-red-400 hover:bg-red-500/10 p-1.5 rounded"><Trash2 className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ===================== التقارير والتصدير =====================
type CashRow = {
  reportDate: string; openingBalance: number; totalSales: number; totalExpenses: number; closingBalance: number;
  expectedCashBalance: number; actualCashInDrawer: number | null; difference: number | null; status: string;
};
type ReportResponse = { data: CashRow[]; totals: { openingBalance: number; totalSales: number; totalExpenses: number; closingBalance: number; difference: number }; from: string; to: string };

const PERIODS = [
  { value: "daily", label: "يومي" },
  { value: "weekly", label: "أسبوعي" },
  { value: "monthly", label: "شهري" },
  { value: "custom", label: "مخصّص" },
];

export function FinanceReportsPage() {
  const [period, setPeriod] = useState("monthly");
  const [from, setFrom] = useState(addDays(todayStr(), -29));
  const [to, setTo] = useState(todayStr());

  const range = useMemo(() => {
    if (period === "daily") return { from: todayStr(), to: todayStr() };
    if (period === "weekly") return { from: addDays(todayStr(), -6), to: todayStr() };
    if (period === "monthly") return { from: addDays(todayStr(), -29), to: todayStr() };
    return { from, to };
  }, [period, from, to]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "finance", "reports", range.from, range.to],
    queryFn: () => adminFetch<ReportResponse>(`/admin/daily-cash/reports?from=${range.from}&to=${range.to}&limit=100`),
  });

  const rows = data?.data ?? [];
  const exportRows = rows.map((r) => [r.reportDate, r.openingBalance, r.totalSales, r.totalExpenses, r.closingBalance, r.actualCashInDrawer ?? "", r.difference ?? "", STATUS_LABEL[r.status] ?? r.status]);
  const headers = ["التاريخ", "الافتتاح", "المبيعات", "المصاريف", "الإغلاق", "النقد الفعلي", "الفرق", "الحالة"];

  function buildTableHtml() {
    const head = `<tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>`;
    const body = rows.map((r) => `<tr><td>${r.reportDate}</td><td>${r.openingBalance.toLocaleString("ar-IQ")}</td><td>${r.totalSales.toLocaleString("ar-IQ")}</td><td>${r.totalExpenses.toLocaleString("ar-IQ")}</td><td>${r.closingBalance.toLocaleString("ar-IQ")}</td><td>${r.actualCashInDrawer == null ? "—" : r.actualCashInDrawer.toLocaleString("ar-IQ")}</td><td>${r.difference == null ? "—" : r.difference.toLocaleString("ar-IQ")}</td><td>${STATUS_LABEL[r.status] ?? r.status}</td></tr>`).join("");
    return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">التقارير المالية</h1>

      <div className="flex flex-wrap items-center gap-2 bg-card/60 border border-border/30 rounded-xl p-3">
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className={`${inputCls} w-auto`}>
          {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {period === "custom" && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} w-auto`} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputCls} w-auto`} />
          </>
        )}
        <span className="text-xs text-muted-foreground">{range.from} ← {range.to}</span>
        <div className="flex items-center gap-2 mr-auto">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => downloadCsv(`finance-${range.from}_${range.to}.csv`, headers, exportRows)}><FileSpreadsheet className="w-4 h-4" /> Excel</Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => printDocument("تقرير مالي", buildTableHtml(), false)}><Printer className="w-4 h-4" /> A4</Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => printDocument("تقرير مالي", buildTableHtml(), true)}><FileText className="w-4 h-4" /> حراري</Button>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { label: "إجمالي المبيعات", value: data.totals.totalSales, tone: "text-green-400" },
            { label: "إجمالي المصاريف", value: data.totals.totalExpenses, tone: "text-red-400" },
            { label: "إجمالي الإغلاق", value: data.totals.closingBalance, tone: "text-primary" },
            { label: "صافي (مبيعات-مصاريف)", value: data.totals.totalSales - data.totals.totalExpenses, tone: "text-green-400" },
            { label: "مجموع الفروقات", value: data.totals.difference, tone: "text-amber-400" },
          ].map((card) => (
            <div key={card.label} className="bg-card rounded-xl border border-border/30 p-4">
              <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
              <p className={`text-base font-bold ${card.tone}`}>{formatCurrency(card.value)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-card rounded-xl border border-border/30 overflow-x-auto">
        {isLoading ? <div className="p-6"><Skeleton className="h-48 rounded-lg" /></div> : rows.length === 0 ? <EmptyState message="لا توجد بيانات ضمن الفترة" /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-muted-foreground border-b border-border/30 text-xs">
              {headers.map((h) => <th key={h} className="px-3 py-2.5 text-center font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.reportDate} className="border-b border-border/15">
                  <td className="px-3 py-2.5 text-center text-muted-foreground">{r.reportDate}</td>
                  <td className="px-3 py-2.5 text-center">{formatCurrency(r.openingBalance)}</td>
                  <td className="px-3 py-2.5 text-center text-green-400">{formatCurrency(r.totalSales)}</td>
                  <td className="px-3 py-2.5 text-center text-red-400">{formatCurrency(r.totalExpenses)}</td>
                  <td className="px-3 py-2.5 text-center font-semibold text-foreground">{formatCurrency(r.closingBalance)}</td>
                  <td className="px-3 py-2.5 text-center">{r.actualCashInDrawer == null ? "—" : formatCurrency(r.actualCashInDrawer)}</td>
                  <td className="px-3 py-2.5 text-center">{r.difference == null ? "—" : formatCurrency(r.difference)}</td>
                  <td className="px-3 py-2.5 text-center text-xs">{STATUS_LABEL[r.status] ?? r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
