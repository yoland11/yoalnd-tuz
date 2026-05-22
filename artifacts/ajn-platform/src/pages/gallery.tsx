import { useState } from "react";
import { useListGallery, useListGalleryCategories } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { X, ChevronLeft, ChevronRight, Play, Image } from "lucide-react";

export default function Gallery() {
  const [activeCategory, setActiveCategory] = useState<string | undefined>(undefined);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const { data: categories } = useListGalleryCategories();
  const { data: items, isLoading } = useListGallery(
    activeCategory ? { category: activeCategory } : {}
  );

  const allItems = items ?? [];

  function openPreview(index: number) {
    setPreviewIndex(index);
    document.body.style.overflow = "hidden";
  }

  function closePreview() {
    setPreviewIndex(null);
    document.body.style.overflow = "";
  }

  function prev() {
    setPreviewIndex(i => i !== null ? (i - 1 + allItems.length) % allItems.length : null);
  }

  function next() {
    setPreviewIndex(i => i !== null ? (i + 1) % allItems.length : null);
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <div className="border-b border-border/30 py-10">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl font-bold text-foreground mb-2">أعمالنا</h1>
          <p className="text-muted-foreground">لمحة من إبداعاتنا في تزيين المناسبات</p>
        </div>
      </div>

      {/* Category Filter */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/20 py-3">
        <div className="container mx-auto px-4">
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button
              onClick={() => setActiveCategory(undefined)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm transition-colors ${
                !activeCategory
                  ? "bg-primary text-primary-foreground"
                  : "border border-border/40 text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              الكل
            </button>
            {categories?.map(cat => (
              <button
                key={cat.name}
                onClick={() => setActiveCategory(cat.name)}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm transition-colors ${
                  activeCategory === cat.name
                    ? "bg-primary text-primary-foreground"
                    : "border border-border/40 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {cat.name} ({cat.count})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Gallery Grid */}
      <div className="container mx-auto px-4 py-8">
        {isLoading ? (
          <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="rounded-xl break-inside-avoid" style={{ height: `${200 + (i % 3) * 80}px` }} />
            ))}
          </div>
        ) : allItems.length === 0 ? (
          <div className="text-center py-20">
            <Image className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">لا توجد صور في هذا التصنيف</p>
          </div>
        ) : (
          <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
            {allItems.map((item, index) => (
              <div
                key={item.id}
                className="break-inside-avoid relative group cursor-pointer rounded-xl overflow-hidden bg-card border border-border/20 hover:border-primary/30 transition-all duration-300"
                onClick={() => openPreview(index)}
              >
                {item.mediaType === "video" ? (
                  <div className="relative aspect-video bg-muted flex items-center justify-center">
                    <Play className="w-12 h-12 text-white/80" />
                    {item.mediaUrl.includes("youtube") || item.mediaUrl.includes("youtu.be") ? (
                      <img
                        src={`https://img.youtube.com/vi/${extractYoutubeId(item.mediaUrl)}/hqdefault.jpg`}
                        alt={item.titleAr ?? ""}
                        className="absolute inset-0 w-full h-full object-cover opacity-60"
                      />
                    ) : null}
                  </div>
                ) : (
                  <img
                    src={item.mediaUrl}
                    alt={item.titleAr ?? ""}
                    className="w-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                )}
                {item.titleAr && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-white text-sm font-medium">{item.titleAr}</p>
                    <p className="text-white/60 text-xs">{item.category}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fullscreen Preview */}
      {previewIndex !== null && allItems[previewIndex] && (
        <div
          className="fixed inset-0 z-50 bg-black/97 flex items-center justify-center"
          onClick={closePreview}
        >
          <button
            className="absolute top-4 right-4 text-white/60 hover:text-white z-10"
            onClick={closePreview}
          >
            <X className="w-8 h-8" />
          </button>

          <button
            className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white p-3 rounded-full transition-colors z-10"
            onClick={(e) => { e.stopPropagation(); prev(); }}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white p-3 rounded-full transition-colors z-10"
            onClick={(e) => { e.stopPropagation(); next(); }}
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          <div className="max-w-5xl w-full px-16" onClick={e => e.stopPropagation()}>
            {allItems[previewIndex].mediaType === "video" ? (
              <video src={allItems[previewIndex].mediaUrl} controls className="w-full max-h-[80vh] rounded-xl" />
            ) : (
              <img
                src={allItems[previewIndex].mediaUrl}
                alt={allItems[previewIndex].titleAr ?? ""}
                className="w-full max-h-[80vh] object-contain rounded-xl"
              />
            )}
            {allItems[previewIndex].titleAr && (
              <p className="text-white/70 text-center mt-4 text-sm">{allItems[previewIndex].titleAr}</p>
            )}
          </div>

          <div className="absolute bottom-6 flex gap-1.5">
            {allItems.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setPreviewIndex(i); }}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === previewIndex ? "bg-primary" : "bg-white/30"}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function extractYoutubeId(url: string): string {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
  return match ? match[1] : "";
}
