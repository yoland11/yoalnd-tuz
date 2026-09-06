import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Expand } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type RtlViewerImage = {
  id: string | number;
  url: string;
  caption?: string | null;
  uploader?: string | null;
  timestamp?: string | null;
};

function imageLabel(image: RtlViewerImage, fallback: string): string {
  return image.caption?.trim() || fallback;
}

function displayTimestamp(value?: string | null): string {
  if (!value) return "وقت غير محدد";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ar-IQ");
}

export function RtlImageViewer({
  title,
  emptyText,
  images,
  accent = "blush",
}: {
  title: string;
  emptyText: string;
  images: RtlViewerImage[];
  accent?: "blush" | "ivory";
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const active = activeIndex === null ? null : images[activeIndex] ?? null;
  const canMove = images.length > 1;
  const move = (direction: -1 | 1) => {
    setActiveIndex((current) => {
      if (current === null || !images.length) return current;
      return (current + direction + images.length) % images.length;
    });
  };

  useEffect(() => {
    if (activeIndex !== null && activeIndex >= images.length) setActiveIndex(null);
  }, [activeIndex, images.length]);

  const thumbnails = useMemo(
    () =>
      images.map((image, index) => ({
        image,
        index,
        label: imageLabel(image, `${title} ${index + 1}`),
      })),
    [images, title],
  );

  if (!images.length) return <p className="text-sm text-slate-500">{emptyText}</p>;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {thumbnails.map(({ image, index, label }) => (
          <button
            key={image.id}
            type="button"
            onClick={() => setActiveIndex(index)}
            className={cn(
              "group min-h-44 overflow-hidden rounded-2xl border bg-white text-start shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f3047]",
              accent === "blush" ? "border-[#efd8dd] hover:border-[#c96f85]" : "border-[#eee4d4] hover:border-[#b69764]",
            )}
            aria-label={`تكبير صورة ${title}: ${label}`}
          >
            <span className="relative block overflow-hidden">
              <img src={image.url} alt={label} loading="lazy" className="aspect-square w-full object-cover" />
              <span className="absolute left-2 top-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[#1f3047] shadow-sm">
                <Expand className="h-4 w-4" aria-hidden="true" />
              </span>
            </span>
            <span className="block space-y-1 p-3">
              <span className="line-clamp-2 block text-sm font-medium text-slate-900">{label}</span>
              <span className="block text-xs text-slate-500">
                {image.uploader || "AJN"} · {displayTimestamp(image.timestamp)}
              </span>
            </span>
          </button>
        ))}
      </div>
      <Dialog open={active !== null} onOpenChange={(open) => !open && setActiveIndex(null)}>
        <DialogContent
          className="w-[min(calc(100vw-1rem),60rem)] max-w-none gap-4 overflow-hidden bg-[#fbfaf7] p-4"
          dir="rtl"
          aria-label={`عارض صور ${title}`}
          onKeyDown={(event) => {
            if (!canMove) return;
            if (event.key === "ArrowRight") {
              event.preventDefault();
              move(-1);
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              move(1);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>عارض صور {title}</DialogTitle>
            <DialogDescription>
              {active ? `${active.uploader || "AJN"} · ${displayTimestamp(active.timestamp)}` : "عرض الصور"}
            </DialogDescription>
          </DialogHeader>
          {active ? (
            <figure className="min-w-0 space-y-3">
              <div className="relative overflow-hidden rounded-2xl bg-[#111827]">
                <img
                  src={active.url}
                  alt={imageLabel(active, title)}
                  className="max-h-[70dvh] w-full object-contain"
                />
                {canMove ? (
                  <div className="absolute inset-x-3 top-1/2 flex -translate-y-1/2 justify-between">
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="h-11 w-11 rounded-full"
                      onClick={() => move(-1)}
                      aria-label="الصورة السابقة"
                    >
                      <ChevronRight className="h-5 w-5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="h-11 w-11 rounded-full"
                      onClick={() => move(1)}
                      aria-label="الصورة التالية"
                    >
                      <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </div>
              <figcaption className="whitespace-pre-wrap break-words rounded-xl bg-white p-3 text-sm text-slate-700">
                {active.caption?.trim() || "لا توجد تسمية للصورة."}
              </figcaption>
            </figure>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
