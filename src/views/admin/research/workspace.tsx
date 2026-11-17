import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Edit3,
  ExternalLink,
  FileText,
  History,
  Loader2,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { FieldGroup } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmployeeSelect } from "@/components/employee-select";
import { ACADEMIC_LEVELS, RESEARCH_CATEGORIES } from "@/lib/research-contract";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, type AdminMe } from "../_lib";
import { researchAccess } from "./ui-model";
import {
  Choice,
  dateText,
  Panel,
  researchFetch,
  ResearchEmpty,
  ResearchFailure,
  ResearchField,
  ResearchLoading,
  ResearchMetric,
  ResearchStatus,
  RESEARCH_STATUSES,
  RESEARCH_TYPES,
  type ResearchRecord,
} from "./shared";
import { ResearchOrderForm } from "./order-form";
import { ResearchFinancialPanel } from "./finance";
import { ResearchOrderActions } from "./order-actions";

export function ResearchWorkspace({
  id,
  me,
  onClose,
}: {
  id: number;
  me: AdminMe;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const cache = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [delivery, setDelivery] = useState(false);
  const query = useQuery<ResearchRecord>({
    queryKey: ["research", "order", id],
    queryFn: () => researchFetch(`/orders/${id}`),
  });
  const financial = researchAccess(me, "research.financials.view");
  const editable = researchAccess(me, "research.edit");
  const patch = useMutation({
    mutationFn: (changes: ResearchRecord) =>
      researchFetch(`/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["research"] });
      setDelivery(false);
      toast({ title: "تم تحديث البحث" });
    },
    onError: (error) =>
      toast({
        title: "تعذر تحديث البحث",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  if (query.isPending) return <ResearchLoading />;
  if (query.isError)
    return (
      <div className="flex flex-col gap-4">
        <Button variant="outline" className="self-start" onClick={onClose}>
          <ArrowRight data-icon="inline-start" />
          العودة
        </Button>
        <ResearchFailure
          error={query.error}
          retry={() => void query.refetch()}
        />
      </div>
    );
  const data = query.data;
  const order = {
    ...data.order,
    customerName:
      data.customer?.fullName || data.customer?.name || data.order.customerName,
    customerPhone: data.customer?.phone || data.order.customerPhone,
  };
  if (editing)
    return (
      <div className="flex flex-col gap-5">
      <Panel
        title="طباعة ومشاركة الطلب"
        action={<div className="flex flex-wrap gap-2"><ResearchOrderActions order={order} financial={financial} /></div>}
      >
        <p className="text-sm text-muted-foreground">الطباعة والمشاركة تعتمد آخر نسخة محفوظة؛ احفظ تعديلاتك أولاً لتظهر فيها.</p>
      </Panel>
      <ResearchOrderForm
        key={id}
        financial={financial}
        assignable={researchAccess(me, "research.assign")}
        existing={order}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          void query.refetch();
        }}
      />
      </div>
    );
  const finalFiles = data.files.filter(
    (file: any) => file.fileType === "final" && file.isCustomerVisible,
  );
  const canDeliver =
    editable && order.status === "completed" && finalFiles.length > 0;
  return (
    <div className="flex flex-col gap-5">
      <Panel
        title={order.title}
        description={`${order.researchNo} · ${order.customerName || "الطالب"}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              <ArrowRight data-icon="inline-start" />
              العودة
            </Button>
            {editable && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                <Edit3 data-icon="inline-start" />
                تعديل
              </Button>
            )}
            <ResearchOrderActions order={order} financial={financial} />
          </div>
        }
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <ResearchStatus status={order.status} />
            <Badge variant="outline">
              {RESEARCH_CATEGORIES[order.researchCategory] || "غير مصنف"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              موعد التسليم: <bdi>{dateText(order.deadline)}</bdi>
            </span>
          </div>
          {editable && (
            <div className="w-full sm:w-52">
              <Choice
                label="تغيير حالة البحث"
                value={order.status}
                options={Object.fromEntries(
                  Object.entries(RESEARCH_STATUSES).filter(
                    ([key]) =>
                      key !== "archived" ||
                      order.status === "archived" ||
                      researchAccess(me, "research.archive"),
                  ),
                )}
                disabled={patch.isPending}
                onChange={(status) =>
                  status === "delivered"
                    ? setDelivery(true)
                    : patch.mutate({ status })
                }
              />
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Progress value={Number(order.progress || 0)} />
          <bdi className="text-sm font-bold">{order.progress || 0}%</bdi>
        </div>
      </Panel>
      <Tabs defaultValue="details" dir="rtl">
        <TabsList className="mb-4 h-auto w-full flex-wrap justify-start gap-1">
          {[
            ["details", "التفاصيل"],
            ["team", "الفريق"],
            ["chapters", "الفصول والإصدارات"],
            ["files", "الملفات"],
            ["sources", "المصادر والمراجع"],
            ["plagiarism", "الاستلال"],
            ["messages", "المراسلات والتعديلات"],
            ...(financial ? [["financial", "الحساب المالي"]] : []),
            ["timeline", "سجل النشاط"],
            ["delivery", "التسليم النهائي"],
          ].map(([key, label]) => (
            <TabsTrigger value={key} key={key}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="details">
          <Panel title="ملف البحث الأكاديمي">
            <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ["الطالب", order.customerName],
                ["رقم الهاتف", order.customerPhone],
                ["العنوان بالإنجليزية", order.titleEnglish],
                [
                  "المستوى الدراسي",
                  ACADEMIC_LEVELS[order.academicLevel] || order.academicLevel,
                ],
                [
                  "النوع الأكاديمي",
                  RESEARCH_TYPES[order.researchType] || order.researchType,
                ],
                ["الجامعة", order.universityName],
                ["الكلية", order.college],
                ["القسم / التخصص", order.department],
                ["المشرف", order.supervisorName],
                ["المجال العلمي", order.researchField],
                ["عدد الصفحات", order.requiredPages],
                ["اللغة", order.language],
                ["نمط التوثيق", order.citationStyle],
                ["موعد التسليم", dateText(order.deadline)],
                ...(financial
                  ? [["استحقاق الدفع", dateText(order.paymentDueDate)]]
                  : []),
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words text-sm font-semibold">
                    <bdi>{value || "—"}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
            {order.notes && (
              <div className="mt-5 rounded-lg bg-muted p-4">
                <p className="text-xs text-muted-foreground">
                  متطلبات وملاحظات
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7">
                  {order.notes}
                </p>
              </div>
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="team">
          <ResearchTeam
            order={order}
            assignments={data.assignments}
            enabled={researchAccess(me, "research.assign")}
            onPatch={(changes) => patch.mutate(changes)}
            busy={patch.isPending}
          />
        </TabsContent>
        <TabsContent value="chapters">
          <ResearchChapters
            orderId={id}
            chapters={data.chapters}
            editable={researchAccess(me, "research.chapters.manage")}
          />
        </TabsContent>
        <TabsContent value="files">
          <ResearchFiles
            orderId={id}
            chapters={data.chapters}
            files={data.files}
            editable={researchAccess(me, "research.files.manage")}
          />
        </TabsContent>
        <TabsContent value="sources">
          <ResearchReferences
            order={order}
            sources={data.sources}
            citations={data.citations}
            editable={researchAccess(me, "research.citations.manage")}
          />
        </TabsContent>
        <TabsContent value="plagiarism">
          <ResearchPlagiarism
            orderId={id}
            reports={data.plagiarism || data.plagiarismReports}
            editable={researchAccess(me, "research.plagiarism.manage")}
          />
        </TabsContent>
        <TabsContent value="messages">
          <ResearchMessages
            orderId={id}
            chapters={data.chapters}
            messages={data.messages}
            editable={editable}
          />
        </TabsContent>
        {financial && (
          <TabsContent value="financial">
            <ResearchFinancialPanel order={order} me={me} />
          </TabsContent>
        )}
        <TabsContent value="timeline">
          <Panel title="سجل النشاط">
            <ol className="flex flex-col gap-4">
              {data.timeline.map((event: any) => (
                <li key={event.id} className="border-s-2 border-accent/50 ps-4">
                  <p className="text-sm font-semibold">{event.title}</p>
                  {event.description && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {event.description}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {event.actorName} ·{" "}
                    <bdi>
                      {new Date(event.createdAt).toLocaleString(
                        "ar-IQ-u-nu-latn",
                      )}
                    </bdi>
                  </p>
                </li>
              ))}
            </ol>
            {!data.timeline.length && (
              <ResearchEmpty
                title="لا توجد أنشطة مسجلة"
                description="تظهر تحديثات البحث هنا."
              />
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="delivery">
          <Panel
            title="التسليم النهائي"
            description="يتطلب التسليم بحثاً جاهزاً وملفاً نهائياً متاحاً للطالب."
          >
            <div className="flex flex-col gap-3">
              {finalFiles.map((file: any) => (
                <FileLink key={file.id} file={file} />
              ))}
              {!finalFiles.length && (
                <ResearchEmpty
                  title="لم ترفع نسخة نهائية للطالب"
                  description="ارفع ملفاً بتصنيف «نسخة نهائية» وفعّل ظهوره للطالب من تبويب الملفات."
                />
              )}
              <div className="flex flex-wrap gap-3">
                {order.trackingUrl || order.qrToken ? (
                  <Button variant="outline" asChild>
                    <a
                      href={
                        order.trackingUrl || `/research/track/${order.qrToken}`
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink data-icon="inline-start" />
                      فتح بوابة متابعة الطالب
                    </a>
                  </Button>
                ) : null}
                {editable && (
                  <Button
                    disabled={!canDeliver || patch.isPending}
                    onClick={() => setDelivery(true)}
                  >
                    <CheckCircle2 data-icon="inline-start" />
                    تأكيد تسليم البحث
                  </Button>
                )}
              </div>
              {order.status === "delivered" && (
                <p className="text-sm text-primary">تم تسليم هذا البحث.</p>
              )}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
      <Dialog open={delivery} onOpenChange={setDelivery}>
        <DialogContent dir="rtl" className="research-dialog">
          <DialogHeader>
            <DialogTitle>تأكيد التسليم النهائي</DialogTitle>
            <DialogDescription>
              {canDeliver
                ? "ستُسجل حالة التسليم في سجل البحث ويظهر الملف النهائي في بوابة الطالب."
                : "لا يمكن التسليم قبل تحويل البحث إلى جاهز للتسليم ورفع ملف نهائي ظاهر للطالب."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelivery(false)}>
              إلغاء
            </Button>
            <Button
              disabled={!canDeliver || patch.isPending}
              onClick={() => patch.mutate({ status: "delivered" })}
            >
              تأكيد التسليم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResearchTeam({
  order,
  assignments,
  enabled,
  onPatch,
  busy,
}: {
  order: ResearchRecord;
  assignments: ResearchRecord[];
  enabled: boolean;
  onPatch: (changes: ResearchRecord) => void;
  busy: boolean;
}) {
  const catalog = useQuery<ResearchRecord>({
    queryKey: ["research", "catalog"],
    queryFn: () => researchFetch("/catalog"),
  });
  return (
    <Panel
      title="فريق العمل"
      description="يرتبط التكليف بموظفي النظام الحاليين."
    >
      {catalog.isError ? (
        <ResearchFailure
          error={catalog.error}
          retry={() => void catalog.refetch()}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[
            ["assignedWriterId", "الكاتب / المسؤول"],
            ["assignedReviewerId", "المراجع"],
            ["assignedProofreaderId", "المدقق اللغوي"],
            ["assignedFormatterId", "المنسق"],
            ["assignedSupervisorId", "المشرف الداخلي"],
          ].map(([key, label]) => (
            <ResearchField key={key} name={key} label={label}>
              <EmployeeSelect
                id={key}
                employees={catalog.data?.writers || []}
                value={order[key] ? String(order[key]) : ""}
                disabled={!enabled || busy || catalog.isPending}
                emptyLabel="بدون تعيين"
                onValueChange={(value) =>
                  onPatch({ [key]: value ? Number(value) : null })
                }
              />
            </ResearchField>
          ))}
        </div>
      )}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {assignments.map((row: any) => (
          <div
            key={row.assignment.id}
            className="rounded-lg border p-3 text-sm"
          >
            <strong>{row.staffName || row.username}</strong>
            <p className="mt-1 text-xs text-muted-foreground">
              {row.assignment.role} · {row.assignment.status}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ResearchChapters({
  orderId,
  chapters,
  editable,
}: {
  orderId: number;
  chapters: ResearchRecord[];
  editable: boolean;
}) {
  const [selected, setSelected] = useState<ResearchRecord | null>(null);
  return (
    <Panel
      title="الفصول والإصدارات"
      description="كل حفظ جديد للمحتوى يحتفظ بالإصدار السابق."
    >
      <div className="flex flex-col gap-3">
        {chapters.map((chapter) => (
          <article
            key={chapter.id}
            className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold">{chapter.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                الإصدار {chapter.currentVersion} · {chapter.wordCount} كلمة ·{" "}
                {chapter.approvalStatus || chapter.status}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <Progress value={Number(chapter.progress || 0)} />
                <bdi className="text-xs">{chapter.progress || 0}%</bdi>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(chapter)}
            >
              <Edit3 data-icon="inline-start" />
              {editable ? "تحرير وإصدارات" : "عرض وإصدارات"}
            </Button>
          </article>
        ))}
      </div>
      {!chapters.length && (
        <ResearchEmpty
          title="لا توجد فصول لهذا البحث"
          description="الفصول تُنشأ مع الطلب حسب نوع البحث."
        />
      )}
      {selected && (
        <ResearchChapterEditor
          key={selected.id}
          chapter={selected}
          orderId={orderId}
          editable={editable}
          onClose={() => setSelected(null)}
        />
      )}
    </Panel>
  );
}
function ResearchChapterEditor({
  chapter,
  orderId,
  editable,
  onClose,
}: {
  chapter: ResearchRecord;
  orderId: number;
  editable: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const cache = useQueryClient();
  const [form, setForm] = useState({
    title: chapter.title,
    content: chapter.content || "",
    changeNote: "",
    progress: Number(chapter.progress || 0),
    status: chapter.status,
    approvalStatus: chapter.approvalStatus || "pending",
  });
  const [preview, setPreview] = useState<ResearchRecord | null>(null);
  const history = useQuery<ResearchRecord>({
    queryKey: ["research", "chapter-versions", chapter.id],
    queryFn: () => researchFetch(`/chapters/${chapter.id}/versions`),
  });
  const save = useMutation({
    mutationFn: () =>
      researchFetch(`/chapters/${chapter.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...form, orderId }),
      }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["research"] });
      toast({ title: "تم حفظ إصدار الفصل" });
      onClose();
    },
    onError: (error) =>
      toast({
        title: "تعذر حفظ الفصل",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  const restore = useMutation({
    mutationFn: (versionId: number) =>
      researchFetch(`/chapters/${chapter.id}/restore`, {
        method: "POST",
        body: JSON.stringify({ versionId, orderId }),
      }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["research"] });
      toast({ title: "تمت استعادة المحتوى في إصدار جديد" });
      onClose();
    },
    onError: (error) =>
      toast({
        title: "تعذرت استعادة الإصدار",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        dir="rtl"
        className="research-dialog max-h-[90dvh] max-w-5xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{chapter.title}</DialogTitle>
          <DialogDescription>
            الإصدار الحالي {chapter.currentVersion}. الاستعادة تنشئ إصداراً
            جديداً وتحفظ التاريخ.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="content" dir="rtl">
          <TabsList>
            <TabsTrigger value="content">المحتوى</TabsTrigger>
            <TabsTrigger value="versions">تاريخ الإصدارات</TabsTrigger>
          </TabsList>
          <TabsContent value="content">
            <FieldGroup>
              <ResearchField label="عنوان الفصل" name="chapter-title">
                <Input
                  id="chapter-title"
                  disabled={!editable}
                  value={form.title}
                  onChange={(event) =>
                    setForm({ ...form, title: event.target.value })
                  }
                />
              </ResearchField>
              <ResearchField label="نص الفصل" name="chapter-content">
                <Textarea
                  id="chapter-content"
                  readOnly={!editable}
                  className="min-h-72 leading-8"
                  value={form.content}
                  onChange={(event) =>
                    setForm({ ...form, content: event.target.value })
                  }
                />
              </ResearchField>
              <div className="grid gap-3 sm:grid-cols-3">
                <ResearchField label="نسبة الإنجاز" name="chapter-progress">
                  <Input
                    id="chapter-progress"
                    type="number"
                    min={0}
                    max={100}
                    disabled={!editable}
                    value={form.progress}
                    onChange={(event) =>
                      setForm({ ...form, progress: Number(event.target.value) })
                    }
                  />
                </ResearchField>
                <ResearchField label="حالة الفصل" name="chapter-status">
                  <Choice
                    label="حالة الفصل"
                    value={form.status}
                    disabled={!editable}
                    options={{
                      not_started: "لم يبدأ",
                      in_progress: "قيد التنفيذ",
                      writing: "قيد الكتابة",
                      review: "قيد المراجعة",
                      completed: "مكتمل",
                    }}
                    onChange={(status) => setForm({ ...form, status })}
                  />
                </ResearchField>
                <ResearchField label="اعتماد الفصل" name="chapter-approval">
                  <Choice
                    label="اعتماد الفصل"
                    value={form.approvalStatus}
                    disabled={!editable}
                    options={{
                      pending: "بانتظار الاعتماد",
                      approved: "معتمد",
                      revision_requested: "تعديل مطلوب",
                    }}
                    onChange={(approvalStatus) =>
                      setForm({ ...form, approvalStatus })
                    }
                  />
                </ResearchField>
              </div>
              {editable && (
                <ResearchField label="ملاحظة التغيير" name="chapter-note">
                  <Input
                    id="chapter-note"
                    value={form.changeNote}
                    onChange={(event) =>
                      setForm({ ...form, changeNote: event.target.value })
                    }
                  />
                </ResearchField>
              )}
            </FieldGroup>
          </TabsContent>
          <TabsContent value="versions">
            {history.isPending ? (
              <ResearchLoading />
            ) : history.isError ? (
              <ResearchFailure
                error={history.error}
                retry={() => void history.refetch()}
              />
            ) : (
              <div className="flex flex-col gap-3">
                {history.data.versions.map((version: any) => (
                  <div
                    key={version.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                  >
                    <div>
                      <strong>الإصدار {version.version}</strong>
                      <p className="text-xs text-muted-foreground">
                        {version.createdByName} · {dateText(version.createdAt)}{" "}
                        · {version.changeNote}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreview(version)}
                      >
                        عرض النص
                      </Button>
                      {editable && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={restore.isPending}
                          onClick={() => restore.mutate(version.id)}
                        >
                          استعادة كإصدار جديد
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {!history.data.versions.length && (
                  <ResearchEmpty
                    title="لا توجد إصدارات سابقة"
                    description="يظهر التاريخ عند حفظ محتوى الفصل."
                  />
                )}
                {preview && (
                  <div className="rounded-lg bg-muted p-4">
                    <p className="mb-3 font-semibold">
                      معاينة الإصدار {preview.version}
                    </p>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-sans text-sm leading-7">
                      {preview.content}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
          {editable && (
            <Button
              disabled={save.isPending || restore.isPending}
              onClick={() => save.mutate()}
            >
              <Save data-icon="inline-start" />
              حفظ إصدار الفصل
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const fileTypes = {
  customer_upload: "تعليمات وملفات الطالب",
  draft: "مسودة",
  revision: "تعديلات",
  final: "نسخة نهائية",
  reference: "مصادر ومراجع",
  plagiarism_report: "تقرير استلال",
  other: "بيانات وملفات أخرى",
};
function FileLink({ file }: { file: ResearchRecord }) {
  return (
    <a
      href={file.fileUrl}
      target="_blank"
      rel="noreferrer"
      className="flex min-w-0 items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted"
    >
      <span className="flex min-w-0 items-center gap-2">
        <FileText className="size-4 shrink-0" />
        <span className="min-w-0">
          <strong className="block truncate text-sm">{file.title}</strong>
          <span className="text-xs text-muted-foreground">
            {fileTypes[file.fileType as keyof typeof fileTypes] ||
              file.fileType}{" "}
            · {dateText(file.createdAt)}
          </span>
        </span>
      </span>
      <Badge variant="outline">v{file.version}</Badge>
    </a>
  );
}
function ResearchFiles({
  orderId,
  chapters,
  files,
  editable,
}: {
  orderId: number;
  chapters: ResearchRecord[];
  files: ResearchRecord[];
  editable: boolean;
}) {
  const { toast } = useToast();
  const cache = useQueryClient();
  const [fileType, setFileType] = useState("draft");
  const [chapterId, setChapterId] = useState("");
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [historyFile, setHistoryFile] = useState<ResearchRecord | null>(null);
  const upload = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("اختر ملفاً للرفع");
      if (selectedFile.size > 6 * 1024 * 1024)
        throw new Error("الحد الأقصى للملف 6MB");
      const fileUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("تعذرت قراءة الملف"));
        reader.readAsDataURL(selectedFile);
      });
      return researchFetch("/files", {
        method: "POST",
        body: JSON.stringify({
          orderId,
          chapterId: chapterId ? Number(chapterId) : null,
          title: title.trim() || selectedFile.name,
          fileName: selectedFile.name,
          fileUrl,
          fileType,
          mimeType: selectedFile.type || undefined,
          isCustomerVisible: visible,
        }),
      });
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["research"] });
      setSelectedFile(null);
      setTitle("");
      toast({ title: "تم رفع الملف وحفظ إصداره" });
    },
    onError: (error) =>
      toast({
        title: "تعذر رفع الملف",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  return (
    <Panel
      title="ملفات البحث"
      description="ملفات خاصة بروابط مؤقتة. رفع نفس العنوان والتصنيف والفصل يحفظ إصداراً جديداً."
    >
      {editable && (
        <FieldGroup className="mb-6 rounded-lg border border-dashed p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <ResearchField label="تصنيف الملف" name="research-file-type">
              <Choice
                label="تصنيف الملف"
                value={fileType}
                options={fileTypes}
                onChange={setFileType}
              />
            </ResearchField>
            <ResearchField label="ربط بفصل" name="research-file-chapter">
              <Choice
                label="ربط بفصل"
                value={chapterId}
                options={{
                  "": "عام للبحث",
                  ...Object.fromEntries(
                    chapters.map((chapter) => [
                      String(chapter.id),
                      chapter.title,
                    ]),
                  ),
                }}
                onChange={setChapterId}
              />
            </ResearchField>
            <ResearchField
              label="عنوان الملف / سلسلة الإصدارات"
              name="research-file-title"
            >
              <Input
                id="research-file-title"
                placeholder="اتركه فارغاً لاستخدام اسم الملف"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </ResearchField>
            <ResearchField
              label="اختر ملفاً (حتى 6MB)"
              name="research-file-upload"
            >
              <Input
                id="research-file-upload"
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.txt,.csv"
                disabled={upload.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  if (file && file.size > 6 * 1024 * 1024) {
                    setSelectedFile(null);
                    toast({
                      title: "حجم الملف أكبر من 6MB",
                      variant: "destructive",
                    });
                  } else setSelectedFile(file);
                }}
              />
            </ResearchField>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={visible}
              onCheckedChange={(checked) => setVisible(checked === true)}
            />
            إظهار هذا الإصدار للطالب في بوابة المتابعة
          </label>
          <Button
            className="self-end"
            disabled={!selectedFile || upload.isPending}
            onClick={() => upload.mutate()}
          >
            {upload.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Upload data-icon="inline-start" />
            )}
            رفع إصدار {selectedFile?.name}
          </Button>
        </FieldGroup>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {files.map((file) => (
          <div key={file.id} className="flex min-w-0 flex-col gap-2">
            <FileLink file={file} />
            <div className="flex flex-wrap items-center justify-between gap-2 px-2">
              <span className="text-xs text-muted-foreground">
                {file.isCustomerVisible ? "ظاهر للطالب" : "داخلي للفريق"}
                {file.checksum
                  ? ` · SHA256 ${String(file.checksum).slice(0, 10)}`
                  : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setHistoryFile(file)}
              >
                <History data-icon="inline-start" />
                الإصدارات
              </Button>
              {editable && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setTitle(file.title);
                    setFileType(file.fileType);
                    setChapterId(file.chapterId ? String(file.chapterId) : "");
                    setVisible(Boolean(file.isCustomerVisible));
                    document.getElementById("research-file-upload")?.focus();
                  }}
                >
                  رفع إصدار جديد
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {!files.length && (
        <ResearchEmpty
          title="لم تُرفع ملفات لهذا البحث"
          description="ارفع التعليمات أو المسودات أو النسخ النهائية لتوثيقها."
        />
      )}
      {historyFile && (
        <ResearchFileHistory
          file={historyFile}
          onClose={() => setHistoryFile(null)}
        />
      )}
    </Panel>
  );
}
function ResearchFileHistory({
  file,
  onClose,
}: {
  file: ResearchRecord;
  onClose: () => void;
}) {
  const query = useQuery<ResearchRecord>({
    queryKey: ["research", "file-versions", file.id],
    queryFn: () => researchFetch(`/files/${file.id}/versions`),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="research-dialog">
        <DialogHeader>
          <DialogTitle>إصدارات {file.title}</DialogTitle>
          <DialogDescription>
            كل نسخة محفوظة مستقلة مع صاحب الرفع وتاريخه.
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <ResearchLoading />
        ) : query.isError ? (
          <ResearchFailure
            error={query.error}
            retry={() => void query.refetch()}
          />
        ) : (
          <div className="flex max-h-[60dvh] flex-col gap-3 overflow-y-auto">
            {query.data.versions.map((version: any) => (
              <div key={version.id}>
                <FileLink file={version} />
                <p className="mt-1 text-xs text-muted-foreground">
                  {version.uploadedByName} ·{" "}
                  {version.isCustomerVisible ? "ظاهر للطالب" : "داخلي"}
                </p>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResearchMessages({
  orderId,
  chapters,
  messages,
  editable,
}: {
  orderId: number;
  chapters: ResearchRecord[];
  messages: ResearchRecord[];
  editable: boolean;
}) {
  const { toast } = useToast();
  const cache = useQueryClient();
  const [message, setMessage] = useState("");
  const [type, setType] = useState("message");
  const [chapterId, setChapterId] = useState("");
  const [internal, setInternal] = useState(false);
  const send = useMutation({
    mutationFn: () =>
      researchFetch("/messages", {
        method: "POST",
        body: JSON.stringify({
          orderId,
          message,
          messageType: type,
          chapterId: chapterId ? Number(chapterId) : null,
          isInternal: internal,
        }),
      }),
    onSuccess: () => {
      setMessage("");
      void cache.invalidateQueries({ queryKey: ["research"] });
      toast({ title: "تم حفظ الرسالة" });
    },
    onError: (error) =>
      toast({
        title: "تعذر حفظ الرسالة",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  return (
    <Panel
      title="المراسلات وملاحظات المشرف"
      description="طلب التعديل المرتبط بفصل يظهر في حالة اعتماده."
    >
      <ol className="flex max-h-[520px] flex-col gap-3 overflow-auto">
        {messages.map((item) => (
          <li
            key={item.id}
            className="max-w-3xl rounded-lg border bg-muted/30 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <strong>{item.senderName}</strong>
              <span className="text-muted-foreground">
                {dateText(item.createdAt)}{" "}
                {item.isInternal ? "· رسالة داخلية" : "· مرئية للطالب"}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7">
              {item.message}
            </p>
            {item.chapterId && (
              <p className="mt-2 text-xs text-muted-foreground">
                الفصل:{" "}
                {chapters.find((chapter) => chapter.id === item.chapterId)
                  ?.title || item.chapterId}
              </p>
            )}
          </li>
        ))}
      </ol>
      {!messages.length && (
        <ResearchEmpty
          title="لا توجد مراسلات"
          description="يمكن تسجيل التعليمات وملاحظات المشرف وطلبات التعديل هنا."
        />
      )}
      {editable && (
        <FieldGroup className="mt-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Choice
              label="نوع الرسالة"
              value={type}
              options={{
                message: "رسالة للطالب",
                supervisor_feedback: "ملاحظات المشرف",
                revision_request: "طلب تعديل",
              }}
              onChange={setType}
            />
            <Choice
              label="الفصل المرتبط بالرسالة"
              value={chapterId}
              options={{
                "": "عام للبحث",
                ...Object.fromEntries(
                  chapters.map((chapter) => [
                    String(chapter.id),
                    chapter.title,
                  ]),
                ),
              }}
              onChange={setChapterId}
            />
          </div>
          <ResearchField label="نص الرسالة" name="research-message">
            <Textarea
              id="research-message"
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </ResearchField>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={internal}
              onCheckedChange={(checked) => setInternal(checked === true)}
            />
            ملاحظة داخلية للفريق فقط
          </label>
          <Button
            className="self-end"
            disabled={send.isPending || message.trim().length < 2}
            onClick={() => send.mutate()}
          >
            <Send data-icon="inline-start" />
            حفظ الرسالة
          </Button>
        </FieldGroup>
      )}
    </Panel>
  );
}

function ResearchReferences({
  order,
  sources,
  citations,
  editable,
}: {
  order: ResearchRecord;
  sources: ResearchRecord[];
  citations: ResearchRecord[];
  editable: boolean;
}) {
  const { toast } = useToast();
  const cache = useQueryClient();
  const generate = useMutation({
    mutationFn: () =>
      researchFetch(`/citations/${order.id}`, { method: "POST" }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["research"] });
      toast({ title: "تم توليد قائمة المراجع" });
    },
    onError: (error) =>
      toast({
        title: "تعذر توليد المراجع",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  return (
    <Panel
      title="المصادر والمراجع"
      action={
        editable && (
          <Button
            size="sm"
            variant="outline"
            disabled={!sources.length || generate.isPending}
            onClick={() => generate.mutate()}
          >
            توليد المراجع {order.citationStyle}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {sources.map((source) => (
          <article key={source.id} className="rounded-lg border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{source.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {source.authors?.join("، ")} ·{" "}
                  {source.publicationYear || "د.ت"}
                </p>
              </div>
              <Badge variant="outline">{source.provider}</Badge>
            </div>
            {source.doi && (
              <p className="mt-2 text-xs">
                <bdi>DOI: {source.doi}</bdi>
              </p>
            )}
            {source.url && (
              <Button variant="link" size="sm" asChild>
                <a href={source.url} target="_blank" rel="noreferrer">
                  فتح المصدر
                  <ExternalLink data-icon="inline-end" />
                </a>
              </Button>
            )}
          </article>
        ))}
      </div>
      {!sources.length && (
        <ResearchEmpty
          title="لا توجد مصادر مرتبطة"
          description="أضف مصادر موثقة من مكتبة المصادر."
        />
      )}
      {citations?.length > 0 && (
        <ol className="mt-6 list-inside list-decimal rounded-lg bg-muted p-4 text-sm leading-8">
          {citations.map((citation) => (
            <li key={citation.id}>{citation.bibliographyText}</li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
function ResearchPlagiarism({
  orderId,
  reports,
  editable,
}: {
  orderId: number;
  reports: ResearchRecord[];
  editable: boolean;
}) {
  const { toast } = useToast();
  const cache = useQueryClient();
  const [form, setForm] = useState({
    similarityPercentage: 0,
    provider: "Turnitin",
    reportUrl: "",
    notes: "",
  });
  const save = useMutation({
    mutationFn: () =>
      researchFetch("/plagiarism", {
        method: "POST",
        body: JSON.stringify({ orderId, ...form }),
      }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["research"] });
      toast({ title: "تم حفظ فحص الاستلال" });
    },
    onError: (error) =>
      toast({
        title: "تعذر حفظ الفحص",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  return (
    <Panel title="فحوص الاستلال">
      {editable && (
        <FieldGroup className="mb-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <ResearchField label="نسبة التشابه %" name="research-similarity">
              <Input
                id="research-similarity"
                type="number"
                min={0}
                max={100}
                value={form.similarityPercentage}
                onChange={(event) =>
                  setForm({
                    ...form,
                    similarityPercentage: Number(event.target.value),
                  })
                }
              />
            </ResearchField>
            <ResearchField
              label="مزود الفحص"
              name="research-plagiarism-provider"
            >
              <Input
                id="research-plagiarism-provider"
                value={form.provider}
                onChange={(event) =>
                  setForm({ ...form, provider: event.target.value })
                }
              />
            </ResearchField>
            <ResearchField
              label="رابط التقرير (اختياري)"
              name="research-plagiarism-url"
            >
              <Input
                id="research-plagiarism-url"
                type="url"
                value={form.reportUrl}
                onChange={(event) =>
                  setForm({ ...form, reportUrl: event.target.value })
                }
              />
            </ResearchField>
          </div>
          <Button
            className="self-end"
            disabled={
              save.isPending ||
              form.similarityPercentage < 0 ||
              form.similarityPercentage > 100
            }
            onClick={() => save.mutate()}
          >
            <ShieldCheck data-icon="inline-start" />
            حفظ الفحص
          </Button>
        </FieldGroup>
      )}
      <div className="flex flex-col gap-3">
        {reports.map((report) => (
          <div
            key={report.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div>
              <strong className="text-sm">
                {report.provider || "فحص يدوي"}
              </strong>
              <p className="text-xs text-muted-foreground">
                {dateText(report.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  Number(report.similarityPercentage) > 20
                    ? "destructive"
                    : "secondary"
                }
              >
                {report.similarityPercentage}%
              </Badge>
              {report.reportUrl && (
                <Button size="sm" variant="outline" asChild>
                  <a href={report.reportUrl} target="_blank" rel="noreferrer">
                    التقرير
                  </a>
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {!reports.length && (
        <ResearchEmpty
          title="لا توجد فحوص استلال"
          description="سجّل نتيجة فحص معتمدة وأرفق التقرير من تبويب الملفات."
        />
      )}
    </Panel>
  );
}
