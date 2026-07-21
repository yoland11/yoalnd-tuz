import { useCallback, useEffect, useState } from "react";
import { Copy, Image as ImageIcon, Loader2, Lock, LockOpen, Plus, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/views/admin/_lib";
import { processImageFile } from "@/lib/image-tools";
import { galleryApi, type GalleryAdmin } from "./lib";

/**
 * Staff-side gallery manager for one shoot.
 *
 * Previews are small images that ride the existing data-URL media pipeline; the
 * full-resolution deliverable is always an external link, because object storage is not
 * provisioned and a RAW file must never transit the API.
 */
export function ShootGalleryPanel({ shootRef }: { shootRef: string }) {
  const { toast } = useToast();
  const [gallery, setGallery] = useState<GalleryAdmin | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [item, setItem] = useState({ title: "", downloadUrl: "", previewImage: "" });

  const load = useCallback(() => {
    galleryApi
      .get(shootRef)
      .then((res) => { setGallery(res.gallery); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [shootRef]);

  useEffect(() => { load(); }, [load]);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    try {
      await galleryApi.save(shootRef, patch);
      toast({ title: gallery ? "تم تحديث المعرض" : "تم إنشاء المعرض" });
      setPassword("");
      load();
    } catch (err: any) {
      toast({ title: "تعذّرت العملية", description: apiErrorMessage(err), variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function pickPreview(file: File | undefined) {
    if (!file) return;
    try {
      // Downscaled hard: a preview is a thumbnail, not a deliverable.
      const processed = await processImageFile(file, { targetWidth: 1200, quality: 0.72 });
      setItem((current) => ({ ...current, previewImage: processed }));
    } catch {
      toast({ title: "تعذّرت معالجة الصورة", variant: "destructive" });
    }
  }

  async function addItem() {
    if (!item.previewImage && !item.downloadUrl.trim()) return;
    setBusy(true);
    try {
      await galleryApi.addItems(shootRef, [{
        title: item.title.trim() || null,
        downloadUrl: item.downloadUrl.trim() || null,
        previewImage: item.previewImage || null,
      }]);
      setItem({ title: "", downloadUrl: "", previewImage: "" });
      load();
    } catch (err: any) {
      toast({ title: "تعذّرت الإضافة", description: apiErrorMessage(err), variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function copyLink() {
    if (!gallery) return;
    try {
      await navigator.clipboard.writeText(gallery.shareUrl);
      toast({ title: "تم نسخ رابط المعرض" });
    } catch {
      toast({ title: gallery.shareUrl });
    }
  }

  if (!loaded) return null;

  return (
    <section className="rounded-xl border border-border/30 bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-foreground">
        <ImageIcon className="h-4 w-4 text-primary" /> معرض العميل
      </h2>

      {!gallery ? (
        <>
          <p className="mb-3 text-[11px] text-muted-foreground">
            أنشئ رابطاً خاصاً يستعرض منه العميل الصور ويحمّلها.
          </p>
          <div className="space-y-2">
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة مرور (اختيارية)" />
            <label className="block space-y-1">
              <span className="text-[11px] text-muted-foreground">تاريخ انتهاء الصلاحية (اختياري)</span>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </label>
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => save({ password: password || undefined, expiresAt: expiresAt || undefined })}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="ms-1 h-4 w-4" /> إنشاء المعرض</>}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 space-y-2 rounded-lg bg-muted/40 p-2">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" dir="ltr">{gallery.shareUrl}</code>
              <button type="button" onClick={copyLink} aria-label="نسخ الرابط" className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border border-border/40 text-primary">
                <Copy className="h-4 w-4" />
              </button>
              <a href={gallery.shareUrl} target="_blank" rel="noopener noreferrer" aria-label="فتح المعرض" className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border border-border/40 text-primary">
                <Share2 className="h-4 w-4" />
              </a>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {gallery.hasPassword ? <Lock className="h-3 w-3 text-status-success" /> : <LockOpen className="h-3 w-3 text-status-warning" />}
                {gallery.hasPassword ? "محمي بكلمة مرور" : "بلا كلمة مرور"}
              </span>
              <span className="tabular-nums">{gallery.viewCount} مشاهدة</span>
              <span className="tabular-nums">{gallery.downloadCount} تحميل</span>
              {gallery.expiresAt ? <span>ينتهي {gallery.expiresAt.slice(0, 10)}</span> : null}
              {gallery.eventCounts.unlock_failed ? (
                <span className="text-destructive tabular-nums">{gallery.eventCounts.unlock_failed} محاولة فاشلة</span>
              ) : null}
            </div>
          </div>

          <div className="mb-3 flex gap-2">
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={gallery.hasPassword ? "كلمة مرور جديدة" : "أضف كلمة مرور"}
              className="flex-1"
            />
            <Button variant="outline" size="sm" disabled={busy || !password} onClick={() => save({ password })}>حفظ</Button>
            {gallery.hasPassword ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => save({ password: "" })}>إزالة</Button>
            ) : null}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="mb-3 w-full"
            disabled={busy}
            onClick={() => save({ isActive: !gallery.isActive })}
          >
            {gallery.isActive ? "تعطيل المعرض" : "تفعيل المعرض"}
          </Button>

          {gallery.items.length ? (
            <ul className="mb-3 space-y-1.5">
              {gallery.items.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 rounded-lg border border-border/30 p-2">
                  {entry.previewImage ? (
                    <img src={entry.previewImage} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" />
                  ) : (
                    <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded bg-muted"><ImageIcon className="h-4 w-4 text-muted-foreground" /></span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{entry.title || "بلا عنوان"}</div>
                    <div className="text-[11px] tabular-nums text-muted-foreground">
                      {entry.favoriteCount} مفضّلة · {entry.downloadCount ?? 0} تحميل
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="حذف"
                    disabled={busy}
                    onClick={() => galleryApi.removeItem(shootRef, entry.id).then(load).catch(() => {})}
                    className="grid h-9 w-9 flex-shrink-0 place-items-center text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-2 rounded-lg border border-border/30 p-2">
            <Input value={item.title} onChange={(e) => setItem({ ...item, title: e.target.value })} placeholder="عنوان الصورة" />
            <Input value={item.downloadUrl} onChange={(e) => setItem({ ...item, downloadUrl: e.target.value })} placeholder="رابط التحميل (كامل الدقة)" dir="ltr" />
            <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border/50 text-xs text-muted-foreground">
              <input type="file" accept="image/*" className="hidden" onChange={(e) => pickPreview(e.target.files?.[0])} />
              {item.previewImage ? "تم اختيار صورة المعاينة ✓" : "اختر صورة معاينة"}
            </label>
            <Button size="sm" className="w-full" disabled={busy || (!item.previewImage && !item.downloadUrl.trim())} onClick={addItem}>
              إضافة للمعرض
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
