import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ClipboardPlus, Link2, Loader2, Plus, Search, SlidersHorizontal, Trash2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TaskFilePicker, TaskPhotoPicker, type TaskFile, type TaskPhoto } from "@/components/task-photo-gallery";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/query-client";
import { PRIORITY_LABELS, catalogOrderType, departmentOrderTypes, extractWorkOrderFields, formatDuration } from "@/lib/work-commands";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import { CustomerBookingPicker, type PickedBooking, type PickedCustomer } from "./customer-booking-picker";
import { Failure, fieldClass, fromLocalInput, newClientKey, toLocalInput, useDepartmentLabel, useWorkCatalog, useWorkMe, useWorkStaff, type WorkOrder, type WorkStaff } from "./shared";

export type WorkOrderDefaults = {
  title?: string;
  description?: string;
  department?: string;
  templateKey?: string;
  booking?: { type: "kosha_booking" | "service_order"; id: number } | null;
  customerId?: number | null;
  customerName?: string | null;
  productId?: number | null;
  source?: { type: string; id: number } | null;
  /** Shown above the form, e.g. «الحجز #120 · أحمد». */
  contextLabel?: string;
};

type Subtask = { key: string; title: string; assigneeId: number | null; mandatory: boolean };

function Field({ label, hint, error, required = false, children, htmlFor }: { label: string; hint?: string; error?: string | null; required?: boolean; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-sm font-bold text-foreground">
        {label}
        {required ? <span className="text-destructive" aria-hidden>*</span> : null}
      </label>
      {children}
      {error ? <p role="alert" className="text-xs font-bold leading-5 text-destructive">{error}</p> : hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A titled group inside «تفاصيل إضافية». */
function Extra({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-extrabold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function StaffPicker({ staff, selected, onChange, exclude = [], label }: { staff: WorkStaff[]; selected: number[]; onChange: (ids: number[]) => void; exclude?: number[]; label: string }) {
  const [query, setQuery] = useState("");
  const departmentLabel = useDepartmentLabel();
  const visible = staff.filter((member) => !exclude.includes(member.id) && (!query.trim() || member.name.includes(query.trim()) || departmentLabel(member.department).includes(query.trim())));
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  return (
    <div className="rounded-xl border border-border">
      <div className="relative border-b border-border p-2">
        <Search className="pointer-events-none absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`بحث في ${label}`} aria-label={`بحث في ${label}`} className="min-h-10 pr-9" />
      </div>
      {selected.length ? (
        <div className="flex flex-wrap gap-1.5 border-b border-border p-2">
          {selected.map((id) => {
            const member = staff.find((item) => item.id === id);
            return (
              <Button key={id} type="button" size="compact" variant="selected" onClick={() => toggle(id)} aria-label={`إزالة ${member?.name ?? id}`}>
                {member?.name ?? `#${id}`}<X className="h-3.5 w-3.5" />
              </Button>
            );
          })}
        </div>
      ) : null}
      <div className="max-h-44 overflow-y-auto overscroll-contain p-1">
        {visible.map((member) => (
          <label key={member.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-muted">
            <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={selected.includes(member.id)} onChange={() => toggle(member.id)} />
            <span className="min-w-0 flex-1 truncate font-semibold">{member.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{departmentLabel(member.department)}</span>
          </label>
        ))}
        {!visible.length ? <p className="px-2 py-4 text-center text-xs text-muted-foreground">لا يوجد موظف مطابق</p> : null}
      </div>
    </div>
  );
}

const EMPTY_DELIVERY = { address: "", recipient: "", vehicle: "", driver: "" };

/** Delivery and vehicle details travel in the order's notes (no new columns). */
export function deliveryNotes(delivery: typeof EMPTY_DELIVERY) {
  return [
    delivery.address.trim() ? `عنوان التوصيل: ${delivery.address.trim()}` : "",
    delivery.recipient.trim() ? `المستلم: ${delivery.recipient.trim()}` : "",
    delivery.vehicle.trim() ? `السيارة: ${delivery.vehicle.trim()}` : "",
    delivery.driver.trim() ? `السائق: ${delivery.driver.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function CreateWorkOrderDialog({
  open,
  onOpenChange,
  channelId = null,
  defaults,
  voice = null,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId?: number | null;
  defaults?: WorkOrderDefaults;
  /** Creating from a voice message: the text must be typed and confirmed. */
  voice?: { messageId: number; url: string; transcript?: string | null } | null;
  onCreated?: (order: WorkOrder) => void;
}) {
  const { toast } = useToast();
  const me = useWorkMe();
  const catalog = useWorkCatalog();
  const orderTypes = catalog.orderTypes.filter((item) => item.active);
  const departments = catalog.departments.filter((item) => item.active);
  const workOrderTemplate = (key: unknown) => {
    const found = catalogOrderType(catalog, key);
    return found?.active ? found : null;
  };
  const staffQuery = useWorkStaff(open && Boolean(me.data?.access.canCreate));
  const staff = staffQuery.data ?? [];
  const [idempotencyKey, setIdempotencyKey] = useState(newClientKey);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState("general");
  const [priority, setPriority] = useState("medium");
  const [assigneeIds, setAssigneeIds] = useState<number[]>([]);
  const [participantIds, setParticipantIds] = useState<number[]>([]);
  const [dueAt, setDueAt] = useState("");
  const [estimated, setEstimated] = useState("");
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [booking, setBooking] = useState<PickedBooking | null>(null);
  const [checklist, setChecklist] = useState<string[]>([]);
  const [checkDraft, setCheckDraft] = useState("");
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [evidenceRequired, setEvidenceRequired] = useState(false);
  const [photos, setPhotos] = useState<TaskPhoto[]>([]);
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [delivery, setDelivery] = useState(EMPTY_DELIVERY);
  const [sourceText, setSourceText] = useState("");
  const [extractNotes, setExtractNotes] = useState<string[] | null>(null);
  const [quickFill, setQuickFill] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const staffRef = useRef<HTMLDivElement>(null);
  const dueRef = useRef<HTMLDivElement>(null);
  const subtasksRef = useRef<HTMLDivElement>(null);

  // Fresh form (and a fresh idempotency key) every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const template = workOrderTemplate(defaults?.templateKey);
    setIdempotencyKey(newClientKey());
    setTemplateKey(template?.key ?? null);
    setTitle(defaults?.title ?? template?.title ?? "");
    setDescription(defaults?.description ?? "");
    const preferred = defaults?.department ?? template?.department ?? me.data?.user.department ?? "general";
    setDepartment(departments.some((item) => item.key === preferred) ? preferred : "general");
    setPriority(template?.priority ?? "medium");
    setAssigneeIds([]);
    setParticipantIds([]);
    setDueAt("");
    setEstimated(template ? String(template.estimatedMinutes) : "");
    setCustomer(null);
    setBooking(null);
    setChecklist(template?.checklist ?? []);
    setCheckDraft("");
    setSubtasks([]);
    setRequiresApproval(template?.requiresApproval ?? false);
    setEvidenceRequired(template?.evidenceRequired ?? false);
    setPhotos([]);
    setFiles([]);
    setDelivery(EMPTY_DELIVERY);
    setSourceText(voice?.transcript ?? "");
    setExtractNotes(null);
    // A voice message has to be typed first; a converted text message lands in the instructions.
    setQuickFill(Boolean(voice));
    setMoreOpen(Boolean(defaults?.description));
    setAttempted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyTemplate = (key: string | null) => {
    const template = workOrderTemplate(key);
    setTemplateKey(template?.key ?? null);
    if (!template) return;
    if (!title.trim() || orderTypes.some((item) => item.title === title)) setTitle(template.title);
    setDepartment(template.department);
    setPriority(template.priority);
    setEstimated(String(template.estimatedMinutes));
    setChecklist(template.checklist);
    setRequiresApproval(template.requiresApproval);
    setEvidenceRequired(template.evidenceRequired);
  };

  // Work types follow the department; a type from another department is dropped.
  const changeDepartment = (next: string) => {
    setDepartment(next);
    const current = workOrderTemplate(templateKey);
    if (current && current.department !== next) setTemplateKey(null);
  };

  const extract = () => {
    const fields = extractWorkOrderFields(sourceText, staff, new Date());
    if (fields.templateKey) applyTemplate(fields.templateKey);
    if (fields.title) setTitle(fields.title);
    if (fields.description) setDescription(fields.description);
    if (fields.assigneeIds.length) setAssigneeIds(fields.assigneeIds);
    if (fields.dueAt) setDueAt(toLocalInput(fields.dueAt));
    setExtractNotes([
      "راجع كل الحقول قبل الإصدار؛ لن يُنشأ الأمر إلا بعد تأكيدك.",
      ...(fields.bookingId && !defaults?.booking ? [`ذُكر الحجز رقم ${fields.bookingId}؛ اختر الزبون ثم حجزه من «تفاصيل إضافية».`] : []),
      ...fields.notes,
    ]);
  };

  const template = workOrderTemplate(templateKey);
  const typesForDepartment = departmentOrderTypes(catalog, department);
  const sortedStaff = useMemo(
    () => [...staff].sort((a, b) => Number(b.department === department) - Number(a.department === department) || a.name.localeCompare(b.name, "ar")),
    [staff, department],
  );
  const notes = deliveryNotes(delivery);

  const create = useMutation({
    mutationFn: () => {
      const linkedBooking = defaults?.booking ?? (booking ? { type: booking.type, id: booking.id } : null);
      return adminFetch<{ order: WorkOrder; existing: boolean }>("/admin/work-commands/orders", {
        method: "POST",
        body: JSON.stringify({
          channelId,
          title,
          description: description.trim() || sourceText.trim(),
          notes: notes || null,
          department,
          templateKey,
          assigneeIds,
          participantIds,
          priority,
          dueAt: fromLocalInput(dueAt),
          estimatedMinutes: Number(estimated) || null,
          attachments: [...photos, ...files].map((item) => ({ url: item.url, thumbnailUrl: item.thumbnailUrl ?? null, fileName: item.fileName ?? null, mediaType: item.mediaType || "image", caption: item.caption || null })),
          booking: linkedBooking,
          // The server takes the name from the customer or booking record.
          customerId: defaults?.booking ? defaults.customerId ?? null : customer?.id ?? null,
          productId: defaults?.productId ?? null,
          source: defaults?.source ?? null,
          requiresApproval,
          evidenceRequired,
          checklist,
          subtasks: subtasks.filter((item) => item.title.trim()).map((item) => ({ title: item.title, assigneeId: item.assigneeId, mandatory: item.mandatory })),
          idempotencyKey,
          voiceMessageId: voice?.messageId ?? null,
        }),
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["work-commands"] });
      toast({
        title: result.existing ? "يوجد أمر عمل نشط لهذا العنصر" : "تم إصدار أمر العمل",
        description: `${result.order.orderNo} · ${result.order.title}`,
      });
      onCreated?.(result.order);
      onOpenChange(false);
    },
    // The form keeps everything typed; the error stays visible above the buttons.
    onError: (error) => toast({ variant: "destructive", title: "تعذر إصدار الأمر", description: apiErrorMessage(error) }),
  });

  const subtaskInvalid = subtasks.some((item) => item.title.trim() && !item.assigneeId);
  const errors = {
    title: title.trim().length < 2 ? "اكتب عنواناً واضحاً للأمر (حرفان على الأقل)." : null,
    assignees: assigneeIds.length ? null : "اختر الموظف المسؤول عن التنفيذ.",
    dueAt: dueAt && !fromLocalInput(dueAt) ? "موعد الإنجاز غير صالح." : null,
    subtasks: subtaskInvalid ? "اختر موظفاً لكل مهمة فرعية." : null,
  };
  const problems = Object.values(errors).filter(Boolean).length;
  const shown = (key: keyof typeof errors) => (attempted ? errors[key] : null);
  const extrasCount = [
    description.trim(),
    customer || booking,
    photos.length,
    files.length,
    subtasks.length,
    checklist.length,
    notes,
    participantIds.length,
  ].filter(Boolean).length;

  const submit = () => {
    if (!problems) {
      create.mutate();
      return;
    }
    setAttempted(true);
    const onlySubtasks = errors.subtasks && !errors.title && !errors.assignees && !errors.dueAt;
    if (onlySubtasks) setMoreOpen(true);
    // Take the person to the first field that needs attention.
    requestAnimationFrame(() => {
      if (errors.title) titleRef.current?.focus();
      else if (errors.assignees) staffRef.current?.querySelector<HTMLInputElement>("input")?.focus();
      else if (errors.dueAt) dueRef.current?.querySelector<HTMLInputElement>("input")?.focus();
      else subtasksRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
  };

  const setDeliveryField = (key: keyof typeof EMPTY_DELIVERY) => (event: { target: { value: string } }) => setDelivery((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Dialog open={open} onOpenChange={(next) => (create.isPending ? undefined : onOpenChange(next))}>
      <DialogContent className="flex w-[min(calc(100%-2rem),44rem)] flex-col gap-0 overflow-hidden p-0 max-md:p-0 max-md:pb-0">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border p-5 pe-14 text-start max-md:p-4 max-md:pe-14">
          <DialogTitle className="flex items-center gap-2 text-lg font-extrabold"><ClipboardPlus className="h-5 w-5 text-primary" />إصدار أمر عمل</DialogTitle>
          <DialogDescription className="text-[13px] leading-6">
            يصل للموظف كإشعار ويُحفظ في سجل المهام. لا يُنشئ أي حركة مالية أو مخزنية.
          </DialogDescription>
          {defaults?.contextLabel ? (
            <p className="mt-1 inline-flex w-fit max-w-full items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs font-bold text-foreground"><Link2 className="h-3.5 w-3.5 shrink-0 text-primary" /><span className="truncate">{defaults.contextLabel}</span></p>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {me.isError ? <div className="p-5"><Failure title="تعذر تحميل صلاحياتك" error={me.error} onRetry={() => void me.refetch()} /></div> : null}
          {me.data && !me.data.access.canCreate ? <div className="p-5"><Failure title="ليس لديك صلاحية إصدار أوامر العمل" error={new Error("اطلب من الإدارة صلاحية إنشاء المهام.")} /></div> : null}
          {staffQuery.isError ? <div className="p-5 pb-0"><Failure title="تعذر تحميل قائمة الموظفين" error={staffQuery.error} onRetry={() => void staffQuery.refetch()} /></div> : null}

          {me.data?.access.canCreate ? (
            <div className="space-y-5 p-5 max-md:p-4">
              <div className="rounded-xl bg-muted/40">
                <Button type="button" variant="ghost" aria-expanded={quickFill} onClick={() => setQuickFill((value) => !value)} className="flex h-auto min-h-11 w-full items-center justify-start gap-2 rounded-xl px-3 text-start">
                  <Wand2 className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-extrabold">تعبئة من نص الرسالة</span>
                    <span className="block whitespace-normal text-xs font-normal leading-5 text-muted-foreground">{voice ? "استمع للرسالة الصوتية واكتب مضمونها، ثم استخرج الحقول." : "الصق نص الطلب ليملأ النظام الحقول، ثم راجعها."}</span>
                  </span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out ${quickFill ? "rotate-180" : ""}`} />
                </Button>
                {quickFill ? (
                  <div className="space-y-2 px-3 pb-3">
                    {voice ? <audio controls preload="none" src={voice.url} className="h-10 w-full" /> : null}
                    <Textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} rows={2} placeholder="مثال: أريد علي يخلص مونتاج حجز 120 باچر الساعة 5" aria-label="نص الطلب" />
                    <Button type="button" variant="outline" size="compact" disabled={!sourceText.trim() || staffQuery.isLoading} onClick={extract} className="gap-1.5"><Wand2 className="h-3.5 w-3.5" />استخراج الحقول</Button>
                    {extractNotes ? (
                      <ul className="space-y-1 rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-900 dark:text-amber-200">
                        {extractNotes.map((note) => <li key={note}>• {note}</li>)}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="القسم" htmlFor="wo-dept" required>
                  <select id="wo-dept" value={department} onChange={(event) => changeDepartment(event.target.value)} className={fieldClass}>
                    {departments.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </Field>
                <Field label="الأولوية">
                  <div className="grid grid-cols-4 gap-1 rounded-xl border border-border p-1" role="radiogroup" aria-label="الأولوية">
                    {(["low", "medium", "high", "urgent"] as const).map((value) => (
                      <Button key={value} type="button" size="compact" role="radio" aria-checked={priority === value} variant={priority === value ? (value === "urgent" ? "destructive" : "selected") : "quiet"} onClick={() => setPriority(value)} className="px-1">{PRIORITY_LABELS[value]}</Button>
                    ))}
                  </div>
                </Field>
              </div>

              <Field
                label="نوع العمل"
                hint={
                  template
                    ? [`المدة المتوقعة ${formatDuration(template.estimatedMinutes)}`, template.requiresApproval ? "يتطلب اعتماد" : "", template.evidenceRequired ? "يتطلب دليل إنجاز" : ""].filter(Boolean).join(" · ")
                    : typesForDepartment.length
                      ? "اختيار النوع يملأ المدة وقائمة التحقق والاعتماد تلقائياً."
                      : "لا توجد أنواع لهذا القسم بعد؛ تُضاف من تبويب «الإعدادات»."
                }
              >
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="نوع العمل">
                  <Button type="button" size="compact" role="radio" aria-checked={templateKey === null} variant={templateKey === null ? "selected" : "outline"} onClick={() => setTemplateKey(null)}>عام</Button>
                  {typesForDepartment.map((item) => (
                    <Button key={item.key} type="button" size="compact" role="radio" aria-checked={templateKey === item.key} variant={templateKey === item.key ? "selected" : "outline"} onClick={() => applyTemplate(item.key)}>{item.label}</Button>
                  ))}
                </div>
              </Field>

              <Field label="عنوان الأمر" htmlFor="wo-title" required error={shown("title")}>
                <Input
                  id="wo-title"
                  ref={titleRef}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={500}
                  placeholder="مثال: مونتاج فيديو حفلة التخرج"
                  aria-invalid={Boolean(shown("title"))}
                  className={`min-h-11 ${shown("title") ? "border-destructive focus-visible:ring-destructive/40" : ""}`}
                />
              </Field>

              <Field label="الموظف المسؤول" required error={shown("assignees")} hint="يمكن اختيار أكثر من موظف؛ موظفو القسم المختار يظهرون أولاً.">
                <div ref={staffRef} className={shown("assignees") ? "rounded-xl ring-2 ring-destructive/40" : undefined}>
                  {staffQuery.isLoading ? <div className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />تحميل الموظفين...</div> : <StaffPicker staff={sortedStaff} selected={assigneeIds} onChange={setAssigneeIds} label="الموظفين" />}
                </div>
              </Field>

              <div ref={dueRef} className="grid gap-4 sm:grid-cols-2">
                <Field label="موعد الإنجاز" htmlFor="wo-due" error={shown("dueAt")} hint="بدون موعد لا يُحسب على الأمر تأخير.">
                  <Input id="wo-due" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="min-h-11" dir="ltr" />
                </Field>
              </div>

              <Collapsible open={moreOpen} onOpenChange={setMoreOpen} className="rounded-xl border border-border">
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="ghost" className="flex h-auto min-h-12 w-full items-center justify-start gap-2 rounded-xl px-3 text-start">
                    <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-extrabold">تفاصيل إضافية <span className="font-semibold text-muted-foreground">(اختياري)</span></span>
                      <span className="block whitespace-normal text-xs font-normal leading-5 text-muted-foreground">
                        {extrasCount ? `مُضاف: ${extrasCount}` : "التعليمات، الزبون والحجز، الصور والمرفقات، المهام الفرعية، التوصيل والسيارة، الاعتماد"}
                      </span>
                    </span>
                    {shown("subtasks") ? <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" aria-label="يوجد حقل يحتاج تصحيح" /> : null}
                    <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out ${moreOpen ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 border-t border-border p-4 max-md:p-3">
                  <Extra title="التعليمات">
                    <Field label="تعليمات للموظف" htmlFor="wo-desc" hint="تظهر للموظف في بطاقة الأمر. إذا تُركت فارغة يُحفظ نص الرسالة المكتوب في «تعبئة من نص».">
                      <Textarea id="wo-desc" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="ما المطلوب بالضبط؟ أي ملاحظات للموظف." />
                    </Field>
                  </Extra>

                  {defaults?.booking ? null : (
                    <Extra title="الزبون والحجز">
                      <p className="text-xs leading-5 text-muted-foreground">{template?.needsBooking ? "هذا النوع يرتبط عادة بحجز: " : ""}اختر الزبون من العملاء ثم حجزه؛ يُربط الأمر بالحجز واسم الزبون معاً.</p>
                      <CustomerBookingPicker
                        customer={customer}
                        booking={booking}
                        onChange={(value) => {
                          setCustomer(value.customer);
                          setBooking(value.booking);
                        }}
                      />
                    </Extra>
                  )}

                  <Extra title="الصور والمرفقات">
                    <TaskPhotoPicker photos={photos} onChange={setPhotos} label="صور مرجعية" description="مثال: صورة التصميم المطلوب أو مكان العمل." />
                    <TaskFilePicker files={files} onChange={setFiles} label="مرفقات (فيديو، PDF، مستندات)" />
                  </Extra>

                  <Extra title="المهام الفرعية وقائمة التحقق">
                    <div ref={subtasksRef} className="space-y-2">
                      {subtasks.map((item, index) => (
                        <div key={item.key} className="grid gap-2 rounded-xl border border-border p-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto_auto] sm:items-center">
                          <Input value={item.title} onChange={(event) => setSubtasks(subtasks.map((row) => row.key === item.key ? { ...row, title: event.target.value } : row))} placeholder={`المهمة الفرعية ${index + 1}`} aria-label={`عنوان المهمة الفرعية ${index + 1}`} className="min-h-10" />
                          <select value={item.assigneeId ?? ""} onChange={(event) => setSubtasks(subtasks.map((row) => row.key === item.key ? { ...row, assigneeId: Number(event.target.value) || null } : row))} className={`${fieldClass} min-h-10 ${attempted && item.title.trim() && !item.assigneeId ? "border-destructive" : ""}`} aria-label="الموظف">
                            <option value="">اختر الموظف</option>
                            {sortedStaff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                          </select>
                          <div className="flex items-center justify-between gap-2 sm:contents">
                            <label className="flex min-h-10 items-center gap-2 text-xs font-bold"><Switch checked={item.mandatory} onCheckedChange={(checked) => setSubtasks(subtasks.map((row) => row.key === item.key ? { ...row, mandatory: checked } : row))} />إلزامية</label>
                            <Button type="button" variant="quiet" size="iconSm" aria-label="حذف المهمة الفرعية" onClick={() => setSubtasks(subtasks.filter((row) => row.key !== item.key))}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </div>
                      ))}
                      {shown("subtasks") ? <p role="alert" className="text-xs font-bold text-destructive">{errors.subtasks}</p> : null}
                      <Button type="button" variant="outline" size="compact" className="gap-1" onClick={() => setSubtasks([...subtasks, { key: newClientKey(), title: "", assigneeId: null, mandatory: true }])}><Plus className="h-3.5 w-3.5" />مهمة فرعية</Button>
                      <p className="text-xs leading-5 text-muted-foreground">كل مهمة فرعية تُسند لموظف. الأمر الرئيسي لا يكتمل قبل المهام الإلزامية.</p>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-sm font-bold">قائمة التحقق</p>
                      {checklist.map((item, index) => (
                        <div key={`${item}-${index}`} className="flex min-h-10 items-center gap-2 rounded-lg bg-muted/40 px-3 text-sm">
                          <span className="min-w-0 flex-1 break-words">{item}</span>
                          <Button type="button" variant="quiet" size="iconSm" aria-label={`حذف ${item}`} onClick={() => setChecklist(checklist.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <Input value={checkDraft} onChange={(event) => setCheckDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && checkDraft.trim()) { event.preventDefault(); setChecklist([...checklist, checkDraft.trim()]); setCheckDraft(""); } }} placeholder="أضف بنداً يراه الموظف أثناء التنفيذ" aria-label="بند جديد" className="min-h-10 min-w-0 flex-1" />
                        <Button type="button" variant="outline" size="compact" className="shrink-0 gap-1" disabled={!checkDraft.trim()} onClick={() => { setChecklist([...checklist, checkDraft.trim()]); setCheckDraft(""); }}><Plus className="h-3.5 w-3.5" />إضافة</Button>
                      </div>
                    </div>
                  </Extra>

                  <Extra title="التوصيل والسيارة">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="عنوان التوصيل" htmlFor="wo-addr"><Input id="wo-addr" value={delivery.address} onChange={setDeliveryField("address")} maxLength={300} placeholder="المنطقة، أقرب نقطة دالة" className="min-h-11" /></Field>
                      <Field label="المستلم" htmlFor="wo-recipient"><Input id="wo-recipient" value={delivery.recipient} onChange={setDeliveryField("recipient")} maxLength={200} placeholder="الاسم ورقم الهاتف" className="min-h-11" /></Field>
                      <Field label="السيارة" htmlFor="wo-vehicle"><Input id="wo-vehicle" value={delivery.vehicle} onChange={setDeliveryField("vehicle")} maxLength={200} placeholder="نوع السيارة أو رقمها" className="min-h-11" /></Field>
                      <Field label="السائق" htmlFor="wo-driver"><Input id="wo-driver" value={delivery.driver} onChange={setDeliveryField("driver")} maxLength={200} placeholder="اسم السائق" className="min-h-11" /></Field>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">تُحفظ مع ملاحظات الأمر وتظهر للموظف في التعليمات.</p>
                  </Extra>

                  <Extra title="الاعتماد والمتابعة">
                    <div className="divide-y divide-border rounded-xl border border-border">
                      <label className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-3 py-2">
                        <span className="min-w-0"><span className="block text-sm font-bold">يتطلب اعتماد الإنجاز</span><span className="block text-xs leading-5 text-muted-foreground">بعد «تم الإنجاز» ينتظر الأمر اعتماد الإدارة.</span></span>
                        <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} />
                      </label>
                      <label className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-3 py-2">
                        <span className="min-w-0"><span className="block text-sm font-bold">يتطلب دليل إنجاز</span><span className="block text-xs leading-5 text-muted-foreground">{template?.evidenceHint || "صورة أو ملف أو رابط عند الإنجاز."}</span></span>
                        <Switch checked={evidenceRequired} onCheckedChange={setEvidenceRequired} />
                      </label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="الوقت المتوقع (دقيقة)" htmlFor="wo-est">
                        <Input id="wo-est" type="number" inputMode="numeric" min={0} value={estimated} onChange={(event) => setEstimated(event.target.value)} className="min-h-11" dir="ltr" />
                      </Field>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-sm font-bold">مشاركون يطّلعون على الأمر</p>
                      <StaffPicker staff={sortedStaff} selected={participantIds} onChange={setParticipantIds} exclude={assigneeIds} label="المشاركين" />
                    </div>
                  </Extra>
                </CollapsibleContent>
              </Collapsible>

              {create.isError ? <Failure title="لم يُصدر الأمر، وكل ما كتبته محفوظ" error={create.error} /> : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 flex-row flex-wrap items-center gap-2 border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-md:p-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:[&>*]:w-auto sm:justify-start">
          <Button type="button" disabled={create.isPending || !me.data?.access.canCreate} onClick={submit} className="min-h-11 flex-1 gap-2 sm:flex-none">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardPlus className="h-4 w-4" />}
            إصدار الأمر
          </Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={create.isPending} onClick={() => onOpenChange(false)}>إلغاء</Button>
          {attempted && problems ? (
            <span className="text-xs font-bold text-destructive max-sm:order-first max-sm:!w-full" role="status">{problems === 1 ? "حقل واحد يحتاج تصحيح" : `${problems} حقول تحتاج تصحيح`}</span>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** «إصدار أمر عمل» from any record page (booking, product, …). */
export function IssueWorkOrderButton({
  defaults,
  label = "إصدار أمر عمل",
  className,
  variant = "outline",
}: {
  defaults: WorkOrderDefaults;
  label?: string;
  className?: string;
  variant?: "outline" | "default" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const me = useWorkMe();
  if (!me.data?.ready || !me.data.access.canCreate) return null;
  return (
    <>
      <Button type="button" variant={variant} className={`gap-2 ${className ?? ""}`} onClick={() => setOpen(true)}>
        <ClipboardPlus className="h-4 w-4" />{label}
      </Button>
      <CreateWorkOrderDialog open={open} onOpenChange={setOpen} defaults={defaults} />
    </>
  );
}
