import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, settingsTable } from "@workspace/db";
import { formatIraqiPhone } from "@/lib/phone";
import { formatCurrency, formatMoney } from "@/lib/money";

export const TELEGRAM_EVENT_KEYS = [
  "storeOrder",
  "koshaBooking",
  "serviceBooking",
  "salesInvoice",
  "adminLogin",
  "paymentReceived",
  "managerApproval",
  "dailyCashClosed",
  "dailyReport",
  "orderEdited",
  "statusChanged",
] as const;

export type TelegramEventKey = (typeof TELEGRAM_EVENT_KEYS)[number];

const eventSettingsSchema = z.object({
  storeOrder: z.boolean().default(true),
  koshaBooking: z.boolean().default(true),
  serviceBooking: z.boolean().default(true),
  salesInvoice: z.boolean().default(true),
  adminLogin: z.boolean().default(true),
  paymentReceived: z.boolean().default(true),
  managerApproval: z.boolean().default(true),
  dailyCashClosed: z.boolean().default(true),
  dailyReport: z.boolean().default(true),
  orderEdited: z.boolean().default(true),
  statusChanged: z.boolean().default(true),
});

export const telegramSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  events: eventSettingsSchema,
});

export type TelegramSettings = z.output<typeof telegramSettingsSchema>;

const SETTINGS_KEY = "telegramNotifications";
const DEFAULT_EVENTS = Object.fromEntries(TELEGRAM_EVENT_KEYS.map((key) => [key, true])) as Record<TelegramEventKey, boolean>;
export const DEFAULT_TELEGRAM_SETTINGS: TelegramSettings = { enabled: false, events: DEFAULT_EVENTS };

type TelegramResult = { ok: true; messageId?: number } | { ok: false; error: string };

type InvoiceItem = {
  productName?: string | null;
  quantity?: string | number | null;
  unitPrice?: string | number | null;
  total?: string | number | null;
};

export type TelegramInvoiceInput = {
  id: number;
  invoiceNo: string;
  customerName?: string | null;
  customerPhone?: string | null;
  createdByName?: string | null;
  date?: string | Date | null;
  paymentMethod?: string | null;
  subtotal?: string | number | null;
  discountAmount?: string | number | null;
  total?: string | number | null;
  paidAmount?: string | number | null;
  remainingAmount?: string | number | null;
  paymentStatus?: string | null;
  items?: InvoiceItem[];
};

export type TelegramOrderInput = {
  kind: "store" | "service";
  id: number;
  reference?: string | null;
  customerName?: string | null;
  phone?: string | null;
  createdByName?: string | null;
  createdAt?: string | Date | null;
  paymentMethod?: string | null;
  total?: string | number | null;
  paid?: string | number | null;
  remaining?: string | number | null;
  status?: string | null;
  serviceName?: string | null;
  address?: string | null;
  notes?: string | null;
  items?: InvoiceItem[];
  qrDataUrl?: string | null;
};

export type TelegramKoshaBookingInput = {
  id: number;
  reference?: string | null;
  koshaName?: string | null;
  customerName?: string | null;
  phone?: string | null;
  eventDate?: string | null;
  total?: string | number | null;
  paid?: string | number | null;
  remaining?: string | number | null;
  status?: string | null;
  address?: string | null;
  notes?: string | null;
  items?: InvoiceItem[];
  qrDataUrl?: string | null;
};

export type TelegramOrderEditInput = {
  kind: "store" | "service" | "kosha";
  id: number;
  reference: string;
  customerName?: string | null;
  phone?: string | null;
  createdByName?: string | null;
  status?: string | null;
  total?: string | number | null;
  paid?: string | number | null;
  remaining?: string | number | null;
  financialDifference?: string | number | null;
  changedFields?: string[];
};

export type TelegramPaymentInput = {
  event: "paymentReceived" | "managerApproval";
  reference: string;
  customerName?: string | null;
  amount: string | number;
  paymentMethod?: string | null;
  createdByName?: string | null;
  status?: string | null;
  entityPath?: string | null;
};

export type TelegramDailyReportInput = {
  event: "dailyCashClosed" | "dailyReport";
  reportDate: string;
  openingBalance?: string | number | null;
  totalRevenue?: string | number | null;
  totalExpenses?: string | number | null;
  closingBalance?: string | number | null;
  difference?: string | number | null;
  createdByName?: string | null;
};

function safeError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value ?? "خطأ غير معروف");
  return message.replace(/bot\d+:[\w-]+/gi, "bot[hidden]").slice(0, 500);
}

function telegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim() ?? "";
  return { token, chatId, configured: Boolean(token && chatId) };
}

export function telegramEnvironmentStatus() {
  const config = telegramConfig();
  return { botTokenConfigured: Boolean(config.token), chatIdConfigured: Boolean(config.chatId) };
}

export async function getTelegramSettings(): Promise<TelegramSettings> {
  const row = await db.query.settingsTable.findFirst({ where: eq(settingsTable.key, SETTINGS_KEY) });
  const parsed = telegramSettingsSchema.safeParse(row?.value ?? DEFAULT_TELEGRAM_SETTINGS);
  return parsed.success ? parsed.data : DEFAULT_TELEGRAM_SETTINGS;
}

export async function saveTelegramSettings(input: unknown): Promise<TelegramSettings> {
  const settings = telegramSettingsSchema.parse(input);
  await db.insert(settingsTable).values({ key: SETTINGS_KEY, value: settings, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: settings, updatedAt: new Date() } });
  return settings;
}

async function eventEnabled(event: TelegramEventKey) {
  try {
    const settings = await getTelegramSettings();
    return settings.enabled && settings.events[event] !== false;
  } catch (error) {
    console.warn("telegram settings load failed", { message: safeError(error), event });
    return false;
  }
}

async function telegramRequest(method: "sendMessage" | "sendDocument", body: URLSearchParams | FormData): Promise<TelegramResult> {
  const { token, chatId, configured } = telegramConfig();
  if (!configured) return { ok: false, error: "إعدادات Telegram غير مكتملة في Environment Variables" };
  if (body instanceof URLSearchParams) body.set("chat_id", chatId);
  else body.set("chat_id", chatId);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok || !payload?.ok) {
      const description = String(payload?.description ?? `HTTP ${response.status}`);
      console.warn("telegram request failed", { method, status: response.status, message: safeError(description) });
      return { ok: false, error: description.slice(0, 300) };
    }
    return { ok: true, messageId: Number(payload?.result?.message_id) || undefined };
  } catch (error) {
    const message = safeError(error);
    console.warn("telegram request failed", { method, message });
    return { ok: false, error: message };
  }
}

export async function sendTelegramMessage(message: string): Promise<TelegramResult> {
  const body = new URLSearchParams({
    text: message.slice(0, 4096),
    parse_mode: "HTML",
    disable_web_page_preview: "true",
  });
  return telegramRequest("sendMessage", body);
}

export async function sendTelegramDocument(document: Buffer | Uint8Array, filename: string, caption?: string): Promise<TelegramResult> {
  const body = new FormData();
  body.set("document", new Blob([new Uint8Array(document)], { type: "application/pdf" }), sanitizeFilename(filename));
  if (caption) body.set("caption", caption.slice(0, 1024));
  return telegramRequest("sendDocument", body);
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

function amount(value: unknown) {
  return formatCurrency(value as number | string | null | undefined);
}

function pdfAmount(value: unknown) {
  return `${formatMoney(value as number | string | null | undefined)} IQD`;
}

function paymentLabel(value: unknown) {
  return ({ cash: "نقدي", cod: "عند الاستلام", card: "بطاقة", pos: "بطاقة / POS", transfer: "تحويل" } as Record<string, string>)[String(value ?? "").toLowerCase()] ?? String(value || "غير محدد");
}

function statusLabel(value: unknown) {
  return ({ pending: "قيد الانتظار", new: "جديد", confirmed: "مؤكد", completed: "مكتمل", delivered: "تم التسليم", cancelled: "ملغي", paid: "مدفوع", partial: "جزئي", unpaid: "غير مدفوع", executed: "منفذ" } as Record<string, string>)[String(value ?? "").toLowerCase()] ?? String(value || "غير محدد");
}

function dateTime(value?: string | Date | null) {
  const date = value ? new Date(value) : new Date();
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  return {
    date: new Intl.DateTimeFormat("ar-IQ", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(valid),
    time: new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", hour12: true }).format(valid),
  };
}

function appBaseUrl() {
  const configured = process.env.APP_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  return vercel ? `https://${vercel}` : "";
}

function adminLink(pathname: string) {
  const base = appBaseUrl();
  return base ? `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}` : "";
}

function line(label: string, value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  return `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`;
}

function messageBlock(title: string, rows: string[], href?: string) {
  return [title, "", ...rows.filter(Boolean), href ? "" : "", href ? `<a href="${escapeHtml(href)}">فتح داخل لوحة الإدارة</a>` : ""].filter((row, index, all) => row !== "" || (index > 0 && all[index - 1] !== "")).join("\n");
}

function sanitizeFilename(value: string) {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || "ajn-document.pdf";
}

function pdfFontPaths() {
  return {
    regular: path.join(/* turbopackIgnore: true */ process.cwd(), "public", "fonts", "Cairo-Regular.ttf"),
    bold: path.join(/* turbopackIgnore: true */ process.cwd(), "public", "fonts", "Cairo-Bold.ttf"),
  };
}

function hasArabic(value: string) {
  return /[\u0600-\u06FF]/.test(value);
}

function dataUrlBuffer(value?: string | null): Buffer | null {
  const match = /^data:[^;]+;base64,(.+)$/i.exec(String(value ?? ""));
  if (!match) return null;
  try { return Buffer.from(match[1], "base64"); } catch { return null; }
}

function createPdf(title: string, rows: Array<[string, string]>, items: InvoiceItem[] = [], reference?: string, qrDataUrl?: string | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, info: { Title: title, Author: "AJN" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const fonts = pdfFontPaths();
    if (fs.existsSync(fonts.regular)) doc.registerFont("Cairo", fonts.regular).font("Cairo");
    if (fs.existsSync(fonts.bold)) doc.registerFont("CairoBold", fonts.bold);
    const rtlOptions: PDFKit.Mixins.TextOptions = { align: "right", features: ["rtla"] };
    const logo = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "icons", "icon-192.png");
    if (fs.existsSync(logo)) doc.image(logo, 507, 36, { fit: [46, 46], align: "center", valign: "center" });
    if (fs.existsSync(fonts.bold)) doc.font("CairoBold");
    doc.fillColor("#111111").fontSize(22).text(title, 215, 42, { width: 280, ...rtlOptions });
    if (reference) doc.fontSize(15).text(reference, 42, 48, { width: 180, align: "left", features: [] });
    doc.y = 82;
    doc.moveDown(0.4).strokeColor("#D4B15A").lineWidth(2).moveTo(42, doc.y).lineTo(553, doc.y).stroke().moveDown(0.8);
    if (fs.existsSync(fonts.regular)) doc.font("Cairo");
    doc.fontSize(11);
    for (const [label, value] of rows) {
      const rowY = doc.y;
      doc.fillColor("#444444").text(label, 370, rowY, { width: 183, ...rtlOptions });
      const cleanValue = value || "-";
      doc.fillColor("#222222").text(cleanValue, 42, rowY, { width: 305, align: "right", features: hasArabic(cleanValue) ? ["rtla"] : [] });
      doc.y = rowY + 25;
    }
    if (items.length) {
      if (fs.existsSync(fonts.bold)) doc.font("CairoBold");
      doc.moveDown(0.5).fillColor("#111111").fontSize(14).text("تفاصيل المواد", rtlOptions).moveDown(0.5);
      if (fs.existsSync(fonts.regular)) doc.font("Cairo");
      for (const item of items) {
        if (doc.y > 730) doc.addPage();
        const name = String(item.productName || "مادة");
        const quantity = Number(item.quantity || 0);
        const total = pdfAmount(item.total ?? Number(item.unitPrice || 0) * quantity);
        const itemY = doc.y;
        doc.fillColor("#222222").fontSize(10).text(name, 255, itemY, { width: 298, ...rtlOptions });
        doc.text(String(quantity), 180, itemY, { width: 55, align: "center", features: [] });
        doc.text(total, 42, itemY, { width: 125, align: "left", features: [] });
        doc.strokeColor("#DDDDDD").lineWidth(0.5).moveTo(42, itemY + 19).lineTo(553, itemY + 19).stroke();
        doc.y = itemY + 27;
      }
    }
    const qr = dataUrlBuffer(qrDataUrl);
    if (qr) {
      if (doc.y > 650) doc.addPage();
      doc.moveDown(0.8).image(qr, 246, doc.y, { fit: [105, 105], align: "center" });
      doc.y += 112;
      doc.fillColor("#333333").fontSize(9).text("امسح الرمز لتتبع الطلب", { align: "center", features: ["rtla"] });
    }
    doc.moveDown(1).fillColor("#777777").fontSize(9).text(`AJN - ${dateTime().date} ${dateTime().time}`, { align: "center" });
    doc.end();
  });
}

async function savePdfToStorage(pdf: Buffer, folder: string, filename: string): Promise<string | null> {
  const storageUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "ajn-media";
  if (!storageUrl || !serviceKey) return null;
  const objectPath = `${folder}/${new Date().toISOString().slice(0, 10)}/${sanitizeFilename(filename)}`;
  try {
    const response = await fetch(`${storageUrl}/storage/v1/object/${bucket}/${objectPath}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/pdf",
        "x-upsert": "true",
      },
      body: new Uint8Array(pdf),
    });
    if (!response.ok) {
      console.warn("order PDF storage upload failed", { folder, status: response.status });
      return null;
    }
    return `${storageUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
  } catch (error) {
    console.warn("order PDF storage upload failed", { folder, message: safeError(error) });
    return null;
  }
}

export function generateInvoicePdf(invoice: TelegramInvoiceInput) {
  return createPdf("فاتورة مبيعات", [
    ["رقم الفاتورة", invoice.invoiceNo],
    ["العميل", invoice.customerName || "نقدي"],
    ["الهاتف", invoice.customerPhone ? formatIraqiPhone(invoice.customerPhone) : "-"],
    ["المستخدم", invoice.createdByName || "النظام"],
    ["التاريخ", invoice.date ? new Date(invoice.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)],
    ["طريقة الدفع", paymentLabel(invoice.paymentMethod)],
    ["المجموع قبل الخصم", pdfAmount(invoice.subtotal)],
    ["الخصم", pdfAmount(invoice.discountAmount)],
    ["صافي الفاتورة", pdfAmount(invoice.total)],
    ["المبلغ الواصل", pdfAmount(invoice.paidAmount)],
    ["المبلغ الباقي", pdfAmount(invoice.remainingAmount)],
    ["حالة الدفع", statusLabel(invoice.paymentStatus)],
  ], invoice.items ?? [], invoice.invoiceNo);
}

export function generateOrderPdf(order: TelegramOrderInput) {
  return createPdf(order.kind === "store" ? "طلب متجر" : "حجز خدمة", [
    ["رقم الطلب", order.reference || `#${order.id}`],
    ["الخدمة", order.serviceName || (order.kind === "store" ? "المتجر" : "-")],
    ["العميل", order.customerName || "زبون"],
    ["الهاتف", order.phone ? formatIraqiPhone(order.phone) : "-"],
    ["العنوان", order.address || "-"],
    ["التاريخ", dateTime(order.createdAt).date],
    ["طريقة الدفع", paymentLabel(order.paymentMethod)],
    ["المبلغ الكلي", pdfAmount(order.total)],
    ["المدفوع", pdfAmount(order.paid)],
    ["المتبقي", pdfAmount(order.remaining)],
    ["الحالة", statusLabel(order.status)],
    ["ملاحظات", order.notes || "-"],
  ], order.items ?? [], order.reference || `#${order.id}`, order.qrDataUrl);
}

export function generateKoshaBookingPdf(booking: TelegramKoshaBookingInput) {
  return createPdf("حجز كوشة", [
    ["رقم الحجز", booking.reference || `#${booking.id}`],
    ["الكوشة", booking.koshaName || "-"],
    ["العميل", booking.customerName || "زبون"],
    ["الهاتف", booking.phone ? formatIraqiPhone(booking.phone) : "-"],
    ["العنوان", booking.address || "-"],
    ["تاريخ المناسبة", booking.eventDate || "-"],
    ["المبلغ الكلي", pdfAmount(booking.total)],
    ["المدفوع", pdfAmount(booking.paid)],
    ["المتبقي", pdfAmount(booking.remaining)],
    ["الحالة", statusLabel(booking.status)],
    ["ملاحظات", booking.notes || "-"],
  ], booking.items ?? [], booking.reference || `#${booking.id}`, booking.qrDataUrl);
}

export function generateDailyReportPdf(report: TelegramDailyReportInput) {
  return createPdf("التقرير المالي اليومي", [
    ["التاريخ", report.reportDate],
    ["الرصيد الافتتاحي", pdfAmount(report.openingBalance)],
    ["إجمالي الإيرادات", pdfAmount(report.totalRevenue)],
    ["إجمالي المصاريف", pdfAmount(report.totalExpenses)],
    ["الرصيد الختامي", pdfAmount(report.closingBalance)],
    ["الفرق", pdfAmount(report.difference)],
    ["بواسطة", report.createdByName || "النظام"],
  ], [], report.reportDate);
}

export async function notifyTelegramInvoice(invoice: TelegramInvoiceInput): Promise<void> {
  let pdf: Buffer | null = null;
  try {
    pdf = await generateInvoicePdf(invoice);
    await savePdfToStorage(pdf, "documents/sales-invoices", `invoice-${invoice.invoiceNo}.pdf`);
  } catch (error) {
    console.warn("invoice PDF generation failed", { invoiceId: invoice.id, message: safeError(error) });
  }
  if (!await eventEnabled("salesInvoice")) return;
  const stamp = dateTime(invoice.date);
  const href = adminLink(`/admin/sales?invoice=${invoice.id}`);
  const message = messageBlock("✅ <b>تم إصدار فاتورة مبيعات</b>", [
    line("رقم الفاتورة", invoice.invoiceNo),
    line("العميل", invoice.customerName || "نقدي"),
    line("الهاتف", invoice.customerPhone ? formatIraqiPhone(invoice.customerPhone) : "-"),
    line("المستخدم", invoice.createdByName || "النظام"),
    line("التاريخ", stamp.date),
    line("الوقت", stamp.time),
    line("نوع الدفع", paymentLabel(invoice.paymentMethod)),
    "",
    line("صافي الفاتورة", amount(invoice.total)),
    line("الخصم", amount(invoice.discountAmount)),
    line("المبلغ الواصل", amount(invoice.paidAmount)),
    line("المبلغ الباقي", amount(invoice.remainingAmount)),
  ], href);
  await sendTelegramMessage(message);
  try {
    if (pdf) await sendTelegramDocument(pdf, `invoice-${invoice.invoiceNo}.pdf`, `فاتورة ${invoice.invoiceNo}`);
  } catch (error) {
    console.warn("telegram invoice PDF generation failed", { invoiceId: invoice.id, message: safeError(error) });
  }
}

export async function notifyTelegramOrder(order: TelegramOrderInput): Promise<void> {
  const event: TelegramEventKey = order.kind === "store" ? "storeOrder" : "serviceBooking";
  let pdf: Buffer | null = null;
  try {
    pdf = await generateOrderPdf(order);
    await savePdfToStorage(pdf, `documents/${order.kind}-orders`, `order-${order.reference || order.id}.pdf`);
  } catch (error) {
    console.warn("order PDF generation failed", { orderId: order.id, kind: order.kind, message: safeError(error) });
  }
  if (!await eventEnabled(event)) return;
  const stamp = dateTime(order.createdAt);
  const title = order.kind === "store" ? "🛍️ <b>طلب متجر جديد</b>" : "📅 <b>حجز خدمة جديد</b>";
  const href = adminLink(order.kind === "store" ? `/admin/orders?order=${order.id}` : `/admin/orders?serviceOrder=${order.id}`);
  await sendTelegramMessage(messageBlock(title, [
    line(order.kind === "store" ? "رقم الطلب" : "رقم الحجز", order.reference || `#${order.id}`),
    line("الخدمة", order.serviceName),
    line("العميل", order.customerName || "زبون"),
    line("الهاتف", order.phone ? formatIraqiPhone(order.phone) : "-"),
    line("المستخدم", order.createdByName || "النظام"),
    line("التاريخ", stamp.date),
    line("الوقت", stamp.time),
    line("نوع الدفع", paymentLabel(order.paymentMethod)),
    line("المبلغ الكلي", amount(order.total)),
    line("المبلغ المدفوع", amount(order.paid)),
    line("المبلغ المتبقي", amount(order.remaining)),
    line("الحالة", statusLabel(order.status)),
  ], href));
  if (pdf) await sendTelegramDocument(pdf, `order-${order.reference || order.id}.pdf`, `${order.kind === "store" ? "طلب" : "حجز"} ${order.reference || order.id}`);
}

export async function notifyTelegramKoshaBooking(booking: TelegramKoshaBookingInput): Promise<void> {
  let pdf: Buffer | null = null;
  try {
    pdf = await generateKoshaBookingPdf(booking);
    await savePdfToStorage(pdf, "documents/kosha-bookings", `kosha-booking-${booking.reference || booking.id}.pdf`);
  } catch (error) {
    console.warn("kosha booking PDF generation failed", { bookingId: booking.id, message: safeError(error) });
  }
  if (!await eventEnabled("koshaBooking")) return;
  const href = adminLink(`/admin/kosha-bookings?booking=${booking.id}`);
  await sendTelegramMessage(messageBlock("💐 <b>حجز كوشة جديد</b>", [
    line("رقم الحجز", booking.reference || `#${booking.id}`),
    line("الكوشة", booking.koshaName),
    line("العميل", booking.customerName || "زبون"),
    line("الهاتف", booking.phone ? formatIraqiPhone(booking.phone) : "-"),
    line("تاريخ المناسبة", booking.eventDate || "غير محدد"),
    line("المبلغ الكلي", amount(booking.total)),
    line("المبلغ المدفوع", amount(booking.paid)),
    line("المبلغ المتبقي", amount(booking.remaining)),
    line("الحالة", statusLabel(booking.status)),
  ], href));
  if (pdf) await sendTelegramDocument(pdf, `kosha-booking-${booking.reference || booking.id}.pdf`, `حجز كوشة ${booking.reference || booking.id}`);
}

export async function notifyTelegramOrderEdited(input: TelegramOrderEditInput): Promise<void> {
  const onlyStatus = input.changedFields?.length === 1 && input.changedFields[0] === "status";
  if (!await eventEnabled(onlyStatus ? "statusChanged" : "orderEdited")) return;
  const department = input.kind === "store" ? "المتجر" : input.kind === "kosha" ? "الكوشات" : "الخدمات";
  const path = input.kind === "kosha" ? `/admin/kosha-bookings?booking=${input.id}` : `/admin/orders?${input.kind === "store" ? "order" : "serviceOrder"}=${input.id}`;
  await sendTelegramMessage(messageBlock("🛠️ <b>تم تعديل طلب</b>", [
    line("رقم الطلب", input.reference),
    line("العميل", input.customerName || "زبون"),
    line("الهاتف", input.phone ? formatIraqiPhone(input.phone) : "-"),
    line("القسم", department),
    line("الحالة", statusLabel(input.status)),
    line("الإجمالي", amount(input.total)),
    line("المدفوع", amount(input.paid)),
    line("المتبقي", amount(input.remaining)),
    line("الفرق المالي", amount(input.financialDifference)),
    line("الحقول المعدلة", input.changedFields?.join("، ") || "-"),
    line("بواسطة", input.createdByName || "النظام"),
  ], adminLink(path)));
}

export async function notifyTelegramLogin(user: { id: number; username: string; fullName?: string | null; role?: string | null }): Promise<void> {
  if (!await eventEnabled("adminLogin")) return;
  const stamp = dateTime();
  await sendTelegramMessage(messageBlock("🔐 <b>تسجيل دخول إلى النظام</b>", [
    line("المستخدم", user.fullName || user.username),
    line("اسم الدخول", user.username),
    line("الصلاحية", user.role || "موظف"),
    line("التاريخ", stamp.date),
    line("الوقت", stamp.time),
  ], adminLink("/admin/activity-log")));
}

export async function notifyTelegramPayment(payment: TelegramPaymentInput): Promise<void> {
  if (!await eventEnabled(payment.event)) return;
  const title = payment.event === "managerApproval" ? "✅ <b>وافق المدير على استلام مبلغ</b>" : "💵 <b>تم استلام دفعة جديدة</b>";
  await sendTelegramMessage(messageBlock(title, [
    line("المرجع", payment.reference),
    line("العميل / المصدر", payment.customerName || "غير محدد"),
    line("المبلغ", amount(payment.amount)),
    line("طريقة الدفع", paymentLabel(payment.paymentMethod)),
    line("المستخدم", payment.createdByName || "النظام"),
    line("الحالة", statusLabel(payment.status)),
    line("التاريخ والوقت", `${dateTime().date} ${dateTime().time}`),
  ], payment.entityPath ? adminLink(payment.entityPath) : adminLink("/admin/finance/master-cash")));
}

export async function notifyTelegramDailyReport(report: TelegramDailyReportInput): Promise<void> {
  if (!await eventEnabled(report.event)) return;
  const title = report.event === "dailyCashClosed" ? "🔒 <b>تم إغلاق الصندوق اليومي</b>" : "📊 <b>تم إنشاء تقرير مالي يومي</b>";
  await sendTelegramMessage(messageBlock(title, [
    line("التاريخ", report.reportDate),
    line("الرصيد الافتتاحي", amount(report.openingBalance)),
    line("إجمالي الإيرادات", amount(report.totalRevenue)),
    line("إجمالي المصاريف", amount(report.totalExpenses)),
    line("الرصيد الختامي", amount(report.closingBalance)),
    line("الفرق", amount(report.difference)),
    line("المستخدم", report.createdByName || "النظام"),
  ], adminLink("/admin/finance/daily-report")));
  try {
    const pdf = await generateDailyReportPdf(report);
    await sendTelegramDocument(pdf, `daily-report-${report.reportDate}.pdf`, `التقرير المالي ${report.reportDate}`);
  } catch (error) {
    console.warn("telegram daily report PDF generation failed", { reportDate: report.reportDate, message: safeError(error) });
  }
}

export async function sendTelegramTestPdf(): Promise<TelegramResult> {
  try {
    const pdf = await createPdf("اختبار Telegram من AJN", [
      ["الحالة", "الاتصال ومرفق PDF يعملان بنجاح"],
      ["التاريخ", dateTime().date],
      ["الوقت", dateTime().time],
    ]);
    return sendTelegramDocument(pdf, "ajn-telegram-test.pdf", "اختبار ملف PDF من AJN");
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}
