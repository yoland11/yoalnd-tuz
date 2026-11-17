import React, { useRef, useState } from "react";
import { FileDown, Loader2, Printer, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { printStandaloneDocument } from "@/lib/pdf";
import { downloadReportPdf } from "@/lib/pdf-report";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "../_lib";
import { researchOrderSheetHtml } from "../research-print";
import { researchFetch, type ResearchRecord } from "./shared";
import { researchOrderShareText, whatsappLink } from "./ui-model";

/** Read-only actions for the saved original research order, including edit mode. */
export function ResearchOrderActions({ order, financial }: { order: ResearchRecord; financial: boolean }) {
  const { toast } = useToast();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<"print" | "download" | "share" | null>(null);
  const [shareText, setShareText] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const shareUrl = whatsappLink(phone, shareText || "");

  async function run(action: "print" | "download" | "share") {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    try {
      const account = financial ? await researchFetch<ResearchRecord>(`/orders/${order.id}/financials`) : undefined;
      if (action === "share") {
        setPhone(order.customerPhone || "");
        setShareText(researchOrderShareText(order, account, window.location.origin));
      } else {
        const html = researchOrderSheetHtml(order, account);
        if (action === "print") printStandaloneDocument(html, 1122);
        else await downloadReportPdf(html, `${order.researchNo}.pdf`, "landscape");
      }
    } catch (error) {
      toast({ title: action === "share" ? "تعذرت مشاركة الطلب" : "تعذرت طباعة الطلب", description: apiErrorMessage(error), variant: "destructive" });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  return <>
    <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("print")}>
      {busy === "print" ? <Loader2 className="animate-spin" /> : <Printer data-icon="inline-start" />}طباعة A4
    </Button>
    <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("download")}>
      {busy === "download" ? <Loader2 className="animate-spin" /> : <FileDown data-icon="inline-start" />}PDF
    </Button>
    <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("share")}>
      {busy === "share" ? <Loader2 className="animate-spin" /> : <Send data-icon="inline-start" />}إرسال إلى واتساب
    </Button>
    <Dialog open={shareText !== null} onOpenChange={open => !open && setShareText(null)}>
      <DialogContent dir="rtl" className="research-dialog">
        <DialogHeader>
          <DialogTitle>مراجعة إرسال طلب البحث</DialogTitle>
          <DialogDescription>راجع الرقم والتفاصيل؛ الإرسال يتم يدوياً من واتساب. يمكنك إرفاق نسخة PDF بعد تنزيلها.</DialogDescription>
        </DialogHeader>
        <label htmlFor={`research-whatsapp-phone-${order.id}`} className="text-sm font-medium">رقم واتساب</label>
        <Input id={`research-whatsapp-phone-${order.id}`} type="tel" dir="ltr" value={phone} onChange={event => setPhone(event.target.value)} />
        {!shareUrl && <p role="status" className="text-sm text-destructive">أدخل رقم واتساب صحيحاً للمتابعة.</p>}
        <Textarea aria-label="تفاصيل طلب البحث لواتساب" rows={9} value={shareText || ""} onChange={event => setShareText(event.target.value)} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setShareText(null)}>إلغاء</Button>
          {shareUrl ? <Button asChild><a href={shareUrl} target="_blank" rel="noopener noreferrer">فتح واتساب للإرسال</a></Button> : <Button type="button" disabled>فتح واتساب للإرسال</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
