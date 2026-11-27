import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { queryClient } from "@/lib/query-client";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import { LiveScanner } from "@/views/staff/live-scanner";
import { AlbumPanel } from "./album-panel";
import { ErrorBlock, albumKeys, type AlbumDetail } from "./shared";

/**
 * The existing AJN camera scanner (with manual entry). A code resolves to the
 * album on the server; the QR only carries an opaque token, and what the panel
 * shows (money included) follows the viewer's permissions.
 */
export function AlbumScanDialog({ open, onOpenChange, initialCode }: { open: boolean; onOpenChange: (open: boolean) => void; initialCode?: string | null }) {
  const [result, setResult] = useState<AlbumDetail | null>(null);
  const lookup = useMutation({
    mutationFn: (code: string) => adminFetch<AlbumDetail>(`/admin/albums/scan?code=${encodeURIComponent(code)}`),
    onSuccess: (detail) => {
      queryClient.setQueryData(albumKeys.detail(detail.album.id), detail);
      setResult(detail);
    },
  });
  // A QR opened from the phone camera lands here with ?scan=<token>.
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !initialCode || started.current === initialCode) return;
    started.current = initialCode;
    lookup.mutate(initialCode);
  }, [open, initialCode]);
  const reset = () => { setResult(null); lookup.reset(); };
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent dir="rtl" className="max-h-[94dvh] max-w-lg overflow-y-auto">
        <DialogHeader className="text-right">
          <DialogTitle>مسح ألبوم</DialogTitle>
          <DialogDescription>وجّه الكاميرا إلى QR أو باركود الألبوم، أو اكتب رقمه.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            <AlbumPanel id={result.album.id} initial={result} compact />
            <Button type="button" variant="outline" className="w-full" onClick={reset}><RotateCcw className="h-4 w-4" />مسح ألبوم آخر</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <LiveScanner active={open && !lookup.isPending} stopOnDetect onDetect={(code) => lookup.mutate(code)} />
            {lookup.isPending ? <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />جارٍ البحث…</p> : null}
            {lookup.isError ? <ErrorBlock message={apiErrorMessage(lookup.error, "لم يُعثر على الألبوم")} onRetry={reset} /> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
