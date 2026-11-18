import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Download, ImagePlus, Loader2, MessageCircle, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmployeeSelect } from "@/components/employee-select";
import { employeeDisplayName, type EmployeeIdentity } from "@/lib/employee-identity";
import { bookingShareText, bookingShareWhatsAppHref, bookingShareWithFinancialSummary, type ShareBooking, type SharePhoto, type ShareFinancialSummary } from "@/lib/booking-share";
import { prepareBookingShareCards } from "@/lib/booking-share-image";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";

export function BookingShareDialog({ booking, photos, photosLoading, photosError, onRetryPhotos, onClose }: {
  booking: ShareBooking; photos: SharePhoto[]; photosLoading?: boolean; photosError?: unknown;
  onRetryPhotos: () => void; onClose: () => void;
}) {
  const [recipient, setRecipient] = useState<"customer" | "employee">("customer");
  const [employeeId, setEmployeeId] = useState("");
  const [phone, setPhone] = useState(booking.phone || "");
  const [financial, setFinancial] = useState(true);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState(() => new Set(photos.map(photo => photo.key)));
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState([0, 1]);
  const [failure, setFailure] = useState("");
  const [feedback, setFeedback] = useState("");
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const selectionEdited = useRef(false);
  const finance = useQuery<ShareFinancialSummary>({
    queryKey: ["admin", "booking-operations", booking.source, booking.id, "share-financial-summary"], enabled: financial,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await adminFetch<{ summary: ShareFinancialSummary }>(`/admin/booking-operations/${booking.source}/${booking.id}/finance?summary=1`);
      bookingShareWithFinancialSummary(booking, result.summary);
      return result.summary;
    },
  });
  let preparedBooking = booking, financialDataFailure = "";
  try { if (financial && finance.data) preparedBooking = bookingShareWithFinancialSummary(booking, finance.data); } catch (cause) { financialDataFailure = apiErrorMessage(cause); }
  const photoIdentity = JSON.stringify(photos.map(photo => [photo.key, photo.url, photo.name]));
  const fields = (booking.source === "kosha" ? booking.raw.bookingDetails : booking.raw.customFields) || {};
  const bookingIdentity = JSON.stringify([booking.number, booking.customerName, booking.phone, booking.eventDate, booking.eventTime, booking.eventType, fields.eventType, booking.hall, booking.services, booking.bookedItems, booking.raw.serviceItems, booking.raw.items, fields.flowerItems, fields.giftItems, fields.soundItems, fields.videoItems, fields.photographyItems, fields.koshaSelection, preparedBooking.total, preparedBooking.paid, preparedBooking.remaining]);
  useEffect(() => { if (recipient === "customer") { setPhone(booking.phone || ""); setFiles([]); } }, [booking.phone, booking.customerName, recipient]);
  useEffect(() => { const available = new Set(photos.map(photo => photo.key)); setSelected(current => selectionEdited.current ? new Set([...current].filter(key => available.has(key))) : available); }, [photoIdentity]);
  useEffect(() => { controller.current?.abort(); submitting.current = false; setBusy(false); setFiles([]); }, [photoIdentity, bookingIdentity, Boolean(photosError), financial && finance.isFetching]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { const next = files.map(file => URL.createObjectURL(file)); setUrls(next); return () => next.forEach(url => URL.revokeObjectURL(url)); }, [files]);
  const employees = useQuery<EmployeeIdentity[]>({
    queryKey: ["admin", "staff", "share-directory"], enabled: recipient === "employee", staleTime: 60_000,
    queryFn: async () => { const rows = await adminFetch<EmployeeIdentity[]>("/admin/staff?view=directory"); if (!Array.isArray(rows)) throw Error("تعذر قراءة دليل الموظفين"); return rows; },
  });
  const employee = employees.data?.find(row => String(row.id) === employeeId);
  const recipientName = recipient === "customer" ? String(booking.customerName || "").trim() || "الزبون" : employee ? employeeDisplayName(employee) : "";
  let text = "", dataFailure = financialDataFailure;
  try { text = bookingShareText(preparedBooking, financial && finance.isSuccess, note); } catch (cause) { dataFailure = apiErrorMessage(cause); }
  if (financial && finance.isError) dataFailure = apiErrorMessage(finance.error);
  const href = bookingShareWhatsAppHref(phone, text);
  const validRecipient = Boolean(href && recipientName && !dataFailure && (!financial || (finance.isSuccess && !finance.isFetching)) && (recipient === "customer" || (!employees.isError && !employees.isPending)));
  const ready = files.length > 0 && validRecipient && !photosError && !photosLoading;
  const nativeShare = files.length > 0 && typeof navigator !== "undefined" && typeof navigator.share === "function" && navigator.canShare?.({ files });

  function reset() { setFiles([]); setFailure(""); setFeedback(""); }
  function close() { controller.current?.abort(); onClose(); }
  async function prepare() {
    if (submitting.current || !validRecipient || photosLoading || photosError) return;
    submitting.current = true; controller.current = new AbortController(); setBusy(true); reset();
    const activeController = controller.current, signal = activeController.signal;
    try { const result = await prepareBookingShareCards({ booking: preparedBooking, financial, note, photos: photos.filter(photo => selected.has(photo.key)), signal, onProgress: (done, total) => setProgress([done, total]) }); if (!signal.aborted) setFiles(result); }
    catch (cause) { if (!signal.aborted) setFailure(apiErrorMessage(cause)); }
    finally { if (controller.current === activeController) { submitting.current = false; if (!signal.aborted) setBusy(false); } }
  }
  function download(index: number) {
    const link = document.createElement("a"); link.href = urls[index]; link.download = files[index].name; link.click();
    setFeedback("تم تنزيل الصورة؛ افتح محادثة المستلم المختار وأرفقها قبل الإرسال.");
  }
  async function copy(index: number) {
    setFailure("");
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": files[index] })]); setFeedback("تم نسخ الصورة. افتح واتساب والصقها في المحادثة ثم راجع الإرسال."); }
    catch (cause) { setFailure(`تعذر نسخ الصورة؛ يمكنك تنزيلها وإرفاقها يدوياً. ${apiErrorMessage(cause)}`); }
  }
  async function shareFiles() {
    setFailure("");
    try { await navigator.share({ files, title: `الحجز ${booking.number} — ${recipientName}`, text }); setFeedback("أُغلقت نافذة مشاركة الجهاز. تحقق من المستلم والإرسال داخل واتساب."); }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setFailure(apiErrorMessage(cause)); }
  }

  return <Dialog open onOpenChange={open => !open && close()}>
    <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader><DialogTitle>إرسال تفاصيل الحجز وصور المحجوزات</DialogTitle><DialogDescription>الحجز {booking.number} · اختر المستلم والصور وراجع المعاينة. تأكيد الإرسال يتم داخل واتساب.</DialogDescription></DialogHeader>
      <FieldGroup className="gap-4">
        <FieldSet disabled={busy}><FieldLegend variant="label">نوع المستلم</FieldLegend>
          <ToggleGroup type="single" value={recipient} variant="outline" className="justify-start" onValueChange={value => { if (value !== "customer" && value !== "employee") return; setRecipient(value); setPhone(value === "customer" ? booking.phone || "" : ""); setEmployeeId(""); setFinancial(value === "customer"); reset(); }} aria-label="نوع المستلم">
            <ToggleGroupItem value="customer">الزبون</ToggleGroupItem><ToggleGroupItem value="employee">موظف أختاره</ToggleGroupItem>
          </ToggleGroup>
        </FieldSet>
        {recipient === "employee" ? <Field>
          <FieldLabel htmlFor="booking-share-employee">الموظف المستلم</FieldLabel>
          <EmployeeSelect id="booking-share-employee" employees={employees.data || []} value={employeeId} disabled={busy || employees.isPending || employees.isError} onValueChange={value => { setEmployeeId(value); setPhone(""); reset(); }} aria-label="اختر الموظف المستلم" />
          {employees.isPending ? <p role="status" className="text-sm">جارٍ تحميل دليل الموظفين…</p> : employees.isError ? <div role="alert" className="text-sm text-destructive">{apiErrorMessage(employees.error)}<Button type="button" variant="outline" onClick={() => void employees.refetch()}>إعادة تحميل الموظفين</Button></div> : null}
          <p className="text-xs text-muted-foreground">أدخل رقم واتساب الموظف لهذا الإرسال؛ لا يوجد رقم هاتف محفوظ في سجل الموظفين الحالي.</p>
        </Field> : <p className="text-sm font-semibold">الزبون: {booking.customerName}</p>}
        <Field data-invalid={!href || undefined} data-disabled={busy}><FieldLabel htmlFor="booking-share-phone">رقم واتساب المستلم</FieldLabel><Input id="booking-share-phone" type="tel" dir="ltr" aria-invalid={!href} value={phone} disabled={busy} onChange={event => { setPhone(event.target.value); reset(); }} /></Field>
        {!href ? <p role="status" className="text-sm text-destructive">أدخل رقم موبايل عراقي صحيحاً.</p> : null}
        <Field orientation="horizontal" data-disabled={busy}><input id="booking-share-financial" type="checkbox" checked={financial} disabled={busy} onChange={event => { setFinancial(event.target.checked); reset(); }} /><FieldLabel htmlFor="booking-share-financial">تضمين الإجمالي والمدفوع والمتبقي في النسخة المرسلة</FieldLabel></Field>
        {financial && finance.isFetching ? <p role="status" className="text-sm text-muted-foreground">جارٍ قراءة المبالغ من حساب الحجز المعتمد…</p> : null}
        {financial && finance.isError ? <div role="alert" className="text-sm text-destructive">تعذر قراءة المبالغ المعتمدة. <Button type="button" variant="outline" onClick={() => void finance.refetch()}>إعادة قراءة الحساب</Button><p>يمكن إلغاء تضمين المبالغ لمشاركة التفاصيل التشغيلية فقط.</p></div> : null}
        <Field data-disabled={busy}><FieldLabel htmlFor="booking-share-note">ملاحظة للمستلم (اختياري)</FieldLabel><Textarea id="booking-share-note" rows={2} maxLength={600} value={note} disabled={busy} onChange={event => { setNote(event.target.value); reset(); }} /></Field>
        <FieldSet className="min-w-0" aria-label="اختيار صور المحجوزات">
          <FieldLegend variant="label">صور المحجوزات ({selected.size} / {photos.length})</FieldLegend>
          {photosError ? <div role="alert" className="text-sm text-destructive">تعذر تحميل بيانات صور المحجوزات. {apiErrorMessage(photosError)}<Button type="button" variant="outline" onClick={onRetryPhotos}>إعادة المحاولة</Button></div> : photosLoading ? <p role="status">جارٍ تحميل صور المحجوزات…</p> : photos.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map(photo => <label key={photo.key} className="flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border p-2">
            <img src={photo.thumbnailUrl || photo.url} alt={photo.name} className="h-28 w-full object-contain" />
            <span className="flex items-start gap-2 text-xs"><input type="checkbox" checked={selected.has(photo.key)} disabled={busy} onChange={() => { selectionEdited.current = true; setSelected(current => { const next = new Set(current); if (next.has(photo.key)) next.delete(photo.key); else next.add(photo.key); return next; }); reset(); }} /><span>{photo.name}<small className="block text-muted-foreground">{photo.label}</small></span></span>
          </label>)}</div> : <p className="text-sm text-muted-foreground">لا توجد صور محجوزات مرتبطة؛ يمكنك تجهيز تفاصيل الحجز وحدها.</p>}
        </FieldSet>
        <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-semibold">معاينة نص التفاصيل</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">{text}</p></details>
        <Button type="button" disabled={!validRecipient || busy || photosLoading || Boolean(photosError)} onClick={() => void prepare()}>{busy ? <Loader2 className="animate-spin" /> : <ImagePlus />} {busy ? `جارٍ التجهيز ${progress[0]} / ${progress[1]}` : "تجهيز التفاصيل والصور"}</Button>
        {failure || dataFailure ? <p role="alert" className="break-words rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{failure || dataFailure}</p> : null}
        {ready ? <section className="flex flex-col gap-3" aria-label="معاينة الصور الجاهزة للمشاركة">
          <p className="text-sm font-semibold">المستلم: {recipientName} · <bdi>{phone}</bdi> · {files.length} صورة جاهزة</p>
          <p className="text-xs leading-6 text-muted-foreground">رابط واتساب يفتح محادثة الشخص المختار مع النص. انسخ الصور أو نزّلها وأرفقها بنفسك. مشاركة الجهاز تتيح اختيار واتساب والمستلم من هاتفك.</p>
          <div className="grid gap-3 sm:grid-cols-2">{files.map((file, index) => <article key={file.name} className="flex min-w-0 flex-col gap-2 rounded-xl border p-2">{urls[index] ? <a href={urls[index]} target="_blank" rel="noopener noreferrer"><img src={urls[index]} alt={`معاينة تفاصيل الحجز وصور المحجوزات — الجزء ${index + 1}`} className="max-h-96 w-full object-contain" /></a> : null}<div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={!urls[index]} onClick={() => download(index)}><Download />حفظ الصورة {index + 1}</Button><Button type="button" size="sm" variant="outline" disabled={typeof ClipboardItem === "undefined" || !navigator.clipboard?.write} onClick={() => void copy(index)}><Copy />نسخ الصورة {index + 1}</Button></div></article>)}</div>
          <div className="flex flex-wrap gap-2">{href && validRecipient ? <Button asChild><a href={href} target="_blank" rel="noopener noreferrer"><MessageCircle />فتح واتساب للمستلم المختار</a></Button> : null}{nativeShare ? <Button type="button" variant="outline" onClick={() => void shareFiles()}><Share2 />مشاركة الصور من الجهاز</Button> : null}</div>
        </section> : null}
        {feedback ? <p role="status" className="text-sm text-primary">{feedback}</p> : null}
      </FieldGroup>
    </DialogContent>
  </Dialog>;
}
