import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { BarChart3, BookOpen, CalendarClock, CheckCircle2, ClipboardList, Download, Image as ImageIcon, Layers, Monitor, Plus, Printer, ScanLine, Search, Settings, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { ALBUM_STAGES, type AlbumBucket } from "@/lib/albums";
import { formatIraqiPhone } from "@/lib/phone";
import { albumLabelsHtml, printAlbumHtml } from "@/lib/album-print";
import { printStandaloneDocument } from "@/lib/pdf";
import { AlbumPanel, AlbumStageBar } from "@/components/albums/album-panel";
import { AlbumReportsDialog } from "@/components/albums/album-reports";
import { AlbumScanDialog } from "@/components/albums/album-scan";
import { AlbumSettingsDialog } from "@/components/albums/album-settings";
import { CreateAlbumDialog } from "@/components/albums/create-album-dialog";
import { ErrorBlock, LoadingBlock, StageBadge, albumKeys, money, useAlbumBrand, useAlbumMeta, type Album, type AlbumDetail } from "@/components/albums/shared";
import { adminFetch, apiErrorMessage } from "./_lib";

type ListResponse = {
  albums: Album[]; total: number; page: number; pageSize: number;
  summary: { total: number; waitingSelection: number; designing: number; production: number; ready: number; delivered: number; delayed: number };
};
type Bucket = AlbumBucket | "delayed" | "";

const CARDS: Array<{ key: Bucket; label: string; icon: typeof BookOpen; tone: string; count: (s: ListResponse["summary"]) => number }> = [
  { key: "", label: "إجمالي الألبومات", icon: BookOpen, tone: "text-foreground", count: (s) => s.total },
  { key: "waitingSelection", label: "بانتظار اختيار الصور", icon: ImageIcon, tone: "text-foreground", count: (s) => s.waitingSelection },
  { key: "designing", label: "قيد التصميم", icon: Monitor, tone: "text-status-warning", count: (s) => s.designing },
  { key: "production", label: "قيد الطباعة والتجليد", icon: Printer, tone: "text-primary", count: (s) => s.production },
  { key: "ready", label: "جاهزة للتسليم", icon: Layers, tone: "text-primary", count: (s) => s.ready },
  { key: "delivered", label: "تم التسليم", icon: CheckCircle2, tone: "text-status-success", count: (s) => s.delivered },
  { key: "delayed", label: "متأخرة", icon: CalendarClock, tone: "text-destructive", count: (s) => s.delayed },
];

/**
 * The page's own width (not the window's): with the sidebar open a 1440px
 * screen leaves ~1000px. Wide: table + side panel; medium: full table with
 * details in a side sheet; narrow: cards with a bottom sheet.
 */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export default function AlbumsPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const { toast } = useToast();
  const brand = useAlbumBrand();
  const meta = useAlbumMeta();
  const [containerRef, containerWidth] = useContainerWidth();
  const mode = containerWidth >= 1180 ? "split" : containerWidth >= 720 ? "table" : "cards";
  const wide = mode === "split";
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [bucket, setBucket] = useState<Bucket>("");
  const [stage, setStage] = useState("");
  const [type, setType] = useState("");
  const [staffId, setStaffId] = useState("");
  const [period, setPeriod] = useState<"all" | "today" | "month" | "custom">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const [reports, setReports] = useState(false);
  const [scanning, setScanning] = useState(Boolean(params.get("scan")));
  const selectedFromUrl = Number(params.get("album")) || null;
  const [selected, setSelected] = useState<number | null>(selectedFromUrl);

  useEffect(() => { const timer = window.setTimeout(() => setDebounced(q.trim()), 250); return () => window.clearTimeout(timer); }, [q]);
  useEffect(() => { setPage(1); }, [debounced, bucket, stage, type, staffId, period, from, to]);
  useEffect(() => { if (selectedFromUrl) setSelected(selectedFromUrl); }, [selectedFromUrl]);

  const today = meta.data?.today ?? new Date().toISOString().slice(0, 10);
  const range = period === "today" ? { from: today, to: today } : period === "month" ? { from: `${today.slice(0, 7)}-01`, to: today } : period === "custom" ? { from, to } : { from: "", to: "" };
  const query = useMemo(() => {
    const next = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (debounced) next.set("q", debounced);
    if (bucket) next.set("bucket", bucket);
    if (stage) next.set("stage", stage);
    if (type) next.set("type", type);
    if (staffId) next.set("staffId", staffId);
    if (range.from) next.set("from", range.from);
    if (range.to) next.set("to", range.to);
    return next.toString();
  }, [page, debounced, bucket, stage, type, staffId, range.from, range.to]);
  const list = useQuery({ queryKey: albumKeys.list(query), queryFn: () => adminFetch<ListResponse & { access: { manage: boolean; financials: boolean } }>(`/admin/albums?${query}`), placeholderData: keepPreviousData });
  const albums = list.data?.albums ?? [];
  const access = meta.data?.access;
  const types = (meta.data?.catalog ?? []).filter((option) => option.kind === "type");

  useEffect(() => {
    if (wide && !selected && albums.length) setSelected(albums[0].id);
  }, [wide, selected, albums]);

  const open = (id: number) => {
    setSelected(id);
    navigate(`/admin/albums?album=${id}`, { replace: true });
  };

  const exportCsv = async () => {
    try {
      const rows: Album[] = [];
      for (let next = 1; next <= 20; next += 1) {
        const pageParams = new URLSearchParams(query);
        pageParams.set("page", String(next));
        pageParams.set("pageSize", "100");
        const data = await adminFetch<ListResponse>(`/admin/albums?${pageParams}`);
        rows.push(...data.albums);
        if (rows.length >= data.total || !data.albums.length) break;
      }
      const head = ["رقم الألبوم", "الزبون", "الهاتف", "الحجز", "النوع", "القياس", "الصفحات", "النسخ", "المرحلة", "موعد التسليم", "متأخر", ...(access?.financials ? ["سعر البيع", "المدفوع", "المتبقي", "إجمالي التكلفة", "صافي الربح"] : [])];
      const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
      const body = rows.map((album) => [album.albumNo, album.customerName, formatIraqiPhone(album.phone), album.bookingCode, album.albumType, album.albumSize, album.pageCount, album.copies, album.stageLabel, album.dueDate, album.delayed ? "نعم" : "", ...(access?.financials ? [album.salePrice, album.paidAmount, album.remainingAmount, album.totalCost, album.netProfit] : [])].map(cell).join(","));
      const blob = new Blob([`﻿${[head.map(cell).join(","), ...body].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `albums-${today}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    } catch (error) {
      toast({ title: "تعذّر التصدير", description: apiErrorMessage(error), variant: "destructive" });
    }
  };

  const printList = () => {
    const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
    printStandaloneDocument(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>قائمة الألبومات</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:Cairo,Tahoma,Arial,sans-serif;font-size:11px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 6px;text-align:right}th{background:#f4f1f2}</style></head><body>
      <h2>قائمة الألبومات — ${esc(today)}</h2><table><tr><th>رقم الألبوم</th><th>الزبون</th><th>الهاتف</th><th>النوع</th><th>القياس</th><th>الصفحات</th><th>المرحلة</th><th>موعد التسليم</th>${access?.financials ? "<th>المتبقي</th>" : ""}</tr>
      ${albums.map((album) => `<tr><td>${esc(album.albumNo)}</td><td>${esc(album.customerName)}</td><td>${esc(formatIraqiPhone(album.phone))}</td><td>${esc(album.albumType)}</td><td>${esc(album.albumSize)}</td><td>${esc(album.pageCount ?? "")}</td><td>${esc(album.stageLabel)}${album.delayed ? " (متأخر)" : ""}</td><td>${esc(album.dueDate ?? "")}</td>${access?.financials ? `<td>${esc(album.financeMode === "package" ? "ضمن الباقة" : money(album.remainingAmount))}</td>` : ""}</tr>`).join("")}
      </table></body></html>`);
  };

  const printLabel = async (album: Album) => {
    try {
      const detail = await adminFetch<AlbumDetail>(`/admin/albums/${album.id}`);
      printAlbumHtml(await albumLabelsHtml(detail.album, detail.copies, brand, { width: 50, height: 30 }), "label");
    } catch (error) {
      toast({ title: "تعذّرت الطباعة", description: apiErrorMessage(error), variant: "destructive" });
    }
  };

  return (
    <div ref={containerRef} className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6" dir="rtl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><BookOpen className="h-6 w-6" /></span>
          <div>
            <h1 className="text-2xl font-bold">إدارة الألبومات</h1>
            <p className="text-sm text-muted-foreground">متابعة طلبات الألبومات من الاستلام إلى التسليم</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setSettings(true)}><Settings className="h-4 w-4" />إعدادات الألبومات</Button>
          <Button type="button" variant="outline" onClick={() => setScanning(true)}><ScanLine className="h-4 w-4" />مسح</Button>
          <Button type="button" variant="outline" onClick={() => void exportCsv()} disabled={!albums.length}><Download className="h-4 w-4" />تصدير</Button>
          <Button type="button" variant="outline" onClick={printList} disabled={!albums.length}><Printer className="h-4 w-4" />طباعة</Button>
          {access?.viewAll ? <Button type="button" onClick={() => setReports(true)}><BarChart3 className="h-4 w-4" />تقرير الألبومات</Button> : null}
        </div>
      </header>

      <section aria-label="ملخص الألبومات" className={`grid gap-3 ${containerWidth >= 880 ? "grid-cols-7" : containerWidth >= 560 ? "grid-cols-4" : "grid-cols-[repeat(2,minmax(0,1fr))]"}`}>
        {CARDS.map((card) => {
          const activeCard = bucket === card.key;
          return (
            <button key={card.label} type="button" aria-pressed={activeCard} onClick={() => { setBucket(card.key); setStage(""); }}
              className={`flex items-center justify-between gap-2 rounded-2xl border bg-card p-3 text-right sm:p-4 transition-[border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] ${activeCard ? "border-primary shadow-sm ring-1 ring-primary/30" : "border-border hover:border-primary/40"}`}>
              <span className="min-w-0">
                <span className={`block text-2xl font-bold tabular-nums ${card.tone}`}>{list.data ? card.count(list.data.summary) : "—"}</span>
                <span className="mt-0.5 block text-xs font-bold text-muted-foreground">{card.label}</span>
              </span>
              <card.icon className={`h-6 w-6 flex-none ${card.tone}`} />
            </button>
          );
        })}
      </section>

      <section className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[14rem] flex-[2]">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="بحث" className="h-10 pr-9" value={q} onChange={(event) => setQ(event.target.value)} placeholder="البحث عن الزبون، رقم الألبوم، الهاتف، أو رقم الحجز…" />
        </div>
        <Select label="الفترة" value={period} onChange={(value) => setPeriod(value as typeof period)} options={[["all", "كل الفترات"], ["today", "اليوم"], ["month", "هذا الشهر"], ["custom", "فترة مخصصة"]]} />
        {period === "custom" ? <>
          <DateField aria-label="من" type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="h-10 w-40" />
          <DateField aria-label="إلى" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="h-10 w-40" />
        </> : null}
        <Select label="الحالة" value={stage} onChange={(value) => { setStage(value); if (value) setBucket(""); }} options={[["", "كل الحالات"], ...ALBUM_STAGES.map((item) => [item.key, item.label] as [string, string])]} />
        <Select label="النوع" value={type} onChange={setType} options={[["", "كل الأنواع"], ...types.map((option) => [option.label, option.label] as [string, string])]} />
        {access?.viewAll ? <Select label="الموظف" value={staffId} onChange={setStaffId} options={[["", "كل الموظفين"], ...(meta.data?.staff ?? []).map((member) => [String(member.id), member.name] as [string, string])]} /> : null}
        {access?.manage ? <Button type="button" className="h-10" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />طلب ألبوم جديد</Button> : null}
      </section>

      {list.isError ? <ErrorBlock message={apiErrorMessage(list.error, "تعذّر تحميل الألبومات")} onRetry={() => void list.refetch()} /> : null}

      <div className={wide ? "grid grid-cols-[minmax(0,1fr)_23rem] items-start gap-5" : "space-y-3"}>
        <div className="min-w-0 space-y-4">
          {list.isLoading ? <LoadingBlock /> : !list.isError && !albums.length ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center">
              <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-bold">{debounced || bucket || stage || type || staffId || period !== "all" ? "لا توجد ألبومات تطابق البحث" : "لا توجد طلبات ألبومات بعد"}</p>
              {access?.manage && !debounced ? <Button type="button" className="mt-4" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />طلب ألبوم جديد</Button> : null}
            </div>
          ) : mode !== "cards" ? (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>{["الألبوم والزبون", "النوع والقياس", "الصفحات", "مرحلة التنفيذ", "موعد التسليم", ...(access?.financials ? ["المتبقي"] : []), "إجراءات"].map((head) => <th key={head} className="whitespace-nowrap px-3 py-3 text-right font-bold">{head}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {albums.map((album) => (
                    <tr key={album.id} aria-selected={selected === album.id} onClick={() => open(album.id)} className={`cursor-pointer transition-colors duration-150 ${selected === album.id ? "bg-primary/5" : "hover:bg-muted/40"}`}>
                      <td className="px-3 py-2.5"><span className="block whitespace-nowrap text-xs font-bold tabular-nums text-primary" dir="ltr">{album.albumNo}</span><span className="block font-bold">{album.customerName}</span></td>
                      <td className="px-3 py-2.5"><span className="block">{album.albumType}</span><span className="block whitespace-nowrap text-xs tabular-nums text-muted-foreground" dir="ltr">{album.albumSize}</span></td>
                      <td className="px-3 py-2.5 tabular-nums">{album.pageCount ?? "—"}</td>
                      <td className="px-3 py-2.5"><StageBadge stage={album.stage} label={album.stageLabel} delayed={album.delayed} /></td>
                      <td className={`whitespace-nowrap px-3 py-2.5 tabular-nums ${album.delayed ? "font-bold text-destructive" : ""}`} dir="ltr">{album.dueDate ?? "—"}</td>
                      {access?.financials ? <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{album.financeMode === "package" ? <span className="text-xs text-muted-foreground">ضمن الباقة</span> : <b className={Number(album.remainingAmount) > 0 ? "text-destructive" : "text-status-success"}>{money(album.remainingAmount)}</b>}</td> : null}
                      <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                        <div className="flex gap-1">
                          <IconAction label={`ملصق ${album.albumNo}`} onClick={() => void printLabel(album)}><Tag className="h-4 w-4" /></IconAction>
                          <IconAction label={`تفاصيل ${album.albumNo}`} onClick={() => open(album.id)}><ClipboardList className="h-4 w-4" /></IconAction>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="space-y-2">
              {albums.map((album) => (
                <li key={album.id}>
                  <button type="button" onClick={() => open(album.id)} className="w-full rounded-2xl border border-border bg-card p-3 text-right transition-transform duration-150 ease-out active:scale-[0.99]">
                    <div className="flex items-center justify-between gap-2"><b className="tabular-nums text-primary" dir="ltr">{album.albumNo}</b><StageBadge stage={album.stage} label={album.stageLabel} delayed={album.delayed} /></div>
                    <p className="mt-1 font-bold">{album.customerName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{album.albumType} · <span dir="ltr" className="tabular-nums">{album.albumSize}</span>{album.pageCount ? ` · ${album.pageCount} صفحة` : ""}{album.dueDate ? <> · التسليم <span dir="ltr" className="tabular-nums">{album.dueDate}</span></> : null}</p>
                    {access?.financials && album.financeMode === "invoice" && Number(album.remainingAmount) > 0 ? <p className="mt-1 text-xs font-bold text-destructive">المتبقي {money(album.remainingAmount)}</p> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {list.data && list.data.total > list.data.pageSize ? (
            <nav className="flex items-center justify-between text-sm" aria-label="الصفحات">
              <span className="text-muted-foreground tabular-nums">{(page - 1) * list.data.pageSize + 1}–{Math.min(page * list.data.pageSize, list.data.total)} من {list.data.total}</span>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</Button>
                <Button type="button" size="sm" variant="outline" disabled={page * list.data.pageSize >= list.data.total} onClick={() => setPage((value) => value + 1)}>التالي</Button>
              </div>
            </nav>
          ) : null}

          {wide && selected ? <AlbumStageBar id={selected} /> : null}
        </div>

        {wide ? (
          <aside className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-border bg-card p-4">
            {selected ? <AlbumPanel id={selected} /> : <p className="p-6 text-center text-sm text-muted-foreground">اختر ألبوماً لعرض تفاصيله</p>}
          </aside>
        ) : (
          <Sheet open={Boolean(selected)} onOpenChange={(next) => { if (!next) { setSelected(null); navigate("/admin/albums", { replace: true }); } }}>
            <SheetContent side={mode === "table" ? "left" : "bottom"} className={mode === "table" ? "w-full overflow-y-auto p-4 pt-14 max-md:pt-14 sm:max-w-md" : "max-h-[92dvh] overflow-y-auto rounded-t-2xl p-4 pt-14 max-md:pt-14"} dir="rtl">
              <SheetTitle className="sr-only">تفاصيل الألبوم</SheetTitle>
              {selected ? <div className="space-y-4"><AlbumPanel id={selected} /><MobileStages id={selected} /></div> : null}
            </SheetContent>
          </Sheet>
        )}
      </div>

      <CreateAlbumDialog open={creating} onOpenChange={setCreating} onCreated={open} />
      <AlbumSettingsDialog open={settings} onOpenChange={setSettings} />
      <AlbumReportsDialog open={reports} onOpenChange={setReports} today={today} onOpenAlbum={(id) => { setReports(false); open(id); }} />
      <AlbumScanDialog open={scanning} initialCode={params.get("scan")} onOpenChange={(next) => { setScanning(next); if (!next && params.get("scan")) navigate("/admin/albums", { replace: true }); }} />
    </div>
  );
}

function MobileStages({ id }: { id: number }) {
  return <AlbumStageBar id={id} />;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-10 min-w-[8.5rem] flex-1 rounded-lg border border-input bg-background px-3 text-sm sm:flex-none">
      {options.map(([key, text]) => <option key={key || "all"} value={key}>{text}</option>)}
    </select>
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.95]">{children}</button>;
}
