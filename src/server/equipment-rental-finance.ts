import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { financialTransactionsTable, type db } from "@workspace/db";
import { EquipmentRentalFinanceError, assertEquipmentRentalRequestBalance, equipmentRentalBalances, equipmentRentalEffect, type EquipmentRentalMoneyKind, type EquipmentRentalMoneyRow } from "../lib/equipment-rental-finance";
import { parseMoney, formatMoney } from "../lib/vehicle-partnership/money";
import { createSourceFinancialRequest, FinancialApprovalError, type FinancialActor } from "./master-cash-box";
import { reconcilePaymentState } from "./payment-state";
import { normalizeIraqiPhone } from "@/lib/phone";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = { execute: (query: any) => Promise<any> };
type Transaction = typeof financialTransactionsTable.$inferSelect;
function assertBalance(...args: Parameters<typeof assertEquipmentRentalRequestBalance>) {
  try { assertEquipmentRentalRequestBalance(...args); } catch (cause) {
    if (cause instanceof EquipmentRentalFinanceError) throw new FinancialApprovalError(cause.message);
    throw cause;
  }
}
const kinds = ["rent_payment", "rent_refund", "deposit_collect", "deposit_refund", "deposit_apply", "charge"] as const;
const sourceFor = (kind: EquipmentRentalMoneyKind) => kind.startsWith("deposit_") ? "equipment_rental_deposit" : kind === "charge" ? "equipment_rental_charge" : "rental_order";
const requestSchema = z.object({ rentalId: z.number().int().positive(), kind: z.enum(kinds), amount: z.coerce.number().positive(), method: z.enum(["cash", "transfer", "card", "pos", "other"]).default("cash"), note: z.string().trim().max(2000).default(""), requestId: z.string().trim().min(8).max(100).regex(/^[a-zA-Z0-9:_-]+$/), attachments: z.array(z.string().refine(value => /^(https:\/\/|\/api\/)/.test(value))).max(10).default([]), chargeType: z.enum(["late", "damage", "missing", "other"]).optional() });
const rows = (result: any): any[] => {
  if (!Array.isArray(result?.rows)) throw new Error("Invalid rental financial database response");
  return result.rows;
};
export function isEquipmentRentalFinancial(row: { sourceType?: string | null; transactionType?: string | null }) {
  return row.sourceType === "equipment_rental_deposit" || row.sourceType === "equipment_rental_charge" || String(row.transactionType ?? "").startsWith("er_");
}
export function assertGenericEquipmentRentalInput(input: unknown) {
  if (input && typeof input === "object" && isEquipmentRentalFinancial(input as any)) throw new FinancialApprovalError("حركة الإيجار تُنشأ وتُعدّل من عقد الإيجار الأصلي فقط");
}

/** Serialize new equipment-rental allocations with rental completion. Other
 * receipt sources and legacy product rentals keep their original writer. */
export async function lockEquipmentRentalReceiptAllocations(tx: Executor,
  allocations: readonly { sourceType: string; sourceId: number; amount: number }[],
  customer: { id: number; phone: string },
) {
  const amounts = new Map<number, number>();
  for (const allocation of allocations) {
    if (allocation.sourceType === "rental_order") amounts.set(allocation.sourceId, (amounts.get(allocation.sourceId) ?? 0) + allocation.amount);
  }
  if (!amounts.size) return;
  const ids = sql.join([...amounts.keys()].map(id => sql`${id}`), sql`, `);
  const rentals = rows(await tx.execute(sql`select id,status,customer_id,phone,remaining_amount from rental_orders r
    where id in (${ids}) and to_jsonb(r)->>'rental_kind'='equipment' order by id for update`));
  for (const contract of rentals) {
    const owns = contract.customer_id != null ? Number(contract.customer_id) === customer.id
      : normalizeIraqiPhone(contract.phone) === normalizeIraqiPhone(customer.phone);
    if (!owns || ["draft", "pending_approval", "cancelled", "canceled", "completed", "closed"].includes(contract.status) ||
      amounts.get(Number(contract.id))! > Number(contract.remaining_amount) + 0.005) {
      throw new FinancialApprovalError("تغيّرت حالة الإيجار أو رصيده. حدّث بيانات سند القبض قبل الحفظ");
    }
  }
}

/** Original receipt posting/reversal locks these original rental rows before
 * financial and cash rows, matching the source-owned rental lock order. */
export async function lockEquipmentRentalReceiptSources(tx: Executor, source: { sourceType?: string | null; sourceId?: string | number | null }, options: { requireActive?: boolean } = {}) {
  if (source.sourceType !== "receipt_voucher") return;
  const id = Number(source.sourceId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new FinancialApprovalError("معرف سند القبض غير صحيح");
  const result = await tx.execute(sql`select r.id,r.status from rental_orders r where to_jsonb(r)->>'rental_kind'='equipment'
    and exists(select 1 from receipt_voucher_allocations a where a.receipt_voucher_id=${id} and a.source_type='rental_order' and a.source_id=r.id) order by r.id for update`);
  if (!Array.isArray(result?.rows)) throw new Error("Invalid rental receipt source database response");
  if (options.requireActive !== false && result.rows.some((row: any) => ["draft", "pending_approval", "cancelled", "canceled"].includes(row.status))) throw new FinancialApprovalError("سند القبض مرتبط بإيجار معدات غير مؤكد أو ملغي");
}
function identity(row: Transaction) {
  const reversal = row.transactionType.endsWith("_reversal");
  const kind = row.transactionType.replace(/^er_/, "").replace(/_reversal$/, "") as EquipmentRentalMoneyKind;
  if (!kinds.includes(kind) || row.sourceType !== sourceFor(kind) || row.direction !== equipmentRentalEffect(kind, reversal).direction || (reversal ? !row.reversedTransactionId || row.sourceEvent !== "reversal" : row.reversedTransactionId != null || row.sourceEvent !== kind)) throw new FinancialApprovalError("هوية الحركة المالية للإيجار غير مطابقة لمصدرها");
  return { kind, reversal };
}
async function rental(executor: Executor, rentalId: number, lock = false) {
  const result = await executor.execute(sql`/* er_rental_source */ SELECT r.*, to_jsonb(r)->>'rental_kind' AS rental_kind FROM rental_orders r WHERE id=${rentalId} ${lock ? sql`FOR UPDATE` : sql``}`);
  const row = rows(result)[0];
  if (!row || row.rental_kind !== "equipment") throw new FinancialApprovalError("عقد إيجار المعدات غير موجود أو لم يكتمل تثبيت التحديث", 404);
  return row;
}
async function moneyRows(executor: Executor, rentalId: number): Promise<any[]> {
  return rows(await executor.execute(sql`/* er_money_rows */ SELECT f.*, original.transaction_type AS original_type FROM financial_transactions f LEFT JOIN financial_transactions original ON original.id=f.reversed_transaction_id WHERE f.source_id=${String(rentalId)} AND f.source_type IN ('rental_order','equipment_rental_deposit','equipment_rental_charge') ORDER BY f.id`));
}
function normalized(row: any): EquipmentRentalMoneyRow {
  let kind = String(row.transaction_type).replace(/^er_/, "").replace(/_reversal$/, "");
  if (row.source_type === "rental_order" && !String(row.transaction_type).startsWith("er_")) return { kind: row.direction === "revenue" ? "rent_payment" : "rent_refund", amount: Number(row.amount), approvalStatus: row.approval_status };
  if (!kinds.includes(kind as EquipmentRentalMoneyKind)) throw new FinancialApprovalError("تصنيف حركة الإيجار غير مكتمل");
  return { kind, amount: Number(row.amount), approvalStatus: row.approval_status, reversal: String(row.transaction_type).endsWith("_reversal") };
}
async function summary(executor: Executor, source: any, excludeId?: number) {
  const transactions = await moneyRows(executor, Number(source.id));
  const allocated = rows(await executor.execute(sql`/* er_receipt_allocations */ SELECT coalesce(sum(greatest(a.amount::numeric-coalesce(a.reversed_amount::numeric,0),0)),0)::text AS amount FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id=a.receipt_voucher_id WHERE a.source_type='rental_order' AND a.source_id=${Number(source.id)} AND a.posted_at IS NOT NULL AND coalesce(v.approval_status,'executed')='executed'`))[0];
  const balances = equipmentRentalBalances(Number(source.total_amount), transactions.filter(row => Number(row.id) !== excludeId).map(normalized), Number(allocated?.amount ?? 0));
  return { ...balances, pendingRequests: transactions.filter(row => row.approval_status === "pending"), charges: transactions.filter(row => row.source_type === "equipment_rental_charge"), payments: transactions.filter(row => row.source_type !== "equipment_rental_charge") };
}
/** Read-only projection of the same executed sources used by reconciliation. */
export async function equipmentRentalFinancialSummary(executor: Executor, rentalId: number) {
  return summary(executor, await rental(executor, rentalId));
}

export async function requestEquipmentRentalMoney(tx: Tx, input: z.input<typeof requestSchema> & { actor: FinancialActor }) {
  const data = requestSchema.parse(input);
  if (!input.actor.id) throw new FinancialApprovalError("المستخدم غير مصرح", 403);
  const source = await rental(tx, data.rentalId, true);
  const key = `equipment-rental:${data.rentalId}:${data.requestId}`;
  const existing = await tx.query.financialTransactionsTable.findFirst({ where: eq(financialTransactionsTable.idempotencyKey, key) });
  if (existing) {
    if (existing.sourceType !== sourceFor(data.kind) || existing.sourceId !== String(data.rentalId) || existing.transactionType !== `er_${data.kind}` || Number(existing.amount) !== data.amount || existing.paymentMethod !== (data.method === "card" ? "pos" : data.method) || (existing.notes ?? "") !== data.note || existing.description !== (data.kind === "charge" ? `رسوم إيجار: ${data.chargeType ?? "other"}` : `إيجار معدات: ${data.kind}`)) throw new FinancialApprovalError("مفتاح الطلب مستخدم لحركة مختلفة");
    return existing;
  }
  if ((data.kind === "rent_payment" || data.kind === "deposit_collect" || data.kind === "charge" || data.kind === "deposit_apply") && ["draft", "pending_approval", "cancelled"].includes(source.status)) throw new FinancialApprovalError("يجب تأكيد عقد نشط قبل طلب حركة مالية");
  const balance = await summary(tx, source);
  assertBalance(balance, data.kind, data.amount);
  const request = await createSourceFinancialRequest({
    direction: equipmentRentalEffect(data.kind).direction, amount: data.amount, department: "rentals", transactionType: `er_${data.kind}`,
    sourceType: sourceFor(data.kind), sourceId: String(data.rentalId), sourceEvent: data.kind, idempotencyKey: key,
    referenceNo: source.order_no, description: data.kind === "charge" ? `رسوم إيجار: ${data.chargeType ?? "other"}` : `إيجار معدات: ${data.kind}`,
    paymentMethod: data.method, customerId: source.customer_id, customerName: source.customer_name, customerPhone: source.phone,
    notes: data.note, attachments: data.attachments,
  }, input.actor, tx, "equipment_rental");
  await reconcilePaymentState(tx, { sourceType: "rental_order", sourceId: data.rentalId });
  return request;
}

async function lockedTransaction(tx: Tx, initial: Transaction) {
  identity(initial);
  const source = await rental(tx, Number(initial.sourceId), true);
  const [current] = await tx.select().from(financialTransactionsTable).where(eq(financialTransactionsTable.id, initial.id)).limit(1).for("update");
  if (!current || current.sourceType !== initial.sourceType || current.sourceId !== initial.sourceId || current.transactionType !== initial.transactionType) throw new FinancialApprovalError("تغيّر مصدر الحركة المالية");
  identity(current);
  return { source, current };
}

async function audit(tx: Executor, row: Transaction, actor: FinancialActor, action: string, reason: string) {
  await tx.execute(sql`INSERT INTO financial_audit_logs(transaction_id,action,actor_id,actor_name,old_values,new_values,reason) VALUES(${row.id},${action},${actor.id},${actor.name},'{}'::jsonb,${JSON.stringify({ rentalId: row.sourceId, type: row.transactionType, amount: row.amount, status: row.approvalStatus })}::jsonb,${reason})`);
}

/** The existing principal-manager approval gate delegates only verified source
 * identities here. All posting uses the original cashbox and journal tables. */
async function post(tx: Tx, transaction: Transaction, actor: FinancialActor, reversal = false) {
  const { kind } = identity(transaction);
  const effect = equipmentRentalEffect(kind, reversal), amount = parseMoney(transaction.amount);
  const cash = effect.cashDirection !== "noncash";
  const debitCode = kind === "deposit_collect" ? "1000" : kind === "deposit_refund" || kind === "deposit_apply" ? "ER-DEPOSIT" : kind === "charge" ? "1200" : kind === "rent_payment" ? "1000" : "1200";
  const creditCode = kind === "deposit_collect" ? "ER-DEPOSIT" : kind === "deposit_refund" || kind === "rent_refund" ? "1000" : kind === "charge" ? "4000" : "1200";
  const accounts = rows(await tx.execute(sql`SELECT id,code,account_type,is_active FROM financial_accounts WHERE code IN (${debitCode},${creditCode}) ORDER BY code FOR SHARE`));
  const debit = accounts.find(row => row.code === (reversal ? creditCode : debitCode));
  const credit = accounts.find(row => row.code === (reversal ? debitCode : creditCode));
  if (!debit || !credit || !debit.is_active || !credit.is_active || (kind.startsWith("deposit_") && !accounts.some(row => row.code === "ER-DEPOSIT" && row.account_type === "liability"))) throw new FinancialApprovalError("حسابات التأمين والإيجار غير مهيأة؛ ثبّت التحديث أولاً");
  let before: string | null = null, after: string | null = null;
  if (cash) {
    const box = rows(await tx.execute(sql`SELECT * FROM master_cash_box WHERE code='MASTER' FOR UPDATE`))[0];
    if (!box) throw new FinancialApprovalError("الصندوق الرئيسي غير مهيأ");
    const signedBalance = (value: string) => value.startsWith("-") ? -parseMoney(value.slice(1)) : parseMoney(value);
    const previous = signedBalance(String(box.current_balance));
    const next = previous + (effect.cashDirection === "inflow" ? amount : -amount);
    if (next < 0n) throw new FinancialApprovalError("رصيد الصندوق غير كافٍ");
    before = formatMoney(previous); after = formatMoney(next);
    // Rental receipts settle receivables in the journal; cash reports retain
    // their historic collections basis. Deposit movements never enter P&L.
    const revenueDelta = kind === "rent_payment" || kind === "rent_refund" ? (effect.cashDirection === "inflow" ? amount : -amount) : 0n;
    const revenue = signedBalance(String(box.total_revenue)) + revenueDelta;
    const expense = signedBalance(String(box.total_expenses));
    await tx.execute(sql`UPDATE master_cash_box SET current_balance=${after},available_balance=${after},total_revenue=${formatMoney(revenue)},net_profit=${formatMoney(revenue-expense)},version=version+1,updated_by=${actor.id},updated_by_name=${actor.name},updated_at=now() WHERE id=${Number(box.id)}`);
  }
  await tx.execute(sql`INSERT INTO financial_ledger_entries(transaction_id,account_id,entry_side,amount,description) VALUES(${transaction.id},${Number(debit.id)},'debit',${transaction.amount},${transaction.description}),(${transaction.id},${Number(credit.id)},'credit',${transaction.amount},${transaction.description})`);
  await tx.execute(sql`UPDATE financial_transactions SET approval_status='executed',approved_by=${actor.id},approved_by_name=${actor.name},approved_at=now(),executed_by=${actor.id},executed_by_name=${actor.name},executed_at=now(),balance_before=${before},balance_after=${after},updated_at=now() WHERE id=${transaction.id} AND approval_status='pending'`);
}

export async function executeEquipmentRentalFinancial(tx: Tx, initial: Transaction, actor: FinancialActor, note?: string | null) {
  const { source, current } = await lockedTransaction(tx, initial);
  if (current.approvalStatus === "executed") return current;
  if (current.approvalStatus !== "pending") throw new FinancialApprovalError("الطلب ليس معلقاً");
  const { kind, reversal } = identity(current);
  if (reversal) throw new FinancialApprovalError("العكس المالي يتم من الحركة الأصلية");
  if (["rent_payment", "deposit_collect", "deposit_apply", "charge"].includes(kind) && ["draft", "pending_approval", "cancelled"].includes(source.status)) throw new FinancialApprovalError("العقد غير نشط");
  assertBalance(await summary(tx, source, current.id), kind, Number(current.amount));
  if (kind === "charge" && Number(source.total_amount) + Number(current.amount) > 9_999_999_999.99) throw new FinancialApprovalError("إجمالي العقد يتجاوز النطاق المسموح");
  await post(tx, current, actor);
  if (kind === "charge") await tx.execute(sql`UPDATE rental_orders SET total_amount=total_amount::numeric+${current.amount}::numeric,updated_at=now() WHERE id=${Number(source.id)}`);
  await reconcilePaymentState(tx, { sourceType: "rental_order", sourceId: source.id });
  await audit(tx, { ...current, approvalStatus: "executed" }, actor, "equipment_rental_executed", note?.trim() || "اعتماد حركة إيجار");
  const [saved] = await tx.select().from(financialTransactionsTable).where(eq(financialTransactionsTable.id, current.id)).limit(1);
  return saved;
}

export async function rejectEquipmentRentalFinancial(tx: Tx, initial: Transaction, actor: FinancialActor, reason: string) {
  const { current } = await lockedTransaction(tx, initial);
  if (current.approvalStatus === "executed") throw new FinancialApprovalError("لا يمكن رفض أو إلغاء حركة منفذة");
  if (current.approvalStatus === "rejected") return current;
  await tx.execute(sql`UPDATE financial_transactions SET approval_status='rejected',rejected_by=${actor.id},rejected_by_name=${actor.name},rejected_at=now(),rejection_reason=${reason},updated_at=now() WHERE id=${current.id}`);
  await reconcilePaymentState(tx, { sourceType: "rental_order", sourceId: current.sourceId });
  await audit(tx, { ...current, approvalStatus: "rejected" }, actor, "equipment_rental_rejected", reason);
  const [saved] = await tx.select().from(financialTransactionsTable).where(eq(financialTransactionsTable.id, current.id)).limit(1);
  return saved;
}

export async function reverseEquipmentRentalFinancial(tx: Tx, initial: Transaction, actor: FinancialActor, reason: string, options?: { amount?: number; idempotencyKey?: string; sourceType?: string; sourceId?: string | number; sourceEvent?: string }) {
  const { source, current } = await lockedTransaction(tx, initial);
  const { kind, reversal } = identity(current);
  if (reversal || current.approvalStatus !== "executed") throw new FinancialApprovalError("يمكن عكس الحركة الأصلية المنفذة فقط");
  if (options?.amount != null && Number(options.amount) !== Number(current.amount) || options?.sourceType != null && options.sourceType !== current.sourceType || options?.sourceId != null && String(options.sourceId) !== current.sourceId || options?.sourceEvent != null && options.sourceEvent !== "reversal") throw new FinancialApprovalError("عكس الإيجار يتطلب كامل الحركة ومصدرها الأصلي");
  const key = options?.idempotencyKey ?? `equipment-rental-reversal:${current.id}`;
  if (current.reversalTxnId) {
    const [reverse] = await tx.select().from(financialTransactionsTable).where(eq(financialTransactionsTable.id, current.reversalTxnId)).limit(1);
    if (!reverse || reverse.reversedTransactionId !== current.id) throw new FinancialApprovalError("مرجع العكس غير مكتمل");
    return { original: current, reverse, alreadyReversed: true };
  }
  const existing = await tx.query.financialTransactionsTable.findFirst({ where: eq(financialTransactionsTable.idempotencyKey, key) });
  if (existing) throw new FinancialApprovalError("مفتاح العكس مستخدم لحركة أخرى");
  const balance = await summary(tx, source);
  const amount = Number(current.amount);
  if (kind === "deposit_collect" && amount > balance.depositHeld - balance.pendingDeposit + 0.005) throw new FinancialApprovalError("التأمين استُخدم أو حُجز؛ اعكس التسوية أو الاسترداد أولاً");
  if (kind === "deposit_refund" && amount > balance.depositRefunded + 0.005 || kind === "deposit_apply" && amount > balance.depositApplied + 0.005) throw new FinancialApprovalError("رصيد التأمين لا يسمح بالعكس");
  if (["rent_payment", "deposit_apply"].includes(kind) && amount > balance.refundablePaid - balance.pendingRentRefund + 0.005) throw new FinancialApprovalError("الدفعة أو تسوية التأمين استُردت أو حُجزت؛ اعكس الاسترداد أولاً");
  if (kind === "rent_refund" && amount > balance.remaining - balance.pendingRent + 0.005) throw new FinancialApprovalError("عكس الاسترداد يتجاوز متبقي العقد");
  if (kind === "charge" && amount > balance.remaining - balance.pendingRent + 0.005) throw new FinancialApprovalError("الرسوم سُددت أو حُجزت؛ اعكس الدفع أولاً");
  const [reverse] = await tx.insert(financialTransactionsTable).values({
    transactionNo: `FIN-ER-${randomUUID()}`, transactionDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    direction: equipmentRentalEffect(kind, true).direction, amount: current.amount, department: current.department, transactionType: `${current.transactionType}_reversal`, sourceType: current.sourceType, sourceId: current.sourceId, sourceEvent: "reversal", idempotencyKey: key, approvalStatus: "pending", reversedTransactionId: current.id,
    referenceNo: current.referenceNo, description: `عكس ${current.transactionNo}: ${reason}`, paymentMethod: current.paymentMethod, customerId: current.customerId, customerName: current.customerName, customerPhone: current.customerPhone, requestedBy: actor.id, requestedByName: actor.name, submittedAt: new Date(), notes: reason,
  }).returning();
  await post(tx, reverse, actor, true);
  if (kind === "charge") await tx.execute(sql`UPDATE rental_orders SET total_amount=total_amount::numeric-${current.amount}::numeric,updated_at=now() WHERE id=${Number(source.id)}`);
  await tx.execute(sql`UPDATE financial_transactions SET reversal_txn_id=${reverse.id},reversal_reason=${reason},reversed_by=${actor.id},reversed_by_name=${actor.name},reversed_at=now(),updated_at=now() WHERE id=${current.id}`);
  await reconcilePaymentState(tx, { sourceType: "rental_order", sourceId: current.sourceId });
  await audit(tx, { ...reverse, approvalStatus: "executed" }, actor, "equipment_rental_reversed", reason);
  const [saved] = await tx.select().from(financialTransactionsTable).where(eq(financialTransactionsTable.id, reverse.id)).limit(1);
  return { original: current, reverse: saved, alreadyReversed: false };
}
