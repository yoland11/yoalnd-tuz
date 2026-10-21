import { db, serviceOrdersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  equipmentKey,
  equipmentAvailability,
  normalizeEquipment,
  selectTemplateEquipment,
  type KoshaEquipmentLine,
} from "@/lib/kosha-equipment";
import { routedKoshaCustomFieldsSql } from "./kosha-instruction-store";
import { bookingEvidenceWriteSql } from "./booking-operations-write-guard";
import { bucketsOf, quantityAvailability, quantityProfilesFor } from "./quantity-assets";

export class KoshaEquipmentError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

/** References existing assignments, products and variants; no duplicate inventory. */
export async function readKoshaEquipment(
  koshaId: number,
  executor: Pick<typeof db, "execute"> = db,
) {
  const result = await executor.execute(sql`
    select a.product_id, a.quantity, a.notes, a.shared,
      to_jsonb(a)->'equipment_config' as config,
      coalesce(p.name_ar,p.name) as name, p.images
    from kosha_asset_assignments a join products p on p.id=a.product_id
    where a.kosha_id=${koshaId} and a.is_active=true order by a.id
  `);
  return result.rows.flatMap((row: any) => {
    const lines = normalizeEquipment(
      Array.isArray(row.config)
        ? row.config
        : [
            {
              productId: Number(row.product_id),
              variantId: null,
              quantity: Number(row.quantity),
              unit: "قطعة",
              returnable: true,
              required: true,
              notes: row.notes ?? "",
            },
          ],
    );
    return lines.map((line) => ({
      ...line,
      name: row.name,
      imageUrl: Array.isArray(row.images) ? (row.images[0] ?? null) : null,
      shared: row.shared,
    }));
  });
}

type EquipmentBooking = { source: string; id: number };

/** Appends to the EXISTING reservation/asset workflow in one transaction.
 * No checkout, stock deduction, financial recalculation or historical rewrite.
 */
export async function bookingKoshaEquipment(
  booking: EquipmentBooking,
  action: "preview" | "confirm",
  requested: unknown,
  who: { id: number | null; name: string },
  database: Pick<typeof db, "transaction"> = db,
) {
  return database.transaction(async (tx) => {
    const native = booking.source === "kosha";
    const sourceType = native ? "kosha_booking" : "service_order";
    const locked = await tx.execute(
      native
        ? sql`select id,kosha_id,status,event_date,booking_details as details,customer_name from kosha_bookings where id=${booking.id} and archived_at is null for update`
        : sql`select id,status,event_date,custom_fields as details,customer_name from service_orders where id=${booking.id} and archived_at is null for update`,
    );
    const row: any = locked.rows[0];
    if (!row) throw new KoshaEquipmentError("الحجز غير موجود", 404);
    if (["cancelled", "canceled", "deleted"].includes(String(row.status)))
      throw new KoshaEquipmentError("لا يمكن تجهيز حجز ملغي", 409);
    const details = row.details ?? {};
    const koshaId = Number(native ? row.kosha_id : details.koshaId);
    if (!Number.isSafeInteger(koshaId) || koshaId <= 0)
      return { koshaId: null, items: [], message: "الحجز غير مرتبط بكوشة" };
    const template = await readKoshaEquipment(koshaId, tx);
    let lines: KoshaEquipmentLine[];
    try {
      lines =
        requested === undefined
          ? normalizeEquipment(template)
          : selectTemplateEquipment(template, requested);
    } catch (e) {
      throw new KoshaEquipmentError((e as Error).message);
    }
    if (lines.some((l) => l.returnable && !Number.isInteger(l.quantity)))
      throw new KoshaEquipmentError(
        "كمية المعدات القابلة للإرجاع يجب أن تكون صحيحة وفق نظام العهدة الحالي",
      );
    const ops = details.bookingOperations ?? {};
    const assets: any[] = Array.isArray(ops.assets) ? [...ops.assets] : [];
    const own = await tx.execute(
      sql`select product_id,variant_id,quantity,status from stock_reservations where source_type=${sourceType} and source_id=${booking.id} and status<>'released'`,
    );
    const ownKeys = new Set(
      own.rows.map((r: any) =>
        equipmentKey({
          productId: Number(r.product_id),
          variantId: r.variant_id == null ? null : Number(r.variant_id),
        }),
      ),
    );
    const ownAssetIds = new Set(assets.map((a: any) => Number(a.productId)));
    for (const a of Array.isArray(details.linkedAssets)
      ? details.linkedAssets
      : [])
      ownAssetIds.add(Number(a.productId));
    const products = new Map<number, any>();
    for (const id of [...new Set(lines.map((l) => l.productId))].sort(
      (a, b) => a - b,
    )) {
      const result = await tx.execute(
        sql`select id,stock,shared_stock_product_id from products where id=${id} for update`,
      );
      if (!result.rows.length)
        throw new KoshaEquipmentError("إحدى مواد القالب لم تعد موجودة", 409);
      // Do not implement a second shared-stock resolver. Those records must use
      // the canonical inventory selector until its reservation identity is available.
      if (Number(result.rows[0].shared_stock_product_id) > 0)
        throw new KoshaEquipmentError(
          "هذه المادة تستخدم مخزوناً مشتركاً؛ اختر أصل المخزون من إدارة القالب",
          409,
        );
      products.set(id, result.rows[0]);
    }
    const day = String(row.event_date ?? "").slice(0, 10);
    // Quantity-based assets share one master record; overlapping bookings may
    // each hold part of the quantity instead of blocking the whole asset.
    const quantityProfiles = await quantityProfilesFor(tx, [...products.keys()]);
    const preview: any[] = [];
    for (const line of lines) {
      let stock = Number(products.get(line.productId)?.stock ?? 0);
      if (line.variantId !== null) {
        const variant = await tx.execute(
          sql`select stock from product_variants where id=${line.variantId} and product_id=${line.productId} for update`,
        );
        if (!variant.rows.length)
          throw new KoshaEquipmentError("متغير المادة لم يعد متاحاً", 409);
        stock = Number(variant.rows[0].stock);
      } else {
        const variants = await tx.execute(
          sql`select id from product_variants where product_id=${line.productId} limit 1`,
        );
        if (variants.rows.length)
          throw new KoshaEquipmentError("حدد متغير المادة من قالب الكوشة", 409);
      }
      const quantityProfile = line.returnable
        ? quantityProfiles.get(line.productId)
        : undefined;
      if (quantityProfile) {
        const profile = await tx.execute(
          sql`select status from asset_profiles where product_id=${line.productId}`,
        );
        const blocked = [
          "maintenance",
          "lost",
          "retired",
          "locked",
          "sold",
          "disposed",
        ].includes(String(profile.rows[0]?.status));
        const requestedTotal = lines
          .filter((l) => l.returnable && l.productId === line.productId)
          .reduce((sum, l) => sum + l.quantity, 0);
        const { availability } = await quantityAvailability(tx, {
          productId: line.productId,
          day: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
          exclude: { source: sourceType, bookingId: booking.id },
          buckets: bucketsOf(quantityProfile, products.get(line.productId)?.stock),
        });
        const available = blocked ? 0 : availability.available;
        const info = template.find((l) => equipmentKey(l) === equipmentKey(line));
        preview.push({
          ...line,
          required: line.quantity,
          available,
          reserved: availability.committed,
          missing: Math.max(0, requestedTotal - available),
          requestedTotal,
          trackingMode: "quantity",
          unit: quantityProfile.unit,
          name: info?.name ?? "",
          imageUrl: info?.imageUrl ?? null,
          alreadyImported:
            ownAssetIds.has(line.productId) ||
            own.rows.some((r: any) => Number(r.product_id) === line.productId),
          blocked,
        });
        continue;
      }
      const reservedResult = await tx.execute(
        sql`select coalesce(sum(quantity),0) as quantity from stock_reservations where product_id=${line.productId} and status='reserved' and (${line.variantId}::integer is null or variant_id=${line.variantId}) and not(source_type=${sourceType} and source_id=${booking.id})`,
      );
      let reserved = Number(reservedResult.rows[0].quantity);
      let blocked = false;
      {
        const profile = await tx.execute(
          sql`select status from asset_profiles where product_id=${line.productId}`,
        );
        blocked = [
          "maintenance",
          "lost",
          "retired",
          "locked",
          "sold",
          "disposed",
        ].includes(String(profile.rows[0]?.status));
        const conflicts = await tx.execute(sql`
          select count(*) as quantity from (
            select 'kosha_booking' as source,id,booking_details as details from kosha_bookings where archived_at is null and status not in ('cancelled','completed','deleted') and (${day}='' or event_date::text like ${day + "%"})
            union all
            select 'service_order',id,custom_fields from service_orders where archived_at is null and status not in ('cancelled','completed','delivered','deleted') and (${day}='' or event_date like ${day + "%"})
          ) b cross join lateral jsonb_array_elements(
            (case when jsonb_typeof(b.details->'bookingOperations'->'assets')='array' then b.details->'bookingOperations'->'assets' else '[]'::jsonb end)
            || (case when jsonb_typeof(b.details->'linkedAssets')='array' then b.details->'linkedAssets' else '[]'::jsonb end)
          ) a
          where not(b.source=${sourceType} and b.id=${booking.id}) and a->>'productId'=${String(line.productId)} and coalesce(a->>'stage','linked') not in ('released','completed')
        `);
        // Include physical holds even for a consumable template line. A second
        // template cannot bypass an existing asset reservation by changing policy.
        // Existing asset workflow treats one product as a physical asset identity,
        // not independently reservable variants. Keep its conservative overlap guard.
        if (Number(conflicts.rows[0].quantity) > 0) blocked = true;
        const custody = await tx.execute(
          sql`select coalesce(sum(quantity),0) as quantity from equipment_custody where product_id=${line.productId} and status='issued'`,
        );
        reserved += Number(custody.rows[0].quantity);
      }
      // A template policy change must not add a second representation to an
      // existing booking. Physical assets are product-wide, stock holds variant-wide.
      const alreadyImported =
        ownAssetIds.has(line.productId) ||
        ownKeys.has(equipmentKey(line)) ||
        (line.returnable &&
          own.rows.some((r: any) => Number(r.product_id) === line.productId));
      const available = equipmentAvailability(
        blocked ? 0 : stock,
        reserved,
        line.quantity,
      );
      const info = template.find((l) => equipmentKey(l) === equipmentKey(line));
      preview.push({
        ...line,
        ...available,
        name: info?.name ?? "",
        imageUrl: info?.imageUrl ?? null,
        alreadyImported,
        blocked,
      });
    }
    if (action === "preview") return { koshaId, items: preview };
    if (["completed", "delivered"].includes(String(row.status)))
      throw new KoshaEquipmentError("لا يمكن استيراد معدات إلى حجز مكتمل", 409);
    const missing = preview.filter((l) => !l.alreadyImported && l.missing > 0);
    if (missing.length)
      throw new KoshaEquipmentError(
        `المعدات غير متاحة: ${missing
          .map((l) =>
            l.trackingMode === "quantity"
              ? `${l.name} (المتاح ${l.available} ${l.unit}، والمطلوب ${l.requestedTotal} ${l.unit})`
              : l.name,
          )
          .join("، ")}`,
        409,
      );
    const meta = { ...(ops.productMeta ?? {}) };
    const storeMeta = { ...(details.storeProductsMeta ?? {}) };
    let imported = 0;
    for (const line of preview.filter((l) => !l.alreadyImported)) {
      if (line.returnable) {
        if (assets.some((a) => Number(a.productId) === line.productId))
          continue;
        const group = preview.filter(
          (l) =>
            l.returnable &&
            l.productId === line.productId &&
            !l.alreadyImported,
        );
        const groupQuantity = group.reduce((sum, l) => sum + l.quantity, 0);
        assets.push({
          productId: line.productId,
          quantity: groupQuantity,
          stage: "reserved",
          source: "kosha_equipment",
          ...(line.trackingMode === "quantity"
            ? {
                trackingMode: "quantity",
                unit: line.unit,
                reservedQty: groupQuantity,
                preparedQty: 0,
                checkedOutQty: 0,
                returnedGoodQty: 0,
                returnedDamagedQty: 0,
                missingQty: 0,
              }
            : {}),
          equipmentLines: group.map(
            ({ productId, variantId, quantity, unit, notes }) => ({
              productId,
              variantId,
              quantity,
              unit,
              notes,
            }),
          ),
          reservedAt: new Date().toISOString(),
        });
        imported += group.length;
      } else {
        await tx.execute(
          sql`insert into stock_reservations(product_id,variant_id,quantity,source_type,source_id,source_label,status,created_by,created_by_name) values(${line.productId},${line.variantId},${line.quantity},${sourceType},${booking.id},${row.customer_name},'reserved',${who.id},${who.name})`,
        );
        meta[equipmentKey(line)] = {
          unitPrice: 0,
          discount: 0,
          note: line.notes,
          equipment: true,
          returnable: false,
          unit: line.unit,
        };
        storeMeta[equipmentKey(line)] = {
          unitPrice: 0,
          free: true,
          note: line.notes,
          equipment: true,
        };
        imported++;
      }
    }
    if (!imported) return { koshaId, items: preview, imported: 0 };
    const next = {
      ...details,
      storeProductsMeta: storeMeta,
      bookingOperations: { ...ops, assets, productMeta: meta },
    };
    if (native)
      await tx.execute(
        sql`update kosha_bookings set booking_details=${bookingEvidenceWriteSql(sql.raw("booking_details"),next)},updated_at=now() where id=${booking.id}`,
      );
    else
      await tx.execute(
        sql`update service_orders set custom_fields=${routedKoshaCustomFieldsSql(serviceOrdersTable.customFields, next)} where id=${booking.id}`,
      );
    await tx.execute(
      sql`insert into entity_timeline(entity_type,entity_id,type,title,actor_id,actor_name,metadata) values(${sourceType},${booking.id},'kosha_equipment_imported','استيراد معدات الكوشة',${who.id},${who.name},${JSON.stringify({ koshaId, count: imported })}::jsonb)`,
    );
    return { koshaId, items: preview, imported };
  });
}

export async function koshaEquipmentCatalog(search: string) {
  const q = `%${search.trim().replace(/[\\%_]/g, "\\$&")}%`;
  const result = await db.execute(sql`
    select p.id,coalesce(p.name_ar,p.name) as name,p.images,p.barcode,p.stock,p.is_asset,
      coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',concat_ws(' / ',v.color,v.size),'stock',v.stock) order by v.id)
        from product_variants v where v.product_id=p.id),'[]'::jsonb) as variants
    from products p where p.item_type <> 'service' and (p.name ilike ${q} or p.name_ar ilike ${q} or p.barcode ilike ${q})
    order by p.id desc limit 24
  `);
  return result.rows.map((r: any) => ({
    id: Number(r.id),
    name: r.name,
    imageUrl: Array.isArray(r.images) ? (r.images[0] ?? null) : null,
    barcode: r.barcode,
    stock: Number(r.stock),
    isAsset: r.is_asset === true,
    variants: r.variants,
  }));
}

export async function saveKoshaEquipment(
  koshaId: number,
  value: unknown,
  actorId: number | null,
  database: Pick<typeof db, "transaction"> = db,
) {
  let lines: KoshaEquipmentLine[];
  try {
    lines = normalizeEquipment(value);
  } catch (e) {
    throw new KoshaEquipmentError((e as Error).message);
  }
  if (lines.some((l) => l.returnable && !Number.isInteger(l.quantity)))
    throw new KoshaEquipmentError(
      "المعدات القابلة للإرجاع تتطلب كمية صحيحة وفق نظام العهدة الحالي؛ المواد المستهلكة تقبل الكسور",
    );
  return database.transaction(async (tx) => {
    const exists = await tx.execute(
      sql`select id from koshas where id=${koshaId} for update`,
    );
    if (!exists.rows.length)
      throw new KoshaEquipmentError("الكوشة غير موجودة", 404);
    const migration = await tx.execute(
      sql`select 1 from information_schema.columns where table_schema=current_schema() and table_name='kosha_asset_assignments' and column_name='equipment_config'`,
    );
    if (!migration.rows.length)
      throw new KoshaEquipmentError(
        "يلزم تطبيق ترقية بيانات معدات الكوشة قبل الحفظ",
        503,
      );
    const productIds = [...new Set(lines.map((l) => l.productId))].sort(
      (a, b) => a - b,
    );
    for (const productId of productIds) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`kosha-asset:${productId}`}))`,
      );
      const product = await tx.execute(
        sql`select id,item_type from products where id=${productId} for update`,
      );
      if (!product.rows.length || product.rows[0].item_type === "service")
        throw new KoshaEquipmentError("اختر معدات أو مواد موجودة بالمخزن");
      const dedicated = await tx.execute(
        sql`select 1 from kosha_asset_assignments where product_id=${productId} and kosha_id<>${koshaId} and is_active=true and shared=false`,
      );
      if (dedicated.rows.length)
        throw new KoshaEquipmentError(
          "المعدة مخصصة لكوشة أخرى؛ عدّل إسنادها من إدارة الأصول أولاً",
          409,
        );
      const group = lines.filter((l) => l.productId === productId);
      const variants = await tx.execute(
        sql`select id from product_variants where product_id=${productId}`,
      );
      const ids = new Set(variants.rows.map((r: any) => Number(r.id)));
      for (const l of group) {
        if (
          (l.variantId !== null && !ids.has(l.variantId)) ||
          (ids.size > 0 && l.variantId === null)
        )
          throw new KoshaEquipmentError(
            "اختر المتغير الصحيح لكل مادة لها متغيرات",
          );
      }
      if (new Set(group.map((l) => l.returnable)).size > 1)
        throw new KoshaEquipmentError(
          "متغيرات المادة الواحدة يجب أن تتبع نفس سياسة الإرجاع",
        );
      const quantity = group.reduce((sum, l) => sum + l.quantity, 0);
      await tx.execute(sql`
        insert into kosha_asset_assignments(kosha_id,product_id,quantity,shared,notes,is_active,assigned_by,equipment_config)
        values(${koshaId},${productId},${quantity},true,${group[0].notes},true,${actorId},${JSON.stringify(group)}::jsonb)
        on conflict(kosha_id,product_id) where is_active=true do update
        set quantity=excluded.quantity,shared=true,notes=excluded.notes,equipment_config=excluded.equipment_config
      `);
    }
    // Archive removed template associations, never delete physical equipment/history.
    const active = await tx.execute(
      sql`select id,product_id from kosha_asset_assignments where kosha_id=${koshaId} and is_active=true`,
    );
    for (const row of active.rows)
      if (!productIds.includes(Number(row.product_id)))
        await tx.execute(
          sql`update kosha_asset_assignments set is_active=false where id=${row.id}`,
        );
    return { ok: true, count: lines.length };
  });
}
