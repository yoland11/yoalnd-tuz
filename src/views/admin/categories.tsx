import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Trash2, X, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type Category = { id: number; name: string; nameAr: string; slug: string; parentId: number | null; sortOrder: number; isActive: boolean };

export default function CategoriesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminFetch<Category[]>("/admin/categories"),
  });
  const [editing, setEditing] = useState<Partial<Category> | null>(null);

  const save = useMutation({
    mutationFn: (c: Partial<Category>) => c.id
      ? adminFetch(`/admin/categories/${c.id}`, { method: "PATCH", body: JSON.stringify(c) })
      : adminFetch("/admin/categories", { method: "POST", body: JSON.stringify(c) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "categories"] }); setEditing(null); },
  });
  const del = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "categories"] }),
  });

  const parents = data?.filter(c => !c.parentId) ?? [];
  const childrenByParent = new Map<number, Category[]>();
  for (const c of data ?? []) {
    if (c.parentId) {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">التصنيفات</h1>
        <div className="flex gap-2">
          <Button onClick={() => setEditing({ name: "", nameAr: "", slug: "", isActive: true, sortOrder: 0 })} size="sm" className="gap-2">
            <Plus className="w-4 h-4" /> قسم رئيسي
          </Button>
        </div>
      </div>

      {isLoading ? <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      : parents.length === 0 ? <EmptyState message="لا توجد تصنيفات — ابدأ بإضافة قسم رئيسي" /> : (
        <div className="space-y-3">
          {parents.map(p => (
            <div key={p.id} className="bg-card rounded-xl border border-border/30 overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-border/20">
                <div className="flex items-center gap-3">
                  <Tag className="w-4 h-4 text-primary" />
                  <div>
                    <p className="font-bold text-foreground">{p.nameAr}</p>
                    <p className="text-xs text-muted-foreground">{p.slug}</p>
                  </div>
                  {!p.isActive && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">مخفي</span>}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setEditing({ name: "", nameAr: "", slug: "", parentId: p.id, isActive: true, sortOrder: 0 })}
                    className="text-xs px-2 py-1 rounded-lg text-primary hover:bg-primary/10 inline-flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> فرعي
                  </button>
                  <button onClick={() => setEditing(p)} className="text-primary hover:bg-primary/10 p-2 rounded-lg"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => confirm("حذف القسم؟") && del.mutate(p.id)} className="text-red-400 hover:bg-red-500/10 p-2 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="p-3 space-y-1">
                {(childrenByParent.get(p.id) ?? []).map(c => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 hover:bg-background/30 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">↳</span>
                      <span className="text-sm text-foreground">{c.nameAr}</span>
                      <span className="text-xs text-muted-foreground">{c.slug}</span>
                      {!c.isActive && <span className="text-xs text-red-400">(مخفي)</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setEditing(c)} className="text-primary hover:bg-primary/10 p-1.5 rounded"><Edit2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => confirm("حذف؟") && del.mutate(c.id)} className="text-red-400 hover:bg-red-500/10 p-1.5 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
                {!(childrenByParent.get(p.id)?.length) && <p className="text-xs text-muted-foreground text-center py-2">لا توجد أقسام فرعية</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={() => setEditing(null)}>
          <form onSubmit={e => { e.preventDefault(); save.mutate(editing); }} onClick={e => e.stopPropagation()}
            className="bg-card border border-border/40 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-foreground">{editing.id ? "تعديل" : "جديد"} {editing.parentId ? "(فرعي)" : ""}</h3>
              <button type="button" onClick={() => setEditing(null)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            <Field label="الاسم بالعربي *" value={editing.nameAr ?? ""} onChange={v => setEditing(s => ({ ...s!, nameAr: v }))} required />
            <Field label="الاسم بالإنجليزي *" value={editing.name ?? ""} onChange={v => setEditing(s => ({ ...s!, name: v }))} required />
            <Field label="السلاج (slug فريد) *" value={editing.slug ?? ""} onChange={v => setEditing(s => ({ ...s!, slug: v }))} required />
            <Field label="الترتيب" type="number" value={String(editing.sortOrder ?? 0)} onChange={v => setEditing(s => ({ ...s!, sortOrder: parseInt(v) || 0 }))} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.isActive ?? true} onChange={e => setEditing(s => ({ ...s!, isActive: e.target.checked }))} className="accent-primary" />
              نشط
            </label>
            <Button type="submit" disabled={save.isPending} className="w-full">{save.isPending ? "جاري الحفظ..." : "حفظ"}</Button>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
    </div>
  );
}
