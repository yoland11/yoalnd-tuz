import { useRef, useState } from "react";
import { Expand, ImageOff, ImagePlus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BookingWorkspacePhoto } from "@/lib/booking-workspace-photos";

function PhotoThumbnail({ photo, onOpen }: { photo: BookingWorkspacePhoto; onOpen: (button: HTMLButtonElement) => void }) {
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set());
  const thumbnail = photo.thumbnailUrl?.trim();
  const source = thumbnail && !failedSources.has(thumbnail) ? thumbnail : photo.url;
  const failed = failedSources.has(source);

  return <Button type="button" variant="outline" size="flush" onClick={event => onOpen(event.currentTarget)} aria-label={`عرض صورة ${photo.name}`} className="block min-w-0 overflow-hidden rounded-lg whitespace-normal text-start">
    <span className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[var(--op-bg)] p-1">
      {failed ? <span role="img" aria-label={`تعذر تحميل صورة ${photo.name}`} className="flex flex-col items-center gap-2 px-2 text-center text-xs text-[var(--op-muted)]"><ImageOff aria-hidden="true" /><span>تعذر تحميل الصورة</span></span> : <img src={source} alt={photo.name} loading="lazy" decoding="async" onError={() => setFailedSources(previous => new Set(previous).add(source))} className="size-full object-contain" />}
      <span className="absolute bottom-2 end-2 rounded-md bg-background/90 p-1.5 text-foreground"><Expand aria-hidden="true" className="size-4" /></span>
    </span>
    <span className="block min-w-0 space-y-1 p-3"><span className="block text-xs font-normal text-[var(--op-muted)]">{photo.label}</span><span className="block break-words text-sm font-semibold leading-6">{photo.name}</span></span>
  </Button>;
}

export function BookingReferencePhotos({ photos, loading, error, onRetry, onEdit }: {
  photos: BookingWorkspacePhoto[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onEdit?: () => void;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [failedFullUrl, setFailedFullUrl] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const active = photos.find(photo => photo.key === activeKey) ?? null;

  return <section aria-label="صور الحجز" aria-busy={loading || undefined} dir="rtl" className="min-w-0 space-y-3 rounded-xl border border-[var(--op-border)] bg-[var(--op-surface)] p-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-bold">صور الحجز</h2><p className="mt-1 text-xs text-[var(--op-muted)]">{`عدد الصور: ${photos.length}`}</p></div>
      {onEdit ? <Button type="button" variant="outline" size="sm" onClick={onEdit}><ImagePlus aria-hidden="true" />إضافة صور</Button> : null}
    </header>
    {error ? <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
      <div className="min-w-0 flex-1"><p className="font-semibold">تعذر تحميل صور الحجز</p>{error instanceof Error ? <p className="break-words">{error.message}</p> : null}{photos.length ? <p>المعروض آخر قراءة ناجحة.</p> : null}</div>
      {onRetry ? <Button type="button" variant="outline" size="sm" onClick={onRetry}>إعادة المحاولة</Button> : null}
    </div> : null}
    {loading && !photos.length ? <div role="status" aria-label="جارٍ تحميل صور الحجز" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"><span className="sr-only">جارٍ تحميل صور الحجز…</span>{[0, 1].map(key => <div key={key} className="aspect-[4/3] animate-pulse rounded-lg bg-[var(--op-elevated)] motion-reduce:animate-none" />)}</div> : null}
    {photos.length ? <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{photos.map(photo => <PhotoThumbnail key={photo.key} photo={photo} onOpen={button => { opener.current = button; setActiveKey(photo.key); }} />)}</div> : !loading && !error ? <div className="rounded-lg border border-dashed border-[var(--op-border)] p-4 text-center text-sm text-[var(--op-muted)]"><p>لا توجد صور مرتبطة بهذا الحجز</p><p className="mt-1 text-xs">تظهر هنا الصور المرفقة وصور الخدمات والمنتجات المحجوزة.</p></div> : null}
    <Dialog open={active !== null} onOpenChange={open => { if (!open) setActiveKey(null); }}>
      <DialogContent dir="rtl" className="w-[min(calc(100%-2rem),64rem)]" onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }}>
        <DialogHeader><DialogTitle>{active?.name ?? "صورة الحجز"}</DialogTitle><DialogDescription>{active?.label ?? "معاينة الصورة الأصلية المرتبطة بالحجز"}</DialogDescription></DialogHeader>
        {active ? failedFullUrl === active.url ? <div role="alert" className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg bg-muted p-4 text-center text-sm"><ImageOff aria-hidden="true" className="size-6 text-muted-foreground" /><p>تعذر تحميل الصورة الأصلية</p><Button type="button" variant="outline" onClick={() => setFailedFullUrl(null)}><RefreshCw aria-hidden="true" />إعادة تحميل الصورة</Button></div> : <img src={active.url} alt={active.name} decoding="async" onError={() => setFailedFullUrl(active.url)} className="max-h-[70dvh] w-full rounded-lg object-contain" /> : null}
      </DialogContent>
    </Dialog>
  </section>;
}
