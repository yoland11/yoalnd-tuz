export type DesktopSyncStatus = "pending_sync" | "syncing" | "synced" | "failed" | "conflict";

export type DesktopSyncOperation = {
  id: number;
  idempotencyKey: string;
  entityType: string;
  method: string;
  url: string;
  status: DesktopSyncStatus;
  attempts: number;
  error: string;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  requestPreview: string;
  conflictPreview: string;
};

export type DesktopSyncState = {
  online: boolean;
  total: number;
  pending: number;
  failed: number;
  conflicts: number;
  synced: number;
  lastSyncAt: string | null;
  syncing: boolean;
};

export type DesktopSettings = {
  kiosk: boolean;
  fullscreen: boolean;
  launchAtStartup: boolean;
  silentPrint: boolean;
  defaultPrinter: string;
  paperSize: "A4" | "80mm" | "58mm";
  updateChannel: "stable";
};

export type DesktopBackup = { name: string; path: string; size: number; createdAt: string };
export type DesktopPrinter = { name: string; displayName?: string; isDefault?: boolean };

export type AjnDesktopApi = {
  isDesktop: true;
  info(): Promise<{ version: string; platform: string; packaged: boolean; appUrl: string }>;
  request(request: { url: string; method: string; headers: Record<string, string>; body: string }): Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    queued?: boolean;
    idempotencyKey?: string;
  }>;
  getSyncState(): Promise<DesktopSyncState>;
  listOperations(): Promise<DesktopSyncOperation[]>;
  syncNow(): Promise<DesktopSyncState>;
  retry(id: number): Promise<DesktopSyncState>;
  discard(id: number): Promise<DesktopSyncState>;
  onSyncState(listener: (state: DesktopSyncState) => void): () => void;
  getSettings(): Promise<DesktopSettings>;
  updateSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings>;
  listPrinters(): Promise<DesktopPrinter[]>;
  print(settings?: Partial<DesktopSettings>): Promise<{ ok: boolean; error?: string }>;
  reload(): Promise<void>;
  checkUpdates(): Promise<{ enabled: boolean; message?: string; version?: string | null }>;
  listBackups(): Promise<DesktopBackup[]>;
  createBackup(): Promise<DesktopBackup>;
  exportBackup(): Promise<string | null>;
  importBackup(): Promise<{ ok: boolean } | null>;
};

declare global {
  interface Window {
    ajnDesktop?: AjnDesktopApi;
    __ajnDesktopFetchInstalled?: boolean;
  }
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function canSendThroughDesktop(request: Request) {
  if (!MUTATION_METHODS.has(request.method.toUpperCase())) return false;
  const url = new URL(request.url);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return false;
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  return !contentType.includes("multipart/form-data") && !contentType.includes("application/octet-stream");
}

/**
 * Keeps the web app unchanged while routing desktop mutations through the durable
 * SQLite queue. GET requests and binary uploads continue to use native fetch.
 */
export function installDesktopFetchBridge() {
  if (!window.ajnDesktop || window.__ajnDesktopFetchInstalled) return;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (!canSendThroughDesktop(request)) return nativeFetch(input, init);

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => { headers[key] = value; });
    const body = request.method === "DELETE" && !request.headers.has("content-type")
      ? ""
      : await request.clone().text();
    const result = await window.ajnDesktop!.request({
      url: request.url,
      method: request.method,
      headers,
      body,
    });

    if (result.queued) {
      window.dispatchEvent(new CustomEvent("ajn-desktop-queued", {
        detail: { idempotencyKey: result.idempotencyKey },
      }));
    }
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  };
  window.__ajnDesktopFetchInstalled = true;
}

export function isDesktopApp() {
  return typeof window !== "undefined" && window.ajnDesktop?.isDesktop === true;
}

