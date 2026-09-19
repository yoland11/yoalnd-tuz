import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * قائمة التجهيز — the ONE read-only preparation view over EXISTING data. It never
 * creates a parallel booking/inventory/product system: preparation items ARE the
 * booking's live `stock_reservations` (materials) plus its linked assets, all on
 * the SAME booking id. Availability is always REAL:
 *   available = product.stock − reserved-by-OTHER-bookings   (never total stock).
 *
 * Per-item preparation state (prep status / assignee / priority / deadline / note)
 * is stored additively inside the existing `bookingOperations.productMeta[key].prep`
 * jsonb — no new table, no migration. This module only READS; writes happen through
 * the guarded endpoints in a later phase.
 */

export type PreparationSource = "service" | "kosha";
const entityOf = (source: PreparationSource) => (source === "kosha" ? "kosha_booking" : "service_order");

export type PreparationStatus =
  | "ready" // جاهز
  | "preparing" // قيد التجهيز
  | "shortage" // ناقص
  | "needs_purchase" // يحتاج شراء
  | "reserved_elsewhere" // محجوز لحجز آخر
  | "damaged" // تالف
  | "lost" // مفقود
  | "unavailable" // غير متوفر
  | "completed"; // مكتمل

export type PreparationPriority = "normal" | "important" | "urgent";

export type PreparationItem = {
  key: string; // productId:variantId
  reservationId: number | null;
  kind: "product" | "asset";
  productId: number | null;
  name: string;
  sku: string | null;
  department: string;
  required: number;
  totalStock: number;
  reservedByOthers: number;
  available: number;
  shortfall: number;
  status: PreparationStatus;
  assigneeId: number | null;
  assigneeName: string | null;
  priority: PreparationPriority;
  deadline: string | null;
  note: string | null;
  evidenceCount: number;
};

export type PreparationRollup = {
  total: number;
  ready: number;
  preparing: number;
  shortage: number;
  needsPurchase: number;
  completed: number;
  progress: number; // % of items ready/completed
};

export type PreparationSummary = {
  source: PreparationSource;
  id: number;
  items: PreparationItem[];
  rollup: PreparationRollup;
};

type Executor = { execute: (query: any) => Promise<any> };
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

/** Keyword → department classification (reuses the SERVICE_META vocabulary). */
const DEPARTMENT_HINTS: Array<[string, string[]]> = [
  ["kosha", ["كوش", "kosha", "خلفية", "ستيج", "stage"]],
  ["lighting", ["إضاء", "اضاء", "light", "led", "سبوت"]],
  ["sound", ["صوت", "sound", "سماع", "speaker", "مكبر", "audio", "مايك", "mic"]],
  ["photography", ["تصوير", "camera", "كاميرا", "photo", "عدسة", "lens", "درون", "drone"]],
  ["flowers", ["ورد", "زهور", "flower", "بوكيه", "bouquet"]],
  ["gifts", ["هدية", "هدايا", "توزيع", "gift"]],
  ["graduation", ["تخرج", "graduation", "قبعة"]],
  ["invitations", ["دعو", "invitation", "كارت"]],
  ["transport", ["نقل", "transport", "شاحنة", "سيارة"]],
];
export function classifyDepartment(...text: Array<string | null | undefined>): string {
  const value = text.filter(Boolean).join(" ").toLocaleLowerCase("ar");
  for (const [dept, hints] of DEPARTMENT_HINTS) if (hints.some((hint) => value.includes(hint))) return dept;
  return "other";
}

export const PREPARATION_DEPARTMENT_LABELS: Record<string, string> = {
  kosha: "الكوشات",
  lighting: "الإضاءة",
  sound: "الصوتيات",
  photography: "التصوير",
  flowers: "الزهور",
  gifts: "الهدايا والتوزيعات",
  graduation: "تجهيزات التخرج",
  invitations: "الدعوات",
  transport: "النقل",
  equipment: "المعدات",
  other: "أخرى",
};

function computeStatus(input: {
  required: number;
  available: number;
  totalStock: number;
  reservationStatus: string | null;
  prepStatus: string | null;
}): PreparationStatus {
  const { required, available, totalStock, reservationStatus, prepStatus } = input;
  // Manual/lifecycle overrides win.
  if (prepStatus === "completed" || reservationStatus === "consumed") return "completed";
  if (prepStatus === "damaged") return "damaged";
  if (prepStatus === "lost") return "lost";
  if (prepStatus === "ready") return "ready";
  if (prepStatus === "preparing") return "preparing";
  if (required <= 0) return "ready";
  if (available >= required) return "ready";
  if (available <= 0) return totalStock <= 0 ? "needs_purchase" : "reserved_elsewhere";
  return "shortage";
}

function readPrep(meta: Record<string, any>, key: string) {
  const prep = (meta?.[key]?.prep ?? {}) as Record<string, any>;
  return {
    prepStatus: prep.status ? String(prep.status) : null,
    assigneeId: prep.assigneeId != null ? Number(prep.assigneeId) : null,
    assigneeName: prep.assigneeName ? String(prep.assigneeName) : null,
    priority: (["normal", "important", "urgent"].includes(prep.priority) ? prep.priority : "normal") as PreparationPriority,
    deadline: prep.deadline ? String(prep.deadline) : null,
    note: prep.note ? String(prep.note) : null,
  };
}

function rollupOf(items: PreparationItem[]): PreparationRollup {
  const total = items.length;
  const ready = items.filter((i) => i.status === "ready").length;
  const preparing = items.filter((i) => i.status === "preparing").length;
  const shortage = items.filter((i) => i.status === "shortage").length;
  const needsPurchase = items.filter((i) => i.status === "needs_purchase").length;
  const completed = items.filter((i) => i.status === "completed").length;
  const done = ready + completed;
  return { total, ready, preparing, shortage, needsPurchase, completed, progress: total ? Math.round((done / total) * 100) : 0 };
}

/** The authoritative, read-only preparation summary for ONE booking. */
export async function getBookingPreparationSummary(
  source: PreparationSource,
  id: number,
  executor: Executor = db,
): Promise<PreparationSummary | null> {
  const entity = entityOf(source);
  const bookingRow = (
    await executor.execute(
      source === "kosha"
        ? sql`SELECT booking_details AS details FROM kosha_bookings WHERE id = ${id} AND archived_at IS NULL`
        : sql`SELECT custom_fields AS details FROM service_orders WHERE id = ${id} AND archived_at IS NULL`,
    )
  ).rows?.[0] as any;
  if (!bookingRow) return null;
  const ops = ((bookingRow.details ?? {}).bookingOperations ?? {}) as Record<string, any>;
  const productMeta = (ops.productMeta ?? {}) as Record<string, any>;

  const rows = (
    await executor.execute(sql`
      SELECT r.id AS reservation_id, r.product_id, r.variant_id, r.quantity::text AS quantity, r.status AS reservation_status,
             coalesce(p.name_ar, p.name) AS name, p.barcode, p.category, p.stock::text AS stock,
             coalesce((SELECT sum(o.quantity::numeric) FROM stock_reservations o
                       WHERE o.product_id = r.product_id AND o.status <> 'released'
                         AND NOT (o.source_type = ${entity} AND o.source_id = ${id})), 0)::text AS reserved_others
      FROM stock_reservations r
      JOIN products p ON p.id = r.product_id
      WHERE r.source_type = ${entity} AND r.source_id = ${id} AND r.status <> 'released'
      ORDER BY r.id DESC
    `)
  ).rows as any[];

  const items: PreparationItem[] = rows.map((row) => {
    const productId = Number(row.product_id);
    const variantId = row.variant_id == null ? 0 : Number(row.variant_id);
    const key = `${productId}:${variantId}`;
    const required = num(row.quantity);
    const totalStock = num(row.stock);
    const reservedByOthers = round2(num(row.reserved_others));
    const available = Math.max(0, round2(totalStock - reservedByOthers));
    const prep = readPrep(productMeta, key);
    const status = computeStatus({ required, available, totalStock, reservationStatus: String(row.reservation_status ?? ""), prepStatus: prep.prepStatus });
    return {
      key,
      reservationId: Number(row.reservation_id),
      kind: "product",
      productId,
      name: String(row.name ?? `#${productId}`),
      sku: row.barcode ? String(row.barcode) : null,
      department: classifyDepartment(row.category, row.name),
      required,
      totalStock,
      reservedByOthers,
      available,
      shortfall: Math.max(0, round2(required - available)),
      status,
      assigneeId: prep.assigneeId,
      assigneeName: prep.assigneeName,
      priority: prep.priority,
      deadline: prep.deadline,
      note: prep.note,
      evidenceCount: Array.isArray(productMeta?.[key]?.prep?.evidence) ? productMeta[key].prep.evidence.length : 0,
    };
  });

  // Linked assets (equipment) become preparation items too — availability is the
  // asset itself; status follows its lifecycle stage.
  const assets = Array.isArray(ops.assets) ? ops.assets : [];
  for (const asset of assets) {
    const productId = asset?.productId != null ? Number(asset.productId) : null;
    const key = `asset:${productId ?? asset?.id ?? Math.random().toString(36).slice(2)}`;
    const stage = String(asset?.stage ?? "linked");
    const prep = readPrep(productMeta, key);
    const status: PreparationStatus =
      prep.prepStatus === "damaged" || asset?.problem === "damaged"
        ? "damaged"
        : prep.prepStatus === "lost" || asset?.problem === "missing"
          ? "lost"
          : ["out", "returned", "inspection", "completed"].includes(stage)
            ? "completed"
            : stage === "picked"
              ? "preparing"
              : "ready";
    items.push({
      key,
      reservationId: null,
      kind: "asset",
      productId,
      name: String(asset?.name ?? asset?.productName ?? (productId ? `أصل #${productId}` : "أصل")),
      sku: asset?.assetCode ? String(asset.assetCode) : null,
      department: "equipment",
      required: Math.max(1, num(asset?.quantity ?? 1)),
      totalStock: 1,
      reservedByOthers: 0,
      available: 1,
      shortfall: 0,
      status,
      assigneeId: prep.assigneeId,
      assigneeName: prep.assigneeName,
      priority: prep.priority,
      deadline: prep.deadline,
      note: prep.note,
      evidenceCount: 0,
    });
  }

  return { source, id, items, rollup: rollupOf(items) };
}

export type PreparationCard = {
  source: PreparationSource;
  id: number;
  number: string;
  customerName: string;
  eventDate: string | null;
  location: string | null;
  departments: string[];
  rollup: PreparationRollup;
};

/**
 * Lightweight per-booking rollup for the main page cards, computed in two batch
 * reads (all live reservations + the bookings) so availability stays real without
 * a query per booking. Assets are not counted here (kept for the detail view).
 */
export async function listPreparationCards(executor: Executor = db): Promise<PreparationCard[]> {
  const reservations = (
    await executor.execute(sql`
      SELECT r.source_type, r.source_id, r.product_id, r.variant_id, r.quantity::text AS quantity, r.status AS reservation_status,
             coalesce(p.name_ar, p.name) AS name, p.category, p.stock::text AS stock
      FROM stock_reservations r
      JOIN products p ON p.id = r.product_id
      WHERE r.status <> 'released' AND r.source_type IN ('service_order', 'kosha_booking')
    `)
  ).rows as any[];

  // Total live reserved per product (across all bookings) for the availability math.
  const totalReservedByProduct = new Map<number, number>();
  const stockByProduct = new Map<number, number>();
  for (const row of reservations) {
    const pid = Number(row.product_id);
    totalReservedByProduct.set(pid, (totalReservedByProduct.get(pid) ?? 0) + num(row.quantity));
    stockByProduct.set(pid, num(row.stock));
  }

  const byBooking = new Map<string, PreparationItem[]>();
  const departmentsByBooking = new Map<string, Set<string>>();
  for (const row of reservations) {
    const source = row.source_type === "kosha_booking" ? "kosha" : "service";
    const bookingKey = `${source}:${Number(row.source_id)}`;
    const pid = Number(row.product_id);
    const required = num(row.quantity);
    const totalStock = stockByProduct.get(pid) ?? 0;
    const reservedByOthers = round2((totalReservedByProduct.get(pid) ?? 0) - required);
    const available = Math.max(0, round2(totalStock - reservedByOthers));
    const status = computeStatus({ required, available, totalStock, reservationStatus: String(row.reservation_status ?? ""), prepStatus: null });
    const dept = classifyDepartment(row.category, row.name);
    if (!byBooking.has(bookingKey)) byBooking.set(bookingKey, []);
    byBooking.get(bookingKey)!.push({ status } as PreparationItem);
    if (!departmentsByBooking.has(bookingKey)) departmentsByBooking.set(bookingKey, new Set());
    departmentsByBooking.get(bookingKey)!.add(dept);
  }

  const serviceIds: number[] = [];
  const koshaIds: number[] = [];
  for (const key of byBooking.keys()) {
    const [source, idStr] = key.split(":");
    (source === "kosha" ? koshaIds : serviceIds).push(Number(idStr));
  }
  const [serviceRows, koshaRows] = await Promise.all([
    serviceIds.length
      ? executor.execute(sql`SELECT id, coalesce(tracking_code, 'SRV-'||id) AS number, customer_name, event_date, event_location FROM service_orders WHERE id IN (${sql.join(serviceIds.map((i) => sql`${i}`), sql`,`)})`)
      : Promise.resolve({ rows: [] } as any),
    koshaIds.length
      ? executor.execute(sql`SELECT id, coalesce(tracking_code, 'KOSHA-'||id) AS number, customer_name, event_date FROM kosha_bookings WHERE id IN (${sql.join(koshaIds.map((i) => sql`${i}`), sql`,`)})`)
      : Promise.resolve({ rows: [] } as any),
  ]);
  const infoByKey = new Map<string, any>();
  for (const row of (serviceRows.rows ?? []) as any[]) infoByKey.set(`service:${Number(row.id)}`, row);
  for (const row of (koshaRows.rows ?? []) as any[]) infoByKey.set(`kosha:${Number(row.id)}`, row);

  const cards: PreparationCard[] = [];
  for (const [key, items] of byBooking) {
    const [source, idStr] = key.split(":");
    const info = infoByKey.get(key);
    if (!info) continue;
    cards.push({
      source: source as PreparationSource,
      id: Number(idStr),
      number: String(info.number ?? ""),
      customerName: String(info.customer_name ?? ""),
      eventDate: info.event_date ? String(info.event_date) : null,
      location: info.event_location ? String(info.event_location) : null,
      departments: [...(departmentsByBooking.get(key) ?? [])],
      rollup: rollupOf(items),
    });
  }
  cards.sort((a, b) => String(a.eventDate ?? "9999").localeCompare(String(b.eventDate ?? "9999")));
  return cards;
}
