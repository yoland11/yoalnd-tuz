import React, { useRef } from "react";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function GraduationReferenceImagePicker({
  id,
  fileName,
  busy,
  disabled,
  onSelect,
}: {
  id: string;
  fileName: string;
  busy: boolean;
  disabled: boolean;
  onSelect: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <Label htmlFor={id}>صورة مرجعية (اختياري)</Label>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={busy || disabled}
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onSelect(file);
          event.target.value = "";
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={busy || disabled}
          aria-describedby={`${id}-status`}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus aria-hidden="true" />
          {fileName ? "تغيير الصورة" : "اختيار صورة"}
        </Button>
        <span id={`${id}-status`} role="status" aria-live="polite" className="min-w-0 break-all text-sm text-muted-foreground">
          {busy ? "جاري تجهيز الصورة…" : fileName || "لم تُختر صورة"}
        </span>
      </div>
    </div>
  );
}
