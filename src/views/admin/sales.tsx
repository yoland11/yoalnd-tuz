"use client";

import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Search, Printer, FileText, X, CheckCircle, Clock,
  AlertCircle, ShoppingCart, RefreshCw, Save, Receipt, Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import { useToast } from "@/hooks/use-toast";
import { printInvoiceWithTemplate } from "@/lib/invoice-print";

type SalesTab = "invoice" | "list" | "returns";

type Product = { id: number; nameAr: string; name: string; price: number; stock: number; images?: string[] };
type InvoiceItem = {
  id: string;
  productId?: number;
  productName: string;
  productNameAr: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
};
type SalesInvoice = {
  id: number; invoiceNo: string; date: string;
  customerName: string; customerPhone: string | null;
  isInternal: number;
  subtotal: string; discountAmount: string; taxAmount: string; total: string;
  paidAmount: string; remainingAmount: string;
  paymentMethod: string; paymentStatus: string; notes: string | null;
  createdByName: string; createdAt: string;
  items?: InvoiceItem[];
};

const METHODS = [
  { value: "cash", label: "نقدي" },
  { value: "transfer", label: "تحويل" },
  { value: "pos", label: "بطاقة" },
];
const STATUS_OPTIONS = [
  { value: "paid", label: "مدفوع", color: "text-green-400" },
  { value: "partial", label: "جزئي", color: "text-yellow-400" },
  { value: "unpaid", label: "غير مدفوع", color: "text-red-400" },
];

function newItem(): InvoiceItem {
  return { id: crypto.randomUUID(), productId: undefined, productName: "", productNameAr: "", quantity: 1, unitPrice: 0, discount: 0, total: 0 };
}

function recalcItem(item: InvoiceItem): InvoiceItem {
  const total = Math.max(0, (item.unitPrice * item.quantity) - item.discount);
  return { ...item, total };
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

function paymentStatusLabel(s: string) { return STATUS_OPTIONS.find(x => x.value === s)?.label ?? s; }
function paymentStatusColor(s: string) { return STATUS_OPTIONS.find(x => x.value === s)?.color ?? "text-muted-foreground"; }
function methodLabel(m: string) { return METHODS.find(x => x.value === m)?.label ?? m; }

export default function SalesPage() {
  const [tab, setTab] = useState<SalesTab>("invoice");
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">المبيعات</h1>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-border/30">
        {[
          { id: "invoice" as SalesTab, label: "فاتورة مبيعات", icon: Receipt },
          { id: "list" as SalesTab, label: "الفواتير", icon: FileText },
          { id: "returns" as SalesTab, label: "المرتجعات", icon: RefreshCw },
        ].map(t => {
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
      {tab === "invoice" && <InvoiceTab />}
      {tab === "list" && <InvoiceListTab />}
      {tab === "returns" && <ReturnsTab />}
    </div>
  );
}

// ────── New Invoice Tab ──────
function InvoiceTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: products } = useQuery<Product[]>({
    queryKey: ["products-for-sales"],
    queryFn: () => adminFetch<Product[]>("/products?limit=500"),
  });

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [date, setDate] = useState(todayStr());
  const [items, setItems] = useState<InvoiceItem[]>([newItem()]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentStatus, setPaymentStatus] = useState("paid");
  const [paidAmount, setPaidAmount] = useState("0");
  const [notes, setNotes] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [search, setSearch] = useState("");
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filteredProducts = useMemo(() => {
    if (!search.trim() || !products) return [];
    const s = search.toLowerCase();
    return products.filter(p =>
      p.nameAr.toLowerCase().includes(s) || p.name.toLowerCase().includes(s)
    ).slice(0, 10);
  }, [search, products]);

  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const totalDiscount = items.reduce((s, i) => s + i.discount, 0);
  const total = items.reduce((s, i) => s + i.total, 0);
  const paid = parseFloat(paidAmount) || 0;
  const remaining = Math.max(0, total - paid);

  function addProduct(p: Product) {
    const existingIdx = items.findIndex(i => i.productId === p.id);
    if (existingIdx >= 0) {
      const updated = [...items];
      updated[existingIdx] = recalcItem({ ...updated[existingIdx], quantity: updated[existingIdx].quantity + 1 });
      setItems(updated);
      toast({ title: "تم زيادة الكمية", description: `${p.nameAr} — الكمية: ${updated[existingIdx].quantity}` });
    } else {
      const item = recalcItem({ ...newItem(), productId: p.id, productName: p.name, productNameAr: p.nameAr, unitPrice: p.price });
      setItems(prev => [...prev.filter(i => i.productNameAr !== ""), item]);
    }
    setSearch("");
    setShowProductSearch(false);
  }

  function updateItem(id: string, field: keyof InvoiceItem, value: string | number) {
    setItems(prev => prev.map(i => i.id === id ? recalcItem({ ...i, [field]: typeof value === "number" ? value : Number(value) || 0 }) : i));
  }

  function removeItem(id: string) {
    setItems(prev => {
      const next = prev.filter(i => i.id !== id);
      return next.length === 0 ? [newItem()] : next;
    });
  }

  function resetForm() {
    setCustomerName(""); setCustomerPhone(""); setDate(todayStr());
    setItems([newItem()]); setPaidAmount("0"); setNotes(""); setPaymentMethod("cash");
    setPaymentStatus("paid"); setIsInternal(false);
  }

  const createMut = useMutation({
    mutationFn: (data: any) => adminFetch<SalesInvoice>("/admin/sales-invoices", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ["admin", "sales-invoices"] });
      toast({ title: "تم حفظ الفاتورة", description: `الفاتورة رقم ${inv.invoiceNo}` });
      resetForm();
    },
    onError: (e: any) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  function handleSave() {
    const validItems = items.filter(i => i.productNameAr.trim() || i.productName.trim());
    if (validItems.length === 0) { toast({ title: "أضف منتجاً على الأقل", variant: "destructive" }); return; }
    createMut.mutate({
      customerName, customerPhone: customerPhone || null, date,
      items: validItems, paymentMethod, paymentStatus, paidAmount: paid, isInternal: isInternal ? 1 : 0, notes: notes || null,
    });
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {/* Main invoice form */}
      <div className="xl:col-span-2 space-y-4">
        {/* Header */}
        <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="اسم الزبون">
              <input value={customerName} onChange={e => setCustomerName(e.target.value)}
                placeholder="اسم الزبون" className={inp} />
            </Field>
            <Field label="رقم الهاتف">
              <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                placeholder="07X XXXX XXXX" className={inp} dir="ltr" />
            </Field>
            <Field label="التاريخ">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inp} dir="ltr" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} className="accent-primary" />
            فاتورة داخلية (بدون إرسال واتساب أو تتبع)
          </label>
        </div>

        {/* Product search */}
        <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => { setSearch(e.target.value); setShowProductSearch(true); }}
              onFocus={() => setShowProductSearch(true)}
              placeholder="ابحث عن منتج بالاسم..."
              className={`w-full ${inp} pr-10`}
            />
            {showProductSearch && filteredProducts.length > 0 && (
              <div className="absolute top-full right-0 left-0 z-20 mt-1 bg-card border border-border/40 rounded-xl overflow-hidden shadow-xl">
                {filteredProducts.map(p => (
                  <button key={p.id} type="button" onClick={() => addProduct(p)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted text-right text-sm transition-colors border-b border-border/20 last:border-0">
                    {p.images?.[0] && <img src={p.images[0]} className="w-8 h-8 rounded object-cover shrink-0" alt="" />}
                    <span className="flex-1">{p.nameAr}</span>
                    <span className="text-primary shrink-0">{formatCurrency(p.price)}</span>
                    <span className={`text-xs shrink-0 ${p.stock === 0 ? "text-red-400" : "text-muted-foreground"}`}>مخزون: {p.stock}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b border-border/20">
                  <th className="text-right p-2 font-medium">المنتج</th>
                  <th className="text-right p-2 font-medium w-20">الكمية</th>
                  <th className="text-right p-2 font-medium w-28">السعر</th>
                  <th className="text-right p-2 font-medium w-24">الخصم</th>
                  <th className="text-right p-2 font-medium w-28">الإجمالي</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {items.map(item => (
                  <tr key={item.id}>
                    <td className="p-2">
                      <input value={item.productNameAr} onChange={e => setItems(prev => prev.map(i => i.id === item.id ? { ...i, productNameAr: e.target.value } : i))}
                        placeholder="اسم المنتج" className={`${inp} text-sm`} />
                    </td>
                    <td className="p-2">
                      <input type="number" min={1} value={item.quantity}
                        onChange={e => updateItem(item.id, "quantity", parseInt(e.target.value) || 1)}
                        className={`${inp} text-sm w-20`} />
                    </td>
                    <td className="p-2">
                      <input type="number" min={0} value={item.unitPrice}
                        onChange={e => updateItem(item.id, "unitPrice", parseFloat(e.target.value) || 0)}
                        className={`${inp} text-sm w-28`} />
                    </td>
                    <td className="p-2">
                      <input type="number" min={0} value={item.discount}
                        onChange={e => updateItem(item.id, "discount", parseFloat(e.target.value) || 0)}
                        className={`${inp} text-sm w-24`} />
                    </td>
                    <td className="p-2 font-semibold text-primary">{formatCurrency(item.total)}</td>
                    <td className="p-2">
                      <button onClick={() => removeItem(item.id)} className="text-red-400 hover:bg-red-500/10 p-1 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="outline" size="sm" onClick={() => setItems(prev => [...prev, newItem()])} className="gap-2">
            <Plus className="w-4 h-4" /> إضافة سطر
          </Button>
        </div>

        {/* Notes */}
        <div className="bg-card rounded-xl border border-border/30 p-4">
          <label className="block text-xs text-muted-foreground mb-1">ملاحظات</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className={`w-full ${inp}`} placeholder="ملاحظات اختيارية..." />
        </div>
      </div>

      {/* Summary sidebar */}
      <div className="space-y-4">
        <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3 sticky top-6">
          <h3 className="font-bold text-foreground text-base">ملخص الفاتورة</h3>

          <div className="space-y-2 text-sm border-b border-border/20 pb-3">
            <Row label="المجموع الفرعي" value={formatCurrency(subtotal)} />
            <Row label="إجمالي الخصومات" value={`- ${formatCurrency(totalDiscount)}`} className="text-yellow-400" />
            <Row label="الإجمالي" value={formatCurrency(total)} bold />
          </div>

          <div className="space-y-3">
            <Field label="طريقة الدفع">
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className={inp}>
                {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="حالة الدفع">
              <select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)} className={inp}>
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="المبلغ المدفوع">
              <input type="number" min={0} value={paidAmount} onChange={e => setPaidAmount(e.target.value)} className={inp} />
            </Field>
          </div>

          <div className="space-y-1 text-sm border-t border-border/20 pt-3">
            <Row label="المدفوع" value={formatCurrency(paid)} className="text-green-400" />
            <Row label="المتبقي" value={formatCurrency(remaining)} className={remaining > 0 ? "text-red-400" : "text-green-400"} bold />
          </div>

          <div className="space-y-2 pt-1">
            <Button onClick={handleSave} disabled={createMut.isPending} className="w-full gap-2">
              <Save className="w-4 h-4" />
              {createMut.isPending ? "جاري الحفظ..." : "حفظ الفاتورة"}
            </Button>
            <Button variant="outline" onClick={resetForm} className="w-full gap-2">
              <RefreshCw className="w-4 h-4" /> فاتورة جديدة
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────── Invoice List Tab ──────
function InvoiceListTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SalesInvoice | null>(null);

  const { data, isLoading } = useQuery<SalesInvoice[]>({
    queryKey: ["admin", "sales-invoices", from, to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return adminFetch<SalesInvoice[]>(`/admin/sales-invoices?${params}`);
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data;
    const s = search.toLowerCase();
    return data.filter(inv =>
      inv.invoiceNo.toLowerCase().includes(s) ||
      inv.customerName.toLowerCase().includes(s) ||
      (inv.customerPhone ?? "").includes(s)
    );
  }, [data, search]);

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/sales-invoices/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "sales-invoices"] }); setSelected(null); toast({ title: "تم الحذف" }); },
  });

  const totalRevenue = filtered.reduce((s, inv) => s + parseFloat(inv.total), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث برقم الفاتورة أو اسم الزبون..."
            className={`w-full ${inp} pr-10`} />
        </div>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${inp} w-40`} dir="ltr" placeholder="من" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${inp} w-40`} dir="ltr" placeholder="إلى" />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="إجمالي الفواتير" value={String(filtered.length)} />
        <StatCard label="إجمالي المبيعات" value={formatCurrency(totalRevenue)} gold />
        <StatCard label="المدفوع" value={formatCurrency(filtered.filter(i => i.paymentStatus === "paid").reduce((s, i) => s + parseFloat(i.total), 0))} green />
        <StatCard label="غير المسدّد" value={formatCurrency(filtered.filter(i => i.paymentStatus !== "paid").reduce((s, i) => s + parseFloat(i.remainingAmount), 0))} red />
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : filtered.length === 0 ? <EmptyState message="لا توجد فواتير" /> : (
        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-right p-3">رقم الفاتورة</th>
                  <th className="text-right p-3">التاريخ</th>
                  <th className="text-right p-3">الزبون</th>
                  <th className="text-right p-3">الإجمالي</th>
                  <th className="text-right p-3">الدفع</th>
                  <th className="text-right p-3">الحالة</th>
                  <th className="text-right p-3">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {filtered.map(inv => (
                  <tr key={inv.id} className="hover:bg-background/30 cursor-pointer" onClick={() => setSelected(inv)}>
                    <td className="p-3 font-mono text-primary">{inv.invoiceNo}</td>
                    <td className="p-3 text-muted-foreground">{inv.date}</td>
                    <td className="p-3">{inv.customerName || "—"}</td>
                    <td className="p-3 font-semibold">{formatCurrency(inv.total)}</td>
                    <td className="p-3 text-muted-foreground">{methodLabel(inv.paymentMethod)}</td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${paymentStatusColor(inv.paymentStatus)} bg-current/10`}>
                        {paymentStatusLabel(inv.paymentStatus)}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                        <button onClick={() => confirm("حذف الفاتورة؟") && deleteMut.mutate(inv.id)}
                          className="text-red-400 hover:bg-red-500/10 p-1.5 rounded">
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

      {selected && <InvoiceDetailModal invoice={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ────── Returns Tab ──────
function ReturnsTab() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">قسم المرتجعات — لإضافة مرتجع اختر الفاتورة من قائمة الفواتير.</p>
      <EmptyState message="لا توجد مرتجعات" />
    </div>
  );
}

// ────── Invoice Detail Modal ──────
function InvoiceDetailModal({ invoice, onClose }: { invoice: SalesInvoice; onClose: () => void }) {
  const { data: detail } = useQuery<SalesInvoice>({
    queryKey: ["admin", "sales-invoices", invoice.id],
    queryFn: () => adminFetch<SalesInvoice>(`/admin/sales-invoices/${invoice.id}`),
  });
  const inv = detail ?? invoice;

  async function handlePrint() {
    await printInvoiceWithTemplate("sales", inv, adminFetch);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-card border border-border/40 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg text-foreground">فاتورة {inv.invoiceNo}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <InfoRow label="التاريخ" value={inv.date} />
          <InfoRow label="الزبون" value={inv.customerName || "—"} />
          <InfoRow label="الهاتف" value={inv.customerPhone || "—"} />
          <InfoRow label="طريقة الدفع" value={methodLabel(inv.paymentMethod)} />
          <InfoRow label="حالة الدفع" value={paymentStatusLabel(inv.paymentStatus)} />
          {inv.isInternal === 1 && <InfoRow label="النوع" value="فاتورة داخلية" />}
        </div>
        {inv.items && inv.items.length > 0 && (
          <table className="w-full text-sm border-t border-border/20 pt-3">
            <thead><tr className="text-muted-foreground border-b border-border/20">
              <th className="text-right p-2">المنتج</th>
              <th className="text-right p-2">الكمية</th>
              <th className="text-right p-2">السعر</th>
              <th className="text-right p-2">الإجمالي</th>
            </tr></thead>
            <tbody className="divide-y divide-border/20">
              {inv.items.map(it => (
                <tr key={it.id}>
                  <td className="p-2">{it.productNameAr}</td>
                  <td className="p-2">{it.quantity}</td>
                  <td className="p-2">{formatCurrency(it.unitPrice)}</td>
                  <td className="p-2 font-semibold text-primary">{formatCurrency(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="border-t border-border/20 pt-3 space-y-1 text-sm">
          <Row label="المجموع" value={formatCurrency(inv.subtotal)} />
          <Row label="الخصم" value={`- ${formatCurrency(inv.discountAmount)}`} />
          <Row label="الإجمالي" value={formatCurrency(inv.total)} bold />
          <Row label="المدفوع" value={formatCurrency(inv.paidAmount)} className="text-green-400" />
          <Row label="المتبقي" value={formatCurrency(inv.remainingAmount)} className={parseFloat(inv.remainingAmount) > 0 ? "text-red-400" : "text-green-400"} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint} className="gap-2"><Printer className="w-4 h-4" /> طباعة</Button>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
        </div>
      </div>
    </div>
  );
}

// ────── Helpers ──────
const inp = "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs text-muted-foreground mb-1">{label}</label>{children}</div>;
}

function Row({ label, value, bold, className }: { label: string; value: string; bold?: boolean; className?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${bold ? "font-bold text-base" : ""} ${className ?? ""}`}>{value}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div><span className="text-muted-foreground text-xs">{label}: </span><span className="text-foreground">{value}</span></div>
  );
}

function StatCard({ label, value, gold, green, red }: { label: string; value: string; gold?: boolean; green?: boolean; red?: boolean }) {
  const color = gold ? "text-primary" : green ? "text-green-400" : red ? "text-red-400" : "text-foreground";
  return (
    <div className="bg-card rounded-xl border border-border/30 p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`font-bold text-lg ${color}`}>{value}</p>
    </div>
  );
}
