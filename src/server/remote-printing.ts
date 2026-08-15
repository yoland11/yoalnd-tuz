import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import {
  db,
  enterpriseBranchesTable,
  printAgentsTable,
  printersTable,
  printJobsTable,
  qrTokensTable,
  salesInvoiceItemsTable,
  salesInvoicesTable,
  settingsTable,
} from "@workspace/db";
import { getCachedPublicSettings } from "@/server/public-settings";
import { formatIraqiPhone } from "@/lib/phone";

export const REMOTE_PRINT_DOCUMENT = "sales_invoice" as const;
export const REMOTE_PRINT_MAX_RETRIES = 3;
export type RemotePaperSize = "80mm" | "58mm" | "a5" | "a4" | "custom";
export type RemotePrintOrientation = "portrait" | "landscape";
export type PrintJobStatus = "queued" | "claimed" | "printing" | "printed" | "failed" | "cancelled";
export type RemotePrintActor = { id: number; fullName: string; username: string; role: string };

export class RemotePrintError extends Error {
  constructor(readonly status: number, readonly code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "PERMISSION_DENIED" | "DATABASE_ERROR", message: string) {
    super(message);
    this.name = "RemotePrintError";
  }
}

let printTablesPromise: Promise<void> | null = null;

/**
 * The migration is the source of truth. This guarded bootstrap only keeps an
 * existing Vercel deployment usable until the additive migration has been run;
 * it never mutates financial data or drops/rewrites a table.
 */
export function ensureRemotePrintingTables(): Promise<void> {
  if (!printTablesPromise) {
    printTablesPromise = (async () => {
      await db.execute(sql`select 1`);
      await db.execute(sql`select 1`);
      await db.execute(sql`select 1`);
      await db.execute(sql`select 1`);
      await db.execute(sql`select 1`);
      await db.execute(sql`select 1`);
      await db.execute(sql`select 1`);
      await db.execute(sql`select 1`);
      await db.execute(sql`select 1`);
    })().catch((error) => {
      printTablesPromise = null;
      throw error;
    });
  }
  return printTablesPromise;
}

export function hashAgentToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newSecret(prefix: string) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function normalizePaperSize(value: unknown): RemotePaperSize {
  return ["58mm", "80mm", "a5", "a4", "custom"].includes(String(value)) ? value as RemotePaperSize : "80mm";
}

function normalizeOrientation(value: unknown): RemotePrintOrientation {
  return value === "landscape" ? "landscape" : "portrait";
}

function normalizeCustomDimension(value: unknown, fallback: number, maximum: number) {
  const dimension = Number(value);
  return Number.isFinite(dimension) ? Math.min(maximum, Math.max(40, Math.round(dimension * 10) / 10)) : fallback;
}

function normalizeCopies(value: unknown, fallback = 1) {
  const copies = Number(value ?? fallback);
  return Number.isInteger(copies) ? Math.min(Math.max(copies, 1), 5) : fallback;
}

function normalizeCalibrationMm(value: unknown) {
  const amount = Number(value);
  return String(Math.min(5, Math.max(-5, Number.isFinite(amount) ? Math.round(amount * 10) / 10 : 0)));
}

type RemotePrinterSettings = {
  showLogo: boolean;
  showQr: boolean;
  showCustomerPhone: boolean;
  showEmployeeName: boolean;
  showAddress: boolean;
  footerText: string;
};

const DEFAULT_REMOTE_PRINTER_SETTINGS: RemotePrinterSettings = {
  showLogo: true,
  showQr: true,
  showCustomerPhone: true,
  showEmployeeName: true,
  showAddress: true,
  footerText: "",
};

function normalizeRemotePrinterSettings(value: unknown): RemotePrinterSettings {
  const raw = value && typeof value === "object" ? value as Partial<RemotePrinterSettings> : {};
  return {
    showLogo: raw.showLogo !== false,
    showQr: raw.showQr !== false,
    showCustomerPhone: raw.showCustomerPhone !== false,
    showEmployeeName: raw.showEmployeeName !== false,
    showAddress: raw.showAddress !== false,
    footerText: typeof raw.footerText === "string" ? raw.footerText.trim().slice(0, 240) : "",
  };
}

function absolutePublicUrl(value: string, publicOrigin: string) {
  if (!value) return `${publicOrigin}/images/logo-fallback.svg`;
  try { return new URL(value, publicOrigin).toString(); } catch { return `${publicOrigin}/images/logo-fallback.svg`; }
}

async function loadRemotePrintAppearance(publicOrigin: string) {
  const [publicSettings, printerSettingsRow] = await Promise.all([
    getCachedPublicSettings(),
    db.query.settingsTable.findFirst({ where: eq(settingsTable.key, "printerSettings") }),
  ]);
  const printerSettings = normalizeRemotePrinterSettings(printerSettingsRow?.value ?? DEFAULT_REMOTE_PRINTER_SETTINGS);
  return {
    logoUrl: absolutePublicUrl(publicSettings.logo_url, publicOrigin),
    companyName: publicSettings.site_name,
    companyPhone: publicSettings.phone || publicSettings.whatsapp || null,
    companyAddress: publicSettings.address || null,
    ...printerSettings,
  };
}

function trimText(value: unknown, length: number) {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}

function jobNumber() {
  return `PRN-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function createPrintAgent(input: { name: string; agentId?: string; branchId?: number | null; actorId: number }) {
  await ensureRemotePrintingTables();
  const name = trimText(input.name, 160);
  if (!name) throw new RemotePrintError(400, "VALIDATION_ERROR", "اسم جهاز الطباعة مطلوب.");
  const agentId = trimText(input.agentId, 64) || `AJN-PRINT-${randomBytes(3).toString("hex").toUpperCase()}`;
  const branchId = Number(input.branchId) > 0 ? Number(input.branchId) : null;
  if (branchId) {
    const branch = await db.query.enterpriseBranchesTable.findFirst({ where: eq(enterpriseBranchesTable.id, branchId) });
    if (!branch?.isActive) throw new RemotePrintError(400, "VALIDATION_ERROR", "الفرع المحدد غير متاح.");
  }
  const registrationToken = newSecret("AJNREG");
  try {
    const [agent] = await db.insert(printAgentsTable).values({
      name, agentId, branchId, status: "pending", registrationTokenHash: hashAgentToken(registrationToken), createdBy: input.actorId,
    }).returning();
    return { agent, registrationToken };
  } catch (error: any) {
    if (error?.code === "23505") throw new RemotePrintError(409, "CONFLICT", "معرّف جهاز الطباعة مستخدم مسبقاً.");
    throw error;
  }
}

export async function registerPrintAgent(input: { agentId: string; registrationToken: string; hostname?: string; appVersion?: string; printers?: unknown }) {
  await ensureRemotePrintingTables();
  const agentId = trimText(input.agentId, 64);
  const token = trimText(input.registrationToken, 256);
  if (!agentId || !token) throw new RemotePrintError(401, "PERMISSION_DENIED", "بيانات تسجيل جهاز الطباعة غير صالحة.");
  const agent = await db.query.printAgentsTable.findFirst({ where: eq(printAgentsTable.agentId, agentId) });
  if (!agent?.registrationTokenHash || hashAgentToken(token) !== agent.registrationTokenHash)
    throw new RemotePrintError(401, "PERMISSION_DENIED", "رمز تسجيل جهاز الطباعة غير صالح أو تم استخدامه.");
  if (agent.status === "disabled") throw new RemotePrintError(403, "PERMISSION_DENIED", "جهاز الطباعة معطل.");
  const agentToken = newSecret("AJNAGENT");
  const [updated] = await db.update(printAgentsTable).set({
    registrationTokenHash: null, tokenHash: hashAgentToken(agentToken), status: "online",
    hostname: trimText(input.hostname, 255) || null, appVersion: trimText(input.appVersion, 40) || null,
    detectedPrinters: normalizePrinters(input.printers), lastSeenAt: new Date(), credentialRotatedAt: new Date(), updatedAt: new Date(),
  }).where(eq(printAgentsTable.id, agent.id)).returning();
  return { agent: updated, agentToken };
}

function normalizePrinters(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, { name: string; displayName?: string; isDefault?: boolean }>();
  for (const item of value.slice(0, 80)) {
    const name = trimText((item as any)?.name, 255);
    if (!name || unique.has(name)) continue;
    unique.set(name, { name, displayName: trimText((item as any)?.displayName, 255) || undefined, isDefault: (item as any)?.isDefault === true });
  }
  return [...unique.values()];
}

export async function authenticatePrintAgent(token: string | null) {
  await ensureRemotePrintingTables();
  if (!token || token.length < 30) throw new RemotePrintError(401, "PERMISSION_DENIED", "بيانات جهاز الطباعة غير صالحة.");
  const agent = await db.query.printAgentsTable.findFirst({ where: eq(printAgentsTable.tokenHash, hashAgentToken(token)) });
  if (!agent || agent.status === "disabled") throw new RemotePrintError(401, "PERMISSION_DENIED", "جهاز الطباعة غير مصرح له.");
  return agent;
}

export async function heartbeatPrintAgent(agentId: number, input: { hostname?: string; appVersion?: string; printers?: unknown }) {
  const [agent] = await db.update(printAgentsTable).set({
    status: "online", hostname: trimText(input.hostname, 255) || null, appVersion: trimText(input.appVersion, 40) || null,
    detectedPrinters: normalizePrinters(input.printers), lastSeenAt: new Date(), updatedAt: new Date(),
  }).where(eq(printAgentsTable.id, agentId)).returning();
  return agent;
}

export async function listPrintAgents() {
  await ensureRemotePrintingTables();
  const threshold = Date.now() - 90_000;
  const agents = await db.query.printAgentsTable.findMany({ orderBy: [desc(printAgentsTable.updatedAt)] });
  return agents.map((agent) => ({
    ...agent,
    liveStatus: agent.status === "disabled" ? "disabled" : agent.lastSeenAt && agent.lastSeenAt.getTime() >= threshold ? "online" : "offline",
  }));
}

export async function rotatePrintAgentCredential(agentDbId: number) {
  await ensureRemotePrintingTables();
  const agentToken = newSecret("AJNAGENT");
  const [agent] = await db.update(printAgentsTable).set({
    tokenHash: hashAgentToken(agentToken), credentialRotatedAt: new Date(), updatedAt: new Date(),
  }).where(eq(printAgentsTable.id, agentDbId)).returning();
  if (!agent) throw new RemotePrintError(404, "NOT_FOUND", "جهاز الطباعة غير موجود.");
  return { agent, agentToken };
}

export async function updatePrintAgent(agentDbId: number, input: { name?: unknown; branchId?: unknown; disabled?: unknown }) {
  await ensureRemotePrintingTables();
  const current = await db.query.printAgentsTable.findFirst({ where: eq(printAgentsTable.id, agentDbId) });
  if (!current) throw new RemotePrintError(404, "NOT_FOUND", "جهاز الطباعة غير موجود.");
  const branchId = input.branchId === undefined ? current.branchId : (Number(input.branchId) > 0 ? Number(input.branchId) : null);
  if (branchId) {
    const branch = await db.query.enterpriseBranchesTable.findFirst({ where: eq(enterpriseBranchesTable.id, branchId) });
    if (!branch?.isActive) throw new RemotePrintError(400, "VALIDATION_ERROR", "الفرع المحدد غير متاح.");
  }
  const disabled = input.disabled === true;
  const [agent] = await db.update(printAgentsTable).set({
    name: input.name === undefined ? current.name : (trimText(input.name, 160) || current.name), branchId,
    status: disabled ? "disabled" : current.status === "disabled" ? "offline" : current.status,
    disabledAt: disabled ? new Date() : null, updatedAt: new Date(),
  }).where(eq(printAgentsTable.id, agentDbId)).returning();
  return agent;
}

export async function listPrinters() {
  await ensureRemotePrintingTables();
  const rows = await db.query.printersTable.findMany({ orderBy: [desc(printersTable.updatedAt)] });
  const agents = await db.query.printAgentsTable.findMany();
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  return rows.map((printer) => ({ ...printer, agent: agentById.get(printer.agentId) ? { id: printer.agentId, name: agentById.get(printer.agentId)!.name, agentId: agentById.get(printer.agentId)!.agentId } : null }));
}

export async function savePrinter(input: { id?: unknown; agentId: unknown; branchId?: unknown; name: unknown; displayName?: unknown; paperSize?: unknown; driverType?: unknown; defaultCopies?: unknown; autoPrintEnabled?: unknown; isDefault?: unknown; isActive?: unknown; allowedDocumentTypes?: unknown; horizontalOffsetMm?: unknown; verticalOffsetMm?: unknown }) {
  await ensureRemotePrintingTables();
  const agentId = Number(input.agentId);
  const name = trimText(input.name, 255);
  if (!Number.isInteger(agentId) || agentId <= 0 || !name) throw new RemotePrintError(400, "VALIDATION_ERROR", "الجهاز واسم طابعة Windows مطلوبان.");
  const agent = await db.query.printAgentsTable.findFirst({ where: eq(printAgentsTable.id, agentId) });
  if (!agent || agent.status === "disabled") throw new RemotePrintError(400, "VALIDATION_ERROR", "جهاز الطباعة المحدد غير متاح.");
  const detected = (agent.detectedPrinters ?? []).some((printer) => printer.name === name);
  if (!detected) throw new RemotePrintError(400, "VALIDATION_ERROR", "الطابعة غير مكتشفة على جهاز Windows المحدد.");
  const branchId = Number(input.branchId) > 0 ? Number(input.branchId) : agent.branchId;
  const values = {
    agentId, branchId: branchId ?? null, name, displayName: trimText(input.displayName, 255) || null,
    paperSize: normalizePaperSize(input.paperSize), driverType: input.driverType === "escpos" ? "escpos" : "windows",
    defaultCopies: normalizeCopies(input.defaultCopies), autoPrintEnabled: input.autoPrintEnabled !== false,
    isDefault: input.isDefault === true, isActive: input.isActive !== false,
    allowedDocumentTypes: [REMOTE_PRINT_DOCUMENT], horizontalOffsetMm: normalizeCalibrationMm(input.horizontalOffsetMm), verticalOffsetMm: normalizeCalibrationMm(input.verticalOffsetMm), updatedAt: new Date(),
  };
  return db.transaction(async (tx) => {
    // The UI identifies a Windows printer by agent + Windows printer name. Do
    // not require a database id: an agent can report the same printer again
    // after a restart and saving it must update its configuration.
    const existing = await tx.query.printersTable.findFirst({
      where: and(eq(printersTable.agentId, agentId), eq(printersTable.name, name)),
      columns: { id: true },
    });

    // A printer default is scoped to its agent. Keep this with the UPSERT so
    // a failure cannot leave the agent in a partly updated default state.
    if (values.isDefault) {
      await tx.update(printersTable)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(printersTable.agentId, agentId), eq(printersTable.isDefault, true)));
    }

    const [printer] = await tx.insert(printersTable)
      .values(values)
      .onConflictDoUpdate({
        target: [printersTable.agentId, printersTable.name],
        set: {
          branchId: values.branchId,
          displayName: values.displayName,
          driverType: values.driverType,
          paperSize: values.paperSize,
          defaultCopies: values.defaultCopies,
          autoPrintEnabled: values.autoPrintEnabled,
          allowedDocumentTypes: values.allowedDocumentTypes,
          horizontalOffsetMm: values.horizontalOffsetMm,
          verticalOffsetMm: values.verticalOffsetMm,
          isDefault: values.isDefault,
          isActive: true,
          updatedAt: values.updatedAt,
        },
      })
      .returning();

    return { printer, operation: existing ? "updated" as const : "created" as const };
  });
}

async function resolvePrinter(input: { printerId?: unknown; branchId?: unknown }) {
  const requestedPrinterId = Number(input.printerId);
  const branchId = Number(input.branchId) > 0 ? Number(input.branchId) : null;
  const where = requestedPrinterId > 0
    ? and(eq(printersTable.id, requestedPrinterId), eq(printersTable.isActive, true))
    : branchId
      ? and(eq(printersTable.branchId, branchId), eq(printersTable.isActive, true), eq(printersTable.isDefault, true))
      : and(eq(printersTable.isActive, true), eq(printersTable.isDefault, true));
  const printer = await db.query.printersTable.findFirst({ where, orderBy: [desc(printersTable.updatedAt)] });
  if (!printer) throw new RemotePrintError(422, "NOT_FOUND", "لا توجد طابعة حرارية مهيأة لهذا الفرع.");
  const agent = await db.query.printAgentsTable.findFirst({ where: eq(printAgentsTable.id, printer.agentId) });
  if (!agent || agent.status === "disabled") throw new RemotePrintError(422, "NOT_FOUND", "جهاز الطباعة المخصص غير متاح.");
  return { printer, agent };
}

async function buildSalesInvoicePayload(invoiceId: number, paperSize: RemotePaperSize, printer: { horizontalOffsetMm: string; verticalOffsetMm: string }, options: { orientation: RemotePrintOrientation; customWidthMm: number; customHeightMm: number }) {
  const publicOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || "https://alijan-koshat.vercel.app";
  const [invoice, items, qr, appearance] = await Promise.all([
    db.query.salesInvoicesTable.findFirst({ where: eq(salesInvoicesTable.id, invoiceId) }),
    db.query.salesInvoiceItemsTable.findMany({ where: eq(salesInvoiceItemsTable.invoiceId, invoiceId), columns: { productName: true, quantity: true, unitPrice: true, total: true } }),
    db.query.qrTokensTable.findFirst({ where: and(eq(qrTokensTable.entityType, "invoice"), eq(qrTokensTable.entityId, invoiceId)) }),
    loadRemotePrintAppearance(publicOrigin),
  ]);
  if (!invoice || invoice.status === "deleted") throw new RemotePrintError(404, "NOT_FOUND", "الفاتورة غير موجودة.");
  if (invoice.status === "cancelled") throw new RemotePrintError(422, "VALIDATION_ERROR", "لا يمكن الطباعة المباشرة لفاتورة ملغاة.");
  if (!items.length) throw new RemotePrintError(422, "VALIDATION_ERROR", "لا تحتوي الفاتورة على أصناف قابلة للطباعة.");
  return {
    schemaVersion: 1,
    documentType: REMOTE_PRINT_DOCUMENT,
    paperSize,
    orientation: options.orientation,
    customWidthMm: paperSize === "custom" ? options.customWidthMm : undefined,
    customHeightMm: paperSize === "custom" ? options.customHeightMm : undefined,
    horizontalOffsetMm: String(printer.horizontalOffsetMm ?? "0"),
    verticalOffsetMm: String(printer.verticalOffsetMm ?? "0"),
    appearance,
    invoice: {
      invoiceNo: invoice.invoiceNo, date: invoice.date, issuedAt: invoice.createdAt?.toISOString() ?? invoice.date, customerName: invoice.customerName,
      customerPhone: invoice.customerPhone ? formatIraqiPhone(invoice.customerPhone) : null, paymentMethod: invoice.paymentMethod, paymentStatus: invoice.paymentStatus,
      subtotal: String(invoice.subtotal), discountAmount: String(invoice.discountAmount), taxAmount: String(invoice.taxAmount),
      offerDeliveryFee: String(invoice.offerDeliveryFee ?? "0"),
      total: String(invoice.total), paidAmount: String(invoice.paidAmount), remainingAmount: String(invoice.remainingAmount),
      notes: typeof invoice.notes === "string" && invoice.notes.trim() ? invoice.notes.trim() : null,
      employeeName: invoice.createdByName || null,
      items: items.map((item) => ({ name: item.productName, quantity: String(item.quantity), unitPrice: String(item.unitPrice), total: String(item.total) })),
      qrUrl: qr?.token ? `${publicOrigin.replace(/\/$/, "")}/api/qr/${qr.token}` : null,
    },
  };
}

export async function enqueueSalesInvoicePrint(input: { actor: RemotePrintActor; invoiceId: unknown; printerId?: unknown; branchId?: unknown; paperSize?: unknown; orientation?: unknown; customWidthMm?: unknown; customHeightMm?: unknown; copies?: unknown; idempotencyKey: string; originalJobId?: number | null; reprintReason?: string | null }) {
  await ensureRemotePrintingTables();
  const invoiceId = Number(input.invoiceId);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) throw new RemotePrintError(400, "VALIDATION_ERROR", "معرّف الفاتورة غير صالح.");
  if (!input.idempotencyKey || input.idempotencyKey.length < 12) throw new RemotePrintError(400, "VALIDATION_ERROR", "مفتاح منع التكرار غير صالح.");
  const existing = await db.query.printJobsTable.findFirst({ where: eq(printJobsTable.idempotencyKey, input.idempotencyKey) });
  if (existing) return { job: existing, duplicate: true };
  const { printer, agent } = await resolvePrinter(input);
  const paperSize = normalizePaperSize(input.paperSize ?? printer.paperSize);
  const printOptions = {
    orientation: normalizeOrientation(input.orientation),
    customWidthMm: normalizeCustomDimension(input.customWidthMm, 80, 210),
    customHeightMm: normalizeCustomDimension(input.customHeightMm, 297, 500),
  };
  const copies = normalizeCopies(input.copies, printer.defaultCopies);
  const payload = await buildSalesInvoicePayload(invoiceId, paperSize, printer, printOptions);
  const allowed = Array.isArray(printer.allowedDocumentTypes) ? printer.allowedDocumentTypes : [];
  if (!allowed.includes(REMOTE_PRINT_DOCUMENT)) throw new RemotePrintError(403, "PERMISSION_DENIED", "الطابعة المحددة غير مخصصة لفواتير المبيعات.");
  try {
    const [job] = await db.insert(printJobsTable).values({
      jobNo: jobNumber(), documentType: REMOTE_PRINT_DOCUMENT, documentId: invoiceId, invoiceId,
      printerId: printer.id, branchId: printer.branchId ?? agent.branchId ?? null, computerAgentId: agent.id,
      paperSize, copies, payload: { ...payload, printerName: printer.name, printerDisplayName: printer.displayName ?? printer.name } as any,
      status: "queued", idempotencyKey: input.idempotencyKey, requestedBy: input.actor.id,
      requestedByName: input.actor.fullName || input.actor.username,
      originalPrintJobId: input.originalJobId ?? null, reprintReason: input.reprintReason?.trim().slice(0, 240) || null,
    }).returning();
    return { job, duplicate: false };
  } catch (error: any) {
    if (error?.code === "23505") {
      const job = await db.query.printJobsTable.findFirst({ where: eq(printJobsTable.idempotencyKey, input.idempotencyKey) });
      if (job) return { job, duplicate: true };
      throw new RemotePrintError(409, "CONFLICT", "تعذر إنشاء مهمة طباعة مكررة.");
    }
    throw error;
  }
}

export async function listPrintJobs(input: { status?: string | null; limit?: unknown; agentId?: number | null }) {
  await ensureRemotePrintingTables();
  const validStatuses: PrintJobStatus[] = ["queued", "claimed", "printing", "printed", "failed", "cancelled"];
  const status = validStatuses.includes(input.status as PrintJobStatus) ? input.status as PrintJobStatus : null;
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const where = and(
    status ? eq(printJobsTable.status, status) : undefined,
    input.agentId ? eq(printJobsTable.computerAgentId, input.agentId) : undefined,
  );
  return db.query.printJobsTable.findMany({ where, orderBy: [desc(printJobsTable.createdAt)], limit });
}

export async function getPrintJob(jobId: number) {
  await ensureRemotePrintingTables();
  return db.query.printJobsTable.findFirst({ where: eq(printJobsTable.id, jobId) });
}

export async function listAgentJobs(agentId: number) {
  await ensureRemotePrintingTables();
  return db.query.printJobsTable.findMany({
    where: and(
      eq(printJobsTable.computerAgentId, agentId),
      or(
        eq(printJobsTable.status, "queued"),
        and(eq(printJobsTable.status, "failed"), lte(printJobsTable.retryCount, REMOTE_PRINT_MAX_RETRIES - 1), lte(printJobsTable.nextAttemptAt, new Date())),
      ),
    ),
    orderBy: [desc(printJobsTable.requestedAt)],
    limit: 12,
  });
}

/** Atomic status change is the duplicate-print barrier. */
export async function claimPrintJob(agentId: number, jobId: number) {
  await ensureRemotePrintingTables();
  const now = new Date();
  const [job] = await db.update(printJobsTable).set({ status: "claimed", claimedAt: now, updatedAt: now, errorMessage: null })
    .where(and(eq(printJobsTable.id, jobId), eq(printJobsTable.computerAgentId, agentId), or(eq(printJobsTable.status, "queued"), and(eq(printJobsTable.status, "failed"), lte(printJobsTable.retryCount, REMOTE_PRINT_MAX_RETRIES - 1), lte(printJobsTable.nextAttemptAt, now)))))
    .returning();
  if (!job) throw new RemotePrintError(409, "CONFLICT", "تم استلام مهمة الطباعة من جهاز آخر أو لم تعد متاحة.");
  return job;
}

export async function markPrintJobPrinting(agentId: number, jobId: number) {
  const [job] = await db.update(printJobsTable).set({ status: "printing", startedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(printJobsTable.id, jobId), eq(printJobsTable.computerAgentId, agentId), eq(printJobsTable.status, "claimed"))).returning();
  if (!job) throw new RemotePrintError(409, "CONFLICT", "حالة مهمة الطباعة لم تعد صالحة.");
  return job;
}

export async function completePrintJob(agentId: number, jobId: number) {
  const [job] = await db.update(printJobsTable).set({ status: "printed", completedAt: new Date(), updatedAt: new Date(), errorMessage: null })
    .where(and(eq(printJobsTable.id, jobId), eq(printJobsTable.computerAgentId, agentId), eq(printJobsTable.status, "printing"))).returning();
  if (!job) throw new RemotePrintError(409, "CONFLICT", "لا يمكن إكمال مهمة الطباعة بهذه الحالة.");
  return job;
}

export async function failPrintJob(agentId: number, jobId: number, safeReason: unknown) {
  const existing = await db.query.printJobsTable.findFirst({ where: and(eq(printJobsTable.id, jobId), eq(printJobsTable.computerAgentId, agentId)) });
  if (!existing || !["claimed", "printing"].includes(existing.status)) throw new RemotePrintError(409, "CONFLICT", "لا يمكن تسجيل فشل مهمة الطباعة بهذه الحالة.");
  const retries = existing.retryCount + 1;
  const finalFailure = retries >= REMOTE_PRINT_MAX_RETRIES;
  const delayMs = Math.min(60_000, retries * 10_000);
  const [job] = await db.update(printJobsTable).set({
    status: "failed", failedAt: new Date(), retryCount: retries,
    nextAttemptAt: finalFailure ? null : new Date(Date.now() + delayMs),
    errorMessage: trimText(safeReason, 500) || "تعذر إرسال المهمة إلى طابعة Windows.", updatedAt: new Date(),
  }).where(eq(printJobsTable.id, existing.id)).returning();
  return job;
}

export async function cancelPrintJob(jobId: number) {
  const [job] = await db.update(printJobsTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(and(eq(printJobsTable.id, jobId), inArray(printJobsTable.status, ["queued", "failed"]))).returning();
  if (!job) throw new RemotePrintError(409, "CONFLICT", "لا يمكن إلغاء مهمة طباعة بدأت بالفعل.");
  return job;
}

export async function retryPrintJob(jobId: number) {
  const [job] = await db.update(printJobsTable).set({ status: "queued", nextAttemptAt: null, errorMessage: null, updatedAt: new Date() })
    .where(and(eq(printJobsTable.id, jobId), inArray(printJobsTable.status, ["failed", "cancelled"]))).returning();
  if (!job) throw new RemotePrintError(409, "CONFLICT", "لا يمكن إعادة محاولة هذه المهمة.");
  return job;
}
