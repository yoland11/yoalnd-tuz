import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldGroup } from "@/components/ui/field";
import { EmployeeSelect } from "@/components/employee-select";
import { ACADEMIC_LEVELS, RESEARCH_CATEGORIES } from "@/lib/research-contract";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "../_lib";
import { SmartCustomerSearch } from "../smart-customer-search";
import { researchOrderPayload, validateResearchForm } from "./ui-model";
import {
  Choice,
  Panel,
  researchFetch,
  ResearchFailure,
  ResearchField,
  RESEARCH_TYPES,
  type ResearchRecord,
} from "./shared";

const initialOrder = {
  customerId: null as number | null,
  customerName: "",
  phone: "",
  title: "",
  titleEnglish: "",
  academicLevel: "",
  researchCategory: "",
  researchType: "graduation",
  universityId: "",
  universityName: "",
  college: "",
  department: "",
  supervisorName: "",
  language: "ar",
  researchField: "",
  keywords: "",
  requiredPages: 30,
  deadline: "",
  paymentDueDate: "",
  assignedWriterId: "",
  citationStyle: "APA7",
  urgency: "normal",
  estimatedPrice: 0,
  deposit: 0,
  initialPaymentMethod: "cash",
  initialPaymentDate: "",
  initialPaymentNotes: "",
  notes: "",
};

export function ResearchOrderForm({
  financial,
  assignable,
  receive = false,
  existing,
  onSaved,
  onCancel,
}: {
  financial: boolean;
  assignable: boolean;
  receive?: boolean;
  existing?: ResearchRecord;
  onSaved: (id: number) => void;
  onCancel?: () => void;
}) {
  const { toast } = useToast();
  const cache = useQueryClient();
  const [form, setForm] = useState<ResearchRecord>(() => ({
    ...initialOrder,
    ...existing,
    phone: existing?.customerPhone || existing?.phone || "",
    universityId: existing?.universityId ? String(existing.universityId) : "",
    assignedWriterId: existing?.assignedWriterId
      ? String(existing.assignedWriterId)
      : "",
    deadline: existing?.deadline?.slice(0, 10) || "",
    paymentDueDate: existing?.paymentDueDate?.slice(0, 10) || "",
    keywords: Array.isArray(existing?.keywords)
      ? existing.keywords.join(", ")
      : existing?.keywords || "",
  }));
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const catalog = useQuery<ResearchRecord>({
    queryKey: ["research", "catalog"],
    queryFn: () => researchFetch("/catalog"),
  });
  function update(key: string, value: unknown) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  }
  const save = useMutation({
    mutationFn: () => {
      const payload = researchOrderPayload(
        form,
        { financial, assignable, receive },
        idempotencyKey,
        Boolean(existing),
      );
      return researchFetch<ResearchRecord>(
        existing ? `/orders/${existing.id}` : "/orders",
        { method: existing ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
    },
    onSuccess: (result) => {
      void cache.invalidateQueries({ queryKey: ["research"] });
      toast({
        title: existing ? "تم حفظ بيانات البحث" : "تم إنشاء طلب البحث",
        description: result.order?.researchNo,
      });
      onSaved(result.order?.id || existing?.id);
    },
    onError: (error: any) => {
      setFieldErrors(error?.data?.fieldErrors || {});
      toast({
        title: "تعذر حفظ البحث",
        description: apiErrorMessage(error),
        variant: "destructive",
      });
    },
  });
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const errors = validateResearchForm(form);
    setFieldErrors(errors);
    if (!Object.keys(errors).length) save.mutate();
  }
  const input = (
    key: string,
    label: string,
    type = "text",
    extra: Record<string, any> = {},
  ) => (
    <ResearchField
      name={`research-${key}`}
      label={label}
      error={fieldErrors[key]}
    >
      <Input
        id={`research-${key}`}
        type={type}
        value={form[key] ?? ""}
        aria-invalid={Boolean(fieldErrors[key])}
        onChange={(event) =>
          update(
            key,
            type === "number" ? Number(event.target.value) : event.target.value,
          )
        }
        {...extra}
      />
    </ResearchField>
  );
  const choice = (
    key: string,
    label: string,
    options: Record<string, string>,
  ) => (
    <ResearchField
      name={`research-${key}`}
      label={label}
      error={fieldErrors[key]}
    >
      <Choice
        label={label}
        value={String(form[key] || "")}
        onChange={(value) => update(key, value)}
        options={options}
      />
    </ResearchField>
  );
  return (
    <form onSubmit={submit} className="mx-auto flex max-w-6xl flex-col gap-5">
      <Panel
        title={existing ? "تعديل بيانات البحث" : "طلب بحث جديد"}
        description="بيانات الطالب والبحث والتكليف. يمكن رفع الملفات بعد حفظ الطلب."
      >
        <FieldGroup className="grid gap-5 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <ResearchField name="research-customer" label="ابحث عن طالب مسجل">
              <SmartCustomerSearch
                showFinancial={false}
                allowCreate={false}
                onSelect={(customer) => {
                  setForm((current) => ({
                    ...current,
                    customerId: customer.id,
                    customerName: customer.name,
                    phone: customer.phone,
                  }));
                }}
              />
            </ResearchField>
            {form.customerId && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/5 p-3 text-sm">
                <span className="flex items-center gap-2">
                  <UserRoundCheck className="size-4" />
                  {form.customerName} · <bdi>{form.phone}</bdi>
                </span>
                {!existing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        customerId: null,
                        customerName: "",
                        phone: "",
                      }))
                    }
                  >
                    تغيير الطالب
                  </Button>
                )}
              </div>
            )}
          </div>
          {input("customerName", "اسم الطالب", "text", {
            readOnly: Boolean(form.customerId),
            required: true,
          })}
          {input("phone", "رقم الهاتف", "tel", {
            readOnly: Boolean(form.customerId),
            required: true,
            dir: "ltr",
          })}
          {input("title", "عنوان البحث بالعربية", "text", {
            required: true,
            minLength: 5,
          })}
          {input("titleEnglish", "عنوان البحث بالإنجليزية", "text", {
            dir: "ltr",
          })}
          {choice("academicLevel", "المستوى الدراسي", {
            "": "غير محدد",
            ...ACADEMIC_LEVELS,
          })}
          {choice("researchCategory", "تصنيف البحث", {
            "": "غير مصنف",
            ...RESEARCH_CATEGORIES,
          })}
          {choice("researchType", "نوع البحث الأكاديمي", RESEARCH_TYPES)}
          {choice("language", "لغة البحث", {
            ar: "العربية",
            en: "الإنجليزية",
            ku: "الكردية",
            other: "أخرى",
          })}
          {catalog.isError ? (
            <div className="lg:col-span-2">
              <ResearchFailure
                error={catalog.error}
                retry={() => void catalog.refetch()}
              />
            </div>
          ) : (
            <ResearchField name="research-university" label="الجامعة من الدليل">
              <Choice
                label="الجامعة من الدليل"
                value={form.universityId}
                options={{
                  "": "إدخال اسم الجامعة يدوياً",
                  ...Object.fromEntries(
                    (catalog.data?.universities || []).map(
                      (university: any) => [
                        String(university.id),
                        university.nameAr,
                      ],
                    ),
                  ),
                }}
                disabled={catalog.isPending}
                onChange={(value) => {
                  update("universityId", value);
                  const found = catalog.data?.universities.find(
                    (row: any) => String(row.id) === value,
                  );
                  if (found) update("universityName", found.nameAr);
                }}
              />
            </ResearchField>
          )}
          {input("universityName", "اسم الجامعة", "text", { required: true })}
          {input("college", "الكلية")}
          {input("department", "القسم / التخصص")}
          {input("supervisorName", "المشرف الأكاديمي")}
          {input("researchField", "المجال العلمي")}
          {input("keywords", "الكلمات المفتاحية")}
          {input("requiredPages", "عدد الصفحات المطلوبة", "number", {
            min: 1,
            required: true,
          })}
          {input("deadline", "موعد تسليم البحث", "date")}
          {choice("citationStyle", "نمط التوثيق", {
            APA7: "APA 7",
            IEEE: "IEEE",
            MLA: "MLA",
            Harvard: "Harvard",
            Chicago: "Chicago",
          })}
          {choice("urgency", "الأولوية", {
            normal: "اعتيادي",
            urgent: "مستعجل",
            critical: "عاجل جداً",
          })}
          {assignable && (
            <ResearchField name="research-assignee" label="الموظف المسؤول">
              <EmployeeSelect
                employees={catalog.data?.writers || []}
                value={String(form.assignedWriterId || "")}
                onValueChange={(value) => update("assignedWriterId", value)}
                disabled={catalog.isPending || catalog.isError}
                emptyLabel="بدون تعيين"
              />
            </ResearchField>
          )}
        </FieldGroup>
      </Panel>
      {financial && (
        <Panel
          title="الاتفاق المالي"
          description="موعد استحقاق الدفع مستقل عن موعد تسليم البحث. أي دفعة تخضع للموافقة المركزية."
        >
          <FieldGroup className="grid gap-5 sm:grid-cols-3">
            {input("estimatedPrice", "قيمة البحث المتفق عليها", "number", {
              min: 0,
            })}
            {input("paymentDueDate", "موعد استحقاق الدفع", "date")}
            {!existing &&
              receive &&
              input("deposit", "طلب دفعة أولى", "number", {
                min: 0,
                max: Number(form.estimatedPrice),
              })}
            {!existing && receive && Number(form.deposit) > 0 && (
              <>
                {choice("initialPaymentMethod", "طريقة الدفعة الأولى", {
                  cash: "نقداً",
                  transfer: "تحويل",
                  card: "بطاقة",
                  pos: "جهاز دفع",
                  other: "أخرى",
                })}
                {input("initialPaymentDate", "تاريخ الدفعة الأولى", "date")}
                {input("initialPaymentNotes", "ملاحظات الدفعة الأولى")}
              </>
            )}
          </FieldGroup>
        </Panel>
      )}
      <Panel title="متطلبات وملاحظات">
        <ResearchField name="research-notes" label="تعليمات البحث">
          <Textarea
            id="research-notes"
            value={form.notes || ""}
            onChange={(event) => update("notes", event.target.value)}
            rows={4}
          />
        </ResearchField>
      </Panel>
      {Object.values(fieldErrors).some(Boolean) && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
        >
          <p className="font-semibold">راجع البيانات التالية:</p>
          <ul className="mt-2 list-inside list-disc">
            {Object.entries(fieldErrors)
              .filter(([, value]) => value)
              .map(([key, message]) => (
                <li key={key}>{message}</li>
              ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-3">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            إلغاء
          </Button>
        )}
        <Button type="submit" disabled={save.isPending || catalog.isPending}>
          {save.isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <Save data-icon="inline-start" />
          )}
          {existing ? "حفظ التعديلات" : "إنشاء طلب البحث"}
        </Button>
      </div>
    </form>
  );
}
