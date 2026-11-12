import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  MESSAGE_TEMPLATES,
  MESSAGE_FIELDS,
  type MessageRecipient,
  type MessageTemplateKey,
} from "@/lib/event-messaging";
import {
  followupDateTimeToIso,
  formatFollowupDate,
} from "@/lib/customer-followups";
import { adminFetch, apiErrorMessage } from "./_lib";

const BASE = "/admin/customer-followups/messaging";
const selectClass =
  "min-h-11 rounded-md border border-input bg-background px-3 text-sm w-full";
const labels: Record<string, string> = {
  pending: "بانتظار الموافقة",
  approved: "معتمدة",
  rejected: "مرفوضة",
  cancelled: "ملغاة",
  complete: "اكتملت المعالجة",
  suspended: "موقوفة — تحتاج مراجعة وإنشاء حملة جديدة",
  sending: "جارٍ الإرسال",
  accepted: "قبلها واتساب",
  sent: "أُرسلت",
  delivered: "وصلت",
  read: "قُرئت",
  failed: "فشل",
  unknown: "النتيجة غير مؤكدة",
  manual_opened: "فُتح واتساب يدوياً",
  blocked: "موقوفة",
};
export function MessageError({ error }: { error: unknown }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {apiErrorMessage(error)}
    </p>
  );
}
type Preview = {
  recipients: { recipient: MessageRecipient; message: string }[];
  duplicatesRemoved: number;
  previewHash: string;
};
export default function EventMessagingPanel() {
  const [creating, setCreating] = useState(false),
    [detail, setDetail] = useState<number | null>(null);
  const campaigns = useQuery({
    queryKey: ["event-campaigns"],
    queryFn: () =>
      adminFetch<{
        campaigns: any[];
        canApprove: boolean;
        canGraduation: boolean;
      }>(BASE),
    retry: false,
  });
  return (
    <section className="space-y-4" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">حملات واتساب</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            قائمة مراجعة واحدة، ورسالة خاصة لكل مستلم.
          </p>
        </div>
        <Button className="min-h-11 gap-2" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          إرسال واتساب جماعي
        </Button>
      </header>
      <div className="flex gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm">
        <ShieldCheck className="size-5 shrink-0 text-primary" />
        <p>
          كل حملة تحتاج اعتماد مدير. معلومات المجموعة تصل لممثلها فقط. فتح
          واتساب لا يثبت إرسال الرسالة أو وصولها.
        </p>
      </div>
      {campaigns.isError ? (
        <MessageError error={campaigns.error} />
      ) : campaigns.isPending ? (
        <p role="status">جارٍ تحميل الحملات…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-start text-sm">
            <thead className="bg-muted/40">
              <tr>
                {[
                  "الحملة",
                  "المستلمون",
                  "الطريقة",
                  "الموعد",
                  "الحالة",
                  "الإجراءات",
                ].map((h) => (
                  <th
                    key={h}
                    className="p-3 text-start font-medium whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.data.campaigns.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-3 font-medium">{c.title}</td>
                  <td className="p-3">{c.recipients}</td>
                  <td className="p-3 whitespace-nowrap">
                    {c.channel === "manual" ? "واتساب يدوي" : "Meta الرسمي"}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {formatFollowupDate(c.scheduled_at)}
                  </td>
                  <td className="p-3">
                    {labels[c.status] || c.status}
                    {c.issues > 0 ? (
                      <span className="block text-xs text-destructive">
                        {c.issues} تحتاج مراجعة
                      </span>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <Button
                      variant="outline"
                      className="min-h-10"
                      onClick={() => setDetail(c.id)}
                    >
                      المعاينة والسجل
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!campaigns.data.campaigns.length ? (
            <p className="p-10 text-center text-muted-foreground">
              لا توجد حملات. ابدأ باختيار المستلمين ومعاينة الرسائل.
            </p>
          ) : null}
        </div>
      )}
      {creating ? (
        <CampaignComposer
          canApprove={campaigns.data?.canApprove === true}
          canGraduation={campaigns.data?.canGraduation === true}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            setDetail(id);
            void campaigns.refetch();
          }}
        />
      ) : null}
      {detail ? (
        <CampaignDetails
          id={detail}
          canApprove={campaigns.data?.canApprove === true}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </section>
  );
}

function CampaignComposer({
  canApprove,
  canGraduation,
  onClose,
  onSaved,
}: {
  canApprove: boolean;
  canGraduation: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const [title, setTitle] = useState(""),
    [kind, setKind] = useState("customer"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, MessageRecipient>>(
      {},
    ),
    [templateKey, setTemplate] = useState<MessageTemplateKey>("event_details"),
    [channel, setChannel] = useState("manual"),
    [schedule, setSchedule] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null),
    [active, setActive] = useState(0),
    [providerName, setProviderName] = useState(""),
    [providerFields, setProviderFields] = useState<string[]>([]),
    [consenting, setConsenting] = useState<MessageRecipient | null>(null);
  const token = useRef(crypto.randomUUID());
  const recipients = useQuery({
    queryKey: ["event-recipients", kind, search, filter, page],
    queryFn: () =>
      adminFetch<{
        recipients: MessageRecipient[];
        invalid: { key: string; reason: string }[];
        hasMore: boolean;
      }>(
        `${BASE}/recipients?${new URLSearchParams({ kind, q: search, filter, page: String(page) })}`,
      ),
    retry: false,
  });
  const provider = useQuery({
    queryKey: ["event-provider-templates"],
    queryFn: () =>
      adminFetch<{ providerTemplates: any[] }>(
        `${BASE}/templates?provider=meta`,
      ),
    enabled: channel === "meta",
    retry: false,
  });
  const chosen = provider.data?.providerTemplates.find(
    (t) => `${t.name}:${t.language}` === providerName,
  );
  const body = () => ({
    title,
    channel,
    templateKey,
    recipientKeys: Object.keys(selected),
    scheduledAt: schedule ? followupDateTimeToIso(schedule) : null,
    providerTemplate: chosen
      ? {
          name: chosen.name,
          language: chosen.language,
          fields: providerFields.filter(Boolean),
        }
      : null,
  });
  const mutate = useMutation({
    mutationFn: ({ path, data }: { path: string; data: any }) =>
      adminFetch<any>(`${BASE}${path}`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (result, args) => {
      if (args.path === "/preview") {
        setPreview(result);
        setActive(0);
      } else onSaved(result.campaignId);
    },
  });
  function reset() {
    setPreview(null);
    mutate.reset();
    token.current = crypto.randomUUID();
  }
  const count = Object.keys(selected).length;
  const item = preview?.recipients[active];
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !mutate.isPending) onClose();
      }}
    >
      <DialogContent
        dir="rtl"
        className="ajn-event-dialog w-[min(calc(100%-2rem),64rem)] max-w-5xl max-h-[92dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>إرسال واتساب جماعي</DialogTitle>
          <DialogDescription>
            اختر السجلات الأصلية، راجع الرسائل، ثم أرسل الحملة لاعتماد المدير.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
          <div className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                عنوان الحملة
                <Input
                  value={title}
                  maxLength={200}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    reset();
                  }}
                  placeholder="مثال: مواعيد تصوير دفعة الهندسة"
                />
              </label>
              <label className="space-y-1 text-sm">
                مصدر المستلمين
                <select
                  className={selectClass}
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="customer">العملاء والمناسبات</option>
                  {canGraduation ? (
                    <>
                      <option value="group">ممثلو مجموعات التخرج</option>
                      <option value="graduation">
                        طلبات التخرج الفردية والجماعية
                      </option>
                    </>
                  ) : null}
                </select>
              </label>
            </div>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute right-3 top-3 size-4 text-muted-foreground" />
                <Input
                  className="pr-9"
                  aria-label="البحث عن مستلم"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="الاسم، الهاتف، اسم المجموعة…"
                />
              </div>
              <select
                aria-label="تصفية المستلمين"
                className={`${selectClass} max-w-44`}
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">كل السجلات</option>
                <option value="pending">عليهم متبقٍ</option>
                <option value="upcoming">مناسبات قادمة</option>
                <option value="incomplete">طلبات غير مكتملة</option>
                {["خطوبة", "حنة", "زفاف", "عقد قران", "تخرج"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="rounded-xl border">
              <div className="flex items-center justify-between border-b p-3 text-sm">
                <span>
                  المحدد: <b>{count}</b> / 100
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelected({});
                    reset();
                  }}
                >
                  إلغاء التحديد
                </Button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {recipients.isError ? (
                  <MessageError error={recipients.error} />
                ) : recipients.isPending ? (
                  <p className="p-4" role="status">
                    جارٍ البحث…
                  </p>
                ) : recipients.data.recipients.length ? (
                  recipients.data.recipients.map((r) => (
                    <div
                      key={r.key}
                      className="flex items-start gap-3 border-b p-3 last:border-0"
                    >
                      <input
                        aria-label={`اختيار ${r.name}`}
                        type="checkbox"
                        className="mt-1 size-5 accent-[var(--primary)]"
                        checked={Boolean(selected[r.key])}
                        disabled={
                          r.blocked || (!selected[r.key] && count >= 100)
                        }
                        onChange={(e) => {
                          setSelected((current) => {
                            const next = { ...current };
                            if (e.target.checked) next[r.key] = r;
                            else delete next[r.key];
                            return next;
                          });
                          reset();
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm">{r.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.details.group || r.details.reference || r.category}
                        </p>
                        <bdi className="block text-xs" dir="ltr">
                          {r.phone}
                        </bdi>
                        <span
                          className={`text-xs ${r.blocked ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {r.blocked
                            ? "أوقف التواصل"
                            : r.consent
                              ? "موافقة موثقة"
                              : "موافقة API غير موثقة"}
                        </span>
                      </div>
                      {canApprove ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={() => setConsenting(r)}
                        >
                          الموافقة
                        </Button>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="p-5 text-sm text-muted-foreground">
                    لا توجد نتائج ضمن هذه الصفحة والمرشحات.
                  </p>
                )}
              </div>
              {recipients.data?.invalid.length ? (
                <p role="status" className="p-3 text-xs text-destructive">
                  {recipients.data.invalid.length} سجل بأرقام غير صالحة، لا يمكن
                  اختيارها.
                </p>
              ) : null}
              <div className="flex items-center justify-between border-t p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronRight className="size-4" />
                  السابق
                </Button>
                <span className="text-xs">صفحة {page}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!recipients.data?.hasMore}
                  onClick={() => setPage(page + 1)}
                >
                  التالي
                  <ChevronLeft className="size-4" />
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                قالب الرسالة
                <select
                  className={selectClass}
                  value={templateKey}
                  onChange={(e) => {
                    setTemplate(e.target.value as MessageTemplateKey);
                    reset();
                  }}
                >
                  {MESSAGE_TEMPLATES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                طريقة الإرسال
                <select
                  className={selectClass}
                  value={channel}
                  onChange={(e) => {
                    setChannel(e.target.value);
                    reset();
                  }}
                >
                  <option value="manual">فتح واتساب يدوياً</option>
                  <option value="meta">WhatsApp Business API الرسمي</option>
                </select>
              </label>
            </div>
            {channel === "meta" ? (
              <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
                {provider.isError ? (
                  <MessageError error={provider.error} />
                ) : (
                  <label className="block space-y-1 text-sm">
                    قالب Meta المعتمد
                    <select
                      className={selectClass}
                      value={providerName}
                      onChange={(e) => {
                        setProviderName(e.target.value);
                        setProviderFields([]);
                        reset();
                      }}
                    >
                      <option value="">اختر قالباً نصياً معتمداً</option>
                      {provider.data?.providerTemplates.map((t) => (
                        <option
                          key={`${t.name}:${t.language}`}
                          value={`${t.name}:${t.language}`}
                        >
                          {t.name} · {t.language}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {chosen ? (
                  <>
                    <p className="whitespace-pre-wrap text-xs">
                      {
                        chosen.components.find((c: any) => c.type === "BODY")
                          ?.text
                      }
                    </p>
                    <label className="block space-y-1 text-sm">
                      حقول المتغيرات بالترتيب، مفصولة بفاصلة
                      <Input
                        dir="ltr"
                        placeholder="name,reference,date"
                        value={providerFields.join(",")}
                        onChange={(e) => {
                          setProviderFields(
                            e.target.value.split(",").map((v) => v.trim()),
                          );
                          reset();
                        }}
                      />
                    </label>
                    <p className="text-xs text-muted-foreground break-words">
                      الحقول المتاحة: {MESSAGE_FIELDS.join(", ")}
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
            <label className="block space-y-1 text-sm">
              موعد الإرسال (اختياري، توقيت بغداد)
              <Input
                nativePicker
                type="datetime-local"
                value={schedule}
                onChange={(e) => {
                  setSchedule(e.target.value);
                  reset();
                }}
              />
            </label>
            <p className="flex gap-2 text-xs text-muted-foreground">
              <CalendarClock className="size-4 shrink-0" />
              الحملات الرسمية المجدولة تُعالج في دورة التذكير اليومية التالية،
              أو بمعالجة المدير عند حلول الموعد. اليدوي يبقى بيد الموظف.
            </p>
          </div>
          <div className="min-w-0 rounded-xl bg-muted/25 p-4 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold flex gap-2 items-center">
                <MessageCircle className="size-5 text-primary" />
                معاينة واتساب
              </h3>
              <span className="text-xs text-muted-foreground">
                {preview?.recipients.length ?? count} مستلم
              </span>
            </div>
            {preview ? (
              <>
                <label className="block text-sm">
                  معاينة رسالة
                  <select
                    className={`${selectClass} mt-2`}
                    value={active}
                    onChange={(e) => setActive(Number(e.target.value))}
                  >
                    {preview.recipients.map((r, i) => (
                      <option key={r.recipient.key} value={i}>
                        {r.recipient.name} · {r.recipient.phone}
                      </option>
                    ))}
                  </select>
                </label>
                {item ? (
                  <>
                    <div
                      className="rounded-xl rounded-tr-none border border-emerald-200 bg-emerald-50 p-4 text-sm leading-7 whitespace-pre-wrap text-zinc-900"
                      data-message-preview
                    >
                      {item.message}
                    </div>
                    <dl className="space-y-2 text-xs">
                      {Object.entries(item.recipient.details)
                        .filter(([, v]) => v)
                        .map(([key, value]) => (
                          <div
                            key={key}
                            className="flex justify-between gap-4 border-b pb-2"
                          >
                            <dt className="text-muted-foreground">
                              {{
                                group: "المجموعة",
                                university: "الجامعة",
                                department: "القسم",
                                students: "الطلبة",
                                date: "التاريخ",
                                photographyDate: "موعد التصوير المؤكد",
                                deliveryDate: "موعد تسليم التجهيزات",
                                services: "الخدمات والتجهيزات",
                                reference: "رقم الحجز/الطلب",
                                status: "الحالة",
                                remaining: "المتبقي د.ع",
                                paymentStatus: "الدفع",
                                production: "التجهيز",
                              }[key] || key}
                            </dt>
                            <dd className="text-end break-words">{value}</dd>
                          </div>
                        ))}
                    </dl>
                  </>
                ) : null}
                {preview.duplicatesRemoved ? (
                  <p className="text-xs">
                    أُزيل {preview.duplicatesRemoved} رقم مكرر.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="py-20 text-center text-sm text-muted-foreground">
                اختر المستلمين والقالب ثم اضغط «معاينة الرسائل».
              </p>
            )}
          </div>
        </div>
        {mutate.isError ? <MessageError error={mutate.error} /> : null}
        <footer className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button
            variant="outline"
            disabled={mutate.isPending}
            onClick={onClose}
          >
            إلغاء
          </Button>
          <Button
            variant="outline"
            disabled={!count || mutate.isPending}
            onClick={() => mutate.mutate({ path: "/preview", data: body() })}
          >
            معاينة الرسائل
          </Button>
          <Button
            disabled={!preview || !title.trim() || mutate.isPending}
            onClick={() =>
              mutate.mutate({
                path: "",
                data: {
                  ...body(),
                  previewHash: preview?.previewHash,
                  idempotencyKey: token.current,
                },
              })
            }
          >
            {mutate.isPending ? "جارٍ الحفظ…" : "حفظ وإرسال للموافقة"}
          </Button>
        </footer>
        {consenting ? (
          <ConsentDialog
            recipient={consenting}
            onClose={() => setConsenting(null)}
            onSaved={() => {
              setConsenting(null);
              reset();
              void recipients.refetch();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConsentDialog({
  recipient,
  onClose,
  onSaved,
}: {
  recipient: MessageRecipient;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [evidence, setEvidence] = useState(""),
    [state, setState] = useState(
      recipient.blocked ? "blocked" : recipient.consent ? "opted" : "none",
    );
  const mutation = useMutation({
    mutationFn: () =>
      adminFetch(`${BASE}/consent`, {
        method: "POST",
        body: JSON.stringify({
          recipientKey: recipient.key,
          evidence,
          optedIn: state === "opted",
          blocked: state === "blocked",
        }),
      }),
    onSuccess: onSaved,
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !mutation.isPending) onClose();
      }}
    >
      <DialogContent dir="rtl" className="ajn-event-dialog">
        <DialogHeader>
          <DialogTitle>موافقة المستلم — {recipient.name}</DialogTitle>
          <DialogDescription>
            سجّل الموافقة الفعلية ومصدرها. تغيير رقم المستلم يتطلب موافقة جديدة.
          </DialogDescription>
        </DialogHeader>
        <bdi dir="ltr">{recipient.phone}</bdi>
        <label className="text-sm space-y-1">
          حالة التواصل
          <select
            className={selectClass}
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="none">لا توجد موافقة للإرسال الرسمي</option>
            <option value="opted">وافق على رسائل واتساب</option>
            <option value="blocked">طلب إيقاف التواصل</option>
          </select>
        </label>
        <label className="text-sm space-y-1">
          دليل الموافقة أو سبب التغيير
          <Input
            value={evidence}
            maxLength={1000}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="المصدر والتاريخ أو مرجع طلب الإيقاف"
          />
        </label>
        {mutation.isError ? <MessageError error={mutation.error} /> : null}
        <Button
          disabled={!evidence.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          حفظ حالة الموافقة
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function CampaignDetails({
  id,
  canApprove,
  onClose,
}: {
  id: number;
  canApprove: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient(),
    [active, setActive] = useState(0);
  const query = useQuery({
    queryKey: ["event-campaign", id],
    queryFn: () =>
      adminFetch<{ campaign: any; recipients: any[]; history: any[] }>(
        `${BASE}/${id}`,
      ),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: ({
      action,
      recipientId,
    }: {
      action: string;
      recipientId?: number;
    }) =>
      adminFetch<any>(`${BASE}/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ recipientId }),
      }),
    onSuccess: (result) => {
      if (result.href)
        window.open(result.href, "_blank", "noopener,noreferrer");
      void query.refetch();
      void client.invalidateQueries({ queryKey: ["event-campaigns"] });
    },
  });
  const data = query.data,
    r = data?.recipients[active];
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !mutation.isPending) onClose();
      }}
    >
      <DialogContent
        dir="rtl"
        className="ajn-event-dialog w-[min(calc(100%-2rem),56rem)] max-w-4xl max-h-[92dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            {data?.campaign.title || "معاينة الحملة وسجلها"}
          </DialogTitle>
          <DialogDescription>
            راجع كل رسالة قبل الاعتماد. إعادة فتح النافذة لا تعيد إرسال الرسائل.
          </DialogDescription>
        </DialogHeader>
        {query.isError ? (
          <MessageError error={query.error} />
        ) : data ? (
          <>
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span>
                {labels[data.campaign.status]} · {data.recipients.length} مستلم
              </span>
              <span>{formatFollowupDate(data.campaign.scheduled_at)}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_1.1fr]">
              <div className="max-h-80 overflow-y-auto rounded-lg border">
                {data.recipients.map((item, i) => (
                  <button
                    key={item.id}
                    className={`w-full border-b p-3 text-start text-sm last:border-0 ${active === i ? "bg-primary/5" : ""}`}
                    onClick={() => setActive(i)}
                  >
                    <span className="block font-medium">
                      {item.snapshot.name}
                    </span>
                    <bdi dir="ltr" className="text-xs">
                      {item.phone}
                    </bdi>
                    <span className="block text-xs text-muted-foreground">
                      {labels[item.status] || item.status}
                    </span>
                    {item.error_code ? (
                      <span className="text-xs text-destructive">
                        {item.error_code}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
              <div className="space-y-3">
                {r ? (
                  <>
                    <p className="rounded-xl border bg-emerald-50 text-zinc-900 p-4 text-sm whitespace-pre-wrap leading-7">
                      {r.message}
                    </p>
                    {data.campaign.channel === "manual" &&
                    data.campaign.status === "approved" ? (
                      <Button
                        className="min-h-11 w-full gap-2"
                        disabled={
                          r.status !== "pending" ||
                          mutation.isPending ||
                          new Date(data.campaign.scheduled_at).getTime() >
                            Date.now()
                        }
                        onClick={() =>
                          mutation.mutate({
                            action: "manual-open",
                            recipientId: r.id,
                          })
                        }
                      >
                        <MessageCircle className="size-4" />
                        {r.status === "manual_opened"
                          ? "سبق فتح الرسالة"
                          : "فتح رسالة هذا المستلم في واتساب"}
                      </Button>
                    ) : null}
                    {mutation.data?.href ? (
                      <a
                        className="block text-sm underline"
                        target="_blank"
                        rel="noreferrer"
                        href={mutation.data.href}
                      >
                        اضغط هنا إذا منع المتصفح فتح واتساب
                      </a>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
            {canApprove && data.campaign.status === "pending" ? (
              <div className="rounded-xl border border-primary/20 p-4 space-y-3">
                <p className="text-sm">
                  بالاعتماد تؤكد مراجعة {data.recipients.length} رسالة
                  والمستلمين وموعد الإرسال أعلاه.
                </p>
                <div className="flex gap-2">
                  <Button
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ action: "approve" })}
                  >
                    <Check className="size-4 ml-2" />
                    اعتماد الحملة
                  </Button>
                  <Button
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ action: "reject" })}
                  >
                    رفض
                  </Button>
                </div>
              </div>
            ) : null}
            {canApprove &&
            data.campaign.status === "approved" &&
            data.campaign.channel === "meta" ? (
              <Button
                disabled={
                  mutation.isPending ||
                  new Date(data.campaign.scheduled_at).getTime() > Date.now()
                }
                onClick={() => mutation.mutate({ action: "dispatch" })}
              >
                إرسال الحملة عبر Meta (حتى 100 رسالة)
              </Button>
            ) : null}
            <details className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                سجل المعالجة والتسليم
              </summary>
              <ol className="mt-3 space-y-3">
                {data.history.map((h, i) => (
                  <li key={i} className="border-b pb-2">
                    <span>{h.action}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatFollowupDate(h.created_at)}
                      {h.actor_id ? ` · موظف ${h.actor_id}` : " · تحديث المزود"}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          </>
        ) : (
          <p role="status">جارٍ التحميل…</p>
        )}
        {mutation.isError ? <MessageError error={mutation.error} /> : null}
      </DialogContent>
    </Dialog>
  );
}
