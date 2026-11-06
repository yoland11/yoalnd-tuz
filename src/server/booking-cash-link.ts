import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { financialTransactionsTable } from "@workspace/db";
import { shortBookingNumber } from "@/lib/booking-number";
import { bookingCashState } from "@/lib/booking-cash-state";

type Executor = { execute: (query: any) => Promise<any> };
export type BookingEntityType = "kosha_booking" | "service_order";
export type BookingLink = { source: "kosha" | "service"; id: number; label: string };

const rowsOf = (result: any): any[] => result?.rows ?? result ?? [];
const amountOf = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;
const sourceOf = (entityType: string) => (entityType === "kosha_booking" ? "kosha" : "service");
const groupPhotoKey = (entityType: string, id: number) => `group-photo-attendee:${entityType}:${id}:`;

export const bookingEntityType = (source: string | null | undefined): BookingEntityType | null =>
  source === "kosha" ? "kosha_booking" : source === "service" ? "service_order" : null;

export type LinkedSalesInvoice = { id: number; invoiceNo: string | null; total: number };

/**
 * A sound booking made from a sales invoice is paid on that invoice: the invoice sync stores
 * its paid share (total × invoice paid ÷ invoice total) and the cash moves under the invoice.
 */
export async function bookingLinkedSalesInvoice(executor: Executor, entityType: BookingEntityType, id: number): Promise<LinkedSalesInvoice | null> {
  if (entityType !== "service_order") return null;
  const [row] = rowsOf(await executor.execute(sql`
    SELECT i.id, i.invoice_no, i.total FROM service_orders o
    JOIN sales_invoices i ON i.id::text = coalesce(o.custom_fields ->> 'salesInvoiceId', o.custom_fields ->> 'sourceId')
    WHERE o.id = ${id}
      AND (o.custom_fields ->> 'sourceType' = 'sales_invoice' OR o.custom_fields ->> 'bookingSource' = 'sales_invoice')
  `));
  return row ? { id: Number(row.id), invoiceNo: row.invoice_no ?? null, total: amountOf(row.total) } : null;
}

async function voucherIdsFor(executor: Executor, entityType: BookingEntityType, id: number, invoice: LinkedSalesInvoice | null) {
  const result = await executor.execute(sql`
    SELECT v.id FROM receipt_vouchers v
    WHERE ${entityType === "kosha_booking" ? sql`v.kosha_booking_id = ${id}` : sql`v.booking_id = ${id}`}
    UNION
    SELECT a.receipt_voucher_id FROM receipt_voucher_allocations a
    WHERE a.source_type = ${entityType} AND a.source_id = ${id}
    ${invoice ? sql`UNION SELECT a.receipt_voucher_id FROM receipt_voucher_allocations a WHERE a.source_type = 'sales_invoice' AND a.source_id = ${invoice.id}` : sql``}
  `);
  return rowsOf(result).map((row) => String(row.id));
}

/** The invoice's installment sources, the same ones reconcilePaymentState counts for it. */
async function invoiceInstallmentIds(executor: Executor, invoiceId: number) {
  const result = await executor.execute(sql`
    SELECT 'installment_payment' AS kind, p.id::text AS id FROM installment_payments p JOIN installment_contracts c ON c.id = p.contract_id WHERE c.sales_invoice_id = ${invoiceId}
    UNION ALL
    SELECT 'installment_contract', c.id::text FROM installment_contracts c WHERE c.sales_invoice_id = ${invoiceId}
  `);
  const rows = rowsOf(result);
  return {
    payments: rows.filter((row) => row.kind === "installment_payment").map((row) => String(row.id)),
    contracts: rows.filter((row) => row.kind === "installment_contract").map((row) => String(row.id)),
  };
}

/**
 * Every cash movement that belongs to one booking: its direct payments, the receipt vouchers
 * collected for it, its penalty payments and its group photos. The booking's log and the cash
 * ledger's booking filter both use this, so they always list the same rows.
 */
export async function bookingTransactionCondition(executor: Executor, entityType: BookingEntityType, id: number) {
  const invoice = await bookingLinkedSalesInvoice(executor, entityType, id);
  const voucherIds = await voucherIdsFor(executor, entityType, id, invoice);
  const penaltyIds = rowsOf(await executor.execute(sql`SELECT id FROM booking_penalties WHERE source_type = ${entityType} AND source_id = ${id}`)).map((row) => String(row.id));
  const installments = invoice ? await invoiceInstallmentIds(executor, invoice.id) : { payments: [], contracts: [] };
  const table = financialTransactionsTable;
  return or(
    and(eq(table.sourceType, entityType), eq(table.sourceId, String(id))),
    voucherIds.length ? and(eq(table.sourceType, "receipt_voucher"), inArray(table.sourceId, voucherIds)) : undefined,
    penaltyIds.length ? and(eq(table.sourceType, "booking_penalty"), inArray(table.sourceId, penaltyIds)) : undefined,
    and(eq(table.sourceType, "group_photo"), eq(table.sourceId, String(id)), like(table.idempotencyKey, `${groupPhotoKey(entityType, id)}%`)),
    // A booking made from a sales invoice is paid on the invoice, so the invoice's movements are its own.
    invoice ? and(eq(table.sourceType, "sales_invoice"), eq(table.sourceId, String(invoice.id))) : undefined,
    installments.payments.length ? and(eq(table.sourceType, "installment_payment"), inArray(table.sourceId, installments.payments)) : undefined,
    installments.contracts.length ? and(eq(table.sourceType, "installment_contract"), inArray(table.sourceId, installments.contracts), inArray(table.sourceEvent, ["payment", "reconciliation", "reversal"])) : undefined,
  )!;
}

/** How much of each receipt voucher went to this booking; one voucher can pay several documents. */
export async function bookingVoucherShares(executor: Executor, entityType: BookingEntityType, id: number) {
  const result = await executor.execute(sql`
    SELECT a.receipt_voucher_id AS voucher_id, sum(a.amount::numeric) AS share
    FROM receipt_voucher_allocations a
    WHERE a.source_type = ${entityType} AND a.source_id = ${id}
    GROUP BY a.receipt_voucher_id
  `);
  return new Map(rowsOf(result).map((row) => [String(row.voucher_id), amountOf(row.share)]));
}

export type BookingRowShare = { share: number; from: "receipt_voucher" | "sales_invoice" };

/**
 * The part of each listed movement that belongs to the booking: a voucher's allocation to it and,
 * for a booking made from a sales invoice, its share of every invoice movement at the ratio the
 * invoice sync stores (booking total ÷ invoice total, at most all of it).
 */
export async function bookingRowShares(executor: Executor, entityType: BookingEntityType, id: number, total: number) {
  const invoice = await bookingLinkedSalesInvoice(executor, entityType, id);
  const own = await bookingVoucherShares(executor, entityType, id);
  const ratio = invoice && invoice.total > 0 ? Math.min(1, Math.max(total, 0) / invoice.total) : 0;
  const viaInvoice = new Map<string, number>();
  if (invoice) {
    const result = await executor.execute(sql`
      SELECT a.receipt_voucher_id AS voucher_id, sum(a.amount::numeric) AS share FROM receipt_voucher_allocations a
      WHERE a.source_type = 'sales_invoice' AND a.source_id = ${invoice.id} GROUP BY a.receipt_voucher_id
    `);
    for (const row of rowsOf(result)) viaInvoice.set(String(row.voucher_id), amountOf(row.share));
  }
  return {
    invoice,
    shareOf(row: { sourceType: string | null; sourceId: string | null; amount: unknown }): BookingRowShare | null {
      const key = String(row.sourceId ?? "");
      if (row.sourceType === "receipt_voucher") {
        if (!own.has(key) && !viaInvoice.has(key)) return null;
        return { share: amountOf((own.get(key) ?? 0) + (viaInvoice.get(key) ?? 0) * ratio), from: own.has(key) ? "receipt_voucher" : "sales_invoice" };
      }
      if (invoice && ["sales_invoice", "installment_payment", "installment_contract"].includes(String(row.sourceType)))
        return { share: amountOf(amountOf(row.amount) * ratio), from: "sales_invoice" };
      return null;
    },
  };
}

/**
 * The invoice's approved cash by the reconcilePaymentState rule for sales_invoice (executed direct
 * movements, posted allocations and installment cash, never below zero) and the booking's share,
 * rounded like the numeric(10,2) snapshot the invoice sync stores.
 */
async function invoiceCashShare(executor: Executor, invoice: LinkedSalesInvoice, total: number) {
  const invoiceId = invoice.id;
  const bookingTotal = Math.max(total, 0);
  const [row] = rowsOf(await executor.execute(sql`
    WITH money AS (
      SELECT greatest(
        (SELECT coalesce(sum(CASE WHEN direction = 'revenue' THEN amount::numeric ELSE -amount::numeric END), 0) FROM financial_transactions
          WHERE source_type = 'sales_invoice' AND source_id = ${String(invoiceId)} AND approval_status = 'executed')
        + (SELECT coalesce(sum(greatest(a.amount::numeric - coalesce(a.reversed_amount::numeric, 0), 0)), 0)
          FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id = a.receipt_voucher_id
          WHERE a.source_type = 'sales_invoice' AND a.source_id = ${invoiceId} AND a.posted_at IS NOT NULL AND coalesce(v.approval_status, 'executed') = 'executed')
        + (SELECT coalesce(sum(CASE WHEN f.direction = 'revenue' THEN f.amount::numeric ELSE -f.amount::numeric END), 0) FROM financial_transactions f
          WHERE f.approval_status = 'executed' AND (
            (f.source_type = 'installment_payment' AND EXISTS (SELECT 1 FROM installment_payments p JOIN installment_contracts c ON c.id = p.contract_id WHERE p.id::text = f.source_id AND c.sales_invoice_id = ${invoiceId}))
            OR (f.source_type = 'installment_contract' AND f.source_event IN ('payment', 'reconciliation', 'reversal') AND EXISTS (SELECT 1 FROM installment_contracts c WHERE c.id::text = f.source_id AND c.sales_invoice_id = ${invoiceId})))),
        0) AS approved,
        (SELECT coalesce(sum(amount::numeric), 0) FROM financial_transactions
          WHERE source_type = 'sales_invoice' AND source_id = ${String(invoiceId)} AND approval_status IN ('pending', 'draft') AND direction = 'revenue')
        + (SELECT coalesce(sum(a.amount::numeric), 0) FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id = a.receipt_voucher_id
          WHERE a.source_type = 'sales_invoice' AND a.source_id = ${invoiceId} AND a.posted_at IS NULL AND v.approval_status IN ('pending', 'draft')) AS waiting
    )
    SELECT money.approved, money.waiting,
      CASE WHEN ${String(invoice.total)}::numeric > 0 THEN round(${String(bookingTotal)}::numeric * least(1, money.approved / ${String(invoice.total)}::numeric), 2) ELSE 0 END AS share,
      CASE WHEN ${String(invoice.total)}::numeric > 0 THEN round(${String(bookingTotal)}::numeric * least(1, money.waiting / ${String(invoice.total)}::numeric), 2) ELSE 0 END AS waiting_share
    FROM money
  `));
  return { approved: amountOf(row?.approved), share: amountOf(row?.share), waitingShare: amountOf(row?.waiting_share) };
}

/**
 * The booking seen from the cash box. "approved" uses the same rule as reconcilePaymentState
 * (executed movements plus posted allocations), and penalties and group photos stay outside it
 * because they are separate money that never counts towards the booking's own total.
 */
export async function bookingCashSummary(executor: Executor, input: { entityType: BookingEntityType; id: number; total: number; recorded: number }) {
  const { entityType, id, total, recorded } = input;
  const sourceId = String(id);
  const invoice = await bookingLinkedSalesInvoice(executor, entityType, id);
  const viaInvoice = invoice ? await invoiceCashShare(executor, invoice, total) : null;
  const [row] = rowsOf(await executor.execute(sql`
    SELECT
      (SELECT coalesce(sum(CASE WHEN direction = 'revenue' THEN amount::numeric ELSE -amount::numeric END), 0) FROM financial_transactions
        WHERE source_type = ${entityType} AND source_id = ${sourceId} AND approval_status = 'executed') AS direct_paid,
      (SELECT coalesce(sum(amount::numeric), 0) FROM financial_transactions
        WHERE source_type = ${entityType} AND source_id = ${sourceId} AND approval_status IN ('pending', 'draft') AND direction = 'revenue') AS direct_waiting,
      (SELECT coalesce(sum(greatest(a.amount::numeric - coalesce(a.reversed_amount::numeric, 0), 0)), 0)
        FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id = a.receipt_voucher_id
        WHERE a.source_type = ${entityType} AND a.source_id = ${id} AND a.posted_at IS NOT NULL AND coalesce(v.approval_status, 'executed') = 'executed') AS allocated_paid,
      (SELECT coalesce(sum(a.amount::numeric), 0)
        FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id = a.receipt_voucher_id
        WHERE a.source_type = ${entityType} AND a.source_id = ${id} AND a.posted_at IS NULL AND v.approval_status IN ('pending', 'draft')) AS allocated_waiting,
      (SELECT coalesce(sum(CASE WHEN f.direction = 'revenue' THEN f.amount::numeric ELSE -f.amount::numeric END), 0)
        FROM financial_transactions f JOIN booking_penalties p ON p.id::text = f.source_id
        WHERE f.source_type = 'booking_penalty' AND f.approval_status = 'executed' AND p.source_type = ${entityType} AND p.source_id = ${id}) AS penalties,
      (SELECT coalesce(sum(CASE WHEN direction = 'revenue' THEN amount::numeric ELSE -amount::numeric END), 0) FROM financial_transactions
        WHERE source_type = 'group_photo' AND source_id = ${sourceId} AND approval_status = 'executed' AND idempotency_key LIKE ${`${groupPhotoKey(entityType, id)}%`}) AS group_photos
  `));
  // A booking made from a sales invoice also holds its share of the invoice's approved cash.
  const approved = Math.max(amountOf(amountOf(row?.direct_paid) + amountOf(row?.allocated_paid) + (viaInvoice?.share ?? 0)), 0);
  return {
    approved,
    waiting: amountOf(amountOf(row?.direct_waiting) + amountOf(row?.allocated_waiting) + (viaInvoice?.waitingShare ?? 0)),
    invoice: invoice && viaInvoice ? { id: invoice.id, invoiceNo: invoice.invoiceNo, total: invoice.total, approved: viaInvoice.approved, share: viaInvoice.share } : null,
    recorded: amountOf(recorded),
    penalties: amountOf(row?.penalties),
    groupPhotos: amountOf(row?.group_photos),
    ...bookingCashState({ total, recorded, approved }),
  };
}

/** Adds the booking(s) behind each cash movement, so the ledger can open the booking itself. */
export async function attachBookingLinks<T extends { sourceType: string | null; sourceId: string | null; idempotencyKey?: string | null }>(executor: Executor, rows: T[]) {
  const numericIds = (sourceType: string) => [...new Set(rows.filter((row) => row.sourceType === sourceType && /^\d+$/.test(String(row.sourceId ?? ""))).map((row) => Number(row.sourceId)))];
  const inList = (ids: number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const penaltyIds = numericIds("booking_penalty");
  const voucherIds = numericIds("receipt_voucher");
  const penalties = new Map(penaltyIds.length
    ? rowsOf(await executor.execute(sql`SELECT id, source_type, source_id FROM booking_penalties WHERE id IN (${inList(penaltyIds)})`)).map((row) => [String(row.id), { entityType: String(row.source_type), id: Number(row.source_id) }])
    : []);
  const vouchers = new Map<string, Array<{ entityType: string; id: number }>>();
  if (voucherIds.length) {
    const result = await executor.execute(sql`
      SELECT a.receipt_voucher_id AS voucher_id, a.source_type AS entity_type, a.source_id AS booking_id FROM receipt_voucher_allocations a
      WHERE a.receipt_voucher_id IN (${inList(voucherIds)}) AND a.source_type IN ('kosha_booking', 'service_order') AND a.source_id IS NOT NULL
      UNION
      SELECT v.id, 'kosha_booking', v.kosha_booking_id FROM receipt_vouchers v WHERE v.id IN (${inList(voucherIds)}) AND v.kosha_booking_id IS NOT NULL
      UNION
      SELECT v.id, 'service_order', v.booking_id FROM receipt_vouchers v WHERE v.id IN (${inList(voucherIds)}) AND v.booking_id IS NOT NULL
    `);
    for (const row of rowsOf(result)) {
      const list = vouchers.get(String(row.voucher_id)) ?? [];
      list.push({ entityType: String(row.entity_type), id: Number(row.booking_id) });
      vouchers.set(String(row.voucher_id), list);
    }
  }
  const targetsOf = (row: T): Array<{ entityType: string; id: number }> => {
    const id = String(row.sourceId ?? "");
    if ((row.sourceType === "kosha_booking" || row.sourceType === "service_order") && /^\d+$/.test(id)) return [{ entityType: row.sourceType, id: Number(id) }];
    if (row.sourceType === "booking_penalty") return penalties.has(id) ? [penalties.get(id)!] : [];
    if (row.sourceType === "receipt_voucher") return vouchers.get(id) ?? [];
    if (row.sourceType === "group_photo") {
      const match = /^group-photo-attendee:(kosha_booking|service_order):(\d+):/.exec(String(row.idempotencyKey ?? ""));
      return match ? [{ entityType: match[1], id: Number(match[2]) }] : [];
    }
    return [];
  };
  const targets = rows.map(targetsOf);
  const idsFor = (entityType: string) => [...new Set(targets.flat().filter((target) => target.entityType === entityType).map((target) => target.id))];
  const koshaIds = idsFor("kosha_booking");
  const serviceIds = idsFor("service_order");
  const codes = new Map<string, string | null>();
  if (koshaIds.length) for (const row of rowsOf(await executor.execute(sql`SELECT id, tracking_code FROM kosha_bookings WHERE id IN (${inList(koshaIds)})`))) codes.set(`kosha_booking:${row.id}`, row.tracking_code ?? null);
  if (serviceIds.length) for (const row of rowsOf(await executor.execute(sql`SELECT id, tracking_code FROM service_orders WHERE id IN (${inList(serviceIds)})`))) codes.set(`service_order:${row.id}`, row.tracking_code ?? null);
  return rows.map((row, index) => {
    const seen = new Set<string>();
    const bookings: BookingLink[] = [];
    for (const target of targets[index]) {
      const key = `${target.entityType}:${target.id}`;
      // A booking that no longer exists has nothing to open.
      if (seen.has(key) || !codes.has(key)) continue;
      seen.add(key);
      const source = sourceOf(target.entityType);
      bookings.push({ source, id: target.id, label: shortBookingNumber(source, target.id, codes.get(key)) || `#${target.id}` });
    }
    return { ...row, bookings };
  });
}
