import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Eye, EyeOff, GripVertical, Image as ImageIcon, Link2, Loader2, Pencil, Play, Plus, RotateCcw, Star, Trash2, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import { useToast } from "@/hooks/use-toast";
import { usePublicSettings } from "@/lib/public-settings";
import { adminFetch, apiErrorMessage } from "./_lib";

type MediaLink = { id: number; targetType: "template" | "package"; templateId: number | null; packageId: number | null; isPrimary: boolean };
type MediaItem = {
  id: number; mediaType: "image" | "video"; mediaUrl: string; thumbnailUrl: string | null;
  title: string | null; description: string | null; category: string; displayLocation: string;
  displayOrder: number; isActive: boolean; isFeatured: boolean; customerVisible: boolean;
  archivedAt: string | null; deletedAt: string | null; imageMetadata?: Record<string, unknown>; links: MediaLink[];
};
type Target = { id: number; name: string; type: string; active: boolean };
type MediaResponse = { items: MediaItem[]; targets: { templates: Target[]; packages: Target[] } };
type UploadValue = { mediaUrl: string; mediaType: "image" | "video"; imageMetadata: Record<string, unknown> };

const CATEGORY_LABELS: Record<string, string> = {
  gown: "الأرواب", sash: "الأوشحة", cap: "القبعات", package: "الباقات الجاهزة",
  custom_package: "الباقات المخصصة", work: "أعمال التخرج", promotion: "محتوى ترويجي",
};
const EMPTY_DRAFT = {
  mediaType: "image" as "image" | "video", mediaUrl: "", thumbnailUrl: "", title: "", description: "",
  category: "work", displayLocation: "both", displayOrder: 0, isActive: true, isFeatured: false,
  customerVisible: true, templateIds: [] as number[], packageIds: [] as number[], isPrimary: false,
  uploads: [] as UploadValue[],
};

export function GraduationMediaGalleryAdmin() {
  const { toast } = useToast(); const queryClient = useQueryClient(); const { data: settings } = usePublicSettings();
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<MediaItem | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT); const [category, setCategory] = useState("all");
  const [visibility, setVisibility] = useState("all"); const [draggedId, setDraggedId] = useState<number | null>(null);
  const [ordered, setOrdered] = useState<MediaItem[]>([]);
  const query = useQuery<MediaResponse>({ queryKey: ["admin", "graduation", "media"], queryFn: () => adminFetch("/admin/graduation/media?includeArchived=true") });
  useEffect(() => setOrdered(query.data?.items || []), [query.data?.items]);
  const shown = useMemo(() => ordered.filter((item) => (category === "all" || item.category === category) && (visibility === "all" || (visibility === "active" && item.isActive && item.customerVisible && !item.archivedAt && !item.deletedAt) || (visibility === "hidden" && (!item.isActive || !item.customerVisible)) || (visibility === "archived" && Boolean(item.archivedAt)) || (visibility === "deleted" && Boolean(item.deletedAt)))), [ordered, category, visibility]);

  function invalidate() { return queryClient.invalidateQueries({ queryKey: ["admin", "graduation", "media"] }); }
  function close() { setOpen(false); setEditing(null); setDraft(EMPTY_DRAFT); }
  function startCreate() { setEditing(null); setDraft(EMPTY_DRAFT); setOpen(true); }
  function startEdit(item: MediaItem) {
    setEditing(item); setDraft({
      ...EMPTY_DRAFT, mediaType: item.mediaType, thumbnailUrl: item.thumbnailUrl || "", title: item.title || "",
      description: item.description || "", category: item.category, displayLocation: item.displayLocation,
      displayOrder: item.displayOrder, isActive: item.isActive, isFeatured: item.isFeatured,
      customerVisible: item.customerVisible, templateIds: item.links.map((link) => link.templateId).filter((id): id is number => Boolean(id)),
      packageIds: item.links.map((link) => link.packageId).filter((id): id is number => Boolean(id)), isPrimary: item.links.some((link) => link.isPrimary),
    }); setOpen(true);
  }
  function uploaded(results: ImageEditResult[]) {
    setDraft((current) => ({ ...current, uploads: [...current.uploads, ...results.map((result) => ({ mediaUrl: result.dataUrl, mediaType: result.dataUrl.startsWith("data:video/") ? "video" as const : "image" as const, imageMetadata: result.metadata }))] }));
  }
  function toggleTarget(kind: "templateIds" | "packageIds", id: number) {
    setDraft((current) => ({ ...current, [kind]: current[kind].includes(id) ? current[kind].filter((value) => value !== id) : [...current[kind], id] }));
  }

  const save = useMutation({
    mutationFn: async () => {
      const common = { title: draft.title, description: draft.description, category: draft.category, displayLocation: draft.displayLocation, displayOrder: draft.displayOrder, isActive: draft.isActive, isFeatured: draft.isFeatured, customerVisible: draft.customerVisible, thumbnailUrl: draft.thumbnailUrl, templateIds: draft.templateIds, packageIds: draft.packageIds, isPrimary: draft.isPrimary };
      if (editing) {
        const replacement = draft.uploads[0];
        return adminFetch(`/admin/graduation/media/${editing.id}`, { method: "PATCH", body: JSON.stringify({ ...common, ...(replacement ? replacement : draft.mediaUrl ? { mediaUrl: draft.mediaUrl, mediaType: draft.mediaType } : {}) }) });
      }
      const sources = draft.uploads.length ? draft.uploads : draft.mediaUrl ? [{ mediaUrl: draft.mediaUrl, mediaType: draft.mediaType, imageMetadata: {} }] : [];
      if (!sources.length) throw new Error("اختر ملفاً أو أضف رابطاً");
      return adminFetch("/admin/graduation/media", { method: "POST", body: JSON.stringify({ items: sources.map((source, index) => ({ ...common, ...source, title: sources.length > 1 && draft.title ? `${draft.title} ${index + 1}` : draft.title })) }) });
    },
    onSuccess: () => { void invalidate(); close(); toast({ title: editing ? "تم تحديث الوسيط" : "تمت إضافة الوسائط" }); },
    onError: (error) => toast({ title: "تعذر حفظ الوسائط", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const action = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "archive" | "restore" | "delete" }) => adminFetch(`/admin/graduation/media/${id}/action`, { method: "POST", body: JSON.stringify({ action }) }),
    onSuccess: (_, value) => { void invalidate(); toast({ title: value.action === "restore" ? "تمت استعادة الوسيط" : value.action === "archive" ? "تمت أرشفة الوسيط" : "تم حذف الوسيط بأمان" }); },
    onError: (error) => toast({ title: "تعذر تنفيذ الإجراء", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const reorder = useMutation({ mutationFn: (ids: number[]) => adminFetch("/admin/graduation/media/reorder", { method: "POST", body: JSON.stringify({ ids }) }), onError: (error) => toast({ title: "تعذر حفظ الترتيب", description: apiErrorMessage(error), variant: "destructive" }) });
  function dropOn(targetId: number) {
    if (!draggedId || draggedId === targetId) return;
    const next = [...ordered]; const from = next.findIndex((item) => item.id === draggedId); const to = next.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); setOrdered(next); setDraggedId(null); reorder.mutate(next.map((item) => item.id));
  }

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-bold">معرض الصور والفيديوهات</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">ملف واحد يمكن ربطه بعدة أرواب أو أوشحة أو قبعات أو باقات، مع تحكم مستقل بظهوره للزبون.</p></div><Button onClick={startCreate}><Plus className="ml-2 h-4 w-4" />إضافة وسائط</Button></div>
    <div className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-sm sm:flex-row"><Select value={category} onValueChange={setCategory}><SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل التصنيفات</SelectItem>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Select value={visibility} onValueChange={setVisibility}><SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الحالات</SelectItem><SelectItem value="active">ظاهر للزبائن</SelectItem><SelectItem value="hidden">مخفي</SelectItem><SelectItem value="archived">مؤرشف</SelectItem><SelectItem value="deleted">محذوف</SelectItem></SelectContent></Select><p className="self-center text-xs text-muted-foreground">اسحب البطاقات لتغيير ترتيب العرض.</p></div>
    {query.isLoading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[1,2,3,4].map((id) => <Skeleton key={id} className="aspect-[4/3] rounded-xl" />)}</div> : shown.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{shown.map((item) => <article key={item.id} draggable onDragStart={() => setDraggedId(item.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(item.id)} className={`group overflow-hidden rounded-xl bg-card shadow-sm ${draggedId === item.id ? "opacity-50" : ""}`}>
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">{item.thumbnailUrl || item.mediaType === "image" ? <img src={item.thumbnailUrl || item.mediaUrl} alt={item.title || "وسائط تخرج"} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" /> : <div className="flex h-full items-center justify-center"><Video className="h-10 w-10 text-muted-foreground" /></div>}{item.mediaType === "video" ? <span className="absolute inset-0 flex items-center justify-center bg-black/15"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white"><Play className="mr-0.5 h-5 w-5 fill-current" /></span></span> : null}<button type="button" className="absolute right-2 top-2 flex h-8 w-8 cursor-grab items-center justify-center rounded-lg bg-black/65 text-white" aria-label="سحب لتغيير الترتيب"><GripVertical className="h-4 w-4" /></button>{item.isFeatured ? <Badge className="absolute left-2 top-2"><Star className="ml-1 h-3 w-3 fill-current" />مميز</Badge> : null}</div>
      <div className="space-y-3 p-3"><div><div className="flex items-start justify-between gap-2"><strong className="line-clamp-1 text-sm">{item.title || "بدون عنوان"}</strong><Badge variant="outline">{item.mediaType === "video" ? "فيديو" : "صورة"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{CATEGORY_LABELS[item.category] || item.category} · {item.links.length} ارتباط</p></div><div className="flex flex-wrap gap-1.5">{item.deletedAt ? <Badge variant="destructive">محذوف</Badge> : item.archivedAt ? <Badge variant="secondary">مؤرشف</Badge> : item.isActive && item.customerVisible ? <Badge><Eye className="ml-1 h-3 w-3" />ظاهر</Badge> : <Badge variant="secondary"><EyeOff className="ml-1 h-3 w-3" />مخفي</Badge>}</div><div className="flex gap-1 border-t border-border pt-3"><Button size="sm" variant="outline" className="flex-1" onClick={() => startEdit(item)} disabled={Boolean(item.deletedAt)}><Pencil className="ml-1.5 h-3.5 w-3.5" />تعديل</Button>{item.archivedAt || item.deletedAt ? <Button size="icon" variant="outline" onClick={() => action.mutate({ id: item.id, action: "restore" })} aria-label="استعادة"><RotateCcw className="h-4 w-4" /></Button> : <Button size="icon" variant="outline" onClick={() => action.mutate({ id: item.id, action: "archive" })} aria-label="أرشفة"><Archive className="h-4 w-4" /></Button>}<Button size="icon" variant="ghost" className="text-destructive" disabled={Boolean(item.deletedAt)} onClick={() => window.confirm("حذف الوسيط من العرض؟ سيبقى الملف والروابط محفوظة بأمان.") && action.mutate({ id: item.id, action: "delete" })} aria-label="حذف"><Trash2 className="h-4 w-4" /></Button></div></div>
    </article>)}</div> : <div className="rounded-xl border border-dashed border-border py-16 text-center"><ImageIcon className="mx-auto h-10 w-10 text-muted-foreground" /><p className="mt-3 font-medium">لا توجد وسائط مطابقة</p><Button className="mt-4" variant="outline" onClick={startCreate}>إضافة أول وسيط</Button></div>}

    <Dialog open={open} onOpenChange={(value) => !value && close()}><DialogContent dir="rtl" className="max-h-[92dvh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>{editing ? "تعديل الوسيط" : "إضافة صور أو فيديوهات"}</DialogTitle></DialogHeader><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="space-y-4">
      <ImageUploadEditor kind="gallery" label="اسحب الصور أو الفيديوهات هنا" multiple={!editing} accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" allowVideo settings={settings?.image_settings} watermarkText={settings?.site_name} onComplete={uploaded} />
      {draft.uploads.length ? <div className="flex flex-wrap gap-2">{draft.uploads.map((upload, index) => <Badge key={`${upload.mediaType}-${index}`} variant="outline">{upload.mediaType === "video" ? <Video className="ml-1 h-3 w-3" /> : <ImageIcon className="ml-1 h-3 w-3" />}ملف {index + 1}</Badge>)}</div> : null}
      <div><Label>{draft.mediaType === "video" ? "رابط فيديو مدعوم" : "رابط الصورة"}</Label><div className="mt-2 flex gap-2"><Select value={draft.mediaType} onValueChange={(value: "image" | "video") => setDraft((current) => ({ ...current, mediaType: value }))}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="image">صورة</SelectItem><SelectItem value="video">فيديو</SelectItem></SelectContent></Select><div className="relative flex-1"><Link2 className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" /><Input dir="ltr" className="pr-10 text-left" value={draft.mediaUrl} onChange={(event) => setDraft((current) => ({ ...current, mediaUrl: event.target.value }))} placeholder={draft.mediaType === "video" ? "YouTube, Vimeo, MP4, WebM…" : "https://…"} /></div></div></div>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label>العنوان</Label><Input className="mt-2" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></div><div><Label>التصنيف</Label><Select value={draft.category} onValueChange={(value) => setDraft((current) => ({ ...current, category: value }))}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div></div>
      <div><Label>الوصف</Label><Textarea className="mt-2 min-h-24" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></div>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label>مكان العرض</Label><Select value={draft.displayLocation} onValueChange={(value) => setDraft((current) => ({ ...current, displayLocation: value }))}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="both">المعرض ومُعدّ الباقة</SelectItem><SelectItem value="gallery">المعرض فقط</SelectItem><SelectItem value="builder">مُعدّ الباقة فقط</SelectItem></SelectContent></Select></div><div><Label>ترتيب العرض</Label><Input className="mt-2" type="number" min={0} value={draft.displayOrder} onChange={(event) => setDraft((current) => ({ ...current, displayOrder: Number(event.target.value) }))} /></div></div>
      {(draft.mediaType === "video" || draft.uploads.some((item) => item.mediaType === "video")) ? <div><Label>الصورة المصغرة للفيديو</Label><div className="mt-2"><ImageUploadEditor kind="gallery" label="رفع صورة مصغرة" accept="image/jpeg,image/png,image/webp" currentImage={draft.thumbnailUrl || undefined} settings={settings?.image_settings} onComplete={(results) => results[0] && setDraft((current) => ({ ...current, thumbnailUrl: results[0].dataUrl }))} onRemove={() => setDraft((current) => ({ ...current, thumbnailUrl: "" }))} /></div><Input dir="ltr" className="mt-2 text-left" value={draft.thumbnailUrl.startsWith("data:") ? "" : draft.thumbnailUrl} onChange={(event) => setDraft((current) => ({ ...current, thumbnailUrl: event.target.value }))} placeholder="أو رابط صورة مصغرة" /></div> : null}
    </div><aside className="space-y-4"><section className="rounded-xl bg-muted/45 p-3"><h3 className="text-sm font-bold">الظهور</h3><div className="mt-3 space-y-3">{[["isActive", "نشط"], ["customerVisible", "ظاهر للزبائن"], ["isFeatured", "مميز"], ["isPrimary", "الصورة الرئيسية للمنتج"]].map(([key, label]) => <label key={key} className="flex cursor-pointer items-center justify-between gap-3 text-sm"><span>{label}</span><Checkbox checked={Boolean(draft[key as keyof typeof draft])} onCheckedChange={(checked) => setDraft((current) => ({ ...current, [key]: checked === true }))} /></label>)}</div></section>
      <section className="rounded-xl bg-muted/45 p-3"><h3 className="text-sm font-bold">ربط بمنتجات التخرج</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">يمكن ربط الوسيط نفسه بأكثر من منتج دون إعادة رفع الملف.</p><div className="mt-3 max-h-52 space-y-2 overflow-y-auto">{query.data?.targets.templates.map((target) => <label key={`t-${target.id}`} className="flex cursor-pointer items-center gap-2 rounded-lg bg-background p-2 text-sm"><Checkbox checked={draft.templateIds.includes(target.id)} onCheckedChange={() => toggleTarget("templateIds", target.id)} /><span className="min-w-0"><b className="block truncate">{target.name}</b><small className="text-muted-foreground">{target.type}</small></span></label>)}</div></section>
      <section className="rounded-xl bg-muted/45 p-3"><h3 className="text-sm font-bold">ربط بالباقات</h3><div className="mt-3 max-h-40 space-y-2 overflow-y-auto">{query.data?.targets.packages.map((target) => <label key={`p-${target.id}`} className="flex cursor-pointer items-center gap-2 rounded-lg bg-background p-2 text-sm"><Checkbox checked={draft.packageIds.includes(target.id)} onCheckedChange={() => toggleTarget("packageIds", target.id)} /><span className="truncate">{target.name}</span></label>)}</div></section>
    </aside></div><DialogFooter><Button variant="outline" onClick={close}>إلغاء</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}{editing ? "حفظ التغييرات" : "إضافة إلى المعرض"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

