import { randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  gte,
  gt,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  customerBalanceRepairBatchesTable,
  customerBalanceRepairItemsTable,
  customerReceivableLedgerTable,
  customersTable,
  db,
  financialAuditLogsTable,
  financialTransactionsTable,
  receiptVoucherAllocationsTable,
  receiptVouchersTable,
  salesInvoicesTable,
} from "@workspace/db";

export const CUSTOMER_RECEIVABLE_BACKFILL_VERSION = "sales-receivables-v1";

export type RepairActor = { id: number | null; name: string };
export type RepairFilters = {
  from?: string;
  to?: string;
  customerId?: number;
  invoiceId?: number;
  limit?: number;
};

type CustomerCandidate = {
  id: number;
  phone: string;
  name: string;
  fullName: string | null;
};

type InvoiceLike = {
  id: number;
  invoiceNo: string;
  date: string;
  customerId: number | null;
  customerName: string;
  customerPhone: string | null;
  total: string;
  paidAmount: string;
  remainingAmount: string;
  paymentStatus: string;
  status: string;
  financiallyReversed: boolean;
  notes: string | null;
};

type FinancialLike = {
  id: number;
  sourceType: string | null;
  sourceId: string | null;
  sourceEvent: string;
  transactionType: string;
  direction: string;
  amount: string;
  approvalStatus: string;
  customerId: number | null;
  reversedAt: Date | null;
  reversalTxnId: number | null;
};

export type HistoricalReceivableResult = {
  invoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;
  originalCustomerId: number | null;
  customerId: number | null;
  customer: string;
  matchMethod: string | null;
  invoiceTotal: number;
  headerPaidAmount: number;
  existingPayments: number;
  returns: number;
  creditNotes: number;
  adjustments: number;
  calculatedOutstanding: number;
  existingRemaining: number;
  existingLedgerStatus: string;
  proposedAction:
    | "backfill_open"
    | "backfill_paid"
    | "manual_review"
    | "skip_existing"
    | "skip_cancelled";
  warning: string[];
  error: string[];
};

export type HistoricalReceivableSummary = {
  invoicesScanned: number;
  missingLedgerEntries: number;
  fullyPaidInvoices: number;
  partiallyPaidInvoices: number;
  unpaidInvoices: number;
  invoicesMissingCustomerId: number;
  ambiguousCustomerMatches: number;
  manualReviewInvoices: number;
  repairableInvoices: number;
  skippedInvoices: number;
  repairedInvoices: number;
  failedInvoices: number;
  totalReceivableToRestore: number;
  totalReceivableRestored: number;
};

export type HistoricalReceivableReport = {
  batchId: string;
  mode: "dry_run" | "execute";
  backfillVersion: string;
  generatedAt: string;
  filters: RepairFilters;
  schemaReady: boolean;
  summary: HistoricalReceivableSummary;
  invoices: HistoricalReceivableResult[];
};

function money(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? 0));
  return Number.isFinite(parsed)
    ? Math.round((parsed + Number.EPSILON) * 100) / 100
    : 0;
}

function normalizedPhone(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function normalizedName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ar")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

export function calculateHistoricalOutstanding(input: {
  invoiceTotal: number;
  headerPaidAmount: number;
  allPostedAllocations: number;
  validPostedAllocations: number;
  executedInvoicePayment: number;
  returns: number;
  creditNotes: number;
  adjustments: number;
}) {
  const initialHeaderPayment = Math.max(
    0,
    money(input.headerPaidAmount - input.allPostedAllocations),
  );
  const initialPayment = Math.max(
    initialHeaderPayment,
    money(input.executedInvoicePayment),
  );
  const validPayments = money(initialPayment + input.validPostedAllocations);
  const deductions = money(
    validPayments + input.returns + input.creditNotes + input.adjustments,
  );
  return {
    validPayments,
    deductions,
    inconsistent: deductions > money(input.invoiceTotal) + 0.009,
    outstanding: money(Math.max(0, input.invoiceTotal - deductions)),
  };
}

export function resolveHistoricalCustomer(input: {
  invoice: Pick<InvoiceLike, "customerId" | "customerPhone" | "customerName" | "notes">;
  customers: CustomerCandidate[];
  transactionCustomerIds: number[];
}) {
  const byId = new Map(input.customers.map((customer) => [customer.id, customer]));
  if (input.invoice.customerId && byId.has(input.invoice.customerId))
    return { customer: byId.get(input.invoice.customerId)!, method: "customer_id", ambiguous: false };

  const transactionIds = [...new Set(input.transactionCustomerIds.filter((id) => byId.has(id)))];
  if (transactionIds.length === 1)
    return { customer: byId.get(transactionIds[0])!, method: "financial_customer_id", ambiguous: false };
  if (transactionIds.length > 1)
    return { customer: null, method: "financial_customer_id", ambiguous: true };

  const phone = normalizedPhone(input.invoice.customerPhone);
  if (phone) {
    const matches = input.customers.filter((customer) => normalizedPhone(customer.phone) === phone);
    if (matches.length === 1)
      return { customer: matches[0], method: "exact_phone", ambiguous: false };
    if (matches.length > 1)
      return { customer: null, method: "exact_phone", ambiguous: true };
  }

  const accountText = `${input.invoice.customerName ?? ""} ${input.invoice.notes ?? ""}`;
  const accountMatch = accountText.match(/\bCUS-0*(\d+)\b/i);
  if (accountMatch) {
    const id = Number(accountMatch[1]);
    if (byId.has(id)) return { customer: byId.get(id)!, method: "account_number", ambiguous: false };
  }

  const name = normalizedName(input.invoice.customerName);
  if (name) {
    const matches = input.customers.filter(
      (customer) =>
        normalizedName(customer.fullName) === name || normalizedName(customer.name) === name,
    );
    if (matches.length === 1)
      return { customer: matches[0], method: "exact_normalized_name", ambiguous: false };
    if (matches.length > 1)
      return { customer: null, method: "exact_normalized_name", ambiguous: true };
  }

  return { customer: null, method: null, ambiguous: false };
}

async function repairSchemaReady(): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT to_regclass('public.customer_receivable_ledger') IS NOT NULL
      AND to_regclass('public.customer_balance_repair_batches') IS NOT NULL
      AND to_regclass('public.customer_balance_repair_items') IS NOT NULL AS ready
  `);
  return Boolean((result.rows?.[0] as any)?.ready);
}

function activeFinancial(row: FinancialLike) {
  return (
    row.approvalStatus === "executed" &&
    !row.reversedAt &&
    !row.reversalTxnId
  );
}

function signedAmount(rows: FinancialLike[]) {
  return money(
    rows
      // Include an executed original together with its executed reversal so
      // they net to zero. A reversed original without a recorded reversal is
      // excluded and will be surfaced elsewhere for manual review.
      .filter(
        (row) =>
          row.approvalStatus === "executed" &&
          (!row.reversedAt || Boolean(row.reversalTxnId)),
      )
      .reduce(
        (sum, row) => sum + (row.direction === "expense" ? -money(row.amount) : money(row.amount)),
        0,
      ),
  );
}

function emptySummary(): HistoricalReceivableSummary {
  return {
    invoicesScanned: 0,
    missingLedgerEntries: 0,
    fullyPaidInvoices: 0,
    partiallyPaidInvoices: 0,
    unpaidInvoices: 0,
    invoicesMissingCustomerId: 0,
    ambiguousCustomerMatches: 0,
    manualReviewInvoices: 0,
    repairableInvoices: 0,
    skippedInvoices: 0,
    repairedInvoices: 0,
    failedInvoices: 0,
    totalReceivableToRestore: 0,
    totalReceivableRestored: 0,
  };
}

export async function previewHistoricalCustomerReceivables(
  filters: RepairFilters = {},
): Promise<HistoricalReceivableReport> {
  const schemaReady = await repairSchemaReady();
  const limit = Math.min(100_000, Math.max(1, Math.floor(filters.limit ?? 5_000)));
  const invoiceConditions = [gt(salesInvoicesTable.total, "0")];
  if (filters.from) invoiceConditions.push(gte(salesInvoicesTable.date, filters.from));
  if (filters.to) invoiceConditions.push(lte(salesInvoicesTable.date, filters.to));
  if (filters.invoiceId) invoiceConditions.push(eq(salesInvoicesTable.id, filters.invoiceId) as any);

  const invoices = (await db.query.salesInvoicesTable.findMany({
    where: and(...invoiceConditions),
    orderBy: [desc(salesInvoicesTable.date), desc(salesInvoicesTable.id)],
    limit,
  })) as InvoiceLike[];
  const invoiceIds = invoices.map((invoice) => invoice.id);
  const invoiceIdStrings = invoiceIds.map(String);
  const customers = (await db.query.customersTable.findMany({ limit: 100_000 })) as CustomerCandidate[];
  const allocations = invoiceIds.length
    ? await db.query.receiptVoucherAllocationsTable.findMany({
        where: and(
          eq(receiptVoucherAllocationsTable.sourceType, "sales_invoice"),
          inArray(receiptVoucherAllocationsTable.sourceId, invoiceIds),
        ),
        limit: 100_000,
      })
    : [];
  const voucherIds = [...new Set(allocations.map((row) => row.receiptVoucherId))];
  const vouchers = voucherIds.length
    ? await db.query.receiptVouchersTable.findMany({
        where: inArray(receiptVouchersTable.id, voucherIds),
        limit: 100_000,
      })
    : [];
  const exactReferenceReceipts = invoices.length
    ? await db.query.receiptVouchersTable.findMany({ limit: 100_000 })
    : [];
  const financialRows = invoiceIds.length
    ? ((await db.query.financialTransactionsTable.findMany({
        where: or(
          and(
            eq(financialTransactionsTable.sourceType, "sales_invoice"),
            inArray(financialTransactionsTable.sourceId, invoiceIdStrings),
          ),
          voucherIds.length
            ? and(
                eq(financialTransactionsTable.sourceType, "receipt_voucher"),
                inArray(financialTransactionsTable.sourceId, voucherIds.map(String)),
              )
            : undefined,
        ),
        limit: 100_000,
      })) as FinancialLike[])
    : [];
  const ledgers = schemaReady && invoiceIds.length
    ? await db.query.customerReceivableLedgerTable.findMany({
        where: inArray(customerReceivableLedgerTable.invoiceId, invoiceIds),
        limit: 100_000,
      })
    : [];

  const voucherMap = new Map(vouchers.map((voucher) => [voucher.id, voucher]));
  const financialById = new Map(financialRows.map((row) => [row.id, row]));
  const results: HistoricalReceivableResult[] = [];

  for (const invoice of invoices) {
    const invoiceTransactions = financialRows.filter(
      (row) => row.sourceType === "sales_invoice" && row.sourceId === String(invoice.id),
    );
    const match = resolveHistoricalCustomer({
      invoice,
      customers,
      transactionCustomerIds: invoiceTransactions
        .map((row) => row.customerId)
        .filter((id): id is number => Boolean(id)),
    });
    if (filters.customerId && match.customer?.id !== filters.customerId) continue;

    const warnings: string[] = [];
    const errors: string[] = [];
    const invoiceAllocations = allocations.filter((row) => row.sourceId === invoice.id);
    const allPostedAllocations = money(
      invoiceAllocations
        .filter((row) => row.postedAt)
        .reduce((sum, row) => sum + money(row.amount), 0),
    );
    let validPostedAllocations = 0;
    for (const allocation of invoiceAllocations) {
      if (!allocation.postedAt) continue;
      const voucher = voucherMap.get(allocation.receiptVoucherId);
      const transaction = voucher?.financialTransactionId
        ? financialById.get(voucher.financialTransactionId)
        : financialRows.find(
            (row) =>
              row.sourceType === "receipt_voucher" &&
              row.sourceId === String(allocation.receiptVoucherId),
          );
      const valid =
        voucher?.approvalStatus === "executed" &&
        (!transaction || activeFinancial(transaction));
      if (valid) validPostedAllocations = money(validPostedAllocations + money(allocation.amount));
      if (match.customer && allocation.customerId !== match.customer.id)
        errors.push("يوجد سند قبض مرتبط بعميل مختلف عن العميل المطابق للفاتورة");
    }

    const paymentTransactions = invoiceTransactions.filter(
      (row) => row.sourceEvent === "payment" && !/_reversal$/.test(row.transactionType),
    );
    const returnTransactions = invoiceTransactions.filter((row) =>
      /sales_return|sale_return|return_note/i.test(`${row.transactionType}:${row.sourceEvent}`),
    );
    const creditTransactions = invoiceTransactions.filter((row) =>
      /credit_note/i.test(`${row.transactionType}:${row.sourceEvent}`),
    );
    const adjustmentTransactions = invoiceTransactions.filter((row) =>
      /receivable_adjustment|customer_adjustment/i.test(`${row.transactionType}:${row.sourceEvent}`),
    );
    const returns = Math.abs(signedAmount(returnTransactions));
    const creditNotes = Math.abs(signedAmount(creditTransactions));
    const adjustments = Math.abs(signedAmount(adjustmentTransactions));
    const calculation = calculateHistoricalOutstanding({
      invoiceTotal: money(invoice.total),
      headerPaidAmount: money(invoice.paidAmount),
      allPostedAllocations,
      validPostedAllocations,
      executedInvoicePayment: Math.max(0, signedAmount(paymentTransactions)),
      returns,
      creditNotes,
      adjustments,
    });

    const ledgerRows = ledgers.filter((row) => row.invoiceId === invoice.id);
    const receivableTransactions = invoiceTransactions.filter((row) =>
      row.sourceEvent === "receivable" ||
      /receivable|historical_backfill/i.test(row.transactionType),
    );
    const referencedUnallocated = exactReferenceReceipts.filter((voucher) => {
      const reference = String(voucher.reference ?? "").trim();
      return (
        voucher.approvalStatus === "executed" &&
        (reference === invoice.invoiceNo || reference.startsWith(`${invoice.invoiceNo} `)) &&
        !allocations.some((allocation) => allocation.receiptVoucherId === voucher.id)
      );
    });
    if (referencedUnallocated.length)
      errors.push("توجد سندات قبض تشير إلى الفاتورة من دون توزيع موثوق");
    if (calculation.inconsistent)
      errors.push("إجمالي الدفعات والمرتجعات والتسويات أكبر من إجمالي الفاتورة");
    if (invoice.financiallyReversed)
      errors.push("الفاتورة معلّمة كمعكوسة مالياً وتحتاج مراجعة");
    if (match.ambiguous) errors.push("توجد أكثر من مطابقة محتملة للعميل");
    if (!match.customer) errors.push("تعذر تحديد العميل بشكل آمن");
    if (ledgerRows.length > 1) errors.push("توجد قيود ذمة مكررة للفاتورة");

    const activeTransactions = invoiceTransactions.some(activeFinancial);
    const cancelled = ["cancelled", "canceled", "deleted"].includes(invoice.status);
    if (cancelled && activeTransactions)
      errors.push("الفاتورة ملغاة لكن ما زالت تحتوي حركات مالية فعالة");

    let proposedAction: HistoricalReceivableResult["proposedAction"];
    let existingLedgerStatus = "missing";
    if (ledgerRows.length === 1) {
      proposedAction = "skip_existing";
      existingLedgerStatus = ledgerRows[0].status;
      warnings.push("يوجد قيد ذمة سابق؛ لن تتم إعادة إنشائه");
    } else if (receivableTransactions.length) {
      proposedAction = "skip_existing";
      existingLedgerStatus = "financial_receivable_exists";
      warnings.push("توجد حركة ذمة مالية سابقة؛ لن تتم إعادة ترحيلها");
    } else if (cancelled && !errors.length) {
      proposedAction = "skip_cancelled";
      existingLedgerStatus = "cancelled";
    } else if (errors.length) {
      proposedAction = "manual_review";
      existingLedgerStatus = ledgerRows.length > 1 ? "duplicate" : "manual_review";
    } else {
      proposedAction = calculation.outstanding > 0 ? "backfill_open" : "backfill_paid";
    }

    results.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNo,
      invoiceDate: invoice.date,
      originalCustomerId: invoice.customerId,
      customerId: match.customer?.id ?? null,
      customer: match.customer?.fullName || match.customer?.name || invoice.customerName || "—",
      matchMethod: match.method,
      invoiceTotal: money(invoice.total),
      headerPaidAmount: money(invoice.paidAmount),
      existingPayments: calculation.validPayments,
      returns,
      creditNotes,
      adjustments,
      calculatedOutstanding: calculation.outstanding,
      existingRemaining: money(invoice.remainingAmount),
      existingLedgerStatus,
      proposedAction,
      warning: [...new Set(warnings)],
      error: [...new Set(errors)],
    });
  }

  const summary = emptySummary();
  summary.invoicesScanned = results.length;
  for (const row of results) {
    const missing = ["backfill_open", "backfill_paid", "manual_review"].includes(row.proposedAction);
    if (missing) summary.missingLedgerEntries += 1;
    if (!row.originalCustomerId) summary.invoicesMissingCustomerId += 1;
    if (row.error.some((message) => message.includes("أكثر من مطابقة")))
      summary.ambiguousCustomerMatches += 1;
    if (row.calculatedOutstanding <= 0) summary.fullyPaidInvoices += 1;
    else if (row.existingPayments > 0 || row.returns > 0 || row.creditNotes > 0)
      summary.partiallyPaidInvoices += 1;
    else summary.unpaidInvoices += 1;
    if (row.proposedAction === "manual_review") summary.manualReviewInvoices += 1;
    if (["skip_existing", "skip_cancelled"].includes(row.proposedAction)) summary.skippedInvoices += 1;
    if (["backfill_open", "backfill_paid"].includes(row.proposedAction)) {
      summary.repairableInvoices += 1;
      summary.totalReceivableToRestore = money(
        summary.totalReceivableToRestore + row.calculatedOutstanding,
      );
    }
  }

  return {
    batchId: `RCV-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`,
    mode: "dry_run",
    backfillVersion: CUSTOMER_RECEIVABLE_BACKFILL_VERSION,
    generatedAt: new Date().toISOString(),
    filters: { ...filters, limit },
    schemaReady,
    summary,
    invoices: results,
  };
}

async function customerOutstanding(executor: any, customerId: number) {
  const result = await executor.execute(sql`
    WITH selected_customer AS (
      SELECT id, phone FROM customers WHERE id = ${customerId}
    ), balances AS (
      SELECT remaining_amount::numeric AS remaining FROM sales_invoices
        WHERE customer_id = ${customerId} AND status = 'active' AND financially_reversed = false
      UNION ALL SELECT remaining_amount::numeric FROM orders
        WHERE customer_id = ${customerId} AND archived_at IS NULL AND status <> 'cancelled'
      UNION ALL SELECT remaining_amount::numeric FROM kosha_bookings
        WHERE customer_id = ${customerId} AND archived_at IS NULL AND status <> 'cancelled'
      UNION ALL SELECT remaining_amount::numeric FROM graduation_orders
        WHERE customer_id = ${customerId} AND archived_at IS NULL AND status <> 'cancelled'
      UNION ALL SELECT so.remaining_amount::numeric FROM service_orders so, selected_customer c
        WHERE right(regexp_replace(coalesce(so.phone, ''), '[^0-9]', '', 'g'), 10)
          = right(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), 10)
          AND so.archived_at IS NULL AND so.status <> 'cancelled'
    ) SELECT coalesce(sum(greatest(remaining, 0)), 0)::float AS balance FROM balances
  `);
  return money((result.rows?.[0] as any)?.balance);
}

export async function executeHistoricalCustomerReceivableRepair(
  filters: RepairFilters,
  actor: RepairActor,
): Promise<HistoricalReceivableReport> {
  const preview = await previewHistoricalCustomerReceivables(filters);
  if (!preview.schemaReady)
    throw new Error(
      "جداول الإصلاح غير موجودة. طبّق migration 0063_historical_customer_receivables.sql أولاً ثم أعد التنفيذ.",
    );

  const batchId = preview.batchId;
  await db.insert(customerBalanceRepairBatchesTable).values({
    batchId,
    mode: "execute",
    backfillVersion: CUSTOMER_RECEIVABLE_BACKFILL_VERSION,
    filters,
    summary: preview.summary,
    status: "running",
    executedBy: actor.id,
    executedByName: actor.name,
  });

  const summary = { ...preview.summary };
  for (const item of preview.invoices) {
    if (!["backfill_open", "backfill_paid"].includes(item.proposedAction)) {
      await db.insert(customerBalanceRepairItemsTable).values({
        batchId,
        invoiceId: item.invoiceId,
        customerId: item.customerId,
        result: item.proposedAction === "manual_review" ? "manual_review" : "skipped",
        proposedAction: item.proposedAction,
        outstandingRestored: "0",
        existingPayments: String(item.existingPayments),
        returnsDetected: String(item.returns),
        warnings: item.warning,
        errors: item.error,
      });
      continue;
    }
    if (!item.customerId) continue;

    try {
      const repaired = await db.transaction(async (tx) => {
        const locked = await tx.execute(sql`
          SELECT id, customer_id, total::numeric AS total, paid_amount::numeric AS paid_amount,
            remaining_amount::numeric AS remaining_amount, status, financially_reversed
          FROM sales_invoices WHERE id = ${item.invoiceId} FOR UPDATE
        `);
        const invoice = locked.rows?.[0] as any;
        if (!invoice) throw new Error("الفاتورة لم تعد موجودة");
        if (["cancelled", "canceled", "deleted"].includes(String(invoice.status)))
          throw new Error("تغيّرت حالة الفاتورة إلى ملغاة أثناء التنفيذ");
        if (invoice.financially_reversed)
          throw new Error("تم عكس الفاتورة مالياً أثناء التنفيذ");
        if (money(invoice.total) !== item.invoiceTotal)
          throw new Error("تغيّر إجمالي الفاتورة بعد المعاينة؛ أعد Dry Run");

        const duplicate = await tx.execute(sql`
          SELECT id FROM customer_receivable_ledger
          WHERE invoice_id = ${item.invoiceId} AND source_type = 'sales_invoice'
          FOR UPDATE
        `);
        if ((duplicate.rows ?? []).length)
          return { duplicate: true, oldBalance: null, newBalance: null };

        const oldBalance = await customerOutstanding(tx, item.customerId!);
        const paymentStatus = item.calculatedOutstanding <= 0
          ? "paid"
          : item.existingPayments > 0 || item.returns > 0 || item.creditNotes > 0
            ? "partial"
            : "unpaid";
        await tx
          .update(salesInvoicesTable)
          .set({
            customerId: item.customerId!,
            paidAmount: String(item.existingPayments),
            remainingAmount: String(item.calculatedOutstanding),
            paymentStatus,
            updatedAt: new Date(),
          })
          .where(eq(salesInvoicesTable.id, item.invoiceId));

        const idempotencyKey = `sales-invoice-ledger:${item.invoiceId}`;
        const [ledger] = await tx
          .insert(customerReceivableLedgerTable)
          .values({
            idempotencyKey,
            customerId: item.customerId!,
            invoiceId: item.invoiceId,
            invoiceNumber: item.invoiceNumber,
            invoiceDate: item.invoiceDate,
            sourceType: "sales_invoice",
            entryType: "sales_invoice_historical_backfill",
            invoiceTotal: String(item.invoiceTotal),
            validPayments: String(item.existingPayments),
            returnsAmount: String(item.returns),
            creditNotesAmount: String(item.creditNotes),
            adjustmentsAmount: String(item.adjustments),
            debitAmount: String(item.calculatedOutstanding),
            creditAmount: "0",
            remainingAmount: String(item.calculatedOutstanding),
            status: item.calculatedOutstanding > 0 ? "open" : "paid",
            batchId,
            createdBy: actor.id,
            createdByName: actor.name,
            backfillVersion: CUSTOMER_RECEIVABLE_BACKFILL_VERSION,
            metadata: {
              matchMethod: item.matchMethod,
              previousCustomerId: invoice.customer_id,
              previousPaidAmount: money(invoice.paid_amount),
              previousRemainingAmount: money(invoice.remaining_amount),
              warnings: item.warning,
            },
          })
          .returning();
        const newBalance = await customerOutstanding(tx, item.customerId!);

        await tx.insert(financialAuditLogsTable).values({
          transactionId: null,
          action: "customer_receivable_historical_backfill",
          actorId: actor.id,
          actorName: actor.name,
          oldValues: {
            batchId,
            invoiceId: item.invoiceId,
            customerId: invoice.customer_id,
            paidAmount: money(invoice.paid_amount),
            remainingAmount: money(invoice.remaining_amount),
            customerBalance: oldBalance,
          },
          newValues: {
            batchId,
            invoiceId: item.invoiceId,
            customerId: item.customerId,
            paidAmount: item.existingPayments,
            remainingAmount: item.calculatedOutstanding,
            customerBalance: newBalance,
            ledgerId: ledger.id,
            backfillVersion: CUSTOMER_RECEIVABLE_BACKFILL_VERSION,
          },
          reason: "إعادة بناء ذمة فاتورة مبيعات تاريخية من دون إعادة ترحيل الإيراد أو النقد",
        });
        await tx.insert(customerBalanceRepairItemsTable).values({
          batchId,
          invoiceId: item.invoiceId,
          customerId: item.customerId,
          result: "repaired",
          proposedAction: item.proposedAction,
          oldBalance: String(oldBalance),
          newBalance: String(newBalance),
          outstandingRestored: String(item.calculatedOutstanding),
          existingPayments: String(item.existingPayments),
          returnsDetected: String(item.returns),
          warnings: item.warning,
          errors: [],
        });
        return { duplicate: false, oldBalance, newBalance };
      });

      if (repaired.duplicate) {
        summary.skippedInvoices += 1;
        await db
          .insert(customerBalanceRepairItemsTable)
          .values({
            batchId,
            invoiceId: item.invoiceId,
            customerId: item.customerId,
            result: "skipped",
            proposedAction: "skip_existing",
            outstandingRestored: "0",
            existingPayments: String(item.existingPayments),
            returnsDetected: String(item.returns),
            warnings: [...item.warning, "تم إنشاء قيد الذمة مسبقاً أثناء تنفيذ دفعة أخرى"],
            errors: [],
          })
          .onConflictDoNothing();
      } else {
        summary.repairedInvoices += 1;
        summary.totalReceivableRestored = money(
          summary.totalReceivableRestored + item.calculatedOutstanding,
        );
      }
    } catch (error) {
      summary.failedInvoices += 1;
      const message = error instanceof Error ? error.message : "فشل غير معروف";
      await db
        .insert(customerBalanceRepairItemsTable)
        .values({
          batchId,
          invoiceId: item.invoiceId,
          customerId: item.customerId,
          result: "failed",
          proposedAction: item.proposedAction,
          outstandingRestored: "0",
          existingPayments: String(item.existingPayments),
          returnsDetected: String(item.returns),
          warnings: item.warning,
          errors: [message],
        })
        .onConflictDoNothing();
      item.error = [...item.error, message];
    }
  }

  await db
    .update(customerBalanceRepairBatchesTable)
    .set({
      summary,
      status: summary.failedInvoices > 0 ? "completed_with_errors" : "completed",
      completedAt: new Date(),
    })
    .where(eq(customerBalanceRepairBatchesTable.batchId, batchId));

  return {
    ...preview,
    batchId,
    mode: "execute",
    generatedAt: new Date().toISOString(),
    summary,
  };
}
