import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Search, Save, RefreshCw, X,
  ChevronLeft, ChevronRight, CheckCircle2, Clock, AlertCircle, Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, formatCurrency } from "./_lib";

// ── Types ──────────────────────────────────────────────────────────────────
type Product = {
  id: number; name: string; nameAr: string; price: string; costPrice?: string;
  stock: string; barcode?: string; categoryName?: string; category?: string;
};
type Supplier = {
  id: number; name: string; phone?: string; email?: string; balance: string; isActive: number;
};
type PurchaseItem = {
  productId: number | null; productName: string; barcode: string;
  quantity: number; costPrice: number; salePrice: number; discount: number; total: number;
};
type PurchaseInvoice = {
  id: number; invoiceNo: string; date: string; supplierName: string; supplierId?: number;
  subtotal: string; discountAmount: string; taxAmount: string; shippingCost: string; total: string;
  paidAmount: string; remainingAmount: string; paymentMethod: string; paymentStatus: string;
  status: string; notes?: string; createdByName: string; createdAt: string;
};

const PAYMENT_METHODS = [
  { value: "cash",     label: "نقداً" },
  { value: "card",     label: "بطاقة" },
  { value: "transfer", label: "تحويل" },
  { value: "credit",   label: "آجل" },
];

function blankItem(): PurchaseItem {
  return { productId: null, productName: "", barcode: "", quantity: 1, costPrice: 0, salePrice: 0, discount: 0, total: 0 };
}

function newForm() {
  return {
    date: new Date().toISOString().slice(0, 10),
    supplierName: "", supplierId: "" as string | number,
    paymentMethod: "cash", paidAmount: "",
    shippingCost: "0", discountAmount: "0", taxPct: "0", notes: "",
  };
}

export default function PurchasesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [form, setForm] = useState(newForm());
  const [items, setItems] = useState<PurchaseItem[]>([blankItem()]);
  const [saving, setSaving] = useState(false);
  const [searchQ, setSearchQ] = useState<Record<number, string>>({});
  const [showProductSearch, setShowProductSearch] = useState<number | null>(null);
  const [listMode, setListMode] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [listFrom, setListFrom] = useState("");
  const [listTo, setListTo] = useState("");

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["admin", "products-all"],
    queryFn: () => adminFetch("/admin/products?limit=500"),
    staleTime: 3 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["admin", "suppliers"],
    queryFn: () => adminFetch("/admin/suppliers"),
    staleTime: 5 * 60 * 1000,
  });

  const { data: invoicesList } = useQuery({
    queryKey: ["admin", "purchase-invoices", listPage, listFrom, listTo],
    queryFn: () => adminFetch<{ data: PurchaseInvoice[]; total: number }>(
      `/admin/purchase-invoices?limit=20&offset=${(listPage - 1) * 20}${listFrom ? `&from=${listFrom}` : ""}${listTo ? `&to=${listTo}` : ""}`
    ),
    enabled: listMode,
  });

  // ── Totals ───────────────────────────────────────────────────────────────
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const extraDiscount = parseFloat(form.discountAmount || "0");
  const shipping = parseFloat(form.shippingCost || "0");
  const taxPct = parseFloat(form.taxPct || "0");
  const taxAmount = +((subtotal - extraDiscount) * taxPct / 100).toFixed(2);
  const grandTotal = +(subtotal - extraDiscount + taxAmount + shipping).toFixed(2);
  const paidAmt = parseFloat(form.paidAmount || "0");
  const remaining = +(grandTotal - paidAmt).toFixed(2);
  const autoStatus = paidAmt >= grandTotal ? "paid" : paidAmt > 0 ? "partial" : "unpaid";

  // ── Item operations ──────────────────────────────────────────────────────
  function addRow() { setItems(prev => [...prev, blankItem()]); }

  function removeRow(idx: number) {
    if (items.length === 1) return;
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  function updateItem(idx: number, field: keyof PurchaseItem, raw: string | number) {
    setItems(prev => {
      const updated = [...prev];
      const item = { ...updated[idx] } as any;
      const val = typeof raw === "string" ? (parseFloat(raw) || 0) : raw;
      if (field === "productName" || field === "barcode") item[field] = raw;
      else item[field] = val;
      item.total = +(item.quantity * item.costPrice - item.discount).toFixed(2);
      updated[idx] = item;
      return updated;
    });
  }

  function selectProduct(idx: number, p: Product) {
    setItems(prev => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        productId: p.id,
        productName: p.nameAr || p.name,
        barcode: p.barcode || "",
        costPrice: parseFloat(p.costPrice || "0"),
        salePrice: parseFloat(p.price || "0"),
        total: +(updated[idx].quantity * parseFloat(p.costPrice || "0") - updated[idx].discount).toFixed(2),
      };
      return updated;
    });
    setShowProductSearch(null);
    setSearchQ(prev => ({ ...prev, [idx]: "" }));
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function saveInvoice() {
    const validItems = items.filter(i => i.productName && i.quantity > 0);
    if (validItems.length === 0) { toast({ title: "أضف أصناف للفاتورة", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = {
        date: form.date,
        supplierName: form.supplierName,
        supplierId: form.supplierId || null,
        subtotal, discountAmount: extraDiscount, taxAmount, shippingCost: shipping,
        total: grandTotal, paidAmount: paidAmt, remainingAmount: remaining,
        paymentMethod: form.paymentMethod, paymentStatus: autoStatus,
        notes: form.notes,
        items: validItems.map(i => ({
          productId: i.productId, productName: i.productName, barcode: i.barcode,
          quantity: i.quantity, costPrice: i.costPrice, salePrice: i.salePrice,
          discount: i.discount, total: i.total,
        })),
      };
      const res = await adminFetch<{ invoice: PurchaseInvoice }>("/admin/purchase-invoices", {
        method: "POST", body: JSON.stringify(payload),
      });
      toast({ title: "تم حفظ فاتورة الشراء", description: res?.invoice?.invoiceNo ?? "تم الحفظ" });
      queryClient.invalidateQueries({ queryKey: ["admin", "purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "products-all"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "inventory-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "inventory-alert-count"] });
      setItems([blankItem()]);
      setForm(newForm());
    } catch (e: any) {
      toast({ title: "خطأ في الحفظ", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (listMode) {
    return <PurchaseListView
      invoices={invoicesList?.data ?? []}
      total={invoicesList?.total ?? 0}
      page={listPage} onPage={setListPage}
      from={listFrom} to={listTo}
      onFrom={setListFrom} onTo={setListTo}
      onBack={() => setListMode(false)}
    />;
  }

  return (
    <div dir="rtl" className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">فاتورة مشتريات</h1>
          <p className="text-sm text-muted-foreground">استلام البضاعة وتحديث المخزون</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setListMode(true)}>
            <Package className="w-4 h-4 ml-1" />
            سجل المشتريات
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setItems([blankItem()]); setForm(newForm()); }}>
            <RefreshCw className="w-4 h-4 ml-1" />
            جديدة
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* Left: Items Table */}
        <div className="space-y-4">
          {/* Items */}
          <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
              <span className="font-semibold text-sm">أصناف الفاتورة</span>
              <Button variant="ghost" size="sm" onClick={addRow}>
                <Plus className="w-4 h-4 ml-1" />
                إضافة صنف
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 text-muted-foreground text-xs">
                    <th className="px-3 py-2 text-right">#</th>
                    <th className="px-3 py-2 text-right">المنتج</th>
                    <th className="px-3 py-2 text-center">الكمية</th>
                    <th className="px-3 py-2 text-center">سعر التكلفة</th>
                    <th className="px-3 py-2 text-center">سعر البيع</th>
                    <th className="px-3 py-2 text-center">خصم</th>
                    <th className="px-3 py-2 text-center">الإجمالي</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {items.map((item, idx) => {
                    const q = (searchQ[idx] ?? "").toLowerCase();
                    const filtered = q
                      ? products.filter(p =>
                          p.nameAr?.toLowerCase().includes(q) || p.name?.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q)
                        ).slice(0, 8)
                      : [];
                    return (
                      <tr key={idx} className="hover:bg-muted/10">
                        <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                        <td className="px-3 py-2 relative min-w-[180px]">
                          <div className="flex items-center gap-1">
                            <input
                              value={item.productName || searchQ[idx] || ""}
                              onChange={e => {
                                setSearchQ(prev => ({ ...prev, [idx]: e.target.value }));
                                updateItem(idx, "productName", e.target.value);
                                setShowProductSearch(idx);
                              }}
                              onFocus={() => setShowProductSearch(idx)}
                              placeholder="اسم الصنف..."
                              className="bg-transparent w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1 py-0.5"
                            />
                            <button
                              onClick={() => setShowProductSearch(showProductSearch === idx ? null : idx)}
                              className="text-muted-foreground hover:text-primary shrink-0"
                            >
                              <Search className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {showProductSearch === idx && filtered.length > 0 && (
                            <div className="absolute top-full right-0 z-20 w-72 bg-card border border-border/40 rounded-lg shadow-lg overflow-hidden mt-1">
                              {filtered.map(p => (
                                <button
                                  key={p.id}
                                  onClick={() => selectProduct(idx, p)}
                                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-primary/10 text-sm text-right"
                                >
                                  <span>
                                    <span className="block font-medium text-foreground">{p.nameAr || p.name}</span>
                                    <span className="block text-[11px] text-muted-foreground">
                                      {p.barcode ? `${p.barcode} · ` : ""}{p.categoryName || p.category || "بدون قسم"}
                                    </span>
                                  </span>
                                  <span className="text-xs text-muted-foreground text-left">
                                    <span className="block">{formatCurrency(p.costPrice || "0")}</span>
                                    <span className="block">مخزون: {p.stock}</span>
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min="0.001" step="0.001"
                            value={item.quantity}
                            onChange={e => updateItem(idx, "quantity", e.target.value)}
                            className="bg-background border border-border/30 rounded text-center w-20 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min="0"
                            value={item.costPrice}
                            onChange={e => updateItem(idx, "costPrice", e.target.value)}
                            className="bg-background border border-border/30 rounded text-center w-24 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min="0"
                            value={item.salePrice}
                            onChange={e => updateItem(idx, "salePrice", e.target.value)}
                            className="bg-background border border-border/30 rounded text-center w-24 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min="0"
                            value={item.discount}
                            onChange={e => updateItem(idx, "discount", e.target.value)}
                            className="bg-background border border-border/30 rounded text-center w-20 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2 text-center font-medium text-primary">
                          {formatCurrency(item.total)}
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => removeRow(idx)} className="text-muted-foreground hover:text-destructive transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-border/20">
              <Button variant="ghost" size="sm" onClick={addRow} className="text-muted-foreground">
                <Plus className="w-4 h-4 ml-1" />
                إضافة صنف جديد
              </Button>
            </div>
          </div>
        </div>

        {/* Right: Details + Payment */}
        <div className="space-y-4">
          {/* Supplier & Date */}
          <div className="bg-card rounded-xl border border-border/40 p-4 space-y-3">
            <h3 className="font-semibold text-sm">بيانات الفاتورة</h3>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">التاريخ</label>
              <input type="date" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">المورد</label>
              <select
                value={form.supplierId}
                onChange={e => {
                  const id = e.target.value;
                  const sup = suppliers.find(s => s.id.toString() === id);
                  setForm(f => ({ ...f, supplierId: id, supplierName: sup?.name || "" }));
                }}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">اختر مورد أو اكتب اسمه</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {!form.supplierId && (
              <div>
                <input
                  value={form.supplierName}
                  onChange={e => setForm(f => ({ ...f, supplierName: e.target.value }))}
                  placeholder="اسم المورد (اختياري)"
                  className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="bg-card rounded-xl border border-border/40 p-4 space-y-2">
            <h3 className="font-semibold text-sm mb-3">الإجماليات</h3>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">مجموع الأصناف</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-muted-foreground">خصم إضافي</span>
              <input type="number" min="0" value={form.discountAmount}
                onChange={e => setForm(f => ({ ...f, discountAmount: e.target.value }))}
                className="bg-background border border-border/30 rounded px-2 py-1 text-sm w-28 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                dir="ltr"
              />
            </div>
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-muted-foreground">شحن</span>
              <input type="number" min="0" value={form.shippingCost}
                onChange={e => setForm(f => ({ ...f, shippingCost: e.target.value }))}
                className="bg-background border border-border/30 rounded px-2 py-1 text-sm w-28 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                dir="ltr"
              />
            </div>
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-muted-foreground">ضريبة %</span>
              <input type="number" min="0" max="100" value={form.taxPct}
                onChange={e => setForm(f => ({ ...f, taxPct: e.target.value }))}
                className="bg-background border border-border/30 rounded px-2 py-1 text-sm w-28 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                dir="ltr"
              />
            </div>
            <div className="flex justify-between text-base font-bold pt-2 border-t border-border/30">
              <span>الإجمالي الكلي</span>
              <span className="text-primary">{formatCurrency(grandTotal)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="bg-card rounded-xl border border-border/40 p-4 space-y-3">
            <h3 className="font-semibold text-sm">الدفع</h3>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map(m => (
                <button key={m.value}
                  onClick={() => setForm(f => ({ ...f, paymentMethod: m.value }))}
                  className={`rounded-lg py-2 text-sm font-medium border transition-colors ${
                    form.paymentMethod === m.value
                      ? "bg-primary text-black border-primary"
                      : "border-border/40 text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">المبلغ المدفوع</label>
              <input type="number" min="0" value={form.paidAmount}
                onChange={e => setForm(f => ({ ...f, paidAmount: e.target.value }))}
                placeholder={grandTotal.toString()}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                dir="ltr"
              />
            </div>
            {grandTotal > 0 && (
              <div className={`flex justify-between text-sm font-medium ${remaining > 0 ? "text-status-danger" : "text-status-success"}`}>
                <span>{remaining > 0 ? "المتبقي" : "الباقي"}</span>
                <span>{formatCurrency(Math.abs(remaining))}{remaining < 0 ? " (زيادة)" : ""}</span>
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">ملاحظات</label>
              <textarea value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          {/* Save */}
          <Button
            onClick={saveInvoice}
            disabled={saving}
            className="w-full bg-primary text-black hover:bg-primary/90 font-bold h-12 text-base"
          >
            {saving
              ? <><RefreshCw className="w-4 h-4 ml-2 animate-spin" />جاري الحفظ...</>
              : <><Save className="w-4 h-4 ml-2" />حفظ فاتورة الشراء</>
            }
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Purchase List Sub-View ─────────────────────────────────────────────────
function PurchaseListView({
  invoices, total, page, onPage, from, to, onFrom, onTo, onBack,
}: {
  invoices: PurchaseInvoice[]; total: number; page: number; onPage: (p: number) => void;
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
  onBack: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / 20));
  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 ml-1" />رجوع
        </Button>
        <div>
          <h1 className="text-xl font-bold">سجل فواتير المشتريات</h1>
          <p className="text-xs text-muted-foreground">{total} فاتورة</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 bg-card rounded-xl border border-border/40 p-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">من تاريخ</label>
          <input type="date" value={from} onChange={e => { onFrom(e.target.value); onPage(1); }}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">إلى تاريخ</label>
          <input type="date" value={to} onChange={e => { onTo(e.target.value); onPage(1); }}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
        </div>
      </div>
      <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 text-muted-foreground text-xs">
                <th className="px-4 py-3 text-right">رقم الفاتورة</th>
                <th className="px-4 py-3 text-right">التاريخ</th>
                <th className="px-4 py-3 text-right">المورد</th>
                <th className="px-4 py-3 text-center">الإجمالي</th>
                <th className="px-4 py-3 text-center">الدفع</th>
                <th className="px-4 py-3 text-center">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {invoices.length === 0
                ? <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">لا توجد فواتير</td></tr>
                : invoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-muted/10">
                      <td className="px-4 py-3 font-mono text-primary font-medium">{inv.invoiceNo}</td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.date}</td>
                      <td className="px-4 py-3">{inv.supplierName || "—"}</td>
                      <td className="px-4 py-3 text-center font-medium">{formatCurrency(inv.total)}</td>
                      <td className="px-4 py-3 text-center">
                        <PayBadge status={inv.paymentStatus} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${inv.status === "active" ? "bg-status-success/10 text-status-success" : "bg-status-danger/10 text-status-danger"}`}>
                          {inv.status === "active" ? "نشطة" : "محذوفة"}
                        </span>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 p-3 border-t border-border/20">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground">صفحة {page} من {totalPages}</span>
            <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PayBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; class: string }> = {
    paid:    { label: "مدفوع",     class: "text-status-success" },
    partial: { label: "جزئي",      class: "text-status-warning" },
    unpaid:  { label: "غير مدفوع", class: "text-status-danger" },
  };
  const s = map[status] ?? { label: status, class: "text-muted-foreground" };
  return <span className={`text-xs font-medium ${s.class}`}>{s.label}</span>;
}
