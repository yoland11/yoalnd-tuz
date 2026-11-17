export class ResearchFinanceError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 409 = 409, public code = "RESEARCH_FINANCE_CONFLICT") {
    super(message);
    this.name = "ResearchFinanceError";
  }
}

export function requireResearchFinance(user: { isActive: boolean; role: string; permissions: string[] }, permission = "research.financials.view") {
  if (!user.isActive || !(user.role === "admin" || user.permissions.includes("research") || user.permissions.includes(permission)))
    throw new ResearchFinanceError("لا تملك صلاحية العمليات المالية للبحوث", 403, "FORBIDDEN");
}

export function researchStatementDay(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ResearchFinanceError("تاريخ حركة كشف الحساب غير صالح", 409, "INVALID_STATEMENT_DATE");
  return researchDate(date);
}

/** Parse exact decimal cents; never round a submitted amount into a payment. */
export function researchMoney(value: unknown): number {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new ResearchFinanceError("مبلغ غير صالح؛ استخدم منزلتين عشريتين كحد أقصى", 400, "INVALID_AMOUNT");
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 99_999_999_999_900) throw new ResearchFinanceError("مبلغ خارج النطاق المسموح", 400, "INVALID_AMOUNT");
  return cents;
}

export function assertResearchCollection(input: { amount: unknown; remaining: unknown; pending: unknown; ownPending?: unknown }): number {
  const amount = researchMoney(input.amount);
  const remaining = researchMoney(input.remaining);
  const pending = researchMoney(input.pending);
  const own = researchMoney(input.ownPending ?? 0);
  if (amount <= 0) throw new ResearchFinanceError("مبلغ الدفعة يجب أن يكون أكبر من صفر", 400, "INVALID_AMOUNT");
  if (amount > Math.max(remaining - Math.max(pending - own, 0), 0))
    throw new ResearchFinanceError("مبلغ الدفعة أكبر من المتبقي المتاح بعد الطلبات المعلقة", 409, "PAYMENT_EXCEEDS_OUTSTANDING");
  return amount;
}

export type ResearchRetryPayload = { amount: unknown; method: string; date: string; notes?: string | null; accountId?: number | null };
export function assertResearchRetry(existing: ResearchRetryPayload, incoming: ResearchRetryPayload, status: string): true {
  if (researchMoney(existing.amount) !== researchMoney(incoming.amount) || existing.method !== incoming.method || existing.date !== incoming.date || (existing.notes ?? "") !== (incoming.notes ?? "") || (existing.accountId ?? null) !== (incoming.accountId ?? null))
    throw new ResearchFinanceError("مفتاح التكرار مرتبط بطلب ذي بيانات مختلفة", 409, "IDEMPOTENCY_CONFLICT");
  if (status !== "pending" && status !== "executed")
    throw new ResearchFinanceError("الطلب المالي مرفوض؛ أرسل طلباً جديداً بمفتاح جديد", 409, "PAYMENT_REQUEST_REJECTED");
  return true;
}
import { researchDate } from "../lib/research-contract";
