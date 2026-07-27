import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { z } from "zod/v4";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  adminActivityLogsTable,
  customersTable,
  db,
  entityTimelineTable,
  graduationApprovalsTable,
  graduationComponentsTable,
  graduationDeliveryEventsTable,
  graduationGroupsTable,
  graduationGroupStudentsTable,
  graduationOrderItemsTable,
  graduationOrdersTable,
  graduationPackageItemsTable,
  graduationPreviewsTable,
  graduationProductionEventsTable,
  graduationReceiptsTable,
  graduationStudentPaymentsTable,
  graduationTemplatesTable,
  graduationTemplateVersionsTable,
  productsTable,
  qrTokensTable,
  salesInvoiceItemsTable,
  salesInvoicesTable,
} from "@workspace/db";
import { normalizeGraduationConfig, GRADUATION_STAGES } from "@/lib/graduation";
import { normalizeIraqiPhone, normalizePhoneDigits } from "@/lib/phone";
import { ensureGraduationOperationsTables } from "@/server/graduation-schema";
import {
  handleGraduationEnterprise,
  syncGraduationEnterpriseOrder,
} from "@/server/graduation-enterprise";
import {
  updateOrder,
  type GraduationAdminUser,
} from "@/server/graduation";
import {
  syncSourcePaymentTarget,
  type FinancialActor,
} from "@/server/master-cash-box";

type JsonMap = Record<string, any>;

const GRANULAR_PERMISSIONS = [
  "graduation.view",
  "graduation.create",
  "graduation.edit",
  "graduation.delete",
  "graduation.group.create",
  "graduation.group.edit",
  "graduation.group.manage",
  "graduation.student.add",
  "graduation.student.delete",
  "graduation.student.manage",
  "graduation.template.view",
  "graduation.template.manage",
  "graduation.package.manage",
  "graduation.price.edit",
  "graduation.discount.apply",
  "graduation.payment.receive",
  "graduation.receipt.print",
  "graduation.measurement.update",
  "graduation.preview.manage",
  "graduation.approval.manage",
  "graduation.production.update",
  "graduation.packaging.scan",
  "graduation.packaging.override",
  "graduation.delivery.confirm",
  "graduation.inventory.view",
  "graduation.report.view",
  "graduation.reports.view",
  "graduation.settings.manage",
] as const;

const studentPatchSchema = z
  .object({
    customerName: z.string().trim().min(2).max(160).optional(),
    phone: z.string().trim().max(30).optional(),
    phone2: z.string().trim().max(30).optional(),
    gender: z.enum(["male", "female", "unspecified"]).optional(),
    height: z.coerce.number().min(0).max(300).optional(),
    weight: z.coerce.number().min(0).max(300).optional(),
    size: z.string().trim().max(20).optional(),
    shoulder: z.coerce.number().min(0).max(120).optional(),
    sleeveLength: z.coerce.number().min(0).max(150).optional(),
    chest: z.coerce.number().min(0).max(250).optional(),
    university: z.string().trim().max(180).optional(),
    college: z.string().trim().max(180).optional(),
    department: z.string().trim().max(180).optional(),
    graduationYear: z.string().trim().max(10).optional(),
    robeType: z.string().trim().max(80).optional(),
    robeColor: z.string().trim().max(80).optional(),
    sashType: z.string().trim().max(80).optional(),
    sashColor: z.string().trim().max(80).optional(),
    capType: z.string().trim().max(80).optional(),
    rightText: z.string().trim().max(300).optional(),
    leftText: z.string().trim().max(300).optional(),
    printingType: z.string().trim().max(80).optional(),
    embroideryType: z.string().trim().max(80).optional(),
    accessories: z.array(z.string()).optional(),
    totalAmount: z.coerce.number().min(0).optional(),
    discountAmount: z.coerce.number().min(0).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .passthrough();

const templateSchema = z.object({
  name: z.string().trim().min(2).max(180),
  code: z.string().trim().max(80).optional(),
  templateType: z
    .enum(["robe", "sash", "cap", "package", "university", "college", "department"])
    .default("package"),
  university: z.string().trim().max(180).optional(),
  college: z.string().trim().max(180).optional(),
  department: z.string().trim().max(180).optional(),
  previewImageUrl: z.string().optional(),
  modelUrl: z.string().optional(),
  images: z.array(z.string()).default([]),
  defaultPrice: z.coerce.number().min(0).default(0),
  costPrice: z.coerce.number().min(0).default(0),
  discountPrice: z.coerce.number().min(0).nullable().optional(),
  sku: z.string().trim().max(80).optional(),
  barcode: z.string().trim().max(120).optional(),
  trackStock: z.boolean().default(false),
  stock: z.coerce.number().int().min(0).default(0),
  minStock: z.coerce.number().int().min(0).default(0),
  configuration: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
});

const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentMethod: z.enum(["cash", "card", "transfer", "other"]).default("cash"),
  strategy: z
    .enum(["individual", "equal", "oldest", "selected", "manual", "unallocated"])
    .default("individual"),
  selectedStudentIds: z.array(z.coerce.number().int().positive()).default([]),
  allocations: z
    .array(
      z.object({
        orderId: z.coerce.number().int().positive(),
        amount: z.coerce.number().min(0),
      }),
    )
    .default([]),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function fail(message: string, status = 400, details?: unknown) {
  return json({ error: message, ...(details ? { details } : {}) }, status);
}

async function body(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function record(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonMap)
    : {};
}

function amount(value: unknown) {
  const parsed = Number(String(value ?? 0).replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function actor(user: GraduationAdminUser): FinancialActor {
  return {
    id: user.id,
    name: user.fullName || user.username,
    role: user.role,
  };
}

function allowed(user: GraduationAdminUser, permission: string) {
  if (user.role === "admin") return true;
  if (user.permissions.includes(permission)) return true;
  if (user.permissions.includes("graduation")) return true;
  const legacy: Record<string, string[]> = {
    "graduation.view": ["graduation_production", "graduation_printing", "graduation_embroidery", "graduation_cashier", "graduation_manager", "graduation_warehouse"],
    "graduation.payment.receive": ["graduation_cashier"],
    "graduation.receipt.print": ["graduation_cashier"],
    "graduation.production.update": ["graduation_production", "graduation_printing", "graduation_embroidery"],
    "graduation.delivery.confirm": ["graduation_warehouse"],
    "graduation.template.manage": ["graduation_manager"],
    "graduation.report.view": ["graduation_manager"],
  };
  return (legacy[permission] ?? []).some((item) => user.permissions.includes(item));
}

function requireOperationPermission(user: GraduationAdminUser, permission: string) {
  return allowed(user, permission) ? null : fail("ليس لديك صلاحية لتنفيذ هذا الإجراء", 403);
}

async function audit(
  user: GraduationAdminUser,
  action: string,
  entityType: string,
  entityId: number,
  metadata: JsonMap,
) {
  await db.insert(adminActivityLogsTable).values({
    staffId: user.id,
    userName: user.fullName || user.username,
    action,
    entityType,
    entityId,
    metadata,
  });
}

async function timeline(
  user: GraduationAdminUser,
  entityType: string,
  entityId: number,
  type: string,
  title: string,
  metadata: JsonMap = {},
) {
  await db.insert(entityTimelineTable).values({
    entityType,
    entityId,
    type,
    title,
    actorId: user.id,
    actorName: user.fullName || user.username,
    metadata,
  });
}

function studentIdentity(order: any) {
  const year = new Date(order.createdAt ?? Date.now()).getFullYear();
  const studentCode = order.studentCode || (order.groupId
    ? `AJN-GR-G${String(order.groupId).padStart(3, "0")}-${String(order.id).padStart(6, "0")}`
    : `AJN-GR-${year}-${String(order.id).padStart(6, "0")}`);
  return {
    studentCode,
    barcodeValue: order.barcodeValue || studentCode,
    receiptNo:
      order.receiptNo ||
      `AJN-GR-R-${year}-${String(order.id).padStart(6, "0")}`,
  };
}

async function ensureIdentity(order: any, user?: GraduationAdminUser) {
  const identity = studentIdentity(order);
  if (!order.studentCode || !order.barcodeValue || !order.receiptNo) {
    const [saved] = await db
      .update(graduationOrdersTable)
      .set({
        ...identity,
        orderType: order.groupId ? "group" : "individual",
        updatedAt: new Date(),
      })
      .where(eq(graduationOrdersTable.id, order.id))
      .returning();
    order = saved ?? order;
  }
  if (order.groupId) {
    const existing = await db.query.graduationGroupStudentsTable.findFirst({
      where: eq(graduationGroupStudentsTable.graduationOrderId, order.id),
    });
    if (!existing) {
      const [next] = await db
        .select({ value: sql<number>`coalesce(max(${graduationGroupStudentsTable.sequence}),0)::int + 1` })
        .from(graduationGroupStudentsTable)
        .where(eq(graduationGroupStudentsTable.groupId, order.groupId));
      await db.insert(graduationGroupStudentsTable).values({
        groupId: order.groupId,
        graduationOrderId: order.id,
        customerId: order.customerId,
        templateVersionId: order.templateVersionId,
        studentCode: identity.studentCode,
        sequence: Number(next?.value ?? 1),
      });
    }
  }
  await db
    .insert(graduationReceiptsTable)
    .values({
      receiptNo: identity.receiptNo,
      receiptType: "student",
      graduationOrderId: order.id,
      groupId: order.groupId,
      snapshot: receiptSnapshot(order, identity),
      issuedBy: user?.id ?? order.createdBy ?? null,
      issuedByName: user ? user.fullName || user.username : order.createdByName || "النظام",
      issuedAt: order.createdAt,
    })
    .onConflictDoNothing();
  return { ...order, ...identity };
}

function receiptSnapshot(order: any, identity = studentIdentity(order)) {
  const profile = record(order.studentProfile);
  const garments = record(order.garmentDetails);
  const custom = record(order.customText);
  const measurements = record(order.measurements);
  return {
    receiptNo: identity.receiptNo,
    orderNo: order.orderNo,
    studentCode: identity.studentCode,
    studentName: order.customerName,
    phone: order.phone,
    phone2: order.phone2,
    university: profile.university || custom.university || "",
    college: profile.college || custom.college || "",
    department: profile.department || custom.department || "",
    groupId: order.groupId,
    robeType: garments.robeType || order.styleKey,
    robeColor: garments.robeColor || record(order.colors).robe || "",
    sashType: garments.sashType || "",
    sashColor: garments.sashColor || record(order.colors).sash || "",
    capType: garments.capType || "",
    size: profile.size || measurements.suggestedSize || "",
    accessories: order.accessories || [],
    total: amount(order.totalAmount),
    discount: amount(order.discountAmount),
    paid: amount(order.paidAmount),
    remaining: amount(order.remainingAmount),
    paymentMethod: order.paymentMethod,
    orderDate: order.createdAt,
    deliveryDate: order.dueDate,
    notes: order.notes,
  };
}

function formatStudent(order: any, sequence?: number) {
  const identity = studentIdentity(order);
  const profile = record(order.studentProfile);
  const garments = record(order.garmentDetails);
  const measurements = record(order.measurements);
  const custom = record(order.customText);
  const colors = record(order.colors);
  const decoration = record(order.decoration);
  return {
    id: order.id,
    sequence: sequence ?? order.id,
    ...identity,
    qrValue: order.qrToken,
    orderNo: order.orderNo,
    orderType: order.orderType || (order.groupId ? "group" : "individual"),
    customerId: order.customerId,
    groupId: order.groupId,
    customerName: order.customerName,
    phone: order.phone,
    phone2: order.phone2 || "",
    gender: profile.gender || measurements.gender || "unspecified",
    height: measurements.height || "",
    weight: measurements.weight || "",
    size: profile.size || measurements.suggestedSize || "",
    shoulder: measurements.shoulder || "",
    sleeveLength: measurements.sleeveLength || "",
    chest: measurements.chest || "",
    university: profile.university || custom.university || "",
    college: profile.college || custom.college || "",
    department: profile.department || custom.department || "",
    graduationYear: profile.graduationYear || custom.graduationYear || "",
    robeType: garments.robeType || order.styleKey || "",
    robeColor: garments.robeColor || colors.robe || "",
    sashType: garments.sashType || "",
    sashColor: garments.sashColor || colors.sash || "",
    capType: garments.capType || "",
    rightText: garments.rightText || custom.rightText || "",
    leftText: garments.leftText || custom.leftText || "",
    printingType: garments.printingType || (decoration.type === "printing" ? decoration.position : ""),
    embroideryType: garments.embroideryType || (decoration.type === "embroidery" ? decoration.position : ""),
    accessories: Array.isArray(order.accessories) ? order.accessories : [],
    total: amount(order.totalAmount),
    discount: amount(order.discountAmount),
    paid: amount(order.paidAmount),
    remaining: amount(order.remainingAmount),
    paymentStatus: order.paymentStatus,
    designStatus: order.designApprovedAt ? "approved" : Object.keys(record(order.previewAssets)).length ? "waiting_approval" : "waiting_preview",
    productionStage: order.productionStage,
    deliveryStatus: record(order.delivery).status || (order.deliveredAt ? "delivered" : "pending"),
    templateVersionId: order.templateVersionId,
    templateSnapshot: record(order.templateSnapshot),
    notes: order.notes || "",
    status: order.status,
    dueDate: order.dueDate,
    createdAt: order.createdAt,
    trackingUrl: `/graduation/track/${order.qrToken}`,
  };
}

async function groupDetail(groupId: number, user: GraduationAdminUser) {
  const group = await db.query.graduationGroupsTable.findFirst({
    where: eq(graduationGroupsTable.id, groupId),
  });
  if (!group) return null;
  const rawOrders = await db
    .select()
    .from(graduationOrdersTable)
    .where(
      and(
        eq(graduationOrdersTable.groupId, groupId),
        sql`${graduationOrdersTable.archivedAt} is null`,
      ),
    )
    .orderBy(asc(graduationOrdersTable.id));
  const orders = await Promise.all(rawOrders.map((order) => ensureIdentity(order, user)));
  const links = await db
    .select()
    .from(graduationGroupStudentsTable)
    .where(eq(graduationGroupStudentsTable.groupId, groupId));
  const sequenceByOrder = new Map(links.map((row) => [row.graduationOrderId, row.sequence]));
  const students = orders.map((order) => formatStudent(order, sequenceByOrder.get(order.id)));
  const sizeDistribution = students.reduce<Record<string, number>>((result, row) => {
    const key = String(row.size || "غير محدد");
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  const nameCounts = new Map<string, number>();
  const phoneCounts = new Map<string, number>();
  for (const row of students) {
    const name = row.customerName.trim().toLocaleLowerCase("ar");
    const phone = normalizePhoneDigits(row.phone);
    if (name) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) || 0) + 1);
  }
  const duplicates = students.filter((row) =>
    (nameCounts.get(row.customerName.trim().toLocaleLowerCase("ar")) || 0) > 1 ||
    (normalizePhoneDigits(row.phone) && (phoneCounts.get(normalizePhoneDigits(row.phone)) || 0) > 1),
  );
  const inventory = new Map<number, { productId: number; label: string; required: number }>();
  for (const order of orders) {
    for (const item of Array.isArray(order.inventoryItems) ? order.inventoryItems : []) {
      const productId = Number(item.productId);
      if (!productId) continue;
      const current = inventory.get(productId) || { productId, label: String(item.label || ""), required: 0 };
      current.required += Math.max(0, Number(item.quantity || 0));
      inventory.set(productId, current);
    }
  }
  const productIds = [...inventory.keys()];
  const products = productIds.length
    ? await db
        .select({ id: productsTable.id, name: productsTable.nameAr, stock: productsTable.stock })
        .from(productsTable)
        .where(inArray(productsTable.id, productIds))
    : [];
  const productById = new Map(products.map((item) => [item.id, item]));
  const shortages = [...inventory.values()]
    .map((item) => ({
      ...item,
      name: productById.get(item.productId)?.name || item.label,
      available: Number(productById.get(item.productId)?.stock || 0),
      shortage: Math.max(0, item.required - Number(productById.get(item.productId)?.stock || 0)),
    }))
    .filter((item) => item.shortage > 0);
  const active = students.filter((row) => row.status !== "cancelled");
  const totals = {
    students: active.length,
    robes: active.length,
    sashes: active.filter((row) => row.sashType || row.sashColor || row.accessories.includes("sash")).length,
    caps: active.filter((row) => row.capType || row.accessories.includes("cap")).length,
    accessories: active.reduce((sum, row) => sum + row.accessories.length, 0),
    orderValue: active.reduce((sum, row) => sum + row.total, 0),
    discounts: active.reduce((sum, row) => sum + row.discount, 0),
    paid: active.reduce((sum, row) => sum + row.paid, 0),
    remaining: active.reduce((sum, row) => sum + row.remaining, 0),
    completedDesigns: active.filter((row) => row.designStatus === "approved").length,
    waitingDesigns: active.filter((row) => row.designStatus !== "approved").length,
    inProduction: active.filter((row) => !["new", "ready", "delivered"].includes(row.productionStage)).length,
    ready: active.filter((row) => row.productionStage === "ready").length,
    delivered: active.filter((row) => row.productionStage === "delivered").length,
    groupCredit: amount(group.groupCreditAmount),
  };
  return {
    group: {
      ...group,
      groupCode: group.groupNo,
      qrValue: group.joinToken,
      groupMeta: record(record(group.defaultConfiguration).groupMeta),
    },
    students,
    totals,
    sizeDistribution,
    duplicates: duplicates.map((row) => ({ id: row.id, studentCode: row.studentCode, name: row.customerName, phone: row.phone })),
    missingData: students.map((row) => ({
      id: row.id,
      studentCode: row.studentCode,
      name: row.customerName,
      missing: [
        !row.phone && "phone",
        !row.size && "size",
        row.designStatus !== "approved" && "approval",
        row.remaining > 0 && "payment",
        !row.university && "university",
        !row.dueDate && "delivery",
      ].filter(Boolean),
    })).filter((row) => row.missing.length),
    materialRequirements: {
      robes: active.length,
      sashes: totals.sashes,
      caps: totals.caps,
      fabricMeters: Number(
        orders.reduce((sum, order) => sum + amount(record(order.productionEstimate).fabricMeters), 0).toFixed(2),
      ),
      printingUnits: active.filter((row) => Boolean(row.printingType)).length,
      embroideryUnits: active.filter((row) => Boolean(row.embroideryType)).length,
      packagingBags: active.length,
    },
    shortages,
  };
}

async function findOrCreateCustomer(name: string, phone: string) {
  const normalized = phone ? normalizeIraqiPhone(phone) : null;
  if (!normalized) return null;
  const existing = await db.query.customersTable.findFirst({
    where: eq(customersTable.phone, normalized),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(customersTable)
    .values({ phone: normalized, name, fullName: name })
    .onConflictDoNothing()
    .returning();
  return created ?? db.query.customersTable.findFirst({ where: eq(customersTable.phone, normalized) });
}

async function addStudent(groupId: number, raw: unknown, user: GraduationAdminUser) {
  const parsed = studentPatchSchema.extend({
    customerName: z.string().trim().min(2).max(160),
  }).safeParse(raw);
  if (!parsed.success) return { response: fail("تحقق من بيانات الطالب", 400, parsed.error.issues) };
  const data = parsed.data;
  const group = await db.query.graduationGroupsTable.findFirst({
    where: eq(graduationGroupsTable.id, groupId),
  });
  if (!group) return { response: fail("المجموعة غير موجودة", 404) };
  const phone = data.phone ? normalizeIraqiPhone(data.phone) : null;
  if (data.phone && !phone) return { response: fail("رقم الهاتف الأول غير صحيح", 400) };
  if (phone) {
    const duplicate = await db.query.graduationOrdersTable.findFirst({
      where: and(
        eq(graduationOrdersTable.groupId, groupId),
        eq(graduationOrdersTable.phone, phone),
        sql`${graduationOrdersTable.archivedAt} is null`,
      ),
    });
    if (duplicate) return { response: fail("يوجد طالب في المجموعة مسجل بنفس رقم الهاتف", 409) };
  }
  const customer = await findOrCreateCustomer(data.customerName, phone || "");
  const defaults = record(group.defaultConfiguration);
  const defaultColors = record(defaults.colors);
  const defaultFabric = record(defaults.fabric);
  const defaultCustom = record(defaults.customText);
  const qrToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const total = amount(data.totalAmount ?? defaults.defaultPrice ?? 0);
  const discount = Math.min(total, amount(data.discountAmount));
  const [draft] = await db
    .insert(graduationOrdersTable)
    .values({
      orderNo: `GR-TMP-${randomUUID()}`,
      qrToken,
      orderType: "group",
      customerId: customer?.id ?? null,
      groupId,
      customerName: data.customerName,
      phone: phone || "",
      phone2: data.phone2 ? normalizeIraqiPhone(data.phone2) || data.phone2 : null,
      phoneLast4: phone ? normalizePhoneDigits(phone).slice(-4) : "",
      status: "draft",
      productionStage: "new",
      styleKey: data.robeType || String(defaults.styleKey || "standard"),
      packageKey: String(defaults.packageKey || "") || null,
      studentProfile: {
        gender: data.gender || "unspecified",
        size: data.size || "",
        university: data.university || group.university || "",
        college: data.college || group.college || "",
        department: data.department || group.department || "",
        graduationYear: data.graduationYear || group.graduationYear || "",
      },
      garmentDetails: {
        robeType: data.robeType || defaults.styleKey || "standard",
        robeColor: data.robeColor || defaultColors.robe || "",
        sashType: data.sashType || record(defaults.garmentDetails).sashType || "",
        sashColor: data.sashColor || defaultColors.sash || "",
        capType: data.capType || record(defaults.garmentDetails).capType || "",
        rightText: data.rightText || "",
        leftText: data.leftText || "",
        printingType: data.printingType || "",
        embroideryType: data.embroideryType || "",
      },
      measurements: {
        gender: data.gender || "unspecified",
        height: data.height || null,
        weight: data.weight || null,
        suggestedSize: data.size || "",
        shoulder: data.shoulder || null,
        sleeveLength: data.sleeveLength || null,
        chest: data.chest || null,
      },
      colors: {
        ...defaultColors,
        ...(data.robeColor ? { robe: data.robeColor } : {}),
        ...(data.sashColor ? { sash: data.sashColor } : {}),
      },
      fabric: { ...defaultFabric, key: defaultFabric.key || "standard" },
      decoration: record(defaults.decoration),
      customText: {
        ...defaultCustom,
        studentName: data.customerName,
        university: data.university || group.university || "",
        college: data.college || group.college || "",
        department: data.department || group.department || "",
        graduationYear: data.graduationYear || group.graduationYear || "",
      },
      accessories: data.accessories || (Array.isArray(defaults.accessories) ? defaults.accessories : []),
      universityTemplate: record(defaults.universityTemplate),
      previewAssets: record(defaults.previewAssets),
      inventoryItems: [],
      pricing: { subtotal: total, discount, total: total - discount, cost: 0, profit: total - discount },
      subtotal: String(total),
      discountAmount: String(discount),
      totalAmount: String(total - discount),
      paidAmount: "0",
      remainingAmount: String(total - discount),
      paymentStatus: total - discount > 0 ? "unpaid" : "paid",
      productionEstimate: {},
      qualityChecklist: {},
      dueDate: group.eventDate,
      notes: data.notes || null,
      createdBy: user.id,
      createdByName: user.fullName || user.username,
    })
    .returning();
  const identity = studentIdentity(draft);
  const orderNo = `AJN-GRAD-${new Date().getFullYear()}-${String(draft.id).padStart(5, "0")}`;
  const [order] = await db
    .update(graduationOrdersTable)
    .set({ ...identity, orderNo, updatedAt: new Date() })
    .where(eq(graduationOrdersTable.id, draft.id))
    .returning();
  await ensureIdentity(order, user);
  await syncGraduationEnterpriseOrder(order.id, user);
  await db.insert(qrTokensTable).values({
    entityType: "graduation_order",
    entityId: order.id,
    token: qrToken,
    targetUrl: `/graduation/track/${qrToken}`,
  }).onConflictDoNothing();
  await audit(user, "graduation_student_added", "graduation_order", order.id, {
    groupId,
    studentCode: identity.studentCode,
  });
  await timeline(user, "graduation_group", groupId, "student_added", `تمت إضافة الطالب ${order.customerName}`, {
    orderId: order.id,
    studentCode: identity.studentCode,
  });
  return { order: formatStudent(order) };
}

async function patchStudent(orderId: number, raw: unknown, user: GraduationAdminUser) {
  const parsed = studentPatchSchema.safeParse(raw);
  if (!parsed.success) return { response: fail("تحقق من بيانات الطالب", 400, parsed.error.issues) };
  const data = parsed.data;
  const order = await db.query.graduationOrdersTable.findFirst({
    where: eq(graduationOrdersTable.id, orderId),
  });
  if (!order) return { response: fail("سجل الطالب غير موجود", 404) };
  const profile = record(order.studentProfile);
  const garments = record(order.garmentDetails);
  const measurements = record(order.measurements);
  const custom = record(order.customText);
  const colors = record(order.colors);
  const normalizedPhone = data.phone !== undefined
    ? data.phone
      ? normalizeIraqiPhone(data.phone)
      : ""
    : order.phone;
  if (data.phone && !normalizedPhone) return { response: fail("رقم الهاتف الأول غير صحيح", 400) };
  const total = data.totalAmount ?? amount(order.totalAmount);
  const discount = data.discountAmount ?? amount(order.discountAmount);
  const remaining = Math.max(0, total - amount(order.paidAmount));
  const [saved] = await db
    .update(graduationOrdersTable)
    .set({
      ...(data.customerName !== undefined ? { customerName: data.customerName } : {}),
      ...(data.phone !== undefined ? { phone: normalizedPhone || "", phoneLast4: normalizePhoneDigits(normalizedPhone || "").slice(-4) } : {}),
      ...(data.phone2 !== undefined ? { phone2: data.phone2 ? normalizeIraqiPhone(data.phone2) || data.phone2 : null } : {}),
      studentProfile: {
        ...profile,
        ...(data.gender !== undefined ? { gender: data.gender } : {}),
        ...(data.size !== undefined ? { size: data.size } : {}),
        ...(data.university !== undefined ? { university: data.university } : {}),
        ...(data.college !== undefined ? { college: data.college } : {}),
        ...(data.department !== undefined ? { department: data.department } : {}),
        ...(data.graduationYear !== undefined ? { graduationYear: data.graduationYear } : {}),
      },
      garmentDetails: {
        ...garments,
        ...Object.fromEntries(
          ["robeType", "robeColor", "sashType", "sashColor", "capType", "rightText", "leftText", "printingType", "embroideryType"]
            .filter((key) => (data as any)[key] !== undefined)
            .map((key) => [key, (data as any)[key]]),
        ),
      },
      measurements: {
        ...measurements,
        ...Object.fromEntries(
          ["height", "weight", "shoulder", "sleeveLength", "chest"]
            .filter((key) => (data as any)[key] !== undefined)
            .map((key) => [key, (data as any)[key]]),
        ),
        ...(data.size !== undefined ? { suggestedSize: data.size } : {}),
        ...(data.gender !== undefined ? { gender: data.gender } : {}),
      },
      customText: {
        ...custom,
        ...(data.customerName !== undefined ? { studentName: data.customerName } : {}),
        ...(data.university !== undefined ? { university: data.university } : {}),
        ...(data.college !== undefined ? { college: data.college } : {}),
        ...(data.department !== undefined ? { department: data.department } : {}),
        ...(data.graduationYear !== undefined ? { graduationYear: data.graduationYear } : {}),
      },
      colors: {
        ...colors,
        ...(data.robeColor !== undefined ? { robe: data.robeColor } : {}),
        ...(data.sashColor !== undefined ? { sash: data.sashColor } : {}),
      },
      ...(data.robeType !== undefined ? { styleKey: data.robeType } : {}),
      ...(data.accessories !== undefined ? { accessories: data.accessories } : {}),
      ...(data.totalAmount !== undefined ? { totalAmount: String(total), subtotal: String(total + discount), remainingAmount: String(remaining) } : {}),
      ...(data.discountAmount !== undefined ? { discountAmount: String(discount) } : {}),
      ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
      paymentStatus: remaining <= 0 ? "paid" : amount(order.paidAmount) > 0 ? "partial" : "unpaid",
      updatedAt: new Date(),
    })
    .where(eq(graduationOrdersTable.id, orderId))
    .returning();
  if (saved.invoiceId && (data.totalAmount !== undefined || data.discountAmount !== undefined)) {
    await db.update(salesInvoicesTable).set({
      total: String(total),
      discountAmount: String(discount),
      remainingAmount: String(remaining),
      paymentStatus: remaining <= 0 ? "paid" : amount(saved.paidAmount) > 0 ? "partial" : "unpaid",
      updatedAt: new Date(),
    }).where(eq(salesInvoicesTable.id, saved.invoiceId));
    await db.update(salesInvoiceItemsTable).set({
      unitPrice: String(total + discount),
      discount: String(discount),
      total: String(total),
    }).where(eq(salesInvoiceItemsTable.invoiceId, saved.invoiceId));
  }
  await audit(user, "graduation_student_updated", "graduation_order", saved.id, {
    oldValue: formatStudent(order),
    newValue: formatStudent(saved),
    fields: Object.keys(data),
  });
  await timeline(user, "graduation_order", saved.id, "student_updated", "تم تحديث بيانات الطالب", {
    fields: Object.keys(data),
  });
  return { order: formatStudent(saved) };
}

function distributePayment(
  orders: any[],
  totalAmount: number,
  strategy: string,
  selectedIds: number[],
  manual: Array<{ orderId: number; amount: number }>,
) {
  const available = orders.filter((order) => amount(order.remainingAmount) > 0);
  if (strategy === "manual") {
    const byId = new Map(available.map((order) => [order.id, order]));
    let requested = 0;
    const result = manual
      .filter((row) => byId.has(row.orderId) && row.amount > 0)
      .map((row) => {
        const applied = Math.min(row.amount, amount(byId.get(row.orderId)?.remainingAmount));
        requested += applied;
        return { order: byId.get(row.orderId), amount: applied };
      });
    if (requested > totalAmount + 0.001) throw new Error("مجموع التوزيع اليدوي أكبر من مبلغ الدفعة");
    return result;
  }
  let candidates = strategy === "selected"
    ? available.filter((order) => selectedIds.includes(order.id))
    : available;
  if (!candidates.length) return [];
  if (strategy === "oldest") {
    candidates = [...candidates].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    let left = totalAmount;
    return candidates.flatMap((order) => {
      const applied = Math.min(left, amount(order.remainingAmount));
      left -= applied;
      return applied > 0 ? [{ order, amount: applied }] : [];
    });
  }
  const result = candidates.map((order) => ({ order, amount: 0 }));
  let left = totalAmount;
  let active = result;
  while (left > 0.009 && active.length) {
    const share = left / active.length;
    const next: typeof result = [];
    let consumed = 0;
    for (const entry of active) {
      const capacity = amount(entry.order.remainingAmount) - entry.amount;
      const applied = Math.min(capacity, share);
      entry.amount = Math.round((entry.amount + applied) * 100) / 100;
      consumed += applied;
      if (capacity - applied > 0.009) next.push(entry);
    }
    if (consumed <= 0.009) break;
    left = Math.max(0, left - consumed);
    active = next;
  }
  return result.filter((entry) => entry.amount > 0);
}

async function receivePayment(
  raw: unknown,
  user: GraduationAdminUser,
  groupId?: number,
  orderId?: number,
) {
  const parsed = paymentSchema.safeParse(raw);
  if (!parsed.success) return { response: fail("تحقق من بيانات الدفعة", 400, parsed.error.issues) };
  const data = parsed.data;
  const idempotencyKey = (data.idempotencyKey || randomUUID()).slice(0, 96);
  const duplicate = await db.query.graduationStudentPaymentsTable.findFirst({
    where: eq(graduationStudentPaymentsTable.paymentBatchId, idempotencyKey),
  });
  if (duplicate) return { response: fail("تم تسجيل هذه الدفعة مسبقاً", 409) };
  const orders = await db
    .select()
    .from(graduationOrdersTable)
    .where(
      and(
        groupId ? eq(graduationOrdersTable.groupId, groupId) : eq(graduationOrdersTable.id, orderId!),
        sql`${graduationOrdersTable.archivedAt} is null`,
        sql`${graduationOrdersTable.status} <> 'cancelled'`,
      ),
    )
    .orderBy(asc(graduationOrdersTable.createdAt));
  if (!orders.length) return { response: fail("لا توجد طلبات قابلة للدفع", 404) };
  if (data.strategy === "unallocated") {
    if (!groupId) return { response: fail("الرصيد غير المخصص متاح لدفعات المجموعة فقط", 400) };
    const group = await db.query.graduationGroupsTable.findFirst({ where: eq(graduationGroupsTable.id, groupId) });
    if (!group) return { response: fail("المجموعة غير موجودة", 404) };
    const [payment] = await db.insert(graduationStudentPaymentsTable).values({
      paymentBatchId: idempotencyKey,
      idempotencyKey,
      groupId,
      amount: String(data.amount),
      paymentMethod: data.paymentMethod,
      allocationStrategy: data.strategy,
      notes: data.notes || null,
      receivedBy: user.id,
      receivedByName: user.fullName || user.username,
    }).returning();
    const nextCredit = amount(group.groupCreditAmount) + data.amount;
    await db.update(graduationGroupsTable).set({ groupCreditAmount: String(nextCredit), updatedAt: new Date() }).where(eq(graduationGroupsTable.id, groupId));
    const financial = await syncSourcePaymentTarget({
      sourceType: "graduation_group",
      sourceId: groupId,
      sourceEvent: "group_credit",
      targetAmount: nextCredit,
      normalDirection: "revenue",
      department: "graduation",
      transactionType: "graduation_group_credit",
      description: `رصيد غير مخصص لمجموعة التخرج ${group.groupNo}`,
      paymentMethod: data.paymentMethod,
      customerName: group.representativeName,
      customerPhone: group.representativePhone,
    }, actor(user));
    await db.update(graduationStudentPaymentsTable).set({ financialTransactionId: financial?.id ?? null }).where(eq(graduationStudentPaymentsTable.id, payment.id));
    await audit(user, "graduation_group_credit_received", "graduation_group", groupId, { amount: data.amount, paymentMethod: data.paymentMethod, idempotencyKey });
    return { payment, allocated: 0, unallocated: data.amount };
  }
  const allocations = orderId
    ? [{ order: orders[0], amount: Math.min(data.amount, amount(orders[0].remainingAmount)) }]
    : distributePayment(orders, data.amount, data.strategy, data.selectedStudentIds, data.allocations);
  if (!allocations.length) return { response: fail("لم يتم العثور على أرصدة قابلة لتوزيع الدفعة", 409) };
  const appliedTotal = allocations.reduce((sum, item) => sum + item.amount, 0);
  const savedPayments: any[] = [];
  for (const allocation of allocations) {
    const [payment] = await db.insert(graduationStudentPaymentsTable).values({
      paymentBatchId: idempotencyKey,
      idempotencyKey: `${idempotencyKey}:${allocation.order.id}`,
      graduationOrderId: allocation.order.id,
      groupId: groupId ?? allocation.order.groupId,
      customerId: allocation.order.customerId,
      amount: String(allocation.amount),
      paymentMethod: data.paymentMethod,
      allocationStrategy: data.strategy,
      notes: data.notes || null,
      receivedBy: user.id,
      receivedByName: user.fullName || user.username,
    }).returning();
    const result = await updateOrder(allocation.order, {
      paidAmount: amount(allocation.order.paidAmount) + allocation.amount,
      paymentMethod: data.paymentMethod,
    }, user);
    if (result.response) return result;
    const refreshed = await db.query.graduationOrdersTable.findFirst({ where: eq(graduationOrdersTable.id, allocation.order.id) });
    await db.update(graduationStudentPaymentsTable).set({ financialTransactionId: refreshed?.financialTransactionId ?? null }).where(eq(graduationStudentPaymentsTable.id, payment.id));
    const paymentReceiptNo = `AJN-GR-P-${new Date().getFullYear()}-${String(payment.id).padStart(6, "0")}`;
    await db.insert(graduationReceiptsTable).values({
      receiptNo: paymentReceiptNo,
      receiptType: "payment",
      graduationOrderId: allocation.order.id,
      groupId: groupId ?? allocation.order.groupId,
      paymentId: payment.id,
      snapshot: { ...receiptSnapshot(refreshed || allocation.order), paymentAmount: allocation.amount, paymentMethod: data.paymentMethod },
      issuedBy: user.id,
      issuedByName: user.fullName || user.username,
    });
    savedPayments.push({ ...payment, receiptNo: paymentReceiptNo });
  }
  const unallocatedAmount = Math.max(0, data.amount - appliedTotal);
  if (groupId && unallocatedAmount > 0.009) {
    const group = await db.query.graduationGroupsTable.findFirst({ where: eq(graduationGroupsTable.id, groupId) });
    if (group) {
      const [creditPayment] = await db.insert(graduationStudentPaymentsTable).values({
        paymentBatchId: idempotencyKey,
        idempotencyKey: `${idempotencyKey}:credit`,
        groupId,
        amount: String(unallocatedAmount),
        paymentMethod: data.paymentMethod,
        allocationStrategy: "unallocated",
        notes: data.notes || null,
        receivedBy: user.id,
        receivedByName: user.fullName || user.username,
      }).returning();
      const nextCredit = amount(group.groupCreditAmount) + unallocatedAmount;
      await db.update(graduationGroupsTable).set({ groupCreditAmount: String(nextCredit), updatedAt: new Date() }).where(eq(graduationGroupsTable.id, groupId));
      const financial = await syncSourcePaymentTarget({
        sourceType: "graduation_group",
        sourceId: groupId,
        sourceEvent: "group_credit",
        targetAmount: nextCredit,
        normalDirection: "revenue",
        department: "graduation",
        transactionType: "graduation_group_credit",
        description: `رصيد غير مخصص لمجموعة التخرج ${group.groupNo}`,
        paymentMethod: data.paymentMethod,
        customerName: group.representativeName,
        customerPhone: group.representativePhone,
      }, actor(user));
      await db.update(graduationStudentPaymentsTable).set({ financialTransactionId: financial?.id ?? null }).where(eq(graduationStudentPaymentsTable.id, creditPayment.id));
      const creditReceiptNo = `AJN-GR-P-${new Date().getFullYear()}-${String(creditPayment.id).padStart(6, "0")}`;
      await db.insert(graduationReceiptsTable).values({
        receiptNo: creditReceiptNo,
        receiptType: "payment",
        groupId,
        paymentId: creditPayment.id,
        snapshot: { groupCode: group.groupNo, groupName: group.title, paymentAmount: unallocatedAmount, paymentMethod: data.paymentMethod, allocationStrategy: "unallocated" },
        issuedBy: user.id,
        issuedByName: user.fullName || user.username,
      });
      savedPayments.push({ ...creditPayment, receiptNo: creditReceiptNo });
    }
  }
  await audit(user, groupId ? "graduation_group_payment_received" : "graduation_student_payment_received", groupId ? "graduation_group" : "graduation_order", groupId || orderId!, {
    amount: data.amount,
    appliedTotal,
    strategy: data.strategy,
    allocations: allocations.map((item) => ({ orderId: item.order.id, amount: item.amount })),
    idempotencyKey,
  });
  return { payments: savedPayments, allocated: appliedTotal, unallocated: unallocatedAmount };
}

async function templateList() {
  const rows = await db.select().from(graduationTemplatesTable).orderBy(asc(graduationTemplatesTable.sortOrder), desc(graduationTemplatesTable.createdAt));
  const ids = rows.map((row) => row.id);
  const versions = ids.length
    ? await db.select().from(graduationTemplateVersionsTable).where(inArray(graduationTemplateVersionsTable.templateId, ids)).orderBy(desc(graduationTemplateVersionsTable.version))
    : [];
  return rows.map((row) => ({
    ...row,
    defaultPrice: amount(row.defaultPrice),
    costPrice: amount(row.costPrice),
    discountPrice: row.discountPrice != null ? amount(row.discountPrice) : null,
    versions: versions.filter((version) => version.templateId === row.id),
  }));
}

async function setTemplateArchived(
  id: number,
  archived: boolean,
  user: GraduationAdminUser,
) {
  const existing = await db.query.graduationTemplatesTable.findFirst({
    where: eq(graduationTemplatesTable.id, id),
  });
  if (!existing) return { response: fail("النموذج غير موجود", 404) };
  const [template] = await db
    .update(graduationTemplatesTable)
    .set({
      archivedAt: archived ? new Date() : null,
      isActive: !archived,
      updatedAt: new Date(),
    })
    .where(eq(graduationTemplatesTable.id, id))
    .returning();
  await audit(
    user,
    archived ? "graduation_template_archived" : "graduation_template_restored",
    "graduation_template",
    id,
    { code: existing.code },
  );
  return { template };
}

async function duplicateTemplate(id: number, user: GraduationAdminUser) {
  const existing = await db.query.graduationTemplatesTable.findFirst({
    where: eq(graduationTemplatesTable.id, id),
  });
  if (!existing) return { response: fail("النموذج غير موجود", 404) };
  const [draft] = await db
    .insert(graduationTemplatesTable)
    .values({
      code: `GR-TPL-${randomUUID()}`,
      name: `${existing.name} (نسخة)`,
      templateType: existing.templateType,
      university: existing.university,
      college: existing.college,
      department: existing.department,
      previewImageUrl: existing.previewImageUrl,
      modelUrl: existing.modelUrl,
      images: existing.images,
      defaultPrice: existing.defaultPrice,
      costPrice: existing.costPrice,
      discountPrice: existing.discountPrice,
      sku: null,
      barcode: null,
      trackStock: existing.trackStock,
      stock: 0,
      minStock: existing.minStock,
      configuration: existing.configuration,
      isActive: false,
      isFeatured: false,
      sortOrder: existing.sortOrder,
      createdBy: user.id,
    })
    .returning();
  const code = `AJN-GRT-${String(draft.id).padStart(5, "0")}-C`;
  const [template] = await db
    .update(graduationTemplatesTable)
    .set({ code })
    .where(eq(graduationTemplatesTable.id, draft.id))
    .returning();
  await db.insert(graduationTemplateVersionsTable).values({
    templateId: template.id,
    version: 1,
    snapshot: { duplicatedFrom: existing.id, code },
    createdBy: user.id,
  });
  await audit(user, "graduation_template_duplicated", "graduation_template", template.id, {
    sourceId: existing.id,
    code,
  });
  return { template };
}

async function reorderTemplates(ids: number[], user: GraduationAdminUser) {
  await Promise.all(
    ids.map((id, sortOrder) =>
      db
        .update(graduationTemplatesTable)
        .set({ sortOrder, updatedAt: new Date() })
        .where(eq(graduationTemplatesTable.id, id)),
    ),
  );
  await audit(user, "graduation_template_reordered", "graduation_template", ids[0] ?? 0, {
    ids,
  });
  return { reordered: true };
}

async function deleteTemplate(id: number, user: GraduationAdminUser) {
  const existing = await db.query.graduationTemplatesTable.findFirst({
    where: eq(graduationTemplatesTable.id, id),
  });
  if (!existing) return { response: fail("النموذج غير موجود", 404) };
  // Hard delete is only allowed when the product has no historical links.
  const countRefs = async (table: any, column: any) => {
    const [row] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(column, id));
    return Number(row?.value ?? 0);
  };
  const [orderItems, packageItems, components] = await Promise.all([
    countRefs(graduationOrderItemsTable, graduationOrderItemsTable.templateId),
    countRefs(graduationPackageItemsTable, graduationPackageItemsTable.templateId),
    countRefs(graduationComponentsTable, graduationComponentsTable.templateId),
  ]);
  if (orderItems + packageItems + components > 0)
    return {
      response: fail(
        "لا يمكن حذف المنتج نهائياً لارتباطه بطلبات أو باقات أو مكونات سابقة. يمكنك أرشفته بدلاً من ذلك.",
        409,
        { orderItems, packageItems, components },
      ),
    };
  await db.delete(graduationTemplatesTable).where(eq(graduationTemplatesTable.id, id));
  await audit(user, "graduation_template_deleted", "graduation_template", id, {
    code: existing.code,
  });
  return { deleted: true };
}

async function saveTemplate(raw: unknown, user: GraduationAdminUser, id?: number) {
  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) return { response: fail("تحقق من بيانات النموذج", 400, parsed.error.issues) };
  const data = parsed.data;
  if (!id) {
    const [draft] = await db.insert(graduationTemplatesTable).values({
      code: data.code || `GR-TPL-${randomUUID()}`,
      name: data.name,
      templateType: data.templateType,
      university: data.university || null,
      college: data.college || null,
      department: data.department || null,
      previewImageUrl: data.previewImageUrl || null,
      modelUrl: data.modelUrl || null,
      images: data.images,
      defaultPrice: String(data.defaultPrice),
      costPrice: String(data.costPrice),
      discountPrice: data.discountPrice != null ? String(data.discountPrice) : null,
      sku: data.sku || null,
      barcode: data.barcode || null,
      trackStock: data.trackStock,
      stock: data.stock,
      minStock: data.minStock,
      configuration: data.configuration,
      isActive: data.isActive,
      isFeatured: data.isFeatured,
      sortOrder: data.sortOrder,
      createdBy: user.id,
    }).returning();
    const code = data.code || `AJN-GRT-${String(draft.id).padStart(5, "0")}`;
    const [template] = await db.update(graduationTemplatesTable).set({ code }).where(eq(graduationTemplatesTable.id, draft.id)).returning();
    const [version] = await db.insert(graduationTemplateVersionsTable).values({ templateId: template.id, version: 1, snapshot: { ...data, code }, createdBy: user.id }).returning();
    await audit(user, "graduation_template_created", "graduation_template", template.id, { code, version: 1 });
    return { template: { ...template, version } };
  }
  const existing = await db.query.graduationTemplatesTable.findFirst({ where: eq(graduationTemplatesTable.id, id) });
  if (!existing) return { response: fail("النموذج غير موجود", 404) };
  const versionNumber = existing.currentVersion + 1;
  const [template] = await db.update(graduationTemplatesTable).set({
    code: data.code || existing.code,
    name: data.name,
    templateType: data.templateType,
    university: data.university || null,
    college: data.college || null,
    department: data.department || null,
    previewImageUrl: data.previewImageUrl || null,
    modelUrl: data.modelUrl || null,
    images: data.images,
    defaultPrice: String(data.defaultPrice),
    costPrice: String(data.costPrice),
    discountPrice: data.discountPrice != null ? String(data.discountPrice) : null,
    sku: data.sku || null,
    barcode: data.barcode || null,
    trackStock: data.trackStock,
    stock: data.stock,
    minStock: data.minStock,
    configuration: data.configuration,
    isActive: data.isActive,
    isFeatured: data.isFeatured,
    sortOrder: data.sortOrder,
    currentVersion: versionNumber,
    updatedAt: new Date(),
  }).where(eq(graduationTemplatesTable.id, id)).returning();
  const [version] = await db.insert(graduationTemplateVersionsTable).values({ templateId: id, version: versionNumber, snapshot: { ...data, code: template.code }, createdBy: user.id }).returning();
  await audit(user, "graduation_template_updated", "graduation_template", id, { oldVersion: existing.currentVersion, newVersion: versionNumber });
  return { template: { ...template, version } };
}

async function applyBulk(groupId: number, raw: any, user: GraduationAdminUser) {
  const action = String(raw?.action || "");
  const selectedIds = Array.isArray(raw?.studentIds) ? raw.studentIds.map(Number).filter(Boolean) : [];
  const conditions = [eq(graduationOrdersTable.groupId, groupId), sql`${graduationOrdersTable.archivedAt} is null`];
  if (selectedIds.length) conditions.push(inArray(graduationOrdersTable.id, selectedIds));
  const orders = await db.select().from(graduationOrdersTable).where(and(...conditions));
  if (!orders.length) return { response: fail("لم يتم تحديد أي طالب", 400) };
  let version: any = null;
  if (action === "apply_template") {
    const templateId = Number(raw?.templateId);
    const template = await db.query.graduationTemplatesTable.findFirst({ where: eq(graduationTemplatesTable.id, templateId) });
    if (!template) return { response: fail("النموذج غير موجود", 404) };
    version = await db.query.graduationTemplateVersionsTable.findFirst({
      where: and(eq(graduationTemplateVersionsTable.templateId, templateId), eq(graduationTemplateVersionsTable.version, template.currentVersion)),
    });
    if (!version) return { response: fail("نسخة النموذج غير موجودة", 404) };
  }
  for (const order of orders) {
    if (action === "production_stage") {
      const stage = String(raw?.value || "");
      if (!GRADUATION_STAGES.includes(stage as any)) return { response: fail("مرحلة الإنتاج غير صحيحة", 400) };
      const result = await updateOrder(order, { productionStage: stage }, user);
      if (result.response) return result;
      await db.insert(graduationProductionEventsTable).values({ graduationOrderId: order.id, stage, previousStage: order.productionStage, employeeId: user.id, employeeName: user.fullName || user.username });
      continue;
    }
    const garments = record(order.garmentDetails);
    const colors = record(order.colors);
    const update: any = { updatedAt: new Date() };
    if (action === "apply_template") {
      const snapshot = record(version.snapshot);
      const configuration = record(snapshot.configuration);
      update.templateVersionId = version.id;
      update.templateSnapshot = snapshot;
      update.styleKey = String(configuration.robeType || configuration.styleKey || order.styleKey);
      update.garmentDetails = { ...garments, ...record(configuration.garmentDetails), robeType: configuration.robeType || configuration.styleKey || garments.robeType };
      update.colors = { ...colors, ...record(configuration.colors) };
      update.accessories = Array.isArray(configuration.accessories) ? configuration.accessories : order.accessories;
      update.previewAssets = { ...record(order.previewAssets), templatePreview: snapshot.previewImageUrl || "" };
    } else if (action === "robe") {
      update.styleKey = String(raw?.value || order.styleKey);
      update.garmentDetails = { ...garments, robeType: String(raw?.value || "") };
    } else if (action === "sash") {
      update.garmentDetails = { ...garments, sashType: String(raw?.value || "") };
    } else if (action === "color") {
      update.colors = { ...colors, robe: String(raw?.robeColor || colors.robe || ""), sash: String(raw?.sashColor || colors.sash || "") };
      update.garmentDetails = { ...garments, robeColor: String(raw?.robeColor || garments.robeColor || ""), sashColor: String(raw?.sashColor || garments.sashColor || "") };
    } else if (action === "printing") {
      update.garmentDetails = { ...garments, printingType: String(raw?.value || "") };
    } else if (action === "price") {
      const total = amount(raw?.value);
      update.totalAmount = String(total);
      update.subtotal = String(total + amount(order.discountAmount));
      update.remainingAmount = String(Math.max(0, total - amount(order.paidAmount)));
      update.paymentStatus = amount(update.remainingAmount) <= 0 ? "paid" : amount(order.paidAmount) > 0 ? "partial" : "unpaid";
    } else {
      return { response: fail("إجراء التحديث الجماعي غير مدعوم", 400) };
    }
    await db.update(graduationOrdersTable).set(update).where(eq(graduationOrdersTable.id, order.id));
  }
  await audit(user, "graduation_group_bulk_update", "graduation_group", groupId, { action, studentIds: orders.map((order) => order.id), value: raw?.value, templateVersionId: version?.id });
  await timeline(user, "graduation_group", groupId, "bulk_update", `تم تحديث ${orders.length} طالباً`, { action, count: orders.length });
  return { updated: orders.length };
}

async function generatePreviews(groupId: number, raw: any, user: GraduationAdminUser) {
  const selectedIds = Array.isArray(raw?.studentIds) ? raw.studentIds.map(Number).filter(Boolean) : [];
  const conditions = [eq(graduationOrdersTable.groupId, groupId), sql`${graduationOrdersTable.archivedAt} is null`];
  if (selectedIds.length) conditions.push(inArray(graduationOrdersTable.id, selectedIds));
  const orders = await db.select().from(graduationOrdersTable).where(and(...conditions));
  const generated = [];
  for (const order of orders) {
    const [latest] = await db.select({ version: sql<number>`coalesce(max(${graduationPreviewsTable.version}),0)::int` }).from(graduationPreviewsTable).where(eq(graduationPreviewsTable.graduationOrderId, order.id));
    const version = Number(latest?.version || 0) + 1;
    const assets = {
      ...record(order.previewAssets),
      template: record(order.templateSnapshot).previewImageUrl || record(order.previewAssets).templatePreview || "",
      views: ["front", "back", "left", "right"],
    };
    const [preview] = await db.insert(graduationPreviewsTable).values({
      graduationOrderId: order.id,
      version,
      status: "ready",
      assets,
      configurationSnapshot: {
        studentCode: studentIdentity(order).studentCode,
        studentName: order.customerName,
        measurements: order.measurements,
        colors: order.colors,
        garmentDetails: order.garmentDetails,
        templateSnapshot: order.templateSnapshot,
      },
      generatedBy: user.id,
    }).returning();
    const approvalToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    await db.insert(graduationApprovalsTable).values({ graduationOrderId: order.id, previewId: preview.id, approvalToken, status: "pending" });
    await db.update(graduationOrdersTable).set({ previewAssets: assets, designApprovedAt: null, updatedAt: new Date() }).where(eq(graduationOrdersTable.id, order.id));
    generated.push({ orderId: order.id, previewId: preview.id, version, approvalUrl: `/graduation/track/${order.qrToken}` });
  }
  await audit(user, "graduation_group_previews_generated", "graduation_group", groupId, { count: generated.length, studentIds: generated.map((item) => item.orderId) });
  return { generated, count: generated.length };
}

async function receiptForOrder(orderId: number, req: NextRequest, user: GraduationAdminUser, markPrinted: boolean) {
  const order = await db.query.graduationOrdersTable.findFirst({ where: eq(graduationOrdersTable.id, orderId) });
  if (!order) return null;
  const saved = await ensureIdentity(order, user);
  const receipt = await db.query.graduationReceiptsTable.findFirst({ where: eq(graduationReceiptsTable.receiptNo, saved.receiptNo!) });
  if (markPrinted && receipt) {
    await db.update(graduationReceiptsTable).set({ reprintCount: receipt.reprintCount + 1 }).where(eq(graduationReceiptsTable.id, receipt.id));
    await audit(user, "graduation_receipt_printed", "graduation_order", orderId, { receiptNo: receipt.receiptNo, reprintCount: receipt.reprintCount + 1 });
  }
  const qrDataUrl = await QRCode.toDataURL(`${req.nextUrl.origin}/graduation/track/${saved.qrToken}`, { width: 320, margin: 1 });
  return { receipt: { ...receipt, snapshot: receiptSnapshot(saved), qrDataUrl, barcodeValue: saved.barcodeValue, trackingUrl: `/graduation/track/${saved.qrToken}` } };
}

async function groupReceipt(groupId: number, req: NextRequest, user: GraduationAdminUser, markPrinted: boolean) {
  const detail = await groupDetail(groupId, user);
  if (!detail) return null;
  const receiptNo = `AJN-GR-GR-${new Date(detail.group.createdAt).getFullYear()}-${String(groupId).padStart(5, "0")}`;
  const snapshot = { groupCode: detail.group.groupNo, groupName: detail.group.title, representative: detail.group.representativeName, university: detail.group.university, college: detail.group.college, department: detail.group.department, students: detail.students.map((student) => ({ studentCode: student.studentCode, name: student.customerName, total: student.total, paid: student.paid, remaining: student.remaining })), totals: detail.totals, deliveryDate: detail.group.eventDate };
  await db.insert(graduationReceiptsTable).values({ receiptNo, receiptType: "group", groupId, snapshot, issuedBy: user.id, issuedByName: user.fullName || user.username }).onConflictDoNothing();
  const receipt = await db.query.graduationReceiptsTable.findFirst({ where: eq(graduationReceiptsTable.receiptNo, receiptNo) });
  if (markPrinted && receipt) await db.update(graduationReceiptsTable).set({ reprintCount: receipt.reprintCount + 1 }).where(eq(graduationReceiptsTable.id, receipt.id));
  const qrDataUrl = await QRCode.toDataURL(`${req.nextUrl.origin}/graduation?group=${detail.group.joinToken}`, { width: 320, margin: 1 });
  return { receipt: { ...receipt, snapshot, qrDataUrl } };
}

export async function handleAdminGraduationOperations(
  req: NextRequest,
  parts: string[],
  user: GraduationAdminUser,
): Promise<NextResponse | null> {
  await ensureGraduationOperationsTables();
  const enterprise = await handleGraduationEnterprise(req, parts, user);
  if (enterprise) return enterprise;
  const method = req.method;
  const resource = parts[0] || "dashboard";
  const viewDenied = requireOperationPermission(user, "graduation.view");
  if (viewDenied) return viewDenied;

  if (resource === "students" && method === "GET") {
    const search = String(req.nextUrl.searchParams.get("search") || "").trim();
    const groupId = Number(req.nextUrl.searchParams.get("groupId") || 0);
    const where = and(
      sql`${graduationOrdersTable.archivedAt} is null`,
      groupId ? eq(graduationOrdersTable.groupId, groupId) : undefined,
      search
        ? or(
            ilike(graduationOrdersTable.customerName, `%${search}%`),
            ilike(graduationOrdersTable.phone, `%${normalizePhoneDigits(search)}%`),
            ilike(graduationOrdersTable.phone2, `%${normalizePhoneDigits(search)}%`),
            ilike(graduationOrdersTable.studentCode, `%${search}%`),
            ilike(graduationOrdersTable.orderNo, `%${search}%`),
            ilike(graduationOrdersTable.receiptNo, `%${search}%`),
            ilike(graduationOrdersTable.barcodeValue, `%${search}%`),
          )
        : undefined,
    );
    const rows = await db.select().from(graduationOrdersTable).where(where).orderBy(desc(graduationOrdersTable.createdAt)).limit(300);
    const items = await Promise.all(rows.map((row) => ensureIdentity(row, user).then(formatStudent)));
    return json({ items });
  }

  if (resource === "templates") {
    if (method === "GET") return json({ items: await templateList() });
    // Reorder must be matched before the generic create (both are POST).
    if (method === "POST" && parts[1] === "reorder") {
      const denied = requireOperationPermission(user, "graduation.template.manage");
      if (denied) return denied;
      const payload = await body(req);
      const ids = Array.isArray(payload?.ids)
        ? payload.ids.map(Number).filter((value: number) => Number.isFinite(value) && value > 0)
        : [];
      return json(await reorderTemplates(ids, user));
    }
    // Sub-actions on a specific template (checked before generic id routes).
    if (parts[1] && !Number.isNaN(Number(parts[1])) && parts[2]) {
      const denied = requireOperationPermission(user, "graduation.template.manage");
      if (denied) return denied;
      const id = Number(parts[1]);
      if (parts[2] === "archive" && (method === "PATCH" || method === "POST")) {
        const result = await setTemplateArchived(id, true, user);
        return result.response ?? json(result);
      }
      if (parts[2] === "restore" && (method === "PATCH" || method === "POST")) {
        const result = await setTemplateArchived(id, false, user);
        return result.response ?? json(result);
      }
      if (parts[2] === "duplicate" && method === "POST") {
        const result = await duplicateTemplate(id, user);
        return result.response ?? json(result, 201);
      }
    }
    if (method === "DELETE" && parts[1] && !parts[2]) {
      const denied = requireOperationPermission(user, "graduation.template.manage");
      if (denied) return denied;
      const result = await deleteTemplate(Number(parts[1]), user);
      return result.response ?? json(result);
    }
    if (method === "POST" && !parts[1]) {
      const denied = requireOperationPermission(user, "graduation.template.manage");
      if (denied) return denied;
      const result = await saveTemplate(await body(req), user);
      return result.response ?? json(result, 201);
    }
    if ((method === "PATCH" || method === "PUT") && parts[1] && !parts[2]) {
      const denied = requireOperationPermission(user, "graduation.template.manage");
      if (denied) return denied;
      const result = await saveTemplate(await body(req), user, Number(parts[1]));
      return result.response ?? json(result);
    }
  }

  if (resource === "groups" && parts[1] && !Number.isNaN(Number(parts[1]))) {
    const groupId = Number(parts[1]);
    const action = parts[2] || "detail";
    if (method === "GET" && action === "detail") {
      const detail = await groupDetail(groupId, user);
      return detail ? json(detail) : fail("المجموعة غير موجودة", 404);
    }
    if (action === "students" && method === "POST" && !parts[3]) {
      const denied = requireOperationPermission(user, "graduation.student.add");
      if (denied) return denied;
      const result = await addStudent(groupId, await body(req), user);
      return result.response ?? json(result, 201);
    }
    if (action === "students" && parts[3] && (method === "PATCH" || method === "PUT")) {
      const denied = requireOperationPermission(user, "graduation.edit");
      if (denied) return denied;
      const result = await patchStudent(Number(parts[3]), await body(req), user);
      return result.response ?? json(result);
    }
    if (action === "students" && parts[3] && method === "DELETE") {
      const denied = requireOperationPermission(user, "graduation.student.delete");
      if (denied) return denied;
      const order = await db.query.graduationOrdersTable.findFirst({ where: and(eq(graduationOrdersTable.id, Number(parts[3])), eq(graduationOrdersTable.groupId, groupId)) });
      if (!order) return fail("سجل الطالب غير موجود", 404);
      await db.update(graduationOrdersTable).set({ status: "cancelled", archivedAt: new Date(), updatedAt: new Date() }).where(eq(graduationOrdersTable.id, order.id));
      await audit(user, "graduation_student_archived", "graduation_order", order.id, { groupId, studentCode: order.studentCode, oldValue: formatStudent(order) });
      return json({ archived: true });
    }
    if (action === "bulk" && method === "POST") {
      const denied = requireOperationPermission(user, "graduation.group.edit");
      if (denied) return denied;
      const result = await applyBulk(groupId, await body(req), user);
      return "response" in result ? result.response : json(result);
    }
    if (action === "payments" && method === "POST") {
      const denied = requireOperationPermission(user, "graduation.payment.receive");
      if (denied) return denied;
      const result = await receivePayment(await body(req), user, groupId);
      if ("response" in result && result.response) return result.response;
      return json(result, 201);
    }
    if (action === "previews" && method === "POST") {
      const denied = requireOperationPermission(user, "graduation.edit");
      if (denied) return denied;
      const result = await generatePreviews(groupId, await body(req), user);
      return json(result, 201);
    }
    if (action === "receipt" && (method === "GET" || method === "POST")) {
      const denied = requireOperationPermission(user, "graduation.receipt.print");
      if (denied) return denied;
      const result = await groupReceipt(groupId, req, user, method === "POST");
      return result ? json(result) : fail("المجموعة غير موجودة", 404);
    }
  }

  if (resource === "orders" && parts[1] && parts[2] === "payment" && method === "POST") {
    const denied = requireOperationPermission(user, "graduation.payment.receive");
    if (denied) return denied;
    const result = await receivePayment(await body(req), user, undefined, Number(parts[1]));
    if ("response" in result && result.response) return result.response;
    return json(result, 201);
  }
  if (resource === "orders" && parts[1] && parts[2] === "receipt" && (method === "GET" || method === "POST")) {
    const denied = requireOperationPermission(user, "graduation.receipt.print");
    if (denied) return denied;
    const result = await receiptForOrder(Number(parts[1]), req, user, method === "POST");
    return result ? json(result) : fail("سجل الطالب غير موجود", 404);
  }

  if (resource === "scans" && method === "POST") {
    const denied = requireOperationPermission(user, "graduation.production.update");
    if (denied) return denied;
    const data = await body(req);
    const code = String(data?.code || "").trim();
    const order = await db.query.graduationOrdersTable.findFirst({
      where: or(
        eq(graduationOrdersTable.studentCode, code),
        eq(graduationOrdersTable.barcodeValue, code),
        eq(graduationOrdersTable.qrToken, code),
        eq(graduationOrdersTable.orderNo, code),
      ),
    });
    if (!order) return fail("لم يتم العثور على الطالب من الرمز الممسوح", 404);
    const stage = String(data?.stage || order.productionStage);
    if (!GRADUATION_STAGES.includes(stage as any)) return fail("مرحلة المسح غير صحيحة", 400);
    if (stage !== order.productionStage) {
      const result = await updateOrder(order, { productionStage: stage }, user);
      if (result.response) return result.response;
    }
    await db.insert(graduationProductionEventsTable).values({
      graduationOrderId: order.id,
      stage,
      previousStage: order.productionStage,
      scanType: String(data?.scanType || "qr"),
      evidenceUrl: String(data?.evidenceUrl || "") || null,
      notes: String(data?.notes || "") || null,
      employeeId: user.id,
      employeeName: user.fullName || user.username,
    });
    await timeline(user, "graduation_order", order.id, "student_scanned", `تم مسح الطالب في مرحلة ${stage}`, { scanType: data?.scanType || "qr", code });
    return json({ order: formatStudent({ ...order, productionStage: stage }) });
  }

  if (resource === "deliveries" && method === "POST") {
    const denied = requireOperationPermission(user, "graduation.delivery.confirm");
    if (denied) return denied;
    const data = await body(req);
    const code = String(data?.code || "").trim();
    const order = await db.query.graduationOrdersTable.findFirst({
      where: or(eq(graduationOrdersTable.studentCode, code), eq(graduationOrdersTable.barcodeValue, code), eq(graduationOrdersTable.qrToken, code)),
    });
    if (!order) return fail("لم يتم العثور على الطالب", 404);
    const verification = record(data?.verification);
    if (!["robe", "sash", "cap"].every((key) => verification[key] === true)) return fail("يجب التحقق من الروب والوشاح والقبعة قبل التسليم", 409);
    if (amount(order.remainingAmount) > 0 && data?.balanceConfirmed !== true) return fail("يوجد مبلغ متبقٍ؛ أكد الرصيد قبل التسليم", 409);
    const result = await updateOrder(order, {
      productionStage: "delivered",
      delivery: { status: "delivered", receivedBy: data?.receivedBy || order.customerName, deliveredAt: new Date().toISOString() },
    }, user);
    if (result.response) return result.response;
    const [event] = await db.insert(graduationDeliveryEventsTable).values({
      graduationOrderId: order.id,
      groupId: order.groupId,
      sessionCode: String(data?.sessionCode || "") || null,
      deliveredBy: user.id,
      deliveredByName: user.fullName || user.username,
      receivedBy: String(data?.receivedBy || order.customerName),
      signatureDataUrl: String(data?.signatureDataUrl || "") || null,
      packageImageUrl: String(data?.packageImageUrl || "") || null,
      balanceConfirmed: data?.balanceConfirmed === true,
      verification,
      notes: String(data?.notes || "") || null,
    }).returning();
    await audit(user, "graduation_delivery_confirmed", "graduation_order", order.id, { eventId: event.id, verification, receivedBy: event.receivedBy });
    return json({ event }, 201);
  }

  return null;
}

export { GRANULAR_PERMISSIONS };
