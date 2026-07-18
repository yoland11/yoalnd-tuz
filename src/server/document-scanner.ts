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
  "national_id", "civil_id", "residence_card", "passport", "driving_license",
  "ration_card", "employee_id", "student_id", "certificate", "custom",
] as const;

export const OWNER_TYPES = [
  "customer", "staff", "order", "booking", "graduation_order", "printing_job",
] as const;

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

export const saveDocumentSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  ownerType: z.enum(OWNER_TYPES).optional().nullable(),
  ownerId: z.coerce.number().int().positive().optional().nullable(),
  ownerName: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  frontImage: dataUrlImage.optional().nullable(),
  backImage: dataUrlImage.optional().nullable(),
  widthMm: z.coerce.number().min(1).max(1000).optional().nullable(),
  heightMm: z.coerce.number().min(1).max(1000).optional().nullable(),
}).refine((v) => Boolean(v.frontImage || v.backImage), {
  message: "أرفق وجهاً واحداً على الأقل",
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
    `);
    scannerMigrated = true;
  } catch (err) {
    console.warn("scanned_documents provisioning failed", err);
    scannerMigrated = true;
  }
}

export type SaveDocumentInput = z.infer<typeof saveDocumentSchema> & {
  createdBy: number | null;
  createdByName: string;
};

export async function saveScannedDocument(input: SaveDocumentInput): Promise<number> {
  await ensureScannerTables();
  const result = await db.execute(sql`
    insert into scanned_documents (
      document_type, owner_type, owner_id, owner_name, notes,
      front_image, back_image, width_mm, height_mm, created_by, created_by_name
    ) values (
      ${input.documentType}, ${input.ownerType ?? null}, ${input.ownerId ?? null},
      ${input.ownerName ?? null}, ${input.notes ?? null},
      ${input.frontImage ?? null}, ${input.backImage ?? null},
      ${input.widthMm ?? null}, ${input.heightMm ?? null},
      ${input.createdBy}, ${input.createdByName}
    ) returning id
  `);
  return Number(rows(result)[0]?.id);
}

/** Metadata only — image columns are deliberately excluded. */
export async function listScannedDocuments(filters: {
  ownerType?: string | null;
  ownerId?: number | null;
  documentType?: string | null;
  limit?: number;
}) {
  await ensureScannerTables();
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 300);
  const result = await db.execute(sql`
    select id, document_type, owner_type, owner_id, owner_name, notes,
           width_mm, height_mm, created_by_name, created_at,
           (front_image is not null) as has_front,
           (back_image is not null) as has_back
    from scanned_documents
    where deleted_at is null
      and (${filters.ownerType ?? null}::text is null or owner_type = ${filters.ownerType ?? null})
      and (${filters.ownerId ?? null}::int is null or owner_id = ${filters.ownerId ?? null})
      and (${filters.documentType ?? null}::text is null or document_type = ${filters.documentType ?? null})
    order by created_at desc
    limit ${limit}
  `);
  return rows(result).map((r: any) => ({
    id: Number(r.id),
    documentType: r.document_type,
    ownerType: r.owner_type,
    ownerId: r.owner_id ? Number(r.owner_id) : null,
    ownerName: r.owner_name,
    notes: r.notes,
    widthMm: r.width_mm ? Number(r.width_mm) : null,
    heightMm: r.height_mm ? Number(r.height_mm) : null,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    hasFront: Boolean(r.has_front),
    hasBack: Boolean(r.has_back),
  }));
}

export async function getScannedDocumentMeta(id: number) {
  await ensureScannerTables();
  const result = await db.execute(sql`
    select id, document_type, owner_type, owner_id, owner_name, notes,
           width_mm, height_mm, created_by_name, created_at,
           (front_image is not null) as has_front,
           (back_image is not null) as has_back
    from scanned_documents where id = ${id} and deleted_at is null limit 1
  `);
  const r: any = rows(result)[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    documentType: r.document_type,
    ownerType: r.owner_type,
    ownerId: r.owner_id ? Number(r.owner_id) : null,
    ownerName: r.owner_name,
    notes: r.notes,
    widthMm: r.width_mm ? Number(r.width_mm) : null,
    heightMm: r.height_mm ? Number(r.height_mm) : null,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    hasFront: Boolean(r.has_front),
    hasBack: Boolean(r.has_back),
  };
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
