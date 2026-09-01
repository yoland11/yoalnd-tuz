import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Search,
  Save,
  RefreshCw,
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Package,
  Paperclip,
  Pencil,
  Printer,
  ScanLine,
  Wallet,
  FileDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { TableTotalsFooter } from "@/components/ui/table-totals-footer";
import { useToast } from "@/hooks/use-toast";
import CustomerAccountPrompt from "./customer-account-prompt";
import {
  adminFetch,
  apiErrorMessage,
  apiErrorStatus,
  compressImageFile,
  fileToDataUrl,
  formatCurrency,
} from "./_lib";
import { BarcodeScanDialog, type ScanProduct } from "./barcode-scan-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { INVOICE_PAYMENT_STATUS_OPTIONS } from "@/lib/invoice-payment-status";
import { usePublicSettings } from "@/lib/public-settings";
import { downloadElementPdf } from "@/lib/pdf";
import {
  createPurchaseInvoicePrintElement,
  openPurchaseInvoicePrintWindow,
  type PurchaseInvoiceStatementInput,
} from "./print-helpers";
import {
  InvoicePaymentStatusBadge,
  InvoiceRegisterSummaryCards,
  type InvoiceRegisterSummary,
} from "./invoice-payment-status";

// ── Types ──────────────────────────────────────────────────────────────────
type Product = {
  id: number;
  name: string;
  nameAr: string;
  price: string;
  costPrice?: string;
  stock: string;
  barcode?: string;
  categoryName?: string;
  category?: string;
  images?: string[];
};

function ProductSearchThumbnail({ product }: { product: Pick<Product, "name" | "nameAr" | "images"> }) {
  const [failed, setFailed] = useState(false);
  const source = product.images?.find((image) => typeof image === "string" && image.trim());
  if (!source || failed) {
    return <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border/40 bg-muted text-muted-foreground"><Package className="h-4 w-4" /></span>;
  }
  return <img src={source} alt={product.nameAr || product.name || ""} className="h-10 w-10 shrink-0 rounded-md border border-border/40 bg-muted object-cover" loading="lazy" onError={() => setFailed(true)} />;
}
type Supplier = {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  balance: string;
  isActive: number;
};
type PurchaseItem = {
  productId: number | null;
  productName: string;
  barcode: string;
  quantity: number;
  costPrice: number;
  salePrice: number;
  discount: number;
  total: number;
};
type PurchaseInvoice = {
  id: number;
  invoiceNo: string;
  date: string;
  supplierName: string;
  supplierId?: number;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  shippingCost: string;
  total: string;
  paidAmount: string;
  remainingAmount: string;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  notes?: string;
  createdByName: string;
  createdAt: string;
};
type InvoiceRegisterOptions = {
  branches?: Array<{ value: string; label: string }>;
  cashBoxes?: Array<{ value: string; label: string }>;
};
type PurchaseInvoiceRegisterResponse = {
  data?: PurchaseInvoice[];
  // Compatibility with the previous list envelope while all current requests
  // use { data, total, summary }.
  invoices?: PurchaseInvoice[];
  total?: number;
  summary?: InvoiceRegisterSummary;
};

const PAYMENT_METHODS = [
  { value: "cash", label: "نقداً" },
  { value: "card", label: "بطاقة" },
  { value: "transfer", label: "تحويل" },
  { value: "credit", label: "آجل" },
];

function blankItem(): PurchaseItem {
  return {
    productId: null,
    productName: "",
    barcode: "",
    quantity: 1,
    costPrice: 0,
    salePrice: 0,
    discount: 0,
    total: 0,
  };
}
function newForm() {
  return {
    date: new Date().toISOString().slice(0, 10),
    supplierName: "",
    supplierId: "" as string | number,
    paymentMethod: "cash",
    paidAmount: "",
    shippingCost: "0",
    discountAmount: "0",
    taxPct: "0",
    notes: "",
  };
}

export default function PurchasesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings } = usePublicSettings();

  const [form, setForm] = useState(newForm());
  const [items, setItems] = useState<PurchaseItem[]>([blankItem()]);
  const [scanOpen, setScanOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQ, setSearchQ] = useState<Record<number, string>>({});
  const [showProductSearch, setShowProductSearch] = useState<number | null>(
    null,
  );
  const [listMode, setListMode] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [listFrom, setListFrom] = useState("");
  const [listTo, setListTo] = useState("");
  const [listSearch, setListSearch] = useState("");
  const [listPaymentStatus, setListPaymentStatus] = useState("");
  const [listPaymentMethod, setListPaymentMethod] = useState("");
  const [listStatus, setListStatus] = useState("");
  const [listBranchId, setListBranchId] = useState("");
  const [listCashBox, setListCashBox] = useState("");
  const deferredListSearch = useDeferredValue(listSearch.trim());
  const [attachment, setAttachment] = useState<{
    url: string;
    name: string;
    type: string;
  } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingNo, setEditingNo] = useState<string>("");
  const [paymentDetailsInvoice, setPaymentDetailsInvoice] =
    useState<PurchaseInvoice | null>(null);
  const [quickSupplier, setQuickSupplier] = useState(false);
  const [quickSupplierForm, setQuickSupplierForm] = useState({
    name: "",
    phone: "",
    company: "",
  });
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const submitKeyRef = useRef<string | null>(null);

  // Master Cash links use ?invoice=<id> so the user lands on this exact
  // purchase invoice and its payment history, rather than a generic register.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const invoiceId = Number(new URLSearchParams(window.location.search).get("invoice"));
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) return;

    let active = true;
    setListMode(true);
    void adminFetch<PurchaseInvoice>(`/admin/purchase-invoices/${invoiceId}`)
      .then((invoice) => {
        if (active) setPaymentDetailsInvoice(invoice);
      })
      .catch((error) => {
        if (!active) return;
        toast({
          title: "تعذر فتح فاتورة المشتريات",
          description: apiErrorMessage(error),
          variant: "destructive",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["admin", "products-all"],
    queryFn: () => adminFetch("/admin/products?limit=500"),
    staleTime: 3 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    enabled: !listMode,
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["admin", "suppliers"],
    queryFn: () => adminFetch("/admin/suppliers"),
    staleTime: 5 * 60 * 1000,
    enabled: !listMode,
  });

  const {
    data: invoicesList,
    isLoading: invoicesLoading,
    isError: invoicesError,
    error: invoicesLoadError,
    isFetching: invoicesFetching,
    refetch: refetchInvoices,
  } = useQuery<PurchaseInvoiceRegisterResponse>({
    queryKey: [
      "admin",
      "purchase-invoices",
      listPage,
      listFrom,
      listTo,
      listPaymentStatus,
      listPaymentMethod,
      listStatus,
      listBranchId,
      listCashBox,
      deferredListSearch,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: "20",
        offset: String((listPage - 1) * 20),
      });
      if (listFrom) params.set("from", listFrom);
      if (listTo) params.set("to", listTo);
      if (listPaymentStatus) params.set("paymentStatus", listPaymentStatus);
      if (listPaymentMethod) params.set("paymentMethod", listPaymentMethod);
      if (listStatus) params.set("status", listStatus);
      if (listBranchId) params.set("branchId", listBranchId);
      if (listCashBox) params.set("cashBox", listCashBox);
      if (deferredListSearch) params.set("search", deferredListSearch);
      return adminFetch<PurchaseInvoiceRegisterResponse>(
        `/admin/purchase-invoices?${params}`,
      );
    },
    enabled: listMode,
  });
  const { data: registerOptions } = useQuery<InvoiceRegisterOptions>({
    queryKey: ["admin", "invoice-register-options"],
    queryFn: () => adminFetch("/admin/reports/options"),
    enabled: listMode,
    staleTime: 5 * 60 * 1000,
  });

  async function createQuickSupplier() {
    if (!quickSupplierForm.name.trim()) {
      toast({ title: "اسم المورد مطلوب", variant: "destructive" });
      return;
    }
    try {
      const supplier = await adminFetch<Supplier>("/admin/suppliers", {
        method: "POST",
        body: JSON.stringify(quickSupplierForm),
      });
      queryClient.invalidateQueries({ queryKey: ["admin", "suppliers"] });
      setForm((f) => ({
        ...f,
        supplierId: supplier.id,
        supplierName: supplier.name,
      }));
      setQuickSupplier(false);
      setQuickSupplierForm({ name: "", phone: "", company: "" });
      toast({ title: "تمت إضافة المورد واختياره" });
    } catch (error: any) {
      toast({
        title: "تعذرت إضافة المورد",
        description: error.message,
        variant: "destructive",
      });
    }
  }

  // ── Totals ───────────────────────────────────────────────────────────────
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const extraDiscount = parseFloat(form.discountAmount || "0");
  const shipping = parseFloat(form.shippingCost || "0");
  const taxPct = parseFloat(form.taxPct || "0");
  const taxAmount = +(((subtotal - extraDiscount) * taxPct) / 100).toFixed(2);
  const grandTotal = +(subtotal - extraDiscount + taxAmount + shipping).toFixed(
    2,
  );
  // Cash is a method, not proof that the supplier was paid in full. The
  // entered amount becomes a pending financial approval and may be partial.
  const paidAmt = Math.min(
    grandTotal,
    Math.max(0, parseFloat(form.paidAmount || "0") || 0),
  );
  const remaining = +(grandTotal - paidAmt).toFixed(2);
  const autoStatus =
    paidAmt >= grandTotal ? "paid" : paidAmt > 0 ? "partial" : "unpaid";

  // ── Item operations ──────────────────────────────────────────────────────
  function addRow() {
    setItems((prev) => [...prev, blankItem()]);
  }

  // Scanned product → increment an existing row, else fill the first blank row
  // (or append one). Purchase price is taken from the product's cost price.
  function handleScanAdd(product: ScanProduct) {
    const cost = parseFloat(String(product.costPrice ?? "0")) || 0;
    const sale = parseFloat(String(product.price ?? "0")) || 0;
    setItems((prev) => {
      const existingIdx = prev.findIndex((r) => r.productId === product.id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        const it = { ...updated[existingIdx] };
        it.quantity = (it.quantity || 0) + 1;
        it.total = +(it.quantity * it.costPrice - it.discount).toFixed(2);
        updated[existingIdx] = it;
        return updated;
      }
      const blankIdx = prev.findIndex((r) => !r.productId && !r.productName);
      const rows = blankIdx >= 0 ? [...prev] : [...prev, blankItem()];
      const idx = blankIdx >= 0 ? blankIdx : rows.length - 1;
      const qty = rows[idx].quantity || 1;
      rows[idx] = {
        ...rows[idx],
        productId: product.id,
        productName: product.nameAr || product.name || "",
        barcode: product.barcode || "",
        quantity: qty,
        costPrice: cost,
        salePrice: sale,
        total: +(qty * cost - (rows[idx].discount || 0)).toFixed(2),
      };
      return rows;
    });
  }

  function removeRow(idx: number) {
    if (items.length === 1) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateItem(
    idx: number,
    field: keyof PurchaseItem,
    raw: string | number,
  ) {
    setItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[idx] } as any;
      const val = typeof raw === "string" ? parseFloat(raw) || 0 : raw;
      if (field === "productName" || field === "barcode") item[field] = raw;
      else item[field] = val;
      item.total = +(item.quantity * item.costPrice - item.discount).toFixed(2);
      updated[idx] = item;
      return updated;
    });
  }

  function selectProduct(idx: number, p: Product) {
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        productId: p.id,
        productName: p.nameAr || p.name,
        barcode: p.barcode || "",
        costPrice: parseFloat(p.costPrice || "0"),
        salePrice: parseFloat(p.price || "0"),
        total: +(
          updated[idx].quantity * parseFloat(p.costPrice || "0") -
          updated[idx].discount
        ).toFixed(2),
      };
      return updated;
    });
    setShowProductSearch(null);
    setSearchQ((prev) => ({ ...prev, [idx]: "" }));
  }

  // "Open a customer account?" prompt shown on save for a new counterparty name.
  const [customerPrompt, setCustomerPrompt] = useState(false);

  // Gate the save behind the prompt when a new name was typed but not chosen
  // from the suppliers list.
  function onSaveClick() {
    if (saving) return;
    const name = form.supplierName.trim();
    const hasItems = items.some((i) => i.productName && i.quantity > 0);
    if (name && !form.supplierId && hasItems) {
      setCustomerPrompt(true);
      return;
    }
    void saveInvoice();
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function saveInvoice() {
    if (saving) return;
    const validItems = items.filter((i) => i.productName && i.quantity > 0);
    if (validItems.length === 0) {
      toast({ title: "أضف أصناف للفاتورة", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      submitKeyRef.current ??= `purchase-invoice:${crypto.randomUUID()}`;
      const payload = {
        date: form.date,
        supplierName: form.supplierName,
        supplierId: form.supplierId || null,
        subtotal,
        discountAmount: extraDiscount,
        taxAmount,
        shippingCost: shipping,
        total: grandTotal,
        paidAmount: paidAmt,
        remainingAmount: remaining,
        paymentMethod: form.paymentMethod,
        paymentStatus: autoStatus,
        notes: form.notes,
        items: validItems.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          barcode: i.barcode,
          quantity: i.quantity,
          costPrice: i.costPrice,
          salePrice: i.salePrice,
          discount: i.discount,
          total: i.total,
        })),
      };
      const res = await adminFetch<{ invoice: PurchaseInvoice }>(
        editingId
          ? `/admin/purchase-invoices/${editingId}`
          : "/admin/purchase-invoices",
        {
          method: editingId ? "PUT" : "POST",
          headers: editingId
            ? undefined
            : { "x-idempotency-key": submitKeyRef.current },
          body: JSON.stringify(payload),
        },
      );
      submitKeyRef.current = null;
      // Attach the uploaded invoice image / PDF and link it to the invoice (shows inside each asset's passport).
      const invId = res?.invoice?.id ?? editingId;
      if (attachment && invId) {
        try {
          await adminFetch("/admin/documents", {
            method: "POST",
            body: JSON.stringify({
              entityType: "purchase_invoice",
              entityId: invId,
              documentType: "invoice",
              title: `فاتورة شراء ${res.invoice?.invoiceNo ?? ""}`.trim(),
              fileName: attachment.name,
              mimeType: attachment.type,
              fileUrl: attachment.url,
            }),
          });
        } catch {
          /* attachment is best-effort; the invoice itself is already saved */
        }
      }
      toast({
        title: editingId ? "تم تعديل فاتورة الشراء" : "تم حفظ فاتورة الشراء",
        description: res?.invoice?.invoiceNo ?? "تم الحفظ",
      });
      queryClient.invalidateQueries({
        queryKey: ["admin", "purchase-invoices"],
      });
      queryClient.invalidateQueries({ queryKey: ["admin", "products-all"] });
      queryClient.invalidateQueries({
        queryKey: ["admin", "inventory-alerts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["admin", "inventory-alert-count"],
      });
      setItems([blankItem()]);
      setForm(newForm());
      setAttachment(null);
      setEditingId(null);
      setEditingNo("");
      if (editingId) setListMode(true);
      else requestAnimationFrame(() => firstFieldRef.current?.focus()); // ready for a new purchase invoice
    } catch (e: any) {
      toast({
        title: "خطأ في الحفظ",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function editInvoice(inv: PurchaseInvoice) {
    try {
      const full = await adminFetch<PurchaseInvoice & { items: any[] }>(
        `/admin/purchase-invoices/${inv.id}`,
      );
      const sub = (full.items ?? []).reduce(
        (s: number, it: any) => s + (Number(it.total) || 0),
        0,
      );
      const baseForTax = sub - (Number(full.discountAmount) || 0);
      setForm({
        date: full.date,
        supplierName: full.supplierName ?? "",
        supplierId: (full.supplierId ?? "") as string | number,
        paymentMethod: full.paymentMethod ?? "cash",
        paidAmount: String(full.paidAmount ?? ""),
        shippingCost: String(full.shippingCost ?? "0"),
        discountAmount: String(full.discountAmount ?? "0"),
        taxPct:
          baseForTax > 0
            ? String(
                +(((Number(full.taxAmount) || 0) / baseForTax) * 100).toFixed(
                  2,
                ),
              )
            : "0",
        notes: full.notes ?? "",
      });
      setItems(
        (full.items ?? []).map((it: any) => ({
          productId: it.productId ?? null,
          productName: it.productName ?? "",
          barcode: it.barcode ?? "",
          quantity: Number(it.quantity) || 1,
          costPrice: Number(it.costPrice) || 0,
          salePrice: Number(it.salePrice) || 0,
          discount: Number(it.discount) || 0,
          total: Number(it.total) || 0,
        })),
      );
      setEditingId(full.id);
      setEditingNo(full.invoiceNo);
      setAttachment(null);
      setListMode(false);
    } catch (e: any) {
      toast({
        title: "تعذّر فتح الفاتورة",
        description: e.message,
        variant: "destructive",
      });
    }
  }

  async function printInvoice(inv: PurchaseInvoice) {
    try {
      const full = await adminFetch<PurchaseInvoiceDetails>(`/admin/purchase-invoices/${inv.id}`);
      printPurchaseInvoiceStatement(full, settings);
    } catch (error) {
      toast({
        title: "تعذر فتح نافذة الطباعة",
        description:
          error instanceof Error ? error.message : "تعذر تجهيز الفاتورة",
        variant: "destructive",
      });
    }
  }

  async function downloadInvoicePdf(inv: PurchaseInvoice) {
    try {
      const full = await adminFetch<PurchaseInvoiceDetails>(
        `/admin/purchase-invoices/${inv.id}`,
      );
      await downloadPurchaseInvoicePdf(full, settings);
      toast({ title: "تم حفظ فاتورة المشتريات بصيغة PDF" });
    } catch (error) {
      toast({
        title: "تعذر إنشاء ملف PDF",
        description:
          error instanceof Error ? error.message : "تعذر تجهيز الفاتورة",
        variant: "destructive",
      });
    }
  }

  async function deleteInvoice(inv: PurchaseInvoice) {
    if (
      !confirm(
        `حذف فاتورة الشراء ${inv.invoiceNo}؟ سيُعكس المخزون والحركة المالية.`,
      )
    )
      return;
    try {
      await adminFetch(`/admin/purchase-invoices/${inv.id}`, {
        method: "DELETE",
      });
      toast({ title: "تم حذف الفاتورة", description: inv.invoiceNo });
      queryClient.invalidateQueries({
        queryKey: ["admin", "purchase-invoices"],
      });
      queryClient.invalidateQueries({ queryKey: ["admin", "products-all"] });
      queryClient.invalidateQueries({
        queryKey: ["admin", "inventory-alerts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["admin", "inventory-alert-count"],
      });
    } catch (e: any) {
      toast({
        title: "تعذّر الحذف",
        description: e.message,
        variant: "destructive",
      });
    }
  }

  if (listMode) {
    const invoiceRows = Array.isArray(invoicesList?.data)
      ? invoicesList.data
      : Array.isArray(invoicesList?.invoices)
        ? invoicesList.invoices
        : [];
    return (
      <>
      <PurchaseListView
        invoices={invoiceRows}
        total={
          Number.isFinite(invoicesList?.total)
            ? Number(invoicesList?.total)
            : invoiceRows.length
        }
        summary={invoicesList?.summary}
        loading={invoicesLoading}
        error={invoicesError ? invoicesLoadError : null}
        refreshing={invoicesFetching}
        onRefresh={() => {
          void refetchInvoices();
        }}
        page={listPage}
        onPage={setListPage}
        from={listFrom}
        to={listTo}
        onFrom={setListFrom}
        onTo={setListTo}
        search={listSearch}
        onSearch={setListSearch}
        paymentStatus={listPaymentStatus}
        onPaymentStatus={setListPaymentStatus}
        paymentMethod={listPaymentMethod}
        onPaymentMethod={setListPaymentMethod}
        invoiceStatus={listStatus}
        onInvoiceStatus={setListStatus}
        branchId={listBranchId}
        onBranchId={setListBranchId}
        cashBox={listCashBox}
        onCashBox={setListCashBox}
        options={registerOptions}
        onBack={() => setListMode(false)}
        onDetails={setPaymentDetailsInvoice}
        onEdit={editInvoice}
        onPrint={printInvoice}
        onPdf={downloadInvoicePdf}
        onDelete={deleteInvoice}
      />
      <PurchaseInvoicePaymentDialog
        invoice={paymentDetailsInvoice}
        onClose={() => setPaymentDetailsInvoice(null)}
        onChanged={() => {
          void refetchInvoices();
          queryClient.invalidateQueries({ queryKey: ["admin", "suppliers"] });
          queryClient.invalidateQueries({ queryKey: ["admin", "suppliers", "dashboard"] });
        }}
        settings={settings}
      />
      </>
    );
  }

  return (
    <div dir="rtl" className="space-y-4">
      <BarcodeScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        products={products as unknown as ScanProduct[]}
        context="purchase"
        onAdd={handleScanAdd}
        onCreated={() =>
          queryClient.invalidateQueries({ queryKey: ["admin", "products-all"] })
        }
      />
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {editingId ? `تعديل فاتورة شراء ${editingNo}` : "فاتورة مشتريات"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {editingId
              ? "سيُعاد ضبط المخزون والحركة المالية حسب الأصناف الجديدة"
              : "استلام البضاعة وتحديث المخزون"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setListMode(true)}>
            <Package className="w-4 h-4 ml-1" />
            سجل المشتريات
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setItems([blankItem()]);
              setForm(newForm());
              setEditingId(null);
              setEditingNo("");
              setAttachment(null);
            }}
          >
            <RefreshCw className="w-4 h-4 ml-1" />
            {editingId ? "إلغاء التعديل" : "جديدة"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* Left: Items Table */}
        <div className="space-y-4">
          {/* Items */}
          <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between gap-2">
              <span className="font-semibold text-sm">أصناف الفاتورة</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setScanOpen(true)}
                  className="gap-1.5"
                >
                  <ScanLine className="w-4 h-4" />
                  مسح باركود
                </Button>
                <Button variant="ghost" size="sm" onClick={addRow}>
                  <Plus className="w-4 h-4 ml-1" />
                  إضافة صنف
                </Button>
              </div>
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
                      ? products
                          .filter(
                            (p) =>
                              p.nameAr?.toLowerCase().includes(q) ||
                              p.name?.toLowerCase().includes(q) ||
                              p.barcode?.toLowerCase().includes(q),
                          )
                          .slice(0, 8)
                      : [];
                    return (
                      <tr key={idx} className="hover:bg-muted/10">
                        <td className="px-3 py-2 text-muted-foreground">
                          {idx + 1}
                        </td>
                        <td className="min-w-[180px] px-3 py-2">
                          <Popover
                            open={
                              showProductSearch === idx && filtered.length > 0
                            }
                            onOpenChange={(open) =>
                              setShowProductSearch(open ? idx : null)
                            }
                          >
                            <PopoverAnchor asChild>
                              <div className="flex items-center gap-1">
                                <input
                                  value={
                                    item.productName || searchQ[idx] || ""
                                  }
                                  onChange={(e) => {
                                    setSearchQ((prev) => ({
                                      ...prev,
                                      [idx]: e.target.value,
                                    }));
                                    updateItem(
                                      idx,
                                      "productName",
                                      e.target.value,
                                    );
                                    setShowProductSearch(idx);
                                  }}
                                  onFocus={() => setShowProductSearch(idx)}
                                  placeholder="اسم الصنف..."
                                  className="w-full rounded bg-transparent px-1 py-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowProductSearch(
                                      showProductSearch === idx ? null : idx,
                                    )
                                  }
                                  className="shrink-0 text-muted-foreground hover:text-primary"
                                  aria-label="البحث عن منتج"
                                >
                                  <Search className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </PopoverAnchor>
                            <PopoverContent
                              dir="rtl"
                              align="start"
                              side="bottom"
                              sideOffset={6}
                              collisionPadding={12}
                              onOpenAutoFocus={(event) =>
                                event.preventDefault()
                              }
                              onCloseAutoFocus={(event) =>
                                event.preventDefault()
                              }
                              className="max-h-[min(22rem,var(--radix-popover-content-available-height))] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto p-1"
                            >
                              {filtered.map((p) => (
                                <button
                                  type="button"
                                  key={p.id}
                                  onClick={() => selectProduct(idx, p)}
                                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-right text-sm hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none"
                                >
                                  <span className="flex min-w-0 items-center gap-2">
                                    <ProductSearchThumbnail product={p} />
                                    <span className="min-w-0">
                                      <span className="block break-words font-medium text-foreground">
                                        {p.nameAr || p.name}
                                      </span>
                                      <span className="block break-words text-[11px] text-muted-foreground">
                                        {p.barcode ? `${p.barcode} · ` : ""}
                                        {p.categoryName ||
                                          p.category ||
                                          "بدون قسم"}
                                      </span>
                                    </span>
                                  </span>
                                  <span className="shrink-0 text-left text-xs text-muted-foreground">
                                    <span className="block">
                                      {formatCurrency(p.costPrice || "0")}
                                    </span>
                                    <span className="block">
                                      مخزون: {p.stock}
                                    </span>
                                  </span>
                                </button>
                              ))}
                            </PopoverContent>
                          </Popover>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={item.quantity}
                            onChange={(e) =>
                              updateItem(idx, "quantity", e.target.value)
                            }
                            className="bg-background border border-border/30 rounded text-center w-20 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            value={item.costPrice}
                            onChange={(e) =>
                              updateItem(idx, "costPrice", e.target.value)
                            }
                            className="bg-background border border-border/30 rounded text-center w-24 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            value={item.salePrice}
                            onChange={(e) =>
                              updateItem(idx, "salePrice", e.target.value)
                            }
                            className="bg-background border border-border/30 rounded text-center w-24 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            value={item.discount}
                            onChange={(e) =>
                              updateItem(idx, "discount", e.target.value)
                            }
                            className="bg-background border border-border/30 rounded text-center w-20 px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2 text-center font-medium text-primary">
                          {formatCurrency(item.total)}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => removeRow(idx)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
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
              <Button
                variant="ghost"
                size="sm"
                onClick={addRow}
                className="text-muted-foreground"
              >
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
              <label className="text-xs text-muted-foreground mb-1 block">
                التاريخ
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date: e.target.value }))
                }
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                المورد
              </label>
              <select
                ref={firstFieldRef}
                value={form.supplierId}
                onChange={(e) => {
                  const id = e.target.value;
                  const sup = suppliers.find((s) => s.id.toString() === id);
                  setForm((f) => ({
                    ...f,
                    supplierId: id,
                    supplierName: sup?.name || "",
                  }));
                }}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">اختر مورد أو اكتب اسمه</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            {!form.supplierId && (
              <div>
                <input
                  value={form.supplierName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, supplierName: e.target.value }))
                  }
                  placeholder="اسم المورد (اختياري)"
                  className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setQuickSupplier(true)}
            >
              <Plus className="ml-1 h-4 w-4" />
              إنشاء مورد جديد
            </Button>
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
              <input
                type="number"
                min="0"
                value={form.discountAmount}
                onChange={(e) =>
                  setForm((f) => ({ ...f, discountAmount: e.target.value }))
                }
                className="bg-background border border-border/30 rounded px-2 py-1 text-sm w-28 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                dir="ltr"
              />
            </div>
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-muted-foreground">شحن</span>
              <input
                type="number"
                min="0"
                value={form.shippingCost}
                onChange={(e) =>
                  setForm((f) => ({ ...f, shippingCost: e.target.value }))
                }
                className="bg-background border border-border/30 rounded px-2 py-1 text-sm w-28 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                dir="ltr"
              />
            </div>
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-muted-foreground">ضريبة %</span>
              <input
                type="number"
                min="0"
                max="100"
                value={form.taxPct}
                onChange={(e) =>
                  setForm((f) => ({ ...f, taxPct: e.target.value }))
                }
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
            <div>
              <h3 className="font-semibold text-sm">ملخص الدفع الأولي</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                تُسجَّل الدفعة للموافقة المالية أولاً، ولا يتغيّر رصيد الصندوق أو المورد قبل التنفيذ.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      paymentMethod: m.value,
                    }))
                  }
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
              <label className="text-xs text-muted-foreground mb-1 block">
                الدفعة الأولى
              </label>
              <input
                type="number"
                min="0"
                value={form.paidAmount}
                onChange={(e) => {
                  const nextAmount = Math.min(
                    grandTotal,
                    Math.max(0, Number(e.target.value) || 0),
                  );
                  setForm((f) => ({
                    ...f,
                    paidAmount: String(nextAmount),
                  }));
                }}
                max={grandTotal}
                placeholder="0"
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                dir="ltr"
              />
            </div>
            {grandTotal > 0 && (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-muted/50 p-2.5">
                  <span className="block text-xs text-muted-foreground">إجمالي الفاتورة</span>
                  <strong>{formatCurrency(grandTotal)}</strong>
                </div>
                <div className="rounded-lg bg-amber-50/70 p-2.5 text-status-danger dark:bg-amber-950/20">
                  <span className="block text-xs text-muted-foreground">المتبقي على المورد</span>
                  <strong>{formatCurrency(remaining)}</strong>
                </div>
              </div>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              بعد الحفظ، افتح سجل المشتريات واختر «تسجيل دفعة» لإضافة دفعات جديدة ومراجعة سجل السداد.
            </p>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                ملاحظات
              </label>
              <textarea
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                rows={2}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                صورة / PDF الفاتورة (تُربط بالأصل)
              </label>
              {attachment ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">
                  <span className="flex items-center gap-1.5 truncate text-foreground">
                    <Paperclip className="w-4 h-4 shrink-0 text-primary" />
                    {attachment.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachment(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border/50 bg-background py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-primary">
                  <Paperclip className="w-4 h-4" /> إرفاق صورة أو PDF
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      try {
                        const url = file.type.startsWith("image/")
                          ? await compressImageFile(file, 1800, 0.85)
                          : await fileToDataUrl(file);
                        setAttachment({
                          url,
                          name: file.name,
                          type: file.type,
                        });
                      } catch {
                        toast({
                          title: "تعذّر قراءة الملف",
                          variant: "destructive",
                        });
                      }
                    }}
                  />
                </label>
              )}
            </div>
          </div>

          {/* Save */}
          <Button
            onClick={onSaveClick}
            disabled={saving}
            className="w-full bg-primary text-black hover:bg-primary/90 font-bold h-12 text-base"
          >
            {saving ? (
              <>
                <RefreshCw className="w-4 h-4 ml-2 animate-spin" />
                جاري الحفظ...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 ml-2" />
                حفظ فاتورة الشراء
              </>
            )}
          </Button>

          {customerPrompt ? (
            <CustomerAccountPrompt
              name={form.supplierName.trim()}
              onCancel={() => setCustomerPrompt(false)}
              onDecline={() => {
                setCustomerPrompt(false);
                void saveInvoice();
              }}
              onConfirm={() => {
                setCustomerPrompt(false);
                void saveInvoice();
              }}
            />
          ) : null}
        </div>
      </div>
      {quickSupplier && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          dir="rtl"
        >
          <div className="w-full max-w-md space-y-3 rounded-xl border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">مورد جديد</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setQuickSupplier(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <input
              autoFocus
              value={quickSupplierForm.name}
              onChange={(e) =>
                setQuickSupplierForm((f) => ({ ...f, name: e.target.value }))
              }
              placeholder="اسم المورد *"
              className="w-full rounded-lg border bg-background p-2 text-sm"
            />
            <input
              value={quickSupplierForm.company}
              onChange={(e) =>
                setQuickSupplierForm((f) => ({ ...f, company: e.target.value }))
              }
              placeholder="الشركة"
              className="w-full rounded-lg border bg-background p-2 text-sm"
            />
            <input
              value={quickSupplierForm.phone}
              onChange={(e) =>
                setQuickSupplierForm((f) => ({ ...f, phone: e.target.value }))
              }
              placeholder="الهاتف"
              className="w-full rounded-lg border bg-background p-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setQuickSupplier(false)}>
                إلغاء
              </Button>
              <Button onClick={createQuickSupplier}>حفظ واختيار</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type PurchasePaymentHistory = {
  id: number;
  transactionNo?: string | null;
  transactionDate: string;
  amount: string | number;
  direction: string;
  paymentMethod?: string | null;
  approvalStatus: string;
  referenceNo?: string | null;
  notes?: string | null;
  requestedByName?: string | null;
  executedByName?: string | null;
  executedAt?: string | null;
  attachments?: string[];
};

type PurchaseInvoiceDetails = PurchaseInvoice & {
  payments?: PurchasePaymentHistory[];
  paymentSummary?: {
    total: number;
    paidAmount: number;
    remainingAmount: number;
    paymentStatus: string;
    percentage: number;
  };
  supplierAccountSummary?: {
    outstandingBalance: number;
  };
};

const paymentMethodLabel: Record<string, string> = {
  cash: "نقداً",
  transfer: "تحويل",
  card: "بطاقة",
  pos: "نقطة بيع",
  other: "أخرى",
  credit: "آجل",
};

const paymentApprovalLabel: Record<string, string> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  approved: "معتمدة بانتظار التنفيذ",
  executed: "منفذة",
  rejected: "مرفوضة",
  reversed: "معكوسة",
};

function escapePurchasePrint(value: unknown) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function legacyPurchaseInvoiceStatementPrint(invoice: PurchaseInvoiceDetails, settings: any) {
  const popup = window.open("", "_blank", "noopener,noreferrer,width=920,height=900");
  if (!popup) throw new Error("يرجى السماح بالنوافذ المنبثقة للطباعة");
  const summary = invoice.paymentSummary ?? {
    total: Number(invoice.total ?? 0),
    paidAmount: Number(invoice.paidAmount ?? 0),
    remainingAmount: Number(invoice.remainingAmount ?? 0),
    paymentStatus: invoice.paymentStatus ?? "unpaid",
    percentage: 0,
  };
  const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
  const items = Array.isArray((invoice as any).items) ? (invoice as any).items : [];
  const rows = payments.length
    ? payments.map((payment, index) => `<tr>
        <td>${index + 1}</td><td>${escapePurchasePrint(payment.executedAt || payment.transactionDate)}</td>
        <td>${escapePurchasePrint(formatCurrency(payment.amount))}</td>
        <td>${escapePurchasePrint(paymentMethodLabel[payment.paymentMethod ?? ""] ?? payment.paymentMethod)}</td>
        <td>الصندوق الرئيسي</td><td>${escapePurchasePrint(payment.executedByName || payment.requestedByName)}</td>
        <td>${escapePurchasePrint(payment.notes)}</td><td>${escapePurchasePrint(paymentApprovalLabel[payment.approvalStatus] ?? payment.approvalStatus)}</td>
      </tr>`).join("")
    : '<tr><td colspan="8" class="empty">لا توجد دفعات مسجلة</td></tr>';
  const itemRows = items.map((item: any, index: number) => `<tr><td>${index + 1}</td><td>${escapePurchasePrint(item.productName || item.name)}</td><td>${escapePurchasePrint(item.quantity)}</td><td>${escapePurchasePrint(formatCurrency(item.costPrice || item.unitPrice || 0))}</td><td>${escapePurchasePrint(formatCurrency(item.total || 0))}</td></tr>`).join("");
  popup.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"/><title>كشف فاتورة شراء ${escapePurchasePrint(invoice.invoiceNo)}</title><style>
    @page { size: A4; margin: 13mm; } * { box-sizing: border-box; } body { font-family: Tahoma, Arial, sans-serif; color:#172033; font-size:12px; } h1,h2,p { margin:0; } .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #e25f52; padding-bottom:14px; margin-bottom:16px; } .brand { color:#c9463b; font-weight:700; font-size:18px; } .muted { color:#667085; margin-top:5px; } .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:9px; margin:14px 0; } .card { border:1px solid #e4e7ec; border-radius:8px; padding:10px; } .card strong { display:block; margin-top:5px; font-size:14px; } .remaining { background:#fff6e8; border-color:#f6c56b; } table { width:100%; border-collapse:collapse; margin-top:10px; } th,td { border:1px solid #e4e7ec; padding:7px; text-align:right; vertical-align:top; } th { background:#f8fafc; } .empty { text-align:center; color:#667085; padding:15px; } .section { margin-top:20px; } .footer { margin-top:24px; border-top:1px solid #e4e7ec; padding-top:9px; color:#667085; font-size:11px; }
  </style></head><body><header class="head"><div><h1>كشف فاتورة شراء</h1><p class="muted">${escapePurchasePrint(settings?.site_name || "AJN ERP")}</p></div><div><p><b>رقم الفاتورة:</b> ${escapePurchasePrint(invoice.invoiceNo)}</p><p class="muted">تاريخ الفاتورة: ${escapePurchasePrint(invoice.date)}</p></div></header>
  <section class="grid"><div class="card"><span>المورد</span><strong>${escapePurchasePrint(invoice.supplierName)}</strong></div><div class="card"><span>حالة الدفع</span><strong>${escapePurchasePrint(invoicePaymentLabel(summary.paymentStatus))}</strong></div><div class="card"><span>طريقة الدفع</span><strong>${escapePurchasePrint(paymentMethodLabel[invoice.paymentMethod ?? ""] ?? invoice.paymentMethod)}</strong></div></section>
  <section class="grid"><div class="card"><span>إجمالي الفاتورة</span><strong>${escapePurchasePrint(formatCurrency(summary.total))}</strong></div><div class="card"><span>إجمالي المدفوع المنفذ</span><strong>${escapePurchasePrint(formatCurrency(summary.paidAmount))}</strong></div><div class="card remaining"><span>المبلغ المتبقي</span><strong>${escapePurchasePrint(formatCurrency(summary.remainingAmount))}</strong></div></section>
  <section class="section"><h2>الأصناف المشتراة</h2><table><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>سعر الشراء</th><th>الإجمالي</th></tr></thead><tbody>${itemRows || '<tr><td colspan="5" class="empty">لا توجد أصناف</td></tr>'}</tbody></table></section>
  <section class="section"><h2>سجل الدفعات</h2><table><thead><tr><th>#</th><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>الصندوق</th><th>الموظف</th><th>الملاحظة</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></section><footer class="footer">تمت الطباعة في ${escapePurchasePrint(new Date().toLocaleString("en-CA"))}</footer></body></html>`);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 250);
}

function purchaseInvoicePrintInput(
  invoice: PurchaseInvoiceDetails,
  settings: any,
): PurchaseInvoiceStatementInput {
  const summary = invoice.paymentSummary ?? {
    total: Number(invoice.total ?? 0),
    paidAmount: Number(invoice.paidAmount ?? 0),
    remainingAmount: Number(invoice.remainingAmount ?? 0),
    paymentStatus: invoice.paymentStatus ?? "unpaid",
  };
  return {
    invoiceNo: invoice.invoiceNo,
    issuedAt: invoice.date,
    supplierName: invoice.supplierName,
    paymentMethod: invoice.paymentMethod,
    paymentStatus: summary.paymentStatus,
    employeeName: invoice.createdByName,
    items: Array.isArray((invoice as any).items)
      ? (invoice as any).items.map((item: any) => ({
          productName: item.productName || item.name || "—",
          quantity: item.quantity ?? 0,
          unitPrice: item.costPrice ?? item.unitPrice ?? 0,
          total: item.total ?? 0,
        }))
      : [],
    total: summary.total,
    paid: summary.paidAmount,
    remaining: summary.remainingAmount,
    supplierOutstanding: invoice.supplierAccountSummary?.outstandingBalance ?? 0,
    notes: invoice.notes,
    payments: (invoice.payments ?? []).map((payment) => ({
      date: payment.executedAt || payment.transactionDate,
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      employeeName: payment.executedByName || payment.requestedByName,
      notes: payment.notes,
      status: payment.approvalStatus,
    })),
    companyName: settings?.site_name || settings?.siteName,
    companyPhone: settings?.phone || settings?.site_phone,
    companyAddress: settings?.address || settings?.site_address,
    logoUrl: settings?.logo_url || settings?.logoUrl,
  };
}

function printPurchaseInvoiceStatement(
  invoice: PurchaseInvoiceDetails,
  settings: any,
) {
  openPurchaseInvoicePrintWindow(purchaseInvoicePrintInput(invoice, settings));
}

async function downloadPurchaseInvoicePdf(
  invoice: PurchaseInvoiceDetails,
  settings: any,
) {
  const element = createPurchaseInvoicePrintElement(
    purchaseInvoicePrintInput(invoice, settings),
  );
  document.body.appendChild(element);
  try {
    await downloadElementPdf(element, `purchase-invoice-${invoice.invoiceNo}.pdf`, {
      format: "a4",
      margin: 8,
      scale: 2,
      pagebreakMode: ["css", "legacy"],
    });
  } finally {
    element.remove();
  }
}

function invoicePaymentLabel(status: string) {
  return status === "paid" ? "مدفوع بالكامل" : status === "partial" ? "مدفوع جزئياً" : "غير مدفوع";
}

function PurchaseInvoicePaymentDialog({
  invoice,
  onClose,
  onChanged,
  settings,
}: {
  invoice: PurchaseInvoice | null;
  onClose: () => void;
  onChanged: () => void;
  settings?: any;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const detailsQuery = useQuery<PurchaseInvoiceDetails>({
    queryKey: ["admin", "purchase-invoice-details", invoice?.id],
    queryFn: () => adminFetch(`/admin/purchase-invoices/${invoice!.id}`),
    enabled: Boolean(invoice?.id),
  });
  const details = detailsQuery.data;
  const summary = details?.paymentSummary ?? {
    total: Number(details?.total ?? invoice?.total ?? 0),
    paidAmount: Number(details?.paidAmount ?? invoice?.paidAmount ?? 0),
    remainingAmount: Number(details?.remainingAmount ?? invoice?.remainingAmount ?? 0),
    paymentStatus: details?.paymentStatus ?? invoice?.paymentStatus ?? "unpaid",
    percentage: 0,
  };
  const enteredAmount = Number(amount || 0);
  const remainingAfter = Math.max(0, summary.remainingAmount - enteredAmount);
  const submitPayment = useMutation({
    mutationFn: () => {
      const requestKey = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `purchase-payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return adminFetch(`/admin/purchase-invoices/${invoice!.id}/payments`, {
        method: "POST",
        headers: { "x-idempotency-key": requestKey },
        body: JSON.stringify({
          amount: enteredAmount,
          date: paymentDate,
          paymentMethod,
          referenceNo: referenceNo.trim() || null,
          notes: notes.trim() || null,
          attachments: attachmentUrl.trim() ? [attachmentUrl.trim()] : [],
        }),
      });
    },
    onSuccess: async () => {
      toast({ title: "تم إرسال الدفعة للموافقة المالية" });
      setAmount(""); setReferenceNo(""); setNotes(""); setAttachmentUrl("");
      onChanged();
      await detailsQuery.refetch();
    },
    onError: (error) => toast({
      title: "تعذر تسجيل دفعة المورد",
      description: apiErrorMessage(error),
      variant: "destructive",
    }),
  });
  const close = () => {
    if (submitPayment.isPending) return;
    setAmount(""); setReferenceNo(""); setNotes(""); setAttachmentUrl("");
    onClose();
  };
  const history = details?.payments ?? [];
  const canSubmit = enteredAmount > 0 && enteredAmount <= summary.remainingAmount;
  const printCurrentInvoice = () => {
    if (!details) return;
    try {
      printPurchaseInvoiceStatement(details, settings);
    } catch (error) {
      toast({
        title: "تعذر فتح نافذة الطباعة",
        description: error instanceof Error ? error.message : "تعذر تجهيز الفاتورة",
        variant: "destructive",
      });
    }
  };
  const exportCurrentInvoicePdf = async () => {
    if (!details || exportingPdf) return;
    setExportingPdf(true);
    try {
      await downloadPurchaseInvoicePdf(details, settings);
      toast({ title: "تم حفظ فاتورة المشتريات بصيغة PDF" });
    } catch (error) {
      toast({
        title: "تعذر إنشاء ملف PDF",
        description: error instanceof Error ? error.message : "تعذر تجهيز الفاتورة",
        variant: "destructive",
      });
    } finally {
      setExportingPdf(false);
    }
  };
  return <Dialog open={Boolean(invoice)} onOpenChange={(open) => !open && close()}>
    <DialogContent dir="rtl" className="max-h-[92vh] max-w-5xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>تفاصيل فاتورة الشراء والدفع</DialogTitle>
      </DialogHeader>
      {detailsQuery.isLoading ? <p className="py-10 text-center text-muted-foreground">جارٍ تحميل تفاصيل الفاتورة...</p> : details ? <div className="space-y-5">
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={printCurrentInvoice}>
            <Printer className="h-4 w-4" />طباعة الفاتورة
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void exportCurrentInvoicePdf()} disabled={exportingPdf}>
            <FileDown className="h-4 w-4" />{exportingPdf ? "جارٍ إنشاء PDF..." : "حفظ PDF"}
          </Button>
        </div>
        <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-3">
          <div><p className="text-xs text-muted-foreground">رقم الفاتورة</p><b>{details.invoiceNo}</b></div>
          <div><p className="text-xs text-muted-foreground">المورد</p><b>{details.supplierName || "—"}</b></div>
          <div><p className="text-xs text-muted-foreground">تاريخ الفاتورة</p><b>{details.date}</b></div>
        </div>
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">ملخص حالة الدفع</h3><InvoicePaymentStatusBadge status={summary.paymentStatus} /></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <PaymentMetric title="إجمالي الفاتورة" value={formatCurrency(summary.total)} />
            <PaymentMetric title="إجمالي المدفوع" value={formatCurrency(summary.paidAmount)} />
            <PaymentMetric title="المبلغ المتبقي" value={formatCurrency(summary.remainingAmount)} emphasis />
            <PaymentMetric title="نسبة السداد" value={`${summary.percentage || (summary.total ? Math.round((summary.paidAmount / summary.total) * 100) : 0)}%`} />
            <PaymentMetric title="المتبقي للمورد" value={formatCurrency(details.supplierAccountSummary?.outstandingBalance ?? 0)} emphasis />
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, summary.percentage || (summary.total ? (summary.paidAmount / summary.total) * 100 : 0)))}%` }} /></div>
        </section>
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center gap-2"><Wallet className="h-4 w-4 text-primary" /><h3 className="font-semibold">تسجيل دفعة</h3></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <PaymentMetric title="المتبقي قبل الدفع" value={formatCurrency(summary.remainingAmount)} />
            <label className="grid gap-1 text-sm"><span>مبلغ الدفع *</span><input type="number" min="0" max={summary.remainingAmount} value={amount} onChange={(event) => setAmount(event.target.value)} className="rounded-lg border bg-background px-3 py-2" /></label>
            <PaymentMetric title="المتبقي بعد الدفع" value={formatCurrency(remainingAfter)} emphasis />
            <label className="grid gap-1 text-sm"><span>تاريخ الدفع *</span><input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="rounded-lg border bg-background px-3 py-2" /></label>
            <label className="grid gap-1 text-sm"><span>طريقة الدفع *</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="rounded-lg border bg-background px-3 py-2">{PAYMENT_METHODS.filter((method) => method.value !== "credit").map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
            <div className="grid gap-1 text-sm"><span>الصندوق / الحساب</span><div className="rounded-lg border bg-muted px-3 py-2">الصندوق الرئيسي</div></div>
            <label className="grid gap-1 text-sm"><span>رقم المرجع</span><input value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} className="rounded-lg border bg-background px-3 py-2" /></label>
            <label className="grid gap-1 text-sm"><span>رابط الوصل أو المرفق (اختياري)</span><input value={attachmentUrl} onChange={(event) => setAttachmentUrl(event.target.value)} className="rounded-lg border bg-background px-3 py-2" /></label>
            <label className="grid gap-1 text-sm sm:col-span-2 lg:col-span-3"><span>ملاحظة</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-20 rounded-lg border bg-background p-3" /></label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">يُسجل وقت التنفيذ الفعلي تلقائياً عند اعتماد الدفعة. لا يتغير رصيد المورد أو الصندوق قبل الاعتماد والتنفيذ.</p>
          <div className="mt-3 flex justify-end"><Button onClick={() => submitPayment.mutate()} disabled={!canSubmit || submitPayment.isPending || summary.remainingAmount <= 0}>{submitPayment.isPending ? "جارٍ الإرسال..." : "تسجيل دفعة جديدة"}</Button></div>
        </section>
        <section className="rounded-xl border bg-card p-4">
          <h3 className="mb-3 font-semibold">سجل الدفعات</h3>
          <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="p-2 text-right">#</th><th className="p-2 text-right">تاريخ الدفع</th><th className="p-2 text-right">المبلغ</th><th className="p-2 text-right">الطريقة</th><th className="p-2 text-right">الصندوق</th><th className="p-2 text-right">الموظف</th><th className="p-2 text-right">الملاحظة</th><th className="p-2 text-right">الحالة</th></tr></thead><tbody>{history.map((payment, index) => <tr key={payment.id} className="border-b"><td className="p-2">{index + 1}</td><td className="p-2">{payment.executedAt ? new Date(payment.executedAt).toLocaleString("en-CA") : payment.transactionDate}</td><td className="p-2 font-medium">{formatCurrency(payment.amount)}</td><td className="p-2">{paymentMethodLabel[payment.paymentMethod ?? ""] ?? payment.paymentMethod ?? "—"}</td><td className="p-2">الصندوق الرئيسي</td><td className="p-2">{payment.executedByName || payment.requestedByName || "—"}</td><td className="p-2">{payment.notes || "—"}</td><td className="p-2"><span className="rounded-full bg-muted px-2 py-1 text-xs">{paymentApprovalLabel[payment.approvalStatus] ?? payment.approvalStatus}</span></td></tr>)}{!history.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">لا توجد دفعات مسجلة لهذه الفاتورة.</td></tr>}</tbody><tfoot><tr><td colSpan={2} className="p-3 font-semibold">إجمالي المدفوع المنفذ</td><td className="p-3 font-bold text-emerald-700">{formatCurrency(summary.paidAmount)}</td><td colSpan={5} /></tr></tfoot></table></div>
        </section>
      </div> : <p className="py-10 text-center text-destructive">تعذر تحميل تفاصيل الفاتورة.</p>}
      <DialogFooter><Button variant="outline" onClick={close}>إغلاق</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function PaymentMetric({ title, value, emphasis = false }: { title: string; value: string; emphasis?: boolean }) {
  return <div className={`rounded-lg border p-3 ${emphasis ? "border-amber-400/50 bg-amber-50/40 dark:bg-amber-950/10" : "bg-muted/20"}`}><p className="text-xs text-muted-foreground">{title}</p><p className="mt-1 font-bold">{value}</p></div>;
}

// ── Purchase List Sub-View ─────────────────────────────────────────────────
function PurchaseListView({
  invoices,
  total,
  summary,
  page,
  onPage,
  from,
  to,
  onFrom,
  onTo,
  search,
  onSearch,
  paymentStatus,
  onPaymentStatus,
  paymentMethod,
  onPaymentMethod,
  invoiceStatus,
  onInvoiceStatus,
  branchId,
  onBranchId,
  cashBox,
  onCashBox,
  options,
  onBack,
  onDetails,
  onEdit,
  onPrint,
  onPdf,
  onDelete,
  loading,
  error,
  refreshing,
  onRefresh,
}: {
  invoices: PurchaseInvoice[];
  total: number;
  page: number;
  onPage: (p: number) => void;
  summary?: InvoiceRegisterSummary;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  search: string;
  onSearch: (v: string) => void;
  paymentStatus: string;
  onPaymentStatus: (v: string) => void;
  paymentMethod: string;
  onPaymentMethod: (v: string) => void;
  invoiceStatus: string;
  onInvoiceStatus: (v: string) => void;
  branchId: string;
  onBranchId: (v: string) => void;
  cashBox: string;
  onCashBox: (v: string) => void;
  options?: InvoiceRegisterOptions;
  onBack: () => void;
  onDetails: (inv: PurchaseInvoice) => void;
  onEdit: (inv: PurchaseInvoice) => void;
  onPrint: (inv: PurchaseInvoice) => void;
  onPdf: (inv: PurchaseInvoice) => void;
  onDelete: (inv: PurchaseInvoice) => void;
  loading: boolean;
  error: unknown;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / 20));
  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 ml-1" />
          رجوع
        </Button>
        <div>
          <h1 className="text-xl font-bold">سجل فواتير المشتريات</h1>
          <p className="text-xs text-muted-foreground">
            {loading ? "جارٍ تحميل السجل..." : `${total} فاتورة`}
          </p>
        </div>
      </div>
      <InvoiceRegisterSummaryCards summary={summary} loading={loading} />
      <div className="flex flex-wrap gap-3 bg-card rounded-xl border border-border/40 p-4">
        <div className="min-w-[280px] flex-1">
          <label className="text-xs text-muted-foreground mb-1 block">
            بحث
          </label>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                onSearch(e.target.value);
                onPage(1);
              }}
              placeholder="ابحث برقم الفاتورة، اسم المورد، الهاتف..."
              className="w-full bg-background border border-border/40 rounded-lg py-2 ps-3 pe-9 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            من تاريخ
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              onFrom(e.target.value);
              onPage(1);
            }}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            حالة الدفع
          </label>
          <select
            value={paymentStatus}
            onChange={(e) => {
              onPaymentStatus(e.target.value);
              onPage(1);
            }}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm"
          >
            {INVOICE_PAYMENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            طريقة الدفع
          </label>
          <select
            value={paymentMethod}
            onChange={(e) => {
              onPaymentMethod(e.target.value);
              onPage(1);
            }}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">الكل</option>
            {PAYMENT_METHODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            حالة الفاتورة
          </label>
          <select
            value={invoiceStatus}
            onChange={(e) => {
              onInvoiceStatus(e.target.value);
              onPage(1);
            }}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">الكل</option>
            <option value="active">نشطة</option>
            <option value="draft">مسودة</option>
          </select>
        </div>
        {!!options?.branches?.length && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              الفرع
            </label>
            <select
              value={branchId}
              onChange={(e) => {
                onBranchId(e.target.value);
                onPage(1);
              }}
              className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">الكل</option>
              {options.branches.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {!!options?.cashBoxes?.length && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              الصندوق
            </label>
            <select
              value={cashBox}
              onChange={(e) => {
                onCashBox(e.target.value);
                onPage(1);
              }}
              className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">الكل</option>
              {options.cashBoxes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            إلى تاريخ
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              onTo(e.target.value);
              onPage(1);
            }}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>
      <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
        {error ? (
          <PurchaseListLoadError
            error={error}
            onRetry={onRefresh}
            retrying={refreshing}
          />
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 text-muted-foreground text-xs">
                <th className="px-4 py-3 text-right">رقم الفاتورة</th>
                <th className="px-4 py-3 text-right">التاريخ</th>
                <th className="px-4 py-3 text-right">المورد</th>
                <th className="px-4 py-3 text-center">الإجمالي</th>
                <th className="px-4 py-3 text-center">المدفوع</th>
                <th className="px-4 py-3 text-center">المتبقي</th>
                <th className="px-4 py-3 text-center">الدفع</th>
                <th className="px-4 py-3 text-center">الحالة</th>
                <th className="px-4 py-3 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {loading ? (
                <tr>
                  <td
                    colSpan={9}
                    className="py-10 text-center text-muted-foreground"
                  >
                    جارٍ تحميل فواتير المشتريات...
                  </td>
                </tr>
              ) : error ? null : invoices.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="text-center py-10 text-muted-foreground"
                  >
                    لا توجد فواتير مطابقة.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-muted/10">
                    <td className="px-4 py-3 font-mono text-primary font-medium">
                      {inv.invoiceNo}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {inv.date}
                    </td>
                    <td className="px-4 py-3">{inv.supplierName || "—"}</td>
                    <td className="px-4 py-3 text-center font-medium">
                      {formatCurrency(inv.total)}
                    </td>
                    <td className="px-4 py-3 text-center text-status-success">
                      {formatCurrency(inv.paidAmount)}
                    </td>
                    <td className="px-4 py-3 text-center text-status-warning">
                      {formatCurrency(inv.remainingAmount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <PayBadge status={inv.paymentStatus} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${inv.status === "active" ? "bg-status-success/10 text-status-success" : inv.status === "draft" ? "bg-status-warning/10 text-status-warning" : "bg-status-danger/10 text-status-danger"}`}
                      >
                        {inv.status === "active"
                          ? "نشطة"
                          : inv.status === "draft"
                            ? "مسودة"
                            : "محذوفة"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onDetails(inv)}
                          title="تفاصيل وسداد"
                          className="text-primary"
                        >
                          <Wallet className="w-4 h-4" />
                          تسجيل دفعة
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onPrint(inv)}
                          title="طباعة"
                        >
                          <Printer className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onPdf(inv)}
                          title="حفظ PDF"
                        >
                          <FileDown className="w-4 h-4" />
                        </Button>
                        {inv.status === "active" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEdit(inv)}
                            title="تعديل"
                            className="text-primary"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        ) : null}
                        {inv.status === "active" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDelete(inv)}
                            title="حذف"
                            className="text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {invoices.length > 0 && (
              <TableTotalsFooter
                rows={invoices}
                labelColSpan={3}
                cells={[
                  {
                    key: "total",
                    label: "إجمالي المشتريات",
                    value: (invoice) => Number(invoice.total ?? 0),
                    format: formatCurrency,
                  },
                  {
                    key: "paid",
                    label: "إجمالي المدفوع",
                    value: (invoice) => Number(invoice.paidAmount ?? 0),
                    format: formatCurrency,
                  },
                  {
                    key: "remaining",
                    label: "إجمالي المتبقي",
                    value: (invoice) => Number(invoice.remainingAmount ?? 0),
                    format: formatCurrency,
                  },
                  { key: "payment", label: "" },
                  { key: "status", label: "" },
                  { key: "actions", label: "" },
                ]}
              />
            )}
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 p-3 border-t border-border/20">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              صفحة {page} من {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPage(page + 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PurchaseListLoadError({
  error,
  onRetry,
  retrying,
}: {
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
}) {
  const status = apiErrorStatus(error);
  const permissionDenied = status === 401 || status === 403;
  const message = permissionDenied
    ? "ليس لديك صلاحية عرض سجل فواتير المشتريات."
    : "تعذر تحميل فواتير المشتريات. لم يتم اعتبار ذلك نتيجة بحث فارغة.";
  return (
    <div
      className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      <span>
        {message}
        {!permissionDenied && apiErrorMessage(error)
          ? ` ${apiErrorMessage(error)}`
          : ""}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "جارٍ إعادة المحاولة..." : "إعادة المحاولة"}
      </Button>
    </div>
  );
}

function PayBadge({ status }: { status: string }) {
  return <InvoicePaymentStatusBadge status={status} />;
}
