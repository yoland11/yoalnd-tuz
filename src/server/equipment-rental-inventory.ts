import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { parseBookingResourceWindow } from "@/lib/booking-resource-window";
import { lineOutstanding, normalizeQuantityLine, normalizeBuckets } from "@/lib/quantity-assets";
import { applyWarehouseDeltas, mainWarehouseId, warehouseBreakdowns } from "./warehouses";
import { bucketsOf, executeQuantityBookingAction, quantityAvailability, quantityProfilesFor, QuantityAssetError, type QuantityBookingInput } from "./quantity-assets";
import { findBookingPhysicalConflict } from "./booking-resource-availability";
import { executeIndividualCustody, type IndividualCustodyDeps } from "./individual-custody";
import { hasOpenRentalLoss } from "@/lib/equipment-rental-returns";
import type { EquipmentRentalDetails } from "@/lib/equipment-rentals";
import { assetPassportHasCustodyHold } from "./custody-source-safety";

type Executor = Pick<typeof db, "execute">;
type Details = Record<string, any>;
type Actor = { id: number | null; name: string };
export type EquipmentRentalInventoryLine = {
  productId: number; quantity?: number; warehouseId?: number;
  allocations?: Array<{ warehouseId: number; quantity: number }>;
  goodQuantity?: number; damagedQuantity?: number; missingQuantity?: number; pendingInspectionQuantity?: number;
  photoUrls?: string[]; staffId?: number; note?: string; description?: string; managerApproval?: boolean;
  /** Authorization facts supplied by the authenticated server adapter. */
  canRecordDamage?: boolean; canApproveLoss?: boolean;
};
type RentalReference = { rentalId: number; details: Details; startDate: string; status: string; customerName: string };
export type EquipmentRentalInventoryInput = RentalReference & {
  actor: Actor; requestId: string; action: "confirm" | "cancel" | "dispatch" | "return" | "inspection";
  lines?: EquipmentRentalInventoryLine[];
  saveDetails: (details: Details) => Promise<void>;
};

const blocked = new Set(["maintenance", "lost", "retired", "locked", "sold", "disposed"]);
const count = (n: unknown) => Number.isSafeInteger(Number(n)) && Number(n) >= 0 ? Number(n) : NaN;
const issueNote = (id: number) => `إخراج · عقد تأجير #${id}`;
const custodySource = (id: number) => ({ kind: "linked" as const, entityType: "rental_order", entityId: id, issueNote: issueNote(id) });
function custodyDependencies(rentalId: number, actor: Actor): IndividualCustodyDeps {
  return {
    isQuantityTracked: async (connection, productId) => (await quantityProfilesFor(connection as Executor, [productId])).has(productId),
    audit: async (connection, entry) => {
      await connection.execute(sql`insert into employee_custody_audit(product_id,staff_id,booking_type,booking_id,action,previous_value,new_value,actor_id,actor_name)
        values(${entry.productId},${entry.staffId},'rental_order',${rentalId},${entry.action},${JSON.stringify(entry.previous)}::jsonb,${JSON.stringify(entry.next)}::jsonb,${actor.id},${actor.name})`);
    },
  };
}

/** Called by the authorized rental transaction with the contract and assets locked. */
export async function finalizeRecordedEquipmentRentalLosses(tx: Executor, rentalId: number, details: EquipmentRentalDetails, actor: { id: number; name: string }) {
  const losses = details.assets.filter(hasOpenRentalLoss);
  if (!losses.length) throw new QuantityAssetError("لا توجد عهدة فقدان معلقة في هذا العقد", 409);
  for (const line of losses) {
    const custodyId = Number(line.custodyId);
    if (!Number.isSafeInteger(custodyId) || custodyId <= 0) throw new QuantityAssetError("تعذر تحديد العهدة الأصلية للمعدة المفقودة", 409);
    const result = await executeIndividualCustody(tx, {
      mode: "return", productId: line.productId, actorId: actor.id, custodyId, source: custodySource(rentalId),
      problem: "lost", canApproveLoss: true, managerApproval: true,
      closeCustodyOnLoss: true, finalizeRecordedRentalLoss: true,
    }, custodyDependencies(rentalId, actor));
    if (result.row.status !== "returned") throw new QuantityAssetError("تعذر إغلاق عهدة الفقدان الأصلية", 409);
    line.stage = "returned";
  }
}
async function rows(tx: Executor, query: any): Promise<any[]> {
  const result = await tx.execute(query);
  if (!Array.isArray(result?.rows)) throw Error("Invalid equipment rental inventory database response");
  return result.rows;
}
async function requireSchema(tx: Executor) {
  const [row] = await rows(tx, sql`select count(*)::integer as count from information_schema.columns
    where table_schema=current_schema() and table_name='rental_orders' and column_name in ('rental_kind','equipment_details')`);
  if (Number(row?.count) !== 2) throw new QuantityAssetError("يلزم تطبيق ترقية عقود تأجير المعدات 0134", 503);
}
function rentalAssets(details: Details): any[] {
  if (!Array.isArray(details.assets) || !details.assets.length || details.assets.length > 100) throw new QuantityAssetError("أضف معدات العقد أولاً", 422);
  const ids = details.assets.map((line: any) => Number(line.productId));
  if (ids.some((id: number) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length)
    throw new QuantityAssetError("معرّفات معدات العقد غير صحيحة أو مكررة", 422);
  return details.assets;
}
function timedReference(input: RentalReference) {
  parseBookingResourceWindow(input.details.resourceWindow, input.startDate);
  return { source: "rental" as const, id: input.rentalId, eventDate: input.startDate, operations: input.details };
}
async function individualFacts(tx: Executor, productId: number) {
  const [row] = await rows(tx, sql`select p.id,p.is_active,p.is_asset,p.stock,a.status,a.deleted_at,ap.metadata,
    exists(select 1 from equipment_custody c where c.product_id=p.id and c.status='issued') as issued
    from products p left join asset_profiles a on a.product_id=p.id left join asset_passports ap on ap.product_id=p.id where p.id=${productId}`);
  if (!row) throw new QuantityAssetError("الأصل غير موجود", 404);
  return row;
}

/** Original product/profile/commitment readers; no replica of available stock. */
export async function equipmentRentalAvailability(tx: Executor, input: RentalReference) {
  await requireSchema(tx);
  const reference = timedReference(input), assets = rentalAssets(input.details);
  const profiles = await quantityProfilesFor(tx, assets.map(line => Number(line.productId)));
  const warehouses = await warehouseBreakdowns(tx, assets.map(line => Number(line.productId)));
  const mainId = await mainWarehouseId(tx);
  const output: any[] = [];
  for (const line of assets) {
    const productId = Number(line.productId), required = count(line.quantity);
    if (!required) throw new QuantityAssetError("كمية المعدات يجب أن تكون صحيحة وموجبة", 422);
    const facts = await individualFacts(tx, productId);
    if (facts.is_asset !== true || facts.is_active === false || facts.deleted_at || blocked.has(facts.status) || assetPassportHasCustodyHold(facts)) {
      output.push({ productId, required, available: 0, status: "blocked", trackingMode: profiles.has(productId) ? "quantity" : "individual" });
      continue;
    }
    const profile = profiles.get(productId);
    if (profile) {
      const warehouseId = Number(line.warehouseId || mainId);
      const share = warehouses.get(productId)?.shares.find(row => row.warehouseId === warehouseId);
      if (!share) throw new QuantityAssetError("المخزن المحدد غير موجود",404);
      const result = await quantityAvailability(tx, { productId, day: input.startDate,
        exclude: { source: "rental_order", bookingId: input.rentalId }, buckets: normalizeBuckets(share), warehouse: { id: warehouseId, mainId },
        interval: { start: input.details.resourceWindow.preparationStart, end: input.details.resourceWindow.returnEnd } });
      output.push({ productId, required, available: result.availability.available, status: result.availability.available >= required ? "available" : "shortage", trackingMode: "quantity" });
    } else {
      if (required !== 1) throw new QuantityAssetError("الأصل الفردي يسمح بقطعة واحدة فقط", 422);
      const conflict = await findBookingPhysicalConflict(reference, productId, tx);
      const own = line.stage === "out" && line.custodyId;
      const selected = warehouses.get(productId)?.shares.find(row => row.warehouseId === Number(line.warehouseId || mainId));
      const available = (!facts.issued || own) && !conflict && Number(selected?.inWarehouse ?? 0) >= 1 ? 1 : 0;
      output.push({ productId, required, available, status: available ? "available" : "shortage", trackingMode: "individual", conflict });
    }
  }
  return output;
}

/** The caller locks rental_orders first, then every products.id in ascending order
 * inside its transaction. The callback persists the same original rental JSON.
 * Every operation key is retained on that source for durable uncertain-response retries. */
export async function executeEquipmentRentalInventory(tx: Executor, input: EquipmentRentalInventoryInput) {
  if (!Number.isSafeInteger(input.rentalId) || input.rentalId <= 0) throw new QuantityAssetError("يلزم حفظ عقد الإيجار الأصلي قبل أي حركة مخزون",422);
  await requireSchema(tx);
  if (!/^[\w:.-]{8,200}$/.test(input.requestId)) throw new QuantityAssetError("معرّف طلب ثابت مطلوب", 422);
  let details: Details = structuredClone(input.details);
  rentalAssets(details);
  if (input.action === "cancel" && details.assets.some((line: any) => lineOutstanding(normalizeQuantityLine(line)) > 0 || Number(line.pendingInspectionQty ?? 0) > 0))
    throw new QuantityAssetError("أكمل إرجاع المعدات وفحصها قبل إلغاء العقد", 409);
  const requested = input.lines ?? [];
  if (new Set(requested.map(line => line.productId)).size !== requested.length) throw new QuantityAssetError("معدات الإجراء مكررة", 422);
  const fingerprint = JSON.stringify({ action: input.action, lines: requested });
  const previous = details.inventoryRequests?.[input.requestId];
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new QuantityAssetError("معرّف الطلب مستخدم لإجراء مختلف", 409);
    return { details, replayed: true };
  }
  if (["confirm", "dispatch"].includes(input.action)) {
    const available = await equipmentRentalAvailability(tx, { ...input, details });
    const shortage = available.find(row => row.available < (input.action === "confirm" ? row.required : requested.find(line => line.productId === row.productId)?.quantity ?? 0));
    if (shortage) throw new QuantityAssetError("الكمية غير متاحة لفترة العقد أو حالة الأصل تمنع الإخراج", 409, shortage);
  }
  const profiles = await quantityProfilesFor(tx, details.assets.map((line: any) => Number(line.productId)));
  const chosen: EquipmentRentalInventoryLine[] = ["confirm", "cancel"].includes(input.action)
    ? details.assets.map((line: any) => ({ productId: Number(line.productId), quantity: Number(line.quantity), warehouseId: line.warehouseId, allocations: line.allocations })) : requested;
  if (!chosen.length) throw new QuantityAssetError("حدد معدات الإجراء وكمياتها", 422);
  const persist = async () => { await input.saveDetails(details); };
  for (const part of [...chosen].sort((a, b) => a.productId - b.productId)) {
    const index = details.assets.findIndex((line: any) => Number(line.productId) === part.productId);
    if (index < 0) throw new QuantityAssetError("الأصل غير موجود ضمن العقد", 422);
    const line = details.assets[index];
    for (const value of [part.quantity, part.goodQuantity, part.damagedQuantity, part.missingQuantity, part.pendingInspectionQuantity])
      if (value !== undefined && !Number.isFinite(count(value))) throw new QuantityAssetError("كميات الإجراء يجب أن تكون أعداداً صحيحة غير سالبة", 422);
    if ((part.damagedQuantity ?? 0) > 0 && part.canRecordDamage !== true) throw new QuantityAssetError("ليس لديك صلاحية تسجيل تلف الأصل", 403);
    if ((part.missingQuantity ?? 0) > 0 && (part.canApproveLoss !== true || part.managerApproval !== true)) throw new QuantityAssetError("تسجيل الفقدان يتطلب صلاحية واعتماد المدير", 403);
    if (profiles.has(part.productId)) {
      const mode = ({ confirm: "reserve", cancel: "release", dispatch: "checkout", return: "return", inspection: "inspect" } as const)[input.action];
      const quantity = mode === "reserve" ? Number(line.quantity) : Number(part.quantity ?? 0);
      if (mode === "checkout" && (!quantity || quantity > Number(line.quantity) - normalizeQuantityLine(line).checkedOutQty))
        throw new QuantityAssetError("كمية الإخراج تتجاوز الكمية المتبقية في العقد", 409);
      await executeQuantityBookingAction(tx, {
        reference: { source: "rental", entityType: "rental_order", id: input.rentalId, eventDate: input.startDate,
          status: input.status, customerName: input.customerName, operations: details, details },
        action: { ...part, mode, quantity, problem: "none", estimatedCost: 0, photoUrls: part.photoUrls ?? [], managerApproval: part.managerApproval === true,
          requestId: `rental:${input.rentalId}:${input.requestId}:${input.action}`, description: part.description ?? part.note } as QuantityBookingInput,
        actor: input.actor, saveOperations: async operations => { details = operations; await persist(); },
      });
      continue;
    }
    if (Number(line.quantity) !== 1) throw new QuantityAssetError("الأصل الفردي يسمح بقطعة واحدة فقط", 422);
    if (input.action === "confirm") {
      await tx.execute(sql`insert into asset_links(product_id,entity_type,entity_id,quantity,created_by)
        values(${part.productId},'rental_order',${input.rentalId},1,${input.actor.id}) on conflict(product_id,entity_type,entity_id) do nothing`);
      details.assets[index] = { ...line, trackingMode: "individual", reservedQty: 1, stage: "reserved" };
    } else if (input.action === "cancel") {
      if (line.stage === "out" || Number(line.pendingInspectionQty) > 0 || Number(line.missingQty) > 0) throw new QuantityAssetError("أكمل الإرجاع والفحص قبل إلغاء العقد", 409);
      details.assets[index] = { ...line, reservedQty: 0, stage: "released" };
    } else if (input.action === "inspection") {
      await inspectIndividual(tx, input, part, line);
      details.assets[index] = { ...line, pendingInspectionQty: 0, returnedGoodQty: part.goodQuantity ?? 0,
        returnedDamagedQty: part.damagedQuantity ?? 0, stage: "completed", inspectedAt: new Date().toISOString() };
    } else {
      if (!input.actor.id) throw new QuantityAssetError("الموظف المنفذ مطلوب", 422);
      const returning = input.action === "return";
      const good = count(part.goodQuantity ?? 0), damaged = count(part.damagedQuantity ?? 0), missing = count(part.missingQuantity ?? 0), pending = count(part.pendingInspectionQuantity ?? 0);
      if (returning && good + damaged + missing + pending !== 1) throw new QuantityAssetError("حدد حالة إرجاع القطعة الفردية", 422);
      if (!returning && (part.quantity !== 1 || !part.staffId || line.stage === "out" || line.checkedOutQty > 0)) throw new QuantityAssetError("حدد موظف العهدة وقطعة واحدة غير مُخرجة", 422);
      if (returning && (!line.custodyId || line.stage !== "out")) throw new QuantityAssetError("لا توجد عهدة أصلية مفتوحة للقطعة في العقد", 409);
      const result = await executeIndividualCustody(tx, { mode: returning ? "return" : "checkout", productId: part.productId,
        actorId: input.actor.id, staffId: part.staffId, custodyId: returning ? Number(line.custodyId) : undefined, quantity: 1,
        source: custodySource(input.rentalId),
        problem: damaged ? "broken" : missing ? "lost" : "none", note: part.note, managerApproval: part.managerApproval,
        closeCustodyOnLoss: returning && missing > 0 && part.managerApproval === true,
        canRecordDamage: part.canRecordDamage, canApproveLoss: part.canApproveLoss,
      }, custodyDependencies(input.rentalId, input.actor));
      if (returning && !missing) {
        const sourceWarehouse = Number(line.warehouseId || await mainWarehouseId(tx));
        const destinationWarehouse = Number(part.warehouseId || sourceWarehouse);
        if (sourceWarehouse !== destinationWarehouse) {
          const breakdown = (await warehouseBreakdowns(tx, [part.productId])).get(part.productId)!;
          await applyWarehouseDeltas(tx, { productId: part.productId, company: breakdown.company, deltas: [
            { warehouseId: sourceWarehouse, inWarehouse: -1 }, { warehouseId: destinationWarehouse, inWarehouse: 1 },
          ] });
          await tx.execute(sql`insert into stock_movements(product_id,stock_source_product_id,quantity_change,reason,related_type,related_id,warehouse_id,to_warehouse_id,movement_type,idempotency_key,metadata,created_by,created_by_name)
            values(${part.productId},${part.productId},0,'rental_individual_return_location','rental_order',${input.rentalId},${sourceWarehouse},${destinationWarehouse},'transfer',${`rental-location:${input.rentalId}:${input.requestId}:${part.productId}`},${JSON.stringify({ custodyId: result.row.id, quantity: 1 })}::jsonb,${input.actor.id},${input.actor.name})`);
        }
        await tx.execute(sql`insert into asset_passports(product_id,warehouse_id) values(${part.productId},${destinationWarehouse}) on conflict(product_id) do update set warehouse_id=excluded.warehouse_id,updated_at=now()`);
        line.returnWarehouseId = destinationWarehouse;
      }
      if (returning && pending) {
        await tx.execute(sql`update asset_passports set metadata=coalesce(metadata,'{}'::jsonb)||${JSON.stringify({ inspectionBlocked: true, rentalInspectionId: input.rentalId, rentalInspectionCustodyId: result.row.id })}::jsonb,updated_at=now() where product_id=${part.productId}`);
        await tx.execute(sql`insert into asset_profiles(product_id,purchase_price,current_value,status) values(${part.productId},${result.product.costPrice},${result.product.costPrice},'maintenance')
          on conflict(product_id) do update set status='maintenance',updated_at=now() where asset_profiles.deleted_at is null and asset_profiles.status not in ('lost','retired','locked','sold','disposed')`);
      }
      details.assets[index] = { ...line, trackingMode: "individual", custodyId: result.row.id, staffId: result.row.staffId,
        checkedOutQty: 1, returnedGoodQty: good, returnedDamagedQty: damaged, missingQty: missing, pendingInspectionQty: pending,
        stage: returning ? pending ? "inspection" : "returned" : "out" };
    }
    await persist();
  }
  details.inventoryRequests = { ...(details.inventoryRequests ?? {}), [input.requestId]: { fingerprint, action: input.action, at: new Date().toISOString() } };
  await persist();
  return { details, replayed: false };
}

async function inspectIndividual(tx: Executor, input: EquipmentRentalInventoryInput, part: EquipmentRentalInventoryLine, line: any) {
  if (Number(line.pendingInspectionQty) !== 1 || Number(part.goodQuantity ?? 0) + Number(part.damagedQuantity ?? 0) !== 1 || Number(part.missingQuantity ?? 0))
    throw new QuantityAssetError("الفحص يتطلب قطعة معلقة ونتيجة سليم أو تالف", 409);
  const [passport] = await rows(tx, sql`select metadata from asset_passports where product_id=${part.productId} for update`);
  const metadata = passport?.metadata;
  if (!metadata || metadata.rentalInspectionId !== input.rentalId || metadata.rentalInspectionCustodyId !== Number(line.custodyId) || metadata.inspectionBlocked !== true)
    throw new QuantityAssetError("دليل الفحص لا يخص عهدة العقد الأصلية", 409);
  const [custody] = await rows(tx, sql`select id from equipment_custody where product_id=${part.productId} and status='issued' limit 1`);
  if (custody) throw new QuantityAssetError("للأصل عهدة مفتوحة؛ لا يمكن إنهاء فحص عهدة سابقة", 409);
  const { inspectionBlocked: _, rentalInspectionId: __, rentalInspectionCustodyId: ___, ...other } = metadata;
  const next = part.damagedQuantity ? { ...other, damageHold: true } : other;
  await tx.execute(sql`update asset_passports set metadata=${JSON.stringify(next)}::jsonb,updated_at=now() where product_id=${part.productId}`);
  if (!part.damagedQuantity && !assetPassportHasCustodyHold({ metadata: next }))
    await tx.execute(sql`update asset_profiles set status='active',updated_at=now() where product_id=${part.productId} and status='maintenance' and deleted_at is null`);
}
