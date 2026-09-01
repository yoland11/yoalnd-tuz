import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListGallery, useCreateGalleryItem, useDeleteGalleryItem,
  getListGalleryQueryKey,
} from "@workspace/api-client-react";
import { Plus, Trash2, X, Eye, FolderOpen, ImageIcon, RotateCcw, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "./_layout";
import { usePublicSettings } from "@/lib/public-settings";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import type { ImageMetadata } from "@/lib/image-tools";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "./_lib";

const DEFAULT_GALLERY_SECTIONS = ["عام", "كوشات", "تصوير", "تخرج", "ورود", "تجهيزات", "ديكور", "دعوات"];
const normalizedCategory = (category?: string | null) => {
  const value = category?.trim();
  return !value || value === "general" ? "عام" : value;
};

export default function GalleryPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: items, isLoading, isError, refetch } = useListGallery({});
  const create = useCreateGalleryItem();
  const del = useDeleteGalleryItem();
  const [form, setForm] = useState<{ mediaUrl: string; mediaType: string; titleAr: string; category: string; imageMetadata?: ImageMetadata }>({ mediaUrl: "", mediaType: "image", titleAr: "", category: "عام", imageMetadata: {} });
  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const { data: publicSettings } = usePublicSettings();

  const renameCategory = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => adminFetch("/gallery/categories", {
      method: "PATCH",
      body: JSON.stringify({ from, to }),
    }),
    onSuccess: (result: any, variables) => {
      invalidate();
      setActiveCategory(variables.to);
      setEditingCategory(null);
      toast({ title: "تم تعديل القسم", description: `تم تحديث ${Number(result?.updatedCount ?? 0)} صورة.` });
    },
    onError: (err: any) => toast({ title: "تعذر تعديل القسم", description: err?.message, variant: "destructive" }),
  });

  const sections = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items ?? []) {
      const category = normalizedCategory(item.category);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    const values = [...new Set([...DEFAULT_GALLERY_SECTIONS, ...counts.keys()])];
    return values.map((value) => ({ value, label: value, count: counts.get(value) ?? 0 }));
  }, [items]);
  const visibleItems = useMemo(
    () => activeCategory === "all" ? (items ?? []) : (items ?? []).filter((item) => normalizedCategory(item.category) === activeCategory),
    [activeCategory, items],
  );

  function invalidate() { qc.invalidateQueries({ queryKey: getListGalleryQueryKey() }); }

  function openCategoryEdit(value: string) {
    setEditingCategory(value);
    setCategoryDraft(value);
  }

  function submitCategoryEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCategory) return;
    const to = normalizedCategory(categoryDraft);
    if (to === editingCategory) {
      toast({ title: "لم يتغير اسم القسم" });
      return;
    }
    renameCategory.mutate({ from: editingCategory, to });
  }

  function handleFileResult(results: ImageEditResult[]) {
    const result = results[0];
    if (!result) return;
    setForm(f => ({
      ...f,
      mediaUrl: result.dataUrl,
      mediaType: result.dataUrl.startsWith("data:video") ? "video" : "image",
      imageMetadata: result.metadata,
    }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const category = normalizedCategory(form.category);
    create.mutate({ data: { ...form, category } }, {
      onSuccess: () => { invalidate(); setActiveCategory(category); setShowForm(false); setForm({ mediaUrl: "", mediaType: "image", titleAr: "", category: "عام", imageMetadata: {} }); toast({ title: "تمت إضافة الوسائط" }); },
      onError: (err: any) => toast({ title: "تعذر إضافة الوسائط", description: err?.message, variant: "destructive" }),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">الصور والملفات</h1>
          <p className="mt-1 text-sm text-muted-foreground">رتّب الصور ضمن أقسام ليسهل العثور عليها وعرضها.</p>
        </div>
        <Button onClick={() => setShowForm(true)} size="sm" className="gap-2"><Plus className="w-4 h-4" /> إضافة</Button>
      </div>

      <section className="rounded-2xl border border-border/45 bg-card p-3" aria-label="أقسام معرض الصور">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><FolderOpen className="h-4 w-4 text-primary" /> الأقسام</div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="تصفية صور المعرض حسب القسم">
          <Button
            type="button"
            size="sm"
            variant={activeCategory === "all" ? "default" : "outline"}
            className="shrink-0 gap-1.5"
            role="tab"
            aria-selected={activeCategory === "all"}
            onClick={() => setActiveCategory("all")}
          >
            <ImageIcon className="h-3.5 w-3.5" /> كل الصور <span className="text-xs opacity-80">{items?.length ?? 0}</span>
          </Button>
          {sections.map((section) => (
            <div key={section.value} className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border/50 bg-background p-0.5">
              <Button
                type="button"
                size="sm"
                variant={activeCategory === section.value ? "default" : "ghost"}
                className="gap-1.5 border-0 shadow-none"
                role="tab"
                aria-selected={activeCategory === section.value}
                onClick={() => setActiveCategory(section.value)}
              >
                {section.label} <span className="text-xs opacity-80">{section.count}</span>
              </Button>
              <button
                type="button"
                aria-label={`تعديل قسم ${section.label}`}
                title={`تعديل قسم ${section.label}`}
                onClick={() => openCategoryEdit(section.value)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {isLoading ? <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{[1,2,3,4,5,6].map(i => <Skeleton key={i} className="aspect-square rounded-xl" />)}</div>
      : isError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-8 text-center">
          <p className="font-semibold text-foreground">تعذر تحميل معرض الصور</p>
          <p className="mt-1 text-sm text-muted-foreground">لم يتم عرض حالة فارغة بدلاً من الخطأ.</p>
          <Button type="button" variant="outline" size="sm" className="mt-4 gap-2" onClick={() => refetch()}><RotateCcw className="h-4 w-4" /> إعادة المحاولة</Button>
        </div>
      ) : !items || items.length === 0 ? <EmptyState /> : visibleItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 px-5 py-10 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold text-foreground">لا توجد صور في قسم {activeCategory}</p>
          <p className="mt-1 text-sm text-muted-foreground">أضف صورة جديدة واختر هذا القسم لتظهر هنا.</p>
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => setActiveCategory("all")}>عرض كل الصور</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {visibleItems.map(item => (
            <div key={item.id} className="relative group bg-card rounded-xl overflow-hidden border border-border/30">
              {item.mediaType === "video"
                ? <video src={item.mediaUrl} className="w-full aspect-square object-cover" />
                : <img src={item.mediaUrl} alt={item.titleAr ?? ""} className="w-full aspect-square" style={{ objectFit: (item as any).imageMetadata?.objectFit ?? "cover" }} />}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                <button type="button" aria-label={`معاينة ${item.titleAr ?? "الصورة"}`} onClick={() => setPreview(item.mediaUrl)} className="p-2 rounded-full bg-primary/20 text-primary hover:bg-primary/30">
                  <Eye className="w-4 h-4" />
                </button>
                <button type="button" aria-label={`حذف ${item.titleAr ?? "الصورة"}`} onClick={() => confirm("حذف؟") && del.mutateAsync({ id: item.id }).then(invalidate).catch((err: any) => toast({ title: "تعذر الحذف", description: err?.message, variant: "destructive" }))}
                  className="p-2 rounded-full bg-status-danger/20 text-status-danger hover:bg-status-danger/30">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">{normalizedCategory(item.category)}</span>
              {item.titleAr && <p className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent text-white text-xs p-2 truncate">{item.titleAr}</p>}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={() => setShowForm(false)}>
          <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-card border border-border/40 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-foreground">إضافة وسائط</h3>
              <button type="button" onClick={() => setShowForm(false)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            <ImageUploadEditor
              kind="gallery"
              label="اختر صورة أو فيديو"
              accept="image/*,video/*"
              allowVideo
              currentImage={form.mediaType === "image" ? form.mediaUrl : null}
              currentMetadata={form.imageMetadata}
              settings={publicSettings?.image_settings}
              watermarkText={publicSettings?.site_name}
              onComplete={handleFileResult}
              onRemove={() => setForm(f => ({ ...f, mediaUrl: "", imageMetadata: {} }))}
            />
            {form.mediaUrl && (
              form.mediaType === "video"
                ? <video src={form.mediaUrl} className="w-full h-40 object-cover rounded-lg" controls />
                : <img src={form.mediaUrl} className="w-full h-40 rounded-lg" style={{ objectFit: form.imageMetadata?.objectFit ?? "cover" }} alt="" />
            )}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">أو الصق رابط URL</label>
              <input value={form.mediaUrl.startsWith("data:") ? "" : form.mediaUrl}
                onChange={e => setForm(f => ({ ...f, mediaUrl: e.target.value }))}
                placeholder="https://..."
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">العنوان</label>
                <input value={form.titleAr} onChange={e => setForm(f => ({ ...f, titleAr: e.target.value }))}
                  className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              </div>
              <div>
                <label htmlFor="gallery-category" className="block text-xs text-muted-foreground mb-1">القسم</label>
                <input id="gallery-category" list="gallery-category-options" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  placeholder="مثال: كوشات"
                  className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                <datalist id="gallery-category-options">{sections.map(section => <option key={section.value} value={section.label} />)}</datalist>
                <p className="mt-1 text-[11px] text-muted-foreground">اختر قسماً موجوداً أو اكتب اسماً جديداً.</p>
              </div>
            </div>
            <Button type="submit" disabled={!form.mediaUrl || create.isPending} className="w-full">
              {create.isPending ? "جاري الحفظ..." : "إضافة"}
            </Button>
          </form>
        </div>
      )}

      {editingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" dir="rtl" onClick={() => setEditingCategory(null)}>
          <form onSubmit={submitCategoryEdit} onClick={e => e.stopPropagation()} className="w-full max-w-sm space-y-4 rounded-2xl border border-border/40 bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-foreground">تعديل القسم</h3>
              <button type="button" aria-label="إغلاق" onClick={() => setEditingCategory(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div>
              <label htmlFor="gallery-category-edit" className="mb-1 block text-xs text-muted-foreground">اسم القسم</label>
              <input id="gallery-category-edit" autoFocus value={categoryDraft} onChange={e => setCategoryDraft(e.target.value)} maxLength={50} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              <p className="mt-1 text-[11px] text-muted-foreground">سيتم تحديث الصور التابعة لهذا القسم فقط.</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingCategory(null)}>إلغاء</Button>
              <Button type="submit" disabled={!categoryDraft.trim() || renameCategory.isPending}>{renameCategory.isPending ? "جاري الحفظ..." : "حفظ التعديل"}</Button>
            </div>
          </form>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <button onClick={() => setPreview(null)} className="absolute top-4 right-4 text-white"><X className="w-6 h-6" /></button>
          {preview.match(/\.(mp4|webm|mov)$/i) || preview.startsWith("data:video")
            ? <video src={preview} className="max-w-full max-h-full" controls autoPlay />
            : <img src={preview} className="max-w-full max-h-full object-contain" alt="" />}
        </div>
      )}
    </div>
  );
}
