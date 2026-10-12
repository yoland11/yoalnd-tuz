import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, Loader2, Trash2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  SASH_ISSUE_LABELS,
  cleanStudentSashName,
  combineGroupSashName,
  isTitleOnlyPrefix,
  tidySashPrefix,
  type SashIssue,
} from "@/lib/graduation-sash-name";
import { formatCurrency } from "@/lib/money";
import { adminFetch, apiErrorMessage } from "./_lib";

export type SashReview = {
  prefix: string;
  title: string;
  prefixHasName: boolean;
  findings: Array<{
    orderId: number;
    customerName: string;
    current: string;
    storedPrefix: string;
    studentPart: string;
    suggestion: string;
    nameHint: string;
    issues: SashIssue[];
    editable: boolean;
  }>;
  duplicateRegistrations: Array<{
    key: string;
    reason: "same_name" | "same_phone_and_first_name";
    orders: Array<{ id: number; customerName: string; phoneTail: string; createdAt: string | null; paid: number }>;
  }>;
};

const ISSUE_TONE: Record<SashIssue, string> = {
  foreign_name: "border-destructive/40 bg-destructive/10 text-destructive",
  missing_name: "border-destructive/40 bg-destructive/10 text-destructive",
  repeated_name: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  repeated_title: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  outdated_title: "border-border bg-muted text-muted-foreground",
};

function dateLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

/**
 * «تدقيق أسماء الوشاح»: corrects the group title, the printed names that
 * picked up another person's name or lost the student's own, and lists the
 * students registered more than once. Every change is explicit and audited.
 */
export function GraduationSashReview({ groupId, review }: { groupId: number; review: SashReview }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const [title, setTitle] = useState(review.title || review.prefix);
  const [names, setNames] = useState<Record<number, string>>({});
  useEffect(() => setTitle(review.title || review.prefix), [review.title, review.prefix]);
  useEffect(() => setNames(Object.fromEntries(review.findings.map((finding) => [finding.orderId, finding.studentPart]))), [review.findings]);

  const refresh = () => client.invalidateQueries({ queryKey: ["admin", "graduation"] });
  const save = useMutation({
    mutationFn: (payload: { prefix?: string; items?: Array<{ orderId: number; studentName: string }> }) =>
      adminFetch<{ updated: number; prefix: string }>(`/admin/graduation/groups/${groupId}/sash-names`, {
        method: "POST",
        body: JSON.stringify({ confirm: true, items: [], ...payload }),
      }),
    onSuccess: (result, payload) => {
      refresh();
      toast({ title: payload.items?.length ? `تم تصحيح ${result.updated} اسم على الوشاح` : "تم اعتماد كنية الدفعة" });
    },
    onError: (error) => toast({ title: "لم يُحفظ التصحيح", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const archive = useMutation({
    mutationFn: (orderId: number) => adminFetch(`/admin/graduation/groups/${groupId}/students/${orderId}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); toast({ title: "تمت أرشفة التسجيل المكرر" }); },
    onError: (error) => toast({ title: "تعذرت الأرشفة", description: apiErrorMessage(error), variant: "destructive" }),
  });

  const cleanTitle = tidySashPrefix(title);
  const titleValid = !cleanTitle || isTitleOnlyPrefix(cleanTitle);
  const titleReady = !review.prefixHasName;
  const ready = useMemo(
    () => review.findings.filter((finding) => finding.editable && cleanStudentSashName(names[finding.orderId] ?? "", review.title)),
    [review.findings, review.title, names],
  );
  if (!review.findings.length && !review.duplicateRegistrations.length && !review.prefixHasName) return null;

  return (
    <section className="space-y-4 rounded-xl border border-destructive/30 bg-card p-4" dir="rtl" aria-labelledby="sash-review-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="sash-review-title" className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4 text-destructive" /> تدقيق أسماء الوشاح والتسجيلات المكررة</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {review.findings.length} اسم وشاح يحتاج مراجعة · {review.duplicateRegistrations.length} طالب مسجل أكثر من مرة. لا يتغير شيء بدون اعتمادك، وكل تصحيح يُسجَّل.
          </p>
        </div>
      </div>

      <div className={`rounded-lg border p-3 ${review.prefixHasName ? "border-destructive/40 bg-destructive/5" : "border-border"}`}>
        <div className="text-sm font-semibold">كنية الدفعة</div>
        {review.prefixHasName ? (
          <p className="mt-1 text-sm text-destructive">
            الكنية الحالية «{review.prefix}» تحتوي اسم شخص، فينطبع على وشاح كل طالب جديد. اعتمد لقباً فقط أولاً.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">الكنية الحالية: «{review.prefix || "بدون كنية"}». تُضاف قبل اسم كل طالب.</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input className="w-48" value={title} maxLength={40} onChange={(event) => setTitle(event.target.value)} placeholder="مثال: المهندس" aria-label="كنية الدفعة" />
          <Button
            size="sm"
            disabled={save.isPending || !titleValid || cleanTitle === review.prefix}
            onClick={() => confirm(`اعتماد الكنية «${cleanTitle || "بدون كنية"}» لهذه الدفعة؟ تُطبّق على التسجيلات الجديدة، وتصحيح الأسماء الحالية يتم من الجدول أدناه.`) && save.mutate({ prefix: cleanTitle })}
          >
            اعتماد الكنية
          </Button>
          {!titleValid ? <span className="text-xs text-destructive">لقب فقط مثل «المهندس» — بدون اسم</span> : null}
        </div>
      </div>

      {review.findings.length ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">أسماء الوشاح التي تحتاج تصحيح</h4>
            <Button
              size="sm"
              disabled={!titleReady || save.isPending || !ready.length}
              onClick={() => confirm(`تصحيح ${ready.length} اسم على الوشاح إلى «${review.title} + اسم الطالب»؟`) &&
                save.mutate({ items: ready.map((finding) => ({ orderId: finding.orderId, studentName: names[finding.orderId] ?? "" })) })}
            >
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              اعتماد كل التصحيحات ({ready.length})
            </Button>
          </div>
          {!titleReady ? <p className="text-xs text-destructive">اعتمد كنية صحيحة أولاً، ثم طبّق تصحيح الأسماء.</p> : null}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start">
                  <th>الطالب</th><th>المسجل حالياً على الوشاح</th><th>المشكلة</th><th>اسم الطالب على الوشاح</th><th>بعد التصحيح</th><th />
                </tr>
              </thead>
              <tbody>
                {review.findings.map((finding) => {
                  const value = names[finding.orderId] ?? "";
                  const cleaned = cleanStudentSashName(value, review.title);
                  return (
                    <tr key={finding.orderId} className="border-t align-middle [&>td]:px-3 [&>td]:py-2">
                      <td className="font-semibold">{finding.customerName}</td>
                      <td className="text-muted-foreground line-through decoration-destructive/60">{finding.current || "—"}</td>
                      <td><div className="flex flex-wrap gap-1">{finding.issues.map((issue) => <Badge key={issue} variant="outline" className={ISSUE_TONE[issue]}>{SASH_ISSUE_LABELS[issue]}</Badge>)}</div></td>
                      <td>
                        <div className="flex items-center gap-1">
                          <Input className="h-8 w-44" value={value} maxLength={80} disabled={!finding.editable} onChange={(event) => setNames((current) => ({ ...current, [finding.orderId]: event.target.value }))} aria-label={`اسم ${finding.customerName} على الوشاح`} />
                          {!cleaned && finding.editable ? (
                            <Button size="icon" variant="ghost" className="h-8 w-8" title="استخدم اسم الطالب" aria-label="استخدم اسم الطالب"
                              onClick={() => setNames((current) => ({ ...current, [finding.orderId]: cleanStudentSashName(finding.nameHint, review.title) }))}>
                              <Copy className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                      <td className="font-semibold">{finding.editable ? (cleaned ? combineGroupSashName(review.title, cleaned) : <span className="text-destructive">اكتب الاسم</span>) : <span className="text-xs text-muted-foreground">بدأت الطباعة/التطريز</span>}</td>
                      <td>
                        <Button size="sm" variant="outline" disabled={!titleReady || !finding.editable || !cleaned || save.isPending}
                          onClick={() => save.mutate({ items: [{ orderId: finding.orderId, studentName: value }] })}>
                          <CheckCircle2 className="h-4 w-4" /> تصحيح
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {review.duplicateRegistrations.length ? (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">طلاب مسجلون أكثر من مرة</h4>
          <p className="text-xs text-muted-foreground">احتفظ بتسجيل واحد لكل طالب وأرشف الباقي. التسجيل الذي عليه دفعات لا يُؤرشف من هنا.</p>
          <div className="grid gap-2 lg:grid-cols-2">
            {review.duplicateRegistrations.map((cluster) => (
              <div key={cluster.key} className="rounded-lg border border-status-warning/40 bg-status-warning/5 p-3">
                <div className="mb-2 text-xs text-muted-foreground">{cluster.reason === "same_name" ? "نفس الاسم" : "نفس الهاتف ونفس الاسم الأول"}</div>
                <ul className="space-y-2">
                  {cluster.orders.map((order, index) => (
                    <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>
                        <b>{order.customerName}</b>
                        <span className="text-xs text-muted-foreground"> · هاتف …{order.phoneTail || "—"} · {dateLabel(order.createdAt)}{order.paid > 0 ? ` · مدفوع ${formatCurrency(order.paid)}` : ""}</span>
                        {index === 0 ? <Badge variant="secondary" className="ms-2">الأقدم</Badge> : null}
                      </span>
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={archive.isPending || order.paid > 0}
                        title={order.paid > 0 ? "عليه دفعات — عالجها من المدفوعات" : "أرشفة هذا التسجيل"}
                        onClick={() => confirm(`أرشفة تسجيل «${order.customerName}» (…${order.phoneTail})؟ يبقى محفوظاً في الأرشيف.`) && archive.mutate(order.id)}>
                        <Trash2 className="h-4 w-4" /> أرشفة
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
