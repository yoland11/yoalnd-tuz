import { useState } from "react";
import { Expand, ImageOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { BookedKoshaPhoto } from "@/lib/booking-kosha-photo";

export function BookingKoshaPhoto({ kosha, loading, error, onRetry }: {
  kosha?: BookedKoshaPhoto | null;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = kosha?.imageUrl?.trim() || null;
  const failed = Boolean(image && failedImage === image);

  if (!kosha && !loading && !error) return null;

  const imageError = () => { setFailedImage(image); setOpen(false); };
  return <section aria-label="الكوشة المحجوزة" dir="rtl" className="min-w-0 rounded-xl border border-[var(--op-border)] bg-[var(--op-surface)] p-4">
    {error ? <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
      <div className="min-w-0 flex-1"><p className="font-semibold">تعذر تحميل بيانات الكوشة المحجوزة</p>{error instanceof Error ? <p className="break-words">{error.message}</p> : null}{kosha ? <p>المعروض آخر قراءة ناجحة.</p> : null}</div>
      {onRetry ? <Button type="button" variant="outline" size="sm" onClick={onRetry}>إعادة المحاولة</Button> : null}
    </div> : null}
    {!kosha && loading ? <p role="status" className="flex items-center gap-2 text-sm text-[var(--op-muted)]"><Loader2 aria-hidden="true" className="size-4 animate-spin" />جارٍ تحميل الكوشة المحجوزة…</p> : null}
    {kosha ? <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
      {image && !failed ? <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="flush" aria-label={`عرض صورة ${kosha.name}`} className="relative h-44 w-full shrink-0 overflow-hidden rounded-lg bg-[var(--op-bg)] p-1 sm:w-60">
            <img src={image} alt={kosha.name} decoding="async" onError={imageError} className="size-full object-contain" />
            <span className="absolute bottom-2 end-2 rounded-md bg-background/90 p-1.5 text-foreground"><Expand aria-hidden="true" className="size-4" /></span>
          </Button>
        </DialogTrigger>
        <DialogContent className="w-[min(calc(100%-2rem),64rem)]">
          <DialogHeader><DialogTitle>{kosha.name}</DialogTitle><DialogDescription>صورة الكوشة أو الباقة المرتبطة بهذا الحجز</DialogDescription></DialogHeader>
          <img src={image} alt={kosha.name} decoding="async" onError={imageError} className="max-h-[70dvh] w-full rounded-lg object-contain" />
        </DialogContent>
      </Dialog> : <div role="img" aria-label={failed ? `تعذر تحميل صورة ${kosha.name}` : `لا توجد صورة لـ ${kosha.name}`} className="flex h-32 w-full shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-[var(--op-border)] bg-[var(--op-bg)] text-sm text-[var(--op-muted)] sm:w-60">
        <ImageOff aria-hidden="true" className="size-6" /><span>{failed ? "تعذر تحميل الصورة" : "لا توجد صورة لهذه الكوشة"}</span>
      </div>}
      <div className="min-w-0"><p className="text-sm text-[var(--op-muted)]">{kosha.kind === "package" ? "الباقة المحجوزة" : "الكوشة المحجوزة"}</p><h2 className="mt-1 break-words text-lg font-bold">{kosha.name}</h2>{image && !failed ? <p className="mt-2 text-xs text-[var(--op-muted)]">اضغط على الصورة لتكبيرها</p> : null}</div>
    </div> : null}
  </section>;
}
