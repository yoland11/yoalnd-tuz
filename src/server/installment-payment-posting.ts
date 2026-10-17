import { sql } from "drizzle-orm";
import { reconcilePaymentState } from "./payment-state";

type Executor = { execute: (query: any) => Promise<any> };
type Actor = { id: number | null; name: string };
const money = (value: unknown) => Math.round(Number(value) * 100) / 100;

async function lockedPayment(tx: Executor, paymentId: number, transactionId: number) {
  const reference = (await tx.execute(sql`SELECT contract_id FROM installment_payments WHERE id=${paymentId}`)).rows[0];
  if (!reference) throw new Error("دفعة الأقساط المرتبطة غير موجودة");
  const contract = (await tx.execute(sql`SELECT * FROM installment_contracts WHERE id=${Number(reference.contract_id)} FOR UPDATE`)).rows[0];
  const payment = (await tx.execute(sql`SELECT * FROM installment_payments WHERE id=${paymentId} FOR UPDATE`)).rows[0];
  if (!contract || Number(payment?.financial_transaction_id) !== transactionId)
    throw new Error("الحركة المالية لا تطابق دفعة الأقساط");
  return { contract, payment };
}

async function lockedInvoice(tx: Executor, contract: any) {
  const invoiceId = Number(contract.sales_invoice_id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0)
    throw new Error("عقد الأقساط غير مرتبط بفاتورة مبيعات صالحة");
  const invoice = (await tx.execute(sql`SELECT total,paid_amount,status FROM sales_invoices
    WHERE id=${invoiceId} FOR UPDATE`)).rows[0];
  if (!invoice) throw new Error("فاتورة المبيعات المرتبطة بعقد الأقساط غير موجودة");
  return invoice;
}

async function reconcileInvoice(tx: Executor, contract: any, expectedPaid?: number) {
  const invoiceId = Number(contract.sales_invoice_id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0)
    throw new Error("عقد الأقساط غير مرتبط بفاتورة مبيعات صالحة");
  const state = await reconcilePaymentState(tx, { sourceType: "sales_invoice", sourceId: invoiceId });
  if (expectedPaid != null && (!state || money(state.approvedPaidAmount) !== money(expectedPaid)))
    throw new Error("حالة دفع الفاتورة لا تطابق السجل المالي المعتمد؛ تتطلب مراجعة مالية يدوية قبل المتابعة");
}

async function record(tx: Executor, contractId: number, paymentId: number, action: string, actor: Actor, reason = "") {
  await tx.execute(sql`INSERT INTO installment_history (contract_id,action,new_value,reason,actor_id,actor_name)
    VALUES (${contractId},${action},${JSON.stringify({ paymentId })}::jsonb,${reason || null},${actor.id},${actor.name})`);
}

/** Runs only inside the original authorized cash/ledger transaction. */
export async function postApprovedInstallmentPayment(tx: Executor, transactionId: number, paymentId: number, amount: number, actor: Actor) {
  const { contract, payment } = await lockedPayment(tx, paymentId, transactionId);
  if (money(payment.amount) !== money(amount)) throw new Error("مبلغ الحركة لا يطابق دفعة الأقساط");
  const invoice = await lockedInvoice(tx, contract);
  const expectedPaid = money(money(invoice.paid_amount) + (payment.status === "posted" ? 0 : money(amount)));
  // Older posted payments already changed their source snapshots. Never apply
  // their allocations a second time when the pending financial request is approved.
  if (payment.status !== "posted") {
    if (payment.status !== "pending" || contract.status === "cancelled")
      throw new Error("دفعة الأقساط أو العقد غير مؤهل للترحيل");
    // A direct invoice collection may have settled this invoice after the
    // installment request was recorded. Approval must not collect it again.
    if (!invoice || invoice.status !== "active" || money(money(invoice.total)-money(invoice.paid_amount))<money(amount))
      throw new Error("دفعة القسط تتجاوز رصيد الفاتورة المتاح أو أن الفاتورة غير نشطة");
    const allocations = (await tx.execute(sql`SELECT * FROM installment_payment_allocations WHERE payment_id=${paymentId} ORDER BY installment_id`)).rows;
    let allocated = 0;
    for (const allocation of allocations) {
      const value = money(allocation.amount);
      if (!(value > 0)) throw new Error("توزيع دفعة الأقساط غير صالح");
      const updated = await tx.execute(sql`UPDATE installment_schedule SET
        paid_amount=paid_amount+${String(value)},remaining_amount=original_amount-(paid_amount+${String(value)}),
        status=CASE WHEN original_amount-(paid_amount+${String(value)})<=0.009 THEN 'paid' ELSE 'partial' END,
        payment_method=${payment.payment_method},receipt_number=${payment.receipt_number},receipt_image=${payment.receipt_image},
        paid_at=CASE WHEN original_amount-(paid_amount+${String(value)})<=0.009 THEN now() ELSE NULL END,updated_at=now()
        WHERE id=${Number(allocation.installment_id)} AND contract_id=${Number(contract.id)} AND is_cancelled=false
          AND remaining_amount>=${String(value)} RETURNING id`);
      if (!updated.rows.length) throw new Error("توزيع القسط يتجاوز الرصيد المتبقي أو تغيّر جدول العقد");
      allocated = money(allocated + value);
    }
    if (allocated > money(amount)) throw new Error("توزيع القسط أكبر من مبلغ الدفعة");
    const updated = await tx.execute(sql`UPDATE installment_contracts SET
      collected_amount=collected_amount+${String(amount)},scheduled_paid_amount=scheduled_paid_amount+${String(allocated)},
      remaining_amount=financed_amount-(scheduled_paid_amount+${String(allocated)}),
      status=CASE WHEN financed_amount-(scheduled_paid_amount+${String(allocated)})<=0.009
        AND collected_amount+${String(amount)}>=balance_at_conversion THEN 'completed'
        WHEN status='paused' THEN 'paused' ELSE 'active' END,updated_at=now()
      WHERE id=${Number(contract.id)} AND financed_amount>=scheduled_paid_amount+${String(allocated)}
        AND balance_at_conversion>=collected_amount+${String(amount)} RETURNING id`);
    if (!updated.rows.length) throw new Error("دفعة الأقساط تتجاوز رصيد العقد");
    await tx.execute(sql`UPDATE installment_payments SET status='posted' WHERE id=${paymentId}`);
    await record(tx, Number(contract.id), paymentId, "payment_approved", actor);
  }
  await reconcileInvoice(tx, contract, expectedPaid);
}

export async function rejectPendingInstallmentPayment(tx: Executor, transactionId: number, paymentId: number, actor: Actor, reason: string) {
  const { contract, payment } = await lockedPayment(tx, paymentId, transactionId);
  if (payment.status !== "pending")
    throw new Error("دفعة قديمة مرحّلة تتطلب مراجعة مالية قبل الرفض؛ لم يتم تعديل سجلها");
  const invoice = await lockedInvoice(tx, contract);
  await tx.execute(sql`UPDATE installment_payments SET status='rejected' WHERE id=${paymentId}`);
  await record(tx, Number(contract.id), paymentId, "payment_rejected", actor, reason);
  await reconcileInvoice(tx, contract, money(invoice.paid_amount));
}

export async function reconcileLegacyInstallmentInvoice(tx: Executor, contractId: number, sourceEvent: string, amount: number) {
  const contract = (await tx.execute(sql`SELECT * FROM installment_contracts WHERE id=${contractId} FOR UPDATE`)).rows[0];
  if (!contract) throw new Error("عقد الأقساط المرتبط غير موجود");
  let expectedPaid: number | undefined;
  if (sourceEvent !== "reconciliation") {
    const invoice = await lockedInvoice(tx, contract);
    expectedPaid = money(money(invoice.paid_amount) + money(amount));
  }
  await reconcileInvoice(tx, contract, expectedPaid);
}

export async function reversePostedInstallmentPayment(tx: Executor, transactionId: number, paymentId: number, amount: number, actor: Actor, reason: string) {
  const { contract, payment } = await lockedPayment(tx, paymentId, transactionId);
  if (payment.status !== "posted" || money(payment.amount) !== money(amount))
    throw new Error("العكس الجزئي لدفعة القسط غير مدعوم؛ استخدم العكس الكامل");
  const invoice = await lockedInvoice(tx, contract);
  const allocations = (await tx.execute(sql`SELECT * FROM installment_payment_allocations WHERE payment_id=${paymentId} ORDER BY installment_id`)).rows;
  let allocated = 0;
  for (const allocation of allocations) {
    const value = money(allocation.amount);
    const updated = await tx.execute(sql`UPDATE installment_schedule SET paid_amount=paid_amount-${String(value)},
      remaining_amount=original_amount-(paid_amount-${String(value)}),paid_at=NULL,
      status=CASE WHEN paid_amount-${String(value)}>0 THEN 'partial' ELSE 'upcoming' END,updated_at=now()
      WHERE id=${Number(allocation.installment_id)} AND contract_id=${Number(contract.id)} AND paid_amount>=${String(value)} RETURNING id`);
    if (!updated.rows.length) throw new Error("تعذر عكس توزيع القسط؛ يتطلب مراجعة مالية");
    allocated = money(allocated + value);
  }
  if (!allocations.length && money(contract.down_payment_amount) < money(amount))
    throw new Error("الدفعة القديمة بلا توزيع موثوق؛ يتطلب العكس مراجعة مالية");
  const updated = await tx.execute(sql`UPDATE installment_contracts SET collected_amount=collected_amount-${String(amount)},
    scheduled_paid_amount=scheduled_paid_amount-${String(allocated)},remaining_amount=financed_amount-(scheduled_paid_amount-${String(allocated)}),
    status=CASE WHEN status='paused' THEN 'paused' ELSE 'active' END,updated_at=now()
    WHERE id=${Number(contract.id)} AND collected_amount>=${String(amount)} AND scheduled_paid_amount>=${String(allocated)} RETURNING id`);
  if (!updated.rows.length) throw new Error("تعذر عكس رصيد عقد الأقساط؛ يتطلب مراجعة مالية");
  await tx.execute(sql`UPDATE installment_payments SET status='reversed',reversed_at=now(),reversal_reason=${reason} WHERE id=${paymentId}`);
  await record(tx, Number(contract.id), paymentId, "payment_reversed", actor, reason);
  await reconcileInvoice(tx, contract, money(money(invoice.paid_amount) - money(amount)));
}
