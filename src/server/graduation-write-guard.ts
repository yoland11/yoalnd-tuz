import { sql } from "drizzle-orm";

export class GraduationOrderWriteConflict extends Error {
  readonly status = 409;
}

/** All graduation collection entry points lock the original order, including
 * collections entered using its linked sales invoice. Archive uses this same
 * row before checking payment history. No pooled/nested transaction here. */
export async function lockGraduationPaymentSource(
  tx: { execute: (query: any) => Promise<any> },
  source: { sourceType?: string | null; sourceId?: string | number | null } | Array<{ sourceType?: string | null; sourceId?: string | number | null }>,
  options: { requireActive?: boolean } = {},
) {
  const sources = (Array.isArray(source) ? source : [source]).filter(item =>
    ["graduation_order", "sales_invoice", "receipt_voucher", "installment_contract", "installment_payment"].includes(item.sourceType ?? ""));
  if (!sources.length) return;
  // Resolve aliases before locking any financial/cash/contract row. One sorted
  // original-order set prevents opposite allocation orders from deadlocking.
  const matches = sources.map(item => {
    const id = Number(item.sourceId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("معرّف مصدر الدفعة غير صحيح");
    return item.sourceType === "graduation_order" ? sql`id = ${id}`
    : item.sourceType === "sales_invoice" ? sql`invoice_id = ${id}`
    : item.sourceType === "receipt_voucher" ? sql`id IN (
        SELECT a.source_id FROM receipt_voucher_allocations a WHERE a.receipt_voucher_id = ${id} AND a.source_type = 'graduation_order'
        UNION SELECT g.id FROM graduation_orders g JOIN receipt_voucher_allocations a ON a.source_id = g.invoice_id
          WHERE a.receipt_voucher_id = ${id} AND a.source_type = 'sales_invoice')`
    : item.sourceType === "installment_contract" ? sql`invoice_id IN (SELECT sales_invoice_id FROM installment_contracts WHERE id = ${id})`
    : sql`invoice_id IN (SELECT c.sales_invoice_id FROM installment_contracts c JOIN installment_payments p ON p.contract_id = c.id WHERE p.id = ${id})`;
  });
  const match = matches.reduce((left,right) => sql`(${left}) OR (${right})`);
  const result = await tx.execute(sql`SELECT id, status, archived_at FROM graduation_orders WHERE ${match} ORDER BY id FOR UPDATE`);
  if (sources.some(item => item.sourceType === "graduation_order" && !result.rows?.some((row:any) => Number(row.id) === Number(item.sourceId))))
    throw new GraduationOrderWriteConflict("طلب التخرج المرتبط بالعملية غير موجود");
  for (const row of result.rows ?? []) {
    if (options.requireActive !== false && (row.archived_at || row.status === "cancelled"))
      throw new GraduationOrderWriteConflict("لا يمكن تنفيذ العملية على طلب تخرج ملغى أو مؤرشف");
  }
}
