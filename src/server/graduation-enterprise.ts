import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  adminActivityLogsTable,
  db,
  entityTimelineTable,
  graduationColorCombinationsTable,
  graduationComponentsTable,
  graduationDeliveryEventsTable,
  graduationDeliverySessionsTable,
  graduationGroupsTable,
  graduationInventoryReservationsTable,
  graduationKitItemsTable,
  graduationKitsTable,
  graduationMaterialRequirementsTable,
  graduationMeasurementsTable,
  graduationOrdersTable,
  graduationPackageItemsTable,
  graduationPackagesTable,
  graduationPackagingEventsTable,
  graduationProductionSheetsTable,
  graduationTemplatesTable,
  graduationUniversityProfilesTable,
  notificationsTable,
  productsTable,
} from "@workspace/db";
import { ensureGraduationEnterpriseTables } from "@/server/graduation-enterprise-schema";
import { readRequestBody } from "@/server/request-body";
import type { GraduationAdminUser } from "@/server/graduation";

type JsonMap = Record<string, any>;

const packageSchema = z.object({
  code: z.string().trim().max(80).optional(),
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(2000).optional(),
  previewImageUrl: z.string().trim().optional(),
  templateId: z.coerce.number().int().positive().nullable().optional(),
  templateVersionId: z.coerce.number().int().positive().nullable().optional(),
  defaultPrice: z.coerce.number().min(0).default(0),
  defaultCost: z.coerce.number().min(0).default(0),
  discountAmount: z.coerce.number().min(0).default(0),
  productionDays: z.coerce.number().int().min(1).max(180).default(7),
  configuration: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
  items: z.array(z.object({
    itemType: z.enum(["robe", "sash", "cap", "accessory", "addon", "material"]),
    templateId: z.coerce.number().int().positive().nullable().optional(),
    productId: z.coerce.number().int().positive().nullable().optional(),
    code: z.string().trim().max(100).optional(),
    name: z.string().trim().min(1).max(180),
    quantity: z.coerce.number().positive().default(1),
    unitPrice: z.coerce.number().min(0).default(0),
    unitCost: z.coerce.number().min(0).default(0),
    isRequired: z.boolean().default(true),
    configuration: z.record(z.string(), z.unknown()).default({}),
    sortOrder: z.coerce.number().int().default(0),
  })).default([]),
});

const universitySchema = z.object({
  code: z.string().trim().max(80).optional(),
  nameAr: z.string().trim().min(2).max(180),
  nameEn: z.string().trim().max(180).optional(),
  college: z.string().trim().max(180).optional(),
  department: z.string().trim().max(180).optional(),
  logoUrl: z.string().trim().optional(),
  officialColors: z.array(z.string().trim().max(30)).default([]),
  approvedTemplateIds: z.array(z.coerce.number().int().positive()).default([]),
  recommendedFonts: z.array(z.string().trim().max(80)).default([]),
  rules: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

const colorSchema = z.object({
  code: z.string().trim().max(80).optional(),
  name: z.string().trim().min(2).max(160),
  colors: z.record(z.string(), z.string()).default({}),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
});

const scanSchema = z.object({
  code: z.string().trim().min(2).max(180),
  studentCode: z.string().trim().max(180).optional(),
  packageImageUrl: z.string().trim().optional(),
  complete: z.boolean().default(false),
});

const deliverySchema = z.object({
  code: z.string().trim().min(2).max(180),
  sessionCode: z.string().trim().max(100).optional(),
  groupId: z.coerce.number().int().positive().nullable().optional(),
  receivedBy: z.string().trim().min(2).max(180),
  signatureDataUrl: z.string().trim().optional(),
  packageImageUrl: z.string().trim().optional(),
  overrideReason: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(1000).optional(),
});

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function error(message: string, status = 400, details?: unknown) {
  return json({ error: message, ...(details ? { details } : {}) }, status);
}

async function requestBody(req: NextRequest) {
  return readRequestBody(req);
}

function record(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonMap)
    : {};
}

function numeric(value: unknown) {
  const parsed = Number(String(value ?? 0).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function slugCode(value: string, prefix: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 48);
  return `${prefix}-${normalized || Date.now()}`;
}

function allowed(user: GraduationAdminUser, permission: string) {
  if (user.role === "admin") return true;
  if (user.permissions.includes(permission) || user.permissions.includes("graduation")) return true;
  const legacy: Record<string, string[]> = {
    "graduation.view": ["graduation_manager", "graduation_production", "graduation_warehouse"],
    "graduation.package.manage": ["graduation_manager"],
    "graduation.packaging.scan": ["graduation_warehouse", "graduation_production"],
    "graduation.packaging.override": ["graduation_manager"],
    "graduation.delivery.confirm": ["graduation_warehouse"],
    "graduation.inventory.view": ["graduation_warehouse", "graduation_manager"],
  };
  return (legacy[permission] || []).some((item) => user.permissions.includes(item));
}

function denied(user: GraduationAdminUser, permission: string) {
  return allowed(user, permission)
    ? null
    : error("ليس لديك صلاحية لتنفيذ هذا الإجراء", 403);
}

function actorName(user?: GraduationAdminUser | null) {
  return user ? user.fullName || user.username : "النظام";
}

async function insertTrace(
  executor: any,
  user: GraduationAdminUser | null | undefined,
  orderId: number,
  action: string,
  title: string,
  metadata: JsonMap = {},
) {
  await executor.insert(adminActivityLogsTable).values({
    staffId: user?.id ?? null,
    userName: actorName(user),
    action,
    entityType: "graduation_order",
    entityId: orderId,
    metadata,
  });
  await executor.insert(entityTimelineTable).values({
    entityType: "graduation_order",
    entityId: orderId,
    type: action,
    title,
    actorId: user?.id ?? null,
    actorName: actorName(user),
    metadata,
  });
}

function componentDefinitions(order: any) {
  const garments = record(order.garmentDetails);
  const colors = record(order.colors);
  const profile = record(order.studentProfile);
  const measurements = record(order.measurements);
  const accessories = Array.isArray(order.accessories) ? order.accessories.map(String) : [];
  const size = String(profile.size || measurements.confirmedSize || measurements.suggestedSize || "");
  const definitions = [
    {
      type: "robe",
      model: String(garments.robeType || order.styleKey || "standard"),
      color: String(garments.robeColor || colors.robe || ""),
      size,
      required: true,
    },
    {
      type: "sash",
      model: String(garments.sashType || "standard"),
      color: String(garments.sashColor || colors.sash || ""),
      size: "",
      required: true,
    },
  ];
  if (garments.capType || accessories.includes("cap")) {
    definitions.push({
      type: "cap",
      model: String(garments.capType || "standard"),
      color: String(colors.cap || ""),
      size: "",
      required: true,
    });
  }
  if (accessories.length) {
    definitions.push({
      type: "accessory",
      model: accessories.join("، "),
      color: "",
      size: "",
      required: true,
    });
  }
  // Graduation Extras — Bouquet + Photography booking on the kit checklist.
  const extras = record(order.extras);
  const flowersInfo = record(extras.flowers);
  const flowerNames = Array.isArray(flowersInfo.names) ? (flowersInfo.names as unknown[]).map(String) : [];
  if (Number(flowersInfo.count) > 0 || flowerNames.length) {
    definitions.push({
      type: "bouquet",
      model: flowerNames.length ? flowerNames.join("، ") : "بوكيه",
      color: "",
      size: "",
      required: false,
    });
  }
  if (extras.photography) {
    definitions.push({
      type: "photography",
      model: "جلسة تصوير التخرج",
      color: "",
      size: "",
      required: false,
    });
  }
  return definitions;
}

const PRODUCTION_SHEETS = [
  "cutting",
  "sewing",
  "printing",
  "embroidery",
  "quality_control",
  "packaging",
  "delivery",
] as const;

async function ensureKitTx(tx: any, order: any, user?: GraduationAdminUser | null) {
  const studentCode = String(order.studentCode || order.orderNo);
  const definitions = componentDefinitions(order);
  for (const definition of definitions) {
    const code = `${studentCode}-${definition.type.toUpperCase()}`;
    await tx
      .insert(graduationComponentsTable)
      .values({
        graduationOrderId: order.id,
        groupId: order.groupId,
        componentCode: code,
        qrValue: code,
        barcodeValue: code,
        componentType: definition.type,
        model: definition.model,
        color: definition.color,
        size: definition.size,
        configuration: { studentCode, generatedFromOrder: true },
        isRequired: definition.required,
      })
      .onConflictDoUpdate({
        target: graduationComponentsTable.componentCode,
        set: {
          model: definition.model,
          color: definition.color,
          size: definition.size,
          isRequired: definition.required,
          updatedAt: new Date(),
        },
      });
  }
  const kitCode = `${studentCode}-KIT`;
  await tx
    .insert(graduationKitsTable)
    .values({
      graduationOrderId: order.id,
      groupId: order.groupId,
      kitCode,
      qrValue: kitCode,
      barcodeValue: kitCode,
      requiredChecklist: Object.fromEntries(definitions.map((item) => [item.type, false])),
    })
    .onConflictDoNothing();
  const [kit] = await tx
    .select()
    .from(graduationKitsTable)
    .where(eq(graduationKitsTable.graduationOrderId, order.id))
    .limit(1);
  const components = await tx
    .select()
    .from(graduationComponentsTable)
    .where(eq(graduationComponentsTable.graduationOrderId, order.id));
  for (const component of components) {
    await tx
      .insert(graduationKitItemsTable)
      .values({ kitId: kit.id, componentId: component.id })
      .onConflictDoNothing();
  }
  const productionSnapshot = {
    orderId: order.id,
    orderNo: order.orderNo,
    studentCode,
    studentName: order.customerName,
    size: record(order.studentProfile).size || record(order.measurements).suggestedSize || "",
    garmentDetails: order.garmentDetails,
    colors: order.colors,
    customText: order.customText,
    decoration: order.decoration,
    notes: order.notes,
  };
  for (const sheetType of PRODUCTION_SHEETS) {
    await tx
      .insert(graduationProductionSheetsTable)
      .values({
        graduationOrderId: order.id,
        sheetType,
        version: 1,
        snapshot: productionSnapshot,
        generatedBy: user?.id ?? null,
      })
      .onConflictDoNothing();
  }
  return { kit, components };
}

async function ensureMaterialsTx(tx: any, order: any, user?: GraduationAdminUser | null) {
  const inventoryItems = Array.isArray(order.inventoryItems) ? order.inventoryItems : [];
  for (const item of inventoryItems) {
    const productId = Number(item?.productId || 0);
    if (!productId) continue;
    const code = `PRODUCT-${productId}`;
    const quantity = Math.max(0, numeric(item?.quantity));
    await tx
      .insert(graduationMaterialRequirementsTable)
      .values({
        graduationOrderId: order.id,
        productId,
        materialCode: code,
        name: String(item?.label || `#${productId}`),
        requiredQuantity: String(quantity),
        reservedQuantity: order.inventoryApplied ? "0" : String(quantity),
        consumedQuantity: order.inventoryApplied ? String(quantity) : "0",
        status: order.inventoryApplied ? "consumed" : "reserved",
      })
      .onConflictDoUpdate({
        target: [
          graduationMaterialRequirementsTable.graduationOrderId,
          graduationMaterialRequirementsTable.materialCode,
        ],
        set: {
          requiredQuantity: String(quantity),
          reservedQuantity: order.inventoryApplied ? "0" : String(quantity),
          consumedQuantity: order.inventoryApplied ? String(quantity) : "0",
          status: order.status === "cancelled" ? "released" : order.inventoryApplied ? "consumed" : "reserved",
          updatedAt: new Date(),
        },
      });
    const reservationKey = `graduation:${order.id}:product:${productId}`;
    await tx
      .insert(graduationInventoryReservationsTable)
      .values({
        graduationOrderId: order.id,
        productId,
        quantity: String(quantity),
        status: order.status === "cancelled" ? "released" : order.inventoryApplied ? "consumed" : "reserved",
        idempotencyKey: reservationKey,
        releasedAt: order.status === "cancelled" ? new Date() : null,
        consumedAt: order.inventoryApplied ? new Date() : null,
        createdBy: user?.id ?? null,
      })
      .onConflictDoUpdate({
        target: graduationInventoryReservationsTable.idempotencyKey,
        set: {
          quantity: String(quantity),
          status: order.status === "cancelled" ? "released" : order.inventoryApplied ? "consumed" : "reserved",
          releasedAt: order.status === "cancelled" ? new Date() : null,
          consumedAt: order.inventoryApplied ? new Date() : null,
        },
      });
  }
  const estimate = record(order.productionEstimate);
  const derived = [
    ["FABRIC-METERS", "قماش", "meter", numeric(estimate.fabricMeters)],
    ["THREAD-METERS", "خيط خياطة", "meter", numeric(estimate.threadMeters)],
    ["PACKAGING-BAG", "كيس تغليف", "piece", 1],
  ] as const;
  for (const [code, name, unit, quantity] of derived) {
    if (quantity <= 0) continue;
    await tx
      .insert(graduationMaterialRequirementsTable)
      .values({
        graduationOrderId: order.id,
        materialCode: code,
        name,
        unit,
        requiredQuantity: String(quantity),
      })
      .onConflictDoUpdate({
        target: [
          graduationMaterialRequirementsTable.graduationOrderId,
          graduationMaterialRequirementsTable.materialCode,
        ],
        set: { requiredQuantity: String(quantity), updatedAt: new Date() },
      });
  }
}

export async function syncGraduationEnterpriseOrder(
  orderId: number,
  user?: GraduationAdminUser | null,
) {
  await ensureGraduationEnterpriseTables();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(71968, ${orderId})`);
    const [order] = await tx
      .select()
      .from(graduationOrdersTable)
      .where(eq(graduationOrdersTable.id, orderId))
      .limit(1);
    if (!order) throw new Error("طلب التخرج غير موجود");
    const measurement = record(order.measurements);
    const profile = record(order.studentProfile);
    await tx
      .insert(graduationMeasurementsTable)
      .values({
        graduationOrderId: order.id,
        height: measurement.height ? String(measurement.height) : null,
        weight: measurement.weight ? String(measurement.weight) : null,
        shoulder: measurement.shoulder ? String(measurement.shoulder) : null,
        sleeveLength: measurement.sleeveLength ? String(measurement.sleeveLength) : null,
        chest: measurement.chest ? String(measurement.chest) : null,
        waist: measurement.waist ? String(measurement.waist) : null,
        robeLength: measurement.robeLength ? String(measurement.robeLength) : null,
        suggestedSize: String(measurement.suggestedSize || "") || null,
        confirmedSize: String(profile.size || measurement.confirmedSize || "") || null,
        measuredBy: user?.id ?? null,
      })
      .onConflictDoNothing();
    const kit = await ensureKitTx(tx, order, user);
    await ensureMaterialsTx(tx, order, user);
    return { order, ...kit };
  });
}

async function kitState(orderId: number) {
  const [order, kit, components, sheets] = await Promise.all([
    db.query.graduationOrdersTable.findFirst({ where: eq(graduationOrdersTable.id, orderId) }),
    db.query.graduationKitsTable.findFirst({ where: eq(graduationKitsTable.graduationOrderId, orderId) }),
    db.select().from(graduationComponentsTable).where(eq(graduationComponentsTable.graduationOrderId, orderId)).orderBy(asc(graduationComponentsTable.id)),
    db.select().from(graduationProductionSheetsTable).where(eq(graduationProductionSheetsTable.graduationOrderId, orderId)).orderBy(asc(graduationProductionSheetsTable.id)),
  ]);
  if (!order || !kit) return null;
  const required = components.filter((item) => item.isRequired);
  const packed = required.filter((item) => item.packagingStatus === "packed");
  return {
    order: {
      id: order.id,
      orderNo: order.orderNo,
      studentCode: order.studentCode,
      studentName: order.customerName,
      phone: order.phone,
      groupId: order.groupId,
      remainingAmount: numeric(order.remainingAmount),
      productionStage: order.productionStage,
      trackingUrl: `/graduation/track/${order.qrToken}`,
    },
    kit,
    components,
    sheets,
    progress: {
      required: required.length,
      packed: packed.length,
      missing: required.filter((item) => item.packagingStatus !== "packed").map((item) => item.componentType),
      percentage: required.length ? Math.round((packed.length / required.length) * 100) : 100,
    },
  };
}

export async function getGraduationEnterpriseCatalog() {
  await ensureGraduationEnterpriseTables();
  const [templates, packages, packageItems, universities, colorCombinations] = await Promise.all([
    db.select().from(graduationTemplatesTable).where(and(eq(graduationTemplatesTable.isActive, true), sql`${graduationTemplatesTable.archivedAt} is null`)).orderBy(desc(graduationTemplatesTable.isFeatured), asc(graduationTemplatesTable.sortOrder)),
    db.select().from(graduationPackagesTable).where(and(eq(graduationPackagesTable.isActive, true), eq(graduationPackagesTable.isArchived, false))).orderBy(desc(graduationPackagesTable.isFeatured), asc(graduationPackagesTable.sortOrder)),
    db.select().from(graduationPackageItemsTable).orderBy(asc(graduationPackageItemsTable.sortOrder)),
    db.select().from(graduationUniversityProfilesTable).where(eq(graduationUniversityProfilesTable.isActive, true)).orderBy(asc(graduationUniversityProfilesTable.sortOrder)),
    db.select().from(graduationColorCombinationsTable).where(eq(graduationColorCombinationsTable.isActive, true)).orderBy(desc(graduationColorCombinationsTable.isFeatured), asc(graduationColorCombinationsTable.sortOrder)),
  ]);
  const publicTemplates = templates.map((item) => {
    // Never expose cost to the public catalog (legacy `cost` may live in config).
    const { cost: _cost, ...publicConfig } =
      (item.configuration as Record<string, unknown>) || {};
    const stock = Number(item.stock ?? 0);
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      templateType: item.templateType,
      university: item.university,
      college: item.college,
      department: item.department,
      previewImageUrl: item.previewImageUrl,
      modelUrl: item.modelUrl,
      images: Array.isArray(item.images) ? item.images : [],
      currentVersion: item.currentVersion,
      defaultPrice: numeric(item.defaultPrice),
      discountPrice: item.discountPrice != null ? numeric(item.discountPrice) : null,
      sku: item.sku,
      trackStock: item.trackStock,
      stock,
      available: !item.trackStock || stock > 0,
      configuration: publicConfig,
      isFeatured: item.isFeatured,
    };
  });
  return {
    templates: publicTemplates,
    robeTemplates: publicTemplates.filter((item) => item.templateType === "robe"),
    sashTemplates: publicTemplates.filter((item) => item.templateType === "sash"),
    capTemplates: publicTemplates.filter((item) => item.templateType === "cap"),
    accessoryTemplates: publicTemplates.filter((item) => item.templateType === "accessory"),
    packages: packages.map((item) => ({
      ...item,
      defaultPrice: numeric(item.defaultPrice),
      discountAmount: numeric(item.discountAmount),
      items: packageItems.filter((row) => row.packageId === item.id).map((row) => ({
        ...row,
        quantity: numeric(row.quantity),
        unitPrice: numeric(row.unitPrice),
      })),
    })),
    universities,
    colorCombinations,
    requiredSections: { robe: true, sash: true, cap: false, accessories: false, additions: false },
  };
}

async function resolveOrderByCode(code: string) {
  return db.query.graduationOrdersTable.findFirst({
    where: or(
      eq(graduationOrdersTable.studentCode, code),
      eq(graduationOrdersTable.barcodeValue, code),
      eq(graduationOrdersTable.qrToken, code),
      eq(graduationOrdersTable.orderNo, code),
    ),
  });
}

async function packagingScan(raw: unknown, user: GraduationAdminUser) {
  const parsed = scanSchema.safeParse(raw);
  if (!parsed.success) return { response: error("تحقق من رمز المسح", 400, parsed.error.issues) };
  const data = parsed.data;
  if (!data.studentCode) {
    const order = await resolveOrderByCode(data.code);
    if (!order) return { response: error("لم يتم العثور على الطالب من الرمز الممسوح", 404) };
    await syncGraduationEnterpriseOrder(order.id, user);
    const state = await kitState(order.id);
    return { mode: "student", ...state };
  }
  const expected = await resolveOrderByCode(data.studentCode);
  if (!expected) return { response: error("رمز الطالب المتوقع غير صحيح", 404) };
  await syncGraduationEnterpriseOrder(expected.id, user);
  const component = await db.query.graduationComponentsTable.findFirst({
    where: or(
      eq(graduationComponentsTable.componentCode, data.code),
      eq(graduationComponentsTable.qrValue, data.code),
      eq(graduationComponentsTable.barcodeValue, data.code),
    ),
  });
  const scannedKit = await db.query.graduationKitsTable.findFirst({
    where: or(
      eq(graduationKitsTable.kitCode, data.code),
      eq(graduationKitsTable.qrValue, data.code),
      eq(graduationKitsTable.barcodeValue, data.code),
    ),
  });
  if (!component && !scannedKit) return { response: error("رمز القطعة أو حقيبة الطالب غير معروف", 404) };
  if (component && component.graduationOrderId !== expected.id) {
    await db.insert(graduationPackagingEventsTable).values({
      graduationOrderId: expected.id,
      componentId: component.id,
      eventType: "component_scan",
      scanValue: data.code,
      result: "mismatch",
      expectedOrderId: expected.id,
      actualOrderId: component.graduationOrderId,
      employeeId: user.id,
      employeeName: actorName(user),
    });
    await insertTrace(db, user, expected.id, "graduation_packaging_mismatch", "تم رفض قطعة تخص طالباً آخر", {
      componentCode: component.componentCode,
      actualOrderId: component.graduationOrderId,
    });
    const actual = await db.query.graduationOrdersTable.findFirst({ where: eq(graduationOrdersTable.id, component.graduationOrderId) });
    return {
      response: error("تنبيه: هذه القطعة لا تخص هذا الطالب", 409, {
        expectedStudent: expected.customerName,
        scannedItemOwner: actual?.customerName || "غير معروف",
        itemType: component.componentType,
        correctRequiredCode: `${expected.studentCode}-${component.componentType.toUpperCase()}`,
      }),
    };
  }
  if (scannedKit && scannedKit.graduationOrderId !== expected.id) {
    return { response: error("تنبيه: حقيبة التخرج لا تخص هذا الطالب", 409) };
  }
  if (component) {
    if (component.packagingStatus === "packed") {
      await db.insert(graduationPackagingEventsTable).values({
        graduationOrderId: expected.id,
        componentId: component.id,
        eventType: "component_scan",
        scanValue: data.code,
        result: "duplicate",
        expectedOrderId: expected.id,
        actualOrderId: expected.id,
        employeeId: user.id,
        employeeName: actorName(user),
      });
      return { response: error("تم مسح هذه القطعة وتغليفها مسبقاً", 409) };
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(71969, ${component.id})`);
      const [kit] = await tx.select().from(graduationKitsTable).where(eq(graduationKitsTable.graduationOrderId, expected.id)).limit(1);
      await tx.update(graduationComponentsTable).set({ packagingStatus: "packed", packedAt: new Date(), packedBy: user.id, updatedAt: new Date() }).where(eq(graduationComponentsTable.id, component.id));
      await tx.update(graduationKitItemsTable).set({ verified: true, verifiedAt: new Date(), verifiedBy: user.id }).where(and(eq(graduationKitItemsTable.kitId, kit.id), eq(graduationKitItemsTable.componentId, component.id)));
      await tx.update(graduationKitsTable).set({ status: "partial", packagedBy: user.id, updatedAt: new Date() }).where(eq(graduationKitsTable.id, kit.id));
      await tx.insert(graduationPackagingEventsTable).values({ graduationOrderId: expected.id, kitId: kit.id, componentId: component.id, eventType: "component_scan", scanValue: data.code, result: "accepted", expectedOrderId: expected.id, actualOrderId: expected.id, employeeId: user.id, employeeName: actorName(user) });
      await insertTrace(tx, user, expected.id, "graduation_component_packed", `تمت مطابقة وتغليف قطعة ${component.componentType}`, { componentCode: component.componentCode });
    });
  }
  if (scannedKit || data.complete) {
    const current = await kitState(expected.id);
    if (!current) return { response: error("حقيبة الطالب غير موجودة", 404) };
    if (!["quality_check", "awaiting_packaging", "packaging", "ready"].includes(expected.productionStage)) {
      return {
        response: error("لا يمكن إكمال التغليف قبل انتهاء الإنتاج وفحص الجودة", 409, {
          currentStage: expected.productionStage,
        }),
      };
    }
    if (current.progress.missing.length) {
      return { response: error("لا يمكن إكمال التغليف لوجود قطع ناقصة", 409, { missing: current.progress.missing }) };
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(71970, ${expected.id})`);
      await tx.update(graduationKitsTable).set({ status: "ready_for_delivery", packageImageUrl: data.packageImageUrl || current.kit.packageImageUrl, packagedBy: user.id, packagedAt: new Date(), readyAt: new Date(), updatedAt: new Date() }).where(eq(graduationKitsTable.id, current.kit.id));
      await tx.update(graduationOrdersTable).set({ productionStage: "ready", status: "ready", readyAt: new Date(), updatedAt: new Date() }).where(eq(graduationOrdersTable.id, expected.id));
      await tx.insert(graduationPackagingEventsTable).values({ graduationOrderId: expected.id, kitId: current.kit.id, eventType: "packaging_completed", scanValue: data.code, result: "accepted", expectedOrderId: expected.id, actualOrderId: expected.id, employeeId: user.id, employeeName: actorName(user), metadata: { packageImageUrl: data.packageImageUrl || null } });
      if (expected.customerId) await tx.insert(notificationsTable).values({ audienceType: "customer", customerId: expected.customerId, type: "graduation_ready", title: "تجهيزات التخرج جاهزة", body: `${expected.orderNo} جاهز للتسليم`, entityType: "graduation_order", entityId: expected.id, href: `/graduation/track/${expected.qrToken}` });
      await insertTrace(tx, user, expected.id, "graduation_packaging_completed", "اكتمل تغليف حقيبة الطالب وأصبحت جاهزة للتسليم", { kitCode: current.kit.kitCode });
    });
  }
  return { mode: component ? "component" : "kit", ...(await kitState(expected.id)) };
}

async function confirmDelivery(raw: unknown, user: GraduationAdminUser) {
  const parsed = deliverySchema.safeParse(raw);
  if (!parsed.success) return { response: error("تحقق من بيانات التسليم", 400, parsed.error.issues) };
  const data = parsed.data;
  const order = await resolveOrderByCode(data.code);
  if (!order) return { response: error("لم يتم العثور على طلب الطالب", 404) };
  await syncGraduationEnterpriseOrder(order.id, user);
  const state = await kitState(order.id);
  if (!state || state.kit.status !== "ready_for_delivery") return { response: error("لا يمكن التسليم قبل اكتمال التحقق من حقيبة الطالب", 409) };
  const needsOverride = numeric(order.remainingAmount) > 0;
  if (needsOverride && (!data.overrideReason || !allowed(user, "graduation.packaging.override"))) {
    return { response: error("يوجد مبلغ متبقٍ. يتطلب التسليم صلاحية تجاوز وسبباً إلزامياً", 409, { remainingAmount: numeric(order.remainingAmount) }) };
  }
  const sessionCode = data.sessionCode || `AJN-GR-DEL-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(71971, ${order.id})`);
    await tx.insert(graduationDeliverySessionsTable).values({ sessionCode, groupId: data.groupId ?? order.groupId, sessionDate: new Date().toISOString().slice(0, 10), createdBy: user.id }).onConflictDoNothing();
    await tx.update(graduationDeliverySessionsTable).set({ deliveredCount: sql`${graduationDeliverySessionsTable.deliveredCount} + 1` }).where(eq(graduationDeliverySessionsTable.sessionCode, sessionCode));
    await tx.insert(graduationDeliveryEventsTable).values({ graduationOrderId: order.id, groupId: order.groupId, sessionCode, status: "delivered", deliveredBy: user.id, deliveredByName: actorName(user), receivedBy: data.receivedBy, signatureDataUrl: data.signatureDataUrl || null, packageImageUrl: data.packageImageUrl || state.kit.packageImageUrl, balanceConfirmed: !needsOverride, verification: { kitCode: state.kit.kitCode, components: state.components.map((item: any) => item.componentCode), overrideReason: data.overrideReason || null }, notes: data.notes || null });
    await tx.update(graduationKitsTable).set({ status: "delivered", updatedAt: new Date() }).where(eq(graduationKitsTable.id, state.kit.id));
    await tx.update(graduationOrdersTable).set({ productionStage: "delivered", status: "delivered", deliveredAt: new Date(), delivery: { receivedBy: data.receivedBy, sessionCode, signatureDataUrl: data.signatureDataUrl || null, packageImageUrl: data.packageImageUrl || state.kit.packageImageUrl, overrideReason: data.overrideReason || null }, updatedAt: new Date() }).where(eq(graduationOrdersTable.id, order.id));
    if (order.customerId) await tx.insert(notificationsTable).values({ audienceType: "customer", customerId: order.customerId, type: "graduation_delivered", title: "تم تسليم تجهيزات التخرج", body: `${order.orderNo} - تم تأكيد الاستلام`, entityType: "graduation_order", entityId: order.id, href: `/graduation/track/${order.qrToken}` });
    await insertTrace(tx, user, order.id, "graduation_delivery_confirmed", "تم تسليم حقيبة الطالب بعد التحقق من جميع المكونات", { sessionCode, receivedBy: data.receivedBy, overrideReason: data.overrideReason || null });
  });
  return { delivered: true, sessionCode, orderId: order.id };
}

async function packagingQueue() {
  const rows = await db
    .select({
      order: graduationOrdersTable,
      kit: graduationKitsTable,
    })
    .from(graduationOrdersTable)
    .leftJoin(graduationKitsTable, eq(graduationKitsTable.graduationOrderId, graduationOrdersTable.id))
    .where(and(sql`${graduationOrdersTable.archivedAt} is null`, sql`${graduationOrdersTable.status} <> 'cancelled'`, inArray(graduationOrdersTable.productionStage, ["quality_check", "awaiting_packaging", "packaging", "ready"])))
    .orderBy(asc(graduationOrdersTable.dueDate), asc(graduationOrdersTable.createdAt));
  const items = [];
  for (const row of rows) {
    if (!row.kit) await syncGraduationEnterpriseOrder(row.order.id);
    const state = await kitState(row.order.id);
    if (state) items.push(state);
  }
  return items;
}

async function productionWall() {
  const orders = await db.select().from(graduationOrdersTable).where(and(sql`${graduationOrdersTable.archivedAt} is null`, sql`${graduationOrdersTable.status} <> 'cancelled'`));
  const stages = Object.fromEntries([
    "incomplete_data", "new", "awaiting_measurements", "measurements", "awaiting_design", "awaiting_approval", "approved", "fabric_cutting", "tailoring", "printing", "embroidery", "ironing", "quality_check", "awaiting_packaging", "packaging", "ready", "delivered",
  ].map((stage) => [stage, orders.filter((order) => order.productionStage === stage).length]));
  const late = orders.filter((order) => order.dueDate && new Date(`${order.dueDate}T23:59:59`) < new Date() && !["ready", "delivered"].includes(order.productionStage));
  return { total: orders.length, stages, late: late.length, items: orders.map((order) => ({ id: order.id, orderNo: order.orderNo, studentCode: order.studentCode, studentName: order.customerName, stage: order.productionStage, dueDate: order.dueDate, groupId: order.groupId })) };
}

async function materialReport() {
  const requirements = await db.select().from(graduationMaterialRequirementsTable).orderBy(asc(graduationMaterialRequirementsTable.name));
  const productIds = [...new Set(requirements.map((row) => row.productId).filter((value): value is number => Boolean(value)))];
  const products = productIds.length ? await db.select({ id: productsTable.id, name: productsTable.nameAr, fallbackName: productsTable.name, stock: productsTable.stock, minStock: productsTable.minStock }).from(productsTable).where(inArray(productsTable.id, productIds)) : [];
  const productMap = new Map(products.map((item) => [item.id, item]));
  const grouped = new Map<string, any>();
  for (const row of requirements) {
    const key = row.productId ? `product:${row.productId}` : `material:${row.materialCode}`;
    const current = grouped.get(key) || { key, productId: row.productId, name: row.name, unit: row.unit, required: 0, reserved: 0, consumed: 0, orders: 0 };
    current.required += numeric(row.requiredQuantity);
    current.reserved += numeric(row.reservedQuantity);
    current.consumed += numeric(row.consumedQuantity);
    current.orders += 1;
    grouped.set(key, current);
  }
  const items = [...grouped.values()].map((item) => {
    const product = item.productId ? productMap.get(item.productId) : null;
    const available = numeric(product?.stock);
    return { ...item, name: product?.name || product?.fallbackName || item.name, available, shortage: item.productId ? Math.max(0, item.required - available) : 0, purchaseRecommendation: item.productId ? Math.max(0, item.required + numeric(product?.minStock) - available) : 0 };
  });
  return { items, summary: { materials: items.length, required: items.reduce((sum, item) => sum + item.required, 0), shortages: items.filter((item) => item.shortage > 0).length } };
}

async function savePackage(raw: unknown, user: GraduationAdminUser, id?: number) {
  const parsed = packageSchema.safeParse(raw);
  if (!parsed.success) return { response: error("تحقق من بيانات الباقة", 400, parsed.error.issues) };
  const data = parsed.data;
  return db.transaction(async (tx) => {
    const code = data.code || slugCode(data.name, "GR-PKG");
    const values = { code, name: data.name, description: data.description || null, previewImageUrl: data.previewImageUrl || null, templateId: data.templateId ?? null, templateVersionId: data.templateVersionId ?? null, configuration: data.configuration, defaultPrice: String(data.defaultPrice), defaultCost: String(data.defaultCost), discountAmount: String(data.discountAmount), productionDays: data.productionDays, isActive: data.isActive, isFeatured: data.isFeatured, sortOrder: data.sortOrder, createdBy: user.id, updatedAt: new Date() };
    let saved: any;
    if (id) {
      [saved] = await tx.update(graduationPackagesTable).set(values).where(eq(graduationPackagesTable.id, id)).returning();
      if (!saved) return { response: error("الباقة غير موجودة", 404) };
      await tx.delete(graduationPackageItemsTable).where(eq(graduationPackageItemsTable.packageId, id));
    } else {
      [saved] = await tx.insert(graduationPackagesTable).values(values).returning();
    }
    if (data.items.length) await tx.insert(graduationPackageItemsTable).values(data.items.map((item) => ({ packageId: saved.id, itemType: item.itemType, templateId: item.templateId ?? null, productId: item.productId ?? null, code: item.code || null, name: item.name, quantity: String(item.quantity), unitPrice: String(item.unitPrice), unitCost: String(item.unitCost), isRequired: item.isRequired, configuration: item.configuration, sortOrder: item.sortOrder })));
    await tx.insert(adminActivityLogsTable).values({ staffId: user.id, userName: actorName(user), action: id ? "graduation_package_updated" : "graduation_package_created", entityType: "graduation_package", entityId: saved.id, metadata: { code, itemCount: data.items.length } });
    return { package: saved };
  });
}

export async function handleGraduationEnterprise(
  req: NextRequest,
  parts: string[],
  user: GraduationAdminUser,
): Promise<NextResponse | null> {
  if (parts[0] !== "enterprise") return null;
  await ensureGraduationEnterpriseTables();
  const method = req.method;
  const resource = parts[1] || "catalog";
  const permission = resource === "packaging" ? "graduation.packaging.scan" : resource === "delivery" ? "graduation.delivery.confirm" : resource === "materials" ? "graduation.inventory.view" : resource === "packages" || resource === "universities" || resource === "colors" ? "graduation.package.manage" : "graduation.view";
  const forbidden = denied(user, permission);
  if (forbidden) return forbidden;

  if (method === "GET" && resource === "catalog") return json(await getGraduationEnterpriseCatalog());
  if (resource === "packages") {
    if (method === "GET") return json(await getGraduationEnterpriseCatalog());
    if (method === "POST") {
      const result = await savePackage(await requestBody(req), user);
      return result.response ?? json(result, 201);
    }
    if ((method === "PATCH" || method === "PUT") && parts[2]) {
      const result = await savePackage(await requestBody(req), user, Number(parts[2]));
      return result.response ?? json(result);
    }
  }
  if (resource === "universities") {
    if (method === "GET") return json({ items: (await getGraduationEnterpriseCatalog()).universities });
    if (method === "POST") {
      const parsed = universitySchema.safeParse(await requestBody(req));
      if (!parsed.success) return error("تحقق من بيانات الجامعة", 400, parsed.error.issues);
      const data = parsed.data;
      const [saved] = await db.insert(graduationUniversityProfilesTable).values({ ...data, code: data.code || slugCode(data.nameAr, "UNI"), nameEn: data.nameEn || null, college: data.college || null, department: data.department || null, logoUrl: data.logoUrl || null, createdBy: user.id }).returning();
      return json({ university: saved }, 201);
    }
  }
  if (resource === "colors") {
    if (method === "GET") return json({ items: (await getGraduationEnterpriseCatalog()).colorCombinations });
    if (method === "POST") {
      const parsed = colorSchema.safeParse(await requestBody(req));
      if (!parsed.success) return error("تحقق من تركيبة الألوان", 400, parsed.error.issues);
      const data = parsed.data;
      const [saved] = await db.insert(graduationColorCombinationsTable).values({ ...data, code: data.code || slugCode(data.name, "COLOR"), createdBy: user.id }).returning();
      return json({ colorCombination: saved }, 201);
    }
  }
  if (resource === "orders" && parts[2]) {
    const orderId = Number(parts[2]);
    if (!Number.isFinite(orderId)) return error("معرف الطلب غير صحيح", 400);
    if (method === "POST" && parts[3] === "prepare-kit") {
      const result = await syncGraduationEnterpriseOrder(orderId, user);
      await insertTrace(db, user, orderId, "graduation_kit_prepared", "تم إنشاء أكواد مكونات وحقيبة الطالب", { kitCode: result.kit.kitCode });
      return json(await kitState(orderId), 201);
    }
    if (method === "GET" && (parts[3] === "kit" || parts[3] === "production-sheets")) {
      await syncGraduationEnterpriseOrder(orderId, user);
      return json(await kitState(orderId));
    }
  }
  if (resource === "packaging") {
    if (method === "GET") return json({ items: await packagingQueue() });
    if (method === "POST" && parts[2] === "scan") {
      const result = await packagingScan(await requestBody(req), user);
      return result.response ?? json(result);
    }
  }
  if (method === "GET" && resource === "production-wall") return json(await productionWall());
  if (method === "GET" && resource === "materials") return json(await materialReport());
  if (resource === "delivery" && method === "POST" && parts[2] === "confirm") {
    const result = await confirmDelivery(await requestBody(req), user);
    return result.response ?? json(result);
  }
  return null;
}
