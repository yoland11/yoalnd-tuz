import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ALBUM_CATALOG_KINDS, type AlbumCatalogKind } from "@/lib/albums";
import { queryClient } from "@/lib/query-client";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import { ErrorBlock, LoadingBlock, albumKeys, money, type CatalogOption } from "./shared";

type SettingsData = { catalog: CatalogOption[]; canEdit: boolean; canSeeMoney: boolean };

export function AlbumSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [kind, setKind] = useState<AlbumCatalogKind>("type");
  const settings = useQuery({ queryKey: albumKeys.settings, queryFn: () => adminFetch<SettingsData>("/admin/albums/settings"), enabled: open });
  const refresh = (data: { catalog: CatalogOption[] }) => {
    queryClient.setQueryData<SettingsData>(albumKeys.settings, (current) => (current ? { ...current, catalog: data.catalog } : current));
    void queryClient.invalidateQueries({ queryKey: albumKeys.meta });
  };
  const presets = useMutation({
    mutationFn: () => adminFetch<{ added: number; catalog: CatalogOption[] }>("/admin/albums/settings/presets", { method: "POST", body: "{}" }),
    onSuccess: (data) => { refresh(data); toast({ title: data.added ? `أُضيف ${data.added} خياراً مقترحاً` : "كل الخيارات المقترحة موجودة", description: "عدّل الأسعار والتكاليف حسب محلّك" }); },
    onError: (error) => toast({ title: "تعذّر الإضافة", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const list = (settings.data?.catalog ?? []).filter((option) => option.kind === kind);
  const canEdit = Boolean(settings.data?.canEdit);
  const canMoney = Boolean(settings.data?.canSeeMoney);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92dvh] w-[min(calc(100%-2rem),56rem)] overflow-y-auto">
        <DialogHeader className="text-right">
          <DialogTitle>إعدادات الألبومات</DialogTitle>
          <DialogDescription>المواصفات وأسعارها الافتراضية وتكاليف التصنيع، ومادة المخزون التي تُصرف لكل نسخة. لا شيء مثبت في النظام: كل خيار هنا قابل للتعديل والإيقاف.</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-wrap gap-1.5" role="tablist" aria-label="أنواع الإعدادات">
          {ALBUM_CATALOG_KINDS.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={kind === item.key} onClick={() => setKind(item.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors duration-150 ${kind === item.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {item.label} <span className="tabular-nums opacity-70">{(settings.data?.catalog ?? []).filter((option) => option.kind === item.key).length}</span>
            </button>
          ))}
        </div>
        {settings.isLoading ? <LoadingBlock /> : settings.isError ? <ErrorBlock message={apiErrorMessage(settings.error)} onRetry={() => void settings.refetch()} /> : (
          <div className="min-w-0 space-y-3">
            {!(settings.data?.catalog.length) && canEdit ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-sm">
                <p className="font-bold">لم تُضف مواصفات بعد</p>
                <p className="mt-1 text-muted-foreground">ابدأ بخيارات شائعة (أنواع، قياسات، أغلفة، ورق…) ثم عدّل أسماءها وأسعارها.</p>
                <Button type="button" size="sm" className="mt-3" disabled={presets.isPending} onClick={() => presets.mutate()}>{presets.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}إضافة خيارات مقترحة</Button>
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[620px] table-fixed text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2 text-right font-bold">الاسم</th>{canMoney ? <><th className="w-32 px-3 py-2 text-right font-bold">السعر الافتراضي</th><th className="w-32 px-3 py-2 text-right font-bold">تكلفة التصنيع</th></> : null}<th className="w-40 px-3 py-2 text-right font-bold">مادة المخزون</th><th className="w-24 px-3 py-2 text-right font-bold">الحالة</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.map((option) => <OptionRow key={option.id} option={option} canEdit={canEdit} canMoney={canMoney} onSaved={refresh} />)}
                  {!list.length ? <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">لا توجد خيارات في هذا القسم</td></tr> : null}
                </tbody>
              </table>
            </div>
            {canEdit ? <NewOption kind={kind} canMoney={canMoney} onSaved={refresh} /> : <p className="text-xs text-muted-foreground">العرض فقط — التعديل يحتاج صلاحية «الألبومات: الإنشاء والتعديل والتكليف والإعدادات».</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OptionRow({ option, canEdit, canMoney, onSaved }: { option: CatalogOption; canEdit: boolean; canMoney: boolean; onSaved: (data: { catalog: CatalogOption[] }) => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState({ label: option.label, defaultPrice: option.defaultPrice, manufacturingCost: option.manufacturingCost });
  useEffect(() => setDraft({ label: option.label, defaultPrice: option.defaultPrice, manufacturingCost: option.manufacturingCost }), [option]);
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => adminFetch<{ catalog: CatalogOption[] }>(`/admin/albums/settings/${option.id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: onSaved,
    onError: (error) => { setDraft({ label: option.label, defaultPrice: option.defaultPrice, manufacturingCost: option.manufacturingCost }); toast({ title: "لم يُحفظ", description: apiErrorMessage(error), variant: "destructive" }); },
  });
  const commit = (key: "label" | "defaultPrice" | "manufacturingCost") => {
    if (String(draft[key]) === String(option[key])) return;
    save.mutate({ [key]: draft[key] });
  };
  return (
    <tr className={option.isActive ? "" : "opacity-60"}>
      <td className="px-3 py-1.5">{canEdit ? <Input aria-label="الاسم" value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} onBlur={() => commit("label")} className="h-9" /> : option.label}</td>
      {canMoney ? <>
        <td className="px-3 py-1.5">{canEdit ? <Input aria-label="السعر الافتراضي" inputMode="decimal" dir="ltr" className="h-9 text-right tabular-nums" value={draft.defaultPrice} onChange={(event) => setDraft((current) => ({ ...current, defaultPrice: event.target.value }))} onBlur={() => commit("defaultPrice")} /> : money(option.defaultPrice)}</td>
        <td className="px-3 py-1.5">{canEdit ? <Input aria-label="تكلفة التصنيع" inputMode="decimal" dir="ltr" className="h-9 text-right tabular-nums" value={draft.manufacturingCost} onChange={(event) => setDraft((current) => ({ ...current, manufacturingCost: event.target.value }))} onBlur={() => commit("manufacturingCost")} /> : money(option.manufacturingCost)}</td>
      </> : null}
      <td className="px-3 py-1.5 text-xs">{canEdit ? <ProductLink option={option} onPick={(productId) => save.mutate({ productId })} /> : option.productName ?? "—"}</td>
      <td className="px-3 py-1.5">
        {canEdit ? <button type="button" onClick={() => save.mutate({ isActive: !option.isActive })} disabled={save.isPending} className={`rounded-full px-2.5 py-1 text-xs font-bold ${option.isActive ? "bg-status-success/15 text-status-success" : "bg-muted text-muted-foreground"}`}>{option.isActive ? "فعّال" : "موقوف"}</button>
          : <span className="text-xs">{option.isActive ? "فعّال" : "موقوف"}</span>}
      </td>
    </tr>
  );
}

function ProductLink({ option, onPick }: { option: CatalogOption; onPick: (productId: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [term, setTerm] = useState("");
  const search = useQuery({
    queryKey: ["albums", "products", term],
    queryFn: () => adminFetch<{ products: Array<{ id: number; name: string; stock: number }> }>(`/admin/albums/products?q=${encodeURIComponent(term)}`),
    enabled: editing && term.trim().length >= 1,
  });
  if (!editing)
    return (
      <span className="flex items-center gap-1.5">
        <span className="truncate">{option.productName ?? "—"}</span>
        <button type="button" className="font-bold text-primary" onClick={() => setEditing(true)}>{option.productId ? "تغيير" : "ربط"}</button>
        {option.productId ? <button type="button" className="text-muted-foreground" onClick={() => onPick(null)}>إزالة</button> : null}
      </span>
    );
  return (
    <div className="relative">
      <Input autoFocus aria-label="بحث عن مادة" className="h-8" value={term} onChange={(event) => setTerm(event.target.value)} onBlur={() => window.setTimeout(() => setEditing(false), 150)} placeholder="اسم المادة" />
      {search.data?.products.length ? (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {search.data.products.map((product) => <li key={product.id}><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onPick(product.id); setEditing(false); }} className="w-full rounded px-2 py-1.5 text-right hover:bg-muted">{product.name}</button></li>)}
        </ul>
      ) : null}
    </div>
  );
}

function NewOption({ kind, canMoney, onSaved }: { kind: AlbumCatalogKind; canMoney: boolean; onSaved: (data: { catalog: CatalogOption[] }) => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ label: "", defaultPrice: "", manufacturingCost: "" });
  const add = useMutation({
    mutationFn: () => adminFetch<{ catalog: CatalogOption[] }>("/admin/albums/settings", { method: "POST", body: JSON.stringify({ kind, label: form.label, ...(canMoney ? { defaultPrice: form.defaultPrice || 0, manufacturingCost: form.manufacturingCost || 0 } : {}) }) }),
    onSuccess: (data) => { onSaved(data); setForm({ label: "", defaultPrice: "", manufacturingCost: "" }); },
    onError: (error) => toast({ title: "لم يُضف الخيار", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return (
    <form className="flex flex-wrap items-end gap-2 rounded-xl bg-muted/40 p-3" onSubmit={(event) => { event.preventDefault(); if (form.label.trim()) add.mutate(); }}>
      <label className="min-w-[10rem] flex-1 space-y-1 text-xs font-bold">خيار جديد<Input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder={kind === "size" ? "30 × 40" : kind === "page_count" ? "40" : "الاسم"} /></label>
      {canMoney ? <>
        <label className="w-32 space-y-1 text-xs font-bold">السعر<Input inputMode="decimal" dir="ltr" className="text-right" value={form.defaultPrice} onChange={(event) => setForm((current) => ({ ...current, defaultPrice: event.target.value }))} /></label>
        <label className="w-32 space-y-1 text-xs font-bold">التكلفة<Input inputMode="decimal" dir="ltr" className="text-right" value={form.manufacturingCost} onChange={(event) => setForm((current) => ({ ...current, manufacturingCost: event.target.value }))} /></label>
      </> : null}
      <Button type="submit" disabled={add.isPending || !form.label.trim()}>{add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}إضافة</Button>
    </form>
  );
}
