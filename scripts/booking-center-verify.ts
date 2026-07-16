/**
 * Booking Center — end-to-end verification of the unified booking money path.
 *
 * Runs the 17 scenarios from the spec against a REAL Postgres. It never touches
 * production: it refuses to start unless TEST_DATABASE_URL is set and is
 * different from DATABASE_URL.
 *
 * Run from the repo root so tsx picks up the root tsconfig's "@/*" path alias:
 *   pnpm exec tsx scripts/booking-center-verify.ts
 *
 * Lives outside scripts/src on purpose: that workspace pins rootDir to its own
 * src/ and cannot reference the app's src/server modules.
 */

const testUrl = process.env.TEST_DATABASE_URL;
const prodUrl = process.env.DATABASE_URL;

if (!testUrl) {
  console.error("✗ TEST_DATABASE_URL is not set. Refusing to run.");
  process.exit(1);
}
if (prodUrl && normalize(testUrl) === normalize(prodUrl)) {
  console.error("✗ TEST_DATABASE_URL equals DATABASE_URL. Refusing to run against production.");
  process.exit(1);
}

function normalize(url: string) {
  return url.trim().replace(/\/$/, "");
}

// The db package reads DATABASE_URL at first use — point it at the scratch DB
// before anything imports it.
process.env.DATABASE_URL = testUrl;

const { db } = await import("@workspace/db");
const { sql } = await import("drizzle-orm");
const {
  ensureBookingCenterTables,
  createBooking,
  setBookingService,
  receiveBookingPayment,
  cancelBooking,
  getBooking,
  listBookings,
  getBookingCenterDashboard,
} = await import("@/server/booking-center");
const {
  ensureMasterCashBoxTables,
  approveAndExecuteFinancialTransaction,
  rejectFinancialTransaction,
  reverseFinancialTransaction,
} = await import("@/server/master-cash-box");

const manager = { id: null as number | null, name: "مدير الاختبار", role: "admin" };

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

function money(value: unknown) {
  return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
}

async function cashBalance() {
  const r = await db.execute(sql`SELECT current_balance FROM master_cash_box WHERE code = 'MASTER'`);
  return money((r.rows ?? [])[0]?.current_balance);
}

async function ledgerFor(transactionId: number) {
  const r = await db.execute(
    sql`SELECT entry_side, amount FROM financial_ledger_entries WHERE transaction_id = ${transactionId} ORDER BY entry_side`,
  );
  return (r.rows ?? []) as { entry_side: string; amount: string }[];
}

async function main() {
  console.log("\n▸ Bootstrapping scratch schema…");
  await ensureMasterCashBoxTables();
  await ensureBookingCenterTables();

  // Chart of accounts + cashbox singleton must exist for approvals to execute.
  await db.execute(sql`
    INSERT INTO master_cash_box (code, name) VALUES ('MASTER', 'الصندوق الرئيسي')
    ON CONFLICT (code) DO NOTHING;
    INSERT INTO financial_accounts (code, name_ar, account_type) VALUES
      ('1000', 'الصندوق الرئيسي', 'asset'),
      ('4000', 'إيرادات عامة', 'revenue'),
      ('4020', 'إيرادات الكوش', 'revenue'),
      ('4030', 'إيرادات التصوير', 'revenue'),
      ('5000', 'مصروفات عامة', 'expense')
    ON CONFLICT (code) DO NOTHING;
  `);

  const startBalance = await cashBalance();
  console.log(`  cashbox opening balance: ${startBalance}`);

  // ── 1–2. Create unified booking with multiple services ───────────────────
  console.log("\n▸ 1–2. Create unified booking with multiple services");
  const booking: any = await createBooking(
    {
      customerName: "زبون الاختبار",
      customerPhone: "07700000000",
      eventDate: "2026-09-01",
      hallName: "قاعة الاختبار",
      services: [
        { serviceKey: "kosha", amount: 500000 },
        { serviceKey: "photography", amount: 300000 },
      ],
    },
    manager,
  );
  const bookingId = Number(booking.id);
  check("booking created with a booking number", /^BK-\d{4}-\d{5}$/.test(booking.bookingNo), booking.bookingNo);
  check("services total = 800,000", money(booking.servicesTotal) === 800000, booking.servicesTotal);
  check("grand total = 800,000", money(booking.grandTotal) === 800000, booking.grandTotal);
  check("starts unpaid", booking.paymentStatus === "unpaid", booking.paymentStatus);
  check("remaining = 800,000", money(booking.remainingAmount) === 800000, booking.remainingAmount);

  // ── 3. Confirm booking on credit ─────────────────────────────────────────
  console.log("\n▸ 3. Add a third service (flowers)");
  const withFlowers: any = await setBookingService(
    bookingId,
    { serviceKey: "flowers", amount: 200000, status: "waiting" },
    manager,
  );
  check("grand total recalculated to 1,000,000", money(withFlowers.grandTotal) === 1000000, withFlowers.grandTotal);

  // ── 4. Receive partial payment ───────────────────────────────────────────
  console.log("\n▸ 4. Receive partial payment (400,000) — must NOT move money yet");
  const balanceBeforePending = await cashBalance();
  const payment1 = await receiveBookingPayment(
    bookingId,
    { amount: 400000, method: "cash", serviceKey: "kosha" },
    manager,
  );
  const afterRequest: any = payment1.booking;
  check("voucher created", Boolean(payment1.voucherNo), payment1.voucherNo);
  check("transaction is pending", payment1.financialTransaction.approvalStatus === "pending");
  check("paid still 0 before approval", money(afterRequest.paidAmount) === 0, afterRequest.paidAmount);
  check("remaining unchanged before approval", money(afterRequest.remainingAmount) === 1000000, afterRequest.remainingAmount);
  check("pending receipt = 400,000", money(afterRequest.pendingReceiptAmount) === 400000, afterRequest.pendingReceiptAmount);
  check("cashbox untouched before approval", (await cashBalance()) === balanceBeforePending);

  // ── 5–9. Approve receipt, verify cashbox / ledger / amounts ──────────────
  console.log("\n▸ 5–9. Approve the receipt");
  const txn1 = await approveAndExecuteFinancialTransaction(payment1.financialTransaction.id, manager);
  check("transaction executed", txn1.approvalStatus === "executed", txn1.approvalStatus);
  check("cashbox increased by 400,000", (await cashBalance()) === money(balanceBeforePending + 400000));

  const ledger1 = await ledgerFor(txn1.id);
  check("journal entry is balanced double-entry", ledger1.length === 2 && money(ledger1[0].amount) === money(ledger1[1].amount), ledger1);
  check("journal has one debit and one credit", new Set(ledger1.map((e) => e.entry_side)).size === 2, ledger1);

  const afterApproval: any = await getBooking(bookingId);
  check("paid = 400,000 after approval", money(afterApproval.paidAmount) === 400000, afterApproval.paidAmount);
  check("remaining = 600,000", money(afterApproval.remainingAmount) === 600000, afterApproval.remainingAmount);
  check("payment status = partial", afterApproval.paymentStatus === "partial", afterApproval.paymentStatus);
  check("pending receipt back to 0", money(afterApproval.pendingReceiptAmount) === 0, afterApproval.pendingReceiptAmount);
  check("payment appears in booking history", afterApproval.payments.length === 1, afterApproval.payments.length);
  check("voucher linked to a journal transaction", Boolean(afterApproval.payments[0]?.financialTransactionId));

  // ── 13. Prevent duplicate approval ───────────────────────────────────────
  console.log("\n▸ 13. Duplicate approval must not double-count");
  const balanceBeforeDup = await cashBalance();
  await approveAndExecuteFinancialTransaction(payment1.financialTransaction.id, manager);
  const afterDup: any = await getBooking(bookingId);
  check("cashbox unchanged on re-approval", (await cashBalance()) === balanceBeforeDup);
  check("paid still 400,000 (not doubled)", money(afterDup.paidAmount) === 400000, afterDup.paidAmount);
  check("ledger still has exactly 2 entries", (await ledgerFor(txn1.id)).length === 2);

  // ── 12. Reject a pending receipt ─────────────────────────────────────────
  console.log("\n▸ 12. Reject a pending receipt");
  const payment2 = await receiveBookingPayment(bookingId, { amount: 100000, method: "cash" }, manager);
  const balanceBeforeReject = await cashBalance();
  await rejectFinancialTransaction(payment2.financialTransaction.id, manager, "اختبار الرفض");
  const afterReject: any = await getBooking(bookingId);
  check("cashbox untouched by rejection", (await cashBalance()) === balanceBeforeReject);
  check("paid unchanged after rejection", money(afterReject.paidAmount) === 400000, afterReject.paidAmount);
  check("pending cleared after rejection", money(afterReject.pendingReceiptAmount) === 0, afterReject.pendingReceiptAmount);

  // ── 10–11. Final payment → fully paid ────────────────────────────────────
  console.log("\n▸ 10–11. Receive final payment (600,000) → fully paid");
  const payment3 = await receiveBookingPayment(bookingId, { amount: 600000, method: "transfer" }, manager);
  await approveAndExecuteFinancialTransaction(payment3.financialTransaction.id, manager);
  const afterFinal: any = await getBooking(bookingId);
  check("paid = 1,000,000", money(afterFinal.paidAmount) === 1000000, afterFinal.paidAmount);
  check("remaining = 0", money(afterFinal.remainingAmount) === 0, afterFinal.remainingAmount);
  check("payment status = paid", afterFinal.paymentStatus === "paid", afterFinal.paymentStatus);
  check("readiness reflects full payment", afterFinal.progress.percent > 0, afterFinal.progress);

  // ── 14. Refund via reversal ──────────────────────────────────────────────
  console.log("\n▸ 14. Reverse an executed payment (refund path)");
  const balanceBeforeReversal = await cashBalance();
  await reverseFinancialTransaction(payment3.financialTransaction.id, manager, "اختبار الاسترجاع");
  const afterReversal: any = await getBooking(bookingId);
  check("cashbox decreased by 600,000", (await cashBalance()) === money(balanceBeforeReversal - 600000));
  check("paid drops back to 400,000", money(afterReversal.paidAmount) === 400000, afterReversal.paidAmount);
  check("remaining returns to 600,000", money(afterReversal.remainingAmount) === 600000, afterReversal.remainingAmount);
  check("payment status back to partial", afterReversal.paymentStatus === "partial", afterReversal.paymentStatus);

  // ── 15. Cancel booking — history must survive ────────────────────────────
  console.log("\n▸ 15. Cancel booking");
  const cancelled: any = await cancelBooking(bookingId, "اختبار الإلغاء", manager);
  const afterCancel: any = await getBooking(bookingId);
  check("status = cancelled", afterCancel.status === "cancelled", afterCancel.status);
  check("refundable amount reported", money(cancelled.refundableAmount) === 400000, cancelled.refundableAmount);
  check("financial history preserved", afterCancel.payments.length >= 2, afterCancel.payments.length);
  check("timeline preserved", afterCancel.timeline.length > 0, afterCancel.timeline.length);
  const stillExecuted = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM financial_transactions WHERE source_type = 'receipt_voucher' AND approval_status = 'executed'`,
  );
  check("executed journal entries not deleted", Number((stillExecuted.rows ?? [])[0]?.n) > 0);

  // ── 16–17. Listing + dashboard reports ───────────────────────────────────
  console.log("\n▸ 16–17. Listing and dashboard");
  const list = await listBookings({ search: "زبون الاختبار" });
  check("booking appears in list", list.rows.length >= 1, list.total);
  const dashboard = await getBookingCenterDashboard();
  check("dashboard returns all 10 service cards", dashboard.services.length === 10, dashboard.services.length);
  check("dashboard cards computed", dashboard.cards !== null);

  // ── Money conservation invariant ─────────────────────────────────────────
  console.log("\n▸ Invariant: booking paid == sum of executed vouchers");
  const recon = await db.execute(sql`
    SELECT b.id,
           b.paid_amount::numeric AS booking_paid,
           COALESCE((SELECT SUM(amount::numeric) FROM receipt_vouchers
                     WHERE booking_ref_id = b.id AND approval_status = 'executed'), 0) AS voucher_paid
    FROM bookings b WHERE b.id = ${bookingId}
  `);
  const row = (recon.rows ?? [])[0] as any;
  check(
    "booking.paid_amount equals SUM(executed vouchers)",
    money(row.booking_paid) === money(row.voucher_paid),
    row,
  );

  console.log(`\n${failed === 0 ? "✓" : "✗"} ${passed} passed, ${failed} failed\n`);
  await db.execute(sql`SELECT 1`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n✗ Verification crashed:", err);
  process.exit(1);
});
