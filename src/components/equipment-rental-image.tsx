import { useState } from "react";
import { ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface EquipmentRentalImageProps {
  image: string | null | undefined;
  name: string;
  className?: string;
}

export function EquipmentRentalImage({ image, name, className }: EquipmentRentalImageProps) {
  const [open, setOpen] = useState(false);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const source = image?.trim() || null;
  const failed = source !== null && failedImage === source;
  const frameClassName = cn("size-20 shrink-0 overflow-hidden rounded-lg", className);

  if (!source || failed) {
    return (
      <span
        role="img"
        aria-label={failed ? `تعذر تحميل صورة ${name}` : `لا توجد صورة لـ ${name}`}
        className={cn(frameClassName, "flex flex-col items-center justify-center gap-1 border border-border bg-muted p-1 text-center text-foreground")}
      >
        <ImageOff aria-hidden="true" className="size-5 text-muted-foreground" />
        <span className="text-[10px] leading-tight">{failed ? "الصورة غير متاحة" : "لا توجد صورة"}</span>
      </span>
    );
  }

  const handleImageError = () => {
    setFailedImage(source);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="flush"
          aria-label={`عرض صورة ${name}`}
          className={cn(frameClassName, "p-1")}
        >
          <img
            src={source}
            alt={name}
            loading="lazy"
            decoding="async"
            onError={handleImageError}
            className="size-full object-contain"
          />
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(calc(100%-2rem),56rem)]">
        <DialogHeader>
          <DialogTitle>صورة {name}</DialogTitle>
          <DialogDescription className="sr-only">معاينة الصورة الأصلية للمعدة المؤجرة</DialogDescription>
        </DialogHeader>
        <img
          src={source}
          alt={name}
          decoding="async"
          onError={handleImageError}
          className="max-h-[70dvh] w-full rounded-lg object-contain"
        />
      </DialogContent>
    </Dialog>
  );
}
