import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskPhotoGallery } from "@/components/task-photo-gallery";
import { IMAGE_UPLOAD_CONFIG, SUPPORTED_IMAGE_INPUT_ACCEPT } from "@/lib/image-upload-config";
import { dataUrlToFile, processImageFile } from "@/lib/image-tools";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";

type GroupPhoto = {
  id: number;
  url: string;
  thumbnailUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  note: string;
  uploadedByName: string | null;
  canEdit: boolean;
  createdAt: string;
};

function GroupPhotoDetails({ photo, base, onChange }: { photo: GroupPhoto; base: string; onChange: () => void }) {
  const { toast } = useToast();
  const [note, setNote] = useState(photo.note);
  const [busy, setBusy] = useState(false);
  useEffect(() => setNote(photo.note), [photo.note]);
  async function save() {
    if (note.trim() === photo.note) return;
    setBusy(true);
    try {
      await adminFetch(`${base}/${photo.id}`, { method: "PATCH", body: JSON.stringify({ note: note.trim() }) });
      onChange();
      toast({ title: "تم حفظ ملاحظة الصورة" });
    } catch (cause) {
      toast({ title: "تعذر حفظ الملاحظة", description: apiErrorMessage(cause), variant: "destructive" });
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm("حذف هذه اللقطة الجماعية من الحجز؟")) return;
    setBusy(true);
    try {
      await adminFetch(`${base}/${photo.id}`, { method: "DELETE" });
      onChange();
      toast({ title: "تم حذف اللقطة" });
    } catch (cause) {
      toast({ title: "تعذر حذف اللقطة", description: apiErrorMessage(cause), variant: "destructive" });
    } finally { setBusy(false); }
  }
  return <div className="space-y-2 rounded-xl border border-border/50 bg-background p-3">
    <div className="min-w-0 text-xs text-muted-foreground">
      <span className="block truncate font-medium text-foreground">{photo.fileName || `صورة ${photo.id}`}</span>
      <span>{new Date(photo.createdAt).toLocaleString("ar-IQ-u-nu-latn")} · {photo.uploadedByName || "موظف"}</span>
    </div>
    {photo.canEdit ? <div className="flex gap-2"><Input value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="ملاحظة الصورة" aria-label={`ملاحظة ${photo.fileName || photo.id}`} /><Button type="button" variant="outline" size="icon" aria-label="حفظ الملاحظة" disabled={busy || note.trim() === photo.note} onClick={save}><Save className="h-4 w-4" /></Button><Button type="button" variant="outline" size="icon" aria-label="حذف الصورة" className="text-destructive" disabled={busy} onClick={remove}><Trash2 className="h-4 w-4" /></Button></div> : photo.note ? <p className="text-sm">{photo.note}</p> : null}
  </div>;
}

/** The same booking-scoped gallery is mounted in the admin workspace and photography portal. */
export function BookingGroupPhotos({ bookingId, portal = false }: { bookingId: number; portal?: boolean }) {
  const base = portal
    ? `/staff/photography/group-photos/${bookingId}`
    : `/admin/booking-operations/service/${bookingId}/group-photos`;
  const sharedKey = ["booking-group-photos", bookingId];
  const key = [...sharedKey, portal ? "staff" : "admin"];
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const photos = useQuery<{ data: GroupPhoto[]; canUpload: boolean }>({ queryKey: key, queryFn: () => adminFetch(base) });

  async function upload(files: File[]) {
    if (!files.length || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    setFailedFiles([]);
    const failed: File[] = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        try {
          // Keep original JPEG/PNG/WebP quality when it fits AJN's upload limit.
          // Other AJN input formats use the existing browser image conversion path.
          let uploadFile = file;
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > IMAGE_UPLOAD_CONFIG.maxOutputBytes) {
            const prepared = await processImageFile(file, { maxSize: 3000, quality: 0.92, maxBytes: IMAGE_UPLOAD_CONFIG.maxOutputBytes });
            const extension = prepared.startsWith("data:image/png") ? "png" : prepared.startsWith("data:image/webp") ? "webp" : "jpg";
            uploadFile = await dataUrlToFile(prepared, `${file.name.replace(/\.[^.]+$/, "")}-booking.${extension}`);
          }
          if (uploadFile.size > IMAGE_UPLOAD_CONFIG.maxOutputBytes) throw new Error("حجم الصورة أكبر من الحد المسموح بعد التجهيز");
          let thumbnailFile: File | null = null;
          try {
            const thumbnailData = await processImageFile(uploadFile, { maxSize: 480, quality: 0.72, maxBytes: 512 * 1024 });
            const extension = thumbnailData.startsWith("data:image/png") ? "png" : thumbnailData.startsWith("data:image/webp") ? "webp" : "jpg";
            thumbnailFile = await dataUrlToFile(thumbnailData, `thumbnail.${extension}`);
            if (thumbnailFile.size > 512 * 1024) thumbnailFile = null;
          } catch (cause) {
            toast({ title: "تعذر تجهيز الصورة المصغّرة", description: `${file.name}: ${apiErrorMessage(cause)}`, variant: "destructive" });
          }
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const form = new FormData();
            form.append("file", uploadFile);
            if (thumbnailFile) form.append("thumbnail", thumbnailFile);
            xhr.open("POST", `/api${base}`);
            xhr.withCredentials = true;
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) setProgress(Math.round(((index + event.loaded / event.total) / files.length) * 100));
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) resolve();
              else {
                try { reject(new Error(JSON.parse(xhr.responseText)?.message || "تعذر رفع الصورة")); }
                catch (cause) { reject(cause instanceof Error ? cause : new Error("تعذر رفع الصورة")); }
              }
            };
            xhr.onerror = () => reject(new Error("تعذر الاتصال أثناء رفع الصورة"));
            xhr.send(form);
          });
          await queryClient.invalidateQueries({ queryKey: sharedKey });
        } catch (cause) {
          failed.push(file);
          toast({ title: `تعذر رفع ${file.name}`, description: apiErrorMessage(cause), variant: "destructive" });
        }
      }
      setProgress(100);
      setFailedFiles(failed);
      if (failed.length < files.length) toast({ title: `تم رفع ${files.length - failed.length} صورة` });
    } finally {
      uploadingRef.current = false;
      setUploading(false);
      setProgress(0);
    }
  }

  return <section id="booking-group-photos" dir="rtl" className="space-y-4 rounded-2xl border border-primary/15 bg-card p-4 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><Camera className="h-5 w-5 text-primary" /> لقطات جماعية</h2><p className="mt-1 text-sm text-muted-foreground">إدارة الصور الجماعية المرتبطة بهذا الحجز</p></div><span className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-sm text-primary">عدد الصور: {photos.data?.data.length ?? "—"}</span></div>
    {photos.data?.canUpload ? <div className="flex flex-wrap gap-2"><Button type="button" disabled={uploading} onClick={() => inputRef.current?.click()}><ImagePlus className="ms-2 h-4 w-4" /> إضافة لقطات جماعية</Button>{failedFiles.length ? <Button type="button" variant="outline" disabled={uploading} onClick={() => upload(failedFiles)}><RefreshCw className="ms-2 h-4 w-4" /> إعادة رفع {failedFiles.length} صورة</Button> : null}<input ref={inputRef} type="file" accept={SUPPORTED_IMAGE_INPUT_ACCEPT} multiple className="hidden" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void upload(files); }} /></div> : null}
    {uploading ? <div className="flex items-center gap-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span>جارٍ رفع الصور {progress}%</span><div className="h-2 min-w-20 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div></div> : null}
    {photos.isLoading ? <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل الصور…</div> : photos.isError ? <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">تعذر تحميل اللقطات الجماعية. <Button type="button" variant="outline" size="sm" onClick={() => photos.refetch()}>إعادة المحاولة</Button></div> : <><TaskPhotoGallery photos={(photos.data?.data ?? []).map((photo) => ({ id: photo.id, url: photo.url, thumbnailUrl: photo.thumbnailUrl, fileName: photo.fileName, caption: photo.note, createdAt: photo.createdAt, uploadedByName: photo.uploadedByName }))} emptyText="لم تُضف لقطات جماعية لهذا الحجز بعد" /><div className="grid gap-2 md:grid-cols-2">{photos.data?.data.map((photo) => <GroupPhotoDetails key={photo.id} photo={photo} base={base} onChange={() => queryClient.invalidateQueries({ queryKey: sharedKey })} />)}</div></>}
  </section>;
}
