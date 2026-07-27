import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Play, Star, Video, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type GraduationGalleryItem = {
  id: number; mediaType: "image" | "video"; mediaUrl: string; thumbnailUrl: string | null;
  title: string | null; description: string | null; category: string; displayLocation: string;
  displayOrder: number; isFeatured: boolean;
  links: Array<{ targetType: "template" | "package"; templateId: number | null; packageId: number | null }>;
};

const FILTERS = [
  ["all", "الكل"], ["gown", "الأرواب"], ["sash", "الأوشحة"], ["cap", "القبعات"],
  ["packages", "الباقات"], ["images", "الصور"], ["videos", "الفيديوهات"],
] as const;

async function fetchGraduationMedia(): Promise<{ items: GraduationGalleryItem[] }> {
  const response = await fetch("/api/graduation/media");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "تعذر تحميل معرض التخرج");
  return payload;
}

function embedVideoUrl(value: string) {
  try {
    const url = new URL(value); const host = url.hostname.toLowerCase();
    if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${url.pathname.replace(/^\//, "")}`;
    if (host.includes("youtube.com")) {
      const id = url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (host.includes("vimeo.com")) {
      const id = url.pathname.split("/").filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch { return null; }
  return null;
}

function MediaViewer({ items, index, onChange, onClose }: { items: GraduationGalleryItem[]; index: number; onChange: (index: number) => void; onClose: () => void }) {
  const item = items[index];
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onChange((index - 1 + items.length) % items.length);
      if (event.key === "ArrowLeft") onChange((index + 1) % items.length);
    };
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  }, [index, items.length, onChange, onClose]);
  if (!item) return null;
  const embed = item.mediaType === "video" ? embedVideoUrl(item.mediaUrl) : null;
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={item.title || "معاينة وسائط التخرج"} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <button type="button" onClick={onClose} className="absolute left-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20" aria-label="إغلاق"><X className="h-5 w-5" /></button>
    {items.length > 1 ? <><button type="button" onClick={() => onChange((index - 1 + items.length) % items.length)} className="absolute right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:right-6" aria-label="السابق"><ChevronRight className="h-6 w-6" /></button><button type="button" onClick={() => onChange((index + 1) % items.length)} className="absolute left-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:left-6" aria-label="التالي"><ChevronLeft className="h-6 w-6" /></button></> : null}
    <div className="flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-black shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black">{item.mediaType === "image" ? <img src={item.mediaUrl} alt={item.title || "عمل تخرج"} className="max-h-[78dvh] max-w-full object-contain" /> : embed ? <iframe src={embed} title={item.title || "فيديو تجهيزات التخرج"} loading="lazy" allow="fullscreen; picture-in-picture" allowFullScreen className="aspect-video max-h-[78dvh] w-full" /> : <video src={item.mediaUrl} controls preload="metadata" poster={item.thumbnailUrl || undefined} className="max-h-[78dvh] max-w-full" />}</div>
      {(item.title || item.description) ? <div className="bg-card px-4 py-3 text-right"><h3 className="font-bold">{item.title}</h3>{item.description ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p> : null}</div> : null}
    </div>
  </div>;
}

export function GraduationMediaGallery({ target, compact = false, title = "معرض تجهيزات التخرج" }: { target?: { type: "template" | "package"; id: number } | null; compact?: boolean; title?: string }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all"); const [preview, setPreview] = useState<number | null>(null);
  const query = useQuery({ queryKey: ["graduation", "media-gallery"], queryFn: fetchGraduationMedia, staleTime: 5 * 60_000 });
  const items = useMemo(() => (query.data?.items || []).filter((item) => {
    const locationOkay = target ? ["builder", "both"].includes(item.displayLocation) : ["gallery", "both"].includes(item.displayLocation);
    const targetOkay = !target || item.links.some((link) => target.type === "template" ? link.targetType === "template" && link.templateId === target.id : link.targetType === "package" && link.packageId === target.id);
    const filterOkay = filter === "all" || filter === "images" && item.mediaType === "image" || filter === "videos" && item.mediaType === "video" || filter === "packages" && ["package", "custom_package"].includes(item.category) || item.category === filter;
    return locationOkay && targetOkay && filterOkay;
  }), [query.data?.items, target, filter]);
  if (target && !query.isLoading && !items.length) return null;
  return <section dir="rtl" className={compact ? "space-y-3" : "space-y-5 rounded-xl bg-card p-4 shadow-sm sm:p-5"}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className={compact ? "text-sm font-bold" : "text-xl font-bold"}>{title}</h2>{!compact ? <p className="mt-1 text-sm leading-6 text-muted-foreground">صور وفيديوهات حقيقية للأرواب والأوشحة والقبعات والباقات الجاهزة والمخصصة.</p> : null}</div>{!target ? <div className="flex max-w-full gap-1.5 overflow-x-auto pb-1">{FILTERS.map(([value, label]) => <Button key={value} type="button" size="sm" variant={filter === value ? "default" : "outline"} className="shrink-0" onClick={() => setFilter(value)}>{label}</Button>)}</div> : null}</div>
    {query.isLoading ? <div className={`grid gap-3 ${compact ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-4"}`}>{[1,2,3,4].map((id) => <div key={id} className="aspect-[4/3] animate-pulse rounded-xl bg-muted" />)}</div> : items.length ? <div className={`grid gap-3 ${compact ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-4"}`}>{items.map((item, index) => <button key={item.id} type="button" onClick={() => setPreview(index)} className="group overflow-hidden rounded-xl bg-muted text-right shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <div className="relative aspect-[4/3] overflow-hidden">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.title || "تجهيزات التخرج"} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]" /> : <div className="flex h-full items-center justify-center"><ImageIcon className="h-8 w-8 text-muted-foreground" /></div>}{item.mediaType === "video" ? <span className="absolute inset-0 flex items-center justify-center bg-black/15"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-white"><Play className="mr-0.5 h-5 w-5 fill-current" /></span></span> : null}{item.isFeatured ? <Badge className="absolute right-2 top-2"><Star className="ml-1 h-3 w-3 fill-current" />مميز</Badge> : null}</div>
      {(item.title || !compact) ? <div className="flex items-center justify-between gap-2 bg-card p-3"><span className="line-clamp-1 text-sm font-medium">{item.title || "عمل من تجهيزات AJN"}</span>{item.mediaType === "video" ? <Video className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}</div> : null}
    </button>)}</div> : <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">لا توجد وسائط ضمن هذا التصنيف حالياً.</div>}
    {preview !== null ? <MediaViewer items={items} index={preview} onChange={setPreview} onClose={() => setPreview(null)} /> : null}
  </section>;
}

