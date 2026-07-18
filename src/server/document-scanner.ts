import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";

/**
 * Storage for scanned identity documents.
 *
 * Images are held in the database and served ONLY through an authenticated,
 * audited endpoint — deliberately not through the shared media helper, which
 * publishes a public Supabase URL. Identity documents must never be reachable
 * by URL alone.
 */

const rows = <T = any>(result: any): T[] => (result?.rows ?? result ?? []) as T[];

export const DOCUMENT_TYPES = [
  // Identity
  "national_id", "civil_id", "residence_card", "passport", "driving_license",
  "ration_card", "employee_id", "student_id",
  // Civil records
  "birth_certificate", "marriage_certificate", "university_certificate", "certificate",
  // Commercial
  "invoice", "receipt", "contract", "rental_agreement", "insurance",
  // Files
  "employee_file", "supplier_file", "vehicle_registration",
  "custom",
] as const;

export const OWNER_TYPES = [
  "customer", "staff", "supplier", "order", "booking", "graduation_order",
  "printing_job", "asset", "vehicle", "rental", "invoice", "contract",
] as const;

/** Documents whose expiry is worth tracking and warning about. */
export const EXPIRING_DOCUMENT_TYPES: readonly string[] = [
  "national_id", "civil_id", "residence_card", "passport", "driving_license",
  "insurance", "rental_agreement", "contract", "vehicle_registration",
];

/** Warning thresholds, in days before expiry. */
export const EXPIRY_THRESHOLDS = [90, 30, 7, 1] as const;

/** Arabic labels, shared by notifications and the admin views. */
export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  national_id: "البطاقة الوطنية",
  civil_id: "هوية الأحوال المدنية",
  residence_card: "بطاقة السكن",
  passport: "جواز السفر",
  driving_license: "إجازة السوق",
  ration_card: "البطاقة التموينية",
  employee_id: "هوية موظف",
  student_id: "هوية طالب",
  birth_certificate: "شهادة الميلاد",
  marriage_certificate: "عقد الزواج",
  university_certificate: "الشهادة الجامعية",
  certificate: "شهادة",
  invoice: "فاتورة",
  receipt: "وصل",
  contract: "عقد",
  rental_agreement: "عقد إيجار",
  insurance: "تأمين",
  employee_file: "ملف موظف",
  supplier_file: "ملف مورّد",
  vehicle_registration: "سنوية مركبة",
  custom: "مستمسك مخصص",
};

/** Actions recorded in the audit log. Image bytes never accompany these. */
export const SCANNER_ACTIONS = [
  "document_captured", "document_uploaded", "scan_enhanced", "corners_adjusted",
  "document_printed", "pdf_exported", "document_saved", "document_deleted",
  "document_viewed", "original_viewed",
] as const;

const dataUrlImage = z
  .string()
  .max(20_000_000)
  .refine((v) => /^data:image\/(jpeg|png|webp);base64,/.test(v), {
    message: "صيغة الصورة غير مدعومة",
  });

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** One scanned page. `side` keeps the legacy front/back meaning for ID cards. */
export const documentPageSchema = z.object({
  side: z.enum(["front", "back", "page"]).default("page"),
  image: dataUrlImage,
  widthPx: z.coerce.number().int().min(1).max(20000).optional().nullable(),
  heightPx: z.coerce.number().int().min(1).max(20000).optional().nullable(),
  widthMm: z.coerce.number().min(1).max(2000).optional().nullable(),
  heightMm: z.coerce.number().min(1).max(2000).optional().nullable(),
  ocrText: z.string().max(200_000).optional().nullable(),
});

/**
 * Extracted / entered document fields. OCR only ever pre-fills these — the user
 * confirms or corrects them before saving, so nothing machine-read is trusted.
 */
export const documentFieldsSchema = z.object({
  title: z.string().trim().max(300).optional().nullable(),
  documentNumber: z.string().trim().max(120).optional().nullable(),
  fullName: z.string().trim().max(300).optional().nullable(),
  nationalId: z.string().trim().max(60).optional().nullable(),
  passportNumber: z.string().trim().max(60).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  issueDate: z.string().regex(DATE_ONLY).optional().nullable(),
  expiryDate: z.string().regex(DATE_ONLY).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional().default([]),
  ocrText: z.string().max(500_000).optional().nullable(),
  ocrLanguage: z.string().trim().max(20).optional().nullable(),
});

export const saveDocumentSchema = documentFieldsSchema.extend({
  documentType: z.enum(DOCUMENT_TYPES),
  ownerType: z.enum(OWNER_TYPES).optional().nullable(),
  ownerId: z.coerce.number().int().positive().optional().nullable(),
  ownerName: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  // Legacy single/double-sided payload, still accepted.
  frontImage: dataUrlImage.optional().nullable(),
  backImage: dataUrlImage.optional().nullable(),
  widthMm: z.coerce.number().min(1).max(2000).optional().nullable(),
  heightMm: z.coerce.number().min(1).max(2000).optional().nullable(),
  // Multi-page payload.
  pages: z.array(documentPageSchema).max(60).optional().default([]),
}).refine((v) => Boolean(v.frontImage || v.backImage || v.pages.length), {
  message: "أرفق صفحة واحدة على الأقل",
});

export const updateDocumentSchema = documentFieldsSchema.extend({
  documentType: z.enum(DOCUMENT_TYPES).optional(),
  ownerType: z.enum(OWNER_TYPES).optional().nullable(),
  ownerId: z.coerce.number().int().positive().optional().nullable(),
  ownerName: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  changeSummary: z.string().trim().max(500).optional().nullable(),
});

export const auditActionSchema = z.object({
  action: z.enum(SCANNER_ACTIONS),
  documentType: z.string().trim().max(40).optional(),
  ownerType: z.string().trim().max(40).optional().nullable(),
  ownerId: z.coerce.number().int().positive().optional().nullable(),
  format: z.string().trim().max(20).optional().nullable(),
  copies: z.coerce.number().int().min(0).max(999).optional().nullable(),
});

let scannerMigrated = false;

/** Runtime provisioning, matching the rest of the codebase's pattern. */
export async function ensureScannerTables() {
  if (scannerMigrated) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS scanned_documents (
        id SERIAL PRIMARY KEY,
        document_type VARCHAR(40) NOT NULL,
        owner_type VARCHAR(40),
        owner_id INTEGER,
        owner_name TEXT,
        notes TEXT,
        front_image TEXT,
        back_image TEXT,
        width_mm NUMERIC(8,2),
        height_mm NUMERIC(8,2),
        created_by INTEGER REFERENCES staff(id),
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP,
        deleted_by INTEGER REFERENCES staff(id),
        delete_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS scanned_documents_owner_idx
        ON scanned_documents(owner_type, owner_id);
      CREATE INDEX IF NOT EXISTS scanned_documents_created_idx
        ON scanned_documents(created_at DESC);

      -- Enterprise metadata. Every column is additive so existing rows survive.
      ALTER TABLE scanned_documents
        ADD COLUMN IF NOT EXISTS title TEXT,
        ADD COLUMN IF NOT EXISTS document_number TEXT,
        ADD COLUMN IF NOT EXISTS full_name TEXT,
        ADD COLUMN IF NOT EXISTS national_id TEXT,
        ADD COLUMN IF NOT EXISTS passport_number TEXT,
        ADD COLUMN IF NOT EXISTS phone VARCHAR(30),
        ADD COLUMN IF NOT EXISTS issue_date DATE,
        ADD COLUMN IF NOT EXISTS expiry_date DATE,
        ADD COLUMN IF NOT EXISTS ocr_text TEXT,
        ADD COLUMN IF NOT EXISTS ocr_language VARCHAR(20),
        ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS qr_token VARCHAR(80),
        ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_by INTEGER,
        ADD COLUMN IF NOT EXISTS updated_by_name TEXT;

      CREATE INDEX IF NOT EXISTS scanned_documents_expiry_idx
        ON scanned_documents(expiry_date) WHERE expiry_date IS NOT NULL;
      CREATE INDEX IF NOT EXISTS scanned_documents_number_idx
        ON scanned_documents(document_number);
      CREATE UNIQUE INDEX IF NOT EXISTS scanned_documents_qr_idx
        ON scanned_documents(qr_token) WHERE qr_token IS NOT NULL;

      /*
       * Pages. An image lives EITHER at storage_path (an object path, never a
       * public URL) OR inline as base64 when object storage is unavailable.
       * Both are read back only through the authenticated proxy endpoint.
       */
      CREATE TABLE IF NOT EXISTS scanned_document_pages (
        id SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES scanned_documents(id) ON DELETE CASCADE,
        page_index INTEGER NOT NULL DEFAULT 0,
        side VARCHAR(20) NOT NULL DEFAULT 'page',
        storage_path TEXT,
        inline_data TEXT,
        mime_type VARCHAR(60) NOT NULL DEFAULT 'image/jpeg',
        width_px INTEGER,
        height_px INTEGER,
        width_mm NUMERIC(8,2),
        height_mm NUMERIC(8,2),
        ocr_text TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS scanned_document_pages_doc_idx
        ON scanned_document_pages(document_id, page_index);

      -- Version history keeps metadata snapshots only; page images are not duplicated.
      CREATE TABLE IF NOT EXISTS scanned_document_versions (
        id SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES scanned_documents(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        change_summary TEXT,
        created_by INTEGER REFERENCES staff(id),
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS scanned_document_versions_doc_idx
        ON scanned_document_versions(document_id, version DESC);
    `);
    scannerMigrated = true;
  } catch (err) {
    console.warn("scanned_documents provisioning failed", err);
    scannerMigrated = true;
  }
}

// ─── Protected object storage ───────────────────────────────────────────────

const STORAGE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const STORAGE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "media";

/** Documents live under their own prefix, away from public media. */
const SECURE_PREFIX = "secure-documents";

function extensionFor(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("pdf")) return "pdf";
  return "jpg";
}

/**
 * Uploads a page to object storage and returns its PATH — never a URL.
 *
 * The path alone is not a link: reads go through the authenticated proxy, which
 * fetches with the service key. Callers fall back to inline base64 when storage
 * is not configured, so the feature still works without it.
 */
export async function uploadDocumentAsset(
  dataUrl: string,
  documentId: number,
): Promise<{ storagePath: string | null; inlineData: string | null; mime: string }> {
  const decoded = decodeDataUrl(dataUrl);
  const mime = decoded?.mime ?? "image/jpeg";
  if (!decoded || !STORAGE_URL || !STORAGE_SERVICE_KEY) {
    return { storagePath: null, inlineData: dataUrl, mime };
  }
  const path = `${SECURE_PREFIX}/${documentId}/${Date.now()}-${randomUUID()}.${extensionFor(mime)}`;
  try {
    const res = await fetch(
      `${STORAGE_URL.replace(/\/$/, "")}/storage/v1/object/${STORAGE_BUCKET}/${path}`,
      {
        method: "POST",
        headers: {
          apikey: STORAGE_SERVICE_KEY,
          authorization: `Bearer ${STORAGE_SERVICE_KEY}`,
          "content-type": mime,
          "x-upsert": "true",
        },
        body: new Uint8Array(decoded.bytes),
      },
    );
    if (!res.ok) {
      console.warn("document asset upload failed", { status: res.status });
      return { storagePath: null, inlineData: dataUrl, mime };
    }
    return { storagePath: path, inlineData: null, mime };
  } catch (err) {
    console.warn("document asset upload failed", err);
    return { storagePath: null, inlineData: dataUrl, mime };
  }
}

/** Fetches a stored object with the service key. Never exposed to the client. */
export async function readDocumentAsset(
  storagePath: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!STORAGE_URL || !STORAGE_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${STORAGE_URL.replace(/\/$/, "")}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`,
      { headers: { apikey: STORAGE_SERVICE_KEY, authorization: `Bearer ${STORAGE_SERVICE_KEY}` } },
    );
    if (!res.ok) return null;
    return {
      mime: res.headers.get("content-type") ?? "image/jpeg",
      bytes: Buffer.from(await res.arrayBuffer()),
    };
  } catch {
    return null;
  }
}

export type SaveDocumentInput = z.infer<typeof saveDocumentSchema> & {
  createdBy: number | null;
  createdByName: string;
};

/**
 * Creates the document row, then stores each page. Legacy front/back payloads
 * are normalised into pages so old and new callers converge on one structure.
 */
export async function saveScannedDocument(input: SaveDocumentInput): Promise<number> {
  await ensureScannerTables();
  const qrToken = randomUUID().replace(/-/g, "").slice(0, 32);

  const result = await db.execute(sql`
    insert into scanned_documents (
      document_type, owner_type, owner_id, owner_name, notes,
      width_mm, height_mm, created_by, created_by_name,
      title, document_number, full_name, national_id, passport_number, phone,
      issue_date, expiry_date, ocr_text, ocr_language, tags, qr_token,
      version, updated_by, updated_by_name
    ) values (
      ${input.documentType}, ${input.ownerType ?? null}, ${input.ownerId ?? null},
      ${input.ownerName ?? null}, ${input.notes ?? null},
      ${input.widthMm ?? null}, ${input.heightMm ?? null},
      ${input.createdBy}, ${input.createdByName},
      ${input.title ?? null}, ${input.documentNumber ?? null}, ${input.fullName ?? null},
      ${input.nationalId ?? null}, ${input.passportNumber ?? null}, ${input.phone ?? null},
      ${input.issueDate ?? null}, ${input.expiryDate ?? null},
      ${input.ocrText ?? null}, ${input.ocrLanguage ?? null},
      ${JSON.stringify(input.tags ?? [])}::jsonb, ${qrToken},
      1, ${input.createdBy}, ${input.createdByName}
    ) returning id
  `);
  const id = Number(rows(result)[0]?.id);
  if (!id) throw new Error("تعذر إنشاء سجل المستمسك");

  // Normalise legacy front/back into the page list.
  const pages = [
    ...(input.frontImage ? [{ side: "front" as const, image: input.frontImage }] : []),
    ...(input.backImage ? [{ side: "back" as const, image: input.backImage }] : []),
    ...(input.pages ?? []),
  ];

  let index = 0;
  for (const page of pages) {
    const stored = await uploadDocumentAsset(page.image, id);
    await db.execute(sql`
      insert into scanned_document_pages (
        document_id, page_index, side, storage_path, inline_data, mime_type,
        width_px, height_px, width_mm, height_mm, ocr_text
      ) values (
        ${id}, ${index}, ${(page as any).side ?? "page"},
        ${stored.storagePath}, ${stored.inlineData}, ${stored.mime},
        ${(page as any).widthPx ?? null}, ${(page as any).heightPx ?? null},
        ${(page as any).widthMm ?? input.widthMm ?? null},
        ${(page as any).heightMm ?? input.heightMm ?? null},
        ${(page as any).ocrText ?? null}
      )
    `);
    index += 1;
  }

  await db.execute(sql`update scanned_documents set page_count = ${index} where id = ${id}`);
  await recordDocumentVersion(id, 1, "إنشاء المستمسك", input.createdBy, input.createdByName);
  return id;
}

/** Appends a metadata snapshot to the version history. Images are not copied. */
export async function recordDocumentVersion(
  documentId: number,
  version: number,
  changeSummary: string,
  createdBy: number | null,
  createdByName: string,
): Promise<void> {
  const snapshot = rows(
    await db.execute(sql`
      select document_type, owner_type, owner_id, owner_name, notes, title,
             document_number, full_name, national_id, passport_number, phone,
             issue_date, expiry_date, tags, page_count, status
      from scanned_documents where id = ${documentId} limit 1
    `),
  )[0] ?? {};
  await db.execute(sql`
    insert into scanned_document_versions (
      document_id, version, snapshot, change_summary, created_by, created_by_name
    ) values (
      ${documentId}, ${version}, ${JSON.stringify(snapshot)}::jsonb,
      ${changeSummary}, ${createdBy}, ${createdByName}
    )
  `);
}

export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema> & {
  updatedBy: number | null;
  updatedByName: string;
};

/** Edits metadata and bumps the version, keeping the previous snapshot. */
export async function updateScannedDocument(
  id: number,
  input: UpdateDocumentInput,
): Promise<boolean> {
  await ensureScannerTables();
  const current = rows(
    await db.execute(sql`select version from scanned_documents where id = ${id} and deleted_at is null limit 1`),
  )[0];
  if (!current) return false;
  const nextVersion = Number(current.version ?? 1) + 1;

  // Snapshot the state BEFORE the edit so history shows what was replaced.
  await recordDocumentVersion(
    id, Number(current.version ?? 1), input.changeSummary ?? "تعديل بيانات المستمسك",
    input.updatedBy, input.updatedByName,
  );

  const set = (v: unknown) => (v === undefined ? null : v);
  await db.execute(sql`
    update scanned_documents set
      document_type   = coalesce(${set(input.documentType)}, document_type),
      owner_type      = ${input.ownerType === undefined ? sql`owner_type` : sql`${input.ownerType}`},
      owner_id        = ${input.ownerId === undefined ? sql`owner_id` : sql`${input.ownerId}`},
      owner_name      = ${input.ownerName === undefined ? sql`owner_name` : sql`${input.ownerName}`},
      notes           = ${input.notes === undefined ? sql`notes` : sql`${input.notes}`},
      title           = ${input.title === undefined ? sql`title` : sql`${input.title}`},
      document_number = ${input.documentNumber === undefined ? sql`document_number` : sql`${input.documentNumber}`},
      full_name       = ${input.fullName === undefined ? sql`full_name` : sql`${input.fullName}`},
      national_id     = ${input.nationalId === undefined ? sql`national_id` : sql`${input.nationalId}`},
      passport_number = ${input.passportNumber === undefined ? sql`passport_number` : sql`${input.passportNumber}`},
      phone           = ${input.phone === undefined ? sql`phone` : sql`${input.phone}`},
      issue_date      = ${input.issueDate === undefined ? sql`issue_date` : sql`${input.issueDate}`},
      expiry_date     = ${input.expiryDate === undefined ? sql`expiry_date` : sql`${input.expiryDate}`},
      ocr_text        = ${input.ocrText === undefined ? sql`ocr_text` : sql`${input.ocrText}`},
      ocr_language    = ${input.ocrLanguage === undefined ? sql`ocr_language` : sql`${input.ocrLanguage}`},
      tags            = ${input.tags === undefined ? sql`tags` : sql`${JSON.stringify(input.tags)}::jsonb`},
      version         = ${nextVersion},
      updated_at      = NOW(),
      updated_by      = ${input.updatedBy},
      updated_by_name = ${input.updatedByName}
    where id = ${id} and deleted_at is null
  `);
  return true;
}

export async function listDocumentPages(documentId: number) {
  await ensureScannerTables();
  return rows(
    await db.execute(sql`
      select id, page_index, side, mime_type, width_px, height_px, width_mm, height_mm,
             (storage_path is not null or inline_data is not null) as has_image
      from scanned_document_pages
      where document_id = ${documentId}
      order by page_index asc
    `),
  ).map((r: any) => ({
    id: Number(r.id),
    pageIndex: Number(r.page_index),
    side: r.side,
    mimeType: r.mime_type,
    widthPx: r.width_px ? Number(r.width_px) : null,
    heightPx: r.height_px ? Number(r.height_px) : null,
    widthMm: r.width_mm ? Number(r.width_mm) : null,
    heightMm: r.height_mm ? Number(r.height_mm) : null,
    hasImage: Boolean(r.has_image),
  }));
}

/** Resolves one page to bytes, from object storage or the inline fallback. */
export async function getDocumentPageBytes(
  documentId: number,
  pageId: number,
): Promise<{ mime: string; bytes: Buffer } | null> {
  const row: any = rows(
    await db.execute(sql`
      select storage_path, inline_data, mime_type
      from scanned_document_pages
      where id = ${pageId} and document_id = ${documentId} limit 1
    `),
  )[0];
  if (!row) return null;
  if (row.storage_path) {
    const fetched = await readDocumentAsset(String(row.storage_path));
    if (fetched) return fetched;
  }
  if (row.inline_data) {
    const decoded = decodeDataUrl(String(row.inline_data));
    if (decoded) return decoded;
  }
  return null;
}

export async function listDocumentVersions(documentId: number) {
  await ensureScannerTables();
  return rows(
    await db.execute(sql`
      select id, version, change_summary, created_by_name, created_at, snapshot
      from scanned_document_versions
      where document_id = ${documentId}
      order by version desc limit 50
    `),
  ).map((r: any) => ({
    id: Number(r.id),
    version: Number(r.version),
    changeSummary: r.change_summary,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    snapshot: r.snapshot ?? {},
  }));
}

/** Documents crossing an expiry threshold, for the dashboard and reminders. */
export async function listExpiringDocuments(withinDays = 90) {
  await ensureScannerTables();
  return rows(
    await db.execute(sql`
      select id, document_type, owner_type, owner_id, owner_name, title,
             document_number, full_name, expiry_date,
             (expiry_date - CURRENT_DATE) as days_left
      from scanned_documents
      where deleted_at is null
        and expiry_date is not null
        and expiry_date <= CURRENT_DATE + ${withinDays}
      order by expiry_date asc
      limit 300
    `),
  ).map((r: any) => ({
    id: Number(r.id),
    documentType: r.document_type,
    ownerType: r.owner_type,
    ownerId: r.owner_id ? Number(r.owner_id) : null,
    ownerName: r.owner_name,
    title: r.title,
    documentNumber: r.document_number,
    fullName: r.full_name,
    expiryDate: r.expiry_date,
    daysLeft: r.days_left === null ? null : Number(r.days_left),
  }));
}

/** Counters for the module dashboard. */
export async function scannerDashboardStats() {
  await ensureScannerTables();
  const row: any = rows(
    await db.execute(sql`
      select
        count(*) filter (where created_at::date = CURRENT_DATE)::int as today,
        count(*) filter (where date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE))::int as this_month,
        count(*) filter (where owner_type = 'customer')::int as customers,
        count(*) filter (where owner_type = 'staff')::int as employees,
        count(*) filter (where owner_type = 'supplier')::int as suppliers,
        count(*) filter (where owner_type in ('asset','vehicle'))::int as assets,
        count(*) filter (where document_type in ('contract','rental_agreement'))::int as contracts,
        count(*) filter (where expiry_date is not null and expiry_date <= CURRENT_DATE + 30)::int as expiring_soon,
        count(*) filter (where expiry_date is not null and expiry_date < CURRENT_DATE)::int as expired,
        count(*)::int as total
      from scanned_documents where deleted_at is null
    `),
  )[0] ?? {};
  return {
    today: Number(row.today ?? 0),
    thisMonth: Number(row.this_month ?? 0),
    customers: Number(row.customers ?? 0),
    employees: Number(row.employees ?? 0),
    suppliers: Number(row.suppliers ?? 0),
    assets: Number(row.assets ?? 0),
    contracts: Number(row.contracts ?? 0),
    expiringSoon: Number(row.expiring_soon ?? 0),
    expired: Number(row.expired ?? 0),
    total: Number(row.total ?? 0),
  };
}

/** Metadata only — image columns are deliberately excluded. */
export async function listScannedDocuments(filters: {
  ownerType?: string | null;
  ownerId?: number | null;
  documentType?: string | null;
  /** Free-text across name, number, phone, tags and OCR text. */
  search?: string | null;
  /** "expiring" = within 90 days, "expired" = already past. */
  expiry?: string | null;
  limit?: number;
}) {
  await ensureScannerTables();
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 300);
  const q = filters.search?.trim() ? `%${filters.search.trim()}%` : null;
  const result = await db.execute(sql`
    select id, document_type, owner_type, owner_id, owner_name, notes,
           width_mm, height_mm, created_by_name, created_at, updated_at,
           title, document_number, full_name, national_id, passport_number, phone,
           issue_date, expiry_date, tags, version, page_count, qr_token,
           (expiry_date - CURRENT_DATE) as days_left,
           (front_image is not null) as has_front,
           (back_image is not null) as has_back
    from scanned_documents
    where deleted_at is null
      and (${filters.ownerType ?? null}::text is null or owner_type = ${filters.ownerType ?? null})
      and (${filters.ownerId ?? null}::int is null or owner_id = ${filters.ownerId ?? null})
      and (${filters.documentType ?? null}::text is null or document_type = ${filters.documentType ?? null})
      and (
        ${q}::text is null
        or owner_name ilike ${q} or title ilike ${q} or full_name ilike ${q}
        or document_number ilike ${q} or national_id ilike ${q}
        or passport_number ilike ${q} or phone ilike ${q}
        or ocr_text ilike ${q} or tags::text ilike ${q}
      )
      and (
        ${filters.expiry ?? null}::text is null
        or (${filters.expiry ?? null} = 'expiring'
            and expiry_date is not null and expiry_date >= CURRENT_DATE
            and expiry_date <= CURRENT_DATE + 90)
        or (${filters.expiry ?? null} = 'expired'
            and expiry_date is not null and expiry_date < CURRENT_DATE)
      )
    order by created_at desc
    limit ${limit}
  `);
  return rows(result).map(mapDocumentRow);
}

/** Shared row → payload mapping so list and detail never drift apart. */
function mapDocumentRow(r: any) {
  return {
    id: Number(r.id),
    documentType: r.document_type,
    ownerType: r.owner_type,
    ownerId: r.owner_id ? Number(r.owner_id) : null,
    ownerName: r.owner_name,
    notes: r.notes,
    title: r.title ?? null,
    documentNumber: r.document_number ?? null,
    fullName: r.full_name ?? null,
    nationalId: r.national_id ?? null,
    passportNumber: r.passport_number ?? null,
    phone: r.phone ?? null,
    issueDate: r.issue_date ?? null,
    expiryDate: r.expiry_date ?? null,
    daysLeft: r.days_left === null || r.days_left === undefined ? null : Number(r.days_left),
    tags: Array.isArray(r.tags) ? r.tags : [],
    version: r.version ? Number(r.version) : 1,
    pageCount: r.page_count ? Number(r.page_count) : 0,
    qrToken: r.qr_token ?? null,
    widthMm: r.width_mm ? Number(r.width_mm) : null,
    heightMm: r.height_mm ? Number(r.height_mm) : null,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? null,
    hasFront: Boolean(r.has_front),
    hasBack: Boolean(r.has_back),
  };
}

export async function getScannedDocumentMeta(id: number) {
  await ensureScannerTables();
  const result = await db.execute(sql`
    select id, document_type, owner_type, owner_id, owner_name, notes,
           width_mm, height_mm, created_by_name, created_at, updated_at,
           title, document_number, full_name, national_id, passport_number, phone,
           issue_date, expiry_date, tags, version, page_count, qr_token,
           (expiry_date - CURRENT_DATE) as days_left,
           (front_image is not null) as has_front,
           (back_image is not null) as has_back
    from scanned_documents where id = ${id} and deleted_at is null limit 1
  `);
  const r: any = rows(result)[0];
  if (!r) return null;
  return mapDocumentRow(r);
}

/** Resolves a document by its QR token, for the public-facing QR lookup. */
export async function getScannedDocumentByQr(token: string) {
  await ensureScannerTables();
  const r: any = rows(
    await db.execute(sql`
      select id from scanned_documents
      where qr_token = ${token} and deleted_at is null limit 1
    `),
  )[0];
  return r ? Number(r.id) : null;
}

/** Returns the raw data URL for one side, or null. Callers MUST have verified
 *  the permission and MUST record the access in the audit log. */
export async function getScannedDocumentImage(
  id: number,
  side: "front" | "back",
): Promise<string | null> {
  await ensureScannerTables();
  const column = side === "front" ? sql`front_image` : sql`back_image`;
  const result = await db.execute(sql`
    select ${column} as image from scanned_documents where id = ${id} and deleted_at is null limit 1
  `);
  const value = rows(result)[0]?.image;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Soft delete — the row and its relationships survive for the recycle bin. */
export async function deleteScannedDocument(
  id: number,
  deletedBy: number | null,
  reason: string,
): Promise<boolean> {
  await ensureScannerTables();
  const result = await db.execute(sql`
    update scanned_documents
    set deleted_at = NOW(), deleted_by = ${deletedBy}, delete_reason = ${reason}
    where id = ${id} and deleted_at is null
    returning id
  `);
  return rows(result).length > 0;
}

/** Parses a stored data URL into bytes + mime for streaming to the client. */
export function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  try {
    return { mime: match[1], bytes: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}
