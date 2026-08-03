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
  isNull,
  lte,
  ne,
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
  graduationGroupStudentsTable,
  graduationPackagesTable,
  graduationPackageItemsTable,
  graduationMediaLinksTable,
  graduationOrdersTable,
  galleryItemsTable,
  graduationOrderItemsTable,
  graduationApprovalsTable,
  graduationPreviewsTable,
  graduationReceiptsTable,
  graduationResourcesTable,
  graduationTemplatesTable,
  notificationsTable,
  productsTable,
  qrTokensTable,
  salesInvoiceItemsTable,
  salesInvoicesTable,
  serviceOrdersTable,
  servicesTable,
  settingsTable,
  staffTable,
  stockMovementsTable,
  tasksTable,
} from "@workspace/db";
import {
  syncCentralBookingToPhotography,
  findPhotographerConflict,
} from "@/server/photography-booking-integration";
import { normalizeIraqiPhone, normalizePhoneDigits } from "@/lib/phone";
import {
  DEFAULT_GRADUATION_CONFIG,
  GRADUATION_STAGES,
  GRADUATION_STAGE_LABELS,
  customPackagePriceSummary,
  estimateGraduationProduction,
  graduationAdminPatchSchema,
  graduationInventoryItems,
  graduationOrderInputSchema,
  graduationPriceSummary,
  normalizeGraduationConfig,
  recommendedGraduationSize,
  type GraduationCatalogProduct,
  type GraduationConfig,
  type GraduationCustomItem,
  type GraduationOrderInput,
} from "@/lib/graduation";
import {
  getGraduationMeasurementFilter,
  getGraduationMeasurementStatus,
  withGraduationMeasurementStatus,
} from "@/lib/graduation-measurements";
import {
  ensureMasterCashBoxTables,
  syncSourcePaymentTarget,
  type FinancialActor,
} from "@/server/master-cash-box";
import { sendTelegramMessage } from "@/server/telegram";
import { ensureGraduationOperationsTables } from "@/server/graduation-schema";
import { ensureGraduationMediaTables } from "@/server/graduation-media-schema";
import {
  getGraduationEnterpriseCatalog,
  syncGraduationEnterpriseOrder,
} from "@/server/graduation-enterprise";
import { getGraduationProductionMeasurementBlock } from "@/server/graduation-measurements";

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

const graduationMediaCategorySchema = z.enum([
  "gown", "sash", "cap", "package", "custom_package", "work", "promotion",
]);
const graduationMediaCreateSchema = z.object({
  mediaType: z.enum(["image", "video"]),
  mediaUrl: z.string().trim().min(1),
  thumbnailUrl: z.string().trim().optional().default(""),
  title: z.string().trim().max(200).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  category: graduationMediaCategorySchema.default("work"),
  displayLocation: z.enum(["gallery", "builder", "both"]).default("both"),
  displayOrder: z.coerce.number().int().min(0).max(100000).default(0),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  customerVisible: z.boolean().default(true),
  imageMetadata: z.record(z.string(), z.unknown()).default({}),
  templateIds: z.array(z.coerce.number().int().positive()).max(200).default([]),
  packageIds: z.array(z.coerce.number().int().positive()).max(200).default([]),
  isPrimary: z.boolean().default(false),
});
const graduationMediaPatchSchema = graduationMediaCreateSchema.partial();
const GRADUATION_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const GRADUATION_VIDEO_MIMES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const GRADUATION_IMAGE_BYTES = 10 * 1024 * 1024;
const GRADUATION_VIDEO_BYTES = 18 * 1024 * 1024;

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
  await ensureGraduationOperationsTables();
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
  if (mime.includes("gif")) return "gif";
  if (mime.includes("svg")) return "svg";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("quicktime")) return "mov";
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

function canManageGraduationMedia(user: GraduationAdminUser) {
  return user.role === "admin" || user.permissions.includes("graduation") || user.permissions.includes("graduation.preview.manage");
}

function canDeleteIndividualGraduationOrder(user: GraduationAdminUser) {
  return (
    user.role === "admin" ||
    user.permissions.includes("graduation") ||
    user.permissions.includes("graduation.delete")
  );
}

function canDeleteGraduationGroup(user: GraduationAdminUser) {
  return (
    user.role === "admin" ||
    user.permissions.includes("graduation") ||
    user.permissions.includes("graduation.delete")
  );
}

function graduationMediaUrl(row: typeof galleryItemsTable.$inferSelect) {
  return row.mediaUrl.startsWith("data:")
    ? `/api/media/gallery/${row.id}?v=${row.updatedAt.getTime()}`
    : row.mediaUrl;
}

function videoLinkSupported(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return host.includes("youtube.com") || host === "youtu.be" || host.includes("vimeo.com") || /\.(mp4|webm|mov|m4v)(?:$|\?)/i.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

function validateGraduationMediaValue(value: string, mediaType: "image" | "video", label = "الملف") {
  const data = parseDataUrl(value);
  if (data) {
    const allowed = mediaType === "image" ? GRADUATION_IMAGE_MIMES : GRADUATION_VIDEO_MIMES;
    const max = mediaType === "image" ? GRADUATION_IMAGE_BYTES : GRADUATION_VIDEO_BYTES;
    if (!allowed.has(data.mime)) throw new Error(`${label}: صيغة غير مدعومة`);
    if (data.bytes.byteLength > max) throw new Error(`${label}: الحجم يتجاوز ${Math.round(max / 1024 / 1024)}MB`);
    return;
  }
  if (mediaType === "video" ? !videoLinkSupported(value) : !/^https?:\/\//i.test(value))
    throw new Error(`${label}: الرابط غير مدعوم`);
}

async function auditGraduationMedia(user: GraduationAdminUser, action: string, id: number, metadata: Record<string, unknown> = {}) {
  await db.insert(adminActivityLogsTable).values({
    staffId: user.id,
    userName: user.fullName || user.username,
    action,
    entityType: "graduation_media",
    entityId: id,
    metadata,
  });
}

function graduationMediaPoster(row: typeof galleryItemsTable.$inferSelect) {
  return row.mediaType === "video" ? row.thumbnailUrl || "" : row.mediaUrl;
}

async function graduationMediaTargets() {
  const [templates, packages] = await Promise.all([
    db.select({ id: graduationTemplatesTable.id, name: graduationTemplatesTable.name, type: graduationTemplatesTable.templateType, active: graduationTemplatesTable.isActive }).from(graduationTemplatesTable).orderBy(asc(graduationTemplatesTable.templateType), asc(graduationTemplatesTable.name)),
    db.select({ id: graduationPackagesTable.id, name: graduationPackagesTable.name, type: sql<string>`'package'`, active: graduationPackagesTable.isActive }).from(graduationPackagesTable).orderBy(asc(graduationPackagesTable.name)),
  ]);
  return { templates, packages };
}

async function listGraduationMedia(publicOnly: boolean, includeArchived = false) {
  await ensureGraduationMediaTables();
  const visibility = and(
    eq(galleryItemsTable.scope, "graduation"),
    publicOnly ? eq(galleryItemsTable.isActive, true) : undefined,
    publicOnly ? eq(galleryItemsTable.customerVisible, true) : undefined,
    publicOnly || !includeArchived ? isNull(galleryItemsTable.archivedAt) : undefined,
    publicOnly || !includeArchived ? isNull(galleryItemsTable.deletedAt) : undefined,
  );
  const rows = await db.select().from(galleryItemsTable).where(visibility).orderBy(desc(galleryItemsTable.isFeatured), asc(galleryItemsTable.displayOrder), desc(galleryItemsTable.createdAt));
  const links = rows.length ? await db.select().from(graduationMediaLinksTable).where(inArray(graduationMediaLinksTable.mediaId, rows.map((row) => row.id))).orderBy(asc(graduationMediaLinksTable.sortOrder)) : [];
  const items = rows.map((row) => ({
    ...row,
    mediaUrl: graduationMediaUrl(row),
    thumbnailUrl: row.thumbnailUrl || (row.mediaType === "image" ? graduationMediaUrl(row) : null),
    links: links.filter((link) => link.mediaId === row.id),
  }));
  return publicOnly ? { items } : { items, targets: await graduationMediaTargets() };
}

async function repairPrimaryMediaTarget(
  link: typeof graduationMediaLinksTable.$inferSelect,
  affected: typeof galleryItemsTable.$inferSelect,
  excludeMediaId?: number,
) {
  const current = link.targetType === "template"
    ? await db.query.graduationTemplatesTable.findFirst({ where: eq(graduationTemplatesTable.id, Number(link.templateId)) })
    : await db.query.graduationPackagesTable.findFirst({ where: eq(graduationPackagesTable.id, Number(link.packageId)) });
  const currentPreview = current?.previewImageUrl || "";
  if (![affected.mediaUrl, affected.thumbnailUrl || ""].filter(Boolean).includes(currentPreview)) return;
  const targetCondition = link.targetType === "template"
    ? eq(graduationMediaLinksTable.templateId, Number(link.templateId))
    : eq(graduationMediaLinksTable.packageId, Number(link.packageId));
  const [replacement] = await db
    .select({ media: galleryItemsTable, link: graduationMediaLinksTable })
    .from(graduationMediaLinksTable)
    .innerJoin(galleryItemsTable, eq(galleryItemsTable.id, graduationMediaLinksTable.mediaId))
    .where(and(targetCondition, eq(galleryItemsTable.scope, "graduation"), eq(galleryItemsTable.isActive, true), eq(galleryItemsTable.customerVisible, true), isNull(galleryItemsTable.archivedAt), isNull(galleryItemsTable.deletedAt), excludeMediaId ? ne(galleryItemsTable.id, excludeMediaId) : undefined))
    .orderBy(desc(graduationMediaLinksTable.isPrimary), asc(graduationMediaLinksTable.sortOrder), asc(galleryItemsTable.displayOrder))
    .limit(1);
  const replacementUrl = replacement ? graduationMediaPoster(replacement.media) || null : null;
  if (link.targetType === "template") await db.update(graduationTemplatesTable).set({ previewImageUrl: replacementUrl, updatedAt: new Date() }).where(eq(graduationTemplatesTable.id, Number(link.templateId)));
  else await db.update(graduationPackagesTable).set({ previewImageUrl: replacementUrl, updatedAt: new Date() }).where(eq(graduationPackagesTable.id, Number(link.packageId)));
}

async function replaceGraduationMediaLinks(media: typeof galleryItemsTable.$inferSelect, templateIds: number[], packageIds: number[], isPrimary: boolean) {
  const previous = await db.select().from(graduationMediaLinksTable).where(eq(graduationMediaLinksTable.mediaId, media.id));
  await db.delete(graduationMediaLinksTable).where(eq(graduationMediaLinksTable.mediaId, media.id));
  const rows = [
    ...[...new Set(templateIds)].map((templateId, sortOrder) => ({ mediaId: media.id, targetType: "template", templateId, packageId: null, isPrimary, sortOrder })),
    ...[...new Set(packageIds)].map((packageId, sortOrder) => ({ mediaId: media.id, targetType: "package", templateId: null, packageId, isPrimary, sortOrder })),
  ];
  if (isPrimary) {
    for (const templateId of templateIds) await db.update(graduationMediaLinksTable).set({ isPrimary: false }).where(eq(graduationMediaLinksTable.templateId, templateId));
    for (const packageId of packageIds) await db.update(graduationMediaLinksTable).set({ isPrimary: false }).where(eq(graduationMediaLinksTable.packageId, packageId));
  }
  if (rows.length) await db.insert(graduationMediaLinksTable).values(rows).onConflictDoNothing();
  const primaryUrl = graduationMediaPoster(media) || null;
  if (isPrimary) {
    if (!primaryUrl) throw new Error("الفيديو الرئيسي يحتاج صورة مصغرة");
    for (const templateId of templateIds) await db.update(graduationTemplatesTable).set({ previewImageUrl: primaryUrl, updatedAt: new Date() }).where(eq(graduationTemplatesTable.id, templateId));
    for (const packageId of packageIds) await db.update(graduationPackagesTable).set({ previewImageUrl: primaryUrl, updatedAt: new Date() }).where(eq(graduationPackagesTable.id, packageId));
  }
  const retained = new Set(rows.map((row) => `${row.targetType}:${row.templateId || row.packageId}`));
  for (const link of previous) if (!retained.has(`${link.targetType}:${link.templateId || link.packageId}`)) await repairPrimaryMediaTarget(link, media);
  if (!isPrimary) {
    for (const link of previous) {
      if (link.isPrimary && retained.has(`${link.targetType}:${link.templateId || link.packageId}`))
        await repairPrimaryMediaTarget(link, media, media.id);
    }
  }
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
  const groupYear = String(
    data.graduationYear || data.graduationBatch.match(/\d{4}/)?.[0] || new Date().getFullYear(),
  ).slice(0, 4);
  const groupNo = `AJN-GROUP-${groupYear}-${String(row.id).padStart(4, "0")}`;
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

export async function notifyTailorsMeasurementsPending(order: {
  id: number;
  orderNo: string;
  customerName: string;
}) {
  const tailors = await db
    .select({ staffId: graduationResourcesTable.operatorId })
    .from(graduationResourcesTable)
    .where(
      and(
        eq(graduationResourcesTable.resourceType, "tailor"),
        eq(graduationResourcesTable.isActive, true),
      ),
    );
  const staffIds = [
    ...new Set(
      tailors
        .map((tailor) => Number(tailor.staffId))
        .filter((staffId) => Number.isFinite(staffId) && staffId > 0),
    ),
  ];
  if (!staffIds.length) {
    await notify({
      type: "graduation_measurements_pending",
      title: "طلب تخرج بانتظار إدخال القياسات",
      body: `${order.orderNo} - ${order.customerName}`,
      entityId: order.id,
      href: "/admin/graduation/measurements",
    });
    return;
  }
  await Promise.all(
    staffIds.map((staffId) =>
      notify({
        audienceType: "staff",
        staffId,
        type: "graduation_measurements_pending",
        title: "طلب جديد بانتظار إدخال القياسات",
        body: `${order.orderNo} - ${order.customerName}`,
        entityId: order.id,
        href: "/staff/tailors",
      }),
    ),
  );
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
    studentCode: row.studentCode ?? row.orderNo,
    orderType: row.orderType ?? (row.groupId ? "group" : "individual"),
    groupId: row.groupId ?? null,
    barcodeValue: row.barcodeValue ?? row.studentCode ?? row.orderNo,
    receiptNo: row.receiptNo ?? null,
    qrValue: row.qrToken,
    status: row.status,
    productionStage: row.productionStage,
    stageLabel:
      GRADUATION_STAGE_LABELS[
        row.productionStage as keyof typeof GRADUATION_STAGE_LABELS
      ] ?? row.productionStage,
    customerName: row.customerName,
    phone: row.phone,
    phone2: row.phone2 ?? null,
    styleKey: row.styleKey,
    packageKey: row.packageKey,
    measurements: row.measurements,
    measurementStatus: getGraduationMeasurementFilter(row.measurements),
    colors: row.colors,
    fabric: row.fabric,
    decoration: row.decoration,
    customText: row.customText,
    accessories: row.accessories,
    studentProfile: row.studentProfile ?? {},
    garmentDetails: row.garmentDetails ?? {},
    templateVersionId: row.templateVersionId ?? null,
    templateSnapshot: row.templateSnapshot ?? {},
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

// Valid measurement ranges (cm), mirrored from graduationMeasurementsSchema, so
// a rejected submission tells the student exactly which field is out of range
// instead of the opaque "تحقق من بيانات طلب التخرج".
const GRADUATION_MEASUREMENT_RANGES: Record<string, [number, number, string]> = {
  height: [80, 250, "الطول"],
  weight: [20, 300, "الوزن"],
  shoulder: [20, 100, "عرض الكتف"],
  chest: [40, 220, "محيط الصدر"],
  waist: [35, 220, "محيط الخصر"],
  hip: [35, 240, "محيط الورك"],
  sleeveLength: [20, 120, "طول الكم"],
  neck: [20, 80, "محيط الرقبة"],
};
const GRADUATION_FIELD_LABELS: Record<string, string> = {
  customerName: "اسم الزبون",
  phone: "رقم الهاتف",
  styleKey: "نوع التخرج",
  "fabric.key": "القماش",
  "measurements.gender": "الجنس",
};

function describeGraduationIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): string {
  const messages = issues.map((issue) => {
    const path = issue.path.map(String);
    const range = path[0] === "measurements" ? GRADUATION_MEASUREMENT_RANGES[path[1]] : undefined;
    if (range) return `${range[2]}: القيمة يجب أن تكون بين ${range[0]} و${range[1]} سم`;
    const key = path.join(".");
    const label = GRADUATION_FIELD_LABELS[key] ?? GRADUATION_FIELD_LABELS[path[0]] ?? key;
    return `${label} غير صحيح`;
  });
  const unique = Array.from(new Set(messages)).slice(0, 5);
  return unique.length
    ? `تحقق من البيانات: ${unique.join(" • ")}`
    : "تحقق من بيانات طلب التخرج";
}

export async function createOrder(raw: unknown, user?: GraduationAdminUser | null) {
  await ensureGraduationTables();
  const parsed = graduationOrderInputSchema.safeParse(raw);
  if (!parsed.success)
    return {
      response: error(
        describeGraduationIssues(parsed.error.issues),
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
      customPackage:
        locked.customPackage && typeof locked.customPackage === "object"
          ? ({ ...data.customPackage, ...(locked.customPackage as Record<string, unknown>) } as typeof data.customPackage)
          : data.customPackage,
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
  const customPackage = data.customPackage;
  let selectedTemplates: Array<typeof graduationTemplatesTable.$inferSelect> = [];
  let enterprisePackage: typeof graduationPackagesTable.$inferSelect | null = null;
  let enterprisePackageItems: Array<typeof graduationPackageItemsTable.$inferSelect> = [];
  // Pricing lines contributed by the custom package, plus the per-item snapshot
  // rows we persist into graduation_order_items after the order row exists.
  let customLines: Array<{ key: string; name: string; amount: number; cost: number }> = [];
  let orderItemsPlan: Array<
    Omit<typeof graduationOrderItemsTable.$inferInsert, "graduationOrderId">
  > = [];
  // Normalize the custom-package selection to items[]: prefer the multi-item
  // payload, otherwise reconstruct from the legacy single-id shape.
  const customItems: GraduationCustomItem[] = customPackage.enabled
    ? customPackage.items && customPackage.items.length
      ? (customPackage.items as GraduationCustomItem[])
      : ([
          customPackage.robeTemplateId && {
            itemType: "robe",
            templateId: customPackage.robeTemplateId,
            quantity: 1,
          },
          customPackage.sashTemplateId && {
            itemType: "sash",
            templateId: customPackage.sashTemplateId,
            quantity: 1,
          },
          customPackage.capTemplateId && {
            itemType: "cap",
            templateId: customPackage.capTemplateId,
            quantity: 1,
          },
        ].filter(Boolean) as GraduationCustomItem[])
    : [];
  if (customPackage.enabled) {
    if (customPackage.enterprisePackageId) {
      enterprisePackage =
        (await db.query.graduationPackagesTable.findFirst({
          where: and(
            eq(graduationPackagesTable.id, customPackage.enterprisePackageId),
            eq(graduationPackagesTable.isActive, true),
            eq(graduationPackagesTable.isArchived, false),
          ),
        })) ?? null;
      if (!enterprisePackage)
        return { response: error("باقة التخرج المختارة غير متاحة", 400) };
      enterprisePackageItems = await db
        .select()
        .from(graduationPackageItemsTable)
        .where(eq(graduationPackageItemsTable.packageId, enterprisePackage.id));
    }
    const requestedIds = [...new Set(customItems.map((item) => item.templateId))];
    selectedTemplates = requestedIds.length
      ? await db
          .select()
          .from(graduationTemplatesTable)
          .where(
            and(
              inArray(graduationTemplatesTable.id, requestedIds),
              eq(graduationTemplatesTable.isActive, true),
              sql`${graduationTemplatesTable.archivedAt} is null`,
            ),
          )
      : [];
    const byId = new Map(selectedTemplates.map((item) => [item.id, item]));
    for (const item of customItems) {
      const template = byId.get(item.templateId);
      if (!template)
        return { response: error("أحد منتجات الباقة غير متاح", 400) };
      if (template.templateType !== item.itemType)
        return {
          response: error("أحد منتجات الباقة لا يطابق نوع القطعة المختارة", 400),
        };
    }
    if (!enterprisePackage && !customItems.some((item) => item.itemType === "robe"))
      return { response: error("يجب اختيار روب واحد على الأقل ضمن الباقة", 400) };

    // Authoritative server-side recompute (client prices are display-only).
    const products: GraduationCatalogProduct[] = selectedTemplates.map(
      (template) => ({
        id: template.id,
        code: template.code,
        name: template.name,
        templateType: template.templateType,
        previewImageUrl: template.previewImageUrl,
        modelUrl: template.modelUrl,
        images: template.images as string[],
        defaultPrice: Number(template.defaultPrice || 0),
        discountPrice:
          template.discountPrice != null ? Number(template.discountPrice) : null,
        trackStock: template.trackStock,
        stock: template.stock,
        available: template.isActive !== false && !template.archivedAt,
        configuration: template.configuration as GraduationCatalogProduct["configuration"],
        ...({ sku: template.sku } as Record<string, unknown>),
      }),
    );
    const summary = customPackagePriceSummary(customItems, products, 0);
    if (enterprisePackage) {
      customLines = [
        {
          key: `enterprise-package:${enterprisePackage.id}`,
          name: enterprisePackage.name,
          amount: Number(enterprisePackage.defaultPrice || 0),
          cost: Number(enterprisePackage.defaultCost || 0),
        },
      ];
      orderItemsPlan = enterprisePackageItems.map((row, index) => ({
        groupId: group?.id ?? null,
        itemType: row.itemType,
        templateId: row.templateId ?? null,
        productId: row.productId ?? null,
        productName: row.name,
        quantity: String(Number(row.quantity || 1)),
        originalUnitPrice: String(Number(row.unitPrice || 0)),
        finalUnitPrice: String(Number(row.unitPrice || 0)),
        lineTotal: String(Number(row.unitPrice || 0) * Number(row.quantity || 1)),
        snapshot: {
          source: "enterprise_package",
          packageId: enterprisePackage!.id,
          packageName: enterprisePackage!.name,
        },
        sortOrder: index,
      }));
    } else {
      const costById = new Map(
        selectedTemplates.map((template) => [
          template.id,
          Number(template.costPrice || 0),
        ]),
      );
      customLines = summary.lines.map((line) => ({
        key: line.key,
        name: line.quantity > 1 ? `${line.name} × ${line.quantity}` : line.name,
        amount: line.lineTotal,
        cost: (costById.get(line.templateId) || 0) * line.quantity,
      }));
      orderItemsPlan = summary.lines.map((line, index) => {
        const template = byId.get(line.templateId);
        return {
          groupId: group?.id ?? null,
          itemType: line.itemType,
          templateId: line.templateId,
          productId: line.productId,
          productName: line.name,
          productSku: line.sku ?? template?.sku ?? null,
          variantLabel: line.variantLabel,
          size: line.size,
          color: line.color,
          quantity: String(line.quantity),
          originalUnitPrice: String(line.originalUnitPrice),
          finalUnitPrice: String(line.finalUnitPrice),
          customizationCharge: String(line.customizationCharge),
          lineTotal: String(line.lineTotal),
          customization: line.customization,
          imageUrl: line.imageUrl,
          snapshot: {
            source: "custom_package",
            templateCode: template?.code,
            templateVersion: template?.currentVersion,
            configuration: template?.configuration,
          },
          notes: line.notes,
          sortOrder: index,
        };
      });
    }
  }
  // ── Graduation Extras: flowers become snapshotted order items priced into the
  // graduation invoice, with Flower Store stock reserved through the existing
  // inventoryItems → applyInventory path. (Photography is handled after insert.)
  const extrasInput = ((data as Record<string, unknown>).extras ?? {}) as {
    flowers?: Array<{ productId: number; variantId?: number; quantity?: number; color?: string; wrapColor?: string; ribbonColor?: string; giftCard?: string }>;
    photography?: { serviceId: number; session?: string; date?: string; time?: string; photographerId?: number; location?: string; notes?: string } | null;
  };
  const flowerInputs = Array.isArray(extrasInput.flowers) ? extrasInput.flowers : [];
  const flowerLines: Array<{ key: string; name: string; amount: number; cost: number }> = [];
  if (flowerInputs.length) {
    const flowerIds = [...new Set(flowerInputs.map((f) => Number(f.productId)).filter(Boolean))];
    const flowerProducts = flowerIds.length
      ? await db.select().from(productsTable).where(inArray(productsTable.id, flowerIds))
      : [];
    const flowerById = new Map(flowerProducts.map((p) => [p.id, p]));
    flowerInputs.forEach((f, index) => {
      const product = flowerById.get(Number(f.productId));
      if (!product) return;
      const qty = Math.max(1, Number(f.quantity) || 1);
      const unit = Number(product.price || 0);
      const cost = Number(product.costPrice || 0);
      const firstImage = Array.isArray(product.images) ? product.images[0] : null;
      const image = typeof firstImage === "string" ? firstImage : (firstImage as { url?: string } | null)?.url ?? null;
      flowerLines.push({
        key: `flower:${product.id}:${index}`,
        name: qty > 1 ? `${product.nameAr} × ${qty}` : product.nameAr,
        amount: unit * qty,
        cost: cost * qty,
      });
      orderItemsPlan.push({
        groupId: group?.id ?? null,
        itemType: "flower",
        productId: product.id,
        productName: product.nameAr,
        quantity: String(qty),
        originalUnitPrice: String(unit),
        finalUnitPrice: String(unit),
        lineTotal: String(unit * qty),
        customization: {
          color: f.color ?? null,
          wrapColor: f.wrapColor ?? null,
          ribbonColor: f.ribbonColor ?? null,
          giftCard: f.giftCard ?? null,
        },
        imageUrl: image,
        snapshot: { source: "graduation_extra", kind: "flower", variantId: f.variantId ?? null },
        sortOrder: 1000 + index,
      });
    });
  }
  const basePricing = graduationPriceSummary(data, config);
  const pricingLines = [...basePricing.lines, ...customLines, ...flowerLines];
  const pricingSubtotal = pricingLines.reduce((sum, line) => sum + line.amount, 0);
  const pricingCost = pricingLines.reduce((sum, line) => sum + line.cost, 0);
  const pricingDiscount = Math.min(Math.max(0, Number(data.discountAmount || 0)), pricingSubtotal);
  const pricing = {
    lines: pricingLines,
    subtotal: pricingSubtotal,
    discount: pricingDiscount,
    total: Math.max(0, pricingSubtotal - pricingDiscount),
    cost: pricingCost,
    profit: Math.max(0, pricingSubtotal - pricingDiscount) - pricingCost,
  };
  const estimate = estimateGraduationProduction(data, config);
  const baseInventoryItems = graduationInventoryItems(data, config);
  const enterpriseInventoryItems = orderItemsPlan
    .map((row) => ({
      productId: Number(row.productId || 0),
      quantity: Number(row.quantity || 1),
      label: row.productName || "",
    }))
    .filter((item) => item.productId > 0);
  const groupedInventory = new Map<number, { productId: number; quantity: number; label: string }>();
  for (const item of [...baseInventoryItems, ...enterpriseInventoryItems]) {
    const current = groupedInventory.get(item.productId);
    groupedInventory.set(item.productId, {
      ...item,
      quantity: Number(current?.quantity || 0) + Number(item.quantity || 0),
    });
  }
  const inventoryItems = [...groupedInventory.values()];
  const groupId = group?.id ?? null;
  const decoration = { ...data.decoration } as Record<string, any>;
  const orderMeasurements = withGraduationMeasurementStatus(data.measurements);
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
      measurements: orderMeasurements as any,
      colors: data.colors as any,
      fabric: data.fabric as any,
      decoration: decoration as any,
      customText: data.customText as any,
      accessories: data.accessories as any,
      universityTemplate: data.universityTemplate as any,
      previewAssets: data.previewAssets as any,
      templateSnapshot: customPackage.enabled
        ? {
            mode: enterprisePackage ? "enterprise_package" : "custom_package",
            selected: customPackage,
            package: enterprisePackage,
            items: enterprisePackageItems,
            templates: selectedTemplates.map((item) => ({
              id: item.id,
              code: item.code,
              name: item.name,
              type: item.templateType,
              version: item.currentVersion,
              price: Number(item.defaultPrice || 0),
              configuration: item.configuration,
              previewImageUrl: item.previewImageUrl,
              modelUrl: item.modelUrl,
            })),
          }
        : {},
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
  const year = new Date().getFullYear();
  const orderNo = `AJN-GRAD-${year}-${String(draft.id).padStart(5, "0")}`;
  const studentCode = groupId
    ? `AJN-GR-G${String(groupId).padStart(3, "0")}-${String(draft.id).padStart(6, "0")}`
    : `AJN-GR-${year}-${String(draft.id).padStart(6, "0")}`;
  const receiptNo = `AJN-GR-R-${year}-${String(draft.id).padStart(6, "0")}`;
  const [order] = await db
    .update(graduationOrdersTable)
    .set({
      orderNo,
      studentCode,
      orderType: groupId ? "group" : "individual",
      barcodeValue: studentCode,
      receiptNo,
      phone2: String((raw as any)?.phone2 ?? "").trim() || null,
      studentProfile: {
        gender: data.measurements.gender ?? "unspecified",
        university: data.customText.university ?? group?.university ?? "",
        college: data.customText.college ?? group?.college ?? "",
        department: data.customText.department ?? group?.department ?? "",
        graduationYear:
          data.customText.graduationYear ?? group?.graduationYear ?? "",
      },
      garmentDetails: {
        robeType:
          selectedTemplates.find((item) => item.templateType === "robe")?.name ||
          data.styleKey,
        sashType:
          selectedTemplates.find((item) => item.templateType === "sash")?.name ||
          "",
        capType:
          selectedTemplates.find((item) => item.templateType === "cap")?.name ||
          "",
        packageKey: data.packageKey ?? "",
        robeColor: data.colors.robe ?? "",
        sashColor: data.colors.sash ?? "",
        capColor: data.colors.cap ?? "",
        decorationType: data.decoration.type,
        decorationPosition: data.decoration.position,
      },
      extras: flowerLines.length
        ? {
            flowers: {
              count: flowerInputs.reduce((sum, f) => sum + (Number(f.quantity) || 1), 0),
              names: flowerLines.map((line) => line.name),
            },
          }
        : {},
      updatedAt: new Date(),
    })
    .where(eq(graduationOrdersTable.id, draft.id))
    .returning();
  if (orderItemsPlan.length) {
    await db.insert(graduationOrderItemsTable).values(
      orderItemsPlan.map((row) => ({
        ...row,
        graduationOrderId: order.id,
        groupId: groupId ?? row.groupId ?? null,
      })),
    );
  }
  if (groupId) {
    const [sequenceRow] = await db
      .select({ next: sql<number>`coalesce(max(${graduationGroupStudentsTable.sequence}), 0)::int + 1` })
      .from(graduationGroupStudentsTable)
      .where(eq(graduationGroupStudentsTable.groupId, groupId));
    await db
      .insert(graduationGroupStudentsTable)
      .values({
        groupId,
        graduationOrderId: order.id,
        customerId: order.customerId,
        studentCode,
        sequence: Number(sequenceRow?.next ?? 1),
      })
      .onConflictDoNothing();
  }
  await db
    .insert(graduationReceiptsTable)
    .values({
      receiptNo,
      receiptType: "student",
      graduationOrderId: order.id,
      groupId,
      snapshot: {
        orderNo,
        studentCode,
        studentName: order.customerName,
        phone: order.phone,
        total: pricing.total,
        paid: 0,
        remaining: pricing.total,
      },
      issuedBy: user?.id ?? null,
      issuedByName: user ? user.fullName || user.username : "النظام",
    })
    .onConflictDoNothing();
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
    if (getGraduationMeasurementStatus(order.measurements) === "not_started")
      await notifyTailorsMeasurementsPending(order);
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
  // ── Graduation Extras: photography session → a linked service_order the
  // existing pipeline surfaces in the Photographers Portal (student, university,
  // group, date/time, photographer, notes travel in customFields). Priced by
  // staff at fulfillment (services carry no catalog price). Conflict-checked,
  // best-effort — a failure never blocks the graduation order.
  let extrasWarning: string | undefined;
  const photo = extrasInput.photography;
  if (photo && Number(photo.serviceId) > 0 && data.status === "submitted") {
    try {
      const photographerId = Number(photo.photographerId) || 0;
      const eventDate = String(photo.date || "").slice(0, 10) || null;
      const conflict =
        photographerId && eventDate
          ? await findPhotographerConflict({
              staffId: photographerId,
              eventId: -1,
              eventDate,
              startTime: photo.time ?? null,
              endTime: null,
            })
          : null;
      if (conflict) {
        extrasWarning =
          "الموعد المطلوب للتصوير محجوز لهذا المصور، تم تسجيل الطلب بدون تثبيت حجز التصوير.";
      } else {
        const [serviceOrder] = await db
          .insert(serviceOrdersTable)
          .values({
            serviceId: Number(photo.serviceId),
            customerName: order.customerName,
            phone: order.phone,
            eventDate,
            eventLocation: photo.location ?? null,
            notes: photo.notes ?? null,
            status: "pending",
            customFields: {
              bookingSource: "graduation",
              graduationOrderId: order.id,
              studentName: order.customerName,
              university: (order.studentProfile as Record<string, unknown> | null)?.university ?? "",
              group: group?.title ?? "",
              session: photo.session ?? "",
              eventStartTime: photo.time ?? "",
              assignedPhotographerId: photographerId || undefined,
              departments: ["photography"],
              notes: photo.notes ?? "",
            },
          })
          .returning();
        if (serviceOrder?.id) {
          try {
            await syncCentralBookingToPhotography(serviceOrder.id, {
              id: user?.id,
              name: user ? user.fullName || user.username : "الموقع",
            });
          } catch (syncError) {
            console.warn("[graduation-extras] photography portal sync failed", syncError);
          }
          await db
            .update(graduationOrdersTable)
            .set({
              extras: {
                ...((order.extras as Record<string, unknown> | null) ?? {}),
                photography: { serviceOrderId: serviceOrder.id, ...photo },
              },
            })
            .where(eq(graduationOrdersTable.id, order.id));
          void addActivity(user, "graduation_photography_booked", order.id, {
            serviceOrderId: serviceOrder.id,
            serviceId: photo.serviceId,
            date: eventDate,
          });
        }
      }
    } catch (photoError) {
      console.warn("[graduation-extras] photography booking failed", photoError);
      extrasWarning = "تعذر تثبيت حجز التصوير، تم تسجيل الطلب.";
    }
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
    ...(extrasWarning ? { warning: extrasWarning } : {}),
  };
}

export async function updateOrder(
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
  if (data.productionStage) {
    const measurementBlock = await getGraduationProductionMeasurementBlock(
      order,
      data.productionStage,
    );
    if (measurementBlock) {
      await notify({
        type: "graduation_production_measurements_blocked",
        title: "تعذر بدء الإنتاج قبل استكمال القياسات",
        body: `${order.orderNo} - ${order.customerName}`,
        entityId: order.id,
        href: `/admin/graduation/orders`,
        metadata: {
          attemptedStage: data.productionStage,
          measurementStatus: measurementBlock.measurementStatus,
          attemptedBy: user.id,
        },
      });
      await addActivity(user, "graduation_production_measurements_blocked", order.id, {
        attemptedStage: data.productionStage,
        measurementStatus: measurementBlock.measurementStatus,
      });
      return {
        response: error(
          "يجب إكمال القياسات قبل بدء مرحلة القص والخياطة.",
          409,
        ),
      };
    }
  }
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
        href: `/staff/tailors/order/${saved.id}`,
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

function graduationMeasurementCompleteCondition() {
  return sql<boolean>`(
    coalesce(${graduationOrdersTable.measurements}->>'status', '') in ('complete', 'needs_review', 'approved')
    or (
      coalesce(nullif(${graduationOrdersTable.measurements}->>'height', ''), '') <> ''
      and coalesce(nullif(${graduationOrdersTable.measurements}->>'shoulder', ''), '') <> ''
      and coalesce(nullif(${graduationOrdersTable.measurements}->>'chest', ''), '') <> ''
      and coalesce(nullif(${graduationOrdersTable.measurements}->>'waist', ''), '') <> ''
      and coalesce(nullif(${graduationOrdersTable.measurements}->>'sleeveLength', ''), '') <> ''
    )
    or (
      ${graduationOrdersTable.measurements}->>'method' = 'ready'
      and coalesce(
        nullif(${graduationOrdersTable.measurements}->>'readySize', ''),
        nullif(${graduationOrdersTable.measurements}->>'standardSize', ''),
        ''
      ) <> ''
    )
  )`;
}

function graduationMeasurementNoneCondition() {
  return sql<boolean>`(
    coalesce(nullif(${graduationOrdersTable.measurements}->>'height', ''), '') = ''
    and coalesce(nullif(${graduationOrdersTable.measurements}->>'shoulder', ''), '') = ''
    and coalesce(nullif(${graduationOrdersTable.measurements}->>'chest', ''), '') = ''
    and coalesce(nullif(${graduationOrdersTable.measurements}->>'waist', ''), '') = ''
    and coalesce(nullif(${graduationOrdersTable.measurements}->>'sleeveLength', ''), '') = ''
    and not (
      coalesce(${graduationOrdersTable.measurements}->>'status', '') in ('complete', 'needs_review', 'approved')
      or (
        ${graduationOrdersTable.measurements}->>'method' = 'ready'
        and coalesce(
          nullif(${graduationOrdersTable.measurements}->>'readySize', ''),
          nullif(${graduationOrdersTable.measurements}->>'standardSize', ''),
          ''
        ) <> ''
      )
    )
  )`;
}

function orderFilters(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") || 1));
  const limit = Math.min(100, Math.max(10, Number(sp.get("limit") || 25)));
  const search = (sp.get("search") || "").trim();
  const status = (sp.get("status") || "").trim();
  const stage = (sp.get("stage") || "").trim();
  const orderType = (sp.get("orderType") || "").trim();
  const measurementStatus = (sp.get("measurementStatus") || "").trim();
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
  if (orderType === "individual")
    conditions.push(sql`${graduationOrdersTable.groupId} is null`);
  if (orderType === "group")
    conditions.push(sql`${graduationOrdersTable.groupId} is not null`);
  if (measurementStatus === "none")
    conditions.push(graduationMeasurementNoneCondition());
  if (measurementStatus === "partial")
    conditions.push(
      and(
        sql`not (${graduationMeasurementCompleteCondition()})`,
        sql`not (${graduationMeasurementNoneCondition()})`,
      ),
    );
  if (measurementStatus === "complete")
    conditions.push(graduationMeasurementCompleteCondition());
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
  if (method === "GET" && resource === "media") return json(await listGraduationMedia(true));
  if (method === "GET" && resource === "config") {
    const [config, enterpriseCatalog] = await Promise.all([
      getConfig(),
      getGraduationEnterpriseCatalog(),
    ]);
    return json({
      ...config,
      enterpriseCatalog,
      aiAvailable: Boolean(process.env.OPENAI_API_KEY) && config.aiEnabled,
    });
  }
  // Graduation Extras — read-only catalogues for the customer "extras" step.
  if (method === "GET" && resource === "photography-services") {
    const rows = await db
      .select()
      .from(servicesTable)
      .where(eq(servicesTable.isActive, true))
      .orderBy(asc(servicesTable.sortOrder));
    const isPhoto = (value: string) => /(photo|photograph|تصوير|فوتو|فيديو|video|album|ألبوم|فريم|frame|drone|درون)/i.test(value);
    const services = rows
      .filter((service) => {
        const meta = (service.imageMetadata ?? {}) as Record<string, unknown>;
        const dept = String(meta.department ?? meta.departmentCode ?? "").toLowerCase();
        return (
          dept === "photography" ||
          isPhoto(service.type || "") ||
          isPhoto(`${service.nameAr} ${service.name}`)
        );
      })
      .map((service) => {
        const meta = (service.imageMetadata ?? {}) as Record<string, unknown>;
        return {
          id: service.id,
          name: service.nameAr || service.name,
          description: service.descriptionAr || service.description || "",
          image: service.image || null,
          duration: (meta.duration ?? meta.durationLabel ?? null) as string | null,
          price: Number(meta.price ?? meta.basePrice ?? 0) || null,
        };
      });
    return json({ services });
  }
  if (method === "GET" && resource === "photographers") {
    const rows = await db
      .select({ id: staffTable.id, name: staffTable.fullName, role: staffTable.role, permissions: staffTable.permissions, isActive: staffTable.isActive })
      .from(staffTable)
      .where(eq(staffTable.isActive, true));
    const photographers = rows
      .filter((row) => {
        const perms = Array.isArray(row.permissions) ? (row.permissions as string[]) : [];
        return row.role === "admin" || perms.some((p) => p.startsWith("photography"));
      })
      .map((row) => ({ id: row.id, name: row.name }));
    return json({ photographers });
  }
  if (method === "POST" && resource === "orders") {
    const payload = await requestBody(req);
    let result: Awaited<ReturnType<typeof createOrder>>;
    try {
      result = await createOrder(payload);
    } catch (submissionError) {
      // The order row is created before optional operational integrations
      // (notifications, tasks, invoice projection and external services). A
      // failure there must not make a durable customer booking look failed.
      const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const phone = normalizeIraqiPhone(String(input.phone ?? ""));
      const customerName = String(input.customerName ?? "").trim();
      const [durableOrder] = phone && customerName
        ? await db
            .select()
            .from(graduationOrdersTable)
            .where(and(
              eq(graduationOrdersTable.phone, phone),
              eq(graduationOrdersTable.customerName, customerName),
              eq(graduationOrdersTable.status, "submitted"),
              isNull(graduationOrdersTable.archivedAt),
              sql`${graduationOrdersTable.createdAt} > now() - interval '10 minutes'`,
            ))
            .orderBy(desc(graduationOrdersTable.createdAt))
            .limit(1)
        : [];
      if (durableOrder) {
        console.error("graduation booking completed with deferred integration", {
          orderId: durableOrder.id,
          error: submissionError instanceof Error ? submissionError.message : submissionError,
        });
        return json({
          order: publicOrder(durableOrder),
          warning: "تم استلام طلبك بنجاح. سيُستكمل إجراء داخلي تلقائياً دون الحاجة لإعادة الإرسال.",
        }, 201);
      }
      throw submissionError;
    }
    if (result.response || !result.order?.id)
      return result.response ?? json(result, 201);

    // The order is already durable at this point. Enterprise kit/material
    // projection must never turn a successful customer booking into a false
    // 500 response; it is idempotent and is retried by the production flows.
    let warning: string | undefined;
    try {
      await syncGraduationEnterpriseOrder(result.order.id);
    } catch (syncError) {
      console.error("graduation enterprise projection deferred", {
        orderId: result.order.id,
        error: syncError instanceof Error ? syncError.message : syncError,
      });
      warning = "تم استلام الطلب بنجاح. سيُستكمل تجهيز ملف الإنتاج تلقائياً من مركز الحجوزات.";
    }
    return json({ ...result, ...(warning ? { warning } : {}) }, 201);
  }
  if (method === "GET" && resource === "track" && parts[2]) {
    const order = await db.query.graduationOrdersTable.findFirst({
      where: eq(graduationOrdersTable.qrToken, parts[2]),
    });
    if (!order) return error("طلب التخرج غير موجود", 404);
    const [timeline, previews, approvals] = await Promise.all([
      db
        .select()
        .from(entityTimelineTable)
        .where(
          and(
            eq(entityTimelineTable.entityType, "graduation_order"),
            eq(entityTimelineTable.entityId, order.id),
          ),
        )
        .orderBy(asc(entityTimelineTable.createdAt)),
      db
        .select()
        .from(graduationPreviewsTable)
        .where(eq(graduationPreviewsTable.graduationOrderId, order.id))
        .orderBy(desc(graduationPreviewsTable.version)),
      db
        .select()
        .from(graduationApprovalsTable)
        .where(eq(graduationApprovalsTable.graduationOrderId, order.id))
        .orderBy(desc(graduationApprovalsTable.createdAt)),
    ]);
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
      preview: previews[0] ?? null,
      approval: approvals[0]
        ? {
            status: approvals[0].status,
            note: approvals[0].note,
            approvedVersion: approvals[0].approvedVersion,
            respondedAt: approvals[0].respondedAt,
          }
        : null,
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
    const payload = await requestBody(req);
    const action = payload?.action === "correction" ? "correction" : "approve";
    const latestPreview = await db.query.graduationPreviewsTable.findFirst({
      where: eq(graduationPreviewsTable.graduationOrderId, order.id),
      orderBy: [desc(graduationPreviewsTable.version)],
    });
    let approval = await db.query.graduationApprovalsTable.findFirst({
      where: eq(graduationApprovalsTable.graduationOrderId, order.id),
      orderBy: [desc(graduationApprovalsTable.createdAt)],
    });
    if (!approval) {
      [approval] = await db
        .insert(graduationApprovalsTable)
        .values({
          graduationOrderId: order.id,
          previewId: latestPreview?.id ?? null,
          approvalToken:
            randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
          status: "pending",
        })
        .returning();
    }
    const nextStatus =
      action === "approve" ? "approved" : "correction_requested";
    await db
      .update(graduationApprovalsTable)
      .set({
        status: nextStatus,
        note: String(payload?.note ?? "").trim() || null,
        signatureDataUrl: String(payload?.signature ?? "").trim() || null,
        approvedVersion:
          action === "approve" ? latestPreview?.version ?? null : null,
        respondedAt: new Date(),
      })
      .where(eq(graduationApprovalsTable.id, approval.id));
    const [saved] = await db
      .update(graduationOrdersTable)
      .set({
        designApprovedAt: action === "approve" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(graduationOrdersTable.id, order.id))
      .returning();
    await addTimeline(
      order.id,
      action === "approve"
        ? "design_approved"
        : "design_correction_requested",
      action === "approve"
        ? "وافق الطالب على التصميم"
        : "طلب الطالب تصحيح التصميم",
      null,
      {
        note: String(payload?.note ?? ""),
        previewVersion: latestPreview?.version ?? null,
      },
    );
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

  if (resource === "media") {
    await ensureGraduationMediaTables();
    if (method !== "GET" && !canManageGraduationMedia(user)) return error("لا تملك صلاحية إدارة معرض التخرج", 403);
    if (method === "GET" && !parts[1]) return json(await listGraduationMedia(false, req.nextUrl.searchParams.get("includeArchived") === "true"));
    if (method === "POST" && parts[1] === "reorder") {
      const payload = await requestBody(req);
      const ids: number[] = Array.isArray(payload?.ids)
        ? Array.from(
            new Set<number>(
              payload.ids
                .map(Number)
                .filter((id: number) => Number.isFinite(id) && id > 0),
            ),
          )
        : [];
      if (!ids.length) return error("لم يتم إرسال ترتيب صالح", 400);
      await Promise.all(ids.map((id, displayOrder) => db.update(galleryItemsTable).set({ displayOrder, updatedAt: new Date() }).where(and(eq(galleryItemsTable.id, id), eq(galleryItemsTable.scope, "graduation")))));
      await auditGraduationMedia(user, "graduation_media_reordered", ids[0], { ids });
      return json({ items: (await listGraduationMedia(false, true)).items });
    }
    if (method === "POST" && !parts[1]) {
      const payload = await requestBody(req); const values = Array.isArray(payload?.items) ? payload.items : [payload];
      if (!values.length || values.length > 20) return error("يمكن رفع 20 ملفاً في العملية الواحدة", 400);
      const [maxOrder] = await db.select({ value: sql<number>`coalesce(max(${galleryItemsTable.displayOrder}),-1)::int` }).from(galleryItemsTable).where(eq(galleryItemsTable.scope, "graduation"));
      const created = [];
      try {
        for (let index = 0; index < values.length; index++) {
          const parsed = graduationMediaCreateSchema.safeParse(values[index]);
          if (!parsed.success) return error("تحقق من بيانات الوسائط", 400, parsed.error.issues);
          const data = parsed.data;
          validateGraduationMediaValue(data.mediaUrl, data.mediaType, "الوسيط");
          if (data.mediaType === "video" && !data.thumbnailUrl) return error("أضف صورة مصغرة للفيديو", 400);
          if (data.thumbnailUrl) validateGraduationMediaValue(data.thumbnailUrl, "image", "الصورة المصغرة");
          const mediaUrl = await persistMedia(data.mediaUrl, `graduation/gallery/${data.mediaType === "video" ? "videos" : "images"}`);
          const thumbnailUrl = data.thumbnailUrl ? await persistMedia(data.thumbnailUrl, "graduation/gallery/thumbnails") : null;
          const [row] = await db.insert(galleryItemsTable).values({
            mediaUrl: String(mediaUrl), mediaType: data.mediaType, imageMetadata: data.imageMetadata,
            title: data.title || null, titleAr: data.title || null, description: data.description || null,
            thumbnailUrl, category: data.category, scope: "graduation", displayLocation: data.displayLocation,
            displayOrder: data.displayOrder || Number(maxOrder?.value ?? -1) + index + 1,
            isActive: data.isActive, isFeatured: data.isFeatured, customerVisible: data.customerVisible,
          }).returning();
          await replaceGraduationMediaLinks(row, data.templateIds, data.packageIds, data.isPrimary);
          await auditGraduationMedia(user, "graduation_media_uploaded", row.id, { mediaType: row.mediaType, category: row.category, templateIds: data.templateIds, packageIds: data.packageIds });
          created.push(row);
        }
      } catch (err: any) { return error(err?.message || "تعذر حفظ الوسائط", 400); }
      return json({ items: created }, 201);
    }
    const mediaId = Number(parts[1]);
    if (!Number.isFinite(mediaId)) return error("معرف الوسيط غير صحيح", 400);
    const current = await db.query.galleryItemsTable.findFirst({ where: and(eq(galleryItemsTable.id, mediaId), eq(galleryItemsTable.scope, "graduation")) });
    if (!current) return error("الوسيط غير موجود", 404);
    if (method === "POST" && parts[2] === "action") {
      const payload = await requestBody(req); const action = String(payload?.action || ""); const now = new Date();
      if (!["archive", "restore", "delete"].includes(action)) return error("الإجراء غير مدعوم", 400);
      const restoredState = current.deletedAt
        ? { archivedAt: null, deletedAt: null, isActive: true, customerVisible: true, updatedAt: now }
        : { archivedAt: null, deletedAt: null, updatedAt: now };
      const [saved] = await db.update(galleryItemsTable).set(action === "archive" ? { archivedAt: now, updatedAt: now } : action === "delete" ? { deletedAt: now, isActive: false, customerVisible: false, updatedAt: now } : restoredState).where(eq(galleryItemsTable.id, mediaId)).returning();
      const links = await db.select().from(graduationMediaLinksTable).where(eq(graduationMediaLinksTable.mediaId, mediaId));
      if (action !== "restore") for (const link of links) await repairPrimaryMediaTarget(link, saved);
      await auditGraduationMedia(user, `graduation_media_${action}d`, mediaId, { linkedTargets: links.length, softDelete: action === "delete" });
      return json({ item: saved });
    }
    if (method === "PATCH") {
      const parsed = graduationMediaPatchSchema.safeParse(await requestBody(req));
      if (!parsed.success) return error("تحقق من بيانات الوسيط", 400, parsed.error.issues);
      const data = parsed.data; const effectiveType = data.mediaType || (current.mediaType as "image" | "video");
      try {
        if (data.mediaUrl) validateGraduationMediaValue(data.mediaUrl, effectiveType, "الوسيط");
        if (data.thumbnailUrl) validateGraduationMediaValue(data.thumbnailUrl, "image", "الصورة المصغرة");
        const mediaUrl = data.mediaUrl ? await persistMedia(data.mediaUrl, `graduation/gallery/${effectiveType === "video" ? "videos" : "images"}`) : current.mediaUrl;
        const thumbnailUrl = data.thumbnailUrl !== undefined ? (data.thumbnailUrl ? await persistMedia(data.thumbnailUrl, "graduation/gallery/thumbnails") : null) : current.thumbnailUrl;
        if (effectiveType === "video" && !thumbnailUrl) return error("أضف صورة مصغرة للفيديو", 400);
        const [saved] = await db.update(galleryItemsTable).set({
          mediaType: effectiveType, mediaUrl: String(mediaUrl), thumbnailUrl,
          title: data.title === undefined ? current.title : data.title || null,
          titleAr: data.title === undefined ? current.titleAr : data.title || null,
          description: data.description === undefined ? current.description : data.description || null,
          category: data.category ?? current.category, displayLocation: data.displayLocation ?? current.displayLocation,
          displayOrder: data.displayOrder ?? current.displayOrder, isActive: data.isActive ?? current.isActive,
          isFeatured: data.isFeatured ?? current.isFeatured, customerVisible: data.customerVisible ?? current.customerVisible,
          imageMetadata: data.imageMetadata ?? current.imageMetadata, updatedAt: new Date(),
        }).where(eq(galleryItemsTable.id, mediaId)).returning();
        const oldLinks = await db.select().from(graduationMediaLinksTable).where(eq(graduationMediaLinksTable.mediaId, mediaId));
        const templateIds = data.templateIds ?? oldLinks.map((link) => link.templateId).filter((id): id is number => Boolean(id));
        const packageIds = data.packageIds ?? oldLinks.map((link) => link.packageId).filter((id): id is number => Boolean(id));
        const isPrimary = data.isPrimary ?? oldLinks.some((link) => link.isPrimary);
        if (data.templateIds || data.packageIds || data.isPrimary !== undefined || data.mediaUrl || data.thumbnailUrl !== undefined) await replaceGraduationMediaLinks(saved, templateIds, packageIds, isPrimary);
        if (!saved.isActive || !saved.customerVisible) for (const link of oldLinks) await repairPrimaryMediaTarget(link, saved);
        await auditGraduationMedia(user, "graduation_media_updated", mediaId, { changes: Object.keys(data), old: { title: current.title, category: current.category, isActive: current.isActive, customerVisible: current.customerVisible }, next: { title: saved.title, category: saved.category, isActive: saved.isActive, customerVisible: saved.customerVisible } });
        return json({ item: saved });
      } catch (err: any) { return error(err?.message || "تعذر تحديث الوسيط", 400); }
    }
    return null;
  }

  if (method === "GET" && resource === "dashboard") {
    const [stageRows, totals, delayed, resources, todayCount, measurementRows] =
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
        db
          .select({
            none: sql<number>`count(*) filter (where ${graduationMeasurementNoneCondition()})::int`,
            partial: sql<number>`count(*) filter (where not (${graduationMeasurementCompleteCondition()}) and not (${graduationMeasurementNoneCondition()}))::int`,
            complete: sql<number>`count(*) filter (where ${graduationMeasurementCompleteCondition()})::int`,
          })
          .from(graduationOrdersTable)
          .where(
            sql`${graduationOrdersTable.archivedAt} is null and ${graduationOrdersTable.status} <> 'cancelled'`,
          ),
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
        measurementsNone: measurementRows[0]?.none ?? 0,
        measurementsPartial: measurementRows[0]?.partial ?? 0,
        measurementsComplete: measurementRows[0]?.complete ?? 0,
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
  if (method === "DELETE" && resource === "orders" && parts[1]) {
    if (!canDeleteIndividualGraduationOrder(user))
      return error("لا تملك صلاحية حذف حجوزات التخرج الفردية", 403);

    const id = Number(parts[1]);
    if (!Number.isInteger(id) || id <= 0)
      return error("معرف طلب التخرج غير صحيح", 400);

    const order = await db.query.graduationOrdersTable.findFirst({
      where: eq(graduationOrdersTable.id, id),
    });
    if (!order) return error("طلب التخرج غير موجود", 404);
    if (order.groupId)
      return error("لا يمكن حذف حجز جماعي من شاشة الحجوزات الفردية", 409);
    if (order.archivedAt)
      return error("تم حذف هذا الحجز مسبقاً", 409);
    if (
      order.productionStage !== "new" ||
      ["ready", "delivered"].includes(order.status)
    )
      return error(
        "لا يمكن حذف حجز بدأ إنتاجه أو أصبح جاهزاً للتسليم. استخدم إجراء الإلغاء المعتمد.",
        409,
      );
    if (money(order.paidAmount) > 0)
      return error(
        "لا يمكن حذف حجز عليه دفعة. اعكس أو ألغِ الدفعة أولاً.",
        409,
      );

    if (order.invoiceId) {
      const invoice = await db.query.salesInvoicesTable.findFirst({
        where: eq(salesInvoicesTable.id, order.invoiceId),
      });
      if (invoice && money(invoice.paidAmount) > 0)
        return error(
          "لا يمكن حذف حجز مرتبط بفاتورة مدفوعة. اعكس أو ألغِ الدفعة أولاً.",
          409,
        );
    }

    // Cancellation restores inventory, cancels the linked invoice, and clears
    // its payment target before the booking is hidden from operational lists.
    const cancellation = await updateOrder(order, { status: "cancelled" }, user);
    if (cancellation.response) return cancellation.response;

    const now = new Date();
    const [archived] = await db.transaction(async (tx) => {
      await tx
        .update(tasksTable)
        .set({ status: "cancelled", updatedAt: now })
        .where(
          and(
            eq(tasksTable.relatedType, "graduation_order"),
            eq(tasksTable.relatedId, order.id),
            sql`${tasksTable.status} not in ('completed', 'cancelled')`,
          ),
        );
      return tx
        .update(graduationOrdersTable)
        .set({ archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(graduationOrdersTable.id, order.id),
            isNull(graduationOrdersTable.archivedAt),
          ),
        )
        .returning();
    });
    if (!archived) return error("تعذر حذف الحجز، حاول مرة أخرى", 409);

    await addTimeline(
      archived.id,
      "individual_booking_deleted",
      "تم إلغاء وأرشفة الحجز الفردي",
      user,
      { orderNo: archived.orderNo, archivedAt: now.toISOString() },
    );
    await addActivity(user, "graduation_individual_booking_deleted", archived.id, {
      orderNo: archived.orderNo,
      cancelledBeforeArchive: true,
    });
    return json({ order: publicOrder(archived), archived: true });
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
    if (!result.response && result.order?.id)
      await syncGraduationEnterpriseOrder(result.order.id, user);
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
    if (method === "DELETE" && parts[1]) {
      if (!canDeleteGraduationGroup(user))
        return error("لا تملك صلاحية حذف الحجوزات الجماعية", 403);
      const groupId = Number(parts[1]);
      if (!Number.isInteger(groupId) || groupId <= 0)
        return error("معرف المجموعة غير صحيح", 400);
      const group = await db.query.graduationGroupsTable.findFirst({
        where: eq(graduationGroupsTable.id, groupId),
      });
      if (!group) return error("المجموعة غير موجودة", 404);
      const [usage] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(graduationOrdersTable)
        .where(eq(graduationOrdersTable.groupId, groupId));
      if ((usage?.count ?? 0) > 0)
        return error(
          `لا يمكن حذف المجموعة لأنها مرتبطة بـ ${usage?.count ?? 0} طلب طالب. أغلق التسجيل أو ألغِ الطلبات وفق إجراءاتها أولاً.`,
          409,
        );
      await db.delete(graduationGroupsTable).where(eq(graduationGroupsTable.id, groupId));
      await addActivity(user, "graduation_group_deleted", groupId, {
        groupNo: group.groupNo,
        title: group.title,
      }, "graduation_group");
      return json({ ok: true, id: groupId });
    }
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
