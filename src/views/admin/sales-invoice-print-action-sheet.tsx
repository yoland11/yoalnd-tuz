import { FileDown, Printer, PrinterCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

export type SalesInvoicePrintAction =
  | "save_pdf"
  | "local_print"
  | "direct_print"
  | "save_pdf_and_direct_print";

type Props = {
  open: boolean;
  pending?: boolean;
  hasConfiguredPrinter: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (action: SalesInvoicePrintAction) => void;
};

function ActionRow({
  icon: Icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: typeof FileDown;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={onClick}
      className="h-auto min-h-14 w-full justify-start gap-3 px-4 py-3 text-right whitespace-normal"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs font-normal leading-5 text-muted-foreground">{description}</span>
      </span>
    </Button>
  );
}

/** Mobile-only save/print choices. Desktop retains its compact options dialog. */
export function SalesInvoicePrintActionSheet({
  open,
  pending = false,
  hasConfiguredPrinter,
  onOpenChange,
  onSelect,
}: Props) {
  const choose = (action: SalesInvoicePrintAction) => {
    onOpenChange(false);
    onSelect(action);
  };

  return (
    <Drawer open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DrawerContent dir="rtl" className="max-h-[92dvh] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <DrawerHeader className="text-right">
          <DrawerTitle>حفظ وطباعة الفاتورة</DrawerTitle>
          <DrawerDescription>اختر الطريقة المناسبة. تُحفظ الفاتورة أولاً ثم يُنفّذ الإجراء المختار.</DrawerDescription>
        </DrawerHeader>
        <div className="space-y-2 overflow-y-auto px-4 pb-2">
          <ActionRow
            icon={FileDown}
            title="حفظ PDF"
            description="تنزيل نسخة حرارية 80mm بصيغة PDF على هذا الجهاز."
            disabled={pending}
            onClick={() => choose("save_pdf")}
          />
          <ActionRow
            icon={Printer}
            title="طباعة من هذا الجهاز"
            description="فتح نافذة الطباعة المحلية لاختيار طابعة الجهاز."
            disabled={pending}
            onClick={() => choose("local_print")}
          />
          <ActionRow
            icon={PrinterCheck}
            title="طباعة مباشرة من طابعة المحل"
            description={hasConfiguredPrinter ? "إرسال آمن إلى طابور AJN وجهاز الطباعة في المحل." : "لا توجد طابعة محل مهيأة حالياً."}
            disabled={pending || !hasConfiguredPrinter}
            onClick={() => choose("direct_print")}
          />
          <ActionRow
            icon={PrinterCheck}
            title="حفظ PDF + طباعة مباشرة"
            description={hasConfiguredPrinter ? "تنزيل PDF وإرسال نفس الفاتورة إلى طابعة المحل." : "يتطلب إعداد طابعة محل أولاً."}
            disabled={pending || !hasConfiguredPrinter}
            onClick={() => choose("save_pdf_and_direct_print")}
          />
        </div>
        <DrawerFooter>
          <Button type="button" variant="outline" className="min-h-12" disabled={pending} onClick={() => onOpenChange(false)}>إلغاء</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
