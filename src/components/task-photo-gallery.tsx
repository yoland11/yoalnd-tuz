import { useRef, useState, type ChangeEvent } from "react";
import { Camera, FileText, FolderOpen, ImagePlus, Loader2, Maximize2, RefreshCw, Trash2, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { uploadImageWithVariants, uploadProgressLabel, uploadTaskFile, type ImageUploadProgress } from "@/lib/large-image-upload";

export type TaskPhoto = {
  id?: number;
  url: string;
  thumbnailUrl?: string | null;
  fileName?: string | null;
  mediaType?: string | null;
  category?: string | null;
  caption?: string | null;
  uploadedBy?: number | null;
  uploadedByName?: string | null;
  createdAt?: string | null;
};

export type TaskFile = TaskPhoto;

function PhotoLightbox({ photo, onClose }: { photo: TaskPhoto; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/90 p-3" role="dialog" aria-modal="true" aria-label="معاينة الصورة">
      <button type="button" onClick={onClose} className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25" aria-label="إغلاق المعاينة">
        <X className="h-5 w-5" />
      </button>
      <img src={photo.url} alt={photo.caption || photo.fileName || "صورة المهمة"} className="max-h-[88dvh] max-w-full object-contain" />
      {photo.caption ? <p className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] max-w-[90vw] rounded-lg bg-black/65 px-4 py-2 text-center text-sm text-white">{photo.caption}</p> : null}
    </div>
  );
}

export function TaskPhotoGallery({ photos, emptyText = "لا توجد صور مرفقة" }: { photos: TaskPhoto[]; emptyText?: string }) {
  const [active, setActive] = useState<TaskPhoto | null>(null);
  if (!photos.length) return <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return <>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((photo, index) => <button key={photo.id ?? `${photo.url}-${index}`} type="button" onClick={() => setActive(photo)} className="group relative min-h-28 overflow-hidden rounded-xl border border-border bg-muted text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <img src={photo.thumbnailUrl || photo.url} alt={photo.caption || photo.fileName || `صورة ${index + 1}`} className="h-32 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]" />
        <span className="absolute left-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white"><Maximize2 className="h-4 w-4" /></span>
        {photo.caption ? <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/85 to-black/10 px-2 pb-2 pt-6 text-xs text-white">{photo.caption}</span> : null}
      </button>)}
    </div>
    {active ? <PhotoLightbox photo={active} onClose={() => setActive(null)} /> : null}
  </>;
}

export function TaskPhotoPicker({
  photos,
  onChange,
  label,
  description,
  disabled = false,
}: {
  photos: TaskPhoto[];
  onChange: (photos: TaskPhoto[]) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ImageUploadProgress | null>(null);
  const [active, setActive] = useState<TaskPhoto | null>(null);

  async function uploadFiles(files: File[], replacing?: number | null) {
    if (!files.length || disabled) return;
    setUploading(true);
    let next = [...photos];
    let succeeded = 0;
    const failures: string[] = [];
    for (const file of files) {
      try {
        const uploaded = await uploadImageWithVariants(file, { folder: "uploads/tasks", onProgress: setProgress });
        const photo: TaskPhoto = { url: uploaded.originalUrl, thumbnailUrl: uploaded.thumbnailUrl, fileName: file.name, mediaType: file.type || "image", caption: "" };
        if (replacing !== null && replacing !== undefined && succeeded === 0) next = next.map((current, index) => index === replacing ? { ...photo, id: current.id } : current);
        else next = [...next, photo];
        succeeded += 1;
        onChange(next);
      } catch (reason) {
        failures.push(`${file.name}: ${reason instanceof Error ? reason.message : "تعذر رفع الصورة"}`);
      }
    }
    setUploading(false);
    setProgress(null);
    setReplaceIndex(null);
    if (succeeded) toast({ title: succeeded === 1 ? "تم رفع الصورة" : `تم رفع ${succeeded.toLocaleString("ar-IQ")} صور` });
    if (failures.length) toast({ title: "تعذر رفع بعض الصور", description: failures.slice(0, 2).join("\n"), variant: "destructive" });
  }

  function selected(event: ChangeEvent<HTMLInputElement>, replacing?: number | null) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void uploadFiles(files, replacing);
  }

  return <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
    <div>
      <h3 className="text-sm font-extrabold text-foreground">{label}</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description || "الصور اختيارية ويمكن إضافة أكثر من صورة."}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" className="min-h-11 gap-2" disabled={disabled || uploading} onClick={() => cameraRef.current?.click()}><Camera className="h-4 w-4" />التقاط صور</Button>
      <Button type="button" variant="outline" className="min-h-11 gap-2" disabled={disabled || uploading} onClick={() => galleryRef.current?.click()}><ImagePlus className="h-4 w-4" />اختيار صور من المعرض</Button>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(event) => selected(event)} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => selected(event)} />
      <input ref={replaceRef} type="file" accept="image/*" className="hidden" onChange={(event) => selected(event, replaceIndex)} />
    </div>
    {uploading ? <div className="flex min-h-11 items-center gap-2 rounded-lg bg-background px-3 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin text-primary" />{progress ? uploadProgressLabel(progress) : "جاري تجهيز الصورة..."}</div> : null}
    {photos.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((photo, index) => <div key={photo.id ?? `${photo.url}-${index}`} className="overflow-hidden rounded-xl border border-border bg-background">
        <button type="button" onClick={() => setActive(photo)} className="relative block w-full"><img src={photo.thumbnailUrl || photo.url} alt={photo.caption || photo.fileName || `صورة ${index + 1}`} className="h-32 w-full object-cover" /><span className="absolute left-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white"><Maximize2 className="h-4 w-4" /></span></button>
        <div className="space-y-2 p-2">
          <Input aria-label={`ملاحظة الصورة ${index + 1}`} value={photo.caption ?? ""} onChange={(event) => onChange(photos.map((item, itemIndex) => itemIndex === index ? { ...item, caption: event.target.value } : item))} placeholder="ملاحظة الصورة (اختياري)" className="min-h-10 text-xs" disabled={disabled} />
          <div className="grid grid-cols-2 gap-1">
            <Button type="button" variant="ghost" size="sm" className="min-h-10 gap-1" disabled={disabled || uploading} onClick={() => { setReplaceIndex(index); replaceRef.current?.click(); }}><RefreshCw className="h-3.5 w-3.5" />استبدال</Button>
            <Button type="button" variant="ghost" size="sm" className="min-h-10 gap-1 text-destructive hover:text-destructive" disabled={disabled || uploading} onClick={() => onChange(photos.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-3.5 w-3.5" />حذف</Button>
          </div>
        </div>
      </div>)}
    </div> : <p className="rounded-lg border border-dashed border-border bg-background px-3 py-5 text-center text-xs text-muted-foreground">لم تتم إضافة صور</p>}
    {active ? <PhotoLightbox photo={active} onClose={() => setActive(null)} /> : null}
  </section>;
}

function taskFileKind(file: TaskFile): "video" | "document" {
  return String(file.mediaType ?? "").startsWith("video/") ? "video" : "document";
}

export function TaskFileList({
  files,
  emptyText = "لا توجد فيديوهات أو مستندات مرفقة",
  onRemove,
  removing = false,
}: {
  files: TaskFile[];
  emptyText?: string;
  onRemove?: (file: TaskFile) => void;
  removing?: boolean;
}) {
  if (!files.length)
    return <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return <div className="space-y-2">
    {files.map((file, index) => {
      const kind = taskFileKind(file);
      return <div key={file.id ?? `${file.url}-${index}`} className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-background p-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          {kind === "video" ? <Video className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        </span>
        <a href={file.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="block truncate text-sm font-bold text-foreground">{file.fileName || `${kind === "video" ? "فيديو" : "مستند"} ${index + 1}`}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{file.caption || (kind === "video" ? "فتح الفيديو" : "فتح المستند")}</span>
        </a>
        {onRemove ? <Button type="button" size="sm" variant="ghost" className="min-h-10 shrink-0 text-destructive hover:text-destructive" disabled={removing} onClick={() => onRemove(file)}><Trash2 className="h-4 w-4" /><span className="sr-only">حذف المرفق</span></Button> : null}
      </div>;
    })}
  </div>;
}

export function TaskFilePicker({
  files,
  onChange,
  disabled = false,
  label = "فيديوهات ومستندات (اختياري)",
}: {
  files: TaskFile[];
  onChange: (files: TaskFile[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ImageUploadProgress | null>(null);

  async function selected(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selectedFiles.length || disabled) return;
    setUploading(true);
    let next = [...files];
    let succeeded = 0;
    const failures: string[] = [];
    for (const file of selectedFiles) {
      try {
        const uploaded = await uploadTaskFile(file, { folder: "uploads/tasks", onProgress: setProgress });
        next = [...next, { url: uploaded.url, fileName: file.name, mediaType: uploaded.mime, caption: "" }];
        succeeded += 1;
        onChange(next);
      } catch (reason) {
        failures.push(`${file.name}: ${reason instanceof Error ? reason.message : "تعذر رفع الملف"}`);
      }
    }
    setUploading(false);
    setProgress(null);
    if (succeeded) toast({ title: `تم رفع ${succeeded.toLocaleString("ar-IQ")} ملف` });
    if (failures.length) toast({ title: "تعذر رفع بعض الملفات", description: failures.slice(0, 2).join("\n"), variant: "destructive" });
  }

  return <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
    <div><h3 className="text-sm font-extrabold text-foreground">{label}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">MP4 وWebM وMOV وPDF وWord وExcel وText حتى 40 ميغابايت للملف.</p></div>
    <Button type="button" variant="outline" className="min-h-11 gap-2" disabled={disabled || uploading} onClick={() => inputRef.current?.click()}><FolderOpen className="h-4 w-4" />اختيار فيديو أو مستند</Button>
    <input ref={inputRef} type="file" multiple className="hidden" accept="video/mp4,video/webm,video/quicktime,application/pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={(event) => void selected(event)} />
    {uploading ? <div className="flex min-h-11 items-center gap-2 rounded-lg bg-background px-3 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin text-primary" />{progress ? uploadProgressLabel(progress) : "جاري تجهيز الملف..."}</div> : null}
    <TaskFileList files={files} onRemove={(file) => onChange(files.filter((item) => item !== file))} removing={uploading} />
  </section>;
}
