import { isCalendarDay } from "@/lib/arabic-date";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  customersTable, db, preparationRequestItemsTable, preparationRequestsTable, productsTable, staffTable, tasksTable,
} from "@workspace/db";
import type { PreparationItem, PreparationRollup } from "./booking-preparation";

export type PreparationDraftItem = {
  source: "product" | "asset" | "custom";
  productId?: number | null;
  name: string;
  department: string;
  quantity: number;
  infoOnly?: boolean;
  sku?: string | null;
  note?: string | null;
};
export type CreatePreparationRequestInput = {
  requestToken: string;
  customerId: number;
  occasionName?: string | null;
  eventDate?: string | null;
  items: PreparationDraftItem[];
};
type CustomerRow = { id: number; name: string; fullName?: string | null; status: string };
type ProductRow = { id: number; name: string; nameAr: string; barcode: string | null; isAsset: boolean; isActive: boolean; archivedAt: Date | null };
type StoredRequest = { id: number; number: string | null; requestToken: string; payloadHash: string };
type ItemWrite = { source: PreparationDraftItem["source"]; productId: number | null; name: string; sku: string | null; department: string; quantity: number; infoOnly: boolean; note: string | null; sortOrder: number };
export type PreparationRequestTransaction = {
  findByToken(token: string): Promise<StoredRequest | null>;
  customerById(id: number): Promise<CustomerRow | null>;
  productsByIds(ids: number[]): Promise<ProductRow[]>;
  insertRequest(row: { requestToken: string; payloadHash: string; customerId: number; customerName: string; occasionName: string | null; eventDate: string | null; createdBy: number }): Promise<{ id: number } | null>;
  setNumber(id: number, number: string): Promise<void>;
  insertItems(requestId: number, rows: ItemWrite[]): Promise<void>;
};
export type PreparationRequestRepository = { transaction<T>(fn: (tx: PreparationRequestTransaction) => Promise<T>): Promise<T> };

export class PreparationRequestError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export type PreparationAvailability = { totalStock: number; reservedByOthers: number; available: number };
export function mapPreparationAvailabilityRows(rows: Array<{ id: unknown; stock: unknown; reserved: unknown }>): Map<number, PreparationAvailability> {
  const result = new Map<number, PreparationAvailability>();
  for (const row of rows) {
    const id = Number(row.id);
    const stock = Number(row.stock);
    const reserved = Number(row.reserved);
    if (!Number.isSafeInteger(id) || !Number.isFinite(stock) || !Number.isFinite(reserved)) continue;
    result.set(id, { totalStock: stock, reservedByOthers: reserved, available: Math.max(0, Math.round((stock - reserved) * 1000) / 1000) });
  }
  return result;
}

/** Informational stock only; never creates a reservation or inventory movement. */
export async function readPreparationAvailability(ids: number[]): Promise<Map<number, PreparationAvailability>> {
  if (!ids.length) return new Map();
  const rows = await db.execute(sql`
    SELECT p.id, p.stock::text AS stock,
      coalesce(sum(r.quantity::numeric) FILTER (WHERE r.status <> 'released'), 0)::text AS reserved
    FROM products p
    LEFT JOIN stock_reservations r ON r.product_id = p.id
    WHERE p.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`,`)})
    GROUP BY p.id, p.stock
  `);
  return mapPreparationAvailabilityRows((rows.rows ?? []) as Array<{ id: unknown; stock: unknown; reserved: unknown }>);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
export function parseCreatePreparationRequest(raw: unknown): CreatePreparationRequestInput {
  if (!raw || typeof raw !== "object") throw new PreparationRequestError("بيانات الطلب غير صالحة");
  const data = raw as Record<string, unknown>;
  const requestToken = text(data.requestToken, 80);
  const customerId = Number(data.customerId);
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(requestToken)) throw new PreparationRequestError("رمز الطلب غير صالح");
  if (!Number.isSafeInteger(customerId) || customerId <= 0) throw new PreparationRequestError("اختر العميل");
  const occasionName = text(data.occasionName, 200) || null;
  const eventDate = text(data.eventDate, 10) || null;
  if (eventDate && !isCalendarDay(eventDate)) throw new PreparationRequestError("تاريخ المناسبة غير صالح");
  return { requestToken, customerId, occasionName, eventDate, items: parsePreparationItems(data.items) };
}

export function parsePreparationItems(raw: unknown): PreparationDraftItem[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 200) throw new PreparationRequestError("أضف عنصر تجهيز واحداً على الأقل");
  return raw.map((item: unknown): PreparationDraftItem => {
    if (!item || typeof item !== "object") throw new PreparationRequestError("عنصر التجهيز غير صالح");
    const row = item as Record<string, unknown>;
    const source = row.source;
    if (source !== "custom" && source !== "product" && source !== "asset") throw new PreparationRequestError("مصدر العنصر غير صالح");
    const productId = row.productId == null ? null : Number(row.productId);
    const name = text(row.name, 300);
    const quantity = Number(row.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) throw new PreparationRequestError("كمية العنصر يجب أن تكون عدداً صحيحاً موجباً");
    if (source !== "custom" && (!Number.isSafeInteger(productId) || !productId || productId < 1)) throw new PreparationRequestError("اختر المنتج أو الأصل");
    if (source === "custom" && !name) throw new PreparationRequestError("اسم العنصر مطلوب");
    return {
      source, productId: source === "custom" ? null : productId,
      name, department: text(row.department, 40) || "other", quantity,
      infoOnly: row.infoOnly === true, sku: text(row.sku, 120) || null,
      note: text(row.note, 2000) || null,
    };
  });
}

/** Revalidate catalog references after picker search and snapshot canonical names. */
export async function canonicalPreparationItems(
  items: PreparationDraftItem[],
  lookup: (ids: number[]) => Promise<ProductRow[]> = (ids) => db.select({ id: productsTable.id, name: productsTable.name, nameAr: productsTable.nameAr, barcode: productsTable.barcode, isAsset: productsTable.isAsset, isActive: productsTable.isActive, archivedAt: productsTable.archivedAt }).from(productsTable).where(inArray(productsTable.id, ids)),
): Promise<PreparationDraftItem[]> {
  const ids = [...new Set(items.map((item) => item.productId).filter((id): id is number => id != null))];
  if (!ids.length) return items;
  const products = new Map((await lookup(ids)).map((row) => [row.id, row]));
  return items.map((item) => {
    if (item.source === "custom") return item;
    const product = products.get(item.productId!);
    if (!product || !product.isActive || product.archivedAt) throw new PreparationRequestError("المنتج أو الأصل غير متاح");
    if (item.source === "asset" && !product.isAsset) throw new PreparationRequestError("هذا المنتج ليس أصلاً");
    if (item.source === "product" && product.isAsset) throw new PreparationRequestError("الأصل يجب اختياره من الأصول");
    return { ...item, name: product.nameAr || product.name, sku: product.barcode, productId: product.id };
  });
}

const productionRepository: PreparationRequestRepository = {
  transaction: (fn) => db.transaction(async (tx) => fn({
    findByToken: async (token) => {
      const [row] = await tx.select({ id: preparationRequestsTable.id, number: preparationRequestsTable.requestNo, requestToken: preparationRequestsTable.requestToken, payloadHash: preparationRequestsTable.payloadHash }).from(preparationRequestsTable).where(eq(preparationRequestsTable.requestToken, token)).limit(1);
      return row ?? null;
    },
    customerById: async (id) => {
      const [row] = await tx.select({ id: customersTable.id, name: customersTable.name, fullName: customersTable.fullName, status: customersTable.status }).from(customersTable).where(eq(customersTable.id, id)).for("share").limit(1);
      return row ?? null;
    },
    productsByIds: async (ids) => ids.length ? tx.select({ id: productsTable.id, name: productsTable.name, nameAr: productsTable.nameAr, barcode: productsTable.barcode, isAsset: productsTable.isAsset, isActive: productsTable.isActive, archivedAt: productsTable.archivedAt }).from(productsTable).where(inArray(productsTable.id, ids)).for("share") : [],
    insertRequest: async (row) => {
      const [inserted] = await tx.insert(preparationRequestsTable).values(row).onConflictDoNothing({ target: preparationRequestsTable.requestToken }).returning({ id: preparationRequestsTable.id });
      return inserted ?? null;
    },
    setNumber: async (id, number) => { await tx.update(preparationRequestsTable).set({ requestNo: number }).where(eq(preparationRequestsTable.id, id)); },
    insertItems: async (requestId, rows) => { await tx.insert(preparationRequestItemsTable).values(rows.map((row) => ({ ...row, requestId }))); },
  })),
};

export async function createPreparationRequest(raw: unknown, actorId: number, repository: PreparationRequestRepository = productionRepository): Promise<{ id: number; number: string }> {
  const input = parseCreatePreparationRequest(raw);
  if (!Number.isSafeInteger(actorId) || actorId < 1) throw new PreparationRequestError("المستخدم غير صالح", 403);
  const payloadHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return repository.transaction(async (tx) => {
    const existing = await tx.findByToken(input.requestToken);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new PreparationRequestError("رمز الطلب مستخدم لبيانات مختلفة", 409);
      return { id: existing.id, number: existing.number || `AJN-PREP-${String(existing.id).padStart(6, "0")}` };
    }
    const customer = await tx.customerById(input.customerId);
    if (!customer || customer.status === "deleted") throw new PreparationRequestError("العميل غير موجود أو محذوف");
    const ids = [...new Set(input.items.map((item) => item.productId).filter((id): id is number => id != null))];
    const products = new Map((await tx.productsByIds(ids)).map((row) => [row.id, row]));
    const rows: ItemWrite[] = input.items.map((item, sortOrder) => {
      const product = item.productId ? products.get(item.productId) : undefined;
      if (item.source !== "custom" && (!product || !product.isActive || product.archivedAt)) throw new PreparationRequestError("المنتج أو الأصل غير متاح");
      if (item.source === "asset" && !product?.isAsset) throw new PreparationRequestError("هذا المنتج ليس أصلاً");
      if (item.source === "product" && product?.isAsset) throw new PreparationRequestError("الأصل يجب اختياره من الأصول");
      return {
        source: item.source, productId: product?.id ?? null, name: product ? (product.nameAr || product.name) : item.name,
        sku: product?.barcode ?? item.sku ?? null, department: item.department, quantity: item.quantity,
        infoOnly: Boolean(item.infoOnly), note: item.note ?? null, sortOrder,
      };
    });
    const inserted = await tx.insertRequest({ requestToken: input.requestToken, payloadHash, customerId: customer.id, customerName: customer.fullName?.trim() || customer.name, occasionName: input.occasionName ?? null, eventDate: input.eventDate ?? null, createdBy: actorId });
    if (!inserted) {
      const raced = await tx.findByToken(input.requestToken);
      if (!raced || raced.payloadHash !== payloadHash) throw new PreparationRequestError("رمز الطلب مستخدم لبيانات مختلفة", 409);
      return { id: raced.id, number: raced.number || `AJN-PREP-${String(raced.id).padStart(6, "0")}` };
    }
    const number = `AJN-PREP-${String(inserted.id).padStart(6, "0")}`;
    await tx.setNumber(inserted.id, number);
    await tx.insertItems(inserted.id, rows);
    return { id: inserted.id, number };
  });
}

type RequestRow = { id: number; requestNo: string | null; customerName: string; occasionName: string | null; eventDate: string | null; status: string };
type DetailItemRow = { id: number; requestId: number; source: string; productId: number | null; name: string; sku: string | null; department: string; quantity: number; infoOnly: boolean; status: string; assigneeId: number | null; assigneeName: string | null; note: string | null };
export type StandalonePreparationCard = {
  supportsPreparation: true; bookingStatus: null; detailHref: string;
  source: "request"; id: number; number: string; customerName: string;
  occasionName: string | null; eventDate: string | null; location: null;
  departments: string[]; rollup: PreparationRollup;
};

function standaloneRollup(rows: DetailItemRow[]): PreparationRollup {
  const counted = rows.filter((row) => !row.infoOnly);
  const count = (status: string) => counted.filter((row) => row.status === status).length;
  const ready = count("ready");
  const completed = count("completed");
  const total = counted.length;
  return { total, ready, completed, preparing: count("preparing"), shortage: count("shortage"), needsPurchase: count("needs_purchase"), progress: total ? Math.round(((ready + completed) / total) * 100) : 0 };
}

export function mapStandalonePreparationRows(requests: RequestRow[], items: DetailItemRow[]): StandalonePreparationCard[] {
  const itemsByRequest = new Map<number, DetailItemRow[]>();
  for (const item of items) {
    const list = itemsByRequest.get(item.requestId) ?? [];
    list.push(item);
    itemsByRequest.set(item.requestId, list);
  }
  return requests.filter((row) => row.status === "active").map((row) => {
    const own = itemsByRequest.get(row.id) ?? [];
    return { source: "request", supportsPreparation: true, bookingStatus: null, detailHref: "/admin/preparation", id: row.id, number: row.requestNo || `AJN-PREP-${String(row.id).padStart(6, "0")}`, customerName: row.customerName, occasionName: row.occasionName, eventDate: row.eventDate, location: null, departments: [...new Set(own.map((item) => item.department))], rollup: standaloneRollup(own) };
  });
}

const itemSelection = {
  id: preparationRequestItemsTable.id, requestId: preparationRequestItemsTable.requestId,
  source: preparationRequestItemsTable.source, productId: preparationRequestItemsTable.productId,
  name: preparationRequestItemsTable.name, sku: preparationRequestItemsTable.sku,
  department: preparationRequestItemsTable.department, quantity: preparationRequestItemsTable.quantity,
  infoOnly: preparationRequestItemsTable.infoOnly, status: preparationRequestItemsTable.status,
  assigneeId: preparationRequestItemsTable.assigneeId, assigneeName: staffTable.fullName,
  note: preparationRequestItemsTable.note,
};
async function readItems(requestIds: number[]): Promise<DetailItemRow[]> {
  if (!requestIds.length) return [];
  return db.select(itemSelection).from(preparationRequestItemsTable)
    .leftJoin(staffTable, eq(staffTable.id, preparationRequestItemsTable.assigneeId))
    .where(inArray(preparationRequestItemsTable.requestId, requestIds));
}

export async function listStandalonePreparationCards(): Promise<StandalonePreparationCard[]> {
  const rows = await db.select({ id: preparationRequestsTable.id, requestNo: preparationRequestsTable.requestNo, customerName: preparationRequestsTable.customerName, occasionName: preparationRequestsTable.occasionName, eventDate: preparationRequestsTable.eventDate, status: preparationRequestsTable.status })
    .from(preparationRequestsTable).where(eq(preparationRequestsTable.status, "active"));
  return mapStandalonePreparationRows(rows, await readItems(rows.map((row) => row.id)));
}

function mapDetailItem(row: DetailItemRow, stock: Map<number, PreparationAvailability>): PreparationItem {
  const status = row.infoOnly ? "note" : (["ready", "preparing", "completed", "shortage", "needs_purchase"].includes(row.status) ? row.status as PreparationItem["status"] : "preparing");
  const availability = row.productId ? stock.get(row.productId) : undefined;
  return {
    key: `request:${row.id}`, reservationId: null, kind: row.source === "custom" ? "manual" : row.source as "product" | "asset",
    manual: true, infoOnly: row.infoOnly, productId: row.productId, name: row.name, sku: row.sku,
    department: row.department, required: row.quantity, totalStock: availability?.totalStock ?? 0,
    reservedByOthers: availability?.reservedByOthers ?? 0, available: availability?.available ?? 0,
    availabilityKnown: Boolean(availability),
    shortfall: 0, status, assigneeId: row.assigneeId, assigneeName: row.assigneeName,
    priority: "normal", deadline: null, note: row.note, purchaseRequested: false, evidenceCount: 0,
  };
}

export async function getStandalonePreparationDetail(id: number) {
  const [row] = await db.select({ id: preparationRequestsTable.id, requestNo: preparationRequestsTable.requestNo, customerName: preparationRequestsTable.customerName, occasionName: preparationRequestsTable.occasionName, eventDate: preparationRequestsTable.eventDate, status: preparationRequestsTable.status })
    .from(preparationRequestsTable).where(and(eq(preparationRequestsTable.id, id), eq(preparationRequestsTable.status, "active"))).limit(1);
  if (!row) return null;
  const own = await readItems([id]);
  const stock = await readPreparationAvailability([...new Set(own.map((item) => item.productId).filter((productId): productId is number => productId !== null))]);
  return { source: "request" as const, id, number: row.requestNo, customerName: row.customerName, occasionName: row.occasionName, eventDate: row.eventDate, items: own.map((item) => mapDetailItem(item, stock)), rollup: standaloneRollup(own) };
}

export type StandaloneItemPatch = { status?: "preparing" | "ready" | "completed"; assigneeId?: number | null };
export function parseStandaloneItemPatch(raw: unknown): StandaloneItemPatch {
  if (!raw || typeof raw !== "object") throw new PreparationRequestError("تحديث العنصر غير صالح");
  const row = raw as Record<string, unknown>;
  const patch: StandaloneItemPatch = {};
  if ("status" in row) {
    if (row.status !== "preparing" && row.status !== "ready" && row.status !== "completed") throw new PreparationRequestError("حالة العنصر غير صالحة");
    patch.status = row.status;
  }
  if ("assigneeId" in row) {
    if (row.assigneeId !== null && (!Number.isSafeInteger(row.assigneeId) || Number(row.assigneeId) < 1)) throw new PreparationRequestError("الموظف غير صالح");
    patch.assigneeId = row.assigneeId as number | null;
  }
  if (!Object.keys(patch).length) throw new PreparationRequestError("لا توجد بيانات لتحديث العنصر");
  return patch;
}

export async function updateStandalonePreparationItem(requestId: number, itemId: number, raw: unknown, actorId: number) {
  const patch = parseStandaloneItemPatch(raw);
  return db.transaction(async (tx) => {
    const [request] = await tx.select({ id: preparationRequestsTable.id, number: preparationRequestsTable.requestNo }).from(preparationRequestsTable)
      .where(and(eq(preparationRequestsTable.id, requestId), eq(preparationRequestsTable.status, "active"))).limit(1);
    if (!request) throw new PreparationRequestError("طلب التجهيز غير موجود", 404);
    const [item] = await tx.select({ id: preparationRequestItemsTable.id, name: preparationRequestItemsTable.name, taskId: preparationRequestItemsTable.taskId }).from(preparationRequestItemsTable)
      .where(and(eq(preparationRequestItemsTable.requestId, requestId), eq(preparationRequestItemsTable.id, itemId))).for("update").limit(1);
    if (!item) throw new PreparationRequestError("عنصر التجهيز غير موجود", 404);
    let taskId = item.taskId;
    if (patch.assigneeId !== undefined) {
      if (patch.assigneeId) {
        const [staff] = await tx.select({ id: staffTable.id }).from(staffTable).where(and(eq(staffTable.id, patch.assigneeId), eq(staffTable.isActive, true))).limit(1);
        if (!staff) throw new PreparationRequestError("الموظف غير متاح");
        const title = `تجهيز: ${item.name} · ${request.number || requestId}`;
        if (taskId) await tx.update(tasksTable).set({ title, assignedStaffIds: [staff.id], archivedAt: null, updatedAt: new Date() }).where(eq(tasksTable.id, taskId));
        else {
          const [task] = await tx.insert(tasksTable).values({ title, taskType: "preparation", status: "new", priority: "normal", assignedStaffIds: [staff.id], relatedType: "preparation_request", relatedId: requestId, createdBy: actorId }).returning({ id: tasksTable.id });
          if (!task) throw new Error("Preparation task insert returned no row");
          taskId = task.id;
        }
      } else if (taskId) {
        await tx.update(tasksTable).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(tasksTable.id, taskId));
        taskId = null;
      }
    }
    await tx.update(preparationRequestItemsTable).set({ ...patch, taskId, updatedAt: new Date() }).where(eq(preparationRequestItemsTable.id, itemId));
    return { ok: true, requestId, itemId };
  });
}

type LinkedPreparationTask = {
  id: number; taskType: string | null; relatedType: string | null; relatedId: number | null;
  assignedStaffIds: unknown; status: string;
};
export type PreparationCompletionTransaction = {
  taskForUpdate(id: number): Promise<LinkedPreparationTask | null>;
  activeRequest(id: number): Promise<boolean>;
  itemForTask(requestId: number, taskId: number): Promise<{ id: number; status: string } | null>;
  completeItem(id: number, now: Date): Promise<void>;
  completeTask(id: number, actorId: number, now: Date): Promise<void>;
};
export type PreparationCompletionRepository = {
  transaction<T>(fn: (tx: PreparationCompletionTransaction) => Promise<T>): Promise<T>;
};

const productionCompletionRepository: PreparationCompletionRepository = {
  transaction: (fn) => db.transaction(async (tx) => fn({
    taskForUpdate: async (id) => {
      const [task] = await tx.select({
        id: tasksTable.id, taskType: tasksTable.taskType, relatedType: tasksTable.relatedType,
        relatedId: tasksTable.relatedId, assignedStaffIds: tasksTable.assignedStaffIds, status: tasksTable.status,
      }).from(tasksTable).where(eq(tasksTable.id, id)).for("update").limit(1);
      return task ?? null;
    },
    activeRequest: async (id) => {
      const [request] = await tx.select({ id: preparationRequestsTable.id }).from(preparationRequestsTable)
        .where(and(eq(preparationRequestsTable.id, id), eq(preparationRequestsTable.status, "active"))).for("share").limit(1);
      return Boolean(request);
    },
    itemForTask: async (requestId, taskId) => {
      const [item] = await tx.select({ id: preparationRequestItemsTable.id, status: preparationRequestItemsTable.status })
        .from(preparationRequestItemsTable).where(and(eq(preparationRequestItemsTable.requestId, requestId), eq(preparationRequestItemsTable.taskId, taskId)))
        .for("update").limit(1);
      return item ?? null;
    },
    completeItem: async (id, now) => { await tx.update(preparationRequestItemsTable).set({ status: "completed", updatedAt: now }).where(eq(preparationRequestItemsTable.id, id)); },
    completeTask: async (id, actorId, now) => { await tx.update(tasksTable).set({ status: "completed", completedBy: actorId, completedAt: now, updatedAt: now }).where(eq(tasksTable.id, id)); },
  })),
};

/** Staff completion must never mark a task done without its matching request item. */
export async function completeStandalonePreparationTask(
  taskId: number, actorId: number, manager: boolean,
  repository: PreparationCompletionRepository = productionCompletionRepository,
): Promise<{ requestId: number; itemId: number; alreadyCompleted: boolean }> {
  return repository.transaction(async (tx) => {
    const task = await tx.taskForUpdate(taskId);
    if (!task || task.taskType !== "preparation" || task.relatedType !== "preparation_request" || !task.relatedId)
      throw new PreparationRequestError("المهمة غير موجودة", 404);
    if (!manager && (!Array.isArray(task.assignedStaffIds) || !task.assignedStaffIds.includes(actorId)))
      throw new PreparationRequestError("هذه المهمة غير مسندة إليك", 403);
    if (!await tx.activeRequest(task.relatedId)) throw new PreparationRequestError("طلب التجهيز غير موجود", 404);
    const item = await tx.itemForTask(task.relatedId, task.id);
    if (!item) throw new PreparationRequestError("عنصر التجهيز المرتبط بالمهمة غير موجود", 409);
    const alreadyCompleted = task.status === "completed" && item.status === "completed";
    if (!alreadyCompleted) {
      const now = new Date();
      await tx.completeItem(item.id, now);
      await tx.completeTask(task.id, actorId, now);
    }
    return { requestId: task.relatedId, itemId: item.id, alreadyCompleted };
  });
}
