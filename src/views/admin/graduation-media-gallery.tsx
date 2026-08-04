import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, ArrowDownToLine, Check, ChevronLeft, ChevronRight, Columns3, Download, Eye, EyeOff,
  FileImage, Filter, FlipHorizontal2, GripVertical, Image as ImageIcon, Link2, Loader2, Maximize2,
  Minimize2, MoreHorizontal, Move, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Pencil, Play, Plus, RotateCcw, RotateCw, Search, SlidersHorizontal, Sparkles, Star, Trash2,
  Upload, Video, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import { formatBytes } from "@/lib/image-tools";
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
const CATEGORY_TABS = [["all", "الكل"], ...Object.entries(CATEGORY_LABELS)] as Array<[string, string]>;
const EMPTY_DRAFT = {
  mediaType: "image" as "image" | "video", mediaUrl: "", thumbnailUrl: "", title: "", description: "",
  category: "work", displayLocation: "both", displayOrder: 0, isActive: true, isFeatured: false,
  customerVisible: true, templateIds: [] as number[], packageIds: [] as number[], isPrimary: false,
  uploads: [] as UploadValue[],
};

function metaText(item: MediaItem | null, key: string) {
  const value = item?.imageMetadata?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "—";
}
function metaNumber(item: MediaItem | null, key: string) {
  const value = Number(item?.imageMetadata?.[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function mediaLabel(item: MediaItem) { return item.title?.trim() || `وسيط #${item.id}`; }
function fileKind(item: MediaItem) { return item.mediaType === "video" ? "فيديو" : metaText(item, "processedType").replace("image/", "").toUpperCase() || "صورة"; }

function MediaThumb({ item, compact = false }: { item: MediaItem; compact?: boolean }) {
  const source = item.thumbnailUrl || item.mediaUrl;
  return <div className={`relative overflow-hidden bg-muted ${compact ? "aspect-square rounded-lg" : "aspect-[4/3] rounded-xl"}`}>
    {item.mediaType === "image" ? <img src={source} alt={mediaLabel(item)} loading="lazy" decoding="async" className="h-full w-full object-cover" /> : item.thumbnailUrl ? <img src={source} alt={mediaLabel(item)} loading="lazy" className="h-full w-full object-cover" /> : <Video className="absolute inset-0 m-auto h-8 w-8 text-muted-foreground" />}
    {item.mediaType === "video" ? <span className="absolute inset-0 grid place-items-center bg-black/20"><span className="grid h-9 w-9 place-items-center rounded-full bg-black/70 text-white"><Play className="mr-0.5 h-4 w-4 fill-current" /></span></span> : null}
  </div>;
}

function MediaPreview({ item, zoom, rotation, flipped, pan, compare, comparePosition, onWheel, onDoubleClick, onPointerDown, onPointerMove, onPointerUp }: {
  item: MediaItem | null; zoom: number; rotation: number; flipped: boolean; pan: { x: number; y: number }; compare: boolean; comparePosition: number;
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void; onDoubleClick: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void; onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void; onPointerUp: () => void;
}) {
  if (!item) return <div className="grid min-h-[380px] place-items-center text-center text-muted-foreground"><div><ImageIcon className="mx-auto h-10 w-10" /><p className="mt-3 text-sm font-medium">اختر صورة أو فيديو من المكتبة</p><p className="mt-1 text-xs">ستبقى المعاينة هنا أثناء تنظيم الوسائط وتحريرها.</p></div></div>;
  if (item.mediaType === "video") return <div className="grid min-h-[380px] place-items-center bg-black"><video src={item.mediaUrl} poster={item.thumbnailUrl || undefined} controls preload="metadata" className="max-h-[66dvh] max-w-full" /></div>;
  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)${flipped ? " scaleX(-1)" : ""}`;
  const original = metaText(item, "originalUrl");
  return <div className="relative grid min-h-[380px] touch-none place-items-center overflow-hidden bg-[radial-gradient(circle_at_center,hsl(var(--muted))_0,hsl(var(--background))_68%)]" onWheel={onWheel} onDoubleClick={onDoubleClick} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    <img src={item.mediaUrl} alt={mediaLabel(item)} draggable={false} className="max-h-[66dvh] max-w-full select-none object-contain transition-transform duration-150" style={{ transform }} />
    {compare && original !== "—" && original !== item.mediaUrl ? <><div className="pointer-events-none absolute inset-y-0 right-0 overflow-hidden" style={{ width: `${100 - comparePosition}%` }}><img src={original} alt="الأصل" draggable={false} className="absolute left-0 top-1/2 max-h-[66dvh] max-w-none -translate-y-1/2 object-contain" style={{ width: "100vw", transform }} /></div><span className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ right: `${100 - comparePosition}%` }} /></> : null}
    <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-black/65 px-2.5 py-1 text-xs text-white">{Math.round(zoom * 100)}% · {fileKind(item)}</div>
  </div>;
}

export function GraduationMediaGalleryAdmin() {
  const { toast } = useToast(); const queryClient = useQueryClient(); const { data: settings } = usePublicSettings();
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<MediaItem | null>(null); const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [category, setCategory] = useState("all"); const [visibility, setVisibility] = useState("active"); const [search, setSearch] = useState("");
  const [ordered, setOrdered] = useState<MediaItem[]>([]); const [selectedIds, setSelectedIds] = useState<number[]>([]); const [activeId, setActiveId] = useState<number | null>(null);
  const [draggedId, setDraggedId] = useState<number | null>(null); const [leftOpen, setLeftOpen] = useState(true); const [rightOpen, setRightOpen] = useState(true);
  const [zoom, setZoom] = useState(1); const [rotation, setRotation] = useState(0); const [flipped, setFlipped] = useState(false); const [pan, setPan] = useState({ x: 0, y: 0 }); const [compare, setCompare] = useState(false); const [comparePosition, setComparePosition] = useState(50); const [fullscreen, setFullscreen] = useState(false);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const query = useQuery<MediaResponse>({ queryKey: ["admin", "graduation", "media"], queryFn: () => adminFetch("/admin/graduation/media?includeArchived=true") });
  useEffect(() => setOrdered(query.data?.items || []), [query.data?.items]);
  const shown = useMemo(() => ordered.filter((item) => {
    const text = `${item.title ?? ""} ${item.description ?? ""} ${item.category}`.toLowerCase();
    const categoryOkay = category === "all" || item.category === category;
    const visibilityOkay = visibility === "all" || (visibility === "active" && item.isActive && item.customerVisible && !item.archivedAt && !item.deletedAt) || (visibility === "hidden" && (!item.isActive || !item.customerVisible)) || (visibility === "archived" && Boolean(item.archivedAt)) || (visibility === "deleted" && Boolean(item.deletedAt));
    return categoryOkay && visibilityOkay && text.includes(search.trim().toLowerCase());
  }), [ordered, category, visibility, search]);
  const active = shown.find((item) => item.id === activeId) || shown[0] || null;
  const selected = ordered.filter((item) => selectedIds.includes(item.id));
  const activeIndex = shown.findIndex((item) => item.id === active?.id);

  useEffect(() => { if (shown[0] && !shown.some((item) => item.id === activeId)) setActiveId(shown[0].id); }, [activeId, shown]);
  useEffect(() => { setZoom(1); setRotation(0); setFlipped(false); setPan({ x: 0, y: 0 }); setCompare(false); }, [activeId]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input, textarea, select")) return;
      if (event.key === "Escape") { setFullscreen(false); setCompare(false); }
      if (event.key === "f" || event.key === "F") setFullscreen((value) => !value);
      if (event.key === "+" || event.key === "=") setZoom((value) => Math.min(2, value + .1));
      if (event.key === "-") setZoom((value) => Math.max(.5, value - .1));
      if (event.key === "ArrowLeft" && activeIndex > 0) setActiveId(shown[activeIndex - 1].id);
      if (event.key === "ArrowRight" && activeIndex >= 0 && activeIndex < shown.length - 1) setActiveId(shown[activeIndex + 1].id);
    };
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  }, [activeIndex, shown]);

  function invalidate() { return queryClient.invalidateQueries({ queryKey: ["admin", "graduation", "media"] }); }
  function close() { setOpen(false); setEditing(null); setDraft(EMPTY_DRAFT); }
  function startCreate() { setEditing(null); setDraft(EMPTY_DRAFT); setOpen(true); }
  function startEdit(item: MediaItem) {
    setEditing(item); setDraft({ ...EMPTY_DRAFT, mediaType: item.mediaType, thumbnailUrl: item.thumbnailUrl || "", title: item.title || "", description: item.description || "", category: item.category, displayLocation: item.displayLocation, displayOrder: item.displayOrder, isActive: item.isActive, isFeatured: item.isFeatured, customerVisible: item.customerVisible, templateIds: item.links.map((link) => link.templateId).filter((id): id is number => Boolean(id)), packageIds: item.links.map((link) => link.packageId).filter((id): id is number => Boolean(id)), isPrimary: item.links.some((link) => link.isPrimary) }); setOpen(true);
  }
  function uploaded(results: ImageEditResult[]) { setDraft((current) => ({ ...current, uploads: [...current.uploads, ...results.map((result) => ({ mediaUrl: result.dataUrl, mediaType: result.dataUrl.startsWith("data:video/") ? "video" as const : "image" as const, imageMetadata: result.metadata }))] })); }
  function toggleTarget(kind: "templateIds" | "packageIds", id: number) { setDraft((current) => ({ ...current, [kind]: current[kind].includes(id) ? current[kind].filter((value) => value !== id) : [...current[kind], id] })); }

  const save = useMutation({
    mutationFn: async () => {
      const common = { title: draft.title, description: draft.description, category: draft.category, displayLocation: draft.displayLocation, displayOrder: draft.displayOrder, isActive: draft.isActive, isFeatured: draft.isFeatured, customerVisible: draft.customerVisible, thumbnailUrl: draft.thumbnailUrl, templateIds: draft.templateIds, packageIds: draft.packageIds, isPrimary: draft.isPrimary };
      if (editing) { const replacement = draft.uploads[0]; return adminFetch(`/admin/graduation/media/${editing.id}`, { method: "PATCH", body: JSON.stringify({ ...common, ...(replacement ? replacement : draft.mediaUrl ? { mediaUrl: draft.mediaUrl, mediaType: draft.mediaType } : {}) }) }); }
      const sources = draft.uploads.length ? draft.uploads : draft.mediaUrl ? [{ mediaUrl: draft.mediaUrl, mediaType: draft.mediaType, imageMetadata: {} }] : [];
      if (!sources.length) throw new Error("اختر ملفاً أو أضف رابطاً");
      return adminFetch("/admin/graduation/media", { method: "POST", body: JSON.stringify({ items: sources.map((source, index) => ({ ...common, ...source, title: sources.length > 1 && draft.title ? `${draft.title} ${index + 1}` : draft.title })) }) });
    }, onSuccess: () => { void invalidate(); close(); toast({ title: editing ? "تم تحديث الوسيط" : "تمت إضافة الوسائط" }); }, onError: (error) => toast({ title: "تعذر حفظ الوسائط", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const action = useMutation({ mutationFn: ({ id, action }: { id: number; action: "archive" | "restore" | "delete" }) => adminFetch(`/admin/graduation/media/${id}/action`, { method: "POST", body: JSON.stringify({ action }) }), onSuccess: () => { void invalidate(); }, onError: (error) => toast({ title: "تعذر تنفيذ الإجراء", description: apiErrorMessage(error), variant: "destructive" }) });
  const reorder = useMutation({ mutationFn: (ids: number[]) => adminFetch("/admin/graduation/media/reorder", { method: "POST", body: JSON.stringify({ ids }) }), onError: (error) => toast({ title: "تعذر حفظ الترتيب", description: apiErrorMessage(error), variant: "destructive" }) });
  const feature = useMutation({ mutationFn: (item: MediaItem) => adminFetch(`/admin/graduation/media/${item.id}`, { method: "PATCH", body: JSON.stringify({ isFeatured: !item.isFeatured }) }), onSuccess: () => { void invalidate(); toast({ title: "تم تحديث تمييز الوسيط" }); } });
  function dropOn(targetId: number) { if (!draggedId || draggedId === targetId) return; const next = [...ordered]; const from = next.findIndex((item) => item.id === draggedId); const to = next.findIndex((item) => item.id === targetId); if (from < 0 || to < 0) return; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); setOrdered(next); setDraggedId(null); reorder.mutate(next.map((item) => item.id)); }
  function toggleSelect(id: number) { setSelectedIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]); }
  function bulk(actionName: "archive" | "delete") { selected.forEach((item) => action.mutate({ id: item.id, action: actionName })); setSelectedIds([]); }
  function previewWheel(event: React.WheelEvent<HTMLDivElement>) { event.preventDefault(); setZoom((value) => Math.max(.5, Math.min(2, value + (event.deltaY < 0 ? .08 : -.08)))); }
  function next(step: number) { const target = shown[activeIndex + step]; if (target) setActiveId(target.id); }
  const workspaceColumns = leftOpen && rightOpen ? "lg:grid-cols-[minmax(190px,25%)_minmax(0,1fr)_minmax(240px,20%)]" : leftOpen ? "lg:grid-cols-[minmax(190px,25%)_minmax(0,1fr)]" : rightOpen ? "lg:grid-cols-[minmax(0,1fr)_minmax(240px,20%)]" : "lg:grid-cols-1";

  return <section dir="rtl" className={`relative overflow-hidden rounded-xl border border-border bg-card ${fullscreen ? "fixed inset-3 z-50 shadow-2xl" : "min-h-[720px]"}`}>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-background/65 px-4 py-3 backdrop-blur-sm sm:px-5"><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-lg font-bold">معرض تجهيزات التخرج</h2><Badge variant="secondary">{shown.length} وسيط</Badge></div><p className="mt-0.5 text-xs text-muted-foreground">تنظيم، معاينة وربط الوسائط دون مغادرة صفحة التخرج.</p></div><div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => setFullscreen((value) => !value)} title="ملء الشاشة (F)">{fullscreen ? <Minimize2 className="ml-1.5 h-4 w-4" /> : <Maximize2 className="ml-1.5 h-4 w-4" />}{fullscreen ? "تصغير" : "ملء الشاشة"}</Button><Button size="sm" onClick={startCreate}><Upload className="ml-1.5 h-4 w-4" />رفع صور</Button></div></header>

    <div className={`grid min-h-[650px] grid-cols-1 ${workspaceColumns}`}>
      <aside className={`${leftOpen ? "block" : "hidden"} border-l border-border/70 bg-muted/20 p-3 lg:block`}>
        <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold">مكتبة الوسائط</h3><Button variant="ghost" size="icon" className="hidden h-8 w-8 lg:inline-flex" onClick={() => setLeftOpen(false)} aria-label="إخفاء المكتبة"><PanelLeftClose className="h-4 w-4" /></Button></div>
        <div className="relative"><Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pr-9" placeholder="ابحث باسم أو تصنيف" /></div>
        <div className="mt-4"><p className="mb-2 text-xs font-medium text-muted-foreground">التصنيفات</p><div className="space-y-1">{CATEGORY_TABS.map(([value, label]) => <button key={value} type="button" onClick={() => setCategory(value)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-right text-sm transition-colors ${category === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><span>{label}</span><span className="text-xs opacity-75">{value === "all" ? ordered.length : ordered.filter((item) => item.category === value).length}</span></button>)}</div></div>
        <div className="mt-5 border-t border-border/70 pt-4"><p className="mb-2 text-xs font-medium text-muted-foreground">الظهور</p><Select value={visibility} onValueChange={setVisibility}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">ظاهر للزبائن</SelectItem><SelectItem value="all">كل الحالات</SelectItem><SelectItem value="hidden">مخفي</SelectItem><SelectItem value="archived">مؤرشف</SelectItem><SelectItem value="deleted">محذوف</SelectItem></SelectContent></Select></div>
        <div className="mt-5 rounded-lg border border-dashed border-border bg-background/60 p-3"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><span className="text-xs font-medium">رفع ذكي حتى 40MB</span></div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">الرفع المُجزّأ، النسخ المحسنة والتقدم متاحة من زر رفع صور.</p><Button variant="ghost" size="sm" className="mt-2 w-full" onClick={startCreate}>فتح قائمة الرفع</Button></div>
      </aside>

      <main className="min-w-0 bg-background/35"><div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2"><div className="flex items-center gap-1"><Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" onClick={() => setLeftOpen((value) => !value)} aria-label="إظهار المكتبة"><PanelLeftOpen className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((value) => Math.max(.5, value - .1))} disabled={!active}><ZoomOut className="h-4 w-4" /></Button><span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((value) => Math.min(2, value + .1))} disabled={!active}><ZoomIn className="h-4 w-4" /></Button><Button variant="ghost" size="sm" className="h-8" onClick={() => setZoom(1)} disabled={!active}>ملاءمة</Button><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setRotation((value) => value + 90)} disabled={!active} title="تدوير"><RotateCw className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFlipped((value) => !value)} disabled={!active} title="قلب"><FlipHorizontal2 className="h-4 w-4" /></Button></div><div className="flex items-center gap-1"><Button variant={compare ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => setCompare((value) => !value)} disabled={!active || metaText(active, "originalUrl") === "—"}>قبل/بعد</Button><Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" onClick={() => setRightOpen((value) => !value)} aria-label="إظهار الخصائص"><PanelRightOpen className="h-4 w-4" /></Button></div></div>
        <MediaPreview item={active} zoom={zoom} rotation={rotation} flipped={flipped} pan={pan} compare={compare} comparePosition={comparePosition} onWheel={previewWheel} onDoubleClick={() => setZoom((value) => value === 1 ? 2 : 1)} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; }} onPointerMove={(event) => { const drag = dragRef.current; if (drag) setPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y }); }} onPointerUp={() => { dragRef.current = null; }} />
        {compare && active ? <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-xs"><span>الأصل</span><input type="range" min={0} max={100} value={comparePosition} onChange={(event) => setComparePosition(Number(event.target.value))} className="flex-1 accent-primary" aria-label="فاصل المقارنة" /><span>النسخة الحالية</span></div> : null}
        <div className="border-t border-border bg-card px-3 py-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{active ? mediaLabel(active) : "لا يوجد اختيار"}</p><p className="mt-0.5 text-xs text-muted-foreground">{active ? `${fileKind(active)} · ${metaNumber(active, "originalWidth") || "—"} × ${metaNumber(active, "originalHeight") || "—"} · ${formatBytes(metaNumber(active, "originalSize"))}` : ""}</p></div><div className="flex gap-1"><Button variant="outline" size="sm" disabled={!active} onClick={() => active && startEdit(active)}><Pencil className="ml-1 h-3.5 w-3.5" />تحرير</Button><Button variant="ghost" size="icon" disabled={activeIndex <= 0} onClick={() => next(-1)} aria-label="السابق"><ChevronRight className="h-4 w-4" /></Button><Button variant="ghost" size="icon" disabled={activeIndex < 0 || activeIndex >= shown.length - 1} onClick={() => next(1)} aria-label="التالي"><ChevronLeft className="h-4 w-4" /></Button></div></div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="شريط الوسائط">{shown.map((item) => <button key={item.id} type="button" draggable onDragStart={() => setDraggedId(item.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(item.id)} onClick={() => setActiveId(item.id)} className={`relative w-16 shrink-0 ${active?.id === item.id ? "ring-2 ring-primary ring-offset-2" : "opacity-75 hover:opacity-100"}`}><MediaThumb item={item} compact />{item.isFeatured ? <Star className="absolute left-1 top-1 h-3 w-3 fill-primary text-primary" /> : null}</button>)}</div>
        </div>
      </main>

      <aside className={`${rightOpen ? "block" : "hidden"} border-r border-border/70 bg-muted/20 p-3 lg:block`}>
        <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold">خصائص الوسيط</h3><Button variant="ghost" size="icon" className="hidden h-8 w-8 lg:inline-flex" onClick={() => setRightOpen(false)} aria-label="إخفاء الخصائص"><PanelRightClose className="h-4 w-4" /></Button></div>
        {active ? <div className="space-y-4"><MediaThumb item={active} /><div><p className="text-sm font-semibold">{mediaLabel(active)}</p><p className="mt-1 text-xs text-muted-foreground">{CATEGORY_LABELS[active.category] || active.category} · {active.links.length} روابط</p></div><PropertyRows item={active} /><div className="space-y-2 border-t border-border pt-3"><Button variant="outline" size="sm" className="w-full justify-start" onClick={() => startEdit(active)}><SlidersHorizontal className="ml-2 h-4 w-4" />استبدال أو تحرير الصورة</Button><Button variant="outline" size="sm" className="w-full justify-start" onClick={() => feature.mutate(active)}><Star className={`ml-2 h-4 w-4 ${active.isFeatured ? "fill-primary text-primary" : ""}`} />{active.isFeatured ? "إلغاء التمييز" : "تمييز في المعرض"}</Button><Button variant="outline" size="sm" className="w-full justify-start" onClick={() => action.mutate({ id: active.id, action: active.archivedAt || active.deletedAt ? "restore" : "archive" })}><Archive className="ml-2 h-4 w-4" />{active.archivedAt || active.deletedAt ? "استعادة الوسيط" : "أرشفة الوسيط"}</Button></div></div> : <p className="py-10 text-center text-sm text-muted-foreground">اختر وسيطاً لعرض خصائصه.</p>}
      </aside>
    </div>

    {selected.length ? <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 px-4 py-3 backdrop-blur"><span className="text-sm font-medium">تم تحديد {selected.length} وسائط</span><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => selected[0] && startEdit(selected[0])}><Pencil className="ml-1.5 h-3.5 w-3.5" />تعديل</Button><Button size="sm" variant="outline" onClick={() => bulk("archive")}><Archive className="ml-1.5 h-3.5 w-3.5" />أرشفة</Button><Button size="sm" variant="outline" className="text-destructive" onClick={() => bulk("delete")}><Trash2 className="ml-1.5 h-3.5 w-3.5" />حذف</Button><Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>إلغاء التحديد</Button></div></div> : null}
    <MediaLibraryGrid items={shown} activeId={active?.id ?? null} selectedIds={selectedIds} loading={query.isLoading} onOpen={setActiveId} onToggle={toggleSelect} onEdit={startEdit} onDrop={dropOn} onDrag={setDraggedId} />
    <MediaFormDialog open={open} editing={editing} draft={draft} setDraft={setDraft} targets={query.data?.targets} settings={settings?.image_settings} siteName={settings?.site_name} busy={save.isPending} onClose={close} onSave={() => save.mutate()} onUploaded={uploaded} onToggleTarget={toggleTarget} />
  </section>;
}

function PropertyRows({ item }: { item: MediaItem }) {
  const rows = [["الدقة الأصلية", `${metaText(item, "originalWidth")} × ${metaText(item, "originalHeight")}`], ["الدقة الحالية", `${metaText(item, "width")} × ${metaText(item, "height")}`], ["حجم الملف", formatBytes(metaNumber(item, "originalSize"))], ["الصيغة", fileKind(item)], ["المعالجة", metaText(item, "updatedAt")], ["التخزين", metaText(item, "originalUrl") === "—" ? "المسار الحالي" : "Supabase Storage"]];
  return <dl className="space-y-2 rounded-lg border border-border bg-background/65 p-3 text-xs">{rows.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="max-w-[62%] break-words text-left font-medium" dir="ltr">{value}</dd></div>)}</dl>;
}

function MediaLibraryGrid({ items, activeId, selectedIds, loading, onOpen, onToggle, onEdit, onDrop, onDrag }: { items: MediaItem[]; activeId: number | null; selectedIds: number[]; loading: boolean; onOpen: (id: number) => void; onToggle: (id: number) => void; onEdit: (item: MediaItem) => void; onDrop: (id: number) => void; onDrag: (id: number | null) => void }) {
  if (loading) return <div className="p-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((id) => <Skeleton key={id} className="aspect-[4/3] rounded-xl" />)}</div></div>;
  if (!items.length) return <div className="m-4 grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center"><div><ImageIcon className="mx-auto h-9 w-9 text-muted-foreground" /><p className="mt-3 text-sm font-medium">لا توجد وسائط مطابقة</p><p className="mt-1 text-xs text-muted-foreground">غيّر الفلتر أو ارفع صوراً جديدة.</p></div></div>;
  return <section className="border-t border-border bg-muted/10 p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold">كل الوسائط</h3><span className="text-xs text-muted-foreground">اسحب بطاقة لتغيير ترتيبها</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{items.map((item) => <article key={item.id} draggable onDragStart={() => onDrag(item.id)} onDragEnd={() => onDrag(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop(item.id)} className={`group overflow-hidden rounded-xl border bg-card transition-colors ${activeId === item.id ? "border-primary ring-1 ring-primary/30" : "border-border hover:border-primary/45"}`}><button type="button" className="block w-full text-right" onClick={() => onOpen(item.id)}><MediaThumb item={item} /><div className="p-3"><div className="flex items-center justify-between gap-2"><strong className="truncate text-sm">{mediaLabel(item)}</strong>{item.isFeatured ? <Star className="h-4 w-4 shrink-0 fill-primary text-primary" /> : null}</div><p className="mt-1 text-xs text-muted-foreground">{CATEGORY_LABELS[item.category] || item.category} · {fileKind(item)}</p></div></button><div className="flex items-center justify-between border-t border-border px-2 py-1.5"><label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"><Checkbox checked={selectedIds.includes(item.id)} onCheckedChange={() => onToggle(item.id)} />تحديد</label><div className="flex items-center"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(item)} aria-label="تحرير"><Pencil className="h-3.5 w-3.5" /></Button><span className="grid h-7 w-7 cursor-grab place-items-center text-muted-foreground" title="اسحب للترتيب"><GripVertical className="h-4 w-4" /></span></div></div></article>)}</div></section>;
}

function MediaFormDialog({ open, editing, draft, setDraft, targets, settings, siteName, busy, onClose, onSave, onUploaded, onToggleTarget }: { open: boolean; editing: MediaItem | null; draft: typeof EMPTY_DRAFT; setDraft: React.Dispatch<React.SetStateAction<typeof EMPTY_DRAFT>>; targets: MediaResponse["targets"] | undefined; settings: any; siteName: string | undefined; busy: boolean; onClose: () => void; onSave: () => void; onUploaded: (results: ImageEditResult[]) => void; onToggleTarget: (kind: "templateIds" | "packageIds", id: number) => void }) {
  return <Dialog open={open} onOpenChange={(value) => !value && onClose()}><DialogContent dir="rtl" className="max-h-[92dvh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>{editing ? "تحرير الوسيط" : "رفع وسائط جديدة"}</DialogTitle></DialogHeader><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]"><div className="space-y-4"><ImageUploadEditor kind="gallery" label="اسحب الصور هنا أو اختر من الجهاز" multiple={!editing} accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,image/gif,video/mp4,video/webm,video/quicktime" allowVideo settings={settings} watermarkText={siteName} onComplete={onUploaded} />{draft.uploads.length ? <div className="rounded-lg border border-border p-3"><p className="text-xs font-medium">قائمة الرفع ({draft.uploads.length})</p><div className="mt-2 flex flex-wrap gap-2">{draft.uploads.map((upload, index) => <Badge key={`${upload.mediaType}-${index}`} variant="secondary">{upload.mediaType === "video" ? <Video className="ml-1 h-3 w-3" /> : <ImageIcon className="ml-1 h-3 w-3" />}ملف {index + 1}</Badge>)}</div></div> : null}<div><Label>عنوان أو اسم داخلي</Label><Input className="mt-2" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>التصنيف</Label><Select value={draft.category} onValueChange={(value) => setDraft((current) => ({ ...current, category: value }))}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div><Label>مكان العرض</Label><Select value={draft.displayLocation} onValueChange={(value) => setDraft((current) => ({ ...current, displayLocation: value }))}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="both">المعرض ومُعدّ الباقة</SelectItem><SelectItem value="gallery">المعرض فقط</SelectItem><SelectItem value="builder">مُعدّ الباقة فقط</SelectItem></SelectContent></Select></div></div><div><Label>وصف</Label><Textarea className="mt-2 min-h-24" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></div></div><aside className="space-y-4"><section className="rounded-xl border border-border bg-muted/35 p-3"><h3 className="text-sm font-bold">الظهور</h3><div className="mt-3 space-y-3">{[["isActive", "نشط"], ["customerVisible", "ظاهر للزبائن"], ["isFeatured", "مميز"], ["isPrimary", "الصورة الرئيسية"]].map(([key, label]) => <label key={key} className="flex cursor-pointer items-center justify-between gap-3 text-sm"><span>{label}</span><Checkbox checked={Boolean(draft[key as keyof typeof draft])} onCheckedChange={(checked) => setDraft((current) => ({ ...current, [key]: checked === true }))} /></label>)}</div></section><TargetLinks title="ربط بالمنتجات" kind="templateIds" targets={targets?.templates || []} selected={draft.templateIds} onToggle={onToggleTarget} /><TargetLinks title="ربط بالباقة" kind="packageIds" targets={targets?.packages || []} selected={draft.packageIds} onToggle={onToggleTarget} /></aside></div><DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button disabled={busy} onClick={onSave}>{busy ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Check className="ml-2 h-4 w-4" />}{editing ? "حفظ التغييرات" : "إضافة إلى المعرض"}</Button></DialogFooter></DialogContent></Dialog>;
}

function TargetLinks({ title, kind, targets, selected, onToggle }: { title: string; kind: "templateIds" | "packageIds"; targets: Target[]; selected: number[]; onToggle: (kind: "templateIds" | "packageIds", id: number) => void }) {
  return <section className="rounded-xl border border-border bg-muted/35 p-3"><h3 className="text-sm font-bold">{title}</h3><div className="mt-3 max-h-44 space-y-2 overflow-y-auto">{targets.length ? targets.map((target) => <label key={target.id} className="flex cursor-pointer items-center gap-2 rounded-lg bg-background p-2 text-sm"><Checkbox checked={selected.includes(target.id)} onCheckedChange={() => onToggle(kind, target.id)} /><span className="min-w-0 truncate">{target.name}</span></label>) : <p className="text-xs text-muted-foreground">لا توجد عناصر قابلة للربط.</p>}</div></section>;
}
