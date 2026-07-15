import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search, Trash2, Plus, Minus, Printer, Save, RefreshCw,
  PauseCircle, PlayCircle, X, ChevronLeft, ChevronRight,
  FileText, Delete, User, Barcode, Tag, ShoppingCart,
  CheckCircle2, AlertCircle, Clock, Grid3X3, List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { isCashPaymentMethod } from "@/lib/payment-settlement";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, formatCurrency } from "./_lib";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { printWhenImagesReadyScript, thermalBaseCss, thermalReceiptCss } from "./print-helpers";
import { formatMoney } from "@/lib/money";

// ─── Types ────────────────────────────────────────────────────────────────────

type Product = {
  id: number; name: string; nameAr: string; price: string; costPrice?: string;
  stock: string; barcode?: string; images?: string[];
  categoryId?: number | null; subcategoryId?: number | null; subcategoryIds?: number[];
  category?: string | null; subcategory?: string | null;
  categoryName?: string; subcategoryName?: string;
};

type Category = { id: number; name: string; nameAr: string; slug?: string; parentId?: number | null };

type CartItem = {
  productId: number; productName: string; barcode: string;
  quantity: number; unitPrice: number; discount: number; discountPct: number;
  total: number; costPrice: number; stock: number;
};

type HeldInvoice = {
  id: string; customerName: string; customerPhone: string;
  items: CartItem[]; createdAt: string; grandTotal: number;
};

type Customer = {
  id: number; name: string; phone?: string; email?: string;
  totalInvoices?: number; totalDebt?: number;
};

type PrintSize = "80mm" | "58mm" | "a4" | "pdf";
type PrinterSettings = {
  defaultPaperSize: "80mm" | "58mm" | "a4";
  autoPrint: boolean;
  copies: number;
  showLogo: boolean;
};
type Totals = { subtotal: number; discount: number; tax: number; grand: number; paid: number; remaining: number };

// ─── Constants ────────────────────────────────────────────────────────────────

const PAYMENT_METHODS = [
  { value: "cash",     label: "نقداً",    shortcut: "F5" },
  { value: "card",     label: "بطاقة",    shortcut: "F6" },
  { value: "transfer", label: "تحويل",   shortcut: "F7" },
  { value: "credit",   label: "آجل",     shortcut: "F8" },
];

function newForm() {
  return {
    customerName: "", customerPhone: "", customerAddress: "", notes: "",
    paymentMethod: "cash", paidAmount: "", taxPct: "0", discountAmount: "0",
    couponCode: "", couponDiscountAmount: "0",
    date: new Date().toISOString().slice(0, 10),
  };
}

// ─── NumPad Component ─────────────────────────────────────────────────────────

function NumPad({
  value, onChange, onClose, label,
}: { value: string; onChange: (v: string) => void; onClose: () => void; label?: string }) {
  function press(k: string) {
    if (k === "C") { onChange(""); return; }
    if (k === "⌫") { onChange(value.slice(0, -1)); return; }
    if (k === "." && value.includes(".")) return;
    if (k === "." && value === "") { onChange("0."); return; }
    onChange(value + k);
  }

  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "C", "0", "⌫"];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="bg-card border border-border/40 rounded-2xl w-full max-w-xs shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Display */}
        <div className="bg-background px-5 py-4 border-b border-border/30">
          {label && <p className="text-xs text-muted-foreground mb-1">{label}</p>}
          <div className="text-3xl font-mono font-bold text-foreground text-left tracking-wider min-h-[44px]">
            {value || "0"}
          </div>
        </div>
        {/* Keys */}
        <div className="grid grid-cols-3 gap-1.5 p-3">
          {keys.map(k => (
            <button
              key={k}
              onClick={() => press(k)}
              className={`h-14 rounded-xl text-xl font-bold transition-all active:scale-95 ${
                k === "C" ? "bg-status-danger/20 text-status-danger hover:bg-status-danger/30"
                : k === "⌫" ? "bg-status-warning/20 text-status-warning hover:bg-status-warning/30"
                : "bg-muted/60 text-foreground hover:bg-primary/20 hover:text-primary"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
          <button
            onClick={() => press(".")}
            className="h-12 rounded-xl text-lg font-bold bg-muted/60 text-foreground hover:bg-primary/20 hover:text-primary transition-all active:scale-95"
          >
            .
          </button>
          <button
            onClick={onClose}
            className="h-12 rounded-xl text-sm font-bold bg-primary text-black hover:bg-primary/90 transition-all active:scale-95"
          >
            تأكيد ✓
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Customer Panel ───────────────────────────────────────────────────────────

function CustomerPanel({
  name, phone, onName, onPhone,
  customers, onSelectCustomer, customerStats,
}: {
  name: string; phone: string;
  onName: (v: string) => void; onPhone: (v: string) => void;
  customers: Customer[];
  onSelectCustomer: (c: Customer) => void;
  customerStats: { invoices: number; debt: number } | null;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const filtered = name.trim().length >= 2
    ? customers.filter(c => c.name.toLowerCase().includes(name.toLowerCase()) || c.phone?.includes(name)).slice(0, 6)
    : [];

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <User className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={name}
            onChange={e => { onName(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            placeholder="اسم العميل (اختياري)"
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 pr-8 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {showDropdown && filtered.length > 0 && (
            <div className="absolute top-full right-0 left-0 z-30 mt-1 bg-card border border-border/30 rounded-lg shadow-xl overflow-hidden">
              {filtered.map(c => (
                <button
                  key={c.id}
                  onMouseDown={() => { onSelectCustomer(c); setShowDropdown(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-primary/10 text-sm text-right"
                >
                  <div>
                    <p className="font-medium text-foreground">{c.name}</p>
                    {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                  </div>
                  {(c.totalDebt ?? 0) > 0 && (
                    <span className="text-xs text-status-danger">{formatCurrency(c.totalDebt ?? 0)} دين</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          value={phone}
          onChange={e => onPhone(e.target.value)}
          placeholder="07XX..."
          dir="ltr"
          className="w-32 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      {customerStats && (
        <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{customerStats.invoices} فاتورة</span>
          {customerStats.debt > 0 && (
            <span className="flex items-center gap-1 text-status-danger"><AlertCircle className="w-3 h-3" />دين: {formatCurrency(customerStats.debt)}</span>
          )}
          {customerStats.debt <= 0 && customerStats.invoices > 0 && (
            <span className="flex items-center gap-1 text-status-success"><CheckCircle2 className="w-3 h-3" />حساب نظيف</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Product Card ──────────────────────────────────────────────────────────────

function ProductCard({ product, onAdd }: { product: Product; onAdd: (p: Product) => void }) {
  const stock = parseFloat(product.stock) || 0;
  const outOfStock = stock <= 0;
  const img = product.images?.[0];

  return (
    <button
      onClick={() => !outOfStock && onAdd(product)}
      disabled={outOfStock}
      className={`group relative flex flex-col bg-card border rounded-xl overflow-hidden text-right transition-all active:scale-95 ${
        outOfStock ? "opacity-50 cursor-not-allowed border-border/20" : "border-border/30 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10"
      }`}
    >
      {/* Image */}
      <div className="w-full aspect-square bg-muted/30 flex items-center justify-center overflow-hidden">
        {img
          ? <img src={img} alt={product.nameAr || product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
          : <ShoppingCart className="w-8 h-8 text-muted-foreground/40" />
        }
      </div>
      {/* Info */}
      <div className="p-2 flex-1 space-y-0.5">
        <p className="text-xs font-semibold text-foreground line-clamp-2 leading-tight">{product.nameAr || product.name}</p>
        <p className="text-sm font-bold text-primary">{formatCurrency(product.price)}</p>
        <p className={`text-[11px] ${stock < 5 ? "text-status-warning" : "text-muted-foreground"}`}>
          {outOfStock ? "نفذ المخزون" : `${stock} متبقي`}
        </p>
      </div>
      {!outOfStock && (
        <div className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-primary/90 text-black flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Plus className="w-4 h-4" />
        </div>
      )}
    </button>
  );
}

// ─── Print Receipt Helper ─────────────────────────────────────────────────────

function openPrintWindow(
  cart: CartItem[],
  form: ReturnType<typeof newForm>,
  totals: Totals,
  invoiceNo: string,
  size: PrintSize,
  settings: any,
  options: { showLogo?: boolean; qrDataUrl?: string } = {},
) {
  const logo = options.showLogo === false ? "" : logoSrc(settings);
  const companyName = settings?.site_name ?? "مجموعة علي جان";
  const companyPhone = settings?.phones?.[0] ?? "";
  const companyAddress = settings?.address ?? "";
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]));

  let html: string;

  // ─── Dedicated thermal receipt (58mm / 80mm) — not a scaled A4 sheet ───
  if (size === "58mm" || size === "80mm") {
    const itemHead = size === "58mm"
      ? `<tr><th class="name">الصنف</th><th>المبلغ</th></tr>`
      : `<tr><th class="name">الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>`;
    const itemRows = cart.map((i) => size === "58mm"
      ? `<tr><td class="name" colspan="2">${esc(i.productName)}</td></tr><tr class="ln2"><td class="num">${formatMoney(i.quantity)} × ${formatMoney(i.unitPrice)}</td><td class="num" style="text-align:left">${formatMoney(i.total)}</td></tr>`
      : `<tr><td class="name">${esc(i.productName)}</td><td class="num center">${formatMoney(i.quantity)}</td><td class="num center">${formatMoney(i.unitPrice)}</td><td class="num" style="text-align:left">${formatMoney(i.total)}</td></tr>`
    ).join("");

    html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>فاتورة ${esc(invoiceNo)}</title>
    <style>${thermalReceiptCss(size)}</style></head><body>
    <div class="receipt">
      <div class="r-head">
        ${logo ? `<img src="${logo}" class="r-logo" alt="" />` : ""}
        <div class="r-company">${esc(companyName)}</div>
        ${companyAddress ? `<div class="r-sub">${esc(companyAddress)}</div>` : ""}
        ${companyPhone ? `<div class="r-sub num">${esc(companyPhone)}</div>` : ""}
      </div>
      <hr class="rule" />
      <div class="kv"><span>رقم الفاتورة</span><span class="v big num">${esc(invoiceNo)}</span></div>
      <div class="kv"><span>التاريخ</span><span class="v num">${esc(form.date)}</span></div>
      ${form.customerName ? `<div class="kv"><span>العميل</span><span class="v">${esc(form.customerName)}</span></div>` : ""}
      ${form.customerPhone ? `<div class="kv"><span>الهاتف</span><span class="v num">${esc(form.customerPhone)}</span></div>` : ""}
      <hr class="rule" />
      <table class="items"><thead>${itemHead}</thead><tbody>${itemRows}</tbody></table>
      <hr class="rule" />
      <div class="totals">
        <div class="row"><span>المجموع الفرعي</span><span class="num">${formatCurrency(totals.subtotal)}</span></div>
        ${totals.discount > 0 ? `<div class="row"><span>الخصم</span><span class="num">- ${formatCurrency(totals.discount)}</span></div>` : ""}
        ${totals.tax > 0 ? `<div class="row"><span>الضريبة</span><span class="num">${formatCurrency(totals.tax)}</span></div>` : ""}
        <div class="grand"><span>الإجمالي</span><span class="num">${formatCurrency(totals.grand)}</span></div>
        <div class="payline"><span>المدفوع</span><span class="num">${formatCurrency(totals.paid)}</span></div>
        <div class="payline remain"><span>المتبقي</span><span class="num">${formatCurrency(totals.remaining)}</span></div>
      </div>
      ${form.notes ? `<hr class="rule dashed" /><div class="kv"><span>ملاحظات</span><span class="v">${esc(form.notes)}</span></div>` : ""}
      ${options.qrDataUrl ? `<div class="qr"><img src="${options.qrDataUrl}" alt="QR" /><div class="cap">امسح الرمز لعرض الفاتورة</div></div>` : ""}
      <div class="thanks">شكراً لتعاملكم معنا</div>
    </div>
    ${printWhenImagesReadyScript()}
    </body></html>`;

    const w = window.open("", "_blank", "width=420,height=720");
    if (w) { w.document.write(html); w.document.close(); }
    return;
  }

  // ─── A4 / PDF sheet (unchanged) ───
  const rows = cart.map(i =>
    `<tr><td>${esc(i.productName)}</td><td style="text-align:center">${formatMoney(i.quantity)}</td><td style="text-align:center">${formatMoney(i.unitPrice)}</td><td style="text-align:center">${i.discount > 0 ? formatMoney(i.discount) : "—"}</td><td style="text-align:left">${formatMoney(i.total)}</td></tr>`
  ).join("");
  const tableHeader = `<tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>خصم</th><th>الإجمالي</th></tr>`;

  html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8">
  <style>
    ${thermalBaseCss(size, "12px")}
    @page { size: A4; margin: 12mm; }
    body { font-size: 12px; }
    .header { text-align: center; margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px dashed #000; }
    .logo { height: 40px; object-fit: contain; margin-bottom: 4px; }
    .company-name { font-size: 1.2em; font-weight: 700; }
    .meta { font-size: 0.9em; color: #000 !important; }
    .divider { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #fff !important; padding: 3px 4px; text-align: right; font-weight: 700; border: 1px solid #000 !important; }
    td { padding: 3px 4px; border-bottom: 1px dotted #000 !important; }
    .totals { margin-top: 6px; }
    .totals tr td:first-child { font-weight: 600; }
    .totals tr td:last-child { text-align: left; }
    .grand { font-size: 1.15em; font-weight: 700; }
    .footer { text-align: center; margin-top: 8px; padding-top: 6px; border-top: 1px dashed #000; font-size: 0.85em; color: #000 !important; }
    .qr { text-align: center; margin-top: 8px; }
    .qr img.qr-code { width: 120px !important; height: 120px !important; object-fit: contain; image-rendering: pixelated; }
  </style></head><body>
  <div class="header">
    ${logo ? `<img src="${logo}" class="logo" />` : ""}
    <div class="company-name">${esc(companyName)}</div>
    ${companyAddress ? `<div class="meta">${esc(companyAddress)}</div>` : ""}
    ${companyPhone ? `<div class="meta">${esc(companyPhone)}</div>` : ""}
  </div>
  <div class="meta">رقم الفاتورة: <strong>${esc(invoiceNo)}</strong></div>
  <div class="meta">التاريخ: ${esc(form.date)}</div>
  ${form.customerName ? `<div class="meta">العميل: ${esc(form.customerName)}</div>` : ""}
  ${form.customerPhone ? `<div class="meta">الهاتف: ${esc(form.customerPhone)}</div>` : ""}
  <hr class="divider" />
  <table><thead>${tableHeader}</thead><tbody>${rows}</tbody></table>
  <hr class="divider" />
  <table class="totals">
    <tr><td>المجموع الفرعي</td><td>${formatCurrency(totals.subtotal)}</td></tr>
    ${totals.discount > 0 ? `<tr><td>الخصم</td><td>- ${formatCurrency(totals.discount)}</td></tr>` : ""}
    ${totals.tax > 0 ? `<tr><td>الضريبة</td><td>${formatCurrency(totals.tax)}</td></tr>` : ""}
    <tr class="grand"><td>الإجمالي الكلي</td><td>${formatCurrency(totals.grand)}</td></tr>
    <tr><td>المدفوع</td><td>${formatCurrency(totals.paid)}</td></tr>
    ${totals.remaining > 0 ? `<tr><td>المتبقي</td><td>${formatCurrency(totals.remaining)}</td></tr>` : ""}
  </table>
  ${form.notes ? `<hr class="divider" /><div class="meta">ملاحظات: ${esc(form.notes)}</div>` : ""}
  ${options.qrDataUrl ? `<div class="qr"><img class="qr-code" src="${options.qrDataUrl}" alt="QR" /><div class="meta">امسح الرمز لفتح الفاتورة</div></div>` : ""}
  <div class="footer">شكراً لتعاملكم معنا</div>
  ${printWhenImagesReadyScript()}
  </body></html>`;

  const w = window.open("", "_blank", "width=760,height=900");
  if (w) { w.document.write(html); w.document.close(); }
}

// ─── Main POS Page ─────────────────────────────────────────────────────────────

export default function POSPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const barcodeRef = useRef<HTMLInputElement>(null);
  const { data: settings } = usePublicSettings();

  // ── State ──────────────────────────────────────────────────────────────────
  const [form, setForm] = useState(newForm());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [lastInvoiceNo, setLastInvoiceNo] = useState("");
  const [lastSavedCart, setLastSavedCart] = useState<CartItem[]>([]);
  const [lastSavedForm, setLastSavedForm] = useState<ReturnType<typeof newForm> | null>(null);
  const [lastSavedTotals, setLastSavedTotals] = useState<Totals | null>(null);

  // Hold/retrieve
  const [held, setHeld] = useState<HeldInvoice[]>(() => {
    try { return JSON.parse(localStorage.getItem("ajn_held_invoices") || "[]"); } catch { return []; }
  });
  const [showHeld, setShowHeld] = useState(false);

  // Numpad
  const [numpadField, setNumpadField] = useState<{ idx: number; field: "quantity" | "unitPrice" | "discount" | "paidAmount" } | null>(null);
  const [numpadVal, setNumpadVal] = useState("");

  // Customer stats
  const [customerStats, setCustomerStats] = useState<{ invoices: number; debt: number } | null>(null);

  // Print modal
  const [showPrint, setShowPrint] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["admin", "products-all"],
    queryFn: () => adminFetch("/admin/products?limit=500"),
    staleTime: 3 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["admin", "categories"],
    queryFn: () => adminFetch("/admin/categories"),
    staleTime: 10 * 60 * 1000,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["admin", "customers-list"],
    queryFn: () => adminFetch("/admin/customers?limit=500"),
    staleTime: 5 * 60 * 1000,
  });

  const { data: printerSettings } = useQuery<PrinterSettings>({
    queryKey: ["admin", "printer-settings"],
    queryFn: () => adminFetch("/admin/settings/printer"),
    staleTime: 5 * 60 * 1000,
  });

  // ── Filtered products ──────────────────────────────────────────────────────
  const q = searchQ.trim().toLowerCase();
  const selectedCategory = categoryId === null ? null : categories.find((category) => category.id === categoryId) ?? null;
  const categoryMatches = useCallback((product: Product, category: Category | null) => {
    if (!category) return true;
    if (category.parentId) {
      return product.subcategoryId === category.id || product.subcategoryIds?.includes(category.id) || Boolean(category.slug && product.subcategory === category.slug);
    }
    return product.categoryId === category.id || Boolean(category.slug && product.category === category.slug);
  }, []);
  const visibleProducts = products.filter(p => {
    const matchCat = categoryMatches(p, selectedCategory);
    const matchQ = !q || p.nameAr?.toLowerCase().includes(q) || p.name?.toLowerCase().includes(q) || p.barcode?.includes(q);
    return matchCat && matchQ;
  });

  // ── Totals ─────────────────────────────────────────────────────────────────
  const subtotal   = cart.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const itemDisc   = cart.reduce((s, i) => s + i.discount, 0);
  const extraDisc  = parseFloat(form.discountAmount || "0");
  const couponDisc = parseFloat(form.couponDiscountAmount || "0");
  const totalDisc  = itemDisc + extraDisc + couponDisc;
  const taxPct     = parseFloat(form.taxPct || "0");
  const taxAmount  = +((subtotal - totalDisc) * taxPct / 100).toFixed(2);
  const grandTotal = +(subtotal - totalDisc + taxAmount).toFixed(2);
  const paidAmt    = isCashPaymentMethod(form.paymentMethod) ? grandTotal : parseFloat(form.paidAmount || "0");
  const remaining  = +(grandTotal - paidAmt).toFixed(2);
  const autoStatus = paidAmt >= grandTotal ? "paid" : paidAmt > 0 ? "partial" : "unpaid";
  const totals     = { subtotal, discount: totalDisc, tax: taxAmount, grand: grandTotal, paid: paidAmt, remaining };

  // ── Cart operations ────────────────────────────────────────────────────────
  const addToCart = useCallback((p: Product) => {
    const price = parseFloat(p.price) || 0;
    const cost  = parseFloat(p.costPrice || "0") || 0;
    const stock = parseFloat(p.stock) || 0;
    setCart(prev => {
      const idx = prev.findIndex(i => i.productId === p.id);
      if (idx >= 0) {
        const updated = [...prev];
        const item = { ...updated[idx] };
        item.quantity = Math.min(item.quantity + 1, stock > 0 ? stock : 9999);
        item.total = +(item.quantity * item.unitPrice - item.discount).toFixed(2);
        updated[idx] = item;
        return updated;
      }
      return [...prev, {
        productId: p.id, productName: p.nameAr || p.name,
        barcode: p.barcode || "", quantity: 1,
        unitPrice: price, discount: 0, discountPct: 0,
        total: price, costPrice: cost, stock,
      }];
    });
    setSearchQ("");
    barcodeRef.current?.focus();
  }, []);

  function updateCartItem(idx: number, field: keyof CartItem, val: number) {
    setCart(prev => {
      const updated = [...prev];
      const item = { ...updated[idx] } as any;
      item[field] = val;
      if (field === "discountPct") {
        item.discount = +(item.unitPrice * item.quantity * val / 100).toFixed(2);
      } else if (field === "discount") {
        item.discountPct = item.unitPrice > 0 ? +(val / (item.unitPrice * item.quantity) * 100).toFixed(2) : 0;
      }
      item.total = +(item.quantity * item.unitPrice - item.discount).toFixed(2);
      updated[idx] = item;
      return updated;
    });
  }

  function removeItem(idx: number) {
    setCart(prev => prev.filter((_, i) => i !== idx));
  }

  function changeQty(idx: number, delta: number) {
    setCart(prev => {
      const updated = [...prev];
      const item = { ...updated[idx] };
      const newQty = Math.max(1, item.quantity + delta);
      item.quantity = newQty;
      item.total = +(newQty * item.unitPrice - item.discount).toFixed(2);
      updated[idx] = item;
      return updated;
    });
  }

  // ── Barcode / search Enter ─────────────────────────────────────────────────
  function handleBarcodeKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !searchQ) return;
    const scopedProducts = products.filter((product) => categoryMatches(product, selectedCategory));
    const exact = scopedProducts.find(p => p.barcode === searchQ);
    if (exact) { addToCart(exact); return; }
    const filtered = scopedProducts.filter(p =>
      p.nameAr?.toLowerCase().includes(searchQ.toLowerCase()) ||
      p.name?.toLowerCase().includes(searchQ.toLowerCase())
    );
    if (filtered.length === 1) addToCart(filtered[0]);
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

  // ── Hold / Retrieve ────────────────────────────────────────────────────────
  function holdInvoice() {
    if (cart.length === 0) return;
    const h: HeldInvoice = {
      id: Date.now().toString(),
      customerName: form.customerName, customerPhone: form.customerPhone,
      items: cart, createdAt: new Date().toISOString(), grandTotal,
    };
    const updated = [...held, h];
    setHeld(updated);
    localStorage.setItem("ajn_held_invoices", JSON.stringify(updated));
    setCart([]); setForm(newForm());
    toast({ title: "تم تعليق الفاتورة", description: `${cart.length} صنف` });
  }

  function retrieveHeld(h: HeldInvoice) {
    if (cart.length > 0 && !confirm("سيتم مسح الفاتورة الحالية، الاسترجاع؟")) return;
    setCart(h.items);
    setForm(f => ({ ...f, customerName: h.customerName, customerPhone: h.customerPhone }));
    const updated = held.filter(x => x.id !== h.id);
    setHeld(updated);
    localStorage.setItem("ajn_held_invoices", JSON.stringify(updated));
    setShowHeld(false);
    toast({ title: "تم استرجاع الفاتورة" });
  }

  function deleteHeld(id: string) {
    const updated = held.filter(x => x.id !== id);
    setHeld(updated);
    localStorage.setItem("ajn_held_invoices", JSON.stringify(updated));
  }

  // ── Customer select ────────────────────────────────────────────────────────
  async function handleSelectCustomer(c: Customer) {
    setForm(f => ({ ...f, customerName: c.name, customerPhone: c.phone ?? "" }));
    try {
      const res = await adminFetch<{ data: any[]; total: number }>(
        `/admin/sales-invoices?limit=200`
      );
      const cInvoices = (res.data ?? []).filter((inv: any) =>
        inv.customerName?.toLowerCase() === c.name.toLowerCase()
      );
      const debt = cInvoices.reduce((s: number, inv: any) => s + (parseFloat(inv.remainingAmount) || 0), 0);
      setCustomerStats({ invoices: cInvoices.length, debt });
    } catch { setCustomerStats(null); }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function saveInvoice(andPrint?: PrintSize) {
    if (cart.length === 0) { toast({ title: "الفاتورة فارغة", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = {
        date: form.date,
        customerName: form.customerName, customerPhone: form.customerPhone,
        subtotal, discountAmount: totalDisc, taxAmount, total: grandTotal,
        couponCode: form.couponCode || undefined,
        paidAmount: paidAmt, remainingAmount: remaining,
        paymentMethod: form.paymentMethod, paymentStatus: autoStatus,
        isInternal: 0, notes: form.notes,
        items: cart.map(i => ({
          productId: i.productId, productName: i.productName, barcode: i.barcode,
          quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount,
          discountPct: i.discountPct, total: i.total, costPrice: i.costPrice,
        })),
      };
      const res = await adminFetch<{ invoice: { invoiceNo: string; qr?: { dataUrl?: string } } }>("/admin/sales-invoices", {
        method: "POST", body: JSON.stringify(payload),
      });
      const invoiceNo = res?.invoice?.invoiceNo;
      const qrDataUrl = res?.invoice?.qr?.dataUrl;
      if (!invoiceNo) throw new Error("تم حفظ الفاتورة لكن لم يرجع رقمها من الخادم");
      queryClient.invalidateQueries({ queryKey: ["admin", "sales-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "products-all"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "inventory-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "inventory-alert-count"] });
      toast({ title: "✓ تم حفظ الفاتورة", description: invoiceNo });
      const printSize = andPrint ?? (printerSettings?.autoPrint ? printerSettings.defaultPaperSize : undefined);
      if (printSize) {
        if (!qrDataUrl) {
          toast({
            title: "تنبيه QR",
            description: "تم حفظ الفاتورة، لكن تعذر تجهيز QR للطباعة.",
            variant: "destructive",
          });
        }
        const copies = andPrint ? 1 : Math.min(Math.max(printerSettings?.copies ?? 1, 1), 5);
        for (let index = 0; index < copies; index++) {
          openPrintWindow(cart, form, totals, invoiceNo, printSize, settings, { showLogo: printerSettings?.showLogo !== false, qrDataUrl });
        }
      }
      setLastInvoiceNo(invoiceNo);
      setLastSavedCart([...cart]);
      setLastSavedForm({ ...form });
      setLastSavedTotals({ ...totals });
      setCart([]); setForm(newForm()); setCustomerStats(null); setSearchQ("");
      // Return focus to the barcode field so the next sale can be scanned/typed with no mouse.
      requestAnimationFrame(() => { barcodeRef.current?.focus(); barcodeRef.current?.select(); });
    } catch (e: any) {
      toast({ title: "خطأ في الحفظ", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // ── Numpad confirm ─────────────────────────────────────────────────────────
  function confirmNumpad() {
    if (!numpadField) return;
    const { idx, field } = numpadField;
    if (field === "paidAmount") {
      setForm(f => ({ ...f, paidAmount: numpadVal }));
    } else {
      updateCartItem(idx, field, parseFloat(numpadVal) || 0);
    }
    setNumpadField(null); setNumpadVal("");
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F4") { e.preventDefault(); setCart([]); setForm(newForm()); setCustomerStats(null); }
      if (e.key === "F9") { e.preventDefault(); holdInvoice(); }
      if (e.key === "F10") { e.preventDefault(); saveInvoice(); }
      if (e.key === "F11") { e.preventDefault(); setShowHeld(true); }
      if (e.key === "F12") { e.preventDefault(); setShowPrint(true); }
      if (e.key === "Escape") { setNumpadField(null); setShowHeld(false); setShowPrint(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, form, grandTotal]);

  // ── Focus barcode on mount ─────────────────────────────────────────────────
  useEffect(() => {
    barcodeRef.current?.focus();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" className="flex flex-col h-full gap-3">
      {/* ── Numpad overlay ── */}
      {numpadField && (
        <NumPad
          value={numpadVal}
          onChange={setNumpadVal}
          onClose={confirmNumpad}
          label={numpadField.field === "quantity" ? "الكمية" : numpadField.field === "unitPrice" ? "السعر" : numpadField.field === "discount" ? "الخصم" : "المبلغ المدفوع"}
        />
      )}

      {/* ── Held Invoices Modal ── */}
      {showHeld && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowHeld(false)}>
          <div className="bg-card rounded-2xl border border-border/40 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border/30">
              <h3 className="font-bold text-lg">الفواتير المعلقة ({held.length})</h3>
              <button onClick={() => setShowHeld(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3 max-h-80 overflow-y-auto space-y-2">
              {held.length === 0
                ? <p className="text-center py-8 text-muted-foreground">لا توجد فواتير معلقة</p>
                : held.map(h => (
                    <div key={h.id} className="flex items-center justify-between bg-muted/30 rounded-xl p-3 gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{h.customerName || "عميل نقدي"}</p>
                        <p className="text-xs text-muted-foreground">
                          {h.items.length} صنف · {formatCurrency(h.grandTotal)} · {new Date(h.createdAt).toLocaleTimeString("ar-IQ")}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" onClick={() => retrieveHeld(h)}>
                          <PlayCircle className="w-3.5 h-3.5 ml-1" />استرجاع
                        </Button>
                        <button onClick={() => deleteHeld(h.id)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
              }
            </div>
          </div>
        </div>
      )}

      {/* ── Print Modal ── */}
      {showPrint && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowPrint(false)}>
          <div className="bg-card rounded-2xl border border-border/40 w-full max-w-xs shadow-2xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">طباعة الفاتورة</h3>
              <button onClick={() => setShowPrint(false)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              {lastInvoiceNo ? `آخر فاتورة: ${lastInvoiceNo}` : "سيتم الطباعة بعد الحفظ"}
            </p>
            <div className="space-y-2">
              {[
                { size: "80mm" as const, label: "Thermal 80mm", icon: "🖨️" },
                { size: "58mm" as const, label: "Thermal 58mm", icon: "🖨️" },
                { size: "a4" as const, label: "A4 عادي", icon: "📄" },
              ].map(({ size, label, icon }) => (
                <button
                  key={size}
                  onClick={() => {
                    setShowPrint(false);
                    if (cart.length > 0) {
                      saveInvoice(size);
                    } else if (lastInvoiceNo && lastSavedCart.length > 0) {
                      openPrintWindow(
                        lastSavedCart,
                        lastSavedForm ?? form,
                        lastSavedTotals ?? totals,
                        lastInvoiceNo,
                        size,
                        settings,
                        { showLogo: printerSettings?.showLogo !== false },
                      );
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border/30 hover:border-primary/50 hover:bg-primary/5 transition-colors text-right"
                >
                  <span className="text-xl">{icon}</span>
                  <span className="font-medium text-sm">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ TOP BAR ══ */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Barcode / Search */}
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Barcode className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
          <input
            ref={barcodeRef}
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            onKeyDown={handleBarcodeKey}
            placeholder="باركود أو اسم المنتج..."
            className="w-full bg-card border border-primary/40 rounded-xl px-4 py-2.5 pr-9 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shadow-sm"
          />
          {searchQ && (
            <button onClick={() => { setSearchQ(""); barcodeRef.current?.focus(); }} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Customer */}
        <div className="flex-1 min-w-56">
          <CustomerPanel
            name={form.customerName} phone={form.customerPhone}
            onName={v => setForm(f => ({ ...f, customerName: v }))}
            onPhone={v => setForm(f => ({ ...f, customerPhone: v }))}
            customers={customers} onSelectCustomer={handleSelectCustomer}
            customerStats={customerStats}
          />
        </div>

        {/* Shortcuts Info */}
        <div className="hidden xl:flex gap-1 text-[11px] text-muted-foreground/60">
          {[["F4","جديد"],["F9","تعليق"],["F10","حفظ"],["F11","معلق"],["F12","طباعة"]].map(([k,l]) => (
            <span key={k} className="bg-muted/30 rounded px-1.5 py-0.5 font-mono">{k} {l}</span>
          ))}
        </div>

        {/* Quick Action Buttons */}
        <div className="flex gap-2 flex-wrap">
          {held.length > 0 && (
            <button onClick={() => setShowHeld(true)} className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl bg-status-warning/10 border border-status-warning/30 text-status-warning text-sm font-medium hover:bg-status-warning/20 transition-colors">
              <PlayCircle className="w-4 h-4" />معلقة
              <span className="absolute -top-1.5 -left-1.5 bg-status-warning text-black text-[11px] rounded-full w-4 h-4 flex items-center justify-center font-bold">{held.length}</span>
            </button>
          )}
          <button
            onClick={holdInvoice} disabled={cart.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-card border border-border/40 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-40"
          >
            <PauseCircle className="w-4 h-4" />تعليق
          </button>
          <button
            onClick={() => { setCart([]); setForm(newForm()); setCustomerStats(null); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-card border border-border/40 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            <RefreshCw className="w-4 h-4" />جديدة
          </button>
        </div>
      </div>

      {/* ══ MAIN AREA ══ */}
      <div className="flex gap-3 flex-1 min-h-0 flex-col lg:flex-row">
        {/* ── LEFT: Product Grid ── */}
        <div className="flex-1 min-w-0 space-y-3 overflow-hidden">
          {/* Category Tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setCategoryId(null)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${categoryId === null ? "bg-primary text-black" : "bg-card border border-border/30 text-muted-foreground hover:text-foreground hover:border-primary/30"}`}
            >
              <Grid3X3 className="w-3.5 h-3.5" />الكل ({products.length})
            </button>
            {categories.map(cat => {
              const count = products.filter((product) => categoryMatches(product, cat)).length;
              return (
                <button
                  key={cat.id}
                  onClick={() => setCategoryId(cat.id)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${categoryId === cat.id ? "bg-primary text-black" : "bg-card border border-border/30 text-muted-foreground hover:text-foreground hover:border-primary/30"}`}
                >
                  <Tag className="w-3 h-3" />{cat.nameAr || cat.name} ({count})
                </button>
              );
            })}
            <div className="mr-auto shrink-0">
              <button
                onClick={() => setViewMode(v => v === "grid" ? "list" : "grid")}
                className="px-2.5 py-1.5 rounded-lg bg-card border border-border/30 text-muted-foreground hover:text-foreground transition-colors"
              >
                {viewMode === "grid" ? <List className="w-3.5 h-3.5" /> : <Grid3X3 className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Products */}
          <div className="bg-card rounded-xl border border-border/30 overflow-y-auto" style={{ maxHeight: "calc(100vh - 320px)", minHeight: 200 }}>
            {viewMode === "grid" ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-2 p-3">
                {visibleProducts.slice(0, 120).map(p => (
                  <ProductCard key={p.id} product={p} onAdd={addToCart} />
                ))}
                {visibleProducts.length === 0 && (
                  <div className="col-span-full py-16 text-center text-muted-foreground text-sm">
                    لا توجد منتجات
                  </div>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border/20">
                {visibleProducts.slice(0, 200).map(p => {
                  const stock = parseFloat(p.stock) || 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => stock > 0 && addToCart(p)}
                      disabled={stock <= 0}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-primary/5 text-right transition-colors disabled:opacity-50"
                    >
                      {p.images?.[0] && <img src={p.images[0]} alt="" className="w-8 h-8 rounded object-cover shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.nameAr || p.name}</p>
                        {p.barcode && <p className="text-[11px] text-muted-foreground font-mono">{p.barcode}</p>}
                      </div>
                      <div className="text-left shrink-0">
                        <p className="text-sm font-bold text-primary">{formatCurrency(p.price)}</p>
                        <p className={`text-[11px] ${stock < 5 ? "text-status-warning" : "text-muted-foreground"}`}>{stock > 0 ? `${stock} متبقي` : "نفذ"}</p>
                      </div>
                    </button>
                  );
                })}
                {visibleProducts.length === 0 && (
                  <div className="py-16 text-center text-muted-foreground text-sm">لا توجد منتجات</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Cart + Payment ── */}
        <div className="w-full lg:w-96 shrink-0 flex flex-col gap-3">
          {/* Cart Table */}
          <div className="bg-card rounded-xl border border-border/30 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/20 shrink-0">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm">السلة</span>
                <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">{cart.length}</span>
              </div>
              {cart.length > 0 && (
                <button onClick={() => setCart([])} className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" />مسح
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1" style={{ maxHeight: 280 }}>
              {cart.length === 0
                ? <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <ShoppingCart className="w-10 h-10 mb-3 opacity-20" />
                    <p className="text-sm">السلة فارغة</p>
                    <p className="text-xs mt-1">امسح الباركود أو اختر منتجاً</p>
                  </div>
                : <div className="divide-y divide-border/10">
                    {cart.map((item, idx) => (
                      <div key={idx} className="px-3 py-2 hover:bg-muted/10 group">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{item.productName}</p>
                            <p className="text-xs text-primary font-bold">{formatCurrency(item.total)}</p>
                          </div>
                          <button onClick={() => removeItem(idx)} className="text-muted-foreground/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 shrink-0">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          {/* Qty */}
                          <div className="flex items-center gap-1 bg-background border border-border/30 rounded-lg overflow-hidden">
                            <button onClick={() => changeQty(idx, -1)} className="px-2 py-1 hover:bg-primary/10 hover:text-primary transition-colors">
                              <Minus className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => { setNumpadField({ idx, field: "quantity" }); setNumpadVal(item.quantity.toString()); }}
                              className="px-2 py-1 font-mono text-sm font-bold min-w-[32px] text-center hover:text-primary"
                            >
                              {item.quantity}
                            </button>
                            <button onClick={() => changeQty(idx, 1)} className="px-2 py-1 hover:bg-primary/10 hover:text-primary transition-colors">
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                          {/* Unit Price */}
                          <button
                            onClick={() => { setNumpadField({ idx, field: "unitPrice" }); setNumpadVal(item.unitPrice.toString()); }}
                            className="text-xs text-muted-foreground hover:text-primary border border-transparent hover:border-primary/30 rounded px-1.5 py-0.5 transition-colors"
                          >
                            {formatCurrency(item.unitPrice)}
                          </button>
                          {/* Discount */}
                          <button
                            onClick={() => { setNumpadField({ idx, field: "discount" }); setNumpadVal(item.discount.toString()); }}
                            className={`text-xs border border-transparent hover:border-primary/30 rounded px-1.5 py-0.5 transition-colors ${item.discount > 0 ? "text-status-danger hover:text-status-danger" : "text-muted-foreground hover:text-primary"}`}
                          >
                            {item.discount > 0 ? `-${formatCurrency(item.discount)}` : "خصم"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
              }
            </div>
          </div>

          {/* Totals */}
          <div className="bg-card rounded-xl border border-border/30 p-3 space-y-1.5">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>المجموع ({cart.reduce((s,i) => s+i.quantity, 0)} صنف)</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {totalDisc > 0 && (
              <div className="flex justify-between text-sm text-status-danger">
                <span>الخصم الكلي</span>
                <span>− {formatCurrency(totalDisc)}</span>
              </div>
            )}
            {couponDisc > 0 && (
              <div className="flex justify-between text-xs text-status-success">
                <span>كوبون {form.couponCode}</span>
                <span>− {formatCurrency(couponDisc)}</span>
              </div>
            )}
            {taxAmount > 0 && (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>ضريبة {taxPct}%</span>
                <span>{formatCurrency(taxAmount)}</span>
              </div>
            )}
            {/* Extra discount + tax inputs */}
            <div className="flex gap-2 pt-1">
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground block mb-0.5">خصم إضافي</label>
                <input
                  type="number" min="0" value={form.discountAmount}
                  onChange={e => setForm(f => ({ ...f, discountAmount: e.target.value }))}
                  className="w-full bg-background border border-border/30 rounded px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  dir="ltr"
                />
              </div>
              <div className="w-20">
                <label className="text-[11px] text-muted-foreground block mb-0.5">ضريبة %</label>
                <input
                  type="number" min="0" max="100" value={form.taxPct}
                  onChange={e => setForm(f => ({ ...f, taxPct: e.target.value }))}
                  className="w-full bg-background border border-border/30 rounded px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  dir="ltr"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <input
                value={form.couponCode}
                onChange={e => setForm(f => ({ ...f, couponCode: e.target.value.toUpperCase().replace(/\s+/g, ""), couponDiscountAmount: "0" }))}
                placeholder="كوبون"
                className="flex-1 bg-background border border-border/30 rounded px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                dir="ltr"
              />
              <button
                type="button"
                onClick={applyCoupon}
                disabled={subtotal <= 0}
                className="rounded border border-primary/40 px-3 py-1 text-xs text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                تطبيق
              </button>
            </div>
            <div className="flex justify-between text-lg font-bold pt-1 border-t border-border/30">
              <span>الإجمالي</span>
              <span className="text-primary">{formatCurrency(grandTotal)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="bg-card rounded-xl border border-border/30 p-3 space-y-3">
            {/* Payment Method */}
            <div className="grid grid-cols-4 gap-1">
              {PAYMENT_METHODS.map(m => (
                <button
                  key={m.value}
                  onClick={() => setForm(f => ({ ...f, paymentMethod: m.value, paidAmount: isCashPaymentMethod(m.value) ? grandTotal.toString() : f.paidAmount }))}
                  className={`rounded-lg py-2 text-xs font-semibold border transition-all ${
                    form.paymentMethod === m.value
                      ? "bg-primary text-black border-primary shadow-md"
                      : "border-border/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Paid Amount */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">المبلغ المدفوع</label>
              <div className="flex gap-2">
                <button
                  onClick={() => { if (isCashPaymentMethod(form.paymentMethod)) return; setNumpadField({ idx: -1, field: "paidAmount" }); setNumpadVal(form.paidAmount); }}
                  className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm font-mono font-bold text-foreground text-right hover:border-primary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
                >
                  {isCashPaymentMethod(form.paymentMethod) ? grandTotal : form.paidAmount || "0"}
                </button>
                <button
                  onClick={() => setForm(f => ({ ...f, paidAmount: grandTotal.toString() }))}
                  className="px-3 py-2 bg-status-success/10 border border-status-success/30 text-status-success rounded-lg text-xs font-medium hover:bg-status-success/20 transition-colors whitespace-nowrap"
                >
                  كامل
                </button>
              </div>
            </div>

            {/* Remaining */}
            {grandTotal > 0 && (
              <div className={`flex justify-between items-center text-sm font-bold rounded-lg px-3 py-2 ${
                remaining > 0 ? "bg-status-danger/10 text-status-danger"
                : remaining < 0 ? "bg-accent/10 text-accent"
                : "bg-status-success/10 text-status-success"
              }`}>
                <span>
                  {remaining > 0 ? "المتبقي" : remaining < 0 ? "الباقي (زيادة)" : "✓ مدفوع بالكامل"}
                </span>
                <span>{formatCurrency(Math.abs(remaining))}</span>
              </div>
            )}

            {/* Notes */}
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="ملاحظات..."
              rows={1}
              className="w-full bg-background border border-border/30 rounded-lg px-3 py-2 text-xs resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* Action Buttons */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => saveInvoice()}
                disabled={saving || cart.length === 0}
                className="bg-primary text-black hover:bg-primary/90 font-bold h-12 text-base"
              >
                {saving ? <RefreshCw className="w-4 h-4 ml-2 animate-spin" /> : <Save className="w-4 h-4 ml-2" />}
                {saving ? "جاري..." : "حفظ (F10)"}
              </Button>
              <Button
                onClick={() => setShowPrint(true)}
                disabled={cart.length === 0 && !lastInvoiceNo}
                variant="outline"
                className="h-12 text-base border-primary/40 text-primary hover:bg-primary/10"
              >
                <Printer className="w-4 h-4 ml-2" />
                طباعة (F12)
              </Button>
            </div>
            <button
              onClick={() => saveInvoice("80mm")}
              disabled={saving || cart.length === 0}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-border/30 text-sm text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/30 transition-all disabled:opacity-40"
            >
              <Printer className="w-3.5 h-3.5" />
              حفظ وطباعة Thermal 80mm
            </button>
          </div>

          {/* Last Invoice Info */}
          {lastInvoiceNo && (
            <div className="flex items-center justify-between bg-status-success/5 border border-status-success/20 rounded-xl px-3 py-2">
              <span className="text-xs text-status-success flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                آخر فاتورة: <strong>{lastInvoiceNo}</strong>
              </span>
              <button
                onClick={() => openPrintWindow(lastSavedCart, form, totals, lastInvoiceNo, "80mm", settings)}
                className="text-[11px] text-status-success hover:text-status-success underline"
              >
                إعادة طباعة
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
