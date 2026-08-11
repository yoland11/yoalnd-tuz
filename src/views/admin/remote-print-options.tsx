import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch } from "./_lib";

export type RemotePrintPaperSize = "58mm" | "80mm" | "a5" | "a4" | "custom";
export type RemotePrintOrientation = "portrait" | "landscape";
export type RemotePrintMode = "direct" | "queue";

export type RemotePrinter = {
  id: number;
  name: string;
  displayName?: string | null;
  paperSize: "80mm" | "58mm";
  defaultCopies: number;
  isDefault: boolean;
  isActive: boolean;
  agent?: { id: number; name: string; agentId: string } | null;
};

export type RemotePrintOptions = {
  printerId: number;
  paperSize: RemotePrintPaperSize;
  orientation: RemotePrintOrientation;
  copies: number;
  mode: RemotePrintMode;
  customWidthMm?: number;
  customHeightMm?: number;
};

const paperSizes: Array<{ value: RemotePrintPaperSize; label: string }> = [
  { value: "58mm", label: "حراري 58mm" },
  { value: "80mm", label: "حراري 80mm" },
  { value: "a5", label: "A5" },
  { value: "a4", label: "A4" },
  { value: "custom", label: "مقاس مخصص" },
];

export function remotePrintIdempotencyKey(invoiceId: number, mode: RemotePrintMode) {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `sales-print-${mode}-${invoiceId}-${id}`;
}

export async function createRemoteSalesInvoicePrintJob(invoiceId: number, options: RemotePrintOptions) {
  return adminFetch<{ job: { id: number; jobNo: string; status: string }; duplicate: boolean }>("/admin/print-jobs", {
    method: "POST",
    headers: { "idempotency-key": remotePrintIdempotencyKey(invoiceId, options.mode) },
    body: JSON.stringify({
      invoiceId,
      printerId: options.printerId,
      paperSize: options.paperSize,
      orientation: options.orientation,
      copies: options.copies,
      customWidthMm: options.paperSize === "custom" ? options.customWidthMm : undefined,
      customHeightMm: options.paperSize === "custom" ? options.customHeightMm : undefined,
    }),
  });
}

export function defaultRemotePrintOptions(printers: RemotePrinter[]): RemotePrintOptions | null {
  const printer = printers.find((item) => item.isDefault) ?? printers[0];
  if (!printer) return null;
  return {
    printerId: printer.id,
    paperSize: printer.paperSize,
    orientation: "portrait",
    copies: Math.min(Math.max(printer.defaultCopies || 1, 1), 5),
    mode: "direct",
  };
}

export function RemotePrintOptionsDialog({
  open,
  printers,
  initialOptions,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  printers: RemotePrinter[];
  initialOptions: RemotePrintOptions | null;
  pending?: boolean;
  onClose: () => void;
  onSubmit: (options: RemotePrintOptions) => void;
}) {
  const [options, setOptions] = useState<RemotePrintOptions | null>(initialOptions);

  useEffect(() => {
    if (open) setOptions(initialOptions ?? defaultRemotePrintOptions(printers));
  }, [open, initialOptions, printers]);

  if (!open) return null;
  const isCustom = options?.paperSize === "custom";
  const update = <Key extends keyof RemotePrintOptions>(key: Key, value: RemotePrintOptions[Key]) => {
    setOptions((current) => current ? { ...current, [key]: value } : current);
  };

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" dir="rtl" role="presentation" onMouseDown={onClose}>
    <section className="w-full max-w-lg rounded-xl border border-border/40 bg-card p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="remote-print-options-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-3">
        <div><h2 id="remote-print-options-title" className="text-lg font-bold">خيارات الطباعة</h2><p className="mt-1 text-xs text-muted-foreground">تُحفظ الفاتورة أولاً، ثم تُرسل المهمة بأمان إلى جهاز الطباعة في المحل.</p></div>
        <Printer className="mt-1 h-5 w-5 text-primary" aria-hidden="true" />
      </div>

      {!printers.length ? <p className="mt-5 rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-sm text-foreground">لا توجد طابعة Windows مهيأة. أضف جهازاً وطابعة من «طابور الطباعة» أولاً.</p> : <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm"><span>الطابعة</span><select value={options?.printerId ?? ""} onChange={(event) => update("printerId", Number(event.target.value))} className="h-10 rounded-md border border-input bg-background px-3"><option value="">اختر الطابعة</option>{printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.displayName || printer.name} · {printer.paperSize}</option>)}</select></label>
        <label className="grid gap-1 text-sm"><span>حجم الورق</span><select value={options?.paperSize ?? "80mm"} onChange={(event) => update("paperSize", event.target.value as RemotePrintPaperSize)} className="h-10 rounded-md border border-input bg-background px-3">{paperSizes.map((paper) => <option key={paper.value} value={paper.value}>{paper.label}</option>)}</select></label>
        <label className="grid gap-1 text-sm"><span>الاتجاه</span><select value={options?.orientation ?? "portrait"} onChange={(event) => update("orientation", event.target.value as RemotePrintOrientation)} className="h-10 rounded-md border border-input bg-background px-3"><option value="portrait">عمودي</option><option value="landscape">أفقي</option></select></label>
        <label className="grid gap-1 text-sm"><span>عدد النسخ</span><input type="number" min={1} max={5} value={options?.copies ?? 1} onChange={(event) => update("copies", Math.min(5, Math.max(1, Number(event.target.value) || 1)))} className="h-10 rounded-md border border-input bg-background px-3" /></label>
        {isCustom ? <><label className="grid gap-1 text-sm"><span>العرض (mm)</span><input type="number" min={40} max={210} value={options?.customWidthMm ?? 80} onChange={(event) => update("customWidthMm", Number(event.target.value) || 80)} className="h-10 rounded-md border border-input bg-background px-3" /></label><label className="grid gap-1 text-sm"><span>الطول (mm)</span><input type="number" min={40} max={500} value={options?.customHeightMm ?? 297} onChange={(event) => update("customHeightMm", Number(event.target.value) || 297)} className="h-10 rounded-md border border-input bg-background px-3" /></label></> : null}
        <fieldset className="sm:col-span-2"><legend className="mb-2 text-sm">وضع الطباعة</legend><div className="grid grid-cols-2 gap-2"><label className={`cursor-pointer rounded-lg border p-3 text-sm ${options?.mode === "direct" ? "border-primary bg-primary/10" : "border-border/40"}`}><input className="sr-only" type="radio" checked={options?.mode === "direct"} onChange={() => update("mode", "direct")} />طباعة مباشرة<span className="mt-1 block text-xs text-muted-foreground">ترسل الآن إلى وكيل AJN؛ تبقى المهمة بانتظار الطباعة إذا كان غير متصل.</span></label><label className={`cursor-pointer rounded-lg border p-3 text-sm ${options?.mode === "queue" ? "border-primary bg-primary/10" : "border-border/40"}`}><input className="sr-only" type="radio" checked={options?.mode === "queue"} onChange={() => update("mode", "queue")} />إرسال إلى الطابور<span className="mt-1 block text-xs text-muted-foreground">تظهر المهمة في طابور الطباعة ليعالجها الجهاز المخصص.</span></label></div></fieldset>
      </div>}

      <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>إلغاء</Button><Button type="button" disabled={pending || !options?.printerId} onClick={() => options && onSubmit(options)}>{pending ? "جارٍ الحفظ والإرسال..." : options?.mode === "direct" ? "حفظ وطباعة مباشرة" : "حفظ وإرسال للطابور"}</Button></div>
    </section>
  </div>;
}
