import { useEffect, useState } from "react";
import { Boxes, Package, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { adminFetch, apiErrorMessage } from "./_lib";
import type { PreparationDraftItem } from "@/server/preparation-requests";

const departments = [
  ["kosha", "الكوشات"], ["flowers", "الزهور"], ["lighting", "الإضاءة"], ["sound", "الصوتيات"],
  ["photography", "التصوير"], ["gifts", "الهدايا"], ["graduation", "التخرج"], ["equipment", "المعدات"], ["other", "أخرى"],
] as const;
type CatalogRow = { id: number; name: string; nameAr: string; barcode: string | null; available: number | null };
const inputClass = "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";

export function PreparationItemPicker({ onAdd }: { onAdd: (item: PreparationDraftItem) => void }) {
  const [source, setSource] = useState<PreparationDraftItem["source"]>("custom");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<CatalogRow | null>(null);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("other");
  const [quantity, setQuantity] = useState("1");
  const [infoOnly, setInfoOnly] = useState(false);
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(search.trim()), 250); return () => window.clearTimeout(timer); }, [search]);
  const catalog = useQuery<{ products: CatalogRow[] }>({
    queryKey: ["admin", "preparation-catalog", source, debounced],
    queryFn: () => adminFetch(`/admin/preparation/catalog?source=${source}&search=${encodeURIComponent(debounced)}`),
    enabled: source !== "custom", staleTime: 30_000,
  });
  const changeSource = (next: PreparationDraftItem["source"]) => { setSource(next); setSelected(null); setName(""); setSearch(""); setLocalError(""); };
  const add = () => {
    const count = Number(quantity);
    if (!Number.isSafeInteger(count) || count < 1) { setLocalError("الكمية يجب أن تكون عدداً صحيحاً موجباً"); return; }
    if (source === "custom" && !name.trim()) { setLocalError("اكتب اسم العنصر"); return; }
    if (source !== "custom" && !selected) { setLocalError("اختر عنصراً من القائمة"); return; }
    onAdd({ source, productId: selected?.id ?? null, name: selected ? (selected.nameAr || selected.name) : name.trim(), sku: selected?.barcode ?? null, department, quantity: count, infoOnly, note: note.trim() || null });
    setLocalError(""); setName(""); setSelected(null); setSearch(""); setQuantity("1"); setNote("");
  };
  return <div dir="rtl" className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3">
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="مصدر عنصر التجهيز">
      {([ ["custom", "من عندي", Plus], ["product", "من المتجر", Package], ["asset", "من الأصول", Boxes] ] as const).map(([value, label, Icon]) =>
        <Button key={value} type="button" variant={source === value ? "default" : "outline"} className="h-10 gap-1 rounded-xl text-xs" onClick={() => changeSource(value)}><Icon className="h-3.5 w-3.5" />{label}</Button>)}
    </div>
    {source === "custom" ? <label className="block space-y-1 text-xs font-medium"><span>اسم العنصر</span><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: ديكور خاص" maxLength={300} /></label> : <div className="space-y-2">
      <label className="relative block"><Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" /><input className={`${inputClass} pr-9`} value={search} onChange={(event) => { setSearch(event.target.value); setSelected(null); }} placeholder={source === "asset" ? "ابحث عن أصل…" : "ابحث عن منتج…"} /></label>
      {catalog.isLoading ? <p className="text-xs text-muted-foreground">جارٍ تحميل العناصر…</p> : catalog.isError ? <p role="alert" className="text-xs text-destructive">{apiErrorMessage(catalog.error, "تعذّر تحميل العناصر")} <Button variant="link" type="button" onClick={() => void catalog.refetch()}>إعادة المحاولة</Button></p> : <div className="max-h-40 space-y-1 overflow-y-auto">
        {(catalog.data?.products ?? []).map((item) => <button key={item.id} type="button" onClick={() => setSelected(item)} className={`flex w-full justify-between gap-2 rounded-lg border px-3 py-2 text-right text-xs ${selected?.id === item.id ? "border-primary bg-primary/10" : "border-border bg-background"}`}><span>{item.nameAr || item.name}<small className="block text-[11px] text-muted-foreground">المتاح حالياً للعلم: {item.available == null ? "—" : item.available.toLocaleString("en-US")}</small></span><span className="font-mono text-muted-foreground" dir="ltr">{item.barcode}</span></button>)}
        {!catalog.data?.products.length ? <p className="text-xs text-muted-foreground">لا توجد نتائج مطابقة</p> : null}
      </div>}
    </div>}
    <div className="grid gap-2 sm:grid-cols-2"><label className="space-y-1 text-xs"><span>القسم</span><select className={inputClass} value={department} onChange={(event) => setDepartment(event.target.value)}>{departments.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="space-y-1 text-xs"><span>الكمية</span><input className={inputClass} type="number" min={1} step={1} inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label></div>
    <label className="block space-y-1 text-xs"><span>ملاحظة (اختياري)</span><input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} /></label>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={infoOnly} onChange={(event) => setInfoOnly(event.target.checked)} />للعلم فقط — لا يُحسب في التقدم</label>
    {localError ? <p role="alert" className="text-xs text-destructive">{localError}</p> : null}
    <Button type="button" onClick={add} className="h-10 w-full rounded-xl"><Plus className="h-4 w-4" /> إضافة عنصر للقائمة</Button>
  </div>;
}
