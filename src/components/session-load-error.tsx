import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/views/admin/_lib";

export function SessionLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6" dir="rtl">
      <div role="alert" className="max-w-md space-y-3 text-center">
        <h1 className="text-lg font-semibold">تعذر التحقق من الجلسة</h1>
        <p className="text-sm text-muted-foreground">{apiErrorMessage(error, "تعذر الاتصال بالخادم، حاول مرة أخرى")}</p>
        <Button variant="outline" onClick={onRetry}>إعادة المحاولة</Button>
      </div>
    </div>
  );
}
