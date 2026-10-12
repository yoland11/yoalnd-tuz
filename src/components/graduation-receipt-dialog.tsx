import { useState } from "react";
import { FileText, Printer, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/money";
import { apiErrorMessage } from "@/views/admin/_lib";
import { openReceiptWindow, type ReceiptFormat } from "@/lib/graduation-receipt-print";

const FORMAT_KEY = "ajn-representative-receipt-format";

/** The paper size chosen last on this device (80mm by default). */
export function savedReceiptFormat(): ReceiptFormat {
  try {
    return window.localStorage.getItem(FORMAT_KEY) === "a5" ? "a5" : "80mm";
  } catch {
    return "80mm";
  }
}

export type ReceiptJob = {
  title: string;
  subtitle: string;
  /** Optional: tailor sheets carry no money. */
  amountLabel?: string;
  amount?: number;
  /** Fills the already-open print window. */
  render: (popup: Window, format: ReceiptFormat) => Promise<void>;
};

/** Chooses the paper (80mm thermal or A5) and prints; the last choice is remembered on this device. */
export function ReceiptPrintDialog({ job, onClose }: { job: ReceiptJob | null; onClose: () => void }) {
  const { toast } = useToast();
  const [format, setFormat] = useState<ReceiptFormat>(savedReceiptFormat);
  const print = (chosen: ReceiptFormat) => {
    if (!job) return;
    try {
      window.localStorage.setItem(FORMAT_KEY, chosen);
    } catch {
      /* the remembered paper size is only a convenience */
    }
    setFormat(chosen);
    let popup: Window;
    try {
      popup = openReceiptWindow(chosen);
    } catch (error) {
      toast({ title: "تعذرت طباعة الوصل", description: apiErrorMessage(error), variant: "destructive" });
      return;
    }
    job.render(popup, chosen)
      .then(onClose)
      .catch((error) => {
        popup.close();
        toast({ title: "تعذرت طباعة الوصل", description: apiErrorMessage(error), variant: "destructive" });
      });
  };
  const option = (value: ReceiptFormat, label: string, hint: string, Icon: typeof Receipt) => (
    <Button
      type="button"
      variant="ghost"
      size="flush"
      onClick={() => print(value)}
      className={`h-auto whitespace-normal font-normal leading-normal max-md:min-h-0 [&_svg]:size-7 flex flex-1 flex-col items-center gap-2 rounded-2xl border-2 p-4 text-center transition hover:border-[#7b1e3a] hover:bg-rose-50 dark:hover:bg-slate-800 ${format === value ? "border-[#7b1e3a] bg-rose-50/60 dark:bg-slate-800" : "border-rose-100 dark:border-slate-700"}`}
    >
      <Icon className="h-7 w-7 text-[#7b1e3a]" />
      <span className="font-bold">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </Button>
  );
  return (
    <Dialog open={Boolean(job)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Printer className="h-5 w-5 text-[#7b1e3a]" /> {job?.title}</DialogTitle>
          <DialogDescription>{job?.subtitle}</DialogDescription>
        </DialogHeader>
        {job && job.amount !== undefined ? (
          <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex justify-between"><span className="text-muted-foreground">{job.amountLabel}</span><b className="tabular-nums">{formatCurrency(job.amount)}</b></div>
          </div>
        ) : null}
        <div className="flex gap-3">
          {option("80mm", "حراري 80 مم", "لطابعة الوصولات", Receipt)}
          {option("a5", "ورقة A5", "وصل رسمي ملوّن", FileText)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
