import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Search, Printer, FileText, Save, RefreshCw,
  ShoppingCart, X, ChevronLeft, ChevronRight, Barcode, PauseCircle, PlayCircle,
  CheckCircle2, Clock, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, formatCurrency } from "./_lib";

// ── Types ──────────────────────────────────────────────────────────────────
type Product = {
  id: number; name: string; nameAr: string; price: string; costPrice?: string;
  stock: string; barcode?: string; images?: string[];
};
type CartItem = {
  productId: number; productName: string; barcode: string;
  quantity: number; unitPrice: number; discount: number; discountPct: number;
  total: number; costPrice: number;
};
type SalesInvoice = {
  id: number; invoiceNo: string; date: string; customerName: string; customerPhone?: string;
  subtotal: string; discountAmount: string; taxAmount: string; total: string;
  paidAmount: string; remainingAmount: string; paymentMethod: string; paymentStatus: string;
  status: string; isInternal: number; notes?: string; createdByName: string; createdAt: string;
  items?: CartItem[];
};
type HeldInvoice = { id: string; customerName: string; items: CartItem[]; createdAt: string };

const PAYMENT_METHODS = [
  { value: "cash",     label: "نقداً" },
  { value: "card",     label: "بطاقة" },
  { value: "transfer", label: "تحويل" },
  { value: "credit",   label: "آجل" },
];

const PAYMENT_STATUSES = [
  { value: "paid",    label: "مدفوع",    color: "text-emerald-400" },
  { value: "partial", label: "جزئي",     color: "text-amber-400" },
  { value: "unpaid",  label: "غير مدفوع", color: "text-red-400" },
];

function newInvoice() {
  return {
    customerName: "", customerPhone: "", notes: "",
    paymentMethod: "cash", paymentStatus: "paid",
    paidAmount: "", taxPct: "0", discountAmount: "0",
    isInternal: false, date: new Date().toISOString().slice(0, 10),
  };
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function SalesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  // Invoice state
  const [form, setForm] = useState(newInvoice());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [saving, setSaving] = useState(false);

  // Held invoices (localStorage)
  const [held, setHeld] = useState<HeldInvoice[]>(() => {
    try { return JSON.parse(localStorage.getItem("ajn_held_invoices") || "[]"); } catch { return []; }
  });
  const [showHeld, setShowHeld] = useState(false);

  // Invoice list panel
  const [listMode, setListMode] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [listFrom, setListFrom] = useState("");
  const [listTo, setListTo] = useState("");

  // Product search
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["admin", "products-all"],
    queryFn: () => adminFetch("/admin/products?limit=500"),
    staleTime: 3 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  // Invoices list
  const { data: invoicesList } = useQuery({
    queryKey: ["admin", "sales-invoices", listPage, listFrom, listTo],
    queryFn: () => adminFetch<{ data: SalesInvoice[]; total: number }>(
      `/admin/sales-invoices?page=${listPage}&limit=20${listFrom ? `&from=${listFrom}` : ""}${listTo ? `&to=${listTo}` : ""}`
    ),
    enabled: listMode,
  });

  // Filtered products for search
  const q = searchQ.toLowerCase();
  const filteredProducts = q
    ? products.filter(p =>
        p.nameAr?.toLowerCase().includes(q) ||
        p.name?.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q)
      ).slice(0, 10)
    : [];

  // ── Cart operations ──────────────────────────────────────────────────────
  function addToCart(p: Product) {
    const price = parseFloat(p.price) || 0;
    const cost = parseFloat(p.costPrice || "0") || 0;
    setCart(prev => {
      const idx = prev.findIndex(i => i.productId === p.id);
      if (idx >= 0) {
        const updated = [...prev];
        const item = { ...updated[idx] };
        item.quantity += 1;
        item.total = item.quantity * item.unitPrice - item.discount;
        updated[idx] = item;
        return updated;
      }
      return [...prev, {
        productId: p.id, productName: p.nameAr || p.name,
        barcode: p.barcode || "", quantity: 1,
        unitPrice: price, discount: 0, discountPct: 0,
        total: price, costPrice: cost,
      }];
    });
    setSearchQ("");
    searchRef.current?.focus();
  }

  function updateItem(idx: number, field: keyof CartItem, raw: string) {
    setCart(prev => {
      const updated = [...prev];
      const item = { ...updated[idx] } as any;
      const val = parseFloat(raw) || 0;
      item[field] = field === "productName" || field === "barcode" ? raw : val;
      if (field === "discountPct") {
        item.discount = +(item.unitPrice * item.quantity * val / 100).toFixed(2);
      } else if (field === "discount") {
        item.discountPct = item.unitPrice > 0
          ? +(val / (item.unitPrice * item.quantity) * 100).toFixed(2)
          : 0;
      }
      item.total = +(item.quantity * item.unitPrice - item.discount).toFixed(2);
      updated[idx] = item;
      return updated;
    });
  }

  function removeItem(idx: number) {
    setCart(prev => prev.filter((_, i) => i !== idx));
  }

  // ── Totals ───────────────────────────────────────────────────────────────
  const subtotal = cart.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const totalDiscount = cart.reduce((s, i) => s + i.discount, 0) + parseFloat(form.discountAmount || "0");
  const taxPct = parseFloat(form.taxPct || "0");
  const taxAmount = +((subtotal - totalDiscount) * taxPct / 100).toFixed(2);
  const grandTotal = +(subtotal - totalDiscount + taxAmount).toFixed(2);
  const paidAmt = parseFloat(form.paidAmount || "0");
  const remaining = +(grandTotal - paidAmt).toFixed(2);

  // Auto paymentStatus
  const autoStatus = paidAmt >= grandTotal ? "paid" : paidAmt > 0 ? "partial" : "unpaid";

  // ── Hold / Retrieve ──────────────────────────────────────────────────────
  function holdInvoice() {
    if (cart.length === 0) return;
    const h: HeldInvoice = {
      id: Date.now().toString(),
      customerName: form.customerName,
      items: cart,
      createdAt: new Date().toISOString(),
    };
    const updated = [...held, h];
    setHeld(updated);
    localStorage.setItem("ajn_held_invoices", JSON.stringify(updated));
    setCart([]);
    setForm(newInvoice());
    toast({ title: "تم تعليق الفاتورة", description: `${cart.length} صنف` });
  }

  function retrieveHeld(h: HeldInvoice) {
    if (cart.length > 0 && !confirm("سيتم مسح الفاتورة الحالية، هل تريد الاسترجاع؟")) return;
    setCart(h.items);
    setForm(f => ({ ...f, customerName: h.customerName }));
    const updated = held.filter(x => x.id !== h.id);
    setHeld(updated);
    localStorage.setItem("ajn_held_invoices", JSON.stringify(updated));
    setShowHeld(false);
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function saveInvoice() {
    if (cart.length === 0) { toast({ title: "الفاتورة فارغة", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = {
        date: form.date,
        customerName: form.customerName,
        customerPhone: form.customerPhone,
        subtotal, discountAmount: totalDiscount, taxAmount, total: grandTotal,
        paidAmount: paidAmt, remainingAmount: remaining,
        paymentMethod: form.paymentMethod,
        paymentStatus: autoStatus,
        isInternal: form.isInternal ? 1 : 0,
        notes: form.notes,
        items: cart.map(i => ({
          productId: i.productId, productName: i.productName, barcode: i.barcode,
          quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount,
          discountPct: i.discountPct, total: i.total, costPrice: i.costPrice,
        })),
      };
      const res = await adminFetch<{ invoice: SalesInvoice }>("/admin/sales-invoices", {
        method: "POST", body: JSON.stringify(payload),
      });
      toast({ title: "تم حفظ الفاتورة", description: res?.invoice?.invoiceNo ?? "تم الحفظ" });
      queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoices"] });
      setCart([]);
      setForm(newInvoice());
    } catch (e: any) {
      toast({ title: "خطأ في الحفظ", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // ── Handle barcode Enter ─────────────────────────────────────────────────
  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && filteredProducts.length === 1) {
      addToCart(filteredProducts[0]);
    }
    // barcode scanner typically ends with Enter; if exactly one match, add it
    if (e.key === "Enter" && filteredProducts.length > 1) {
      const exact = filteredProducts.find(p => p.barcode === searchQ);
      if (exact) addToCart(exact);
    }
  }

  // ── View: Invoice List ───────────────────────────────────────────────────
  if (listMode) {
    return <InvoiceListView
      invoices={invoicesList?.data ?? []}
      total={invoicesList?.total ?? 0}
      page={listPage} onPage={setListPage}
      from={listFrom} to={listTo}
      onFrom={setListFrom} onTo={setListTo}
      onBack={() => setListMode(false)}
    />;
  }

  // ── View: POS ────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">فاتورة مبيعات</h1>
          <p className="text-sm text-muted-foreground">نقطة البيع</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {held.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowHeld(true)} className="relative">
              <PlayCircle className="w-4 h-4 ml-1" />
              معلقة
              <span className="absolute -top-1.5 -left-1.5 bg-amber-500 text-black text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {held.length}
              </span>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={holdInvoice} disabled={cart.length === 0}>
            <PauseCircle className="w-4 h-4 ml-1" />
            تعليق
          </Button>
          <Button variant="outline" size="sm" onClick={() => setListMode(true)}>
            <FileText className="w-4 h-4 ml-1" />
            سجل الفواتير
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setCart([]); setForm(newInvoice()); }}>
            <RefreshCw className="w-4 h-4 ml-1" />
            جديدة
          </Button>
        </div>
      </div>

      {/* Held Invoices Modal */}
      {showHeld && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowHeld(false)}>
          <div className="bg-card rounded-xl border border-border/40 w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">الفواتير المعلقة</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowHeld(false)}><X className="w-4 h-4" /></Button>
            </div>
            {held.length === 0
              ? <p className="text-muted-foreground text-center py-6">لا توجد فواتير معلقة</p>
              : <div className="space-y-2">
                  {held.map(h => (
                    <div key={h.id} className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
                      <div>
                        <p className="font-medium text-sm">{h.customerName || "عميل نقدي"}</p>
                        <p className="text-xs text-muted-foreground">{h.items.length} صنف · {new Date(h.createdAt).toLocaleTimeString("ar")}</p>
                      </div>
                      <Button size="sm" onClick={() => retrieveHeld(h)}>استرجاع</Button>
                    </div>
                  ))}
                </div>
            }
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* Left: Cart */}
        <div className="space-y-4">
          {/* Product Search */}
          <div className="bg-card rounded-xl border border-border/40 p-4">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                ref={searchRef}
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                onKeyDown={handleSearchKey}
                placeholder="ابحث عن منتج أو امسح الباركود..."
                className="w-full bg-background border border-border/40 rounded-lg px-4 py-2 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
              {searchQ && (
                <button onClick={() => setSearchQ("")} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {filteredProducts.length > 0 && (
              <div className="mt-2 border border-border/30 rounded-lg overflow-hidden divide-y divide-border/20">
                {filteredProducts.map(p => (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-primary/10 text-sm transition-colors text-right"
                  >
                    <div>
                      <p className="font-medium text-foreground">{p.nameAr || p.name}</p>
                      {p.barcode && <p className="text-xs text-muted-foreground flex items-center gap-1"><Barcode className="w-3 h-3" />{p.barcode}</p>}
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-primary">{formatCurrency(p.price)}</p>
                      <p className="text-xs text-muted-foreground">مخزون: {p.stock}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cart Table */}
          <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">أصناف الفاتورة</span>
              <span className="text-xs text-muted-foreground">({cart.length} صنف)</span>
            </div>
            {cart.length === 0
              ? <div className="py-12 text-center text-muted-foreground text-sm">ابحث عن منتج لإضافته</div>
              : <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 text-muted-foreground text-xs">
                        <th className="px-3 py-2 text-right">#</th>
                        <th className="px-3 py-2 text-right">المنتج</th>
                        <th className="px-3 py-2 text-center">الكمية</th>
                        <th className="px-3 py-2 text-center">السعر</th>
                        <th className="px-3 py-2 text-center">خصم %</th>
                        <th className="px-3 py-2 text-center">الخصم</th>
                        <th className="px-3 py-2 text-center">الإجمالي</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      {cart.map((item, idx) => (
                        <tr key={idx} className="hover:bg-muted/10">
                          <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                          <td className="px-3 py-2">
                            <input
                              value={item.productName}
                              onChange={e => updateItem(idx, "productName", e.target.value)}
                              className="bg-transparent w-full min-w-[120px] focus:outline-none focus:ring-1 focus:ring-primary rounded px-1"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="0.001" step="0.001"
                              value={item.quantity}
                              onChange={e => updateItem(idx, "quantity", e.target.value)}
                              className="bg-background border border-border/30 rounded text-center w-20 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="0"
                              value={item.unitPrice}
                              onChange={e => updateItem(idx, "unitPrice", e.target.value)}
                              className="bg-background border border-border/30 rounded text-center w-24 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="0" max="100"
                              value={item.discountPct}
                              onChange={e => updateItem(idx, "discountPct", e.target.value)}
                              className="bg-background border border-border/30 rounded text-center w-16 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="0"
                              value={item.discount}
                              onChange={e => updateItem(idx, "discount", e.target.value)}
                              className="bg-background border border-border/30 rounded text-center w-24 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </td>
                          <td className="px-3 py-2 text-center font-medium text-primary">
                            {formatCurrency(item.total)}
                          </td>
                          <td className="px-3 py-2">
                            <button onClick={() => removeItem(idx)} className="text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
            }
          </div>
        </div>

        {/* Right: Invoice Details + Payment */}
        <div className="space-y-4">
          {/* Customer */}
          <div className="bg-card rounded-xl border border-border/40 p-4 space-y-3">
            <h3 className="font-semibold text-sm">بيانات الفاتورة</h3>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">التاريخ</label>
              <input
                type="date" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">اسم العميل</label>
              <input
                value={form.customerName}
                onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                placeholder="عميل نقدي"
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">رقم الهاتف</label>
              <input
                value={form.customerPhone}
                onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))}
                placeholder="07XX XXX XXXX"
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                dir="ltr"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox" id="isInternal"
                checked={form.isInternal}
                onChange={e => setForm(f => ({ ...f, isInternal: e.target.checked }))}
                className="accent-primary"
              />
              <label htmlFor="isInternal" className="text-xs text-muted-foreground cursor-pointer">فاتورة داخلية (بدون إشعارات)</label>
            </div>
          </div>

          {/* Totals */}
          <div className="bg-card rounded-xl border border-border/40 p-4 space-y-2">
            <h3 className="font-semibold text-sm mb-3">الإجماليات</h3>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">المجموع الفرعي</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-muted-foreground">خصم إضافي</span>
              <input
                type="number" min="0"
                value={form.discountAmount}
                onChange={e => setForm(f => ({ ...f, discountAmount: e.target.value }))}
                className="bg-background border border-border/30 rounded px-2 py-1 text-sm w-28 text-left focus:outline-none focus:ring-1 focus:ring-primary"
                dir="ltr"
              />
            </div>
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-muted-foreground">ضريبة %</span>
              <input
                type="number" min="0" max="100"
                value={form.taxPct}
                onChange={e => setForm(f => ({ ...f, taxPct: e.target.value }))}
                className="bg-background border border-border/30 rounded px-2 py-1 text-sm w-28 text-left focus:outline-none focus:ring-1 focus:ring-primary"
                dir="ltr"
              />
            </div>
            {taxAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">قيمة الضريبة</span>
                <span>{formatCurrency(taxAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold pt-2 border-t border-border/30">
              <span>الإجمالي الكلي</span>
              <span className="text-primary">{formatCurrency(grandTotal)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="bg-card rounded-xl border border-border/40 p-4 space-y-3">
            <h3 className="font-semibold text-sm">طريقة الدفع</h3>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map(m => (
                <button
                  key={m.value}
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
              <input
                type="number" min="0"
                value={form.paidAmount}
                onChange={e => setForm(f => ({ ...f, paidAmount: e.target.value }))}
                placeholder={grandTotal.toString()}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                dir="ltr"
              />
            </div>
            {grandTotal > 0 && (
              <div className={`flex justify-between text-sm font-medium ${remaining > 0 ? "text-red-400" : "text-emerald-400"}`}>
                <span>{remaining > 0 ? "المتبقي" : "الباقي"}</span>
                <span>{formatCurrency(Math.abs(remaining))}{remaining < 0 ? " (زيادة)" : ""}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">الحالة:</span>
              {PAYMENT_STATUSES.find(s => s.value === autoStatus) && (
                <span className={`font-medium ${PAYMENT_STATUSES.find(s => s.value === autoStatus)!.color}`}>
                  {PAYMENT_STATUSES.find(s => s.value === autoStatus)!.label}
                </span>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">ملاحظات</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 gap-2">
            <Button
              onClick={saveInvoice}
              disabled={saving || cart.length === 0}
              className="w-full bg-primary text-black hover:bg-primary/90 font-bold h-12 text-base"
            >
              {saving
                ? <><RefreshCw className="w-4 h-4 ml-2 animate-spin" />جاري الحفظ...</>
                : <><Save className="w-4 h-4 ml-2" />حفظ الفاتورة</>
              }
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Invoice List Sub-View ──────────────────────────────────────────────────
function InvoiceListView({
  invoices, total, page, onPage, from, to, onFrom, onTo, onBack,
}: {
  invoices: SalesInvoice[]; total: number; page: number; onPage: (p: number) => void;
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
          <h1 className="text-xl font-bold">سجل فواتير المبيعات</h1>
          <p className="text-xs text-muted-foreground">{total} فاتورة</p>
        </div>
      </div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-card rounded-xl border border-border/40 p-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">من تاريخ</label>
          <input type="date" value={from} onChange={e => { onFrom(e.target.value); onPage(1); }}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">إلى تاريخ</label>
          <input type="date" value={to} onChange={e => { onTo(e.target.value); onPage(1); }}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>
      {/* Table */}
      <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 text-muted-foreground text-xs">
                <th className="px-4 py-3 text-right">رقم الفاتورة</th>
                <th className="px-4 py-3 text-right">التاريخ</th>
                <th className="px-4 py-3 text-right">العميل</th>
                <th className="px-4 py-3 text-center">الإجمالي</th>
                <th className="px-4 py-3 text-center">الحالة</th>
                <th className="px-4 py-3 text-center">الدفع</th>
                <th className="px-4 py-3 text-center">النوع</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {invoices.length === 0
                ? <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">لا توجد فواتير</td></tr>
                : invoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-muted/10">
                      <td className="px-4 py-3 font-mono text-primary font-medium">{inv.invoiceNo}</td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.date}</td>
                      <td className="px-4 py-3">{inv.customerName || "—"}</td>
                      <td className="px-4 py-3 text-center font-medium">{formatCurrency(inv.total)}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <PayStatusBadge status={inv.paymentStatus} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {inv.isInternal === 1
                          ? <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">داخلية</span>
                          : <span className="text-xs bg-muted/30 text-muted-foreground px-2 py-0.5 rounded-full">عادية</span>
                        }
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
            <span className="text-sm text-muted-foreground">
              صفحة {page} من {totalPages}
            </span>
            <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; class: string }> = {
    active:  { label: "نشطة",   class: "bg-emerald-500/10 text-emerald-400" },
    deleted: { label: "محذوفة", class: "bg-red-500/10 text-red-400" },
    held:    { label: "معلقة",  class: "bg-amber-500/10 text-amber-400" },
  };
  const s = map[status] ?? { label: status, class: "bg-muted/30 text-muted-foreground" };
  return <span className={`text-xs px-2 py-0.5 rounded-full ${s.class}`}>{s.label}</span>;
}

function PayStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; icon: any; class: string }> = {
    paid:    { label: "مدفوع",     icon: CheckCircle2, class: "text-emerald-400" },
    partial: { label: "جزئي",      icon: Clock,        class: "text-amber-400" },
    unpaid:  { label: "غير مدفوع", icon: AlertCircle,  class: "text-red-400" },
  };
  const s = map[status] ?? { label: status, icon: null, class: "text-muted-foreground" };
  const Icon = s.icon;
  return (
    <span className={`text-xs flex items-center justify-center gap-1 ${s.class}`}>
      {Icon && <Icon className="w-3 h-3" />}{s.label}
    </span>
  );
}
