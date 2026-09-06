import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  CheckCircle2,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  Pencil,
  TriangleAlert,
  Archive,
} from "lucide-react";
import type {
  KoshaManagerDetail,
  KoshaManagerInstruction,
  KoshaManagerMedia,
} from "@/lib/kosha-manager-contract";
import { sourceQuery, executionLabels, bookingIdentity } from "@/lib/kosha-manager";
import {
  archiveManagerInstruction,
  createManagerInstruction,
  managerInstructionReadsQuery,
  managerInstructionsQuery,
  markManagerExecutionViewed,
  updateManagerInstructionCaption,
} from "@/lib/kosha-manager-instructions-client";
import {
  imageUploadFolder,
  uploadImageWithVariants,
  uploadProgressLabel,
  type ImageUploadProgress,
} from "@/lib/large-image-upload";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { BookingStatusBadge } from "./booking-presentation";
import { RtlImageViewer, type RtlViewerImage } from "./rtl-image-viewer";

type UploadRow = {
  id: string;
  name: string;
  status: "uploading" | "saved" | "failed";
  progress: ImageUploadProgress | null;
  error: string | null;
};

const buttonBase =
  "min-h-11 rounded-xl border-[#ead9df] text-[#1f3047] hover:bg-[#fbf1f3]";

function displayDateTime(value?: string | null) {
  if (!value) return "وقت غير محدد";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ar-IQ");
}

function latestMediaSnapshot(media: KoshaManagerMedia[]) {
  return media
    .map((item) => item.createdAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function toViewerImage(item: KoshaManagerMedia): RtlViewerImage {
  return {
    id: item.id,
    url: item.url,
    caption: item.stage ? executionLabels[item.stage] || item.stage : null,
    uploader: item.staffName,
    timestamp: item.createdAt,
  };
}

function instructionImage(item: KoshaManagerInstruction): RtlViewerImage {
  return {
    id: item.id,
    url: item.mediaUrl || "",
    caption: item.caption,
    uploader: item.uploadedByName,
    timestamp: item.updatedAt || item.createdAt,
  };
}

function StaffReceipts({
  detail,
  latestInstructionAt,
}: {
  detail: KoshaManagerDetail;
  latestInstructionAt: string | null;
}) {
  const receipts = useQuery({
    ...managerInstructionReadsQuery(detail.booking),
    enabled: detail.assignedStaff.length > 0,
  });

  if (!detail.assignedStaff.length) {
    return <p className="text-xs text-slate-500">لم يعيّن فريق لهذا الحجز بعد.</p>;
  }
  if (receipts.isPending) {
    return <p className="text-xs text-slate-500">جارٍ تحميل قراءات الفريق...</p>;
  }
  if (receipts.isError) {
    return (
      <p role="alert" className="text-xs text-rose-700">
        {apiErrorMessage(receipts.error, "تعذر تحميل قراءات الفريق")}
      </p>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {receipts.data.staff.map((staff) => {
        const status = !latestInstructionAt
          ? "لا توجد تعليمات حديثة"
          : staff.hasViewedLatest
            ? `شوهد ${displayDateTime(staff.viewedAt)}`
            : staff.viewedAt
              ? "يوجد تحديث أحدث غير مقروء"
              : "لم يشاهد بعد";
        return (
          <div
            key={staff.id}
            className="flex min-h-11 items-center rounded-xl bg-white px-3 py-2 text-xs text-slate-600"
          >
            <span className={staff.hasViewedLatest ? "font-medium text-emerald-700" : "font-medium text-[#8f4052]"}>
              {staff.name} · {status}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function InstructionCard({
  instruction,
  onEdit,
  onArchive,
  busy,
}: {
  instruction: KoshaManagerInstruction;
  onEdit: (instruction: KoshaManagerInstruction) => void;
  onArchive: (instruction: KoshaManagerInstruction) => void;
  busy: boolean;
}) {
  return (
    <article className="rounded-2xl border border-[#efd8dd] bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[#8f4052]">
            {instruction.kind === "image" ? "صورة مرجعية" : "ملاحظة مدير"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {instruction.uploadedByName || "الإدارة"} · {displayDateTime(instruction.updatedAt || instruction.createdAt)}
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-11 w-11 rounded-xl"
            onClick={() => onEdit(instruction)}
            aria-label="تعديل الملاحظة أو التسمية"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-11 w-11 rounded-xl text-[#8f4052]"
            onClick={() => onArchive(instruction)}
            disabled={busy}
            aria-label="أرشفة التعليمات"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </div>
      </div>
      {instruction.kind === "note" ? (
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
          {instruction.caption}
        </p>
      ) : (
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
          {instruction.caption || "صورة مرجعية بلا تسمية."}
        </p>
      )}
    </article>
  );
}

function ManagerInstructions({ detail }: { detail: KoshaManagerDetail }) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<"closed" | "note" | "image">("closed");
  const [caption, setCaption] = useState("");
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [editing, setEditing] = useState<KoshaManagerInstruction | null>(null);
  const [editCaption, setEditCaption] = useState("");
  const [archiveId, setArchiveId] = useState<number | null>(null);

  const instructions = useQuery(managerInstructionsQuery(detail.booking));
  const invalidateInstructions = () => {
    void client.invalidateQueries({ queryKey: ["admin", "kosha-manager", "instructions", bookingIdentity(detail.booking)] });
    void client.invalidateQueries({ queryKey: ["admin", "kosha-manager", "instruction-reads", bookingIdentity(detail.booking)] });
    void client.invalidateQueries({ queryKey: ["admin", "kosha-manager"] });
  };

  const noteMutation = useMutation({
    mutationFn: () => createManagerInstruction(detail.booking, { kind: "note", caption }),
    onSuccess: () => {
      setCaption("");
      setMode("closed");
      invalidateInstructions();
    },
  });
  const editMutation = useMutation({
    mutationFn: () => updateManagerInstructionCaption(detail.booking, editing!.id, editCaption),
    onSuccess: () => {
      setEditing(null);
      setEditCaption("");
      invalidateInstructions();
    },
  });
  const archiveMutation = useMutation({
    mutationFn: (instruction: KoshaManagerInstruction) => archiveManagerInstruction(detail.booking, instruction.id),
    onMutate: (instruction) => setArchiveId(instruction.id),
    onSettled: () => setArchiveId(null),
    onSuccess: invalidateInstructions,
  });

  const startEdit = (instruction: KoshaManagerInstruction) => {
    setEditing(instruction);
    setEditCaption(instruction.caption || "");
    editMutation.reset();
  };

  const uploadFiles = async (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    const rows = selected.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      status: "uploading" as const,
      progress: null,
      error: null,
    }));
    setUploads((current) => [...rows, ...current.filter((row) => row.status === "failed")]);
    await Promise.all(
      selected.map(async (file, index) => {
        const rowId = rows[index].id;
        try {
          const uploaded = await uploadImageWithVariants(file, {
            folder: imageUploadFolder("kosha-manager-instruction"),
            onProgress: (progress) =>
              setUploads((current) =>
                current.map((row) => (row.id === rowId ? { ...row, progress } : row)),
              ),
          });
          await createManagerInstruction(detail.booking, {
            kind: "image",
            mediaUrl: uploaded.originalUrl,
            caption: caption.trim() || null,
          });
          setUploads((current) =>
            current.map((row) => (row.id === rowId ? { ...row, status: "saved", progress: null } : row)),
          );
        } catch (error) {
          setUploads((current) =>
            current.map((row) =>
              row.id === rowId
                ? { ...row, status: "failed", progress: null, error: apiErrorMessage(error, "تعذر رفع هذه الصورة") }
                : row,
            ),
          );
        }
      }),
    );
    setCaption("");
    setMode("closed");
    if (fileInput.current) fileInput.current.value = "";
    invalidateInstructions();
  };

  const imageInstructions = (instructions.data?.instructions ?? []).filter(
    (item) => item.kind === "image" && item.mediaUrl,
  );
  const noteInstructions = (instructions.data?.instructions ?? []).filter((item) => item.kind === "note");

  return (
    <section className="space-y-4 rounded-[22px] border border-[#ead1d8] bg-[#fff6f7] p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-semibold text-[#1f3047]">تعليمات المدير</h4>
          <p className="mt-1 text-xs text-slate-600">
            الأرشفة تحفظ تاريخ التعليمات والتعديلات؛ لا يوجد حذف نهائي من هذه الواجهة.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className={buttonBase}
            onClick={() => {
              setMode((current) => (current === "image" ? "closed" : "image"));
              noteMutation.reset();
            }}
          >
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            إضافة صورة
          </Button>
          <Button
            type="button"
            variant="outline"
            className={buttonBase}
            onClick={() => {
              setMode((current) => (current === "note" ? "closed" : "note"));
              noteMutation.reset();
            }}
          >
            <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
            إضافة ملاحظة
          </Button>
        </div>
      </div>

      {mode !== "closed" ? (
        <div className="space-y-3 rounded-2xl border border-[#efd8dd] bg-white p-3">
          <label className="block text-sm font-medium text-slate-800" htmlFor="manager-instruction-caption">
            {mode === "note" ? "نص الملاحظة" : "تسمية أو ملاحظة مشتركة للصور"}
          </label>
          <Textarea
            id="manager-instruction-caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            maxLength={4000}
            className="min-h-24"
          />
          {mode === "note" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={noteMutation.isPending || !caption.trim()}
                onClick={() => noteMutation.mutate()}
              >
                {noteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                حفظ الملاحظة
              </Button>
              <Button type="button" variant="ghost" onClick={() => setMode("closed")}>
                إلغاء
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(event) => void uploadFiles(event.currentTarget.files)}
                aria-label="اختيار صور تعليمات المدير"
              />
              <Button type="button" onClick={() => fileInput.current?.click()}>
                اختيار الصور
              </Button>
              <Button type="button" variant="ghost" onClick={() => setMode("closed")}>
                إلغاء
              </Button>
            </div>
          )}
          {noteMutation.isError ? (
            <p role="alert" className="text-sm text-rose-700">
              {apiErrorMessage(noteMutation.error, "تعذر حفظ الملاحظة")}
            </p>
          ) : null}
        </div>
      ) : null}

      {uploads.length ? (
        <div className="space-y-2" role="status" aria-live="polite">
          {uploads.map((row) => (
            <div key={row.id} className="rounded-xl bg-white p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{row.name}</span>
                <span className={row.status === "failed" ? "text-rose-700" : "text-slate-500"}>
                  {row.status === "uploading" ? "جارٍ الرفع" : row.status === "saved" ? "تم الحفظ" : "فشل جزئي"}
                </span>
              </div>
              {row.progress ? (
                <>
                  <Progress value={row.progress.percent} className="mt-2 bg-[#f5dfe5]" aria-label={`تقدم رفع ${row.name}`} />
                  <p className="mt-1 text-slate-500">{uploadProgressLabel(row.progress)}</p>
                </>
              ) : null}
              {row.error ? <p className="mt-2 text-rose-700">{row.error}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {instructions.isPending ? (
        <p className="text-sm text-slate-500">جارٍ تحميل تعليمات المدير...</p>
      ) : instructions.isError ? (
        <p role="alert" className="rounded-xl bg-white p-3 text-sm text-rose-700">
          {apiErrorMessage(instructions.error, "تعذر تحميل تعليمات المدير")}
        </p>
      ) : (
        <div className="space-y-4">
          <RtlImageViewer
            title="تعليمات المدير"
            emptyText="لا توجد صور مرجعية من المدير."
            images={imageInstructions.map(instructionImage)}
          />
          <div className="grid gap-3">
            {noteInstructions.length ? (
              noteInstructions.map((instruction) => (
                <InstructionCard
                  key={instruction.id}
                  instruction={instruction}
                  onEdit={startEdit}
                  onArchive={(item) => archiveMutation.mutate(item)}
                  busy={archiveId === instruction.id}
                />
              ))
            ) : (
              <p className="text-sm text-slate-500">لا توجد ملاحظات مدير محفوظة.</p>
            )}
            {imageInstructions.map((instruction) => (
              <InstructionCard
                key={`image-card-${instruction.id}`}
                instruction={instruction}
                onEdit={startEdit}
                onArchive={(item) => archiveMutation.mutate(item)}
                busy={archiveId === instruction.id}
              />
            ))}
          </div>
        </div>
      )}

      {archiveMutation.isError ? (
        <p role="alert" className="text-sm text-rose-700">
          {apiErrorMessage(archiveMutation.error, "تعذر أرشفة التعليمات")}
        </p>
      ) : null}

      {editing ? (
        <div className="space-y-3 rounded-2xl border border-[#d9c39e] bg-white p-3">
          <label className="block text-sm font-medium text-slate-800" htmlFor="manager-instruction-edit">
            تعديل الملاحظة أو تسمية الصورة
          </label>
          <Textarea
            id="manager-instruction-edit"
            value={editCaption}
            onChange={(event) => setEditCaption(event.target.value)}
            maxLength={4000}
            className="min-h-24"
          />
          {editMutation.isError ? (
            <p role="alert" className="text-sm text-rose-700">
              {apiErrorMessage(editMutation.error, "تعذر حفظ التعديل")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={editMutation.isPending || (editing.kind === "note" && !editCaption.trim())}
              onClick={() => editMutation.mutate()}
            >
              {editMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              حفظ التعديل
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              إلغاء
            </Button>
          </div>
        </div>
      ) : null}

      <StaffReceipts detail={detail} latestInstructionAt={instructions.data?.latestAt ?? null} />
    </section>
  );
}

function ExecutionPhotos({ title, images }: { title: string; images: RtlViewerImage[] }) {
  return (
    <section className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <Camera size={16} aria-hidden="true" />
        {title}
        <span className="font-normal text-slate-500">({images.length})</span>
      </h4>
      <RtlImageViewer title={title} emptyText="لا توجد صور مرفوعة." images={images} accent="ivory" />
    </section>
  );
}

export function StaffExecutionPanel({ detail }: { detail: KoshaManagerDetail }) {
  const client = useQueryClient();
  const acknowledgedBooking = useRef<string | null>(null);
  const [resolving, setResolving] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const mutation = useMutation({
    mutationFn: (id: number) =>
      adminFetch(
        `/admin/kosha-bookings/${detail.booking.id}/manager-view/problems/${id}/resolve?${sourceQuery(detail.booking)}`,
        { method: "POST", body: JSON.stringify({ note }) },
      ),
    onSuccess: () => {
      setResolving(null);
      setNote("");
      void client.invalidateQueries({ queryKey: ["admin", "kosha-manager"] });
    },
  });

  const damageMedia = detail.media.filter((m) =>
    ["breakage", "loss", "damage", "problem"].includes(m.purpose),
  );
  const executionMedia = detail.media.filter(
    (m) =>
      m.kind === "image" &&
      !["breakage", "loss", "damage", "problem", "signature", "reference"].includes(m.purpose),
  );
  const employeeNotes = detail.timeline.filter((event) => event.note?.trim());
  const renderedExecutionSnapshot = useMemo(() => latestMediaSnapshot(executionMedia), [executionMedia]);
  const bookingKey = bookingIdentity(detail.booking);

  useEffect(() => {
    if (!detail.permissions.execution || !renderedExecutionSnapshot) return;
    if (acknowledgedBooking.current === bookingKey) return;
    acknowledgedBooking.current = bookingKey;
    void markManagerExecutionViewed(detail.booking, renderedExecutionSnapshot)
      .catch((error) => {
        acknowledgedBooking.current = null;
        console.warn("[KOSHA_MANAGER_EXECUTION_VIEW_ACK_FAILED]", {
          bookingKey,
          message: error instanceof Error ? error.message : "unknown",
        });
      });
  }, [bookingKey, detail.booking, detail.permissions.execution, renderedExecutionSnapshot]);

  if (!detail.permissions.execution)
    return <p className="text-sm text-slate-500">عرض تنفيذ الكادر يتطلب صلاحية التنفيذ.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">تنفيذ الكادر</h3>
        <BookingStatusBadge status={detail.booking.executionStage || "booked"} execution />
      </div>
      <div className="rounded-xl bg-[#faf8f5] p-3 text-sm">
        <span className="text-slate-500">الفريق: </span>
        {[...new Set(detail.assignedStaff.map((s) => s.name))].join("، ") || "لم يُعيّن فريق بعد"}
        {detail.workOrder && (
          <p className="mt-2 text-xs text-slate-500">
            أمر العمل {detail.workOrder.number} · {detail.workOrder.leaderName || "لم يحدد مسؤول الفريق"}
          </p>
        )}
      </div>

      <ManagerInstructions detail={detail} />

      <ExecutionPhotos title="صور تنفيذ الكادر" images={executionMedia.map(toViewerImage)} />

      <section className="space-y-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquarePlus size={16} aria-hidden="true" />
          ملاحظات الموظفين
          <span className="font-normal text-slate-500">({employeeNotes.length})</span>
        </h4>
        {!employeeNotes.length ? (
          <p className="text-sm text-slate-500">لا توجد ملاحظات موظفين محفوظة.</p>
        ) : (
          <div className="grid gap-3">
            {employeeNotes.map((event) => (
              <article key={event.id} className="rounded-xl border border-[#eee4d4] bg-white p-3">
                <p className="text-sm font-medium">{event.title}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">
                  {event.note}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {event.staffName || "الكادر"} · {displayDateTime(event.createdAt)}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <ExecutionPhotos
        title="صور الأضرار والمشكلات"
        images={[
          ...damageMedia.filter((m) => m.kind === "image").map(toViewerImage),
          ...detail.damages.flatMap((d) =>
            d.photoUrl
              ? [
                  {
                    id: `damage-${d.id}`,
                    url: d.photoUrl,
                    caption: d.description,
                    uploader: d.staffName,
                    timestamp: d.createdAt,
                  },
                ]
              : [],
          ),
        ]}
      />
      {detail.media
        .filter((m) => m.kind === "video")
        .map((m) => (
          <video
            key={m.id}
            src={m.url}
            controls
            preload="none"
            className="w-full rounded-xl"
            aria-label="فيديو تنفيذ الكادر"
          />
        ))}
      <section className="space-y-3">
        <h4 className="font-semibold">المشكلات وتقارير الأضرار</h4>
        {!detail.damages.length && <p className="text-sm text-slate-500">لا توجد مشكلات مسجلة.</p>}
        {detail.damages.map((d) => (
          <article key={d.id} className="space-y-2 rounded-xl border border-amber-100 p-4">
            <div className="flex items-start gap-2">
              {d.status === "resolved" ? (
                <CheckCircle2 size={18} className="shrink-0 text-emerald-700" />
              ) : (
                <TriangleAlert size={18} className="shrink-0 text-amber-700" />
              )}
              <p className="whitespace-pre-wrap break-words text-sm">{d.description}</p>
            </div>
            <p className="text-xs text-slate-500">
              {d.staffName || "الكادر"} ·{" "}
              {d.status === "resolved"
                ? "تمت المعالجة — التقرير محفوظ"
                : d.status === "closed"
                  ? "مغلقة"
                  : "مشكلة مسجلة"}
            </p>
            {d.canResolve && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setResolving(d.id);
                  setNote("");
                  mutation.reset();
                }}
              >
                تسجيل المعالجة
              </Button>
            )}
            {resolving === d.id && (
              <div className="space-y-2">
                <label className="block text-sm">
                  تفاصيل المعالجة
                  <textarea
                    className="mt-2 min-h-20 w-full rounded-lg border p-2"
                    value={note}
                    maxLength={2000}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <p className="text-xs text-slate-500">
                  يحفظ التقرير وسجل المعالجة؛ لا يغيّر المخزون أو المبالغ المالية.
                </p>
                {mutation.isError && (
                  <p role="alert" className="text-sm text-red-700">
                    {mutation.error.message}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!note.trim() || mutation.isPending}
                    onClick={() => mutation.mutate(d.id)}
                  >
                    {mutation.isPending ? "جارٍ الحفظ..." : "حفظ المعالجة"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setResolving(null)}>
                    إلغاء
                  </Button>
                </div>
              </div>
            )}
          </article>
        ))}
      </section>
      <section>
        <h4 className="mb-4 font-semibold">سجل التنفيذ</h4>
        {!detail.timeline.length && <p className="text-sm text-slate-500">لا توجد تحديثات تنفيذ مسجلة.</p>}
        <ol className="space-y-4 border-s border-[#e9decc] ps-4">
          {detail.timeline.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -start-[21px] top-1.5 h-2 w-2 rounded-full bg-[#ad8c58]" />
              <p className="text-sm font-medium">{e.title}</p>
              {e.note && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{e.note}</p>}
              <p className="mt-1 text-xs text-slate-500">
                {e.staffName || "الكادر"}
                {e.createdAt && ` · ${new Date(e.createdAt).toLocaleString("ar-IQ")}`}
              </p>
              {e.fromStage && e.toStage && (
                <p className="text-xs text-slate-500">
                  {executionLabels[e.fromStage] || e.fromStage} ← {executionLabels[e.toStage] || e.toStage}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
