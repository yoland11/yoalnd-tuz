import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Trash2, X, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, compressImageFile } from "./_lib";
import { EmptyState } from "./_layout";

type Service = {
  id: number; name: string; nameAr: string;
  description: string | null; descriptionAr: string | null;
  type: string; icon: string | null; image: string | null;
  isActive: boolean; sortOrder?: number;
};

const SERVICE_TYPES = [
  { value: "kosha", label: "كوشات" },
  { value: "photography", label: "تصوير" },
  { value: "graduation", label: "تجهيزات تخرج" },
  { value: "albums", label: "ألبومات" },
  { value: "distributions", label: "توزيعات" },
  { value: "research", label: "بحوث" },
  { value: "other", label: "أخرى" },
];

export default function ServicesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Partial<Service> | null>(null);

  const { data: services, isLoading } = useQuery({
    queryKey: ["admin", "services"],
    queryFn: () => adminFetch<Service[]>("/admin/services"),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin", "services"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
  }

  const save = useMutation({
    mutationFn: (svc: Partial<Service>) =>
      svc.id
        ? adminFetch(`/admin/services/${svc.id}`, { method: "PATCH", body: JSON.stringify(svc) })
        : adminFetch("/admin/services", { method: "POST", body: JSON.stringify(svc) }),
    onSuccess: () => { invalidate(); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/services/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const toggleActive = useMutation({
    mutationFn: (s: Service) =>
      adminFetch(`/admin/services/${s.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !s.isActive }) }),
    onSuccess: invalidate,
  });

  async function handleImageUpload(file: File) {
    const dataUrl = await compressImageFile(file);
    setEditing(e => ({ ...e!, image: dataUrl }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">إدارة الخدمات</h1>
        <Button onClick={() => setEditing({ name: "", nameAr: "", type: "kosha", isActive: true })} size="sm" className="gap-2">
          <Plus className="w-4 h-4" /> إضافة خدمة
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : !services || services.length === 0 ? <EmptyState /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map(s => (
            <div key={s.id} className="bg-card rounded-xl border border-border/30 overflow-hidden flex flex-col">
              {s.image && <img src={s.image} alt={s.nameAr} className="w-full h-32 object-cover" />}
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-bold text-foreground">{s.nameAr}</h3>
                    <p className="text-xs text-muted-foreground">{SERVICE_TYPES.find(t => t.value === s.type)?.label ?? s.type}</p>
                  </div>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={s.isActive} onChange={() => toggleActive.mutate(s)} className="accent-primary" />
                    <span className="text-xs text-muted-foreground">نشط</span>
                  </label>
                </div>
                {s.descriptionAr && <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{s.descriptionAr}</p>}
                <div className="flex items-center gap-2 mt-auto">
                  <button onClick={() => setEditing(s)} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20">
                    <Edit2 className="w-3.5 h-3.5" /> تعديل
                  </button>
                  <button onClick={() => confirm("حذف الخدمة؟") && del.mutate(s.id)} className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={() => setEditing(null)}>
          <form
            onSubmit={e => { e.preventDefault(); save.mutate(editing); }}
            onClick={e => e.stopPropagation()}
            className="bg-card border border-border/40 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-foreground">{editing.id ? "تعديل خدمة" : "خدمة جديدة"}</h3>
              <button type="button" onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <Field label="الاسم بالعربي *" value={editing.nameAr ?? ""} onChange={v => setEditing(e => ({ ...e!, nameAr: v }))} required />
            <Field label="الاسم بالإنجليزي *" value={editing.name ?? ""} onChange={v => setEditing(e => ({ ...e!, name: v }))} required />
            <div>
              <label className="block text-xs text-muted-foreground mb-1">النوع *</label>
              <select value={editing.type ?? "kosha"} onChange={e => setEditing(s => ({ ...s!, type: e.target.value }))}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50">
                {SERVICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <Field label="وصف عربي" textarea value={editing.descriptionAr ?? ""} onChange={v => setEditing(e => ({ ...e!, descriptionAr: v }))} />
            <Field label="رمز الأيقونة (lucide)" value={editing.icon ?? ""} onChange={v => setEditing(e => ({ ...e!, icon: v }))} />
            <div>
              <label className="block text-xs text-muted-foreground mb-1">صورة الخدمة</label>
              {editing.image && <img src={editing.image} className="h-24 w-full rounded-lg object-cover mb-2" alt="" />}
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); e.dataTransfer.files?.[0] && handleImageUpload(e.dataTransfer.files[0]); }}
                className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/40 bg-background/40 py-5 text-sm text-foreground cursor-pointer hover:border-primary/50"
              >
                <Upload className="w-4 h-4 text-primary" />
                رفع أو سحب صورة
                <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0])} className="hidden" />
              </label>
              <input type="text" placeholder="أو ضع رابط URL" value={editing.image ?? ""} onChange={e => setEditing(s => ({ ...s!, image: e.target.value }))}
                className="w-full mt-2 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.isActive ?? true} onChange={e => setEditing(s => ({ ...s!, isActive: e.target.checked }))} className="accent-primary" />
              نشط (يظهر للزبائن)
            </label>
            <Button type="submit" disabled={save.isPending} className="w-full">
              {save.isPending ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, required = false, textarea = false }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; textarea?: boolean }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      {textarea ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} required={required} rows={3}
          className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
      ) : (
        <input value={value} onChange={e => onChange(e.target.value)} required={required}
          className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
      )}
    </div>
  );
}
