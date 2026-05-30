"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Search, Printer, FileText, X, Save, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import { useToast } from "@/hooks/use-toast";
import { printInvoiceWithTemplate } from "@/lib/invoice-print";

type Product = { id: number; nameAr: string; name: string; price: number; stock: number };
type PurchaseItem = {
  id: string;
  productId?: number;
  productName: string;
  productNameAr: string;
  quantity: number;
  costPrice: number;
  sellPrice: number;
  discount: number;
  total: number;
};
type Purchase = {
  id: number; invoiceNo: string | null; date: string;
  supplierName: string; supplierPhone: string | null;
  subtotal: string; discountAmount: string; extraCosts: string; total: string;
  paidAmount: string; remainingAmount: string;
  paymentMethod: string; paymentStatus: string; notes: string | null;
  createdByName: string; createdAt: string;
  items?: PurchaseItem[];
};

const METHODS = [{ value: "cash", label: "نقدي" }, { value: "transfer", label: "تحويل" }, { value: "pos", label: "بطاقة" }];
const STATUS = [{ value: "paid", label: "مدفوع" }, { value: "partial", label: "جزئي" }, { value: "unpaid", label: "غير مدفوع" }];
const inp = "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50";

function newItem(): PurchaseItem {
  return { id: crypto.randomUUID(), productId: undefined, productName: "", productNameAr: "", quantity: 1, costPrice: 0, sellPrice: 0, discount: 0, total: 0 };
}
function recalcItem(item: PurchaseItem): PurchaseItem {
  return { ...item, total: Math.max(0, (item.costPrice * item.quantity) - item.discount) };
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

export default function PurchasesPage() {
  const [tab, setTab] = useState<"new" | "list">("new");
  return (
    <div className="space-y-4" dir="rtl">
      <h1 className="text-2xl font-bold text-foreground">المشتريات</h1>
      <div className="flex flex-wrap gap-2 border-b border-border/30">
        {[{ id: "new" as const, label: "فاتورة شراء جديدة" }, { id: "list" as const, label: "قائمة المشتريات" }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3 py-2 text-sm border-b-2 -mb-px transition-colors
              ${tab === t.id ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "new" && <NewPurchaseTab />}
      {tab === "list" && <PurchaseListTab />}
    </div>
  );
}

// ────── New Purchase Tab ──────
function NewPurchaseTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: products } = useQuery<Product[]>({ queryKey: ["products-list"], queryFn: () => adminFetch<Product[]>("/products?limit=500") });

  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(todayStr());
  const [items, setItems] = useState<PurchaseItem[]>([newItem()]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentStatus, setPaymentStatus] = useState("paid");
  const [paidAmount, setPaidAmount] = useState("0");
  const [extraCosts, setExtraCosts] = useState("0");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const filteredProducts = useMemo(() => {
    if (!search.trim() || !products) return [];
    const s = search.toLowerCase();
    return products.filter(p => p.nameAr.toLowerCase().includes(s) || p.name.toLowerCase().includes(s)).slice(0, 8);
  }, [search, products]);

  const subtotal = items.reduce((s, i) => s + i.costPrice * i.quantity, 0);
  const totalDiscount = items.reduce((s, i) => s + i.discount, 0);
  const extra = parseFloat(extraCosts) || 0;
  const total = Math.max(0, subtotal - totalDiscount + extra);
  const paid = parseFloat(paidAmount) || 0;
  const remaining = Math.max(0, total - paid);

  function addProduct(p: Product) {
    const existingIdx = items.findIndex(i => i.productId === p.id);
    if (existingIdx >= 0) {
      const updated = [...items];
      updated[existingIdx] = recalcItem({ ...updated[existingIdx], quantity: updated[existingIdx].quantity + 1 });
      setItems(updated);
    } else {
      setItems(prev => [...prev.filter(i => i.productNameAr !== ""), recalcItem({ ...newItem(), productId: p.id, productName: p.name, productNameAr: p.nameAr, costPrice: p.price })]);
    }
    setSearch(""); setShowSearch(false);
  }

  function resetForm() {
    setSupplierName(""); setSupplierPhone(""); setInvoiceNo(""); setDate(todayStr());
    setItems([newItem()]); setPaidAmount("0"); setExtraCosts("0"); setNotes("");
    setPaymentMethod("cash"); setPaymentStatus("paid");
  }

  const createMut = useMutation({
    mutationFn: (data: any) => adminFetch<Purchase>("/admin/purchases", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["admin", "purchases"] });
      qc.invalidateQueries({ queryKey: ["products-list"] });
      toast({ title: "تم حفظ المشتريات", description: `تم تحديث المخزون لـ ${p.supplierName || "المورد"}` });
      resetForm();
    },
    onError: (e: any) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  function handleSave() {
    const validItems = items.filter(i => i.productNameAr.trim() || i.productName.trim());
    if (validItems.length === 0) { toast({ title: "أضف منتجاً على الأقل", variant: "destructive" }); return; }
    createMut.mutate({ supplierName, supplierPhone: supplierPhone || null, invoiceNo: invoiceNo || null, date, items: validItems, paymentMethod, paymentStatus, paidAmount: paid, extraCosts: extra, notes: notes || null });
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 space-y-4">
        {/* Header */}
        <div className="bg-card rounded-xl border border-border/30 p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><label className="block text-xs text-muted-foreground mb-1">اسم المورد</label>
              <input value={supplierName} onChange={e => setSupplierName(e.target.value)} className={inp} placeholder="اسم المورد" /></div>
            <div><label className="block text-xs text-muted-foreground mb-1">هاتف المورد</label>
              <input value={supplierPhone} onChange={e => setSupplierPhone(e.target.value)} className={inp} placeholder="رقم الهاتف" dir="ltr" /></div>
            <div><label className="block text-xs text-muted-foreground mb-1">رقم الفاتورة (المورد)</label>
              <input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} className={inp} placeholder="اختياري" dir="ltr" /></div>
            <div><label className="block text-xs text-muted-foreground mb-1">التاريخ</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inp} dir="ltr" /></div>
          </div>
        </div>

        {/* Products */}
        <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={search} onChange={e => { setSearch(e.target.value); setShowSearch(true); }}
              onFocus={() => setShowSearch(true)} placeholder="ابحث عن منتج للإضافة..." className={`${inp} pr-10`} />
            {showSearch && filteredProducts.length > 0 && (
              <div className="absolute top-full right-0 left-0 z-20 mt-1 bg-card border border-border/40 rounded-xl overflow-hidden shadow-xl">
                {filteredProducts.map(p => (
                  <button key={p.id} type="button" onClick={() => addProduct(p)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted text-right text-sm border-b border-border/20 last:border-0">
                    <span>{p.nameAr}</span>
                    <span className="text-muted-foreground text-xs">مخزون: {p.stock}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b border-border/20">
                  <th className="text-right p-2">المنتج</th>
                  <th className="text-right p-2 w-16">الكمية</th>
                  <th className="text-right p-2 w-28">سعر الشراء</th>
                  <th className="text-right p-2 w-28">سعر البيع</th>
                  <th className="text-right p-2 w-20">الخصم</th>
                  <th className="text-right p-2 w-28">الإجمالي</th>
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
                    <td className="p-2"><input type="number" min={1} value={item.quantity}
                      onChange={e => setItems(prev => prev.map(i => i.id === item.id ? recalcItem({ ...i, quantity: parseInt(e.target.value) || 1 }) : i))}
                      className={`${inp} text-sm w-16`} /></td>
                    <td className="p-2"><input type="number" min={0} value={item.costPrice}
                      onChange={e => setItems(prev => prev.map(i => i.id === item.id ? recalcItem({ ...i, costPrice: parseFloat(e.target.value) || 0 }) : i))}
                      className={`${inp} text-sm w-28`} /></td>
                    <td className="p-2"><input type="number" min={0} value={item.sellPrice}
                      onChange={e => setItems(prev => prev.map(i => i.id === item.id ? { ...i, sellPrice: parseFloat(e.target.value) || 0 } : i))}
                      className={`${inp} text-sm w-28`} /></td>
                    <td className="p-2"><input type="number" min={0} value={item.discount}
                      onChange={e => setItems(prev => prev.map(i => i.id === item.id ? recalcItem({ ...i, discount: parseFloat(e.target.value) || 0 }) : i))}
                      className={`${inp} text-sm w-20`} /></td>
                    <td className="p-2 font-semibold text-primary">{formatCurrency(item.total)}</td>
                    <td className="p-2"><button onClick={() => setItems(prev => { const n = prev.filter(i => i.id !== item.id); return n.length ? n : [newItem()]; })}
                      className="text-red-400 hover:bg-red-500/10 p-1 rounded"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="outline" size="sm" onClick={() => setItems(prev => [...prev, newItem()])} className="gap-2">
            <Plus className="w-4 h-4" /> إضافة سطر
          </Button>
        </div>

        <div className="bg-card rounded-xl border border-border/30 p-4">
          <label className="block text-xs text-muted-foreground mb-1">ملاحظات</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`w-full ${inp}`} />
        </div>
      </div>

      {/* Summary */}
      <div className="space-y-4">
        <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3 sticky top-6">
          <h3 className="font-bold text-foreground">ملخص المشتريات</h3>
          <div className="space-y-2 text-sm border-b border-border/20 pb-3">
            <Row label="المجموع الفرعي" value={formatCurrency(subtotal)} />
            <Row label="إجمالي الخصومات" value={`- ${formatCurrency(totalDiscount)}`} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">تكاليف إضافية</label>
            <input type="number" min={0} value={extraCosts} onChange={e => setExtraCosts(e.target.value)} className={inp} />
          </div>
          <Row label="الإجمالي" value={formatCurrency(total)} bold />
          <div>
            <label className="block text-xs text-muted-foreground mb-1">طريقة الدفع</label>
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className={inp}>
              {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">حالة الدفع</label>
            <select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)} className={inp}>
              {STATUS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">المبلغ المدفوع</label>
            <input type="number" min={0} value={paidAmount} onChange={e => setPaidAmount(e.target.value)} className={inp} />
          </div>
          <div className="space-y-1 text-sm border-t border-border/20 pt-3">
            <Row label="المدفوع" value={formatCurrency(paid)} className="text-green-400" />
            <Row label="المتبقي" value={formatCurrency(remaining)} className={remaining > 0 ? "text-red-400" : "text-green-400"} />
          </div>
          <div className="space-y-2">
            <Button onClick={handleSave} disabled={createMut.isPending} className="w-full gap-2">
              <Save className="w-4 h-4" />
              {createMut.isPending ? "جاري الحفظ..." : "حفظ وتحديث المخزون"}
            </Button>
            <Button variant="outline" onClick={resetForm} className="w-full gap-2"><RefreshCw className="w-4 h-4" /> جديد</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────── Purchase List Tab ──────
function PurchaseListTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Purchase | null>(null);

  const { data, isLoading } = useQuery<Purchase[]>({
    queryKey: ["admin", "purchases", from, to],
    queryFn: () => {
      const p = new URLSearchParams();
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      return adminFetch<Purchase[]>(`/admin/purchases?${p}`);
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data;
    const s = search.toLowerCase();
    return data.filter(p => p.supplierName.toLowerCase().includes(s) || (p.invoiceNo ?? "").toLowerCase().includes(s));
  }, [data, search]);

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/purchases/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "purchases"] }); toast({ title: "تم الحذف" }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث باسم المورد..." className={`${inp} pr-10`} />
        </div>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${inp} w-40`} dir="ltr" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${inp} w-40`} dir="ltr" />
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : filtered.length === 0 ? <EmptyState message="لا توجد مشتريات" /> : (
        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-right p-3">التاريخ</th>
                  <th className="text-right p-3">المورد</th>
                  <th className="text-right p-3">رقم الفاتورة</th>
                  <th className="text-right p-3">الإجمالي</th>
                  <th className="text-right p-3">الحالة</th>
                  <th className="text-right p-3">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {filtered.map(p => (
                  <tr key={p.id} className="hover:bg-background/30">
                    <td className="p-3 text-muted-foreground">{p.date}</td>
                    <td className="p-3">{p.supplierName || "—"}</td>
                    <td className="p-3 font-mono text-xs">{p.invoiceNo || "—"}</td>
                    <td className="p-3 font-semibold text-primary">{formatCurrency(p.total)}</td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${p.paymentStatus === "paid" ? "bg-green-500/10 text-green-400" : p.paymentStatus === "partial" ? "bg-yellow-500/10 text-yellow-400" : "bg-red-500/10 text-red-400"}`}>
                        {p.paymentStatus === "paid" ? "مدفوع" : p.paymentStatus === "partial" ? "جزئي" : "غير مدفوع"}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setSelected(p)}
                          className="text-muted-foreground hover:text-primary hover:bg-primary/10 p-1.5 rounded" title="عرض وطباعة">
                          <Printer className="w-4 h-4" />
                        </button>
                        <button onClick={() => confirm("حذف؟") && deleteMut.mutate(p.id)} className="text-red-400 hover:bg-red-500/10 p-1.5 rounded">
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

      {selected && <PurchaseDetailModal purchase={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ────── Purchase Detail Modal ──────
function PurchaseDetailModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const { data: detail } = useQuery<Purchase>({
    queryKey: ["admin", "purchases", purchase.id],
    queryFn: () => adminFetch<Purchase>(`/admin/purchases/${purchase.id}`),
  });
  const p = detail ?? purchase;

  async function handlePrint() {
    await printInvoiceWithTemplate("purchase", p, adminFetch);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-card border border-border/40 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg text-foreground">
            فاتورة شراء {p.invoiceNo ? `— ${p.invoiceNo}` : ""}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <InfoRow label="التاريخ"       value={p.date} />
          <InfoRow label="المورد"        value={p.supplierName || "—"} />
          <InfoRow label="هاتف المورد"   value={p.supplierPhone || "—"} />
          <InfoRow label="طريقة الدفع"   value={METHODS.find(m => m.value === p.paymentMethod)?.label ?? p.paymentMethod} />
          <InfoRow label="حالة الدفع"    value={STATUS.find(s => s.value === p.paymentStatus)?.label ?? p.paymentStatus} />
        </div>

        {p.items && p.items.length > 0 && (
          <table className="w-full text-sm border-t border-border/20">
            <thead>
              <tr className="text-muted-foreground border-b border-border/20">
                <th className="text-right p-2">المنتج</th>
                <th className="text-right p-2">الكمية</th>
                <th className="text-right p-2">السعر</th>
                <th className="text-right p-2">الإجمالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {p.items.map(it => (
                <tr key={it.id}>
                  <td className="p-2">{it.productNameAr}</td>
                  <td className="p-2">{it.quantity}</td>
                  <td className="p-2">{formatCurrency(it.costPrice)}</td>
                  <td className="p-2 font-semibold text-primary">{formatCurrency(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="border-t border-border/20 pt-3 space-y-1 text-sm">
          <Row label="المجموع"       value={formatCurrency(p.subtotal)} />
          <Row label="الخصم"         value={`- ${formatCurrency(p.discountAmount)}`} />
          <Row label="تكاليف إضافية" value={formatCurrency(p.extraCosts)} />
          <Row label="الإجمالي"      value={formatCurrency(p.total)} bold />
          <Row label="المدفوع"       value={formatCurrency(p.paidAmount)} className="text-green-400" />
          <Row label="المتبقي"       value={formatCurrency(p.remainingAmount)}
            className={parseFloat(p.remainingAmount) > 0 ? "text-red-400" : "text-green-400"} />
        </div>

        {p.notes && (
          <div className="p-3 bg-background/50 rounded-lg text-sm text-muted-foreground">
            <span className="font-medium text-foreground">ملاحظات: </span>{p.notes}
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint} className="gap-2">
            <Printer className="w-4 h-4" /> طباعة
          </Button>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground text-xs">{label}: </span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function Row({ label, value, bold, className }: { label: string; value: string; bold?: boolean; className?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${bold ? "font-bold" : ""} ${className ?? ""}`}>{value}</span>
    </div>
  );
}
