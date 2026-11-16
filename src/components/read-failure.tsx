import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** A failed read is never an empty queue or a verified zero balance. */
export function ReadFailure({ title, error, onRetry, busy = false }: {
  title: string; error: unknown; onRetry: () => void; busy?: boolean;
}) {
  const message = error instanceof Error ? error.message.replace(/^HTTP\s+\d+:\s*/i, "") : "تعذر الاتصال بالخادم. حاول مرة أخرى.";
  const requestId = (error as { requestId?: string } | null)?.requestId;
  return <Alert variant="destructive" dir="rtl">
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription className="flex flex-col items-start gap-3">
      <p className="break-words">{message}</p>
      {requestId ? <p className="text-xs">مرجع الخطأ: <bdi>{requestId}</bdi></p> : null}
      <Button type="button" variant="outline" disabled={busy} onClick={onRetry}>{busy ? "جارٍ إعادة المحاولة…" : "إعادة المحاولة"}</Button>
    </AlertDescription>
  </Alert>;
}
