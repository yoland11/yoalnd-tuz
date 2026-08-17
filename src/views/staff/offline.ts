import { adminFetch } from "@/views/admin/_lib";

/**
 * Offline write-queue for the kosha staff portal.
 * When the device is offline (poor coverage on-site), mutating requests
 * (stage change, delivery, media, collect) are stored in IndexedDB and
 * replayed automatically when connectivity returns or the app reopens.
 */
const DB_NAME = "ajn-staff-queue";
const STORE = "ops";

export type QueuedOp = { id?: number; path: string; method: string; body: string; idempotencyKey?: string; createdAt: number };
export type QueuedResult = { queued: true };

function hasIDB() {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function emitChange() {
  try { window.dispatchEvent(new Event("ajn-queue-changed")); } catch { /* ignore */ }
}

export async function enqueueOp(op: Omit<QueuedOp, "id" | "createdAt">): Promise<void> {
  if (!hasIDB()) return;
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const r = db.transaction(STORE, "readwrite").objectStore(STORE).add({ ...op, createdAt: Date.now() });
    r.onsuccess = () => res(); r.onerror = () => rej(r.error);
  });
  db.close();
  emitChange();
}

export async function countOps(): Promise<number> {
  if (!hasIDB()) return 0;
  const db = await openDb();
  const n = await new Promise<number>((res, rej) => {
    const r = db.transaction(STORE, "readonly").objectStore(STORE).count();
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  db.close();
  return n;
}

async function allOps(): Promise<QueuedOp[]> {
  if (!hasIDB()) return [];
  const db = await openDb();
  const rows = await new Promise<QueuedOp[]>((res, rej) => {
    const r = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    r.onsuccess = () => res((r.result as QueuedOp[]) ?? []); r.onerror = () => rej(r.error);
  });
  db.close();
  return rows;
}

async function removeOp(id: number): Promise<void> {
  if (!hasIDB()) return;
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const r = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    r.onsuccess = () => res(); r.onerror = () => rej(r.error);
  });
  db.close();
  emitChange();
}

/**
 * Clear every queued offline op. Called on logout / employee switch so a
 * previous employee's unsynced writes can never replay under the next
 * employee's session. Best-effort — never throws.
 */
export async function clearQueue(): Promise<void> {
  if (!hasIDB()) return;
  try {
    const db = await openDb();
    await new Promise<void>((res, rej) => {
      const r = db.transaction(STORE, "readwrite").objectStore(STORE).clear();
      r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    });
    db.close();
    emitChange();
  } catch {
    /* clearing the offline queue is best-effort */
  }
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Run a mutating request, or queue it when offline. Returns the server result or a queued sentinel. */
export async function mutateOrQueue<T>(path: string, init: RequestInit): Promise<T | QueuedResult> {
  const body = typeof init.body === "string" ? init.body : JSON.stringify(init.body ?? {});
  const method = init.method ?? "POST";
  const headers = new Headers(init.headers);
  const idempotencyKey =
    headers.get("x-idempotency-key") ||
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  headers.set("x-idempotency-key", idempotencyKey);
  if (isOffline()) {
    await enqueueOp({ path, method, body, idempotencyKey });
    return { queued: true };
  }
  try {
    return await adminFetch<T>(path, { ...init, method, body, headers });
  } catch (e: any) {
    // No HTTP status => network failure => queue it. HTTP errors (validation) bubble up.
    if (e?.status === undefined) {
      await enqueueOp({ path, method, body, idempotencyKey });
      return { queued: true };
    }
    throw e;
  }
}

/** Replay queued ops in order. Stops on network failure; drops ops the server rejects. */
export async function flushQueue(): Promise<number> {
  if (!hasIDB() || isOffline()) return 0;
  const ops = (await allOps()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  let flushed = 0;
  for (const op of ops) {
    try {
      await adminFetch(op.path, {
        method: op.method,
        body: op.body,
        headers: op.idempotencyKey
          ? { "x-idempotency-key": op.idempotencyKey }
          : undefined,
      });
      if (op.id != null) await removeOp(op.id);
      flushed++;
    } catch (e: any) {
      if (e?.status === undefined) break;       // still offline → retry later
      if (op.id != null) await removeOp(op.id);  // server rejected → drop to avoid blocking
    }
  }
  return flushed;
}

export function isQueued(res: unknown): res is QueuedResult {
  return !!res && typeof res === "object" && (res as any).queued === true;
}
