export type SyncStatus = "pending_sync" | "syncing" | "synced" | "failed" | "conflict";

export type DesktopRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
};

export type DesktopResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  queued?: boolean;
  idempotencyKey?: string;
};

export type SyncOperation = {
  id: number;
  idempotencyKey: string;
  entityType: string;
  method: string;
  url: string;
  status: SyncStatus;
  attempts: number;
  error: string;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  requestPreview: string;
  conflictPreview: string;
};

export type SyncState = {
  online: boolean;
  total: number;
  pending: number;
  failed: number;
  conflicts: number;
  synced: number;
  lastSyncAt: string | null;
  syncing: boolean;
};

export type BackupInfo = { name: string; path: string; size: number; createdAt: string };

export type DesktopSettings = {
  kiosk: boolean;
  fullscreen: boolean;
  launchAtStartup: boolean;
  silentPrint: boolean;
  defaultPrinter: string;
  paperSize: "A4" | "80mm" | "58mm";
  updateChannel: "stable";
};
