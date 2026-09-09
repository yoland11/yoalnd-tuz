import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Barcode,
  Check,
  ChevronDown,
  ChevronLeft,
  FileText,
  Package,
  Plus,
  ReceiptText,
  Save,
  Search,
  ShoppingBag,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const surface = "rounded-[20px] border border-[#E9E5E2] bg-white shadow-[0_6px_24px_rgba(24,32,51,0.04)]";
const input = "h-11 rounded-xl border border-[#E9E5E2] bg-[#FCFBFA] px-3 text-sm text-[#182033] outline-none transition focus:border-[#B85C65]/60 focus:ring-2 focus:ring-[#B85C65]/10";

export type SalesCatalogItem = {
  id: number;
  name: string;
  nameAr?: string;
  price: string | number;
  stock: string | number;
  barcode?: string;
  images?: string[];
  category?: string;
  categoryId?: number | null;
};

export type SalesCartLine = {
  productName: string;
  barcode: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  discountPct: number;
  total: number;
};

export function salesCategoryLabel(product: SalesCatalogItem) {
  const label = String(product.category ?? "").trim();
  return label || "غير مصنف";
}

export function salesCategories(products: SalesCatalogItem[]) {
  return Array.from(new Set(products.map(salesCategoryLabel))).sort((a, b) => a.localeCompare(b, "ar"));
}

export function filterSalesProducts<T extends Pick<SalesCatalogItem, "name" | "nameAr" | "barcode">>(products: T[], query: string) {
  const normalized = query.trim().toLocaleLowerCase("ar");
  if (!normalized) return products;
  return products.filter((product) => [product.nameAr, product.name, product.barcode]
    .some((value) => String(value ?? "").toLocaleLowerCase("ar").includes(normalized)));
}

export function SearchableProductSelect({ products, value, selectedLabel, loading, disabled, onSelect }: { products: SalesCatalogItem[]; value: number | null; selectedLabel?: string; loading?: boolean; disabled?: boolean; onSelect: (productId: number) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = products.find((product) => product.id === value);
  const results = useMemo(() => filterSalesProducts(products, query).slice(0, 40), [products, query]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (product: SalesCatalogItem) => {
    onSelect(product.id);
    setQuery("");
    setOpen(false);
  };

  return <div ref={rootRef} className="relative">
    <button type="button" disabled={disabled || loading} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-[#E9E5E2] bg-white px-3 text-right text-sm text-[#182033] outline-none transition hover:border-[#C7A36A]/60 focus:border-[#B85C65]/60 focus:ring-2 focus:ring-[#B85C65]/10 disabled:cursor-wait">
      <span className="min-w-0 truncate">{loading ? "جارٍ تحميل المنتجات..." : selected ? (selected.nameAr || selected.name) : selectedLabel || "اكتب للبحث عن منتج"}</span>
      <ChevronDown className={`h-4 w-4 shrink-0 text-[#778092] transition ${open ? "rotate-180" : ""}`} />
    </button>
    {open ? <div className="absolute inset-x-0 top-[calc(100%+6px)] z-[90] overflow-hidden rounded-2xl border border-[#E9E5E2] bg-white shadow-[0_18px_50px_rgba(24,32,51,0.16)]">
      <div className="relative border-b border-[#E9E5E2] p-2">
        <Search className="absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#778092]" />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "Enter" && results[0]) choose(results[0]); }} placeholder="ابحث بالاسم أو الباركود..." className="h-10 w-full rounded-xl bg-[#F8F7F5] pr-10 pl-3 text-sm outline-none focus:ring-2 focus:ring-[#B85C65]/10" />
      </div>
      <div role="listbox" className="max-h-64 overflow-y-auto p-1.5 [scrollbar-width:thin]">
        {results.length ? results.map((product) => <button key={product.id} type="button" role="option" aria-selected={product.id === value} onClick={() => choose(product)} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-right hover:bg-[#FBF5F3]">
          <span className="min-w-0"><span className="block truncate font-medium text-[#182033]">{product.nameAr || product.name}</span><span className="mt-0.5 block truncate text-xs text-[#778092]" dir="ltr">{product.barcode || "بدون باركود"}</span></span>
          {product.id === value ? <Check className="h-4 w-4 shrink-0 text-[#3F9A76]" /> : <span className="shrink-0 text-xs font-medium text-[#806333]">{product.stock} متوفر</span>}
        </button>) : <p className="px-3 py-8 text-center text-sm text-[#778092]">لا يوجد منتج مطابق للبحث.</p>}
      </div>
    </div> : null}
  </div>;
}

export function SalesInvoiceHeader({ children }: { children?: ReactNode }) {
  return (
    <header className={`${surface} relative overflow-hidden px-5 py-5 sm:px-6`}>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-[radial-gradient(circle_at_left,#F4EBDD_0,transparent_68%)] opacity-80" />
      <div className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#F9ECEC] text-[#B85C65] ring-1 ring-[#E8B8BC]/50">
            <ShoppingBag className="h-6 w-6" />
          </span>
          <div>
            <nav aria-label="مسار الصفحة" className="mb-1 flex items-center gap-1 text-[11px] text-[#778092]">
              <span>الرئيسية</span><ChevronLeft className="h-3 w-3" /><span>المبيعات</span><ChevronLeft className="h-3 w-3" /><span>فاتورة مبيعات</span>
            </nav>
            <h1 className="text-2xl font-bold tracking-tight text-[#182033] sm:text-[30px]">فاتورة مبيعات</h1>
            <p className="mt-1 text-sm text-[#778092]">نقطة البيع • إصدار فاتورة احترافية وسريعة</p>
          </div>
        </div>
        {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
      </div>
    </header>
  );
}

export function InvoiceActionBar({ children }: { children: ReactNode }) {
  return <div className={`${surface} flex flex-wrap items-center gap-2 p-3`}>{children}</div>;
}

export function InvoiceSectionCard({ title, icon, description, children, className = "" }: { title: string; icon?: ReactNode; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`${surface} ${className}`}>
      <div className="flex items-start gap-2 border-b border-[#E9E5E2]/80 px-4 py-3.5">
        {icon ? <span className="mt-0.5 text-[#B85C65]">{icon}</span> : null}
        <div><h2 className="font-semibold text-[#182033]">{title}</h2>{description ? <p className="mt-0.5 text-xs text-[#778092]">{description}</p> : null}</div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function ProductCategoryChips({ categories, value, onChange }: { categories: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]" aria-label="أقسام المنتجات">
      {["الكل", ...categories].map((category) => {
        const active = value === category || (!value && category === "الكل");
        return <button key={category} type="button" aria-pressed={active} onClick={() => onChange(category === "الكل" ? "" : category)} className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${active ? "border-[#B85C65]/40 bg-[#F9ECEC] text-[#9E4650]" : "border-[#E9E5E2] bg-white text-[#657084] hover:border-[#C7A36A]/60 hover:bg-[#F4EBDD]/50"}`}>{category}</button>;
      })}
    </div>
  );
}

function LineThumbnail({ source, alt }: { source?: string; alt: string }) {
  return source ? <img src={source} alt={alt} className="h-14 w-14 rounded-xl border border-[#E9E5E2] bg-[#F8F7F5] object-cover" loading="lazy" /> : <span className="grid h-14 w-14 place-items-center rounded-xl border border-[#E9E5E2] bg-[#F8F7F5] text-[#C7A36A]"><Package className="h-5 w-5" /></span>;
}

export function InvoiceItemsCard({ items, imageForLine, formatMoney, onUpdate, onRemove, disabled }: { items: SalesCartLine[]; imageForLine?: (line: SalesCartLine) => string | undefined; formatMoney: (value: number) => string; onUpdate: (index: number, field: keyof SalesCartLine, value: string) => void; onRemove: (index: number) => void; disabled?: boolean }) {
  const quantity = (index: number, value: number) => onUpdate(index, "quantity", String(Math.max(0.001, Math.round(value * 1000) / 1000)));
  return (
    <section className={`${surface} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-[#E9E5E2] px-4 py-4">
        <div className="flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-[#B85C65]" /><h2 className="font-semibold text-[#182033]">منتجات الفاتورة</h2><span className="rounded-full bg-[#F4EBDD] px-2.5 py-1 text-xs text-[#806333]">{items.length} منتجات</span></div>
      </div>
      {!items.length ? <div className="grid min-h-56 place-items-center p-8 text-center"><div><span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#FBF5F3] text-[#B85C65]"><ShoppingCart className="h-7 w-7" /></span><h3 className="mt-4 font-semibold text-[#182033]">لم يتم إضافة أي منتجات بعد</h3><p className="mt-1 max-w-sm text-sm text-[#778092]">ابحث عن منتج بالاسم أو امسح الباركود أو أضف منتجاً يدوياً</p></div></div> : <>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[920px] text-sm"><thead className="bg-[#FBF5F3] text-xs text-[#778092]"><tr><th className="p-3 text-right">المنتج</th><th className="p-3">الكمية</th><th className="p-3">السعر</th><th className="p-3">خصم %</th><th className="p-3">الخصم</th><th className="p-3">الإجمالي</th><th className="p-3"><span className="sr-only">إجراءات</span></th></tr></thead><tbody className="divide-y divide-[#E9E5E2]/70">{items.map((line, index) => <tr key={`${line.barcode}-${index}`} className="transition-colors hover:bg-[#F8F7F5]/80"><td className="p-3"><div className="flex items-center gap-3"><LineThumbnail source={imageForLine?.(line)} alt={line.productName} /><div className="min-w-0"><input aria-label={`اسم المنتج ${index + 1}`} value={line.productName} onChange={e => onUpdate(index, "productName", e.target.value)} className="w-full min-w-40 bg-transparent font-semibold text-[#182033] outline-none" />{line.barcode ? <span className="mt-1 flex items-center gap-1 text-xs text-[#778092]" dir="ltr"><Barcode className="h-3 w-3" />{line.barcode}</span> : null}</div></div></td><td className="p-3"><div className="mx-auto flex w-28 items-center justify-between rounded-xl border border-[#E9E5E2] bg-[#FCFBFA] p-1"><button type="button" aria-label="تقليل الكمية" disabled={disabled} onClick={() => quantity(index, line.quantity - 1)} className="grid h-8 w-8 place-items-center rounded-lg text-[#778092] hover:bg-white">−</button><input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e => onUpdate(index, "quantity", e.target.value)} className="w-12 bg-transparent text-center font-semibold outline-none" /><button type="button" aria-label="زيادة الكمية" disabled={disabled} onClick={() => quantity(index, line.quantity + 1)} className="grid h-8 w-8 place-items-center rounded-lg text-[#B85C65] hover:bg-white">+</button></div></td>{(["unitPrice", "discountPct", "discount"] as const).map(field => <td className="p-3" key={field}><input type="number" min="0" max={field === "discountPct" ? 100 : undefined} value={line[field]} onChange={e => onUpdate(index, field, e.target.value)} className={`${input} mx-auto w-24 text-center`} /></td>)}<td className="p-3 text-center font-bold text-[#182033]">{formatMoney(line.total)}</td><td className="p-3"><button type="button" aria-label={`حذف ${line.productName}`} disabled={disabled} onClick={() => onRemove(index)} className="grid h-10 w-10 place-items-center rounded-xl text-[#D75A5A] hover:bg-red-50"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>
        <div className="space-y-3 p-3 md:hidden">{items.map((line, index) => <article key={`${line.barcode}-${index}`} className="rounded-2xl border border-[#E9E5E2] bg-[#FCFBFA] p-3"><div className="flex gap-3"><LineThumbnail source={imageForLine?.(line)} alt={line.productName} /><div className="min-w-0 flex-1"><input value={line.productName} onChange={e => onUpdate(index, "productName", e.target.value)} className="w-full bg-transparent font-semibold text-[#182033] outline-none" />{line.barcode ? <p className="mt-1 text-xs text-[#778092]" dir="ltr">{line.barcode}</p> : null}</div><button type="button" aria-label={`حذف ${line.productName}`} onClick={() => onRemove(index)} className="h-10 text-[#D75A5A]"><Trash2 className="h-4 w-4" /></button></div><div className="mt-3 flex items-center justify-between"><div className="flex items-center rounded-xl border border-[#E9E5E2] bg-white p-1"><button type="button" className="h-8 w-8" onClick={() => quantity(index, line.quantity - 1)}>−</button><input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e => onUpdate(index, "quantity", e.target.value)} className="w-14 bg-transparent text-center outline-none" /><button type="button" className="h-8 w-8 text-[#B85C65]" onClick={() => quantity(index, line.quantity + 1)}>+</button></div><strong className="text-[#182033]">{formatMoney(line.total)}</strong></div></article>)}</div>
      </>}
    </section>
  );
}

export function InvoiceTotalsCard({ children, total }: { children: ReactNode; total: string }) {
  return <section className={`${surface} overflow-hidden`}><div className="flex items-center gap-2 border-b border-[#E9E5E2] px-4 py-3.5"><ReceiptText className="h-5 w-5 text-[#C7A36A]" /><h2 className="font-semibold text-[#182033]">الإجماليات</h2></div><div className="space-y-3 p-4">{children}<div className="mt-4 rounded-2xl border border-[#E8B8BC]/50 bg-[#F9ECEC] p-4"><p className="text-xs text-[#778092]">الإجمالي الكلي</p><p className="mt-1 text-2xl font-bold text-[#182033]" dir="ltr">{total}</p></div></div></section>;
}

export function InvoiceSaveActions({ saving, disabled, onSave, onSavePrint, canPrint }: { saving: boolean; disabled: boolean; onSave: () => void; onSavePrint: () => void; canPrint: boolean }) {
  return <div className={`${surface} sticky bottom-3 z-20 hidden grid-cols-2 gap-2 p-3 md:grid`}><Button onClick={onSave} disabled={disabled} className="h-12 rounded-xl bg-[#B85C65] font-bold text-white hover:bg-[#A64D57]">{saving ? "جاري الحفظ..." : <><Save className="ml-2 h-4 w-4" />حفظ الفاتورة</>}</Button><Button variant="outline" onClick={onSavePrint} disabled={disabled || !canPrint} className="h-12 rounded-xl border-[#C7A36A]/50 text-[#806333]"><FileText className="ml-2 h-4 w-4" />حفظ وطباعة</Button></div>;
}

export function InvoiceMobileSaveBar({ total, saving, disabled, onSave }: { total: string; saving: boolean; disabled: boolean; onSave: () => void }) {
  return <div className="fixed inset-x-3 bottom-3 z-40 flex items-center gap-3 rounded-2xl border border-[#E9E5E2] bg-white/95 p-3 shadow-[0_12px_36px_rgba(24,32,51,0.16)] backdrop-blur md:hidden"><div className="min-w-0 flex-1"><p className="text-[11px] text-[#778092]">الإجمالي</p><p className="truncate font-bold text-[#182033]" dir="ltr">{total}</p></div><Button onClick={onSave} disabled={disabled} className="h-11 rounded-xl bg-[#B85C65] px-5 text-white hover:bg-[#A64D57]"><Save className="ml-2 h-4 w-4" />{saving ? "حفظ..." : "حفظ الفاتورة"}</Button></div>;
}

export const premiumSalesInputClass = input;
export const premiumSalesSurfaceClass = surface;
