import { sql } from "drizzle-orm";
import { assetPassportHasCustodyHold, custodyReturnBelongsToSource } from "./custody-source-safety";

export class IndividualCustodyError extends Error {
  constructor(message: string, public readonly status = 422, public readonly code = "CUSTODY_INVALID") {
    super(message);
    this.name = "IndividualCustodyError";
  }
}

export type IndividualCustodySource = { kind: "standalone" } | {
  kind: "linked"; entityType: string; entityId: number; issueNote: string;
};
export type IndividualCustodyInput = {
  mode: "checkout" | "return";
  productId: number;
  actorId: number;
  source: IndividualCustodySource;
  staffId?: number;
  custodyId?: number;
  quantity?: number;
  signatureUrl?: string | null;
  notes?: string | null;
  checklist?: { confirmed: boolean; reason?: string | null };
  problem?: "none" | "broken" | "lost";
  note?: string | null;
  repairCost?: number;
  managerApproval?: boolean;
  canRecordDamage?: boolean;
  canApproveLoss?: boolean;
  closeCustodyOnLoss?: boolean;
};
export type IndividualCustodyRow = {
  id: number; productId: number; staffId: number; quantity: number; status: string;
  signatureUrl: string | null; issuedAt: Date; returnedAt: Date | null; notes: string | null;
  issuedBy: number | null; createdAt: Date; updatedAt: Date;
};
export type IndividualCustodyResult = {
  row: IndividualCustodyRow;
  product: { id: number; name: string; costPrice: string };
  staffName: string;
  changed: boolean;
  problem: "none" | "broken" | "lost";
  repairCost: number;
};
type Executor = { execute(query: any): Promise<any> };
type Snapshot = { custody: IndividualCustodyRow | null; profile: Record<string, any> | null; passport: Record<string, any> | null };
export type IndividualCustodyDeps = {
  isQuantityTracked: (tx: Executor, productId: number) => Promise<boolean>;
  audit: (tx: Executor, event: {
    productId: number; staffId: number; action: "checkout" | "return" | "broken" | "lost";
    previous: Snapshot; next: Snapshot; source: IndividualCustodySource; custodyId: number;
  }) => Promise<void>;
};

const blocked = new Set(["maintenance", "lost", "retired", "locked", "sold", "disposed"]);
const protectedStatus = new Set(["lost", "retired", "locked", "sold", "disposed"]);
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const metadataOf = (passport: Record<string, any> | null): Record<string, unknown> =>
  passport?.metadata && typeof passport.metadata === "object" && !Array.isArray(passport.metadata) ? passport.metadata : {};

async function rows(tx: Executor, query: any): Promise<Record<string, any>[]> {
  const result = await tx.execute(query);
  if (!result || !Array.isArray(result.rows)) throw new Error("Invalid custody database response");
  return result.rows;
}
function custodyRow(row: Record<string, any>): IndividualCustodyRow {
  return { id: Number(row.id), productId: Number(row.product_id), staffId: Number(row.staff_id), quantity: Number(row.quantity),
    status: row.status, signatureUrl: row.signature_url ?? null, issuedAt: row.issued_at, returnedAt: row.returned_at ?? null,
    notes: row.notes ?? null, issuedBy: row.issued_by == null ? null : Number(row.issued_by), createdAt: row.created_at, updatedAt: row.updated_at };
}

/** The caller MUST pass its open transaction. No global connection, media,
 * notifications, cache work or stock writes belong in this executor. All routes
 * using it serialize custody on the original products.id, never a stock alias. */
export async function executeIndividualCustody(
  tx: Executor,
  input: IndividualCustodyInput,
  deps: IndividualCustodyDeps,
): Promise<IndividualCustodyResult> {
  if (!positiveId(input.productId) || !positiveId(input.actorId)) throw new IndividualCustodyError("معرّف الأصل أو الموظف غير صحيح");
  if (input.mode !== "checkout" && input.mode !== "return") throw new IndividualCustodyError("الإجراء غير مدعوم");
  if (!input.source || !["standalone", "linked"].includes(input.source.kind)) throw new IndividualCustodyError("مصدر العهدة غير صحيح");
  const source = input.source;
  if (source.kind === "linked" && (!source.entityType.trim() || !positiveId(source.entityId) || !source.issueNote.trim()))
    throw new IndividualCustodyError("مصدر العهدة غير صحيح");
  if (input.custodyId !== undefined && !positiveId(input.custodyId)) throw new IndividualCustodyError("معرّف العهدة غير صحيح");
  if (input.mode === "return" && source.kind === "standalone" && !input.custodyId)
    throw new IndividualCustodyError("معرّف العهدة مطلوب للإرجاع");
  const problem = input.problem ?? "none";
  if (!["none", "broken", "lost"].includes(problem)) throw new IndividualCustodyError("حالة الإرجاع غير صحيحة");
  if (input.repairCost !== undefined && (!Number.isFinite(input.repairCost) || input.repairCost < 0))
    throw new IndividualCustodyError("تكلفة الصيانة غير صحيحة");
  const repairCost = problem === "broken" ? input.repairCost ?? 0 : 0;

  const [originalProduct] = await rows(tx, sql`select id, name, name_ar, cost_price, is_active from products where id = ${input.productId} for update`);
  if (!originalProduct) throw new IndividualCustodyError("الأصل غير موجود", 404);
  if (await deps.isQuantityTracked(tx, input.productId))
    throw new IndividualCustodyError("هذا أصل متعدد الكمية؛ استخدم مسار إخراج وإرجاع أصول الحجز بالكمية", 409);
  if (source.kind === "linked") {
    const linked = await rows(tx, sql`select product_id from asset_links where product_id = ${input.productId} and entity_type = ${source.entityType} and entity_id = ${source.entityId} for share`);
    if (!linked.length) throw new IndividualCustodyError("هذا الأصل غير مرتبط بهذا الطلب", 409);
  }
  const product = { id: Number(originalProduct.id), name: String(originalProduct.name_ar || originalProduct.name), costPrice: String(originalProduct.cost_price ?? "0") };
  const owns = (row: Record<string, any>) => custodyReturnBelongsToSource(row, source.kind === "linked" ? source.issueNote : undefined);
  const readStaff = async (id: number, checkout: boolean) => {
    const [staff] = await rows(tx, sql`select id, full_name, username, is_active from staff where id = ${id}`);
    if (!staff) throw new IndividualCustodyError("الموظف غير موجود", 404);
    if (checkout && staff.is_active === false) throw new IndividualCustodyError("الموظف غير نشط");
    return String(staff.full_name || staff.username);
  };
  const replay = async (row: Record<string, any>): Promise<IndividualCustodyResult> => ({
    row: custodyRow(row), product, staffName: await readStaff(Number(row.staff_id), false), changed: false, problem, repairCost,
  });

  let original: Record<string, any> | undefined;
  if (input.mode === "return" && input.custodyId) {
    [original] = await rows(tx, sql`select * from equipment_custody where id = ${input.custodyId} for update`);
    if (!original) throw new IndividualCustodyError("العهدة غير موجودة", 404);
    if (Number(original.product_id) !== input.productId || !owns(original)) throw new IndividualCustodyError("العهدة لا تخص هذا الأصل أو المصدر", 409);
    // An old returned ID must never inspect or clear a later issue's holder.
    if (original.status === "returned") return replay(original);
    if (original.status !== "issued") throw new IndividualCustodyError("حالة العهدة لا تسمح بالإرجاع", 409);
  }
  const issued = await rows(tx, sql`select * from equipment_custody where product_id = ${input.productId} and status = 'issued' order by id desc for update`);
  if (issued.length > 1) throw new IndividualCustodyError("للأصل أكثر من عهدة مفتوحة؛ يلزم مراجعتها قبل المتابعة", 409);

  if (input.mode === "return") {
    if (!issued.length) {
      if (!original && source.kind === "linked") {
        const [previousReturn] = await rows(tx, sql`select * from equipment_custody where product_id = ${input.productId} and notes = ${source.issueNote} and status = 'returned' order by id desc limit 1`);
        if (previousReturn) return replay(previousReturn);
      }
      throw new IndividualCustodyError("لا توجد عهدة مفتوحة لهذا المصدر", 409);
    }
    if (!owns(issued[0]) || (original && Number(issued[0].id) !== Number(original.id)))
      throw new IndividualCustodyError("العهدة المفتوحة تخص مصدراً آخر", 409);
    // Legacy callers may omit the issue ID only when that source has a single
    // lifecycle. Otherwise a delayed return could close a later same-source issue.
    if (!original && source.kind === "linked") {
      const history = await rows(tx, sql`select id from equipment_custody where product_id = ${input.productId} and notes = ${source.issueNote} order by id desc limit 2`);
      if (history.length !== 1)
        throw new IndividualCustodyError("حدّث قائمة المعدات وحدد العهدة الأصلية قبل الإرجاع", 409, "CUSTODY_ID_REQUIRED");
    }
    original = issued[0];
  } else if (issued.length) throw new IndividualCustodyError("الأصل مُخرَج مسبقاً بعهدة", 409);

  const [profileRow] = await rows(tx, sql`select * from asset_profiles where product_id = ${input.productId} for update`);
  const [passportRow] = await rows(tx, sql`select * from asset_passports where product_id = ${input.productId} for update`);
  const profile = profileRow ?? null;
  const passport = passportRow ?? null;
  const metadata = metadataOf(passport);
  const previous: Snapshot = { custody: original ? custodyRow(original) : null, profile, passport };
  const upsertPassport = async (staffId: number | null, location: string | null, cost: number, nextMetadata: Record<string, unknown>) => {
    await tx.execute(sql`insert into asset_passports (product_id, last_staff_id, last_location, maintenance_cost, metadata)
      values (${input.productId}, ${staffId}, ${location}, ${String(cost)}, ${JSON.stringify(nextMetadata)}::jsonb)
      on conflict (product_id) do update set last_staff_id = excluded.last_staff_id, last_location = excluded.last_location,
      maintenance_cost = asset_passports.maintenance_cost + excluded.maintenance_cost, metadata = excluded.metadata, updated_at = now()`);
  };
  const upsertProfile = async (status: string) => {
    await tx.execute(sql`insert into asset_profiles (product_id, purchase_price, current_value, status)
      values (${input.productId}, ${product.costPrice}, ${product.costPrice}, ${status})
      on conflict (product_id) do update set status = excluded.status, updated_at = now()`);
    return { ...(profile ?? { product_id: input.productId, purchase_price: product.costPrice, current_value: product.costPrice }), status };
  };

  if (input.mode === "checkout") {
    if (originalProduct.is_active === false || profile?.deleted_at || blocked.has(profile?.status) || assetPassportHasCustodyHold(passport))
      throw new IndividualCustodyError("حالة الأصل أو إيقاف الفحص تمنع إخراجه", 423);
    const staffId = input.staffId ?? (source.kind === "linked" ? input.actorId : undefined);
    if (!positiveId(staffId)) throw new IndividualCustodyError("اختر الموظف المستلم");
    if (source.kind === "linked" && input.quantity !== undefined && input.quantity !== 1)
      throw new IndividualCustodyError("العهدة الفردية المرتبطة تسمح بقطعة واحدة فقط");
    const quantity = source.kind === "standalone" ? input.quantity ?? 1 : 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new IndividualCustodyError("الكمية يجب أن تكون عدداً صحيحاً موجباً");
    if (source.kind === "standalone" && !custodyReturnBelongsToSource({ notes: input.notes }))
      throw new IndividualCustodyError("صيغة الملاحظة محجوزة لمسار عهدة مرتبط؛ استخدم ملاحظة مستقلة");
    if (source.kind === "standalone" && input.checklist?.confirmed !== true && !input.checklist?.reason?.trim())
      throw new IndividualCustodyError("يجب تأكيد قائمة الفحص قبل إخراج الأصل، أو كتابة سبب النقص", 422, "CUSTODY_CHECKLIST_REQUIRED");
    const staffName = await readStaff(staffId, true);
    const [created] = await rows(tx, sql`insert into equipment_custody (product_id, staff_id, quantity, signature_url, notes, issued_by)
      values (${input.productId}, ${staffId}, ${quantity}, ${input.signatureUrl ?? null}, ${source.kind === "linked" ? source.issueNote : input.notes ?? null}, ${input.actorId}) returning *`);
    if (!created) throw new Error("Custody insert did not return its row");
    const location = `بعهدة ${staffName}`;
    await upsertPassport(staffId, location, 0, metadata);
    const row = custodyRow(created);
    await deps.audit(tx, { productId: input.productId, staffId, action: "checkout", previous,
      next: { custody: row, profile, passport: { ...(passport ?? {}), product_id: input.productId, last_staff_id: staffId, last_location: location, metadata } }, source, custodyId: row.id });
    return { row, product, staffName, changed: true, problem: "none", repairCost: 0 };
  }

  // A return always refers to the original unique issue, not the requested staff.
  if (!original) throw new IndividualCustodyError("العهدة غير موجودة", 409);
  if (passport?.last_staff_id != null && Number(passport.last_staff_id) !== Number(original.staff_id))
    throw new IndividualCustodyError("حامل جواز الأصل لا يطابق مستلم العهدة الأصلية", 409);
  if (problem === "broken" && input.canRecordDamage !== true) throw new IndividualCustodyError("ليس لديك صلاحية تسجيل تلف الأصل", 403);
  if (problem === "lost") {
    if (input.canApproveLoss !== true) throw new IndividualCustodyError("ليس لديك صلاحية اعتماد فقدان الأصل", 403);
    if (input.managerApproval !== true) throw new IndividualCustodyError("تسجيل الفقدان يتطلب اعتماد المدير");
    if (profile?.status === "lost" || metadata.individualCustodyLossId === Number(original.id)) return replay(original);
  }
  const staffName = await readStaff(Number(original.staff_id), false);
  let nextProfile = profile;
  const nextMetadata = problem === "none" ? metadata : { ...metadata, damageHold: true,
    ...(problem === "lost" ? { individualCustodyLossId: Number(original.id) } : {}) };
  if (problem === "broken") {
    if (!profile?.deleted_at && !protectedStatus.has(profile?.status) && !assetPassportHasCustodyHold(passport)) nextProfile = await upsertProfile("maintenance");
  } else if (problem === "lost") {
    if (!profile?.deleted_at && !protectedStatus.has(profile?.status)) nextProfile = await upsertProfile("lost");
  } else if (profile && !profile.deleted_at && !blocked.has(profile.status) && !assetPassportHasCustodyHold(passport) && profile.status !== "active") {
    await tx.execute(sql`update asset_profiles set status = ${"active"}, updated_at = now() where product_id = ${input.productId}`);
    nextProfile = { ...profile, status: "active" };
  }
  const close = problem !== "lost" || input.closeCustodyOnLoss === true;
  let row = custodyRow(original);
  if (close) {
    const [closed] = await rows(tx, sql`update equipment_custody set status = 'returned', returned_at = now(), updated_at = now()
      where id = ${Number(original.id)} and product_id = ${input.productId} and status = 'issued' returning *`);
    if (!closed) throw new IndividualCustodyError("تغيرت العهدة أثناء الإرجاع؛ أعد المحاولة", 409);
    row = custodyRow(closed);
  }
  const holder = close ? null : passport?.last_staff_id == null ? Number(original.staff_id) : Number(passport.last_staff_id);
  const location = problem === "lost" ? "مفقود" : "داخل المخزن";
  await upsertPassport(holder, location, repairCost, nextMetadata);
  await deps.audit(tx, { productId: input.productId, staffId: Number(original.staff_id), action: problem === "none" ? "return" : problem, previous,
    next: { custody: row, profile: nextProfile, passport: { ...(passport ?? {}), product_id: input.productId,
      last_staff_id: holder, last_location: location, maintenance_cost: String(Number(passport?.maintenance_cost ?? 0) + repairCost), metadata: nextMetadata } }, source, custodyId: row.id });
  return { row, product, staffName, changed: true, problem, repairCost };
}
