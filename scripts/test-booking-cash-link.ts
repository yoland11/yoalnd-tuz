/** The booking seen from the cash box. The state rules need no database; the rest runs only in an isolated TEST database, in a transaction it rolls back. */
import assert from "node:assert/strict";
import { and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { bookingCashState } from "../src/lib/booking-cash-state";

const state = (total: number, recorded: number, approved: number) => bookingCashState({ total, recorded, approved }).state;
assert.equal(state(1000, 0, 0), "empty", "no payment yet is not a problem");
assert.equal(state(1000, 400, 400), "matched");
assert.equal(state(1000, 1000, 1000), "matched");
assert.equal(state(1000, 400, 300), "mismatch", "the booking records more than the cash box");
assert.equal(state(1000, 300, 400), "mismatch", "the booking records less than the cash box");
assert.equal(state(1000, 400, 0), "missing_in_cash", "recorded as paid with nothing behind it");
assert.equal(state(1000, 1000, 1200), "overpaid", "the booking holds its total; the rest is reported");
assert.deepEqual(bookingCashState({ total: 1000, recorded: 1000, approved: 1200 }), { state: "overpaid", difference: 0, overpaid: 200 });
assert.deepEqual(bookingCashState({ total: 1000, recorded: 400, approved: 300 }), { state: "mismatch", difference: 100, overpaid: 0 });
assert.equal(state(1000, 400.004, 400), "matched", "a rounding crumb is not a difference");

const url = process.env.TEST_DATABASE_URL;
if (process.env.AJN_ENV !== "test" || process.env.ALLOW_TEST_WRITES !== "true" || !url) {
  console.log("PASS booking cash states. SKIPPED booking cash link PostgreSQL proof: needs AJN_ENV=test, ALLOW_TEST_WRITES=true and TEST_DATABASE_URL");
  process.exit(0);
}
if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must be a separate database");

const { financialTransactionsTable } = await import("@workspace/db");
const { attachBookingLinks, bookingCashSummary, bookingRowShares, bookingTransactionCondition, bookingVoucherShares } = await import("../src/server/booking-cash-link");
const { reconcilePaymentState } = await import("../src/server/payment-state");

const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
const db: any = drizzle(client);
const rows = async (query: any) => (await db.execute(query)).rows as any[];
const stamp = Date.now();
let serial = 0;
class Rollback extends Error {}

await db.execute(sql`begin`);
try {
  const newBooking = async (total: number) => Number((await rows(sql`
    insert into kosha_bookings (customer_name, phone, total_amount, remaining_amount, tracking_code) values ('فحص الصندوق', '07700000000', ${String(total)}, ${String(total)}, ${`CASH-${stamp}-${(serial += 1)}`}) returning id
  `))[0].id);
  const booking = await newBooking(500000);
  const other = await newBooking(500000);
  const entity = "kosha_booking" as const;
  const move = async (input: { sourceType: string; sourceId: string; amount: number; direction?: string; status?: string; key?: string }) => Number((await rows(sql`
    insert into financial_transactions (transaction_no, transaction_date, direction, amount, transaction_type, source_type, source_id, approval_status, idempotency_key)
    values (${`T-${stamp}-${(serial += 1)}`}, '2039-05-05', ${input.direction ?? "revenue"}, ${String(input.amount)}, 'فحص', ${input.sourceType}, ${input.sourceId}, ${input.status ?? "executed"}, ${input.key ?? `test:${stamp}:${serial}`})
    returning id
  `))[0].id);

  // Direct payments: one executed, one reversed part, one waiting, one rejected.
  const paid = await move({ sourceType: entity, sourceId: String(booking), amount: 100000 });
  const reversal = await move({ sourceType: entity, sourceId: String(booking), amount: 30000, direction: "expense" });
  const waiting = await move({ sourceType: entity, sourceId: String(booking), amount: 50000, status: "pending" });
  const refused = await move({ sourceType: entity, sourceId: String(booking), amount: 20000, status: "rejected" });
  const stranger = await move({ sourceType: entity, sourceId: String(other), amount: 999000 });

  // A voucher split across two bookings counts only its share, net of what was reversed.
  const [customer] = await rows(sql`insert into customers (phone) values (${`0770${String(stamp).slice(-7)}`}) returning id`);
  const voucher = async (status: string, posted: boolean, allocations: Array<[number, number, number]>) => {
    const [row] = await rows(sql`insert into receipt_vouchers (voucher_no, payer_name, amount, approval_status) values (${`RV-${stamp}-${(serial += 1)}`}, 'فحص', ${String(allocations.reduce((sum, item) => sum + item[1], 0))}, ${status}) returning id`);
    for (const [bookingId, amount, reversed] of allocations)
      await db.execute(sql`insert into receipt_voucher_allocations (receipt_voucher_id, customer_id, source_type, source_id, amount, reversed_amount, posted_at) values (${row.id}, ${customer.id}, ${entity}, ${bookingId}, ${String(amount)}, ${String(reversed)}, ${posted ? sql`now()` : sql`null`})`);
    return Number(row.id);
  };
  const postedVoucher = await voucher("executed", true, [[booking, 40000, 10000], [other, 60000, 0]]);
  const postedMove = await move({ sourceType: "receipt_voucher", sourceId: String(postedVoucher), amount: 100000 });
  const waitingVoucher = await voucher("pending", false, [[booking, 25000, 0]]);
  const waitingMove = await move({ sourceType: "receipt_voucher", sourceId: String(waitingVoucher), amount: 25000, status: "pending" });

  // Separate money: a penalty and group photos reach the cash box without counting towards the total.
  const [penalty] = await rows(sql`insert into booking_penalties (penalty_no, damage_type, source_type, source_id) values (${`P-${stamp}`}, 'damage', ${entity}, ${booking}) returning id`);
  const penaltyMove = await move({ sourceType: "booking_penalty", sourceId: String(penalty.id), amount: 7000 });
  const groupMove = await move({ sourceType: "group_photo", sourceId: String(booking), amount: 3000, key: `group-photo-attendee:${entity}:${booking}:a1` });
  // The same number on the other booking type is a different booking.
  const otherTypeGroup = await move({ sourceType: "group_photo", sourceId: String(booking), amount: 9000, key: `group-photo-attendee:service_order:${booking}:a1` });

  const canonical = await reconcilePaymentState(db, { sourceType: entity, sourceId: booking });
  assert.equal(Number(canonical!.approvedPaidAmount), 100000, "100k - 30k direct + 30k share of the voucher");
  const [stored] = await rows(sql`select paid_amount from kosha_bookings where id = ${booking}`);

  const summary = await bookingCashSummary(db, { entityType: entity, id: booking, total: 500000, recorded: Number(stored.paid_amount) });
  assert.equal(summary.approved, Number(canonical!.approvedPaidAmount), "the same rule as reconcilePaymentState");
  assert.equal(summary.waiting, 75000, "a waiting payment and a waiting voucher's share");
  assert.equal(summary.penalties, 7000);
  assert.equal(summary.groupPhotos, 3000, "group photos of the same number on another booking type stay out");
  assert.equal(summary.state, "matched");
  assert.equal((await bookingCashSummary(db, { entityType: entity, id: booking, total: 500000, recorded: 150000 })).state, "mismatch");
  assert.equal((await bookingCashSummary(db, { entityType: "service_order", id: booking, total: 500000, recorded: 0 })).approved, 0, "the source type is part of the identity");

  const condition = await bookingTransactionCondition(db, entity, booking);
  const scoped = await db.select().from(financialTransactionsTable).where(and(condition, sql`${financialTransactionsTable.transactionNo} like ${`T-${stamp}-%`}`));
  const scopedIds = new Set(scoped.map((row: any) => Number(row.id)));
  for (const id of [paid, reversal, waiting, refused, postedMove, waitingMove, penaltyMove, groupMove]) assert.ok(scopedIds.has(id), `movement ${id} belongs to the booking`);
  assert.ok(!scopedIds.has(stranger), "another booking's payment stays out");
  assert.ok(!scopedIds.has(otherTypeGroup), "another booking type's group photos stay out");

  assert.equal((await bookingVoucherShares(db, entity, booking)).get(String(postedVoucher)), 40000, "the booking's share, not the whole voucher");

  const linked = await attachBookingLinks(db, scoped.concat(await db.select().from(financialTransactionsTable).where(sql`${financialTransactionsTable.id} = ${stranger}`)));
  const linkOf = (id: number) => linked.find((row: any) => Number(row.id) === id)!.bookings;
  assert.deepEqual(linkOf(paid).map((row) => row.id), [booking]);
  assert.equal(linkOf(paid)[0].source, "kosha");
  assert.ok(linkOf(paid)[0].label, "a booking number to show");
  assert.deepEqual(linkOf(penaltyMove).map((row) => row.id), [booking], "a penalty opens its booking");
  assert.deepEqual(linkOf(groupMove).map((row) => row.id), [booking], "group photos open their booking");
  assert.deepEqual(linkOf(postedMove).map((row) => row.id).sort((a, b) => a - b), [booking, other].sort((a, b) => a - b), "a split voucher opens both bookings");
  assert.deepEqual(linkOf(stranger).map((row) => row.id), [other]);
  const [unlinked] = await attachBookingLinks(db, [{ sourceType: "expense", sourceId: "5" }]);
  assert.deepEqual(unlinked.bookings, [], "a movement with no booking has none");
  const [gone] = await attachBookingLinks(db, [{ sourceType: "kosha_booking", sourceId: "2147483000" }]);
  assert.deepEqual(gone.bookings, [], "a booking that no longer exists has nothing to open");

  // A sound booking made from a sales invoice is paid on the invoice: the invoice sync stores
  // total × invoice paid ÷ invoice total on the booking, and the cash moves under the invoice.
  const [service] = await rows(sql`insert into services (name, name_ar, type) values ('sound', 'صوتيات', 'sound') returning id`);
  const invoiceOf = async (total: number) => Number((await rows(sql`insert into sales_invoices (invoice_no, date, customer_name, total) values (${`INV-${stamp}-${(serial += 1)}`}, '2039-05-05', 'فحص', ${String(total)}) returning id`))[0].id);
  const soundBooking = async (fields: Record<string, unknown>, total: number, recorded: number) => Number((await rows(sql`
    insert into service_orders (service_id, customer_name, phone, total_amount, deposit_amount, remaining_amount, custom_fields)
    values (${service.id}, 'زبون فاتورة مبيعات', 'غير مسجل', ${String(total)}, ${String(recorded)}, ${String(total - recorded)}, ${JSON.stringify(fields)}::jsonb) returning id
  `))[0].id);
  const paidInvoice = await invoiceOf(250000);
  const invoiceCash = await move({ sourceType: "sales_invoice", sourceId: String(paidInvoice), amount: 200000 });
  const invoiceVoucherRow = await rows(sql`insert into receipt_vouchers (voucher_no, payer_name, amount, approval_status) values (${`RV-${stamp}-${(serial += 1)}`}, 'فحص', '50000', 'executed') returning id`);
  await db.execute(sql`insert into receipt_voucher_allocations (receipt_voucher_id, customer_id, source_type, source_id, amount, reversed_amount, posted_at) values (${invoiceVoucherRow[0].id}, ${customer.id}, 'sales_invoice', ${paidInvoice}, '50000', '0', now())`);
  const invoiceVoucherMove = await move({ sourceType: "receipt_voucher", sourceId: String(invoiceVoucherRow[0].id), amount: 50000 });
  const invoicePending = await move({ sourceType: "sales_invoice", sourceId: String(paidInvoice), amount: 25000, status: "pending" });
  const fromPaid = await soundBooking({ sourceType: "sales_invoice", bookingSource: "sales_invoice", salesInvoiceId: paidInvoice, sourceId: paidInvoice, salesInvoiceReference: "INV-X" }, 100000, 100000);
  const invoiceCanonical = await reconcilePaymentState(db, { sourceType: "sales_invoice", sourceId: paidInvoice });
  const full = await bookingCashSummary(db, { entityType: "service_order", id: fromPaid, total: 100000, recorded: 100000 });
  assert.equal(full.invoice?.approved, Number(invoiceCanonical!.approvedPaidAmount), "the invoice's cash by the reconcilePaymentState rule");
  assert.equal(full.invoice?.share, 100000, "a fully paid invoice pays the whole booking");
  assert.equal(full.approved, 100000);
  assert.equal(full.state, "matched", "an invoice-paid booking is not reported as missing from the cash box");
  assert.equal(full.waiting, 10000, "its share of a waiting invoice payment (25k × 100k ÷ 250k)");

  const halfInvoice = await invoiceOf(250000);
  const halfCash = await move({ sourceType: "sales_invoice", sourceId: String(halfInvoice), amount: 100000 });
  const fromHalf = await soundBooking({ sourceType: "sales_invoice", salesInvoiceId: halfInvoice }, 100000, 40000);
  const half = await bookingCashSummary(db, { entityType: "service_order", id: fromHalf, total: 100000, recorded: 40000 });
  assert.equal(half.approved, 40000, "the same share the invoice sync stores");
  assert.equal(half.state, "matched");
  assert.equal((await bookingCashSummary(db, { entityType: "service_order", id: fromHalf, total: 100000, recorded: 100000 })).state, "mismatch", "a booking that claims more than its share is still flagged");
  const thirdInvoice = await invoiceOf(300000);
  await move({ sourceType: "sales_invoice", sourceId: String(thirdInvoice), amount: 100000 });
  const fromThird = await soundBooking({ sourceType: "sales_invoice", salesInvoiceId: thirdInvoice }, 100000, 33333.33);
  assert.equal((await bookingCashSummary(db, { entityType: "service_order", id: fromThird, total: 100000, recorded: 33333.33 })).state, "matched", "rounded like the stored numeric(10,2) share");

  // Only a booking the invoice made is linked; another source's id is not an invoice.
  const lookalike = await soundBooking({ sourceType: "rental_order", sourceId: paidInvoice }, 100000, 0);
  const plain = await bookingCashSummary(db, { entityType: "service_order", id: lookalike, total: 100000, recorded: 0 });
  assert.equal(plain.invoice, null);
  assert.equal(plain.approved, 0);

  const invoiceCondition = await bookingTransactionCondition(db, "service_order", fromPaid);
  const invoiceScoped = new Set((await db.select().from(financialTransactionsTable).where(and(invoiceCondition, sql`${financialTransactionsTable.transactionNo} like ${`T-${stamp}-%`}`))).map((row: any) => Number(row.id)));
  for (const id of [invoiceCash, invoiceVoucherMove, invoicePending]) assert.ok(invoiceScoped.has(id), `invoice movement ${id} is listed with its booking`);
  assert.ok(!invoiceScoped.has(halfCash), "another invoice's cash stays out");
  const lookalikeScoped = new Set((await db.select().from(financialTransactionsTable).where(and(await bookingTransactionCondition(db, "service_order", lookalike), sql`${financialTransactionsTable.transactionNo} like ${`T-${stamp}-%`}`))).map((row: any) => Number(row.id)));
  assert.ok(!lookalikeScoped.has(invoiceCash), "a booking the invoice did not make lists none of its cash");

  const halfShares = await bookingRowShares(db, "service_order", fromHalf, 100000);
  assert.deepEqual(halfShares.shareOf({ sourceType: "sales_invoice", sourceId: String(halfInvoice), amount: "100000" }), { share: 40000, from: "sales_invoice" });
  const paidShares = await bookingRowShares(db, "service_order", fromPaid, 100000);
  assert.deepEqual(paidShares.shareOf({ sourceType: "receipt_voucher", sourceId: String(invoiceVoucherRow[0].id), amount: "50000" }), { share: 20000, from: "sales_invoice" }, "a voucher paid to the invoice counts at the booking's ratio");
  const kosha = await bookingRowShares(db, entity, booking, 500000);
  assert.deepEqual(kosha.shareOf({ sourceType: "receipt_voucher", sourceId: String(postedVoucher), amount: "100000" }), { share: 40000, from: "receipt_voucher" }, "a split voucher still shows the booking's part");
  assert.equal(kosha.shareOf({ sourceType: entity, sourceId: String(booking), amount: "100000" }), null, "a direct payment is the booking's in full");
  throw new Rollback();
} catch (cause) {
  await db.execute(sql`rollback`);
  if (!(cause instanceof Rollback)) { client.release(); await pool.end(); throw cause; }
}
client.release();
await pool.end();
console.log("PASS booking cash link on real PostgreSQL: same rule as reconcilePaymentState, shares, separate money, invoice-made bookings paid on their invoice, one definition of a booking's movements; rolled back");
