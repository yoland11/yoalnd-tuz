import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useDeferredValue,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Search, FileText, Save, RefreshCw,
  ShoppingCart, X, ChevronLeft, ChevronRight, Barcode, PauseCircle, PlayCircle,
  CheckCircle2, Clock, AlertCircle, QrCode, Download,
  Printer, Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage, fetchAdminMe, formatCurrency } from "./_lib";
import DeliverySection, { type DeliveryOutput } from "./delivery-section";
import { printDeliveryLabel } from "./delivery-label";
import { downloadDataUrl, openQrPrintWindow } from "./print-helpers";
import { isCashPaymentMethod } from "@/lib/payment-settlement";
import { formatIraqiPhone, formatIraqiPhoneInput } from "@/lib/phone";
import { AccountSummaryCard, type LastPayment } from "./payment-collection";
import { thermalReceiptCss, printWhenImagesReadyScript } from "./print-helpers";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";

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
  financiallyReversed?: boolean;
  cancelledAt?: string | null; cancelledByName?: string | null; cancellationReason?: string | null;
  cancelledOriginalPaidAmount?: string | null;
  cancelledOriginalRemainingAmount?: string | null;
  reversalReferences?: Record<string, unknown>;
  reversalCompletedAt?: string | null; inventoryReversed?: boolean; financeReversed?: boolean;
  supplierId?: number | null; supplierName?: string | null; lastPayment?: LastPayment;
  items?: CartItem[];
  qr?: { dataUrl?: string; scanUrl?: string; token?: string; targetUrl?: string };
};
type HeldInvoice = { id: string; customerName: string; items: CartItem[]; createdAt: string };
type Customer = {
  id: number;
  name: string;
  phone?: string | null;
};
type Supplier = { id: number; name: string };

function finiteNumber(value: unknown, min = 0, max = 100_000_000) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

const PAYMENT_METHODS = [
  { value: "cash",     label: "نقداً" },
  { value: "card",     label: "بطاقة" },
  { value: "transfer", label: "تحويل" },
  { value: "credit",   label: "آجل" },
];

const PAYMENT_STATUSES = [
  { value: "paid",    label: "مدفوع",    color: "text-status-success" },
  { value: "partial", label: "جزئي",     color: "text-status-warning" },
  { value: "unpaid",  label: "غير مدفوع", color: "text-status-danger" },
];

function newInvoice() {
  return {
    customerName: "", customerPhone: "", customerId: "", notes: "",
    supplierId: "", supplierName: "",
    paymentMethod: "cash", paymentStatus: "paid",
    paidAmount: "", taxPct: "0", discountAmount: "0", couponCode: "", couponDiscountAmount: "0",
    isInternal: false, date: new Date().toISOString().slice(0, 10),
  };
}

function CustomerLookup({
  value,
  onValueChange,
  onSelect,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (customer: Customer) => void;
}) {
  const [open, setOpen] = useState(false);
  const deferredSearch = useDeferredValue(value.trim());
  const customers = useQuery<Customer[]>({
    queryKey: ["admin", "sales-customer-search", deferredSearch],
    queryFn: () =>
      adminFetch(
        `/admin/customers?search=${encodeURIComponent(deferredSearch)}&limit=12`,
      ),
    enabled: open && deferredSearch.length >= 2,
    staleTime: 30_000,
  });

  const showResults = open && deferredSearch.length >= 2;

  return (
    <div className="relative">
      <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder="ابحث باسم العميل أو الهاتف"
        autoComplete="off"
        aria-expanded={showResults}
        className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 pr-9 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {showResults ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border/40 bg-card shadow-xl">
          {customers.isFetching ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              جارٍ البحث عن العملاء...
            </div>
          ) : !customers.data?.length ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              لا يوجد عميل مطابق
            </div>
          ) : (
            customers.data.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(customer);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 border-b border-border/20 px-3 py-2.5 text-right transition-colors last:border-b-0 hover:bg-primary/10"
              >
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {customer.name || "بدون اسم"}
                </span>
                <span
                  className="shrink-0 text-xs text-muted-foreground"
                  dir="ltr"
                >
                  {formatIraqiPhone(customer.phone)}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function SalesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const submitKeyRef = useRef<string | null>(null);

  // Invoice state
  const [form, setForm] = useState(newInvoice());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: invoiceSettings } = usePublicSettings();
  const [delivery, setDelivery] = useState<DeliveryOutput>({
    method: "pickup", deliveryFee: 0, codFee: 0, codEnabled: false, valid: true, payload: null, summary: null,
  });

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
  const [listReversed, setListReversed] = useState(""); // "" all | "false" active | "true" reversed
  const [listSearch, setListSearch] = useState("");
  const deferredListSearch = useDeferredValue(listSearch.trim());
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const invoiceId = Number(new URLSearchParams(window.location.search).get("invoice"));
    if (Number.isFinite(invoiceId) && invoiceId > 0) {
      setListMode(true);
      setSelectedInvoiceId(invoiceId);
    }
  }, []);

  // Product search
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["admin", "products-all"],
    queryFn: () => adminFetch("/admin/products?limit=500"),
    staleTime: 3 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["admin", "suppliers", "sales"],
    queryFn: () => adminFetch("/admin/suppliers"),
    staleTime: 5 * 60 * 1000,
  });

  // Invoices list
  const { data: invoicesList } = useQuery({
    queryKey: ["admin", "sales-invoices", listPage, listFrom, listTo, listReversed, deferredListSearch],
    queryFn: () => adminFetch<{ data: SalesInvoice[]; total: number }>(
      `/admin/sales-invoices?limit=20&offset=${(listPage - 1) * 20}${listFrom ? `&from=${listFrom}` : ""}${listTo ? `&to=${listTo}` : ""}${listReversed ? `&reversed=${listReversed}` : ""}${deferredListSearch ? `&search=${encodeURIComponent(deferredListSearch)}` : ""}`
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
    const price = finiteNumber(p.price);
    const cost = finiteNumber(p.costPrice);
    setCart(prev => {
      const idx = prev.findIndex(i => i.productId === p.id);
      if (idx >= 0) {
        const updated = [...prev];
        const item = { ...updated[idx] };
        item.quantity = finiteNumber(item.quantity + 1, 0.001, 1_000_000);
        item.total = Math.max(0, item.quantity * item.unitPrice - item.discount);
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
      const val = field === "quantity"
        ? finiteNumber(raw, 0, 1_000_000)
        : field === "discountPct"
          ? finiteNumber(raw, 0, 100)
          : finiteNumber(raw);
      item[field] = field === "productName" || field === "barcode" ? raw : val;
      if (field === "discountPct") {
        item.discount = +(item.unitPrice * item.quantity * val / 100).toFixed(2);
      } else if (field === "discount") {
        item.discountPct = item.unitPrice > 0
          ? +(Math.min(val, item.unitPrice * item.quantity) / (item.unitPrice * item.quantity) * 100).toFixed(2)
          : 0;
      }
      item.discount = Math.min(item.discount, item.quantity * item.unitPrice);
      item.total = +Math.max(0, item.quantity * item.unitPrice - item.discount).toFixed(2);
      updated[idx] = item;
      return updated;
    });
  }

  function removeItem(idx: number) {
    setCart(prev => prev.filter((_, i) => i !== idx));
  }

  // ── Totals ───────────────────────────────────────────────────────────────
  const subtotal = cart.reduce((s, i) => s + finiteNumber(i.quantity) * finiteNumber(i.unitPrice), 0);
  const couponDiscount = finiteNumber(form.couponDiscountAmount);
  const totalDiscount = Math.min(subtotal, cart.reduce((s, i) => s + finiteNumber(i.discount), 0) + finiteNumber(form.discountAmount) + couponDiscount);
  const taxPct = finiteNumber(form.taxPct, 0, 100);
  const taxAmount = +(Math.max(0, subtotal - totalDiscount) * taxPct / 100).toFixed(2);
  const deliveryFee = finiteNumber(delivery.deliveryFee);
  const codFee = finiteNumber(delivery.codFee);
  const grandTotal = +Math.max(0, subtotal - totalDiscount + taxAmount + deliveryFee + codFee).toFixed(2);
  // Cash-on-delivery is collected on delivery, so the sale is not auto-paid.
  const paidAmt = delivery.codEnabled ? finiteNumber(form.paidAmount)
                  : isCashPaymentMethod(form.paymentMethod) ? grandTotal : Math.min(grandTotal, finiteNumber(form.paidAmount));
  const remaining = +Math.max(0, grandTotal - paidAmt).toFixed(2);

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
    if (saving) return;
    if (cart.length === 0) { toast({ title: "الفاتورة فارغة", variant: "destructive" }); return; }
    if (delivery.method === "province" && !delivery.valid) {
      toast({ title: "بيانات التوصيل ناقصة", description: "أكمل تفاصيل توصيل المحافظة", variant: "destructive" });
      return;
    }
    const invalidLine = cart.find((item) => !item.productName.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0);
    if (invalidLine || !Number.isFinite(grandTotal)) {
      toast({ title: "بيانات الفاتورة غير صالحة", description: "تحقق من المنتجات والكميات والأسعار قبل الحفظ.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      submitKeyRef.current ??= `sales-invoice:${crypto.randomUUID()}`;
      const payload = {
        date: form.date,
        customerName: form.customerName,
        customerPhone: form.customerPhone,
        customerId: form.customerId ? Number(form.customerId) : null,
        supplierId: form.supplierId || null,
        supplierName: form.supplierName || null,
        subtotal, discountAmount: totalDiscount, taxAmount, total: grandTotal,
        couponCode: form.couponCode || undefined,
        paidAmount: paidAmt, remainingAmount: remaining,
        paymentMethod: form.paymentMethod,
        paymentStatus: autoStatus,
        isInternal: form.isInternal ? 1 : 0,
        notes: form.notes,
        delivery: delivery.payload ?? undefined,
        items: cart.map(i => ({
          productId: i.productId, productName: i.productName, barcode: i.barcode,
          quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount,
          discountPct: i.discountPct, total: i.total, costPrice: i.costPrice,
        })),
      };
      const res = await adminFetch<{ invoice: SalesInvoice; delivery?: any; qr?: { dataUrl?: string } }>("/admin/sales-invoices", {
        method: "POST",
        headers: { "x-idempotency-key": submitKeyRef.current },
        body: JSON.stringify(payload),
      });
      submitKeyRef.current = null;
      toast({ title: "تم حفظ الفاتورة", description: res?.invoice?.invoiceNo ?? "تم الحفظ" });
      if (res?.delivery?.order?.id) {
        printDeliveryLabel({
          delivery: res.delivery,
          invoiceNo: res?.invoice?.invoiceNo ?? "",
          company: invoiceSettings?.site_name ?? "AJN",
          qrDataUrl: res?.qr?.dataUrl,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "products-all"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "inventory-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "inventory-alert-count"] });
      setCart([]);
      setForm(newInvoice());
      setDelivery({ method: "pickup", deliveryFee: 0, codFee: 0, codEnabled: false, valid: true, payload: null, summary: null });
      setSearchQ("");
      // Ready for the next invoice: focus the barcode/search field with no mouse.
      requestAnimationFrame(() => { searchRef.current?.focus(); searchRef.current?.select(); });
    } catch (e: unknown) {
      toast({ title: "خطأ في الحفظ", description: apiErrorMessage(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function applyCoupon() {
    if (!form.couponCode.trim()) {
      toast({ title: "أدخل كود الخصم", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch("/api/coupons/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: form.couponCode, subtotal, deliveryFee: 0 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "تعذر تطبيق الكوبون");
      setForm((f) => ({ ...f, couponCode: data.code, couponDiscountAmount: String(data.discountAmount ?? 0) }));
      toast({ title: "تم تطبيق الكوبون", description: data.code });
    } catch (err: any) {
      setForm((f) => ({ ...f, couponDiscountAmount: "0" }));
      toast({ title: "تعذر تطبيق الكوبون", description: err?.message, variant: "destructive" });
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
    return (
      <>
        <InvoiceListView
          invoices={invoicesList?.data ?? []}
          total={invoicesList?.total ?? 0}
          page={listPage} onPage={setListPage}
          from={listFrom} to={listTo}
          onFrom={setListFrom} onTo={setListTo}
          reversed={listReversed} onReversed={setListReversed}
          search={listSearch} onSearch={setListSearch}
          onBack={() => setListMode(false)}
          onOpen={setSelectedInvoiceId}
        />
        {selectedInvoiceId && (
          <SalesInvoiceDetailModal
            invoiceId={selectedInvoiceId}
            onClose={() => setSelectedInvoiceId(null)}
          />
        )}
      </>
    );
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
              <span className="absolute -top-1.5 -left-1.5 bg-status-warning text-black text-[11px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
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
                className="w-full bg-background border border-border/40 rounded-lg px-4 py-2 pr-9 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                              className="bg-transparent w-full min-w-[120px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="0.001" step="0.001"
                              value={item.quantity}
                              onChange={e => updateItem(idx, "quantity", e.target.value)}
                              className="bg-background border border-border/30 rounded text-center w-20 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="0"
                              value={item.unitPrice}
                              onChange={e => updateItem(idx, "unitPrice", e.target.value)}
                              className="bg-background border border-border/30 rounded text-center w-24 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="0" max="100"
                              value={item.discountPct}
                              onChange={e => updateItem(idx, "discountPct", e.target.value)}
                              className="bg-background border border-border/30 rounded text-center w-16 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="0"
                              value={item.discount}
                              onChange={e => updateItem(idx, "discount", e.target.value)}
                              className="bg-background border border-border/30 rounded text-center w-24 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">اسم العميل</label>
              <CustomerLookup
                value={form.customerName}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, customerName: value, customerId: "" }))
                }
                onSelect={(customer) =>
                  setForm((current) => ({
                    ...current,
                    customerId: String(customer.id),
                    customerName: customer.name,
                    customerPhone: formatIraqiPhoneInput(customer.phone),
                  }))
                }
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">رقم الهاتف</label>
              <input
                value={form.customerPhone}
                onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))}
                placeholder="07XX XXX XXXX"
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                dir="ltr"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">المورد</label>
              <select
                value={form.supplierId}
                onChange={(event) => {
                  const supplier = suppliers.find((row) => String(row.id) === event.target.value);
                  setForm((current) => ({ ...current, supplierId: event.target.value, supplierName: supplier?.name ?? "" }));
                }}
                className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">بدون مورد</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
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
                className="bg-background border border-border/30 rounded px-2 py-1 text-sm w-28 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                dir="ltr"
              />
            </div>
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-muted-foreground">كوبون</span>
              <div className="flex gap-2">
                <input
                  value={form.couponCode}
                  onChange={e => setForm(f => ({ ...f, couponCode: e.target.value.toUpperCase().replace(/\s+/g, ""), couponDiscountAmount: "0" }))}
                  className="bg-background border border-border/30 rounded px-2 py-1 text-sm w-28 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  dir="ltr"
                  placeholder="CODE"
                />
                <button type="button" onClick={applyCoupon} className="rounded border border-primary/40 px-3 py-1 text-xs text-primary hover:bg-primary/10">
                  تطبيق
                </button>
              </div>
            </div>
            {couponDiscount > 0 && (
              <div className="flex justify-between text-sm text-status-success">
                <span>خصم الكوبون</span>
                <span>- {formatCurrency(couponDiscount)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-muted-foreground">ضريبة %</span>
              <input
                type="number" min="0" max="100"
                value={form.taxPct}
                onChange={e => setForm(f => ({ ...f, taxPct: e.target.value }))}
                className="bg-background border border-border/30 rounded px-2 py-1 text-sm w-28 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                dir="ltr"
              />
            </div>
            {taxAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">قيمة الضريبة</span>
                <span>{formatCurrency(taxAmount)}</span>
              </div>
            )}
            {deliveryFee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">أجور التوصيل</span>
                <span>{formatCurrency(deliveryFee)}</span>
              </div>
            )}
            {codFee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">أجور الدفع عند الاستلام</span>
                <span>{formatCurrency(codFee)}</span>
              </div>
            )}
            {delivery.codEnabled && (
              <div className="flex justify-between text-xs text-status-warning">
                <span>تحصيل عند الاستلام</span>
                <span>{formatCurrency(remaining)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold pt-2 border-t border-border/30">
              <span>الإجمالي الكلي</span>
              <span className="text-primary">{formatCurrency(grandTotal)}</span>
            </div>
          </div>

          {/* Delivery (province-based) */}
          <DeliverySection subtotal={subtotal} onChange={setDelivery} />

          {/* Payment */}
          <div className="bg-card rounded-xl border border-border/40 p-4 space-y-3">
            <h3 className="font-semibold text-sm">طريقة الدفع</h3>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map(m => (
                <button
                  key={m.value}
                  onClick={() => setForm(f => ({ ...f, paymentMethod: m.value, paidAmount: isCashPaymentMethod(m.value) ? grandTotal.toString() : f.paidAmount }))}
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
                value={isCashPaymentMethod(form.paymentMethod) ? grandTotal : form.paidAmount}
                onChange={e => setForm(f => ({ ...f, paidAmount: e.target.value }))}
                readOnly={isCashPaymentMethod(form.paymentMethod)}
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
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
  invoices, total, page, onPage, from, to, onFrom, onTo, reversed, onReversed, search, onSearch, onBack, onOpen,
}: {
  invoices: SalesInvoice[]; total: number; page: number; onPage: (p: number) => void;
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
  reversed: string; onReversed: (v: string) => void;
  search: string; onSearch: (v: string) => void;
  onBack: () => void; onOpen: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [cancellingInvoice, setCancellingInvoice] = useState<SalesInvoice | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelPassword, setCancelPassword] = useState("");
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { data: currentUser } = useQuery({ queryKey: ["admin", "me", "sales-register-cancel"], queryFn: () => fetchAdminMe(), staleTime: 5 * 60 * 1000 });
  const { data: cancellationDetail, isLoading: cancellationDetailLoading } = useQuery<SalesInvoice>({
    queryKey: ["admin", "sales-invoice", "cancel-preview", cancellingInvoice?.id],
    queryFn: () => adminFetch(`/admin/sales-invoices/${cancellingInvoice?.id}`),
    enabled: !!cancellingInvoice,
  });
  const canCancel = !!currentUser && (currentUser.role === "admin" || currentUser.permissions.includes("sales_invoice.cancel"));
  async function confirmCancellation() {
    if (!cancellingInvoice || !cancelConfirmed || cancelReason.trim().length < 3 || !cancelPassword) return;
    setCancelling(true);
    try {
      await adminFetch(`/admin/sales-invoices/${cancellingInvoice.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: cancelReason.trim(), password: cancelPassword, confirmed: true }) });
      toast({ title: "تم إلغاء الفاتورة وإعادة الكميات إلى المخزون بنجاح" });
      setCancellingInvoice(null); setCancelReason(""); setCancelPassword(""); setCancelConfirmed(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "products-all"] });
    } catch (error) {
      toast({ title: "تعذر إلغاء الفاتورة", description: apiErrorMessage(error), variant: "destructive" });
    } finally { setCancelling(false); }
  }
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
        <div className="min-w-[280px] flex-1">
          <label className="text-xs text-muted-foreground mb-1 block">بحث</label>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={e => { onSearch(e.target.value); onPage(1); }}
              placeholder="ابحث برقم الفاتورة، اسم العميل، الهاتف..."
              className="w-full bg-background border border-border/40 rounded-lg py-2 ps-3 pe-9 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
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
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">الحالة المالية</label>
          <select value={reversed} onChange={e => { onReversed(e.target.value); onPage(1); }}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            <option value="">الكل</option>
            <option value="false">الفعّالة</option>
            <option value="true">المعكوسة مالياً</option>
          </select>
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
                <th className="px-4 py-3 text-right">المورد</th>
                <th className="px-4 py-3 text-center">الإجمالي</th>
                <th className="px-4 py-3 text-center">الحالة</th>
                <th className="px-4 py-3 text-center">الدفع</th>
                <th className="px-4 py-3 text-center">النوع</th>
                <th className="px-4 py-3 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {invoices.length === 0
                ? <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">لا توجد فواتير مطابقة.</td></tr>
                : invoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-muted/10">
                      <td className="px-4 py-3 font-mono text-primary font-medium">{inv.invoiceNo}{inv.financiallyReversed && <span className="mt-1 block w-fit rounded-full bg-status-warning/15 px-2 py-0.5 text-[11px] font-bold text-status-warning">تم عكس الأثر المالي</span>}</td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.date}</td>
                      <td className="px-4 py-3">{inv.customerName || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.supplierName || "—"}</td>
                      <td className="px-4 py-3 text-center font-medium">{formatCurrency(inv.total)}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {inv.status === "cancelled" ? (
                          <div className="text-xs text-status-warning">
                            <span>معكوس</span>
                            <span className="mt-1 block text-[11px] text-muted-foreground">
                              مدفوع {formatCurrency(inv.cancelledOriginalPaidAmount ?? inv.paidAmount)} · متبقي {formatCurrency(inv.cancelledOriginalRemainingAmount ?? inv.remainingAmount)}
                            </span>
                          </div>
                        ) : (
                          <PayStatusBadge status={inv.paymentStatus} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {inv.isInternal === 1
                          ? <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full">داخلية</span>
                          : <span className="text-xs bg-muted/30 text-muted-foreground px-2 py-0.5 rounded-full">عادية</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1"><Button variant="ghost" size="sm" onClick={() => onOpen(inv.id)}>
                          تفاصيل
                        </Button>{inv.status === "cancelled" ? <Button variant="ghost" size="sm" disabled>ملغاة</Button> : canCancel && inv.status === "active" ? <Button variant="destructive" size="sm" onClick={() => setCancellingInvoice(inv)}>إلغاء الفاتورة</Button> : null}</div>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
        {cancellingInvoice && <SalesInvoiceRegisterCancellationDialog invoice={cancellationDetail ?? cancellingInvoice} itemCount={cancellationDetailLoading ? null : cancellationDetail?.items?.length ?? 0} reason={cancelReason} setReason={setCancelReason} password={cancelPassword} setPassword={setCancelPassword} confirmed={cancelConfirmed} setConfirmed={setCancelConfirmed} loadingDetails={cancellationDetailLoading} busy={cancelling} onClose={() => { setCancellingInvoice(null); setCancelReason(""); setCancelPassword(""); setCancelConfirmed(false); }} onConfirm={confirmCancellation} />}
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

function SalesInvoiceRegisterCancellationDialog({ invoice, itemCount, reason, setReason, password, setPassword, confirmed, setConfirmed, loadingDetails, busy, onClose, onConfirm }: { invoice: SalesInvoice; itemCount: number | null; reason: string; setReason: (value: string) => void; password: string; setPassword: (value: string) => void; confirmed: boolean; setConfirmed: (value: boolean) => void; loadingDetails: boolean; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" dir="rtl"><div className="w-full max-w-lg rounded-xl border border-destructive/40 bg-card p-5 shadow-xl"><h3 className="text-lg font-bold text-destructive">إلغاء الفاتورة</h3><div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-xs"><span>الفاتورة: {invoice.invoiceNo}</span><span>العميل: {invoice.customerName || "—"}</span><span>المورد: {invoice.supplierName || "—"}</span><span>البنود: {itemCount ?? "جارٍ التحميل..."}</span><span>الإجمالي: {formatCurrency(invoice.total)}</span><span>المدفوع: {formatCurrency(invoice.paidAmount)}</span><span>المتبقي: {formatCurrency(invoice.remainingAmount)}</span><span>الدفع: {invoice.paymentMethod}</span></div><p className="mt-3 text-sm text-destructive">سيتم إرجاع المواد إلى المخزون وعكس المبلغ المالي.</p><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="سبب الإلغاء *" className="mt-4 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="كلمة المرور للتأكيد *" className="mt-3 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><label className="mt-4 flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>أؤكد إلغاء الفاتورة وإرجاع المواد إلى المخزون وعكس المبلغ المالي</span></label><div className="mt-5 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>رجوع</Button><Button variant="destructive" disabled={busy || loadingDetails || !confirmed || reason.trim().length < 3 || !password} onClick={onConfirm}>{busy ? "جارٍ الإلغاء..." : "تأكيد إلغاء الفاتورة"}</Button></div></div></div>;
}

function toNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function SalesInvoiceDetailModal({ invoiceId, onClose }: { invoiceId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelPassword, setCancelPassword] = useState("");
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [draft, setDraft] = useState({
    date: "",
    customerName: "",
    customerPhone: "",
    supplierId: "",
    supplierName: "",
    discountAmount: "0",
    taxAmount: "0",
    paidAmount: "0",
    paymentMethod: "cash",
    notes: "",
    isInternal: false,
  });
  const [items, setItems] = useState<CartItem[]>([]);
  const { data: settings } = usePublicSettings();
  const { data: currentUser } = useQuery({ queryKey: ["admin", "me", "sales-cancel"], queryFn: () => fetchAdminMe(), staleTime: 5 * 60 * 1000 });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["admin", "suppliers", "sales"],
    queryFn: () => adminFetch("/admin/suppliers"),
    staleTime: 5 * 60 * 1000,
  });

  const { data: invoice, isLoading, error } = useQuery<SalesInvoice>({
    queryKey: ["admin", "sales-invoice", invoiceId],
    queryFn: () => adminFetch(`/admin/sales-invoices/${invoiceId}`),
    enabled: invoiceId > 0,
  });

  useEffect(() => {
    if (!invoice) return;
    setDraft({
      date: invoice.date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      customerName: invoice.customerName || "",
      customerPhone: invoice.customerPhone || "",
      supplierId: invoice.supplierId ? String(invoice.supplierId) : "",
      supplierName: invoice.supplierName || "",
      discountAmount: String(invoice.discountAmount ?? "0"),
      taxAmount: String(invoice.taxAmount ?? "0"),
      paidAmount: String(
        invoice.status === "cancelled"
          ? (invoice.cancelledOriginalPaidAmount ?? invoice.paidAmount ?? "0")
          : (invoice.paidAmount ?? "0"),
      ),
      paymentMethod: invoice.paymentMethod || "cash",
      notes: invoice.notes || "",
      isInternal: Number(invoice.isInternal) === 1,
    });
    setItems((invoice.items ?? []).map((item: any) => {
      const quantity = toNumber(item.quantity);
      const unitPrice = toNumber(item.unitPrice);
      const discount = toNumber(item.discount);
      return {
        productId: Number(item.productId ?? 0),
        productName: item.productName ?? "",
        barcode: item.barcode ?? "",
        quantity,
        unitPrice,
        discount,
        discountPct: toNumber(item.discountPct),
        total: toNumber(item.total) || Math.max(quantity * unitPrice - discount, 0),
        costPrice: toNumber(item.costPrice),
      };
    }));
  }, [invoice]);

  function updateDraft(key: keyof typeof draft, value: string | boolean) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateDetailItem(idx: number, field: keyof CartItem, raw: string) {
    setItems((current) => {
      const next = [...current];
      const item = { ...next[idx] } as any;
      if (field === "productName" || field === "barcode") {
        item[field] = raw;
      } else {
        item[field] = Number.parseFloat(raw) || 0;
      }
      if (field === "discountPct") {
        item.discount = +(item.unitPrice * item.quantity * item.discountPct / 100).toFixed(2);
      } else if (field === "discount") {
        const gross = item.unitPrice * item.quantity;
        item.discountPct = gross > 0 ? +(item.discount / gross * 100).toFixed(2) : 0;
      }
      item.total = +(item.quantity * item.unitPrice - item.discount).toFixed(2);
      next[idx] = item;
      return next;
    });
  }

  function addDetailItem() {
    setItems((current) => [...current, {
      productId: 0,
      productName: "",
      barcode: "",
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      discountPct: 0,
      total: 0,
      costPrice: 0,
    }]);
  }

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discountAmount = toNumber(draft.discountAmount);
  const taxAmount = toNumber(draft.taxAmount);
  const total = Math.max(subtotal - discountAmount + taxAmount, 0);
  const paidAmount = isCashPaymentMethod(draft.paymentMethod) ? total : toNumber(draft.paidAmount);
  const remainingAmount = Math.max(total - paidAmount, 0);
  const paymentStatus = paidAmount >= total ? "paid" : paidAmount > 0 ? "partial" : "unpaid";

  async function saveChanges() {
    const validItems = items.filter((item) => item.productName.trim() && item.quantity > 0);
    if (validItems.length === 0) {
      toast({ title: "الفاتورة فارغة", description: "أضف منتجاً واحداً على الأقل.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await adminFetch(`/admin/sales-invoices/${invoiceId}`, {
        method: "PUT",
        body: JSON.stringify({
          date: draft.date,
          customerName: draft.customerName,
          customerPhone: draft.customerPhone,
          supplierId: draft.supplierId || null,
          supplierName: draft.supplierName || null,
          subtotal,
          discountAmount,
          taxAmount,
          total,
          paidAmount,
          remainingAmount,
          paymentMethod: draft.paymentMethod,
          paymentStatus,
          isInternal: draft.isInternal ? 1 : 0,
          notes: draft.notes,
          items: validItems.map((item) => ({
            productId: item.productId > 0 ? item.productId : null,
            productName: item.productName,
            barcode: item.barcode,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            discountPct: item.discountPct,
            total: item.total,
            costPrice: item.costPrice,
          })),
        }),
      });
      toast({ title: "تم حفظ تعديل الفاتورة", description: invoice?.invoiceNo ?? "" });
      queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoice", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "products-all"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "inventory-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "inventory-alert-count"] });
    } catch (e: any) {
      toast({ title: "تعذر حفظ الفاتورة", description: e?.message ?? "حدث خطأ غير متوقع", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const canCancel = !!currentUser && (currentUser.role === "admin" || currentUser.permissions.includes("sales_invoice.cancel"));

  async function cancelInvoice() {
    if (!invoice || !cancelConfirmed || cancelReason.trim().length < 3 || !cancelPassword) return;
    setCancelling(true);
    try {
      await adminFetch(`/admin/sales-invoices/${invoice.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: cancelReason.trim(), password: cancelPassword, confirmed: true }),
      });
      toast({ title: "تم إلغاء الفاتورة وإعادة الكميات إلى المخزون بنجاح" });
      setCancelOpen(false);
      setCancelPassword("");
      queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoice", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "products-all"] });
    } catch (error) {
      toast({ title: "تعذر إلغاء الفاتورة", description: apiErrorMessage(error), variant: "destructive" });
    } finally {
      setCancelling(false);
    }
  }

  function printQr() {
    try {
      openQrPrintWindow({
        qrDataUrl: invoice?.qr?.dataUrl,
        customerName: draft.customerName || invoice?.customerName,
        amount: total || invoice?.total,
        title: "QR الفاتورة",
        paperSize: "80mm",
      });
    } catch (e: any) {
      toast({ title: "تعذر طباعة QR", description: e?.message ?? "لم يتم توليد QR", variant: "destructive" });
    }
  }

  function downloadQr() {
    try {
      downloadDataUrl(invoice?.qr?.dataUrl, `qr-${invoice?.invoiceNo ?? invoiceId}.png`);
    } catch (e: any) {
      toast({ title: "تعذر تحميل QR", description: e?.message ?? "لم يتم توليد QR", variant: "destructive" });
    }
  }

  function printInvoice() {
    if (!invoice) return;
    const cancelled = invoice.status === "cancelled";
    const popup = window.open("", "_blank", "width=520,height=760");
    if (!popup) {
      toast({ title: "تعذر فتح نافذة الطباعة", variant: "destructive" });
      return;
    }
    const itemRows = items.map((item) => `
      <tr><td class="name">${item.productName}</td><td class="num">${item.quantity}</td><td class="num">${formatCurrency(item.unitPrice)}</td><td class="num">${formatCurrency(item.total)}</td></tr>
    `).join("");
    popup.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${invoice.invoiceNo}</title><style>${thermalReceiptCss("80mm")}</style></head><body>
      <div class="receipt">
        <div class="r-head"><img class="r-logo" src="${logoSrc(settings)}" alt=""><div class="r-company">${settings?.site_name ?? "مجموعة علي جان نهاد"}</div><div class="r-sub">${cancelled ? "فاتورة ملغاة" : "فاتورة مبيعات"}</div><div class="r-sub num">${invoice.invoiceNo} · ${draft.date}</div></div>
        <hr class="rule"><div class="kv"><span>العميل</span><span class="v">${draft.customerName || "زبون"}</span></div>
        <div class="kv"><span>الهاتف</span><span class="v num">${formatIraqiPhone(draft.customerPhone) || "غير مسجل"}</span></div>
        ${draft.supplierName ? `<div class="kv"><span>المورد</span><span class="v">${draft.supplierName}</span></div>` : ""}${cancelled ? `<div class="kv"><span>حالة الإلغاء</span><span class="v">ملغاة</span></div><div class="kv"><span>تاريخ الإلغاء</span><span class="v num">${invoice.cancelledAt ?? "—"}</span></div><div class="kv"><span>بواسطة</span><span class="v">${invoice.cancelledByName ?? "—"}</span></div><div class="kv"><span>السبب</span><span class="v">${invoice.cancellationReason ?? "—"}</span></div>` : ""}
        <hr class="rule dashed"><table class="items"><thead><tr><th class="name">الصنف</th><th>الكمية</th><th>السعر</th><th>المبلغ</th></tr></thead><tbody>${itemRows}</tbody></table>
        <div class="totals"><div class="payline"><span>الخصم</span><span class="num">${formatCurrency(discountAmount)}</span></div><div class="grand"><span>الإجمالي</span><span class="num">${formatCurrency(total)}</span></div><div class="payline"><span>المدفوع</span><span class="num">${formatCurrency(paidAmount)}</span></div><div class="payline remain"><span>المتبقي</span><span class="num">${formatCurrency(remainingAmount)}</span></div></div>
        ${invoice.qr?.dataUrl ? `<div class="qr"><img src="${invoice.qr.dataUrl}" alt="QR"><div class="cap num">${invoice.invoiceNo}</div></div>` : ""}<div class="thanks">شكراً لاختياركم مجموعة علي جان نهاد</div>
      </div>${printWhenImagesReadyScript()}</body></html>`);
    popup.document.close();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div className="bg-card border border-border/40 rounded-xl w-full max-w-6xl max-h-[92dvh] overflow-hidden shadow-xl">
        {cancelOpen && invoice && <SalesInvoiceCancellationDialog invoice={invoice} itemCount={items.length} reason={cancelReason} setReason={setCancelReason} password={cancelPassword} setPassword={setCancelPassword} confirmed={cancelConfirmed} setConfirmed={setCancelConfirmed} busy={cancelling} onClose={() => setCancelOpen(false)} onConfirm={cancelInvoice} />}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/30">
          <div>
            <h2 className="text-lg font-bold text-foreground">تفاصيل الفاتورة</h2>
            <p className="text-xs text-muted-foreground">{invoice?.invoiceNo ?? "جاري التحميل..."}</p>
            {invoice?.financiallyReversed && <span className="mt-1 inline-block rounded-full bg-status-warning/15 px-2 py-0.5 text-[11px] font-bold text-status-warning">تم عكس الأثر المالي</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={printInvoice} disabled={!invoice}>
              <Printer className="w-4 h-4 ml-1" />
              طباعة / PDF
            </Button>
            <Button variant="outline" size="sm" onClick={printQr} disabled={!invoice?.qr?.dataUrl}>
              <QrCode className="w-4 h-4 ml-1" />
              طباعة QR
            </Button>
            <Button variant="outline" size="sm" onClick={downloadQr} disabled={!invoice?.qr?.dataUrl}>
              <Download className="w-4 h-4 ml-1" />
              تحميل QR
            </Button>
            {canCancel && invoice?.status === "active" && !invoice?.financiallyReversed && (
              <Button variant="destructive" size="sm" onClick={() => setCancelOpen(true)}>
                <Ban className="w-4 h-4 ml-1" />
                إلغاء ومسح الفاتورة
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="py-20 text-center text-muted-foreground">جاري تحميل تفاصيل الفاتورة...</div>
        ) : error || !invoice ? (
          <div className="py-20 text-center text-muted-foreground">تعذر تحميل الفاتورة</div>
        ) : (
          <div className="overflow-y-auto max-h-[calc(92vh-76px)] p-5 space-y-4">
            {invoice.financiallyReversed && (
              <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm font-semibold text-status-warning">
                هذه الفاتورة تم عكس أثرها المالي ولا تدخل ضمن الإيرادات الصافية — للعرض والتدقيق فقط (لا يمكن تعديلها أو إضافة دفعات أو تحصيل).
              </div>
            )}
            <AccountSummaryCard
              sourceType="sales_invoice"
              sourceId={invoice.id}
              total={toNumber(invoice.total)}
              discount={toNumber(invoice.discountAmount) + toNumber((invoice as any).couponDiscountAmount)}
              paid={toNumber(invoice.status === "cancelled" ? invoice.cancelledOriginalPaidAmount : invoice.paidAmount)}
              remaining={toNumber(invoice.status === "cancelled" ? invoice.cancelledOriginalRemainingAmount : invoice.remainingAmount)}
              paymentStatus={
                invoice.status === "cancelled"
                  ? toNumber(invoice.cancelledOriginalRemainingAmount) <= 0
                    ? "paid"
                    : toNumber(invoice.cancelledOriginalPaidAmount) > 0
                      ? "partial"
                      : "unpaid"
                  : invoice.paymentStatus
              }
              lastPayment={invoice.lastPayment ?? null}
              onCollected={() => {
                queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoice", invoiceId] });
                queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoices"] });
              }}
            />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-background/40 rounded-xl border border-border/30 p-4 space-y-3">
                <h3 className="font-semibold text-sm">بيانات العميل</h3>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">التاريخ</label>
                  <input
                    type="date"
                    value={draft.date}
                    onChange={(e) => updateDraft("date", e.target.value)}
                    className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">اسم العميل</label>
                  <CustomerLookup
                    value={draft.customerName}
                    onValueChange={(value) =>
                      updateDraft("customerName", value)
                    }
                    onSelect={(customer) =>
                      setDraft((current) => ({
                        ...current,
                        customerName: customer.name,
                        customerPhone: formatIraqiPhoneInput(customer.phone),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">رقم الهاتف</label>
                  <input
                    value={draft.customerPhone}
                    onChange={(e) => updateDraft("customerPhone", e.target.value)}
                    className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">المورد</label>
                  <select
                    value={draft.supplierId}
                    onChange={(event) => {
                      const supplier = suppliers.find((row) => String(row.id) === event.target.value);
                      setDraft((current) => ({ ...current, supplierId: event.target.value, supplierName: supplier?.name ?? "" }));
                    }}
                    className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">بدون مورد</option>
                    {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="bg-background/40 rounded-xl border border-border/30 p-4 space-y-3">
                <h3 className="font-semibold text-sm">الدفع</h3>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHODS.map((method) => (
                    <button
                      type="button"
                      key={method.value}
                      onClick={() => setDraft((current) => ({ ...current, paymentMethod: method.value, paidAmount: isCashPaymentMethod(method.value) ? String(total) : current.paidAmount }))}
                      className={`rounded-lg py-2 text-sm font-medium border transition-colors ${
                        draft.paymentMethod === method.value
                          ? "bg-primary text-black border-primary"
                          : "border-border/40 text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {method.label}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">المدفوع</label>
                  <input
                    type="number"
                    min="0"
                    value={isCashPaymentMethod(draft.paymentMethod) ? total : draft.paidAmount}
                    onChange={(e) => updateDraft("paidAmount", e.target.value)}
                    readOnly={isCashPaymentMethod(draft.paymentMethod)}
                    className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    dir="ltr"
                  />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">حالة الدفع</span>
                  <PayStatusBadge status={paymentStatus} />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    checked={draft.isInternal}
                    onChange={(e) => updateDraft("isInternal", e.target.checked)}
                    className="accent-primary"
                  />
                  <span className="text-xs text-muted-foreground">فاتورة داخلية بدون تتبع</span>
                </div>
              </div>

              <div className="bg-background/40 rounded-xl border border-border/30 p-4 space-y-2">
                <h3 className="font-semibold text-sm mb-2">الإجماليات</h3>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">المجموع</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">إجمالي الخصم</span>
                  <input
                    type="number"
                    min="0"
                    value={draft.discountAmount}
                    onChange={(e) => updateDraft("discountAmount", e.target.value)}
                    className="bg-background border border-border/30 rounded px-2 py-1 text-sm w-28 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    dir="ltr"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">الضريبة</span>
                  <input
                    type="number"
                    min="0"
                    value={draft.taxAmount}
                    onChange={(e) => updateDraft("taxAmount", e.target.value)}
                    className="bg-background border border-border/30 rounded px-2 py-1 text-sm w-28 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    dir="ltr"
                  />
                </div>
                <div className="flex justify-between font-bold border-t border-border/30 pt-2">
                  <span>الإجمالي</span>
                  <span className="text-primary">{formatCurrency(total)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">المتبقي</span>
                  <span>{formatCurrency(remainingAmount)}</span>
                </div>
              </div>
            </div>

            <div className="bg-background/40 rounded-xl border border-border/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
                <span className="font-semibold text-sm">منتجات الفاتورة</span>
                <Button variant="ghost" size="sm" onClick={addDetailItem}>
                  <Plus className="w-4 h-4 ml-1" />
                  إضافة منتج
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 text-muted-foreground text-xs">
                      <th className="px-3 py-2 text-right">المنتج</th>
                      <th className="px-3 py-2 text-center">الكمية</th>
                      <th className="px-3 py-2 text-center">السعر</th>
                      <th className="px-3 py-2 text-center">خصم</th>
                      <th className="px-3 py-2 text-center">الإجمالي</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-muted/10">
                        <td className="px-3 py-2 min-w-[180px]">
                          <input
                            value={item.productName}
                            onChange={(e) => updateDetailItem(idx, "productName", e.target.value)}
                            className="bg-transparent w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={item.quantity}
                            onChange={(e) => updateDetailItem(idx, "quantity", e.target.value)}
                            className="bg-background border border-border/30 rounded text-center w-20 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            value={item.unitPrice}
                            onChange={(e) => updateDetailItem(idx, "unitPrice", e.target.value)}
                            className="bg-background border border-border/30 rounded text-center w-24 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            value={item.discount}
                            onChange={(e) => updateDetailItem(idx, "discount", e.target.value)}
                            className="bg-background border border-border/30 rounded text-center w-24 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2 text-center font-medium text-primary">{formatCurrency(item.total)}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== idx))}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-background/40 rounded-xl border border-border/30 p-4">
              <label className="text-xs text-muted-foreground mb-1 block">ملاحظات</label>
              <textarea
                value={draft.notes}
                onChange={(e) => updateDraft("notes", e.target.value)}
                rows={3}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" onClick={onClose}>إلغاء</Button>
              <Button onClick={saveChanges} disabled={saving || !!invoice?.financiallyReversed} title={invoice?.financiallyReversed ? "الفاتورة معكوسة مالياً — للعرض فقط" : undefined} className="bg-primary text-black hover:bg-primary/90 font-bold">
                {saving ? <><RefreshCw className="w-4 h-4 ml-2 animate-spin" />جاري الحفظ...</> : <><Save className="w-4 h-4 ml-2" />حفظ التعديل</>}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SalesInvoiceCancellationDialog({ invoice, itemCount, reason, setReason, password, setPassword, confirmed, setConfirmed, busy, onClose, onConfirm }: { invoice: SalesInvoice; itemCount: number; reason: string; setReason: (v: string) => void; password: string; setPassword: (v: string) => void; confirmed: boolean; setConfirmed: (v: boolean) => void; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" dir="rtl"><div className="w-full max-w-lg rounded-xl border border-destructive/40 bg-card p-5 shadow-2xl"><h3 className="text-lg font-bold text-destructive">إلغاء ومسح الفاتورة</h3><p className="mt-2 text-sm text-muted-foreground">{invoice.invoiceNo} · {invoice.customerName} · {invoice.date} · {formatCurrency(invoice.total)}</p><div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-xs"><span>المدفوع: {formatCurrency(invoice.paidAmount)}</span><span>الدفع: {invoice.paymentMethod}</span><span>البنود: {itemCount}</span><span>المتبقي: {formatCurrency(invoice.remainingAmount)}</span></div><p className="mt-3 text-sm font-medium text-destructive">سيتم إرجاع المواد إلى المخزون وعكس الحركات المالية المرتبطة. لا يمكن التراجع عن الإلغاء.</p><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الإلغاء *" rows={3} className="mt-4 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة المرور للتأكيد *" className="mt-3 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><label className="mt-4 flex items-start gap-2 text-xs text-foreground"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" /><span>أؤكد إلغاء الفاتورة وإرجاع المواد إلى المخزون وعكس المبلغ من الصندوق الرئيسي</span></label><div className="mt-5 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>إغلاق</Button><Button variant="destructive" disabled={busy || !confirmed || reason.trim().length < 3 || !password} onClick={onConfirm}>{busy ? "جارٍ الإلغاء..." : "تأكيد إلغاء الفاتورة"}</Button></div></div></div>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; class: string }> = {
    active:  { label: "نشطة",   class: "bg-status-success/10 text-status-success" },
    cancelled: { label: "ملغاة", class: "bg-status-danger/10 text-status-danger" },
    deleted: { label: "محذوفة", class: "bg-status-danger/10 text-status-danger" },
    held:    { label: "معلقة",  class: "bg-status-warning/10 text-status-warning" },
  };
  const s = map[status] ?? { label: status, class: "bg-muted/30 text-muted-foreground" };
  return <span className={`text-xs px-2 py-0.5 rounded-full ${s.class}`}>{s.label}</span>;
}

function PayStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; icon: any; class: string }> = {
    paid:    { label: "مدفوع",     icon: CheckCircle2, class: "text-status-success" },
    partial: { label: "جزئي",      icon: Clock,        class: "text-status-warning" },
    unpaid:  { label: "غير مدفوع", icon: AlertCircle,  class: "text-status-danger" },
  };
  const s = map[status] ?? { label: status, icon: null, class: "text-muted-foreground" };
  const Icon = s.icon;
  return (
    <span className={`text-xs flex items-center justify-center gap-1 ${s.class}`}>
      {Icon && <Icon className="w-3 h-3" />}{s.label}
    </span>
  );
}
