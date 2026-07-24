import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { z } from "zod/v4";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  adminActivityLogsTable,
  customersTable,
  db,
  entityTimelineTable,
  entityDocumentsTable,
  graduationGroupsTable,
  graduationOrdersTable,
  graduationResourcesTable,
  notificationsTable,
  productsTable,
  qrTokensTable,
  salesInvoiceItemsTable,
  salesInvoicesTable,
  settingsTable,
  staffTable,
  stockMovementsTable,
  tasksTable,
} from "@workspace/db";
import { normalizeIraqiPhone, normalizePhoneDigits } from "@/lib/phone";
import {
  DEFAULT_GRADUATION_CONFIG,
  GRADUATION_STAGES,
  GRADUATION_STAGE_LABELS,
  estimateGraduationProduction,
  graduationAdminPatchSchema,
  graduationInventoryItems,
  graduationOrderInputSchema,
  graduationPriceSummary,
  normalizeGraduationConfig,
  recommendedGraduationSize,
  type GraduationConfig,
  type GraduationOrderInput,
} from "@/lib/graduation";
import {
  ensureMasterCashBoxTables,
  syncSourcePaymentTarget,
  type FinancialActor,
} from "@/server/master-cash-box";
import { sendTelegramMessage } from "@/server/telegram";

export type GraduationAdminUser = {
  id: number;
  username: string;
  fullName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
};

const SETTING_KEY = "graduationConfig";
const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_BUCKET ||
  "ajn-assets";
const STORAGE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const STORAGE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const QC_KEYS = [
  "measurements",
  "fabric",
  "printing",
  "embroidery",
  "accessories",
  "cleaning",
  "packaging",
];

const graduationGroupInputSchema = z.object({
  title: z.string().trim().min(2, "اسم المجموعة مطلوب").max(180),
  university: z.string().trim().max(180).optional().default(""),
  college: z.string().trim().max(180).optional().default(""),
  department: z.string().trim().max(180).optional().default(""),
  graduationBatch: z.string().trim().max(40).optional().default(""),
  graduationYear: z.string().trim().max(10).optional().default(""),
  representativeName: z
    .string()
    .trim()
    .min(2, "اسم ممثل المجموعة مطلوب")
    .max(160),
  representativePhone: z.string().trim().min(10).max(30),
  expectedStudentCount: z.coerce.number().int().min(1).max(5000).default(1),
  deliveryDate: z.string().trim().max(20).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  defaultConfiguration: z.record(z.string(), z.unknown()).default({}),
});

const graduationTailorInputSchema = z.object({
  name: z.string().trim().min(2, "اسم الخياط مطلوب").max(160),
  code: z.string().trim().max(80).optional().default(""),
  phone: z.string().trim().max(30).optional().default(""),
  address: z.string().trim().max(500).optional().default(""),
  specialization: z.string().trim().max(200).optional().default(""),
  dailyCapacity: z.coerce.number().int().min(1).max(1000).default(1),
  status: z.enum(["active", "inactive", "leave"]).default("active"),
  notes: z.string().trim().max(2000).optional().default(""),
  photoUrl: z.string().optional().default(""),
  operatorId: z.coerce.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

let graduationTablesReady: Promise<void> | null = null;

export async function ensureGraduationTables() {
  if (!graduationTablesReady) {
    graduationTablesReady = db
      .execute(
        sql`
      CREATE TABLE IF NOT EXISTS graduation_groups (
        id serial PRIMARY KEY, group_no varchar(50) NOT NULL, join_token varchar(96) NOT NULL,
        title text NOT NULL, representative_name text NOT NULL DEFAULT '', representative_phone varchar(30) NOT NULL DEFAULT '',
        university text, college text, department text, graduation_year varchar(10), event_date date,
        default_configuration jsonb NOT NULL DEFAULT '{}'::jsonb, status varchar(24) NOT NULL DEFAULT 'open',
        expires_at timestamp, created_by integer REFERENCES staff(id) ON DELETE SET NULL,
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS graduation_groups_no_idx ON graduation_groups(group_no);
      CREATE UNIQUE INDEX IF NOT EXISTS graduation_groups_token_idx ON graduation_groups(join_token);
      CREATE INDEX IF NOT EXISTS graduation_groups_status_idx ON graduation_groups(status);

      CREATE TABLE IF NOT EXISTS graduation_orders (
        id serial PRIMARY KEY, order_no varchar(50) NOT NULL, qr_token varchar(96) NOT NULL,
        customer_id integer REFERENCES customers(id) ON DELETE SET NULL, group_id integer REFERENCES graduation_groups(id) ON DELETE SET NULL,
        customer_name text NOT NULL, phone varchar(30) NOT NULL, phone_last4 varchar(4), status varchar(30) NOT NULL DEFAULT 'draft',
        measurements jsonb NOT NULL DEFAULT '{}'::jsonb, colors jsonb NOT NULL DEFAULT '{}'::jsonb,
        fabric jsonb NOT NULL DEFAULT '{}'::jsonb, decoration jsonb NOT NULL DEFAULT '{}'::jsonb,
        custom_text jsonb NOT NULL DEFAULT '{}'::jsonb, accessories jsonb NOT NULL DEFAULT '[]'::jsonb,
        university_template jsonb NOT NULL DEFAULT '{}'::jsonb, preview_assets jsonb NOT NULL DEFAULT '{}'::jsonb,
        inventory_items jsonb NOT NULL DEFAULT '[]'::jsonb, pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
        subtotal numeric(14,2) NOT NULL DEFAULT 0, discount_amount numeric(14,2) NOT NULL DEFAULT 0,
        total_amount numeric(14,2) NOT NULL DEFAULT 0, paid_amount numeric(14,2) NOT NULL DEFAULT 0,
        remaining_amount numeric(14,2) NOT NULL DEFAULT 0, payment_method varchar(20) NOT NULL DEFAULT 'cash',
        payment_status varchar(20) NOT NULL DEFAULT 'unpaid', invoice_id integer, financial_transaction_id integer,
        inventory_applied boolean NOT NULL DEFAULT false, production_estimate jsonb NOT NULL DEFAULT '{}'::jsonb,
        quality_checklist jsonb NOT NULL DEFAULT '{}'::jsonb, design_approved_at timestamp,
        assigned_staff_id integer REFERENCES staff(id) ON DELETE SET NULL, delivery jsonb NOT NULL DEFAULT '{}'::jsonb,
        due_date date, notes text, internal_notes text, submitted_at timestamp, ready_at timestamp, delivered_at timestamp,
        archived_at timestamp, created_by integer REFERENCES staff(id) ON DELETE SET NULL, created_by_name text NOT NULL DEFAULT '',
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS graduation_orders_no_idx ON graduation_orders(order_no);
      CREATE UNIQUE INDEX IF NOT EXISTS graduation_orders_qr_token_idx ON graduation_orders(qr_token);
      CREATE INDEX IF NOT EXISTS graduation_orders_phone_idx ON graduation_orders(phone);
      CREATE INDEX IF NOT EXISTS graduation_orders_customer_idx ON graduation_orders(customer_id);
      CREATE INDEX IF NOT EXISTS graduation_orders_group_idx ON graduation_orders(group_id);
      CREATE INDEX IF NOT EXISTS graduation_orders_status_idx ON graduation_orders(status);
      CREATE INDEX IF NOT EXISTS graduation_orders_stage_idx ON graduation_orders(production_stage);
      CREATE INDEX IF NOT EXISTS graduation_orders_due_idx ON graduation_orders(due_date);

      CREATE TABLE IF NOT EXISTS graduation_resources (
        id serial PRIMARY KEY, resource_type varchar(30) NOT NULL, code varchar(80) NOT NULL, name text NOT NULL,
        product_id integer REFERENCES products(id) ON DELETE SET NULL, operator_id integer REFERENCES staff(id) ON DELETE SET NULL,
        operator_name text NOT NULL DEFAULT '', status varchar(30) NOT NULL DEFAULT 'available', metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
        usage_count integer NOT NULL DEFAULT 0, maintenance_due_at timestamp, notes text, is_active boolean NOT NULL DEFAULT true,
        created_by integer REFERENCES staff(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS graduation_resources_code_idx ON graduation_resources(code);
      CREATE INDEX IF NOT EXISTS graduation_resources_type_idx ON graduation_resources(resource_type);
      CREATE INDEX IF NOT EXISTS graduation_resources_status_idx ON graduation_resources(status);
    `,
      )
      .then(() => undefined)
      .catch((error) => {
        graduationTablesReady = null;
        throw error;
      });
  }
  await graduationTablesReady;
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}
function error(message: string, status = 400, details?: unknown) {
  return json({ error: message, ...(details ? { details } : {}) }, status);
}
async function requestBody(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
function money(value: unknown) {
  const number = Number(String(value ?? 0).replace(/,/g, ""));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}
function phoneLast4(phone: string) {
  const digits = normalizePhoneDigits(phone);
  return digits.length >= 4 ? digits.slice(-4) : "";
}
function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(
    new Date(),
  );
}
function actor(user?: GraduationAdminUser | null): FinancialActor {
  return {
    id: user?.id ?? null,
    name: user ? user.fullName || user.username : "النظام",
    role: user?.role ?? "system",
  };
}
function safeJson(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function groupMeta(row: { defaultConfiguration?: unknown }) {
  return safeJson(safeJson(row.defaultConfiguration).groupMeta);
}

function tailorAssignment(row: { productionEstimate?: unknown }) {
  return safeJson(safeJson(row.productionEstimate).tailorAssignment);
}

function graduationStageProgress(stage: string) {
  const index = GRADUATION_STAGES.indexOf(stage as any);
  return index < 0
    ? 0
    : Math.round((index / Math.max(1, GRADUATION_STAGES.length - 1)) * 100);
}

async function getConfig() {
  const row = await db.query.settingsTable.findFirst({
    where: eq(settingsTable.key, SETTING_KEY),
  });
  return normalizeGraduationConfig(row?.value);
}

async function saveConfig(value: unknown) {
  const config = normalizeGraduationConfig(value);
  for (const [key, folder] of [
    ["styles", "styles"],
    ["fabrics", "fabrics"],
    ["accessories", "accessories"],
    ["packages", "packages"],
  ] as const) {
    config[key] = (await Promise.all(
      config[key].map(async (item: any) => ({
        ...item,
        imageUrl: item.imageUrl
          ? await persistMedia(item.imageUrl, `graduation/${folder}`)
          : "",
        textureUrl: item.textureUrl
          ? await persistMedia(item.textureUrl, `graduation/${folder}/textures`)
          : item.textureUrl,
      })),
    )) as any;
  }
  config.universities = await Promise.all(
    config.universities.map(async (item) => ({
      ...item,
      logoUrl: item.logoUrl
        ? ((await persistMedia(item.logoUrl, "graduation/universities")) ?? "")
        : "",
    })),
  );
  await db
    .insert(settingsTable)
    .values({ key: SETTING_KEY, value: config as any })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: config as any, updatedAt: new Date() },
    });
  return config;
}

function parseDataUrl(value: string) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(value);
  if (!match) return null;
  try {
    return {
      mime: match[1] || "application/octet-stream",
      bytes: match[2]
        ? Buffer.from(match[3] || "", "base64")
        : Buffer.from(decodeURIComponent(match[3] || "")),
    };
  } catch {
    return null;
  }
}

function storageExtension(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("svg")) return "svg";
  return "bin";
}

async function persistMedia(value: unknown, folder: string) {
  const raw = String(value ?? "").trim();
  if (!raw || !raw.startsWith("data:")) return raw || null;
  const parsed = parseDataUrl(raw);
  if (!parsed || !STORAGE_URL || !STORAGE_SERVICE_KEY) return raw;
  const path = `${folder}/${today()}/${Date.now()}-${randomUUID()}.${storageExtension(parsed.mime)}`;
  const response = await fetch(
    `${STORAGE_URL.replace(/\/$/, "")}/storage/v1/object/${STORAGE_BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        apikey: STORAGE_SERVICE_KEY,
        authorization: `Bearer ${STORAGE_SERVICE_KEY}`,
        "content-type": parsed.mime,
        "x-upsert": "true",
      },
      body: parsed.bytes,
    },
  );
  if (!response.ok) throw new Error("تعذر رفع ملف تصميم التخرج");
  return `${STORAGE_URL.replace(/\/$/, "")}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

async function createGraduationGroup(
  raw: unknown,
  user: GraduationAdminUser | null,
  origin: string,
) {
  const parsed = graduationGroupInputSchema.safeParse(raw);
  if (!parsed.success)
    return {
      response: error(
        "تحقق من بيانات المجموعة",
        400,
        parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      ),
    };
  const data = parsed.data;
  const representativePhone = normalizeIraqiPhone(data.representativePhone);
  if (!representativePhone)
    return { response: error("رقم هاتف ممثل المجموعة غير صحيح", 400) };
  const representativeCustomer = await ensureCustomer(
    representativePhone,
    data.representativeName,
  );

  const configuration = safeJson(data.defaultConfiguration);
  const universityTemplate = safeJson(configuration.universityTemplate);
  const decoration = safeJson(configuration.decoration);
  const persistedConfiguration = {
    ...configuration,
    decoration: {
      ...decoration,
      universityLogo: decoration.universityLogo
        ? await persistMedia(
            decoration.universityLogo,
            "graduation/groups/logos",
          )
        : "",
      collegeLogo: decoration.collegeLogo
        ? await persistMedia(decoration.collegeLogo, "graduation/groups/logos")
        : "",
    },
    universityTemplate: {
      ...universityTemplate,
      logoUrl: universityTemplate.logoUrl
        ? await persistMedia(
            universityTemplate.logoUrl,
            "graduation/groups/logos",
          )
        : "",
      collegeLogoUrl: universityTemplate.collegeLogoUrl
        ? await persistMedia(
            universityTemplate.collegeLogoUrl,
            "graduation/groups/logos",
          )
        : "",
      defaultDesign: universityTemplate.defaultDesign
        ? await persistMedia(
            universityTemplate.defaultDesign,
            "graduation/groups/designs",
          )
        : "",
    },
    groupMeta: {
      graduationBatch: data.graduationBatch,
      expectedStudentCount: data.expectedStudentCount,
      deliveryDate: data.deliveryDate,
      notes: data.notes,
      lockedAt: new Date().toISOString(),
    },
  };

  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const [row] = await db
    .insert(graduationGroupsTable)
    .values({
      groupNo: `GRP-TMP-${randomUUID()}`,
      joinToken: token,
      title: data.title,
      representativeName: data.representativeName,
      representativePhone,
      university: data.university || null,
      college: data.college || null,
      department: data.department || null,
      graduationYear:
        data.graduationYear || data.graduationBatch.slice(0, 10) || null,
      eventDate: data.deliveryDate || null,
      defaultConfiguration: persistedConfiguration as any,
      createdBy: user?.id ?? null,
    })
    .returning();
  const groupNo = `AJN-GRP-${String(row.id).padStart(5, "0")}`;
  const [saved] = await db
    .update(graduationGroupsTable)
    .set({ groupNo, updatedAt: new Date() })
    .where(eq(graduationGroupsTable.id, row.id))
    .returning();
  const joinUrl = `/graduation?group=${token}`;
  const absoluteJoinUrl = `${origin.replace(/\/$/, "")}${joinUrl}`;
  const qrDataUrl = await QRCode.toDataURL(absoluteJoinUrl, {
    width: 320,
    margin: 1,
  });

  await addTimeline(
    saved.id,
    "group_created",
    "تم إنشاء مجموعة التخرج وقفل الإعدادات المشتركة",
    user,
    { groupNo, expectedStudentCount: data.expectedStudentCount },
    "graduation_group",
  );
  await addActivity(
    user,
    "graduation_group_created",
    saved.id,
    { groupNo, expectedStudentCount: data.expectedStudentCount },
    "graduation_group",
  );
  await notify({
    type: "graduation_group_created",
    title: "تم إنشاء طلب تخرج جماعي",
    body: `${saved.title} - ${saved.representativeName}`,
    entityId: saved.id,
    entityType: "graduation_group",
    href: "/admin/graduation/groups",
    metadata: { representativePhone, groupNo },
  });
  if (representativeCustomer)
    await notify({
      audienceType: "customer",
      customerId: representativeCustomer.id,
      type: "graduation_group_created",
      title: "تم إنشاء مجموعة التخرج",
      body: `${saved.title} - رمز المجموعة ${groupNo}`,
      entityId: saved.id,
      entityType: "graduation_group",
      href: joinUrl,
      metadata: { groupNo },
    });
  void sendTelegramMessage(
    `🎓 <b>تم إنشاء مجموعة تخرج</b>\n\nالمجموعة: ${saved.title}\nالرمز: ${groupNo}\nالممثل: ${saved.representativeName}\nالهاتف: ${representativePhone}\nالعدد المتوقع: ${data.expectedStudentCount}\n\n${absoluteJoinUrl}`,
  );

  return {
    group: {
      ...saved,
      groupMeta: groupMeta(saved),
      joinUrl,
      qrDataUrl,
    },
  };
}

async function ensureCustomer(phone: string, name: string) {
  const normalized = normalizeIraqiPhone(phone);
  if (!normalized) throw new Error("رقم الهاتف غير صحيح");
  const existing = await db.query.customersTable.findFirst({
    where: eq(customersTable.phone, normalized),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(customersTable)
    .values({ phone: normalized, name, fullName: name })
    .onConflictDoNothing()
    .returning();
  return (
    created ??
    (await db.query.customersTable.findFirst({
      where: eq(customersTable.phone, normalized),
    }))
  );
}

async function addTimeline(
  entityId: number,
  type: string,
  title: string,
  user?: GraduationAdminUser | null,
  metadata: Record<string, unknown> = {},
  entityType = "graduation_order",
) {
  await db.insert(entityTimelineTable).values({
    entityType,
    entityId,
    type,
    title,
    actorId: user?.id ?? null,
    actorName: user ? user.fullName || user.username : "النظام",
    metadata,
  });
}

async function addActivity(
  user: GraduationAdminUser | null | undefined,
  action: string,
  entityId?: number,
  metadata: Record<string, unknown> = {},
  entityType = "graduation_order",
) {
  await db.insert(adminActivityLogsTable).values({
    staffId: user?.id ?? null,
    userName: user ? user.fullName || user.username : "النظام",
    action,
    entityType,
    entityId: entityId ?? null,
    metadata,
  });
}

async function notify(input: {
  audienceType?: "admin" | "customer" | "staff";
  customerId?: number | null;
  staffId?: number | null;
  type: string;
  title: string;
  body?: string;
  entityId?: number;
  href?: string;
  entityType?: string;
  metadata?: Record<string, unknown>;
}) {
  return db.insert(notificationsTable).values({
    audienceType: input.audienceType ?? "admin",
    customerId: input.customerId ?? null,
    staffId: input.staffId ?? null,
    type: input.type,
    title: input.title,
    body: input.body ?? "",
    entityType: input.entityType ?? "graduation_order",
    entityId: input.entityId ?? null,
    href: input.href ?? null,
    metadata: input.metadata ?? {},
  });
}

async function stockOwner(productId: number) {
  const origin = await db.query.productsTable.findFirst({
    where: eq(productsTable.id, productId),
  });
  if (!origin) return null;
  let current = origin;
  const visited = new Set([origin.id]);
  while (
    current.sharedStockProductId &&
    !visited.has(current.sharedStockProductId)
  ) {
    visited.add(current.sharedStockProductId);
    const next = await db.query.productsTable.findFirst({
      where: eq(productsTable.id, current.sharedStockProductId),
    });
    if (!next) break;
    current = next;
  }
  return { origin, owner: current };
}

async function aggregateByStockOwner(
  items: Array<{ productId: number; quantity: number; label: string }>,
) {
  const grouped = new Map<
    number,
    {
      productId: number;
      stockSourceProductId: number;
      quantity: number;
      label: string;
      available: number;
    }
  >();
  for (const item of items) {
    const resolved = await stockOwner(item.productId);
    if (!resolved) throw new Error(`مادة المخزون غير موجودة: ${item.label}`);
    const key = resolved.owner.id;
    const previous = grouped.get(key);
    grouped.set(key, {
      productId: item.productId,
      stockSourceProductId: key,
      quantity: (previous?.quantity ?? 0) + item.quantity,
      label: previous ? `${previous.label}، ${item.label}` : item.label,
      available: Number(resolved.owner.stock ?? 0),
    });
  }
  return [...grouped.values()];
}

async function applyInventory(
  orderId: number,
  items: Array<{ productId: number; quantity: number; label: string }>,
  direction: -1 | 1,
  user?: GraduationAdminUser | null,
) {
  const grouped = await aggregateByStockOwner(items);
  if (direction < 0) {
    const missing = grouped.find((item) => item.available < item.quantity);
    if (missing)
      throw new Error(
        `المخزون غير كافٍ للمادة: ${missing.label} (المتاح ${missing.available})`,
      );
  }
  await db.transaction(async (tx) => {
    for (const item of grouped) {
      const change = direction * item.quantity;
      const changed = await tx.execute(sql`
        UPDATE products
        SET stock = stock + ${change}, updated_at = now()
        WHERE id = ${item.stockSourceProductId}
          AND (${direction} = 1 OR stock >= ${item.quantity})
        RETURNING id, stock
      `);
      if (!changed.rows?.length) {
        throw new Error(
          `المخزون تغيّر أثناء الحفظ للمادة: ${item.label}، أعد المحاولة`,
        );
      }
      await tx.insert(stockMovementsTable).values({
        productId: item.productId,
        stockSourceProductId: item.stockSourceProductId,
        quantityChange: String(change),
        reason:
          direction < 0
            ? "graduation_order_deducted"
            : "graduation_order_restored",
        relatedType: "graduation_order",
        relatedId: orderId,
        createdBy: user?.id ?? null,
        createdByName: user ? user.fullName || user.username : "النظام",
      });
    }
  });
}

async function createProductionTasks(
  order: any,
  user?: GraduationAdminUser | null,
) {
  const due = order.dueDate ? new Date(`${order.dueDate}T10:00:00`) : null;
  await db
    .insert(tasksTable)
    .values(
      GRADUATION_STAGES.map((stage, index) => ({
        title: `${GRADUATION_STAGE_LABELS[stage]} - ${order.orderNo}`,
        description: `مرحلة إنتاج طلب التخرج للزبون ${order.customerName}`,
        status: index === 0 ? "in_progress" : "new",
        priority: index <= 2 ? "high" : "medium",
        dueAt: due
          ? new Date(
              due.getTime() -
                Math.max(0, GRADUATION_STAGES.length - index - 2) *
                  12 *
                  60 *
                  60 *
                  1000,
            )
          : null,
        assignedStaffIds: order.assignedStaffId ? [order.assignedStaffId] : [],
        relatedType: "graduation_order",
        relatedId: order.id,
        templateKey: `graduation_${stage}`,
        sequence: index + 1,
        autoGenerated: 1,
        notes: "تم إنشاؤها تلقائياً من وحدة تجهيزات التخرج",
        attachments: [],
        createdBy: user?.id ?? null,
      })) as any,
    )
    .onConflictDoNothing();
}

function publicOrder(row: any) {
  return {
    id: row.id,
    orderNo: row.orderNo,
    status: row.status,
    productionStage: row.productionStage,
    stageLabel:
      GRADUATION_STAGE_LABELS[
        row.productionStage as keyof typeof GRADUATION_STAGE_LABELS
      ] ?? row.productionStage,
    customerName: row.customerName,
    styleKey: row.styleKey,
    packageKey: row.packageKey,
    measurements: row.measurements,
    colors: row.colors,
    fabric: row.fabric,
    decoration: row.decoration,
    customText: row.customText,
    accessories: row.accessories,
    previewAssets: row.previewAssets,
    pricing: row.pricing,
    totalAmount: money(row.totalAmount),
    paidAmount: money(row.paidAmount),
    remainingAmount: money(row.remainingAmount),
    paymentStatus: row.paymentStatus,
    qualityChecklist: row.qualityChecklist,
    designApprovedAt: row.designApprovedAt,
    delivery: row.delivery,
    dueDate: row.dueDate,
    createdAt: row.createdAt,
    trackingUrl: `/graduation/track/${row.qrToken}`,
  };
}

async function createInvoice(
  order: any,
  pricing: ReturnType<typeof graduationPriceSummary>,
  user?: GraduationAdminUser | null,
) {
  const [invoice] = await db
    .insert(salesInvoicesTable)
    .values({
      invoiceNo: `GR-TMP-${randomUUID()}`,
      qrToken: order.qrToken,
      date: today(),
      customerName: order.customerName,
      customerPhone: order.phone,
      customerId: order.customerId,
      subtotal: String(pricing.subtotal),
      discountAmount: String(pricing.discount),
      total: String(pricing.total),
      paidAmount: "0",
      remainingAmount: String(pricing.total),
      paymentMethod: "cash",
      paymentStatus: pricing.total > 0 ? "unpaid" : "paid",
      dueDate: order.dueDate ?? null,
      status: "active",
      isInternal: 0,
      stockApplied: 0,
      notes: `فاتورة طلب تجهيزات التخرج ${order.orderNo}`,
      createdBy: user?.id ?? null,
      createdByName: user ? user.fullName || user.username : "الموقع",
    })
    .returning();
  const invoiceNo = `AJN-GR-${String(invoice.id).padStart(6, "0")}`;
  await db
    .update(salesInvoicesTable)
    .set({ invoiceNo })
    .where(eq(salesInvoicesTable.id, invoice.id));
  await db.insert(salesInvoiceItemsTable).values({
    invoiceId: invoice.id,
    productId: null,
    productName: `تجهيزات تخرج - ${order.styleKey}`,
    quantity: "1",
    unitPrice: String(pricing.subtotal),
    discount: String(pricing.discount),
    total: String(pricing.total),
    costPrice: String(pricing.cost),
  });
  return { ...invoice, invoiceNo };
}

async function createOrder(raw: unknown, user?: GraduationAdminUser | null) {
  await ensureGraduationTables();
  const parsed = graduationOrderInputSchema.safeParse(raw);
  if (!parsed.success)
    return {
      response: error(
        "تحقق من بيانات طلب التخرج",
        400,
        parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      ),
    };
  let data = parsed.data;
  const normalizedPhone = normalizeIraqiPhone(data.phone);
  if (!normalizedPhone) return { response: error("رقم الهاتف غير صحيح", 400) };
  const customer = await ensureCustomer(normalizedPhone, data.customerName);
  if (!customer) return { response: error("تعذر إنشاء ملف الزبون", 500) };
  let group: typeof graduationGroupsTable.$inferSelect | null = null;
  if (data.groupToken) {
    group =
      (await db.query.graduationGroupsTable.findFirst({
        where: and(
          or(
            eq(graduationGroupsTable.joinToken, data.groupToken),
            eq(graduationGroupsTable.groupNo, data.groupToken),
          ),
          eq(graduationGroupsTable.status, "open"),
        ),
      })) ?? null;
    if (!group)
      return {
        response: error("رابط أو رمز الطلب الجماعي غير صالح أو مغلق", 404),
      };

    const locked = safeJson(group.defaultConfiguration);
    const lockedMeta = groupMeta(group);
    const lockedCustomText = safeJson(locked.customText);
    const studentCustomText = safeJson(data.customText);
    const lockedFabric = safeJson(locked.fabric);
    const lockedDecoration = safeJson(locked.decoration);
    const lockedUniversity = safeJson(locked.universityTemplate);
    const lockedColors = safeJson(locked.colors);
    const lockedPreview = safeJson(locked.previewAssets);
    data = {
      ...data,
      styleKey: String(locked.styleKey || data.styleKey),
      packageKey:
        String(locked.packageKey || data.packageKey || "") || undefined,
      colors: Object.keys(lockedColors).length ? lockedColors : data.colors,
      fabric: Object.keys(lockedFabric).length
        ? ({
            ...lockedFabric,
            key: String(lockedFabric.key || data.fabric.key),
          } as any)
        : data.fabric,
      decoration: Object.keys(lockedDecoration).length
        ? ({ ...lockedDecoration } as any)
        : data.decoration,
      accessories: Array.isArray(locked.accessories)
        ? locked.accessories.map(String)
        : data.accessories,
      universityTemplate: Object.keys(lockedUniversity).length
        ? lockedUniversity
        : data.universityTemplate,
      previewAssets: Object.keys(lockedPreview).length
        ? lockedPreview
        : data.previewAssets,
      dueDate:
        String(
          lockedMeta.deliveryDate || group.eventDate || data.dueDate || "",
        ) || undefined,
      customText: {
        ...studentCustomText,
        ...lockedCustomText,
        studentName:
          studentCustomText.studentName || data.customerName || undefined,
        department:
          studentCustomText.department || group.department || undefined,
        text: studentCustomText.text || undefined,
        studentId: studentCustomText.studentId || undefined,
        university:
          group.university || lockedCustomText.university || undefined,
        college: group.college || lockedCustomText.college || undefined,
        graduationYear:
          group.graduationYear || lockedCustomText.graduationYear || undefined,
      } as any,
    };
  }
  const config = await getConfig();
  if (!config.styles.some((item) => item.key === data.styleKey))
    return { response: error("نوع التخرج المختار غير متاح", 400) };
  if (!config.fabrics.some((item) => item.key === data.fabric.key))
    return { response: error("نوع القماش المختار غير متاح", 400) };
  const pricing = graduationPriceSummary(data, config);
  const estimate = estimateGraduationProduction(data, config);
  const inventoryItems = graduationInventoryItems(data, config);
  const groupId = group?.id ?? null;
  const decoration = { ...data.decoration } as Record<string, any>;
  if (decoration.file)
    decoration.file = await persistMedia(decoration.file, "graduation/designs");
  const qrToken =
    randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const [draft] = await db
    .insert(graduationOrdersTable)
    .values({
      orderNo: `GR-TMP-${randomUUID()}`,
      qrToken,
      customerId: customer.id,
      groupId,
      customerName: data.customerName,
      phone: normalizedPhone,
      phoneLast4: phoneLast4(normalizedPhone),
      status: data.status,
      productionStage: "new",
      styleKey: data.styleKey,
      packageKey: data.packageKey ?? null,
      measurements: data.measurements as any,
      colors: data.colors as any,
      fabric: data.fabric as any,
      decoration: decoration as any,
      customText: data.customText as any,
      accessories: data.accessories as any,
      universityTemplate: data.universityTemplate as any,
      previewAssets: data.previewAssets as any,
      inventoryItems: inventoryItems as any,
      pricing: pricing as any,
      subtotal: String(pricing.subtotal),
      discountAmount: String(pricing.discount),
      totalAmount: String(pricing.total),
      paidAmount: "0",
      remainingAmount: String(pricing.total),
      paymentMethod: "cash",
      paymentStatus: pricing.total > 0 ? "unpaid" : "paid",
      inventoryApplied: false,
      productionEstimate: estimate as any,
      qualityChecklist: Object.fromEntries(
        QC_KEYS.map((key) => [key, false]),
      ) as any,
      dueDate: data.dueDate ?? null,
      notes: data.notes ?? null,
      submittedAt: data.status === "submitted" ? new Date() : null,
      createdBy: user?.id ?? null,
      createdByName: user ? user.fullName || user.username : "الموقع",
    })
    .returning();
  const orderNo = `AJN-GRAD-${new Date().getFullYear()}-${String(draft.id).padStart(5, "0")}`;
  const [order] = await db
    .update(graduationOrdersTable)
    .set({ orderNo, updatedAt: new Date() })
    .where(eq(graduationOrdersTable.id, draft.id))
    .returning();
  await db
    .insert(qrTokensTable)
    .values({
      entityType: "graduation_order",
      entityId: order.id,
      token: qrToken,
      targetUrl: `/graduation/track/${qrToken}`,
    })
    .onConflictDoNothing();
  let invoice: any = null;
  if (data.status === "submitted") {
    if (inventoryItems.length) {
      await applyInventory(order.id, inventoryItems, -1, user);
      await db
        .update(graduationOrdersTable)
        .set({ inventoryApplied: true })
        .where(eq(graduationOrdersTable.id, order.id));
    }
    invoice = await createInvoice(order, pricing, user);
    await db
      .update(graduationOrdersTable)
      .set({ invoiceId: invoice.id })
      .where(eq(graduationOrdersTable.id, order.id));
    await createProductionTasks(order, user);
    if (decoration.file) {
      await db.insert(entityDocumentsTable).values({
        entityType: "graduation_order",
        entityId: order.id,
        documentType: "design",
        title: decoration.fileName
          ? `تصميم: ${decoration.fileName}`
          : "تصميم الطباعة أو التطريز",
        fileUrl: decoration.file,
        fileName: decoration.fileName || null,
        mimeType: null,
        metadata: {
          decorationType: decoration.type,
          position: decoration.position,
        },
        uploadedBy: user?.id ?? null,
        uploadedByName: user ? user.fullName || user.username : "الزبون",
      });
    }
    await notify({
      type: "graduation_order_new",
      title: "طلب تجهيزات تخرج جديد",
      body: `${orderNo} - ${order.customerName}`,
      entityId: order.id,
      href: "/admin/graduation/orders",
    });
    await notify({
      audienceType: "customer",
      customerId: customer.id,
      type: "graduation_order_created",
      title: "تم استلام طلب التخرج",
      body: `رقم طلبك ${orderNo}`,
      entityId: order.id,
      href: `/graduation/track/${qrToken}`,
    });
    if (group)
      await notify({
        audienceType: "customer",
        customerId: customer.id,
        type: "graduation_group_measurements_confirmed",
        title: "تم تأكيد قياساتك",
        body: `تم ربط قياساتك بمجموعة ${group.title}`,
        entityId: order.id,
        href: `/graduation/track/${qrToken}`,
      });
    void sendTelegramMessage(
      `🎓 <b>طلب تجهيزات تخرج جديد</b>\n\nرقم الطلب: ${orderNo}\nالزبون: ${order.customerName}\nالهاتف: ${normalizedPhone}\nالإجمالي: ${pricing.total.toLocaleString("en-US")} د.ع\n\n${process.env.APP_BASE_URL || ""}/admin/graduation/orders`,
    );
  }
  await addTimeline(
    order.id,
    data.status === "submitted" ? "submitted" : "draft_saved",
    data.status === "submitted" ? "تم إرسال طلب التخرج" : "تم حفظ المسودة",
    user,
    { orderNo },
  );
  await addActivity(user, "graduation_order_created", order.id, {
    orderNo,
    status: data.status,
    total: pricing.total,
  });
  if (group) {
    await addTimeline(
      group.id,
      "student_registered",
      `انضم ${order.customerName} إلى المجموعة`,
      user,
      { orderId: order.id, orderNo, customerId: customer.id },
      "graduation_group",
    );
    await addActivity(
      user,
      "graduation_group_student_registered",
      group.id,
      { orderId: order.id, orderNo, customerId: customer.id },
      "graduation_group",
    );
    await notify({
      type: "graduation_group_student_registered",
      title: "تسجيل طالب في طلب جماعي",
      body: `${group.title} - ${order.customerName}`,
      entityId: group.id,
      entityType: "graduation_group",
      href: "/admin/graduation/groups",
      metadata: { orderId: order.id, orderNo },
    });
  }
  const qrDataUrl = await QRCode.toDataURL(
    `${process.env.APP_BASE_URL || ""}/graduation/track/${qrToken}`,
    { width: 320, margin: 1 },
  );
  return {
    order: {
      ...publicOrder({ ...order, invoiceId: invoice?.id }),
      invoiceId: invoice?.id ?? null,
      qrDataUrl,
    },
  };
}

async function updateOrder(
  order: any,
  raw: unknown,
  user: GraduationAdminUser,
) {
  const parsed = graduationAdminPatchSchema.safeParse(raw);
  if (!parsed.success)
    return {
      response: error("تحقق من بيانات التعديل", 400, parsed.error.issues),
    };
  const data = parsed.data;
  const oldStatus = order.status;
  const oldStage = order.productionStage;
  const total = data.totalAmount ?? money(order.totalAmount);
  const discount = data.discountAmount ?? money(order.discountAmount);
  const paid = Math.min(data.paidAmount ?? money(order.paidAmount), total);
  const remaining = Math.max(0, total - paid);
  const previousTailor = tailorAssignment(order);
  let selectedTailor: any = null;
  let nextProductionEstimate = safeJson(order.productionEstimate);
  if (data.assignedTailorId !== undefined) {
    if (data.assignedTailorId) {
      selectedTailor = await db.query.graduationResourcesTable.findFirst({
        where: and(
          eq(graduationResourcesTable.id, data.assignedTailorId),
          eq(graduationResourcesTable.resourceType, "tailor"),
          eq(graduationResourcesTable.isActive, true),
        ),
      });
      if (!selectedTailor)
        return { response: error("الخياط المختار غير موجود أو غير مفعل", 404) };
    }
    const history = Array.isArray(previousTailor.history)
      ? previousTailor.history
      : [];
    nextProductionEstimate = {
      ...nextProductionEstimate,
      tailorAssignment: data.assignedTailorId
        ? {
            tailorId: selectedTailor.id,
            tailorName: selectedTailor.name,
            assignmentDate:
              Number(previousTailor.tailorId) === Number(selectedTailor.id)
                ? previousTailor.assignmentDate || new Date().toISOString()
                : new Date().toISOString(),
            completionDate: previousTailor.completionDate || null,
            status: data.tailorStatus || previousTailor.status || "new",
            history: [
              ...history,
              {
                tailorId: selectedTailor.id,
                tailorName: selectedTailor.name,
                assignedAt: new Date().toISOString(),
                assignedBy: user.id,
              },
            ].slice(-25),
          }
        : {
            history,
            tailorId: null,
            tailorName: "",
            assignmentDate: null,
            completionDate: null,
            status: "new",
          },
    };
  } else if (data.tailorStatus || data.tailorCompletionDate) {
    nextProductionEstimate = {
      ...nextProductionEstimate,
      tailorAssignment: {
        ...previousTailor,
        ...(data.tailorStatus ? { status: data.tailorStatus } : {}),
        ...(data.tailorCompletionDate
          ? { completionDate: data.tailorCompletionDate }
          : {}),
      },
    };
  }
  if (
    data.productionStage &&
    ["ready", "delivered"].includes(data.productionStage) &&
    Number(previousTailor.tailorId || selectedTailor?.id)
  ) {
    const assignment = safeJson(nextProductionEstimate.tailorAssignment);
    nextProductionEstimate = {
      ...nextProductionEstimate,
      tailorAssignment: {
        ...assignment,
        status: "completed",
        completionDate: assignment.completionDate || new Date().toISOString(),
      },
    };
  } else if (
    data.productionStage === "tailoring" &&
    Number(previousTailor.tailorId || selectedTailor?.id)
  ) {
    nextProductionEstimate = {
      ...nextProductionEstimate,
      tailorAssignment: {
        ...safeJson(nextProductionEstimate.tailorAssignment),
        status: "sewing",
      },
    };
  }
  if (
    data.productionStage &&
    ["ready", "delivered"].includes(data.productionStage)
  ) {
    const checklist = {
      ...safeJson(order.qualityChecklist),
      ...(data.qualityChecklist ?? {}),
    };
    if (!QC_KEYS.every((key) => checklist[key] === true))
      return {
        response: error(
          "أكمل قائمة فحص الجودة قبل نقل الطلب إلى الجاهز أو التسليم",
          409,
        ),
      };
  }
  const update: any = {
    ...(data.status ? { status: data.status } : {}),
    ...(data.productionStage ? { productionStage: data.productionStage } : {}),
    ...(data.totalAmount !== undefined
      ? { totalAmount: String(total), subtotal: String(total + discount) }
      : {}),
    ...(data.discountAmount !== undefined
      ? { discountAmount: String(discount) }
      : {}),
    ...(data.paidAmount !== undefined ? { paidAmount: String(paid) } : {}),
    ...(data.paymentMethod ? { paymentMethod: data.paymentMethod } : {}),
    paymentStatus: remaining <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid",
    remainingAmount: String(remaining),
    ...(data.assignedStaffId !== undefined
      ? { assignedStaffId: data.assignedStaffId }
      : {}),
    ...((data.assignedTailorId !== undefined ||
      data.tailorStatus ||
      data.tailorCompletionDate ||
      data.productionStage) &&
    safeJson(nextProductionEstimate.tailorAssignment).tailorId !== undefined
      ? { productionEstimate: nextProductionEstimate }
      : {}),
    ...(data.dueDate !== undefined ? { dueDate: data.dueDate ?? null } : {}),
    ...(data.notes !== undefined ? { notes: data.notes ?? null } : {}),
    ...(data.internalNotes !== undefined
      ? { internalNotes: data.internalNotes ?? null }
      : {}),
    ...(data.qualityChecklist
      ? {
          qualityChecklist: {
            ...safeJson(order.qualityChecklist),
            ...data.qualityChecklist,
          },
        }
      : {}),
    ...(data.delivery
      ? { delivery: { ...safeJson(order.delivery), ...data.delivery } }
      : {}),
    ...(data.designApproved !== undefined
      ? { designApprovedAt: data.designApproved ? new Date() : null }
      : {}),
    ...(data.productionStage === "ready"
      ? { readyAt: new Date(), status: "ready" }
      : {}),
    ...(data.productionStage === "delivered"
      ? { deliveredAt: new Date(), status: "delivered" }
      : {}),
    updatedAt: new Date(),
  };
  const inventoryItems = Array.isArray(order.inventoryItems)
    ? order.inventoryItems
    : [];
  if (
    data.status === "cancelled" &&
    oldStatus !== "cancelled" &&
    order.inventoryApplied
  ) {
    await applyInventory(order.id, inventoryItems, 1, user);
    update.inventoryApplied = false;
  } else if (
    oldStatus === "cancelled" &&
    data.status &&
    data.status !== "cancelled" &&
    !order.inventoryApplied
  ) {
    await applyInventory(order.id, inventoryItems, -1, user);
    update.inventoryApplied = true;
  }
  const [saved] = await db
    .update(graduationOrdersTable)
    .set(update)
    .where(eq(graduationOrdersTable.id, order.id))
    .returning();
  if (saved.invoiceId) {
    await db
      .update(salesInvoicesTable)
      .set({
        total: String(total),
        discountAmount: String(discount),
        paidAmount: String(paid),
        remainingAmount: String(remaining),
        paymentStatus: update.paymentStatus,
        paymentMethod: data.paymentMethod ?? order.paymentMethod,
        status: saved.status === "cancelled" ? "cancelled" : "active",
        updatedAt: new Date(),
      })
      .where(eq(salesInvoicesTable.id, saved.invoiceId));
    await db
      .update(salesInvoiceItemsTable)
      .set({
        unitPrice: String(total + discount),
        discount: String(discount),
        total: String(total),
      })
      .where(eq(salesInvoiceItemsTable.invoiceId, saved.invoiceId));
  }
  if (data.assignedTailorId !== undefined) {
    const newAssignment = tailorAssignment(saved);
    const action = data.assignedTailorId
      ? Number(previousTailor.tailorId) === Number(data.assignedTailorId)
        ? "tailor_assignment_confirmed"
        : previousTailor.tailorId
          ? "tailor_changed"
          : "tailor_assigned"
      : "tailor_unassigned";
    const title = data.assignedTailorId
      ? previousTailor.tailorId
        ? `تم تغيير الخياط إلى ${newAssignment.tailorName}`
        : `تم تعيين الخياط ${newAssignment.tailorName}`
      : "تم إلغاء تعيين الخياط";
    await addTimeline(saved.id, action, title, user, {
      previousTailorId: previousTailor.tailorId ?? null,
      tailorId: newAssignment.tailorId ?? null,
    });
    await addActivity(user, `graduation_${action}`, saved.id, {
      previousTailorId: previousTailor.tailorId ?? null,
      tailorId: newAssignment.tailorId ?? null,
      orderNo: saved.orderNo,
    });
    if (selectedTailor?.operatorId) {
      await notify({
        audienceType: "staff",
        staffId: selectedTailor.operatorId,
        type: "graduation_tailor_assignment",
        title: "تم تعيين طلب تخرج جديد",
        body: `${saved.orderNo} - ${saved.customerName}`,
        entityId: saved.id,
        href: `/admin/graduation/orders`,
        metadata: { tailorId: selectedTailor.id },
      });
      await db
        .update(tasksTable)
        .set({
          assignedStaffIds: [selectedTailor.operatorId],
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasksTable.relatedType, "graduation_order"),
            eq(tasksTable.relatedId, saved.id),
            inArray(tasksTable.templateKey, [
              "graduation_fabric_cutting",
              "graduation_tailoring",
              "graduation_ironing",
              "graduation_quality_check",
              "graduation_packaging",
            ]),
          ),
        );
    }
  }
  if (
    data.dueDate !== undefined &&
    data.dueDate !== order.dueDate &&
    Number(tailorAssignment(saved).tailorId)
  ) {
    const assignedTailor = await db.query.graduationResourcesTable.findFirst({
      where: eq(
        graduationResourcesTable.id,
        Number(tailorAssignment(saved).tailorId),
      ),
    });
    if (assignedTailor?.operatorId)
      await notify({
        audienceType: "staff",
        staffId: assignedTailor.operatorId,
        type: "graduation_deadline_changed",
        title: "تم تغيير موعد تسليم طلب التخرج",
        body: `${saved.orderNo} - الموعد الجديد ${saved.dueDate || "غير محدد"}`,
        entityId: saved.id,
        href: "/admin/graduation/orders",
      });
  }
  if (
    data.paidAmount !== undefined ||
    (data.status !== undefined && data.status !== oldStatus)
  ) {
    const financialTarget = saved.status === "cancelled" ? 0 : paid;
    const financial = await syncSourcePaymentTarget(
      {
        sourceType: "graduation_order",
        sourceId: saved.id,
        sourceEvent: "payment",
        targetAmount: financialTarget,
        normalDirection: "revenue",
        department: "graduation",
        transactionType: "graduation_payment",
        description: `دفعة طلب تجهيزات التخرج ${saved.orderNo}`,
        paymentMethod: (data.paymentMethod ?? saved.paymentMethod) as any,
        customerId: saved.customerId,
        customerName: saved.customerName,
        customerPhone: saved.phone,
        dueDate: saved.dueDate,
      },
      actor(user),
    );
    update.financialTransactionId = financial?.id ?? null;
    if (financial?.id)
      await db
        .update(graduationOrdersTable)
        .set({ financialTransactionId: financial.id })
        .where(eq(graduationOrdersTable.id, saved.id));
  }
  if (data.productionStage && data.productionStage !== oldStage) {
    const stageIndex = GRADUATION_STAGES.indexOf(data.productionStage);
    await db
      .update(tasksTable)
      .set({ status: "completed", updatedAt: new Date() })
      .where(
        and(
          eq(tasksTable.relatedType, "graduation_order"),
          eq(tasksTable.relatedId, saved.id),
          lte(tasksTable.sequence, stageIndex + 1),
        ),
      );
    await db
      .update(tasksTable)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(
        and(
          eq(tasksTable.relatedType, "graduation_order"),
          eq(tasksTable.relatedId, saved.id),
          eq(tasksTable.sequence, stageIndex + 1),
        ),
      );
    await notify({
      audienceType: "customer",
      customerId: saved.customerId,
      type: "graduation_stage_changed",
      title: "تحديث طلب التخرج",
      body: `أصبح طلبك في مرحلة: ${GRADUATION_STAGE_LABELS[data.productionStage]}`,
      entityId: saved.id,
      href: `/graduation/track/${saved.qrToken}`,
    });
    await addTimeline(
      saved.id,
      "stage_changed",
      `تم نقل الطلب إلى ${GRADUATION_STAGE_LABELS[data.productionStage]}`,
      user,
      { from: oldStage, to: data.productionStage },
    );
    if (saved.groupId) {
      const group = await db.query.graduationGroupsTable.findFirst({
        where: eq(graduationGroupsTable.id, saved.groupId),
      });
      const representative = group
        ? await ensureCustomer(
            group.representativePhone,
            group.representativeName,
          )
        : null;
      if (group && representative && oldStage === "new") {
        const started = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(graduationOrdersTable)
          .where(
            and(
              eq(graduationOrdersTable.groupId, group.id),
              sql`${graduationOrdersTable.productionStage} <> 'new'`,
              sql`${graduationOrdersTable.status} <> 'cancelled'`,
            ),
          );
        if (Number(started[0]?.count ?? 0) === 1)
          await notify({
            audienceType: "customer",
            customerId: representative.id,
            type: "graduation_group_production_started",
            title: "بدأ إنتاج مجموعة التخرج",
            body: group.title,
            entityId: group.id,
            entityType: "graduation_group",
            href: `/graduation?group=${group.joinToken}`,
          });
      }
      if (
        group &&
        representative &&
        ["ready", "delivered"].includes(data.productionStage)
      ) {
        const pending = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(graduationOrdersTable)
          .where(
            and(
              eq(graduationOrdersTable.groupId, group.id),
              sql`${graduationOrdersTable.productionStage} not in ('ready','delivered')`,
              sql`${graduationOrdersTable.status} <> 'cancelled'`,
            ),
          );
        if (Number(pending[0]?.count ?? 0) === 0)
          await notify({
            audienceType: "customer",
            customerId: representative.id,
            type: "graduation_group_production_completed",
            title: "اكتمل إنتاج مجموعة التخرج",
            body: `${group.title} جاهزة للاستلام`,
            entityId: group.id,
            entityType: "graduation_group",
            href: `/graduation?group=${group.joinToken}`,
          });
      }
    }
  }
  if (data.delivery) {
    const deliveryStatus = String(data.delivery.status ?? "assigned");
    const labels: Record<string, string> = {
      pending: "بانتظار تعيين موظف",
      assigned: "تم تعيين موظف التسليم",
      out_for_delivery: "طلبك في طريقه إليك",
      delivered: "تم تسليم طلبك",
    };
    await notify({
      audienceType: "customer",
      customerId: saved.customerId,
      type: "graduation_delivery_updated",
      title: "تحديث تسليم طلب التخرج",
      body: labels[deliveryStatus] || "تم تحديث بيانات التسليم",
      entityId: saved.id,
      href: `/graduation/track/${saved.qrToken}`,
    });
    await addTimeline(
      saved.id,
      "delivery_updated",
      labels[deliveryStatus] || "تم تحديث بيانات التسليم",
      user,
      { delivery: data.delivery },
    );
  }
  await addActivity(user, "graduation_order_updated", saved.id, {
    oldStatus,
    newStatus: saved.status,
    oldStage,
    newStage: saved.productionStage,
    total,
    paid,
    remaining,
  });
  return { order: publicOrder(saved) };
}

async function orderDetail(id: number, origin = "") {
  const [order] = await db
    .select()
    .from(graduationOrdersTable)
    .where(eq(graduationOrdersTable.id, id))
    .limit(1);
  if (!order) return null;
  const assignment = tailorAssignment(order);
  const [timeline, tasks, invoice, group, tailor] = await Promise.all([
    db
      .select()
      .from(entityTimelineTable)
      .where(
        and(
          eq(entityTimelineTable.entityType, "graduation_order"),
          eq(entityTimelineTable.entityId, id),
        ),
      )
      .orderBy(desc(entityTimelineTable.createdAt)),
    db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.relatedType, "graduation_order"),
          eq(tasksTable.relatedId, id),
        ),
      )
      .orderBy(asc(tasksTable.sequence)),
    order.invoiceId
      ? db.query.salesInvoicesTable.findFirst({
          where: eq(salesInvoicesTable.id, order.invoiceId),
        })
      : null,
    order.groupId
      ? db.query.graduationGroupsTable.findFirst({
          where: eq(graduationGroupsTable.id, order.groupId),
        })
      : null,
    Number(assignment.tailorId)
      ? db.query.graduationResourcesTable.findFirst({
          where: eq(graduationResourcesTable.id, Number(assignment.tailorId)),
        })
      : null,
  ]);
  const qrUrl = `${origin || process.env.APP_BASE_URL || ""}/graduation/track/${order.qrToken}`;
  const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 360, margin: 1 });
  return {
    ...publicOrder(order),
    qrDataUrl,
    internalNotes: order.internalNotes,
    assignedStaffId: order.assignedStaffId,
    inventoryItems: order.inventoryItems,
    productionEstimate: order.productionEstimate,
    tailorAssignment: {
      ...assignment,
      profile: tailor ? safeJson(tailor.metrics) : null,
    },
    group: group
      ? {
          id: group.id,
          groupNo: group.groupNo,
          title: group.title,
          university: group.university,
          college: group.college,
          department: group.department,
        }
      : null,
    invoice,
    timeline,
    tasks,
  };
}

function orderFilters(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") || 1));
  const limit = Math.min(100, Math.max(10, Number(sp.get("limit") || 25)));
  const search = (sp.get("search") || "").trim();
  const status = (sp.get("status") || "").trim();
  const stage = (sp.get("stage") || "").trim();
  const conditions: any[] = [sql`${graduationOrdersTable.archivedAt} is null`];
  if (search)
    conditions.push(
      or(
        ilike(graduationOrdersTable.customerName, `%${search}%`),
        ilike(graduationOrdersTable.phone, `%${normalizePhoneDigits(search)}%`),
        ilike(graduationOrdersTable.orderNo, `%${search}%`),
      ),
    );
  if (status) conditions.push(eq(graduationOrdersTable.status, status));
  if (stage) conditions.push(eq(graduationOrdersTable.productionStage, stage));
  return { page, limit, where: and(...conditions) };
}

async function openAiJson(messages: any[]) {
  const key = process.env.OPENAI_API_KEY;
  if (!key)
    throw new Error("ميزة الذكاء الاصطناعي غير مفعلة في إعدادات الخادم");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  const payload = (await response.json()) as any;
  if (!response.ok)
    throw new Error(payload?.error?.message || "تعذر تشغيل التحليل الذكي");
  return JSON.parse(payload?.choices?.[0]?.message?.content || "{}");
}

export async function handleGraduationPublic(
  req: NextRequest,
  parts: string[],
): Promise<NextResponse | null> {
  await ensureGraduationTables();
  const method = req.method;
  const resource = parts[1] ?? "config";
  if (method === "GET" && resource === "config") {
    const config = await getConfig();
    return json({
      ...config,
      aiAvailable: Boolean(process.env.OPENAI_API_KEY) && config.aiEnabled,
    });
  }
  if (method === "POST" && resource === "orders") {
    const result = await createOrder(await requestBody(req));
    return result.response ?? json(result, 201);
  }
  if (method === "GET" && resource === "track" && parts[2]) {
    const order = await db.query.graduationOrdersTable.findFirst({
      where: eq(graduationOrdersTable.qrToken, parts[2]),
    });
    if (!order) return error("طلب التخرج غير موجود", 404);
    const timeline = await db
      .select()
      .from(entityTimelineTable)
      .where(
        and(
          eq(entityTimelineTable.entityType, "graduation_order"),
          eq(entityTimelineTable.entityId, order.id),
        ),
      )
      .orderBy(asc(entityTimelineTable.createdAt));
    const qrDataUrl = await QRCode.toDataURL(
      `${req.nextUrl.origin}/graduation/track/${order.qrToken}`,
      { width: 300, margin: 1 },
    );
    return json({
      order: publicOrder(order),
      timeline: timeline.map((row) => ({
        type: row.type,
        title: row.title,
        body: row.body,
        createdAt: row.createdAt,
      })),
      qrDataUrl,
    });
  }
  if (
    method === "POST" &&
    resource === "track" &&
    parts[2] &&
    parts[3] === "approve-design"
  ) {
    const order = await db.query.graduationOrdersTable.findFirst({
      where: eq(graduationOrdersTable.qrToken, parts[2]),
    });
    if (!order) return error("طلب التخرج غير موجود", 404);
    const [saved] = await db
      .update(graduationOrdersTable)
      .set({ designApprovedAt: new Date(), updatedAt: new Date() })
      .where(eq(graduationOrdersTable.id, order.id))
      .returning();
    await addTimeline(order.id, "design_approved", "وافق الزبون على التصميم");
    return json({ order: publicOrder(saved) });
  }
  if (method === "POST" && resource === "groups") {
    const result = await createGraduationGroup(
      await requestBody(req),
      null,
      req.nextUrl.origin,
    );
    return result.response ?? json(result, 201);
  }
  if (method === "GET" && resource === "groups" && parts[2]) {
    const identifier = decodeURIComponent(parts[2]);
    const group = await db.query.graduationGroupsTable.findFirst({
      where: and(
        or(
          eq(graduationGroupsTable.joinToken, identifier),
          eq(graduationGroupsTable.groupNo, identifier.toUpperCase()),
        ),
        eq(graduationGroupsTable.status, "open"),
      ),
    });
    if (!group) return error("رابط الطلب الجماعي غير صالح أو مغلق", 404);
    return json({
      group: {
        title: group.title,
        university: group.university,
        college: group.college,
        department: group.department,
        graduationYear: group.graduationYear,
        eventDate: group.eventDate,
        defaultConfiguration: group.defaultConfiguration,
        joinToken: group.joinToken,
        groupNo: group.groupNo,
        representativeName: group.representativeName,
        groupMeta: groupMeta(group),
      },
    });
  }
  if (method === "POST" && resource === "ai" && parts[2] === "size") {
    const data = await requestBody(req);
    if (!data?.image) return error("ارفع صورة واضحة للجسم بالكامل", 400);
    try {
      const result = await openAiJson([
        {
          role: "system",
          content:
            "Estimate graduation gown measurements conservatively from the image. Return JSON: height, shoulder, sleeveLength, suggestedSize, confidence (0..1), noteArabic. Never identify the person.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Known height if supplied: ${data.height || "unknown"}. Return metric centimeters.`,
            },
            { type: "image_url", image_url: { url: data.image } },
          ],
        },
      ]);
      return json({
        ...result,
        suggestedSize:
          result.suggestedSize || recommendedGraduationSize(result),
      });
    } catch (err: any) {
      return error(err?.message || "تعذر تقدير القياسات", 502);
    }
  }
  if (method === "POST" && resource === "ai" && parts[2] === "designer") {
    const data = await requestBody(req);
    if (!String(data?.prompt ?? "").trim())
      return error("اكتب وصف التصميم المطلوب", 400);
    try {
      const config = await getConfig();
      const result = await openAiJson([
        {
          role: "system",
          content: `You design graduation robes for AJN. Return JSON {concepts:[{nameAr,descriptionAr,styleKey,robeColor,sashColor,capColor,tasselColor,embroideryColor,fabricKey,decorationType,decorationPosition}]}. Exactly 3 practical concepts. Only use style keys: ${config.styles.map((x) => x.key).join(",")} and fabric keys: ${config.fabrics.map((x) => x.key).join(",")}.`,
        },
        { role: "user", content: String(data.prompt) },
      ]);
      return json(result);
    } catch (err: any) {
      return error(err?.message || "تعذر إنشاء التصاميم", 502);
    }
  }
  if (method === "POST" && resource === "ai" && parts[2] === "try-on") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return error("ميزة المعاينة الافتراضية غير مفعلة في الخادم", 503);
    const data = await requestBody(req);
    const parsed = parseDataUrl(String(data?.image ?? ""));
    if (!parsed || !parsed.mime.startsWith("image/"))
      return error("ارفع صورة شخصية واضحة", 400);
    const colors = safeJson(data?.colors);
    const prompt = [
      "Edit this photo into a realistic graduation outfit preview while preserving the person's identity, face, pose, body proportions and background.",
      `Graduation robe style: ${String(data?.styleName ?? "standard")}.`,
      `Robe color ${String(colors.robe ?? "black")}, sash ${String(colors.sash ?? "gold")}, cap ${String(colors.cap ?? "black")}, tassel ${String(colors.tassel ?? "gold")}.`,
      "The result must be a respectful, photorealistic full-body product try-on without adding text, logos or changing the person's appearance.",
    ].join(" ");
    try {
      const form = new FormData();
      form.set("model", "gpt-image-1");
      form.set(
        "image",
        new Blob([new Uint8Array(parsed.bytes)], { type: parsed.mime }),
        `try-on.${storageExtension(parsed.mime)}`,
      );
      form.set("prompt", prompt);
      form.set("size", "1024x1536");
      form.set("quality", "medium");
      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: form,
      });
      const payload = (await response.json()) as any;
      if (!response.ok || !payload?.data?.[0]?.b64_json)
        throw new Error(payload?.error?.message || "لم ترجع خدمة الصور نتيجة");
      const imageUrl = await persistMedia(
        `data:image/png;base64,${payload.data[0].b64_json}`,
        "graduation/try-on",
      );
      return json({ imageUrl });
    } catch (err: any) {
      return error(err?.message || "تعذر إنشاء المعاينة الافتراضية", 502);
    }
  }
  return null;
}

export async function handleAdminGraduation(
  req: NextRequest,
  parts: string[],
  user: GraduationAdminUser,
): Promise<NextResponse | null> {
  await Promise.all([ensureGraduationTables(), ensureMasterCashBoxTables()]);
  const method = req.method;
  const resource = parts[0] ?? "dashboard";

  if (method === "GET" && resource === "dashboard") {
    const [stageRows, totals, delayed, resources, todayCount] =
      await Promise.all([
        db
          .select({
            stage: graduationOrdersTable.productionStage,
            count: sql<number>`count(*)::int`,
          })
          .from(graduationOrdersTable)
          .where(
            sql`${graduationOrdersTable.archivedAt} is null and ${graduationOrdersTable.status} <> 'cancelled'`,
          )
          .groupBy(graduationOrdersTable.productionStage),
        db
          .select({
            revenue: sql<number>`coalesce(sum(${graduationOrdersTable.totalAmount}::numeric),0)::float`,
            paid: sql<number>`coalesce(sum(${graduationOrdersTable.paidAmount}::numeric),0)::float`,
            profit: sql<number>`coalesce(sum((${graduationOrdersTable.pricing}->>'profit')::numeric),0)::float`,
            orders: sql<number>`count(*)::int`,
          })
          .from(graduationOrdersTable)
          .where(
            sql`${graduationOrdersTable.archivedAt} is null and ${graduationOrdersTable.status} <> 'cancelled'`,
          ),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(graduationOrdersTable)
          .where(
            sql`${graduationOrdersTable.dueDate} < current_date and ${graduationOrdersTable.productionStage} not in ('ready','delivered') and ${graduationOrdersTable.status} <> 'cancelled'`,
          ),
        db
          .select({
            type: graduationResourcesTable.resourceType,
            status: graduationResourcesTable.status,
            count: sql<number>`count(*)::int`,
          })
          .from(graduationResourcesTable)
          .where(eq(graduationResourcesTable.isActive, true))
          .groupBy(
            graduationResourcesTable.resourceType,
            graduationResourcesTable.status,
          ),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(graduationOrdersTable)
          .where(sql`date(${graduationOrdersTable.createdAt}) = current_date`),
      ]);
    const total = totals[0] ?? { revenue: 0, paid: 0, profit: 0, orders: 0 };
    const stages = Object.fromEntries(
      stageRows.map((row) => [row.stage, row.count]),
    );
    const recommendations = [
      ...(Number(delayed[0]?.count ?? 0) > 0
        ? [`يوجد ${delayed[0]?.count} طلب متأخر يحتاج إعادة جدولة`]
        : []),
      ...(Number(stages.quality_check ?? 0) > 5
        ? ["طابور فحص الجودة مرتفع؛ خصص موظفاً إضافياً"]
        : []),
      ...(resources.some((row) => row.status === "maintenance")
        ? ["توجد معدات إنتاج في الصيانة؛ راجع الطاقة المتاحة"]
        : []),
    ];
    return json({
      cards: {
        today: todayCount[0]?.count ?? 0,
        inProduction: stageRows
          .filter((r) => !["new", "ready", "delivered"].includes(r.stage))
          .reduce((s, r) => s + r.count, 0),
        ready: stages.ready ?? 0,
        delayed: delayed[0]?.count ?? 0,
        revenue: money(total.revenue),
        paid: money(total.paid),
        profit: money(total.profit),
        orders: total.orders,
      },
      stages,
      resources,
      recommendations,
    });
  }
  if (method === "GET" && resource === "orders") {
    if (parts[1]) {
      const detail = await orderDetail(Number(parts[1]), req.nextUrl.origin);
      return detail
        ? json({ order: detail })
        : error("طلب التخرج غير موجود", 404);
    }
    const { page, limit, where } = orderFilters(req);
    const [rows, count] = await Promise.all([
      db
        .select()
        .from(graduationOrdersTable)
        .where(where)
        .orderBy(desc(graduationOrdersTable.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(graduationOrdersTable)
        .where(where),
    ]);
    return json({
      items: rows.map(publicOrder),
      page,
      limit,
      total: count[0]?.count ?? 0,
    });
  }
  if (
    (method === "PATCH" || method === "PUT") &&
    resource === "orders" &&
    parts[1]
  ) {
    const order = await db.query.graduationOrdersTable.findFirst({
      where: eq(graduationOrdersTable.id, Number(parts[1])),
    });
    if (!order) return error("طلب التخرج غير موجود", 404);
    const result = await updateOrder(order, await requestBody(req), user);
    return result.response ?? json(result);
  }
  if (method === "POST" && resource === "orders") {
    const result = await createOrder(await requestBody(req), user);
    return result.response ?? json(result, 201);
  }
  if (method === "GET" && resource === "production") {
    const allRows = await db
      .select()
      .from(graduationOrdersTable)
      .where(
        sql`${graduationOrdersTable.archivedAt} is null and ${graduationOrdersTable.status} not in ('cancelled','delivered')`,
      )
      .orderBy(
        asc(graduationOrdersTable.dueDate),
        desc(graduationOrdersTable.createdAt),
      );
    const requestedTailorId = Number(
      req.nextUrl.searchParams.get("tailorId") || 0,
    );
    const rows = requestedTailorId
      ? allRows.filter(
          (row) => Number(tailorAssignment(row).tailorId) === requestedTailorId,
        )
      : allRows;
    const groupIds = [
      ...new Set(
        rows
          .map((row) => Number(row.groupId))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];
    const groups = groupIds.length
      ? await db
          .select()
          .from(graduationGroupsTable)
          .where(inArray(graduationGroupsTable.id, groupIds))
      : [];
    const groupMap = new Map(groups.map((group) => [group.id, group]));
    const enriched = rows.map((row) => {
      const group = row.groupId ? groupMap.get(row.groupId) : null;
      return {
        ...publicOrder(row),
        groupId: row.groupId,
        group: group
          ? {
              id: group.id,
              groupNo: group.groupNo,
              title: group.title,
              university: group.university,
              college: group.college,
              department: group.department,
            }
          : null,
        tailorAssignment: tailorAssignment(row),
        preferredSize: String(
          safeJson(row.measurements).suggestedSize ||
            safeJson(row.measurements).preferredSize ||
            "",
        ),
      };
    });
    return json({
      columns: GRADUATION_STAGES.map((stage) => ({
        stage,
        label: GRADUATION_STAGE_LABELS[stage],
        items: enriched.filter((row) => row.productionStage === stage),
      })),
    });
  }
  if (method === "GET" && resource === "customers") {
    const rows = await db
      .select({
        customerId: graduationOrdersTable.customerId,
        name: graduationOrdersTable.customerName,
        phone: graduationOrdersTable.phone,
        orders: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${graduationOrdersTable.totalAmount}::numeric),0)::float`,
        paid: sql<number>`coalesce(sum(${graduationOrdersTable.paidAmount}::numeric),0)::float`,
        lastOrderAt: sql<Date>`max(${graduationOrdersTable.createdAt})`,
      })
      .from(graduationOrdersTable)
      .groupBy(
        graduationOrdersTable.customerId,
        graduationOrdersTable.customerName,
        graduationOrdersTable.phone,
      )
      .orderBy(desc(sql`max(${graduationOrdersTable.createdAt})`));
    return json({
      items: rows.map((row) => ({
        ...row,
        total: money(row.total),
        paid: money(row.paid),
        remaining: money(row.total) - money(row.paid),
      })),
    });
  }
  if (resource === "groups") {
    if (method === "GET") {
      const [groups, orders] = await Promise.all([
        db
          .select()
          .from(graduationGroupsTable)
          .orderBy(desc(graduationGroupsTable.createdAt)),
        db
          .select({
            groupId: graduationOrdersTable.groupId,
            stage: graduationOrdersTable.productionStage,
            status: graduationOrdersTable.status,
          })
          .from(graduationOrdersTable)
          .where(sql`${graduationOrdersTable.groupId} is not null`),
      ]);
      return json({
        items: groups.map((group) => {
          const members = orders.filter((order) => order.groupId === group.id);
          const meta = groupMeta(group);
          const expected = Math.max(
            Number(meta.expectedStudentCount ?? members.length),
            members.length,
          );
          const registered = members.length;
          const averageProgress = registered
            ? Math.round(
                members.reduce(
                  (sum, order) => sum + graduationStageProgress(order.stage),
                  0,
                ) / registered,
              )
            : 0;
          return {
            ...group,
            groupMeta: meta,
            joinUrl: `/graduation?group=${group.joinToken}`,
            stats: {
              expected,
              registered,
              pending: Math.max(0, expected - registered),
              productionProgress: averageProgress,
              printingProgress: registered
                ? Math.round(
                    (members.filter(
                      (order) =>
                        GRADUATION_STAGES.indexOf(order.stage as any) >=
                        GRADUATION_STAGES.indexOf("printing"),
                    ).length /
                      registered) *
                      100,
                  )
                : 0,
              embroideryProgress: registered
                ? Math.round(
                    (members.filter(
                      (order) =>
                        GRADUATION_STAGES.indexOf(order.stage as any) >=
                        GRADUATION_STAGES.indexOf("embroidery"),
                    ).length /
                      registered) *
                      100,
                  )
                : 0,
              delivered: members.filter((order) => order.stage === "delivered")
                .length,
            },
          };
        }),
      });
    }
    if (method === "POST") {
      const result = await createGraduationGroup(
        await requestBody(req),
        user,
        req.nextUrl.origin,
      );
      return result.response ?? json(result, 201);
    }
    if ((method === "PATCH" || method === "PUT") && parts[1]) {
      const data = await requestBody(req);
      const existing = await db.query.graduationGroupsTable.findFirst({
        where: eq(graduationGroupsTable.id, Number(parts[1])),
      });
      if (!existing) return error("المجموعة غير موجودة", 404);
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (["open", "closed", "completed"].includes(String(data?.status)))
        update.status = String(data.status);
      if (String(data?.title ?? "").trim())
        update.title = String(data.title).trim();
      if (data?.eventDate !== undefined)
        update.eventDate = data.eventDate || null;
      if (data?.defaultConfiguration !== undefined)
        update.defaultConfiguration = safeJson(data.defaultConfiguration);
      const [saved] = await db
        .update(graduationGroupsTable)
        .set(update as any)
        .where(eq(graduationGroupsTable.id, Number(parts[1])))
        .returning();
      if (saved) {
        await addTimeline(
          saved.id,
          "group_updated",
          saved.status === "closed"
            ? "تم إغلاق تسجيل المجموعة"
            : "تم تحديث المجموعة",
          user,
          { previousStatus: existing.status, status: saved.status },
          "graduation_group",
        );
        await addActivity(
          user,
          "graduation_group_updated",
          saved.id,
          { previousStatus: existing.status, status: saved.status },
          "graduation_group",
        );
      }
      return saved ? json({ group: saved }) : error("المجموعة غير موجودة", 404);
    }
  }
  if (resource === "resources") {
    if (method === "GET") {
      const type = req.nextUrl.searchParams.get("type");
      const rows = await db
        .select()
        .from(graduationResourcesTable)
        .where(
          type ? eq(graduationResourcesTable.resourceType, type) : undefined,
        )
        .orderBy(
          asc(graduationResourcesTable.resourceType),
          asc(graduationResourcesTable.name),
        );
      if (type === "tailor") {
        const orders = await db
          .select()
          .from(graduationOrdersTable)
          .where(sql`${graduationOrdersTable.status} <> 'cancelled'`);
        const now = Date.now();
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const weekStart = new Date(dayStart);
        weekStart.setDate(weekStart.getDate() - 6);
        const monthStart = new Date(dayStart);
        monthStart.setDate(1);
        return json({
          items: rows.map((row) => {
            const assigned = orders.filter(
              (order) =>
                Number(tailorAssignment(order).tailorId) === Number(row.id),
            );
            const completed = assigned.filter((order) =>
              ["ready", "delivered"].includes(order.productionStage),
            );
            const delayed = assigned.filter(
              (order) =>
                Boolean(order.dueDate) &&
                new Date(`${order.dueDate}T23:59:59`).getTime() < now &&
                !["ready", "delivered"].includes(order.productionStage),
            );
            const completionHours = completed
              .map((order) => {
                const end =
                  order.deliveredAt ?? order.readyAt ?? order.updatedAt;
                return Math.max(
                  0,
                  (new Date(end).getTime() -
                    new Date(order.createdAt).getTime()) /
                    3_600_000,
                );
              })
              .filter(Number.isFinite);
            const qualityIssues = assigned.filter((order) => {
              const checklist = safeJson(order.qualityChecklist);
              return (
                Object.keys(checklist).length > 0 &&
                Object.values(checklist).some((value) => value === false)
              );
            }).length;
            const completionRate = assigned.length
              ? (completed.length / assigned.length) * 100
              : 0;
            const delayRate = assigned.length
              ? (delayed.length / assigned.length) * 100
              : 0;
            const qualityRate = assigned.length
              ? (qualityIssues / assigned.length) * 100
              : 0;
            const productivityScore = Math.max(
              0,
              Math.min(
                100,
                Math.round(
                  55 +
                    completionRate * 0.45 -
                    delayRate * 0.35 -
                    qualityRate * 0.2,
                ),
              ),
            );
            const completedAfter = (date: Date) =>
              completed.filter((order) => {
                const end =
                  order.deliveredAt ?? order.readyAt ?? order.updatedAt;
                return new Date(end).getTime() >= date.getTime();
              }).length;
            return {
              ...row,
              profile: safeJson(row.metrics),
              stats: {
                totalOrders: assigned.length,
                assignedOrders: assigned.filter(
                  (order) =>
                    !["ready", "delivered"].includes(order.productionStage),
                ).length,
                inProgress: assigned.filter(
                  (order) =>
                    !["new", "ready", "delivered"].includes(
                      order.productionStage,
                    ),
                ).length,
                completed: completed.length,
                delayed: delayed.length,
                dailyProduction: completedAfter(dayStart),
                weeklyProduction: completedAfter(weekStart),
                monthlyProduction: completedAfter(monthStart),
                averageCompletionHours: completionHours.length
                  ? Math.round(
                      completionHours.reduce((sum, value) => sum + value, 0) /
                        completionHours.length,
                    )
                  : 0,
                delayRate: Math.round(delayRate),
                qualityIssues,
                productivityScore,
              },
            };
          }),
        });
      }
      return json({ items: rows });
    }
    if (method === "POST") {
      const data = await requestBody(req);
      if (String(data?.resourceType) === "tailor") {
        const parsed = graduationTailorInputSchema.safeParse(data);
        if (!parsed.success)
          return error("تحقق من بيانات الخياط", 400, parsed.error.issues);
        const profile = parsed.data;
        const phone = profile.phone ? normalizeIraqiPhone(profile.phone) : null;
        if (profile.phone && !phone)
          return error("رقم هاتف الخياط غير صحيح", 400);
        const photoUrl = profile.photoUrl
          ? await persistMedia(profile.photoUrl, "graduation/tailors")
          : "";
        const [tailor] = await db
          .insert(graduationResourcesTable)
          .values({
            resourceType: "tailor",
            code: profile.code || `TLR-${Date.now()}`,
            name: profile.name,
            operatorId: profile.operatorId ?? null,
            operatorName: profile.name,
            status: profile.status,
            metrics: {
              phone,
              address: profile.address,
              specialization: profile.specialization,
              dailyCapacity: profile.dailyCapacity,
              photoUrl,
            },
            notes: profile.notes || null,
            isActive: profile.isActive && profile.status !== "inactive",
            createdBy: user.id,
          })
          .returning();
        await addActivity(
          user,
          "graduation_tailor_created",
          tailor.id,
          { name: tailor.name, status: tailor.status },
          "graduation_tailor",
        );
        return json(
          { resource: { ...tailor, profile: safeJson(tailor.metrics) } },
          201,
        );
      }
      if (
        !String(data?.name ?? "").trim() ||
        !["fabric_roll", "sewing_machine", "heat_press"].includes(
          String(data?.resourceType),
        )
      )
        return error("الاسم ونوع مورد الإنتاج مطلوبان", 400);
      const [row] = await db
        .insert(graduationResourcesTable)
        .values({
          resourceType: data.resourceType,
          code: String(data.code ?? "").trim() || `GRR-${Date.now()}`,
          name: String(data.name).trim(),
          productId: Number(data.productId) || null,
          operatorId: Number(data.operatorId) || null,
          operatorName: String(data.operatorName ?? "").trim(),
          status: data.status || "available",
          metrics: safeJson(data.metrics) as any,
          usageCount: Number(data.usageCount) || 0,
          maintenanceDueAt: data.maintenanceDueAt
            ? new Date(data.maintenanceDueAt)
            : null,
          notes: String(data.notes ?? "").trim() || null,
          createdBy: user.id,
        })
        .returning();
      return json({ resource: row }, 201);
    }
    if ((method === "PATCH" || method === "PUT") && parts[1]) {
      const data = await requestBody(req);
      const existing = await db.query.graduationResourcesTable.findFirst({
        where: eq(graduationResourcesTable.id, Number(parts[1])),
      });
      if (!existing) return error("مورد الإنتاج غير موجود", 404);
      if (existing.resourceType === "tailor") {
        const current = safeJson(existing.metrics);
        const parsed = graduationTailorInputSchema.safeParse({
          name: data?.name ?? existing.name,
          code: data?.code ?? existing.code,
          phone: data?.phone ?? current.phone ?? "",
          address: data?.address ?? current.address ?? "",
          specialization: data?.specialization ?? current.specialization ?? "",
          dailyCapacity: data?.dailyCapacity ?? current.dailyCapacity ?? 1,
          status: data?.status ?? existing.status,
          notes: data?.notes ?? existing.notes ?? "",
          photoUrl: data?.photoUrl ?? current.photoUrl ?? "",
          operatorId: data?.operatorId ?? existing.operatorId,
          isActive: data?.isActive ?? existing.isActive,
        });
        if (!parsed.success)
          return error("تحقق من بيانات الخياط", 400, parsed.error.issues);
        const profile = parsed.data;
        const phone = profile.phone ? normalizeIraqiPhone(profile.phone) : null;
        if (profile.phone && !phone)
          return error("رقم هاتف الخياط غير صحيح", 400);
        const photoUrl = profile.photoUrl
          ? await persistMedia(profile.photoUrl, "graduation/tailors")
          : "";
        const [tailor] = await db
          .update(graduationResourcesTable)
          .set({
            code: profile.code || existing.code,
            name: profile.name,
            operatorId: profile.operatorId ?? null,
            operatorName: profile.name,
            status: profile.status,
            metrics: {
              phone,
              address: profile.address,
              specialization: profile.specialization,
              dailyCapacity: profile.dailyCapacity,
              photoUrl,
            },
            notes: profile.notes || null,
            isActive: profile.isActive && profile.status !== "inactive",
            updatedAt: new Date(),
          })
          .where(eq(graduationResourcesTable.id, existing.id))
          .returning();
        await addActivity(
          user,
          "graduation_tailor_updated",
          tailor.id,
          {
            previousStatus: existing.status,
            status: tailor.status,
            isActive: tailor.isActive,
          },
          "graduation_tailor",
        );
        return json({
          resource: { ...tailor, profile: safeJson(tailor.metrics) },
        });
      }
      const [row] = await db
        .update(graduationResourcesTable)
        .set({
          ...data,
          maintenanceDueAt: data.maintenanceDueAt
            ? new Date(data.maintenanceDueAt)
            : null,
          updatedAt: new Date(),
        } as any)
        .where(eq(graduationResourcesTable.id, Number(parts[1])))
        .returning();
      return row
        ? json({ resource: row })
        : error("مورد الإنتاج غير موجود", 404);
    }
  }
  if (method === "GET" && resource === "settings")
    return json({ config: await getConfig() });
  if ((method === "PUT" || method === "PATCH") && resource === "settings") {
    const payload = await requestBody(req);
    const config = await saveConfig(payload?.config ?? payload);
    await addActivity(user, "graduation_settings_updated", undefined, {
      styles: config.styles.length,
      fabrics: config.fabrics.length,
      accessories: config.accessories.length,
    });
    return json({ config });
  }
  if (method === "GET" && resource === "reports") {
    const from =
      req.nextUrl.searchParams.get("from") ||
      `${new Date().getFullYear()}-01-01`;
    const to = req.nextUrl.searchParams.get("to") || today();
    const rows = await db
      .select()
      .from(graduationOrdersTable)
      .where(
        and(
          gte(graduationOrdersTable.createdAt, new Date(`${from}T00:00:00`)),
          lte(graduationOrdersTable.createdAt, new Date(`${to}T23:59:59`)),
          sql`${graduationOrdersTable.status} <> 'cancelled'`,
        ),
      )
      .orderBy(desc(graduationOrdersTable.createdAt));
    const styleMap = new Map<
      string,
      { style: string; count: number; revenue: number }
    >();
    for (const row of rows) {
      const current = styleMap.get(row.styleKey) ?? {
        style: row.styleKey,
        count: 0,
        revenue: 0,
      };
      current.count += 1;
      current.revenue += money(row.totalAmount);
      styleMap.set(row.styleKey, current);
    }
    return json({
      from,
      to,
      items: rows.map(publicOrder),
      totals: {
        orders: rows.length,
        revenue: rows.reduce((s, r) => s + money(r.totalAmount), 0),
        paid: rows.reduce((s, r) => s + money(r.paidAmount), 0),
        remaining: rows.reduce((s, r) => s + money(r.remainingAmount), 0),
        profit: rows.reduce((s, r) => s + money(safeJson(r.pricing).profit), 0),
        fabricMeters: rows.reduce(
          (s, r) => s + money(safeJson(r.productionEstimate).fabricMeters),
          0,
        ),
      },
      styles: [...styleMap.values()].sort((a, b) => b.count - a.count),
    });
  }
  if (method === "GET" && resource === "staff-options") {
    const rows = await db
      .select({
        id: staffTable.id,
        name: staffTable.fullName,
        role: staffTable.role,
      })
      .from(staffTable)
      .where(eq(staffTable.isActive, true))
      .orderBy(asc(staffTable.fullName));
    return json({ items: rows });
  }
  if (method === "GET" && resource === "product-options") {
    const search = String(req.nextUrl.searchParams.get("search") ?? "").trim();
    const rows = await db
      .select({
        id: productsTable.id,
        name: productsTable.nameAr,
        stock: productsTable.stock,
        costPrice: productsTable.costPrice,
      })
      .from(productsTable)
      .where(
        and(
          eq(productsTable.isActive, true),
          search
            ? or(
                ilike(productsTable.nameAr, `%${search}%`),
                ilike(productsTable.name, `%${search}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(productsTable.nameAr))
      .limit(100);
    return json({ items: rows });
  }
  // ── Warehouse (المخزن): materials reserved by active graduation orders ──
  // Aggregates each order's `inventoryItems` (fabric, caps, sashes, accessories,
  // printing materials) and joins live product stock so the crew can see
  // reservations vs. availability and spot shortages. Read-only; the actual
  // stock deduction stays owned by the order lifecycle (`inventoryApplied`).
  if (method === "GET" && resource === "warehouse") {
    const orders = await db
      .select({
        inventoryItems: graduationOrdersTable.inventoryItems,
        inventoryApplied: graduationOrdersTable.inventoryApplied,
      })
      .from(graduationOrdersTable)
      .where(
        sql`${graduationOrdersTable.archivedAt} is null
          and ${graduationOrdersTable.status} <> 'cancelled'
          and ${graduationOrdersTable.productionStage} <> 'delivered'`,
      );
    const reserved = new Map<
      number,
      { productId: number; label: string; reserved: number; applied: number; orders: number }
    >();
    for (const order of orders) {
      const items = Array.isArray(order.inventoryItems) ? order.inventoryItems : [];
      for (const item of items) {
        const productId = Number(item?.productId);
        if (!productId) continue;
        const quantity = Math.max(0, Number(item?.quantity ?? 0));
        const entry =
          reserved.get(productId) ??
          { productId, label: String(item?.label ?? ""), reserved: 0, applied: 0, orders: 0 };
        entry.reserved += quantity;
        if (order.inventoryApplied) entry.applied += quantity;
        entry.orders += 1;
        if (!entry.label && item?.label) entry.label = String(item.label);
        reserved.set(productId, entry);
      }
    }
    const ids = [...reserved.keys()];
    const products = ids.length
      ? await db
          .select({
            id: productsTable.id,
            name: productsTable.name,
            nameAr: productsTable.nameAr,
            stock: productsTable.stock,
            minStock: productsTable.minStock,
          })
          .from(productsTable)
          .where(inArray(productsTable.id, ids))
      : [];
    const productById = new Map(products.map((product) => [product.id, product]));
    const items = [...reserved.values()]
      .map((entry) => {
        const product = productById.get(entry.productId);
        const stock = Number(product?.stock ?? 0);
        return {
          productId: entry.productId,
          name: product?.nameAr || product?.name || entry.label || `#${entry.productId}`,
          label: entry.label,
          reserved: entry.reserved,
          applied: entry.applied,
          stock,
          minStock: Number(product?.minStock ?? 0),
          shortage: Math.max(0, entry.reserved - stock),
          orders: entry.orders,
        };
      })
      .sort((a, b) => b.reserved - a.reserved);
    return json({
      items,
      summary: {
        materials: items.length,
        totalReserved: items.reduce((sum, item) => sum + item.reserved, 0),
        shortages: items.filter((item) => item.shortage > 0).length,
      },
    });
  }
  // ── Invoices (الفواتير): financial roll-up of graduation orders ──
  // Reuses the amounts already posted on each order (linked to sales invoices +
  // the unified accounting ledger via invoiceId / financialTransactionId).
  if (method === "GET" && resource === "invoices") {
    const activeWhere = sql`${graduationOrdersTable.archivedAt} is null and ${graduationOrdersTable.status} <> 'cancelled'`;
    const [totals, statusRows, rows] = await Promise.all([
      db
        .select({
          revenue: sql<number>`coalesce(sum(${graduationOrdersTable.totalAmount}::numeric),0)::float`,
          collected: sql<number>`coalesce(sum(${graduationOrdersTable.paidAmount}::numeric),0)::float`,
          outstanding: sql<number>`coalesce(sum(${graduationOrdersTable.remainingAmount}::numeric),0)::float`,
          count: sql<number>`count(*)::int`,
        })
        .from(graduationOrdersTable)
        .where(activeWhere),
      db
        .select({
          status: graduationOrdersTable.paymentStatus,
          count: sql<number>`count(*)::int`,
        })
        .from(graduationOrdersTable)
        .where(activeWhere)
        .groupBy(graduationOrdersTable.paymentStatus),
      db
        .select()
        .from(graduationOrdersTable)
        .where(activeWhere)
        .orderBy(desc(graduationOrdersTable.createdAt))
        .limit(200),
    ]);
    const total = totals[0] ?? { revenue: 0, collected: 0, outstanding: 0, count: 0 };
    return json({
      summary: {
        revenue: money(total.revenue),
        collected: money(total.collected),
        outstanding: money(total.outstanding),
        invoices: total.count,
        byStatus: Object.fromEntries(statusRows.map((row) => [row.status, row.count])),
      },
      items: rows.map((row) => ({
        id: row.id,
        orderNo: row.orderNo,
        customerName: row.customerName,
        invoiceId: row.invoiceId,
        total: money(row.totalAmount),
        paid: money(row.paidAmount),
        remaining: money(row.remainingAmount),
        paymentStatus: row.paymentStatus,
        paymentMethod: row.paymentMethod,
        createdAt: row.createdAt,
        trackingUrl: `/graduation/track/${row.qrToken}`,
      })),
    });
  }
  return null;
}
