import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ban, Camera, CircleDollarSign, ClipboardList, FileText, ImagePlus, Loader2, Package, PackageCheck, Pencil, Phone, Printer, QrCode, RotateCcw, Tag, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ALBUM_LABEL_SIZES, ALBUM_ROLES, albumStageLabel } from "@/lib/albums";
import { albumDeliveryReceiptHtml, albumLabelsHtml, albumManufacturingOrderHtml, albumOrderReceiptHtml, printAlbumHtml, type AlbumDocFormat } from "@/lib/album-print";
import { uploadImageWithVariants } from "@/lib/large-image-upload";
import { formatIraqiPhone } from "@/lib/phone";
import { queryClient } from "@/lib/query-client";
import { AjNApiError, adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import { ErrorBlock, Field, LoadingBlock, StageBadge, StageStepper, StaffSelect, albumKeys, eventTitle, money, newKey, useAlbumBrand, useAlbumDetail, useAlbumMeta, type AlbumDetail } from "./shared";

type Dialogs = "deliver" | "payment" | "assign" | "cancel" | "note" | "photo" | "material" | "edit" | "labels" | null;

function useAlbumWrite(id: number, onDone?: (detail: AlbumDetail) => void) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ path, body, method = "POST" }: { path: string; body?: unknown; method?: string }) =>
      adminFetch<AlbumDetail & { assignment?: { warning: string | null } }>(`/admin/albums/${id}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
    onSuccess: (detail) => {
      queryClient.setQueryData(albumKeys.detail(id), detail);
      void queryClient.invalidateQueries({ queryKey: ["albums", "list"] });
      if (detail.assignment?.warning) toast({ title: "تم التكليف مع تنبيه", description: detail.assignment.warning });
      onDone?.(detail);
    },
    onError: (error) => toast({ title: "لم تُنفذ العملية", description: apiErrorMessage(error), variant: "destructive" }),
  });
}

export function AlbumPanel({ id, compact = false, initial }: { id: number; compact?: boolean; initial?: AlbumDetail }) {
  const detail = useAlbumDetail(id);
  const meta = useAlbumMeta();
  const brand = useAlbumBrand();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [tab, setTab] = useState<"info" | "money" | "work" | "log">("info");
  const write = useAlbumWrite(id);
  const data = detail.data ?? initial;
  if (detail.isLoading && !data) return <LoadingBlock />;
  if (detail.isError && !data) return <ErrorBlock message={apiErrorMessage(detail.error, "تعذّر تحميل الألبوم")} onRetry={() => void detail.refetch()} />;
  if (!data) return null;
  const { album } = data;
  const access = meta.data?.access;
  const active = album.status === "active";
  const cover = album.attachments.find((file) => (file.mediaType ?? "").startsWith("image") || /\.(jpe?g|png|webp)(\?|$)/i.test(file.url));

  const print = async (kind: "order" | "manufacturing" | "delivery", format: AlbumDocFormat = "a4") => {
    try {
      const html = kind === "order" ? await albumOrderReceiptHtml(album, brand, format)
        : kind === "manufacturing" ? await albumManufacturingOrderHtml(album, brand, data.copies)
        : await albumDeliveryReceiptHtml(album, brand, format);
      printAlbumHtml(html, format);
    } catch (error) {
      toast({ title: "تعذّرت الطباعة", description: apiErrorMessage(error), variant: "destructive" });
    }
  };
  const runAction = (key: string) => {
    if (key === "deliver") return setDialog("deliver");
    if (key === "note") return setDialog("note");
    if (key === "photo") return setDialog("photo");
    write.mutate({ path: "/action", body: { action: key } }, { onSuccess: () => toast({ title: "تم تحديث المرحلة" }) });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold tabular-nums" dir="ltr">{album.albumNo}</h2>
            {active ? <StageBadge stage={album.stage} label={album.stageLabel} delayed={album.delayed} /> : <span className="rounded-full bg-destructive/12 px-2.5 py-1 text-xs font-bold text-destructive">ملغى</span>}
            {data.scannedCopy ? <span className="rounded-full bg-muted px-2 py-1 text-xs font-bold">النسخة {data.scannedCopy}</span> : null}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">{album.customerName}{album.bookingCode ? <> · <span className="tabular-nums" dir="ltr">{album.bookingCode}</span></> : null}</p>
        </div>
        {access?.manage && active && album.stage !== "delivered" ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setDialog("edit")}><Pencil className="h-4 w-4" />تعديل</Button>
        ) : null}
      </div>

      {cover && !compact ? <img src={cover.url} alt="" className="aspect-[4/3] w-full rounded-xl object-cover outline outline-1 -outline-offset-1 outline-black/5" loading="lazy" /> : null}

      <dl className="divide-y divide-border rounded-xl border border-border text-sm">
        <Info label="رقم الهاتف"><a href={`tel:${album.phone}`} className="inline-flex items-center gap-1.5 tabular-nums" dir="ltr"><Phone className="h-3.5 w-3.5" />{formatIraqiPhone(album.phone)}</a></Info>
        <Info label="نوع الألبوم">{album.albumType}</Info>
        <Info label="القياس"><span className="tabular-nums" dir="ltr">{album.albumSize}</span></Info>
        {album.pageCount ? <Info label="عدد الصفحات"><span className="tabular-nums">{album.pageCount}</span> صفحة</Info> : null}
        {album.coverType ? <Info label="الغلاف">{[album.coverType, album.coverColor].filter(Boolean).join(" · ")}</Info> : null}
        <Info label="موعد التسليم"><span className={`tabular-nums ${album.delayed ? "font-bold text-destructive" : ""}`} dir="ltr">{album.dueDate ?? "—"}</span></Info>
        <Info label="المسؤول">{album.designerName ?? album.printerName ?? "—"}</Info>
        {access?.financials && album.remainingAmount !== undefined ? (
          <Info label="المبلغ المتبقي">{album.financeMode === "package" ? <span className="text-muted-foreground">مشمول بالباقة</span> : <b className={`tabular-nums ${Number(album.remainingAmount) > 0 ? "text-destructive" : "text-status-success"}`}>{money(album.remainingAmount)}</b>}</Info>
        ) : album.hasOutstanding ? <Info label="الدفع"><span className="font-bold text-destructive">عليه مبلغ متبقٍ</span></Info> : null}
      </dl>

      {active ? (
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-muted-foreground">إجراءات سريعة</h3>
          <div className="flex flex-wrap gap-2">
            {data.actions.filter((action) => action.key !== "deliver" || access?.deliver).map((action) => (
              <Button key={action.key} type="button" size="sm" variant={action.to && action.key !== "note" ? "default" : "outline"} disabled={write.isPending} onClick={() => runAction(action.key)}>
                {action.key === "deliver" ? <PackageCheck className="h-4 w-4" /> : action.key === "photo" ? <Camera className="h-4 w-4" /> : null}{action.label}
              </Button>
            ))}
          </div>
        </div>
      ) : album.cancelReason ? <p className="rounded-lg bg-destructive/5 p-3 text-sm">سبب الإلغاء: {album.cancelReason}</p> : null}

      <div role="tablist" aria-label="أقسام الألبوم" className={`grid gap-1 rounded-xl bg-muted p-1 text-xs font-bold ${access?.financials ? "grid-cols-[repeat(4,minmax(0,1fr))]" : "grid-cols-[repeat(3,minmax(0,1fr))]"}`}>
        {([["info", "التفاصيل"], ["money", "المالية"], ["work", "المهام"], ["log", "السجل"]] as const).filter(([key]) => key !== "money" || access?.financials).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`rounded-lg px-2 py-2 transition-colors duration-150 ${tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
        ))}
      </div>

      {tab === "info" ? (
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {[["نوع المناسبة", album.occasionType], ["تاريخ المناسبة", album.occasionDate], ["تاريخ الطلب", album.orderDate], ["عدد الصور", album.photoCount], ["عدد النسخ", album.copies], ["ورق الطباعة", album.paperType], ["العلبة", album.boxType], ["الأسماء على الغلاف", album.coverNames], ["الطباعة", album.printerName], ["التجليد", album.binderName], ["فحص الجودة", album.qualityName], ["أنشأه", album.createdByName]]
              .filter(([, value]) => value !== null && value !== undefined && value !== "")
              .map(([label, value]) => <div key={String(label)} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words font-bold">{String(value)}</dd></div>)}
          </dl>
          {album.customerNotes ? <p className="rounded-lg bg-muted/60 p-3"><b>ملاحظات الزبون:</b> {album.customerNotes}</p> : null}
          {album.internalNotes ? <p className="rounded-lg bg-muted/60 p-3"><b>ملاحظات داخلية:</b> {album.internalNotes}</p> : null}
          {album.attachments.length ? (
            <div className="flex flex-wrap gap-2">{album.attachments.map((file) => <a key={file.url} href={file.url} target="_blank" rel="noreferrer" className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted">{file.fileName ?? "مرفق"}</a>)}</div>
          ) : null}
          {album.deliveredAt ? (
            <div className="rounded-lg border border-status-success/30 bg-status-success/5 p-3">
              <p>سُلّم إلى <b>{album.deliveredToName}</b> بواسطة {album.deliveredByName} · <span className="tabular-nums" dir="ltr">{new Date(album.deliveredAt).toLocaleString("en-GB", { hour12: false })}</span></p>
              <div className="mt-2 flex gap-2">{[album.deliveryPhotoUrl, album.deliverySignatureUrl].filter(Boolean).map((url) => <a key={url} href={url!} target="_blank" rel="noreferrer"><img src={url!} alt="" className="h-16 w-16 rounded-lg border border-border object-cover" /></a>)}</div>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <h3 className="text-xs font-bold text-muted-foreground">الطباعة</h3>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void print("order", "a4")}><FileText className="h-4 w-4" />وصل الطلب A4</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void print("order", "80mm")}><Printer className="h-4 w-4" />وصل 80mm</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void print("manufacturing")}><ClipboardList className="h-4 w-4" />أمر التصنيع</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setDialog("labels")}><Tag className="h-4 w-4" />ملصق QR</Button>
              {album.deliveredAt ? <>
                <Button type="button" size="sm" variant="outline" onClick={() => void print("delivery", "a4")}><PackageCheck className="h-4 w-4" />وصل التسليم A4</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => void print("delivery", "80mm")}>وصل التسليم 80mm</Button>
              </> : null}
            </div>
          </div>
          {access?.manage && active && album.stage !== "delivered" ? (
            <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setDialog("cancel")}><Ban className="h-4 w-4" />إلغاء الطلب</Button>
          ) : null}
        </div>
      ) : null}

      {tab === "money" && access?.financials ? (
        <div className="space-y-3 text-sm">
          {album.financeMode === "package" ? (
            <p className="rounded-lg border border-border bg-muted/60 p-3 text-foreground">الألبوم مشمول بباقة الحجز <b dir="ltr">{album.bookingCode}</b>، فلا تُسجل عليه فاتورة أو دفعات منفصلة. متبقي الحجز: <b className="tabular-nums">{money(album.remainingAmount)}</b></p>
          ) : null}
          <dl className="divide-y divide-border rounded-xl border border-border">
            {album.financeMode === "invoice" ? <>
              <Info label="سعر البيع"><b className="tabular-nums">{money(album.salePrice)}</b></Info>
              <Info label="المبلغ المدفوع"><span className="tabular-nums">{money(album.paidAmount)}</span></Info>
              {Number(album.pendingAmount ?? 0) > 0 ? <Info label="دفعات بانتظار الاعتماد"><span className="tabular-nums text-status-warning">{money(album.pendingAmount)}</span></Info> : null}
              <Info label="المبلغ المتبقي"><b className={`tabular-nums ${Number(album.remainingAmount) > 0 ? "text-destructive" : "text-status-success"}`}>{money(album.remainingAmount)}</b></Info>
              {album.invoiceNo ? <Info label="الفاتورة"><a href={`/admin/sales?invoice=${album.invoiceId}`} className="tabular-nums text-primary underline-offset-4 hover:underline" dir="ltr">{album.invoiceNo}</a></Info> : null}
            </> : null}
            <Info label="تكلفة التصميم"><span className="tabular-nums">{money(album.designCost)}</span></Info>
            <Info label="تكلفة الطباعة"><span className="tabular-nums">{money(album.printingCost)}</span></Info>
            <Info label="تكلفة الغلاف"><span className="tabular-nums">{money(album.coverCost)}</span></Info>
            <Info label="تكلفة التجليد"><span className="tabular-nums">{money(album.bindingCost)}</span></Info>
            <Info label="المصاريف الإضافية"><span className="tabular-nums">{money(album.extraCosts)}</span></Info>
            <Info label="إجمالي التكلفة"><b className="tabular-nums">{money(album.totalCost)}</b></Info>
            <Info label="صافي الربح">{album.financeMode === "invoice" ? <b className={`tabular-nums ${Number(album.netProfit) < 0 ? "text-destructive" : "text-status-success"}`}>{money(album.netProfit)}</b> : <span className="text-muted-foreground">ضمن ربح الحجز</span>}</Info>
            {data.materialsCost && Number(data.materialsCost) > 0 ? <Info label="قيمة مواد المخزون المصروفة"><span className="tabular-nums text-muted-foreground">{money(data.materialsCost)}</span></Info> : null}
          </dl>
          {album.financeMode === "invoice" && active && Number(album.remainingAmount) > 0 ? (
            <Button type="button" onClick={() => setDialog("payment")}><CircleDollarSign className="h-4 w-4" />تسجيل دفعة</Button>
          ) : null}
          <p className="text-xs text-muted-foreground">الدفعات تُرسل لاعتماد الإدارة في الصندوق الرئيسي، ثم تُحدّث الفاتورة وكشف حساب الزبون تلقائياً.</p>
        </div>
      ) : null}

      {tab === "work" ? (
        <div className="space-y-4 text-sm">
          <section className="space-y-2">
            <div className="flex items-center justify-between"><h3 className="font-bold">التكليفات</h3>{access?.manage && active ? <Button type="button" size="sm" variant="outline" onClick={() => setDialog("assign")}><UserPlus className="h-4 w-4" />تكليف</Button> : null}</div>
            {data.tasks.length ? (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {data.tasks.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span><b>{ALBUM_ROLES.find((role) => role.key === task.role)?.label ?? task.role}</b> · {task.staffName}</span>
                    {task.workTaskId ? <a href={`/admin/work-commands?order=${task.workTaskId}`} className="text-xs font-bold text-primary tabular-nums" dir="ltr">{task.workOrderNo ?? `#${task.workTaskId}`}</a> : <span className="text-xs text-muted-foreground">بدون أمر عمل</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted-foreground">لا توجد تكليفات بعد.</p>}
          </section>
          <section className="space-y-2">
            <div className="flex items-center justify-between"><h3 className="font-bold">مواد المخزون</h3>{access?.manage && active ? <Button type="button" size="sm" variant="outline" onClick={() => setDialog("material")}><Package className="h-4 w-4" />صرف مادة</Button> : null}</div>
            {data.materials.length ? (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {data.materials.map((line) => (
                  <li key={line.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className={line.returnedAt ? "text-muted-foreground line-through" : ""}><b className="tabular-nums">{line.quantity}</b> × {line.productName}</span>
                    {access?.manage && !line.returnedAt && active ? (
                      <Button type="button" size="sm" variant="ghost" disabled={write.isPending} onClick={() => write.mutate({ path: `/materials/${line.id}/return` }, { onSuccess: () => toast({ title: "أُرجعت المادة للمخزون" }) })}><RotateCcw className="h-3.5 w-3.5" />إرجاع</Button>
                    ) : line.returnedAt ? <span className="text-xs text-muted-foreground">مُرجعة</span> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted-foreground">لم تُصرف مواد بعد. الصرف يمر بمحرك المخزون نفسه ولا يتكرر عند إعادة المحاولة.</p>}
          </section>
          <section className="space-y-2">
            <h3 className="font-bold">رموز النسخ</h3>
            <ul className="flex flex-wrap gap-2">{data.copies.map((copy) => <li key={copy.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs tabular-nums" dir="ltr"><QrCode className="h-3 w-3" />{copy.code}</li>)}</ul>
          </section>
        </div>
      ) : null}

      {tab === "log" ? (
        <ol className="space-y-3 border-r-2 border-border pr-4 text-sm">
          {[...data.events].reverse().map((event) => (
            <li key={event.id} className="relative">
              <span aria-hidden className="absolute -right-[1.42rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
              <p className="font-bold">{eventTitle(event)}</p>
              {event.note ? <p className="whitespace-pre-wrap text-muted-foreground">{event.note}</p> : null}
              {event.attachments.length ? <div className="mt-1 flex gap-2">{event.attachments.map((file) => <a key={file.url} href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt="" className="h-14 w-14 rounded-lg border border-border object-cover" /></a>)}</div> : null}
              <p className="text-xs text-muted-foreground">{event.staffName} · <span className="tabular-nums" dir="ltr">{new Date(event.createdAt).toLocaleString("en-GB", { hour12: false })}</span></p>
            </li>
          ))}
        </ol>
      ) : null}

      <DeliverDialog open={dialog === "deliver"} onClose={() => setDialog(null)} id={id} detail={data} canOverride={Boolean(access?.financials)} onPrint={() => void print("delivery", "80mm")} />
      <PaymentDialog open={dialog === "payment"} onClose={() => setDialog(null)} id={id} remaining={album.remainingAmount} pending={album.pendingAmount} />
      <AssignDialog open={dialog === "assign"} onClose={() => setDialog(null)} id={id} />
      <NoteDialog open={dialog === "note" || dialog === "photo"} photo={dialog === "photo"} onClose={() => setDialog(null)} id={id} />
      <MaterialDialog open={dialog === "material"} onClose={() => setDialog(null)} id={id} />
      <CancelDialog open={dialog === "cancel"} onClose={() => setDialog(null)} id={id} />
      <EditDialog open={dialog === "edit"} onClose={() => setDialog(null)} id={id} detail={data} canMoney={Boolean(access?.financials)} />
      <LabelsDialog open={dialog === "labels"} onClose={() => setDialog(null)} detail={data} />
    </div>
  );
}

/** The stage bar shown under the table; a manager can jump to any stage (going back asks why). */
export function AlbumStageBar({ id }: { id: number }) {
  const detail = useAlbumDetail(id);
  const meta = useAlbumMeta();
  const write = useAlbumWrite(id);
  const { toast } = useToast();
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!detail.data) return null;
  const { album, events } = detail.data;
  const canPick = album.status === "active" && album.stage !== "delivered" && Boolean(meta.data?.access.viewAll);
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="mb-4 font-bold">مراحل تنفيذ الألبوم <span className="tabular-nums" dir="ltr">{album.albumNo}</span></h3>
      <StageStepper stage={album.stage} events={events} disabled={write.isPending} onPick={canPick ? (stage) => { if (stage === "delivered") { toast({ title: "التسليم من زر «تسليم للزبون»" }); return; } setTarget(stage); setNote(""); } : undefined} />
      <Dialog open={Boolean(target)} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent dir="rtl">
          <DialogHeader className="text-right"><DialogTitle>نقل إلى «{albumStageLabel(target)}»</DialogTitle><DialogDescription>تُسجل المرحلة باسمك مع التاريخ والوقت.</DialogDescription></DialogHeader>
          <Field label="ملاحظة" htmlFor="stage-note" hint="مطلوبة عند إرجاع الألبوم لمرحلة سابقة"><Textarea id="stage-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
          <DialogFooter className="flex-row-reverse gap-2 sm:justify-start">
            <Button type="button" disabled={write.isPending} onClick={() => write.mutate({ path: "/stage", body: { to: target, note } }, { onSuccess: () => { setTarget(null); toast({ title: "تم تحديث المرحلة" }); } })}>{write.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}تأكيد</Button>
            <Button type="button" variant="outline" onClick={() => setTarget(null)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 px-3 py-2"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 text-left font-medium">{children}</dd></div>;
}

function Modal({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader className="text-right"><DialogTitle>{title}</DialogTitle>{description ? <DialogDescription>{description}</DialogDescription> : null}</DialogHeader>
        <div className="space-y-3">{children}</div>
        <DialogFooter className="flex-row-reverse gap-2 sm:justify-start">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function uploadPhoto(file: File) {
  const result = await uploadImageWithVariants(file, { folder: "uploads/albums" });
  return result.originalUrl;
}

function DeliverDialog({ open, onClose, id, detail, canOverride, onPrint }: { open: boolean; onClose: () => void; id: number; detail: AlbumDetail; canOverride: boolean; onPrint: () => void }) {
  const { toast } = useToast();
  const [receiver, setReceiver] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [allow, setAllow] = useState(false);
  const [busy, setBusy] = useState(false);
  const write = useAlbumWrite(id);
  useEffect(() => { if (open) { setReceiver(detail.album.customerName); setNote(""); setPhoto(null); setSignature(null); setAllow(false); } }, [open, detail.album.customerName]);
  const owes = detail.album.hasOutstanding;
  const submit = () => write.mutate({ path: "/deliver", body: { receiverName: receiver, note, photoUrl: photo, signatureUrl: signature, allowOutstanding: allow } }, {
    onSuccess: () => { onClose(); toast({ title: "تم تسليم الألبوم", description: "يمكنك طباعة وصل التسليم الآن" }); onPrint(); },
  });
  return (
    <Modal open={open} onClose={onClose} title={`تسليم ${detail.album.albumNo}`} description="يُسجل المستلم والموظف والتاريخ والوقت، ولا يمكن تكرار التسليم."
      footer={<><Button type="button" disabled={write.isPending || busy || !receiver.trim() || (owes && !allow)} onClick={submit}>{write.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}تأكيد التسليم</Button><Button type="button" variant="outline" onClick={onClose}>إلغاء</Button></>}>
      {owes ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-bold text-destructive">{detail.album.remainingAmount !== undefined ? `على الزبون مبلغ متبقٍ ${money(detail.album.remainingAmount)}` : "على الزبون مبلغ متبقٍ"}</p>
          {canOverride ? <label className="mt-2 flex items-center gap-2 font-bold"><input type="checkbox" checked={allow} onChange={(event) => setAllow(event.target.checked)} />أوافق على التسليم مع بقاء المبلغ</label> : <p className="mt-1 text-xs">التسليم مع متبقٍ يحتاج صلاحية مالية؛ راجع المحاسب أولاً.</p>}
        </div>
      ) : null}
      <Field label="اسم المستلم" htmlFor="deliver-receiver" required><Input id="deliver-receiver" value={receiver} onChange={(event) => setReceiver(event.target.value)} /></Field>
      <Field label="ملاحظة" htmlFor="deliver-note"><Input id="deliver-note" value={note} onChange={(event) => setNote(event.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <PhotoPicker label="صورة التسليم (اختياري)" value={photo} onChange={setPhoto} onBusy={setBusy} />
        <SignaturePad value={signature} onChange={setSignature} onBusy={setBusy} />
      </div>
    </Modal>
  );
}

function PhotoPicker({ label, value, onChange, onBusy }: { label: string; value: string | null; onChange: (url: string | null) => void; onBusy: (busy: boolean) => void }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-bold">{label}</span>
      {value ? (
        <div className="flex items-center gap-2"><img src={value} alt="" className="h-20 w-20 rounded-lg border border-border object-cover" /><Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>إزالة</Button></div>
      ) : (
        <label className="flex h-20 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border text-xs font-bold hover:bg-muted/50">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}التقاط أو اختيار صورة
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={uploading} onChange={async (event) => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (!file) return;
            setUploading(true); onBusy(true);
            try { onChange(await uploadPhoto(file)); } catch (error) { toast({ title: "تعذّر رفع الصورة", description: apiErrorMessage(error), variant: "destructive" }); } finally { setUploading(false); onBusy(false); }
          }} />
        </label>
      )}
    </div>
  );
}

/** Finger/mouse signature, uploaded as a small PNG through the normal upload pipeline. */
function SignaturePad({ value, onChange, onBusy }: { value: string | null; onChange: (url: string | null) => void; onBusy: (busy: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width, y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height };
  };
  const clear = () => { const canvas = canvasRef.current; canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); setDirty(false); onChange(null); };
  if (value) return <div className="space-y-1.5"><span className="text-xs font-bold">توقيع المستلم</span><div className="flex items-center gap-2"><img src={value} alt="التوقيع" className="h-20 rounded-lg border border-border bg-white" /><Button type="button" size="sm" variant="ghost" onClick={clear}>إعادة</Button></div></div>;
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-bold">توقيع المستلم (اختياري)</span>
      <canvas ref={canvasRef} width={480} height={160} className="h-20 w-full touch-none rounded-lg border border-border bg-white"
        onPointerDown={(event) => { drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); const ctx = event.currentTarget.getContext("2d")!; const p = point(event); ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.strokeStyle = "#111"; ctx.beginPath(); ctx.moveTo(p.x, p.y); }}
        onPointerMove={(event) => { if (!drawing.current) return; const ctx = event.currentTarget.getContext("2d")!; const p = point(event); ctx.lineTo(p.x, p.y); ctx.stroke(); setDirty(true); }}
        onPointerUp={() => { drawing.current = false; }} />
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!dirty || saving} onClick={async () => {
          const canvas = canvasRef.current; if (!canvas) return;
          setSaving(true); onBusy(true);
          try {
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
            if (!blob) throw new Error("تعذّر حفظ التوقيع");
            onChange(await uploadPhoto(new File([blob], "signature.png", { type: "image/png" })));
          } catch (error) { toast({ title: "تعذّر حفظ التوقيع", description: apiErrorMessage(error), variant: "destructive" }); } finally { setSaving(false); onBusy(false); }
        }}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}اعتماد التوقيع</Button>
        <Button type="button" size="sm" variant="ghost" disabled={!dirty} onClick={clear}>مسح</Button>
      </div>
    </div>
  );
}

function PaymentDialog({ open, onClose, id, remaining, pending }: { open: boolean; onClose: () => void; id: number; remaining?: string; pending?: string }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const keyRef = useRef(newKey());
  const write = useAlbumWrite(id);
  useEffect(() => { if (open) { setAmount(""); setMethod("cash"); setNotes(""); setError(""); keyRef.current = newKey(); } }, [open]);
  const available = Math.max(0, Number(remaining ?? 0) - Number(pending ?? 0));
  return (
    <Modal open={open} onClose={onClose} title="تسجيل دفعة" description={`المتاح للتحصيل ${money(available)} — تُرسل الدفعة لاعتماد الإدارة في الصندوق.`}
      footer={<><Button type="button" disabled={write.isPending || !(Number(amount) > 0)} onClick={() => write.mutate({ path: "/payments", body: { amount, method, notes, idempotencyKey: keyRef.current } }, {
        onSuccess: () => { onClose(); toast({ title: "أُرسلت الدفعة للاعتماد" }); },
        onError: (err) => setError(err instanceof AjNApiError ? err.fieldErrors?.amount ?? "" : ""),
      })}>{write.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}إرسال للاعتماد</Button><Button type="button" variant="outline" onClick={onClose}>إلغاء</Button></>}>
      <Field label="المبلغ" htmlFor="pay-amount" required error={error}><Input id="pay-amount" inputMode="decimal" dir="ltr" className="text-right tabular-nums" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
      <Field label="طريقة الدفع" htmlFor="pay-method">
        <select id="pay-method" value={method} onChange={(event) => setMethod(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
          <option value="cash">نقداً</option><option value="transfer">تحويل</option><option value="pos">بطاقة / POS</option><option value="other">أخرى</option>
        </select>
      </Field>
      <Field label="ملاحظات" htmlFor="pay-notes"><Input id="pay-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
    </Modal>
  );
}

function AssignDialog({ open, onClose, id }: { open: boolean; onClose: () => void; id: number }) {
  const meta = useAlbumMeta();
  const { toast } = useToast();
  const [role, setRole] = useState("design");
  const [staffId, setStaffId] = useState<number | null>(null);
  const write = useAlbumWrite(id);
  useEffect(() => { if (open) { setRole("design"); setStaffId(null); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="تكليف موظف" description="يُرسل أمر عمل للموظف في مركز أوامر العمل ويصله إشعار."
      footer={<><Button type="button" disabled={write.isPending || !staffId} onClick={() => write.mutate({ path: "/assign", body: { role, staffId } }, { onSuccess: () => { onClose(); toast({ title: "تم التكليف" }); } })}>{write.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}تكليف</Button><Button type="button" variant="outline" onClick={onClose}>إلغاء</Button></>}>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="المهمة">
        {ALBUM_ROLES.map((item) => (
          <label key={item.key} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${role === item.key ? "border-primary bg-primary/5 font-bold" : "border-border"}`}>
            <input type="radio" name="album-role" checked={role === item.key} onChange={() => setRole(item.key)} />{item.label}
          </label>
        ))}
      </div>
      <StaffSelect id="assign-staff" label="الموظف" value={staffId} staff={meta.data?.staff ?? []} onChange={setStaffId} />
    </Modal>
  );
}

function NoteDialog({ open, photo, onClose, id }: { open: boolean; photo: boolean; onClose: () => void; id: number }) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const write = useAlbumWrite(id);
  useEffect(() => { if (open) { setNote(""); setUrl(null); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={photo ? "رفع صورة" : "تسجيل ملاحظة"}
      footer={<><Button type="button" disabled={write.isPending || busy || (photo ? !url : !note.trim())} onClick={() => write.mutate({ path: "/action", body: { action: photo ? "photo" : "note", note, attachments: url ? [{ url, mediaType: "image" }] : [] } }, { onSuccess: () => { onClose(); toast({ title: "تم الحفظ" }); } })}>{write.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}حفظ</Button><Button type="button" variant="outline" onClick={onClose}>إلغاء</Button></>}>
      {photo ? <PhotoPicker label="الصورة" value={url} onChange={setUrl} onBusy={setBusy} /> : null}
      <Field label={photo ? "وصف (اختياري)" : "الملاحظة"} htmlFor="album-note"><Textarea id="album-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
    </Modal>
  );
}

function MaterialDialog({ open, onClose, id }: { open: boolean; onClose: () => void; id: number }) {
  const { toast } = useToast();
  const [term, setTerm] = useState("");
  const [product, setProduct] = useState<{ id: number; name: string; stock: number; trackInventory: boolean } | null>(null);
  const [quantity, setQuantity] = useState("1");
  const keyRef = useRef(newKey());
  const write = useAlbumWrite(id);
  useEffect(() => { if (open) { setTerm(""); setProduct(null); setQuantity("1"); keyRef.current = newKey(); } }, [open]);
  const search = useQuery({
    queryKey: ["albums", "products", term],
    queryFn: () => adminFetch<{ products: Array<{ id: number; name: string; barcode: string | null; stock: number; trackInventory: boolean }> }>(`/admin/albums/products?q=${encodeURIComponent(term)}`),
    enabled: open && term.trim().length >= 1 && !product,
  });
  return (
    <Modal open={open} onClose={onClose} title="صرف مادة من المخزون" description="ورق الطباعة، الأغلفة، العلب، مواد التجليد وغيرها — تُخصم عبر محرك المخزون مرة واحدة فقط."
      footer={<><Button type="button" disabled={write.isPending || !product || !(Number(quantity) > 0)} onClick={() => write.mutate({ path: "/materials", body: { productId: product!.id, quantity: Number(quantity), requestKey: keyRef.current } }, { onSuccess: () => { onClose(); toast({ title: "تم صرف المادة" }); } })}>{write.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}صرف</Button><Button type="button" variant="outline" onClick={onClose}>إلغاء</Button></>}>
      {product ? (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm"><span><b>{product.name}</b> · المتاح <span className="tabular-nums">{product.stock}</span></span><button type="button" className="text-xs font-bold text-primary" onClick={() => setProduct(null)}>تغيير</button></div>
      ) : (
        <Field label="المادة" htmlFor="material-search">
          <Input id="material-search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="اسم المادة أو الباركود" autoComplete="off" />
          <ul className="max-h-48 overflow-y-auto">{search.data?.products.map((item) => <li key={item.id}><button type="button" onClick={() => setProduct(item)} className="flex w-full justify-between rounded-md px-2 py-2 text-right text-sm hover:bg-muted"><span>{item.name}</span><span className="tabular-nums text-xs text-muted-foreground">{item.trackInventory ? `المتاح ${item.stock}` : "غير مخزني"}</span></button></li>)}</ul>
        </Field>
      )}
      <Field label="الكمية" htmlFor="material-qty"><Input id="material-qty" type="number" min={0.001} step="any" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
    </Modal>
  );
}

function CancelDialog({ open, onClose, id }: { open: boolean; onClose: () => void; id: number }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const write = useAlbumWrite(id);
  useEffect(() => { if (open) setReason(""); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="إلغاء طلب الألبوم" description="يُلغى الطلب وفاتورته إن لم تكن عليها دفعات. المواد المصروفة تُرجع للمخزون أولاً."
      footer={<><Button type="button" variant="destructive" disabled={write.isPending || !reason.trim()} onClick={() => write.mutate({ path: "/cancel", body: { reason } }, { onSuccess: () => { onClose(); toast({ title: "تم إلغاء الطلب" }); } })}>{write.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}تأكيد الإلغاء</Button><Button type="button" variant="outline" onClick={onClose}>رجوع</Button></>}>
      <Field label="سبب الإلغاء" htmlFor="cancel-reason" required><Textarea id="cancel-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
    </Modal>
  );
}

function EditDialog({ open, onClose, id, detail, canMoney }: { open: boolean; onClose: () => void; id: number; detail: AlbumDetail; canMoney: boolean }) {
  const { toast } = useToast();
  const write = useAlbumWrite(id);
  const a = detail.album;
  const initial = () => ({
    dueDate: a.dueDate ?? "", pageCount: a.pageCount ? String(a.pageCount) : "", photoCount: a.photoCount ? String(a.photoCount) : "", copies: String(a.copies),
    coverNames: a.coverNames ?? "", customerNotes: a.customerNotes ?? "", internalNotes: a.internalNotes ?? "",
    salePrice: a.salePrice ?? "", designCost: a.designCost ?? "", printingCost: a.printingCost ?? "", coverCost: a.coverCost ?? "", bindingCost: a.bindingCost ?? "", extraCosts: a.extraCosts ?? "",
  });
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setForm(initial()); setErrors({}); } }, [open]);
  const set = (key: keyof ReturnType<typeof initial>, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const save = () => {
    const body: Record<string, unknown> = { dueDate: form.dueDate || undefined, pageCount: form.pageCount || undefined, photoCount: form.photoCount || undefined, copies: form.copies || undefined, coverNames: form.coverNames, customerNotes: form.customerNotes, internalNotes: form.internalNotes };
    if (canMoney) Object.assign(body, { designCost: form.designCost, printingCost: form.printingCost, coverCost: form.coverCost, bindingCost: form.bindingCost, extraCosts: form.extraCosts, ...(a.financeMode === "invoice" ? { salePrice: form.salePrice } : {}) });
    write.mutate({ path: "", method: "PATCH", body }, { onSuccess: () => { onClose(); toast({ title: "تم حفظ التعديل" }); }, onError: (error) => setErrors(error instanceof AjNApiError ? error.fieldErrors ?? {} : {}) });
  };
  return (
    <Modal open={open} onClose={onClose} title={`تعديل ${a.albumNo}`} footer={<><Button type="button" disabled={write.isPending} onClick={save}>{write.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}حفظ</Button><Button type="button" variant="outline" onClick={onClose}>إلغاء</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="موعد التسليم" htmlFor="edit-due" error={errors.dueDate}><DateField id="edit-due" type="date" value={form.dueDate} onChange={(event) => set("dueDate", event.target.value)} /></Field>
        <Field label="عدد النسخ" htmlFor="edit-copies" error={errors.copies} hint="يمكن زيادة النسخ فقط"><Input id="edit-copies" type="number" min={a.copies} value={form.copies} onChange={(event) => set("copies", event.target.value)} /></Field>
        <Field label="عدد الصفحات" htmlFor="edit-pages" error={errors.pageCount}><Input id="edit-pages" type="number" min={1} value={form.pageCount} onChange={(event) => set("pageCount", event.target.value)} /></Field>
        <Field label="عدد الصور" htmlFor="edit-photos" error={errors.photoCount}><Input id="edit-photos" type="number" min={0} value={form.photoCount} onChange={(event) => set("photoCount", event.target.value)} /></Field>
      </div>
      <Field label="الأسماء على الغلاف" htmlFor="edit-names"><Input id="edit-names" value={form.coverNames} onChange={(event) => set("coverNames", event.target.value)} /></Field>
      <Field label="ملاحظات الزبون" htmlFor="edit-cnotes"><Textarea id="edit-cnotes" rows={2} value={form.customerNotes} onChange={(event) => set("customerNotes", event.target.value)} /></Field>
      <Field label="ملاحظات داخلية" htmlFor="edit-inotes"><Textarea id="edit-inotes" rows={2} value={form.internalNotes} onChange={(event) => set("internalNotes", event.target.value)} /></Field>
      {canMoney ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {a.financeMode === "invoice" ? <Field label="سعر البيع" htmlFor="edit-price" error={errors.salePrice}><Input id="edit-price" inputMode="decimal" dir="ltr" className="text-right tabular-nums" value={form.salePrice} onChange={(event) => set("salePrice", event.target.value)} /></Field> : null}
          {([["designCost", "التصميم"], ["printingCost", "الطباعة"], ["coverCost", "الغلاف"], ["bindingCost", "التجليد"], ["extraCosts", "إضافية"]] as const).map(([key, label]) => (
            <Field key={key} label={`تكلفة ${label}`} htmlFor={`edit-${key}`} error={errors[key]}><Input id={`edit-${key}`} inputMode="decimal" dir="ltr" className="text-right tabular-nums" value={form[key]} onChange={(event) => set(key, event.target.value)} /></Field>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}

function LabelsDialog({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: AlbumDetail }) {
  const brand = useAlbumBrand();
  const { toast } = useToast();
  const [size, setSize] = useState("50x30");
  const [custom, setCustom] = useState({ width: "80", height: "50" });
  const [busy, setBusy] = useState(false);
  const print = async () => {
    const preset = ALBUM_LABEL_SIZES.find((item) => item.key === size);
    const width = preset?.width ?? Number(custom.width);
    const height = preset?.height ?? Number(custom.height);
    if (!(width >= 25 && width <= 150 && height >= 15 && height <= 150)) { toast({ title: "مقاس الملصق غير صالح", description: "العرض 25–150 ملم والارتفاع 15–150 ملم", variant: "destructive" }); return; }
    setBusy(true);
    try { printAlbumHtml(await albumLabelsHtml(detail.album, detail.copies, brand, { width, height }), "label"); onClose(); }
    catch (error) { toast({ title: "تعذّرت الطباعة", description: apiErrorMessage(error), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="طباعة ملصق الألبوم" description={`ملصق لكل نسخة (${detail.copies.length}) يحمل QR وباركود بلا بيانات الزبون داخله.`}
      footer={<><Button type="button" disabled={busy} onClick={() => void print()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}طباعة</Button><Button type="button" variant="outline" onClick={onClose}>إلغاء</Button></>}>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="مقاس الملصق">
        {[...ALBUM_LABEL_SIZES.map((item) => [item.key, item.label] as const), ["custom", "مقاس مخصص"] as const].map(([key, label]) => (
          <label key={key} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${size === key ? "border-primary bg-primary/5 font-bold" : "border-border"}`}>
            <input type="radio" name="label-size" checked={size === key} onChange={() => setSize(key)} />{label}
          </label>
        ))}
      </div>
      {size === "custom" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="العرض (ملم)" htmlFor="label-w"><Input id="label-w" type="number" min={25} max={150} value={custom.width} onChange={(event) => setCustom((current) => ({ ...current, width: event.target.value }))} /></Field>
          <Field label="الارتفاع (ملم)" htmlFor="label-h"><Input id="label-h" type="number" min={15} max={150} value={custom.height} onChange={(event) => setCustom((current) => ({ ...current, height: event.target.value }))} /></Field>
        </div>
      ) : null}
    </Modal>
  );
}
