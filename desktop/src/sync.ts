import { Notification, net, type Session, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import type { DesktopRequest, DesktopResponse, SyncState } from "./contracts.js";
import { LocalDatabase } from "./database.js";

const QUEUEABLE_PATHS = [
  /^\/api\/orders(?:\/|$)/,
  /^\/api\/rental-orders(?:\/|$)/,
  /^\/api\/koshas\/[^/]+\/bookings(?:\/|$)/,
  /^\/api\/admin\/(?:orders|service-orders|kosha-bookings|receipt-vouchers|payment-vouchers|sales-invoices|purchase-invoices|finance|master-cash|daily-cash|expenses|expense-categories|warehouse-transfers|tasks|approvals|documents|assets|accounting)(?:\/|$)/,
  /^\/api\/staff\/(?:koshas|photography)(?:\/|$)/,
];
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function entityType(pathname: string) {
  if (pathname.includes("receipt-vouchers")) return "سند قبض";
  if (pathname.includes("payment-vouchers")) return "سند صرف";
  if (pathname.includes("sales-invoices")) return "فاتورة مبيعات";
  if (pathname.includes("purchase-invoices")) return "فاتورة شراء";
  if (pathname.includes("kosha")) return "حجز كوشة";
  if (pathname.includes("photography")) return "طلب تصوير";
  if (pathname.includes("rental")) return "إيجار";
  if (pathname.includes("warehouse-transfers")) return "تحويل مخزني";
  if (pathname.includes("tasks")) return "مهمة";
  if (pathname.includes("finance")) return "حركة مالية";
  if (pathname.includes("master-cash")) return "حركة الصندوق الرئيسي";
  if (pathname.includes("expenses")) return "مصروف";
  if (pathname.includes("approvals")) return "موافقة إدارية";
  if (pathname.includes("service-orders")) return "حجز خدمة";
  return "طلب متجر";
}

function responseHeaders(headers: Headers) {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => { result[key] = value; });
  return result;
}

function localPlaceholder(id: number, key: string, request: DesktopRequest) {
  const suffix = String(id).padStart(5, "0");
  const base = { queued: true, offline: true, pendingSync: true, idempotencyKey: key, id: -id, message: "تم الحفظ محلياً وبانتظار المزامنة" };
  const path = new URL(request.url).pathname;
  if (path.includes("sales-invoices") || path.includes("purchase-invoices")) {
    return { ...base, invoice: { id: -id, invoiceNo: `LOCAL-${suffix}` } };
  }
  if (path.includes("receipt-vouchers") || path.includes("payment-vouchers")) {
    return { ...base, voucherNo: `LOCAL-${suffix}` };
  }
  if (path.includes("orders") || path.includes("rental")) {
    return { ...base, trackingCode: `LOCAL-${suffix}`, orderNo: `LOCAL-${suffix}` };
  }
  return base;
}

export class SyncManager {
  private syncing = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly database: LocalDatabase,
    private readonly session: Session,
    private readonly webContents: () => WebContents | null,
    private readonly allowedOrigin: string,
  ) {}

  start() {
    this.timer = setInterval(() => { if (net.isOnline()) void this.syncNow(); }, 30_000);
    setTimeout(() => { if (net.isOnline()) void this.syncNow(); }, 2_000);
  }

  stop() { if (this.timer) clearInterval(this.timer); }

  private emit() {
    const contents = this.webContents();
    if (contents && !contents.isDestroyed()) contents.send("desktop:sync-state", this.state());
  }

  state(): SyncState {
    return {
      online: net.isOnline(),
      ...this.database.counts(),
      lastSyncAt: this.database.getMeta("last_sync_at"),
      syncing: this.syncing,
    };
  }

  canQueue(request: DesktopRequest) {
    const url = new URL(request.url);
    return url.origin === this.allowedOrigin && MUTATION_METHODS.has(request.method.toUpperCase()) && QUEUEABLE_PATHS.some((pattern) => pattern.test(url.pathname));
  }

  async request(request: DesktopRequest): Promise<DesktopResponse> {
    const url = new URL(request.url);
    if (url.origin !== this.allowedOrigin) throw new Error("تم رفض طلب خارج نطاق AJN");
    if (!this.canQueue(request)) return this.directRequest(request);

    const key = request.headers["x-idempotency-key"] || randomUUID();
    const row = this.database.enqueue(request, key, entityType(url.pathname));
    if (!row) throw new Error("تعذر حفظ العملية محلياً");
    this.emit();
    if (net.isOnline()) {
      const result = await this.send(row.id);
      if (result) return result;
    }
    return {
      status: 202,
      statusText: "Accepted Offline",
      headers: { "content-type": "application/json", "x-ajn-offline-queued": "1" },
      body: JSON.stringify(localPlaceholder(row.id, key, request)),
      queued: true,
      idempotencyKey: key,
    };
  }

  private async directRequest(request: DesktopRequest): Promise<DesktopResponse> {
    try {
      const response = await this.session.fetch(request.url, { method: request.method, headers: request.headers, body: request.body || undefined });
      return { status: response.status, statusText: response.statusText, headers: responseHeaders(response.headers), body: await response.text() };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "فشل الاتصال بالخادم");
    }
  }

  private async send(id: number): Promise<DesktopResponse | null> {
    const operation = this.database.getRawOperation(id);
    if (!operation) return null;
    this.database.setStatus(id, "syncing");
    this.emit();
    try {
      const headers = { ...operation.headers, "x-idempotency-key": operation.row.idempotency_key, "x-ajn-desktop": "1" };
      const response = await this.session.fetch(operation.row.url, {
        method: operation.row.method,
        headers,
        body: operation.body || undefined,
      });
      const text = await response.text();
      if (response.ok) {
        this.database.setStatus(id, "synced", { response: text });
        this.database.setMeta("last_sync_at", new Date().toISOString());
        this.emit();
        return { status: response.status, statusText: response.statusText, headers: responseHeaders(response.headers), body: text };
      }
      if (response.status === 409 && /قيد التنفيذ/.test(text)) {
        this.database.setStatus(id, "pending_sync", { error: "العملية ما زالت قيد التنفيذ على الخادم" });
      } else if (response.status === 409) {
        this.database.setStatus(id, "conflict", { error: "تعارض يحتاج مراجعة المدير", conflict: text });
      } else if (response.status >= 500 || response.status === 429) {
        this.database.setStatus(id, "pending_sync", { error: `HTTP ${response.status}` });
      } else {
        this.database.setStatus(id, "failed", { error: text || `HTTP ${response.status}` });
      }
      this.emit();
      return response.status < 500
        ? { status: response.status, statusText: response.statusText, headers: responseHeaders(response.headers), body: text }
        : null;
    } catch (error) {
      this.database.setStatus(id, "pending_sync", { error: error instanceof Error ? error.message : "انقطع الاتصال" });
      this.emit();
      return null;
    }
  }

  async syncNow() {
    if (this.syncing || !net.isOnline()) return this.state();
    this.syncing = true;
    this.emit();
    try {
      for (const row of this.database.listForSync()) {
        const result = await this.send(row.id);
        if (!result && !net.isOnline()) break;
      }
      this.database.setMeta("last_sync_at", new Date().toISOString());
      const state = this.state();
      if (state.pending === 0 && Notification.isSupported()) {
        new Notification({ title: "AJN", body: "اكتملت مزامنة العمليات المحلية" }).show();
      }
      return state;
    } finally {
      this.syncing = false;
      this.emit();
    }
  }

  retry(id: number) { this.database.retry(id); this.emit(); return this.syncNow(); }
  discard(id: number) { this.database.discard(id); this.emit(); return this.state(); }
}
