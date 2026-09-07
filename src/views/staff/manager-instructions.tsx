import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, MessageSquareText, RotateCcw } from "lucide-react";
import { RtlImageViewer, type RtlViewerImage } from "@/components/kosha-bookings/rtl-image-viewer";
import { apiErrorMessage } from "@/views/admin/_lib";
import {
  staffApi,
  type StaffManagerInstruction,
  type StaffManagerInstructionList,
} from "./lib";

type AcknowledgementState = {
  snapshot: string | null;
  status: "idle" | "pending" | "success" | "error";
  message: string | null;
};

function displayDateTime(value: string | null | undefined) {
  if (!value) return "وقت غير محدد";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "medium", timeStyle: "short" });
}

function instructionTime(instruction: StaffManagerInstruction) {
  return instruction.updatedAt || instruction.createdAt;
}

function instructionImages(instructions: StaffManagerInstruction[]): RtlViewerImage[] {
  return instructions.flatMap((instruction) =>
    instruction.kind === "image" && instruction.mediaUrl
      ? [{
          id: instruction.id,
          url: instruction.mediaUrl,
          caption: instruction.caption,
          uploader: instruction.uploadedByName || "الإدارة",
          timestamp: instructionTime(instruction),
        }]
      : [],
  );
}

export function StaffManagerInstructions({
  bookingId,
  source,
  initialUnreadCount,
}: {
  bookingId: number;
  source: "kosha" | "service";
  initialUnreadCount: number;
}) {
  const [instructions, setInstructions] = useState<StaffManagerInstructionList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acknowledgement, setAcknowledgement] = useState<AcknowledgementState>({
    snapshot: null,
    status: "idle",
    message: null,
  });
  const attemptedSnapshots = useRef(new Set<string>());
  const initialLoadStarted = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setInstructions(await staffApi.instructions(bookingId, source));
    } catch (error) {
      setInstructions(null);
      setLoadError(apiErrorMessage(error, "تعذر تحميل تعليمات الإدارة"));
    } finally {
      setLoading(false);
    }
  }, [bookingId, source]);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void load();
  }, [load]);

  const markViewed = useCallback((snapshot: string) => {
    setAcknowledgement({ snapshot, status: "pending", message: null });
    void staffApi.markInstructionsViewed(bookingId, snapshot, source)
      .then(() => {
        setAcknowledgement({
          snapshot,
          status: "success",
          message: "تم تسجيل قراءة التعليمات",
        });
      })
      .catch((error) => {
        setAcknowledgement({
          snapshot,
          status: "error",
          message: `تعذر تسجيل قراءة التعليمات: ${apiErrorMessage(error, "حاول مرة أخرى")}`,
        });
      });
  }, [bookingId, source]);

  useEffect(() => {
    const snapshot = instructions?.latestAt;
    if (!snapshot || !instructions.unreadCount || attemptedSnapshots.current.has(snapshot)) return;
    // Effects run only after React commits the successfully loaded instruction section.
    // Capture the rendered snapshot before the request so a later update stays unread.
    attemptedSnapshots.current.add(snapshot);
    markViewed(snapshot);
  }, [instructions, markViewed]);

  const notes = useMemo(
    () => (instructions?.instructions ?? []).filter((instruction) => instruction.kind === "note"),
    [instructions],
  );
  const images = useMemo(
    () => instructionImages(instructions?.instructions ?? []),
    [instructions],
  );
  const renderedUnreadCount = instructions?.unreadCount ?? Math.max(0, initialUnreadCount);
  const unreadCount = acknowledgement.status === "success" && acknowledgement.snapshot === instructions?.latestAt
    ? 0
    : renderedUnreadCount;

  return (
    <section
      className="min-w-0 space-y-4 overflow-hidden rounded-xl border-2 border-primary/40 bg-primary/[0.04] p-3 shadow-sm"
      aria-labelledby="staff-manager-instructions-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="staff-manager-instructions-heading" className="flex items-center gap-2 text-base font-extrabold">
            <MessageSquareText className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            تعليمات من الإدارة
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">راجع الملاحظات والصور المرجعية قبل بدء التنفيذ.</p>
        </div>
        {unreadCount > 0 ? (
          <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">
            تعليمات الإدارة • {unreadCount} جديد
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="flex min-h-20 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          جارٍ تحميل تعليمات الإدارة…
        </div>
      ) : loadError ? (
        <div className="space-y-3 rounded-lg border border-destructive/30 bg-background p-3">
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>تعذر تحميل تعليمات الإدارة: {loadError}</span>
          </p>
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-bold text-primary"
            onClick={() => void load()}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            إعادة تحميل التعليمات
          </button>
        </div>
      ) : instructions ? (
        <div className="min-w-0 space-y-4">
          <div className="min-w-0 overflow-x-auto pb-1">
            <RtlImageViewer
              title="تعليمات الإدارة"
              emptyText="لا توجد صور مرجعية من الإدارة."
              images={images}
              accent="ivory"
            />
          </div>
          <div className="grid min-w-0 gap-3">
            {notes.length ? notes.map((instruction) => (
              <article key={instruction.id} className="min-w-0 rounded-xl border border-border bg-card p-3">
                <p className="whitespace-pre-wrap break-words text-sm leading-7">{instruction.caption}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {instruction.uploadedByName || "الإدارة"} · {displayDateTime(instructionTime(instruction))}
                </p>
              </article>
            )) : (
              <p className="text-sm text-muted-foreground">لا توجد ملاحظات مكتوبة من الإدارة.</p>
            )}
          </div>
        </div>
      ) : null}

      {acknowledgement.status === "error" ? (
        <div className="space-y-3 rounded-lg border border-destructive/30 bg-background p-3">
          <p role="alert" className="text-sm text-destructive">{acknowledgement.message}</p>
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-bold text-primary"
            onClick={() => acknowledgement.snapshot && markViewed(acknowledgement.snapshot)}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            إعادة تسجيل القراءة
          </button>
        </div>
      ) : acknowledgement.status === "success" ? (
        <p role="status" className="rounded-lg bg-status-success/10 px-3 py-2 text-sm text-status-success">
          {acknowledgement.message}
        </p>
      ) : null}
    </section>
  );
}
