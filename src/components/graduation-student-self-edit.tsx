import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageOff, Loader2, Lock, PencilLine, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { GraduationReferenceImagePicker } from "@/components/graduation-reference-image-picker";
import { vocalizeArabicName } from "@/lib/graduation-name";
import { cleanStudentSashName, combineGroupSashName } from "@/lib/graduation-sash-name";
import { STUDENT_EDIT_LOCKED_STAGES, type StudentEditLock } from "@/lib/graduation-student-edit";
import { MEASUREMENTS, MEASUREMENT_HELP, SASH_FONTS, STUDENT_REFERENCE_PLACEMENTS } from "@/lib/graduation-student-flow";
import { processImageFile } from "@/lib/image-tools";

/**
 * «تعديل معلوماتي» on the tracking page: the student confirms the last 4
 * digits of their phone, then edits name, measurements, sash name, colours
 * and photos until production starts.
 */

type Reference = { placement: string; note: string; imageUrl: string };
type Student = {
  customerName: string;
  gender: "male" | "female";
  size: string;
  measurements: Record<string, string | number>;
  sashName: string;
  font: string;
  sashColor: string;
  embroideryColor: string;
  references: Reference[];
};
type EditView = {
  lock: StudentEditLock;
  student: Student;
  options: { sashNamePrefix: string; sashColorEditable: boolean; embroideryColorEditable: boolean };
  designApproved: boolean;
};
type ReferenceDraft = Reference & { image?: string; fileName?: string; removeImage?: boolean };
type Form = Omit<Student, "references" | "measurements"> & { measurements: Record<string, string>; references: ReferenceDraft[] };

class EditRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const sessionKey = (token: string) => `ajn-graduation-edit:${token}`;
function readSession(token: string) {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(sessionKey(token)) || "null");
    return saved && new Date(saved.expiresAt).getTime() > Date.now() + 30_000 ? String(saved.session) : "";
  } catch {
    return "";
  }
}
function storeSession(token: string, value: { session: string; expiresAt: string } | null) {
  try {
    if (value) window.sessionStorage.setItem(sessionKey(token), JSON.stringify(value));
    else window.sessionStorage.removeItem(sessionKey(token));
  } catch {
    // Private mode: the session simply lives for this page view.
  }
}

async function editRequest<T>(token: string, path: string, session: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/graduation/track/${encodeURIComponent(token)}/edit${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(session ? { "x-student-edit-session": session } : {}), ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new EditRequestError(payload?.message || payload?.error || "تعذر إكمال العملية", response.status);
  return payload as T;
}

function toForm(student: Student): Form {
  return {
    ...student,
    measurements: Object.fromEntries(MEASUREMENTS.map(([key]) => [key, String(student.measurements[key] ?? "")])),
    references: student.references.map((reference) => ({ ...reference })),
  };
}

/** Only what changed, in the server's input shape. */
function changesOf(original: Form, form: Form) {
  const body: Record<string, unknown> = {};
  for (const key of ["customerName", "gender", "size", "sashName", "font", "sashColor", "embroideryColor"] as const)
    if (String(form[key]).trim() !== String(original[key]).trim()) body[key] = String(form[key]).trim();
  const measurements = Object.fromEntries(MEASUREMENTS.map(([key]) => [key, form.measurements[key]?.trim() ?? ""])
    .filter(([key, value]) => value !== (original.measurements[key] ?? "")));
  if (Object.keys(measurements).length) body.measurements = measurements;
  const references = form.references.filter((reference) => {
    const before = original.references.find((item) => item.placement === reference.placement);
    return Boolean(reference.image) || Boolean(reference.removeImage) || reference.note.trim() !== (before?.note ?? "").trim();
  }).map((reference) => ({
    placement: reference.placement,
    note: reference.note.trim(),
    ...(reference.image ? { imageData: reference.image, fileName: reference.fileName || "" } : {}),
    ...(reference.removeImage && !reference.image ? { removeImage: true } : {}),
  }));
  if (references.length) body.references = references;
  return body;
}

export function GraduationStudentSelfEdit({ token, productionStage }: { token: string; productionStage?: string }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState("");
  const [digits, setDigits] = useState("");
  const [original, setOriginal] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [imageBusy, setImageBusy] = useState("");
  const [imageError, setImageError] = useState("");
  const startedProduction = (STUDENT_EDIT_LOCKED_STAGES as readonly string[]).includes(String(productionStage ?? ""));

  useEffect(() => { setSession(readSession(token)); }, [token]);

  const view = useQuery({
    queryKey: ["graduation", "track", token, "edit", session],
    queryFn: () => editRequest<EditView>(token, "", session),
    enabled: open && Boolean(session),
    retry: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (view.error instanceof EditRequestError && view.error.status === 401) {
      storeSession(token, null);
      setSession("");
    }
  }, [view.error, token]);
  useEffect(() => {
    if (!view.data) return;
    const next = toForm(view.data.student);
    setOriginal(next);
    setForm(next);
  }, [view.data]);

  const verify = useMutation({
    mutationFn: () => editRequest<{ session: string; expiresAt: string }>(token, "/verify", "", { method: "POST", body: JSON.stringify({ last4: digits }) }),
    onSuccess: (result) => {
      storeSession(token, result);
      setSession(result.session);
      setDigits("");
    },
  });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editRequest<{ changed: boolean; changes: string[]; designApprovalReset: boolean; view: EditView }>(token, "", session, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (result) => {
      if (!result.changed) {
        toast({ title: "لا توجد تغييرات للحفظ" });
        return;
      }
      toast({
        title: "تم حفظ تعديلاتك ووصلت للإدارة",
        description: result.designApprovalReset ? "غيّرت تفاصيل الوشاح بعد اعتماد التصميم؛ راجع التصميم واعتمده من جديد." : result.changes.join("، "),
      });
      const next = toForm(result.view.student);
      setOriginal(next);
      setForm(next);
      void client.invalidateQueries({ queryKey: ["graduation", "track", token] });
      setOpen(false);
    },
    onError: (error) => {
      if (error instanceof EditRequestError && error.status === 401) {
        storeSession(token, null);
        setSession("");
      }
      toast({ title: "تعذر حفظ التعديل", description: error instanceof Error ? error.message : "", variant: "destructive" });
    },
  });

  async function pickImage(placement: string, file: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setImageError("اختر صورة JPG أو PNG أو WEBP");
      return;
    }
    setImageBusy(placement);
    setImageError("");
    try {
      const image = await processImageFile(file, { maxSize: 1600, quality: 0.82, maxBytes: 600_000 });
      if (image.length > 4_000_000) throw new Error("الصورة كبيرة جداً، اختر صورة أصغر");
      setForm((current) => current && ({
        ...current,
        references: current.references.map((item) => item.placement === placement
          ? { ...item, image, fileName: file.name.slice(0, 180), removeImage: false }
          : item),
      }));
    } catch (cause) {
      setImageError(cause instanceof Error ? cause.message : "تعذر تجهيز الصورة");
    } finally {
      setImageBusy("");
    }
  }

  const data = view.data;
  const changes = original && form ? changesOf(original, form) : {};
  const prefix = data?.options.sashNamePrefix ?? "";
  const ownSash = form ? cleanStudentSashName(form.sashName, prefix) : "";
  const setReference = (placement: string, patch: Partial<ReferenceDraft>) =>
    setForm((current) => current && ({ ...current, references: current.references.map((item) => item.placement === placement ? { ...item, ...patch } : item) }));

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 font-bold"><PencilLine className="h-4 w-4 text-primary" />تعديل معلوماتي</h2>
          <p className="text-sm text-muted-foreground">
            {startedProduction
              ? "بدأ تجهيز طلبك، فلا يمكن تعديله من هنا؛ للتعديل تواصل مع ممثل المجموعة."
              : "عدّل اسمك وقياساتك والاسم على الوشاح والألوان والصور، لحد ما يبدي تجهيز طلبك."}
          </p>
        </div>
        {startedProduction ? <Lock className="h-5 w-5 text-muted-foreground" aria-hidden /> : (
          <Button type="button" variant="outline" onClick={() => setOpen(true)}><PencilLine className="ml-1 h-4 w-4" />تعديل</Button>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>تعديل معلوماتي</DialogTitle>
            <DialogDescription>كل تعديل يُسجَّل ويصل لإدارة التجهيز.</DialogDescription>
          </DialogHeader>

          {!session ? (
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (digits.length === 4) verify.mutate(); }}>
              <Label htmlFor="edit-last4" className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />للتأكد إنك صاحب الطلب: اكتب آخر 4 أرقام من رقم هاتفك المسجّل</Label>
              <Input id="edit-last4" dir="ltr" inputMode="numeric" autoComplete="off" maxLength={4} className="max-w-40 text-center text-lg tracking-[0.5em]"
                value={digits} onChange={(event) => setDigits(event.target.value.replace(/\D/g, "").slice(0, 4))} />
              {verify.error ? <p role="alert" className="text-sm text-destructive">{verify.error.message}</p> : null}
              <DialogFooter>
                <Button type="submit" disabled={digits.length !== 4 || verify.isPending}>
                  {verify.isPending ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : null}متابعة
                </Button>
              </DialogFooter>
            </form>
          ) : view.isPending || (data && !form) ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : view.isError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <span>{view.error.message}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void view.refetch()}>إعادة المحاولة</Button>
            </div>
          ) : data && !data.lock.editable ? (
            <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-4 text-sm"><Lock className="mt-0.5 h-4 w-4 shrink-0" />{data.lock.reason}</p>
          ) : data && form ? (
            <div className="space-y-6">
              {data.lock.editable && data.lock.until ? <p className="text-xs text-muted-foreground">آخر موعد للتعديل: <bdi dir="ltr">{data.lock.until}</bdi></p> : null}

              <section className="space-y-2">
                <Label htmlFor="edit-name">الاسم الكامل</Label>
                <Input id="edit-name" maxLength={160} value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} />
              </section>

              <section className="space-y-3">
                <h3 className="font-semibold">القياسات</h3>
                <div className="flex gap-2">
                  {([["male", "رجالي"], ["female", "نسائي"]] as const).map(([key, label]) => (
                    <Button key={key} type="button" variant={form.gender === key ? "default" : "outline"} aria-pressed={form.gender === key} onClick={() => setForm({ ...form, gender: key })}>{label}</Button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {["XS", "S", "M", "L", "XL", "XXL"].map((size) => (
                    <Button key={size} type="button" size="sm" variant={form.size === size ? "default" : "outline"} aria-pressed={form.size === size} onClick={() => setForm({ ...form, size })}>{size}</Button>
                  ))}
                  <Input aria-label="مقاس البدن" className="w-28" maxLength={20} placeholder="أو رقم" value={form.size} onChange={(event) => setForm({ ...form, size: event.target.value })} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {MEASUREMENTS.map(([key, label, min, max]) => (
                    <div key={key}>
                      <Label htmlFor={`edit-${key}`}>{label}</Label>
                      <Input id={`edit-${key}`} className="mt-2" type="number" inputMode="decimal" min={min} max={max}
                        value={form.measurements[key] ?? ""} onChange={(event) => setForm({ ...form, measurements: { ...form.measurements, [key]: event.target.value } })} />
                      <details className="mt-1">
                        <summary className="cursor-pointer list-none text-xs text-primary hover:underline">كيف أقيس؟</summary>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{MEASUREMENT_HELP[key]}</p>
                      </details>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="font-semibold">الوشاح</h3>
                <div>
                  <Label htmlFor="edit-sash">{prefix ? "اسمك على الوشاح (اسمك فقط)" : "الاسم على الوشاح"}</Label>
                  {prefix ? <p className="mt-1 text-xs text-muted-foreground">الكنية «{prefix}» تُضاف تلقائياً قبل اسمك.</p> : null}
                  <Input id="edit-sash" className="mt-2" maxLength={50} value={form.sashName}
                    onChange={(event) => setForm({ ...form, sashName: event.target.value })}
                    onBlur={() => setForm({ ...form, sashName: vocalizeArabicName(form.sashName) || form.sashName })} />
                  {prefix ? <p className="mt-2 text-sm" aria-live="polite">على الوشاح: <strong>{ownSash ? combineGroupSashName(prefix, ownSash) : "اكتب اسمك أولاً"}</strong></p> : null}
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="خط الوشاح">
                  {SASH_FONTS.map((font) => (
                    <Button key={font.key} type="button" variant={form.font === font.key ? "default" : "outline"} aria-pressed={form.font === font.key}
                      style={{ fontFamily: font.family }} onClick={() => setForm({ ...form, font: font.key })}>{font.label}</Button>
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {data.options.sashColorEditable ? (
                    <div>
                      <Label htmlFor="edit-sash-color">لون الوشاح</Label>
                      <Input id="edit-sash-color" type="color" className="mt-2 h-12" value={form.sashColor} onChange={(event) => setForm({ ...form, sashColor: event.target.value })} />
                    </div>
                  ) : <p className="text-sm text-muted-foreground">لون الوشاح ثابت حسب اختيار ممثل الدفعة.</p>}
                  {data.options.embroideryColorEditable ? (
                    <div>
                      <Label>لون التطريز</Label>
                      <div className="mt-2 flex gap-2">
                        {([["#D4AF37", "ذهبي"], ["#C0C0C0", "فضي"]] as const).map(([color, label]) => (
                          <Button key={color} type="button" variant={form.embroideryColor.toUpperCase() === color ? "default" : "outline"} aria-pressed={form.embroideryColor.toUpperCase() === color}
                            onClick={() => setForm({ ...form, embroideryColor: color })}>{label}</Button>
                        ))}
                      </div>
                    </div>
                  ) : <p className="text-sm text-muted-foreground">لون التطريز ثابت حسب اختيار ممثل الدفعة.</p>}
                </div>
                {data.designApproved ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">اعتمدت التصميم سابقاً؛ إذا غيّرت الاسم على الوشاح أو الخط أو الألوان تحتاج تعتمده من جديد.</p> : null}
              </section>

              <section className="space-y-3">
                <h3 className="font-semibold">الصور والملاحظات</h3>
                {imageError ? <p role="alert" className="text-sm text-destructive">{imageError}</p> : null}
                {STUDENT_REFERENCE_PLACEMENTS.map(({ key, label }) => {
                  const reference = form.references.find((item) => item.placement === key);
                  if (!reference) return null;
                  const shown = reference.image || (reference.removeImage ? "" : reference.imageUrl);
                  return (
                    <div key={key} className="space-y-2 rounded-xl border p-3">
                      <div className="flex items-center justify-between gap-2"><b className="text-sm">{label}</b>
                        {shown ? (
                          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setReference(key, { image: undefined, fileName: undefined, removeImage: true })}>
                            <ImageOff className="ml-1 h-4 w-4" />حذف الصورة
                          </Button>
                        ) : null}
                      </div>
                      {shown ? <img src={shown} alt={`صورة ${label}`} className="max-h-40 rounded-lg object-contain" /> : null}
                      <GraduationReferenceImagePicker id={`edit-ref-${key}`} fileName={reference.fileName || ""} busy={imageBusy === key} disabled={Boolean(imageBusy)} onSelect={(file) => void pickImage(key, file)} />
                      <Textarea aria-label={`ملاحظة ${label}`} className="min-h-14" maxLength={500} placeholder="ملاحظة (اختياري)" value={reference.note} onChange={(event) => setReference(key, { note: event.target.value })} />
                    </div>
                  );
                })}
              </section>

              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
                <Button type="button" disabled={!Object.keys(changes).length || save.isPending || Boolean(imageBusy) || (Boolean(prefix) && !ownSash)} onClick={() => save.mutate(changes)}>
                  {save.isPending ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : null}حفظ التعديلات
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
