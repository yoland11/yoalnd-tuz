import type { AdminMe } from "../_lib";

export function researchAccess(
  me: AdminMe | null | undefined,
  permission: string,
) {
  return Boolean(
    me?.isActive &&
    (me.role === "admin" ||
      me.permissions.includes("research") ||
      me.permissions.includes(permission)),
  );
}

export type ResearchFilters = {
  q?: string;
  category?: string;
  stage?: string;
  status?: string;
  from?: string;
  to?: string;
  staffId?: string;
  financialStatus?: string;
  page?: number;
  pageSize?: number;
};
export function researchFilterParams(filters: ResearchFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== "" && value !== "all")
      params.set(key, String(value));
  return params;
}

export function validateResearchForm(form: Record<string, any>) {
  const errors: Record<string, string> = {};
  if (String(form.title || "").trim().length < 5)
    errors.title = "عنوان البحث مطلوب (5 أحرف على الأقل)";
  if (!form.customerId && String(form.customerName || "").trim().length < 2)
    errors.customerName = "اسم الطالب مطلوب";
  if (
    !form.customerId &&
    String(form.phone || "").replace(/\D/g, "").length < 10
  )
    errors.phone = "رقم الهاتف غير مكتمل";
  if (String(form.universityName || "").trim().length < 2)
    errors.universityName = "اسم الجامعة مطلوب";
  if (!(Number(form.requiredPages) >= 1))
    errors.requiredPages = "عدد الصفحات يجب أن يكون 1 على الأقل";
  if (Number(form.estimatedPrice) < 0)
    errors.estimatedPrice = "السعر يجب ألا يكون سالباً";
  if (
    Number(form.deposit) < 0 ||
    Number(form.deposit) > Number(form.estimatedPrice)
  )
    errors.deposit = "العربون يجب ألا يتجاوز السعر";
  return errors;
}

export function researchPaymentPayload(
  payment: {
    amount: number;
    method: string;
    notes?: string;
    paymentDate?: string;
  },
  available: number,
  idempotencyKey: string,
) {
  if (!Number.isFinite(payment.amount) || payment.amount <= 0)
    throw new Error("أدخل مبلغاً موجباً");
  if (payment.amount > available)
    throw new Error("المبلغ يتجاوز المتاح للتحصيل بعد الطلبات المعلقة");
  return { ...payment, idempotencyKey };
}

export function researchOrderPayload(
  form: Record<string, any>,
  grants: { financial: boolean; assignable: boolean; receive: boolean },
  idempotencyKey: string,
  editing = false,
) {
  const fields = [
    "title",
    "titleEnglish",
    "academicLevel",
    "researchCategory",
    "researchType",
    "universityName",
    "college",
    "department",
    "supervisorName",
    "language",
    "researchField",
    "keywords",
    "citationStyle",
    "urgency",
    "notes",
  ];
  const result: Record<string, any> = Object.fromEntries(
    fields.map((key) => [key, form[key] ?? ""]),
  );
  for (const key of ["titleEnglish", "academicLevel", "researchCategory"])
    result[key] = result[key] || null;
  result.universityId = form.universityId ? Number(form.universityId) : null;
  result.requiredPages = Number(form.requiredPages);
  result.deadline = form.deadline || null;
  if (!editing)
    Object.assign(result, {
      customerId: form.customerId || undefined,
      customerName: form.customerName,
      phone: form.phone,
      idempotencyKey,
    });
  if (grants.assignable)
    result.assignedWriterId = form.assignedWriterId
      ? Number(form.assignedWriterId)
      : null;
  if (grants.financial)
    Object.assign(result, {
      estimatedPrice: Number(form.estimatedPrice || 0),
      paymentDueDate: form.paymentDueDate || null,
    });
  if (!editing && grants.financial && grants.receive)
    Object.assign(result, {
      deposit: Number(form.deposit || 0),
      initialPaymentMethod: form.initialPaymentMethod || "cash",
      initialPaymentDate: form.initialPaymentDate || undefined,
      initialPaymentNotes: form.initialPaymentNotes || "",
    });
  return result;
}

export function reminderPreview(order: Record<string, any>) {
  return `مرحباً ${order.customerName || "عزيزي الطالب"}، تذكير من قسم البحوث العلمية — مجموعة علي جان نهاد.\nالبحث: ${order.researchNo}\nالمبلغ المتبقي: ${Number(order.remainingAmount).toLocaleString("en-US")} د.ع\nموعد استحقاق الدفع: ${order.paymentDueDate || "لم يحدد موعد استحقاق"}.\nيرجى التواصل معنا لترتيب التسديد. شكراً لكم.`;
}

export function whatsappLink(phone: string, message: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `964${digits.slice(1)}`;
  return /^\d{10,15}$/.test(digits)
    ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
    : null;
}
