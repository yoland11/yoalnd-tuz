import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AlbumPanel } from "@/components/albums/album-panel";
import { AlbumScanDialog } from "@/components/albums/album-scan";
import { ErrorBlock, LoadingBlock, StageBadge, StageStepper, albumKeys, useAlbumDetail, type Album } from "@/components/albums/shared";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";

/**
 * «ألبوماتي» in the photography employee portal: the albums assigned to me
 * (design, printing, binding, quality). The server scopes the list; actions and
 * uploads follow the same permissions as the admin page.
 */
export function StaffAlbumsPage({ staffId }: { staffId: number }) {
  const [scope, setScope] = useState<"mine" | "open">("mine");
  const [selected, setSelected] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const params = `pageSize=50${scope === "mine" ? `&staffId=${staffId}` : ""}`;
  const list = useQuery({ queryKey: albumKeys.list(`staff:${params}`), queryFn: () => adminFetch<{ albums: Album[]; total: number }>(`/admin/albums?${params}`) });
  const albums = (list.data?.albums ?? []).filter((album) => scope === "open" || album.stage !== "delivered");
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">الألبومات</h1>
        <Button type="button" variant="outline" size="sm" onClick={() => setScanning(true)}><ScanLine className="h-4 w-4" />مسح ألبوم</Button>
      </div>
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-1 rounded-xl bg-muted p-1 text-xs font-bold" role="tablist" aria-label="نطاق الألبومات">
        {([["mine", "المسندة إليّ"], ["open", "كل ما يمكنني رؤيته"]] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={scope === key} onClick={() => setScope(key)} className={`rounded-lg px-2 py-2 transition-colors duration-150 ${scope === key ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{label}</button>
        ))}
      </div>
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorBlock message={apiErrorMessage(list.error, "تعذّر تحميل الألبومات")} onRetry={() => void list.refetch()} /> : albums.length ? (
        <ul className="space-y-2">
          {albums.map((album) => (
            <li key={album.id}>
              <button type="button" onClick={() => setSelected(album.id)} className="w-full rounded-xl border border-border bg-card p-3 text-right transition-transform duration-150 ease-out active:scale-[0.99]">
                <div className="flex items-center justify-between gap-2"><b className="tabular-nums" dir="ltr">{album.albumNo}</b><StageBadge stage={album.stage} label={album.stageLabel} delayed={album.delayed} /></div>
                <p className="mt-1 text-sm font-bold">{album.customerName}</p>
                <p className="text-xs text-muted-foreground">{album.albumType} · <span dir="ltr" className="tabular-nums">{album.albumSize}</span>{album.pageCount ? ` · ${album.pageCount} صفحة` : ""}{album.dueDate ? <> · التسليم <span dir="ltr" className="tabular-nums">{album.dueDate}</span></> : null}</p>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground"><BookOpen className="mx-auto mb-2 h-6 w-6" />{scope === "mine" ? "لا توجد ألبومات مسندة إليك الآن" : "لا توجد ألبومات"}</div>
      )}
      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl p-4 pt-14 max-md:pt-14" dir="rtl">
          <SheetTitle className="sr-only">تفاصيل الألبوم</SheetTitle>
          {selected ? <div className="space-y-4"><AlbumPanel id={selected} compact /><Stages id={selected} /></div> : null}
        </SheetContent>
      </Sheet>
      <AlbumScanDialog open={scanning} onOpenChange={setScanning} />
    </div>
  );
}

function Stages({ id }: { id: number }) {
  const detail = useAlbumDetail(id);
  if (!detail.data) return null;
  return <section className="rounded-xl border border-border p-3"><h3 className="mb-3 text-sm font-bold">المراحل</h3><StageStepper stage={detail.data.album.stage} events={detail.data.events} /></section>;
}
