import { useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Pencil, Plus, Printer, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { fileToDataUrl, adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import { downloadElementPdf } from "@/lib/pdf";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";

type Expense = { id: number; date: string; name: string; amount: string; categoryId: number | null; categoryName: string; paymentMethod: string; receiptImage: string | null; notes: string | null; createdByName: string; createdAt: string };
type Category = { id: number; name: string; nameAr: string; isActive: number };
type ExpenseForm = { id?: number; date: string; name: string; categoryId: string; amount: string; paymentMethod: string; notes: string; receiptImage: string };

const inputCls = "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50";
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const blankForm = (): ExpenseForm => ({ date: today(), name: "", categoryId: "", amount: "", paymentMethod: "cash", notes: "", receiptImage: "" });
const paymentMethods = [
  { value: "cash", label: "نقد" },
  { value: "pos", label: "بطاقة / POS" },
  { value: "transfer", label: "تحويل" },
];

export default function ExpensesPage({ startNew = false }: { startNew?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const reportRef = useRef<HTMLDivElement | null>(null);
  const { data: settings } = usePublicSettings();
  const [filters, setFilters] = useState({ from: monthStart(), to: today(), categoryId: "", paymentMethod: "", search: "", user: "" });
  const [form, setForm] = useState<ExpenseForm | null>(() => startNew ? blankForm() : null);
  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("from", filters.from);
    params.set("to", filters.to);
    if (filters.categoryId) params.set("categoryId", filters.categoryId);
    if (filters.paymentMethod) params.set("paymentMethod", filters.paymentMethod);
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.user.trim()) params.set("user", filters.user.trim());
    return params.toString();
  }, [filters]);

  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["admin", "expense-categories"], queryFn: () => adminFetch("/admin/expense-categories") });
  const { data: expenses = [], isLoading } = useQuery<Expense[]>({ queryKey: ["admin", "expenses", filters], queryFn: () => adminFetch(`/admin/expenses?${query}`) });
  const total = expenses.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const expense of expenses) map.set(expense.categoryName || "غير مصنف", (map.get(expense.categoryName || "غير مصنف") ?? 0) + Number(expense.amount ?? 0));
    return [...map.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  const save = useMutation({
    mutationFn: async (payload: ExpenseForm) => {
      const body = { ...payload, categoryId: Number(payload.categoryId), amount: Number(payload.amount) };
      const path = payload.id ? `/admin/expenses/${payload.id}` : "/admin/expenses";
      return adminFetch(path, { method: payload.id ? "PATCH" : "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "expenses"] });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      setForm(null);
      toast({ title: "تم حفظ المصروف" });
    },
    onError: (error: any) => toast({ title: "تعذر الحفظ", description: error?.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/expenses/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "expenses"] });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      toast({ title: "تم حذف المصروف" });
    },
  });

  async function exportPdf() {
    void recordReportAudit("report_pdf_exported", "تقرير المصاريف", "pdf");
    await downloadElementPdf(reportRef.current, `expenses-${filters.from}-${filters.to}.pdf`);
  }
  function printReport(thermal = false) {
    void recordReportAudit("report_printed", "تقرير المصاريف", thermal ? "thermal" : "a4");
    const win = window.open("", "_blank", "width=920,height=760");
    if (!win) return;
    win.document.write(buildExpensesPrintHtml(expenses, filters, total, logoSrc(settings), thermal));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  }
  function exportExcel() {
    downloadCsv(`expenses-${filters.from}-${filters.to}.csv`, ["التاريخ", "العنوان", "التصنيف", "طريقة الدفع", "المبلغ", "بواسطة", "ملاحظات"], expenses.map((e) => [e.date, e.name, e.categoryName, paymentLabel(e.paymentMethod), e.amount, e.createdByName, e.notes ?? ""]));
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">إدارة المصاريف</h1>
          <p className="text-sm text-muted-foreground">إضافة وتعديل المصاريف وربطها بالتقارير المالية</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setForm(blankForm())} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> إضافة مصروف</Button>
          <Button variant="outline" size="sm" onClick={() => printReport(false)} className="gap-1.5"><Printer className="w-4 h-4" /> طباعة A4</Button>
          <Button variant="outline" size="sm" onClick={() => printReport(true)} className="gap-1.5"><Printer className="w-4 h-4" /> حراري</Button>
          <Button variant="outline" size="sm" onClick={exportPdf} className="gap-1.5"><FileText className="w-4 h-4" /> PDF</Button>
          <Button variant="outline" size="sm" onClick={exportExcel} className="gap-1.5"><FileSpreadsheet className="w-4 h-4" /> Excel</Button>
        </div>
      </div>

      {form && <ExpenseFormPanel form={form} categories={categories} saving={save.isPending} onChange={setForm} onClose={() => setForm(null)} onSave={() => save.mutate(form)} />}

      <div className="bg-card rounded-xl border border-border/30 p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
        <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className={inputCls} />
        <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className={inputCls} />
        <select value={filters.categoryId} onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value }))} className={inputCls}><option value="">كل التصنيفات</option>{categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.nameAr}</option>)}</select>
        <select value={filters.paymentMethod} onChange={(e) => setFilters((f) => ({ ...f, paymentMethod: e.target.value }))} className={inputCls}><option value="">كل طرق الدفع</option>{paymentMethods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
        <input value={filters.user} onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))} className={inputCls} placeholder="الموظف" />
        <div className="relative"><Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} className={`${inputCls} pr-9`} placeholder="بحث" /></div>
      </div>

      <div ref={reportRef} className="space-y-4">
        <div className="bg-card rounded-xl border border-border/30 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src={logoSrc(settings)} alt="AJN" className="h-12 w-20 object-contain rounded-lg bg-background/60 border border-border/30" />
            <div><p className="text-xs text-muted-foreground">مجموعة علي جان</p><h2 className="font-bold text-foreground">تقرير المصاريف</h2></div>
          </div>
          <div className="text-xs text-muted-foreground text-left"><p>{filters.from} إلى {filters.to}</p><p>{new Date().toLocaleString("ar-IQ")}</p></div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-card rounded-xl border border-border/30 p-4"><p className="text-xs text-muted-foreground">إجمالي المصاريف</p><p className="text-lg font-bold text-foreground">{formatCurrency(total)}</p></div>
          <div className="bg-card rounded-xl border border-border/30 p-4"><p className="text-xs text-muted-foreground">عدد المصاريف</p><p className="text-lg font-bold text-foreground">{expenses.length.toLocaleString("ar-IQ")}</p></div>
          {byCategory.slice(0, 2).map((item) => <div key={item.name} className="bg-card rounded-xl border border-border/30 p-4"><p className="text-xs text-muted-foreground">{item.name}</p><p className="text-lg font-bold text-foreground">{formatCurrency(item.amount)}</p></div>)}
        </div>

        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          {isLoading ? <div className="p-5"><Skeleton className="h-48 rounded-xl" /></div> : expenses.length === 0 ? <EmptyState message="لا توجد مصاريف ضمن الفلاتر" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-muted-foreground bg-background/50">{["التاريخ", "العنوان", "التصنيف", "الدفع", "المبلغ", "الإيصال", "بواسطة", "إجراءات"].map((h) => <th key={h} className="px-3 py-2.5 text-right">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border/15">
                  {expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td className="px-3 py-2.5 text-muted-foreground">{expense.date}</td>
                      <td className="px-3 py-2.5 text-foreground">{expense.name || "—"}</td>
                      <td className="px-3 py-2.5">{expense.categoryName || "—"}</td>
                      <td className="px-3 py-2.5">{paymentLabel(expense.paymentMethod)}</td>
                      <td className="px-3 py-2.5 font-semibold text-foreground">{formatCurrency(expense.amount)}</td>
                      <td className="px-3 py-2.5">{expense.receiptImage ? <a href={expense.receiptImage} target="_blank" rel="noreferrer" className="text-primary underline text-xs">عرض</a> : "—"}</td>
                      <td className="px-3 py-2.5 text-muted-foreground text-xs">{expense.createdByName || "—"}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1">
                          <button onClick={() => setForm({ id: expense.id, date: expense.date, name: expense.name ?? "", categoryId: expense.categoryId ? String(expense.categoryId) : "", amount: String(expense.amount ?? ""), paymentMethod: expense.paymentMethod ?? "cash", notes: expense.notes ?? "", receiptImage: expense.receiptImage ?? "" })} className="p-1.5 rounded text-primary hover:bg-primary/10"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => confirm("حذف المصروف؟") && remove.mutate(expense.id)} className="p-1.5 rounded text-status-danger hover:bg-status-danger/10"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExpenseFormPanel({ form, categories, saving, onChange, onSave, onClose }: { form: ExpenseForm; categories: Category[]; saving: boolean; onChange: (form: ExpenseForm) => void; onSave: () => void; onClose: () => void }) {
  async function onReceipt(file: File) {
    onChange({ ...form, receiptImage: await fileToDataUrl(file) });
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="bg-card rounded-xl border border-border/30 p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div className="flex items-center justify-between sm:col-span-2 lg:col-span-3"><h2 className="font-semibold text-foreground">{form.id ? "تعديل مصروف" : "مصروف جديد"}</h2><button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button></div>
      <Field label="التاريخ"><input type="date" value={form.date} onChange={(e) => onChange({ ...form, date: e.target.value })} className={inputCls} /></Field>
      <Field label="عنوان المصروف"><input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} className={inputCls} /></Field>
      <Field label="المبلغ"><input type="number" min="0" value={form.amount} onChange={(e) => onChange({ ...form, amount: e.target.value })} className={inputCls} /></Field>
      <Field label="التصنيف"><select value={form.categoryId} onChange={(e) => onChange({ ...form, categoryId: e.target.value })} className={inputCls}><option value="">اختر التصنيف</option>{categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.nameAr}</option>)}</select></Field>
      <Field label="طريقة الدفع"><select value={form.paymentMethod} onChange={(e) => onChange({ ...form, paymentMethod: e.target.value })} className={inputCls}>{paymentMethods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
      <Field label="صورة الإيصال"><input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && void onReceipt(e.target.files[0])} className="text-xs text-muted-foreground file:ml-2 file:rounded file:border-0 file:bg-primary/10 file:text-primary file:px-2 file:py-1" /></Field>
      <div className="lg:col-span-2"><Field label="ملاحظات"><input value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} className={inputCls} /></Field></div>
      <div className="flex items-end"><Button type="submit" disabled={saving} className="w-full gap-1.5"><Plus className="w-4 h-4" /> {saving ? "جاري الحفظ..." : "حفظ المصروف"}</Button></div>
    </form>
  );
}

export function ExpenseCategoriesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState({ id: 0, nameAr: "", name: "", isActive: true });
  const { data: categories = [], isLoading } = useQuery<Category[]>({ queryKey: ["admin", "expense-categories", "all"], queryFn: () => adminFetch("/admin/expense-categories?all=1") });
  const save = useMutation({
    mutationFn: () => adminFetch(draft.id ? `/admin/expense-categories/${draft.id}` : "/admin/expense-categories", { method: draft.id ? "PATCH" : "POST", body: JSON.stringify(draft) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "expense-categories"] }); setDraft({ id: 0, nameAr: "", name: "", isActive: true }); toast({ title: "تم حفظ التصنيف" }); },
  });
  const remove = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/expense-categories/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "expense-categories"] }); toast({ title: "تم حذف التصنيف" }); },
    onError: (error: any) => toast({ title: "تعذر الحذف", description: error?.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-5" dir="rtl">
      <h1 className="text-2xl font-bold text-foreground">تصنيفات المصاريف</h1>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="bg-card rounded-xl border border-border/30 p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input value={draft.nameAr} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} className={inputCls} placeholder="اسم التصنيف" />
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} placeholder="key اختياري" />
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} className="accent-primary" /> فعال</label>
        <Button type="submit" disabled={save.isPending}>{draft.id ? "حفظ التعديل" : "إضافة تصنيف"}</Button>
      </form>
      <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
        {isLoading ? <div className="p-4"><Skeleton className="h-36 rounded-xl" /></div> : categories.length === 0 ? <EmptyState message="لا توجد تصنيفات" /> : (
          <table className="w-full text-sm"><tbody className="divide-y divide-border/15">{categories.map((cat) => (
            <tr key={cat.id}><td className="px-4 py-3 font-medium text-foreground">{cat.nameAr}</td><td className="px-4 py-3 text-muted-foreground">{cat.name}</td><td className="px-4 py-3">{cat.isActive ? "فعال" : "معطل"}</td><td className="px-4 py-3"><div className="flex gap-1"><button onClick={() => setDraft({ id: cat.id, nameAr: cat.nameAr, name: cat.name, isActive: !!cat.isActive })} className="p-1.5 rounded text-primary hover:bg-primary/10"><Pencil className="w-4 h-4" /></button><button onClick={() => confirm("حذف التصنيف؟") && remove.mutate(cat.id)} className="p-1.5 rounded text-status-danger hover:bg-status-danger/10"><Trash2 className="w-4 h-4" /></button></div></td></tr>
          ))}</tbody></table>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><label className="block text-xs text-muted-foreground mb-1">{label}</label>{children}</div>;
}
function paymentLabel(value: string) {
  return paymentMethods.find((item) => item.value === value)?.label ?? value;
}
function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
function buildExpensesPrintHtml(expenses: Expense[], filters: { from: string; to: string }, total: number, logo: string, thermal: boolean) {
  const rows = expenses.map((e) => `<tr><td>${escapeHtml(e.date)}</td><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.categoryName)}</td><td>${escapeHtml(formatCurrency(e.amount))}</td>${thermal ? "" : `<td>${escapeHtml(paymentLabel(e.paymentMethod))}</td><td>${escapeHtml(e.createdByName)}</td>`}</tr>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>@page{size:${thermal ? "80mm auto" : "A4"};margin:${thermal ? "4mm" : "12mm"}}*{color:#000!important;box-shadow:none!important}body{font-family:Arial,sans-serif;width:${thermal ? "72mm" : "auto"};background:#fff}.head{display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:12px}img{width:64px;height:50px;object-fit:contain}h1{font-size:${thermal ? "15px" : "20px"};margin:0}.meta{font-size:11px}.total{border:1px solid #000;padding:8px;margin-bottom:10px;font-weight:800}table{width:100%;border-collapse:collapse;font-size:${thermal ? "10px" : "12px"}}td,th{border:1px solid #000;padding:5px;font-weight:700}</style></head><body><div class="head"><div><img src="${escapeHtml(logo)}"><h1>تقرير المصاريف</h1></div><div class="meta">${filters.from} إلى ${filters.to}<br>${new Date().toLocaleString("ar-IQ")}</div></div><div class="total">الإجمالي: ${escapeHtml(formatCurrency(total))}</div><table><thead><tr><th>التاريخ</th><th>العنوان</th><th>التصنيف</th><th>المبلغ</th>${thermal ? "" : "<th>الدفع</th><th>بواسطة</th>"}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}
function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string));
}
function recordReportAudit(action: "report_printed" | "report_pdf_exported", title: string, format: string) {
  return adminFetch("/admin/reports/audit", { method: "POST", body: JSON.stringify({ action, title, format }) }).catch(() => null);
}
