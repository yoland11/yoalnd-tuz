import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListGallery, useCreateGalleryItem, useDeleteGalleryItem,
  getListGalleryQueryKey,
} from "@workspace/api-client-react";
import { Plus, Trash2, X, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "./_layout";
import { usePublicSettings } from "@/lib/public-settings";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import type { ImageMetadata } from "@/lib/image-tools";

export default function GalleryPage() {
  const qc = useQueryClient();
  const { data: items, isLoading } = useListGallery({});
  const create = useCreateGalleryItem();
  const del = useDeleteGalleryItem();
  const [form, setForm] = useState<{ mediaUrl: string; mediaType: string; titleAr: string; category: string; imageMetadata?: ImageMetadata }>({ mediaUrl: "", mediaType: "image", titleAr: "", category: "عام", imageMetadata: {} });
  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const { data: publicSettings } = usePublicSettings();

  function invalidate() { qc.invalidateQueries({ queryKey: getListGalleryQueryKey() }); }

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
    create.mutate({ data: form }, {
      onSuccess: () => { invalidate(); setShowForm(false); setForm({ mediaUrl: "", mediaType: "image", titleAr: "", category: "عام", imageMetadata: {} }); },
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">الصور والملفات</h1>
        <Button onClick={() => setShowForm(true)} size="sm" className="gap-2"><Plus className="w-4 h-4" /> إضافة</Button>
      </div>

      {isLoading ? <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{[1,2,3,4,5,6].map(i => <Skeleton key={i} className="aspect-square rounded-xl" />)}</div>
      : !items || items.length === 0 ? <EmptyState /> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map(item => (
            <div key={item.id} className="relative group bg-card rounded-xl overflow-hidden border border-border/30">
              {item.mediaType === "video"
                ? <video src={item.mediaUrl} className="w-full aspect-square object-cover" />
                : <img src={item.mediaUrl} alt={item.titleAr ?? ""} className="w-full aspect-square" style={{ objectFit: (item as any).imageMetadata?.objectFit ?? "cover" }} />}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                <button onClick={() => setPreview(item.mediaUrl)} className="p-2 rounded-full bg-primary/20 text-primary hover:bg-primary/30">
                  <Eye className="w-4 h-4" />
                </button>
                <button onClick={() => confirm("حذف؟") && del.mutateAsync({ id: item.id }).then(invalidate)}
                  className="p-2 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
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
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">العنوان</label>
                <input value={form.titleAr} onChange={e => setForm(f => ({ ...f, titleAr: e.target.value }))}
                  className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">التصنيف</label>
                <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
              </div>
            </div>
            <Button type="submit" disabled={!form.mediaUrl || create.isPending} className="w-full">
              {create.isPending ? "جاري الحفظ..." : "إضافة"}
            </Button>
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
