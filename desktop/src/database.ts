import { app, safeStorage } from "electron";
import { DatabaseSync } from "node:sqlite";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { BackupInfo, DesktopRequest, DesktopSettings, SyncOperation, SyncStatus } from "./contracts.js";

const DEFAULT_SETTINGS: DesktopSettings = {
  kiosk: false,
  fullscreen: false,
  launchAtStartup: false,
  silentPrint: false,
  defaultPrinter: "",
  paperSize: "80mm",
  updateChannel: "stable",
};

type OperationRow = {
  id: number;
  idempotency_key: string;
  entity_type: string;
  method: string;
  url: string;
  headers: string;
  body: string;
  status: SyncStatus;
  attempts: number;
  error: string | null;
  server_response: string | null;
  conflict_response: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
};

export class LocalDatabase {
  private db!: DatabaseSync;
  readonly dbPath: string;
  readonly backupDir: string;

  constructor() {
    const dataDir = app.getPath("userData");
    this.dbPath = path.join(dataDir, "ajn-local.sqlite");
    this.backupDir = path.join(dataDir, "backups");
    this.open();
  }

  private open() {
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sync_operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotency_key TEXT NOT NULL UNIQUE,
        entity_type TEXT NOT NULL,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        headers TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_sync',
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        server_response TEXT,
        conflict_response TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        synced_at TEXT
      );
      CREATE INDEX IF NOT EXISTS sync_operations_status_idx ON sync_operations(status, id);
      CREATE INDEX IF NOT EXISTS sync_operations_created_at_idx ON sync_operations(created_at);
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  close() { this.db.close(); }

  private protect(value: unknown) {
    const text = JSON.stringify(value ?? null);
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(text).toString("base64")}`;
    }
    return `plain:${Buffer.from(text, "utf8").toString("base64")}`;
  }

  private unprotect<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
      const [mode, encoded] = value.split(":", 2);
      const text = mode === "enc"
        ? safeStorage.decryptString(Buffer.from(encoded, "base64"))
        : Buffer.from(encoded, "base64").toString("utf8");
      return JSON.parse(text) as T;
    } catch { return fallback; }
  }

  enqueue(request: DesktopRequest, idempotencyKey: string, entityType: string) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO sync_operations
        (idempotency_key, entity_type, method, url, headers, body, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending_sync', ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `).run(
      idempotencyKey,
      entityType,
      request.method,
      request.url,
      this.protect(request.headers),
      this.protect(request.body),
      now,
      now,
    );
    if (Number(result.changes) === 0) {
      return this.findByKey(idempotencyKey);
    }
    return this.findByKey(idempotencyKey);
  }

  findByKey(key: string) {
    return this.db.prepare("SELECT * FROM sync_operations WHERE idempotency_key = ?").get(key) as OperationRow | undefined;
  }

  getRawOperation(id: number) {
    const row = this.db.prepare("SELECT * FROM sync_operations WHERE id = ?").get(id) as OperationRow | undefined;
    if (!row) return null;
    return {
      row,
      headers: this.unprotect<Record<string, string>>(row.headers, {}),
      body: this.unprotect<string>(row.body, ""),
    };
  }

  listForSync(limit = 100) {
    return this.db.prepare("SELECT * FROM sync_operations WHERE status IN ('pending_sync','syncing') ORDER BY id ASC LIMIT ?").all(limit) as unknown as OperationRow[];
  }

  listOperations(limit = 200): SyncOperation[] {
    const rows = this.db.prepare("SELECT * FROM sync_operations ORDER BY id DESC LIMIT ?").all(limit) as unknown as OperationRow[];
    return rows.map((row) => ({
      id: row.id,
      idempotencyKey: row.idempotency_key,
      entityType: row.entity_type,
      method: row.method,
      url: row.url,
      status: row.status,
      attempts: row.attempts,
      error: row.error ?? "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      syncedAt: row.synced_at,
      requestPreview: this.unprotect<string>(row.body, "").slice(0, 800),
      conflictPreview: this.unprotect<string>(row.conflict_response, "").slice(0, 800),
    }));
  }

  setStatus(id: number, status: SyncStatus, options: { error?: string; response?: string; conflict?: string } = {}) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE sync_operations SET
        status = ?, attempts = attempts + CASE WHEN ? = 'syncing' THEN 1 ELSE 0 END, error = ?,
        server_response = COALESCE(?, server_response),
        conflict_response = COALESCE(?, conflict_response),
        updated_at = ?, synced_at = CASE WHEN ? = 'synced' THEN ? ELSE synced_at END
      WHERE id = ?
    `).run(status, status, options.error ?? null, options.response ? this.protect(options.response) : null, options.conflict ? this.protect(options.conflict) : null, now, status, now, id);
  }

  retry(id: number) {
    this.db.prepare("UPDATE sync_operations SET status='pending_sync', error=NULL, conflict_response=NULL, updated_at=? WHERE id=?").run(new Date().toISOString(), id);
  }

  discard(id: number) {
    this.db.prepare("DELETE FROM sync_operations WHERE id=?").run(id);
  }

  counts() {
    const rows = this.db.prepare("SELECT status, count(*) AS total FROM sync_operations GROUP BY status").all() as unknown as Array<{ status: SyncStatus; total: number }>;
    const map = new Map(rows.map((row) => [row.status, Number(row.total)]));
    return {
      total: rows.reduce((sum, row) => sum + Number(row.total), 0),
      pending: map.get("pending_sync") ?? 0,
      failed: map.get("failed") ?? 0,
      conflicts: map.get("conflict") ?? 0,
      synced: map.get("synced") ?? 0,
    };
  }

  getMeta(key: string) {
    const row = this.db.prepare("SELECT value FROM sync_meta WHERE key=?").get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string) {
    this.db.prepare("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }

  getSettings(): DesktopSettings {
    const rows = this.db.prepare("SELECT key,value FROM app_settings").all() as unknown as Array<{ key: string; value: string }>;
    const stored = Object.fromEntries(rows.map((row) => [row.key, this.unprotect(row.value, null)]));
    return { ...DEFAULT_SETTINGS, ...stored } as DesktopSettings;
  }

  setSettings(next: Partial<DesktopSettings>) {
    const now = new Date().toISOString();
    const statement = this.db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at");
    for (const [key, value] of Object.entries(next)) statement.run(key, this.protect(value), now);
    return this.getSettings();
  }

  private sqlPath(filePath: string) { return filePath.replaceAll("'", "''"); }

  async createBackup(label = "auto"): Promise<BackupInfo> {
    await mkdir(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(this.backupDir, `ajn-${label}-${stamp}.sqlite`);
    this.db.exec(`VACUUM INTO '${this.sqlPath(target)}'`);
    await this.pruneBackups();
    const info = await stat(target);
    return { name: path.basename(target), path: target, size: info.size, createdAt: info.birthtime.toISOString() };
  }

  async ensureDailyBackup() {
    const day = new Date().toISOString().slice(0, 10);
    if (this.getMeta("last_backup_day") === day) return null;
    const backup = await this.createBackup("daily");
    this.setMeta("last_backup_day", day);
    return backup;
  }

  async listBackups(): Promise<BackupInfo[]> {
    await mkdir(this.backupDir, { recursive: true });
    const names = (await readdir(this.backupDir)).filter((name) => name.endsWith(".sqlite"));
    const rows = await Promise.all(names.map(async (name) => {
      const filePath = path.join(this.backupDir, name);
      const info = await stat(filePath);
      return { name, path: filePath, size: info.size, createdAt: info.birthtime.toISOString() };
    }));
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async pruneBackups() {
    const backups = await this.listBackups();
    await Promise.all(backups.slice(7).map((backup) => rm(backup.path, { force: true })));
  }

  async exportTo(target: string) {
    const temporary = await this.createBackup("export");
    await copyFile(temporary.path, target);
    return target;
  }

  async importFrom(source: string) {
    const probe = new DatabaseSync(source, { readOnly: true });
    const table = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_operations'").get();
    probe.close();
    if (!table) throw new Error("الملف ليس نسخة AJN محلية صالحة");
    await this.createBackup("before-import");
    this.close();
    await copyFile(source, this.dbPath);
    this.open();
  }
}
