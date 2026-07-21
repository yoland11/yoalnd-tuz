import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Client-gallery access rules and the operational alert engine.
 *
 * No database access — callers own persistence, so every decision below is directly
 * testable. Access checks in particular must never depend on request context.
 */

/** Share slugs are the primary access control, so they are long and unguessable. */
export function newGallerySlug(): string {
  return randomBytes(12).toString("hex"); // 24 chars, 96 bits
}

export function hashGalleryPassword(plain: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  return { hash: scryptSync(plain, salt, 64).toString("hex"), salt };
}

/** Constant-time comparison; a length mismatch is a miss, never a throw. */
export function verifyGalleryPassword(plain: string, hash: string | null, salt: string | null): boolean {
  if (!hash || !salt) return false;
  const candidate = scryptSync(plain, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export type GalleryAccessInput = {
  isActive: boolean;
  expiresAt: Date | string | null;
  passwordHash: string | null;
  passwordSalt: string | null;
  suppliedPassword: string | null;
  now?: Date;
};

export type GalleryAccess =
  | { ok: true }
  | { ok: false; reason: string; status: number; needsPassword: boolean };

/**
 * Decides whether a visitor may see a gallery.
 *
 * Order matters: a disabled or expired gallery reports as such WITHOUT revealing whether a
 * password would have worked, and a protected gallery reports `needsPassword` so the client
 * can render the prompt rather than an error.
 */
export function evaluateGalleryAccess(input: GalleryAccessInput): GalleryAccess {
  const now = input.now ?? new Date();

  if (!input.isActive) {
    return { ok: false, reason: "هذا المعرض غير متاح حالياً", status: 403, needsPassword: false };
  }

  if (input.expiresAt) {
    const expiry = new Date(input.expiresAt);
    if (Number.isFinite(expiry.getTime()) && expiry.getTime() <= now.getTime()) {
      return { ok: false, reason: "انتهت صلاحية رابط المعرض", status: 410, needsPassword: false };
    }
  }

  const protectedGallery = Boolean(input.passwordHash && input.passwordSalt);
  if (!protectedGallery) return { ok: true };

  if (!input.suppliedPassword) {
    return { ok: false, reason: "هذا المعرض محمي بكلمة مرور", status: 401, needsPassword: true };
  }

  if (!verifyGalleryPassword(input.suppliedPassword, input.passwordHash, input.passwordSalt)) {
    return { ok: false, reason: "كلمة المرور غير صحيحة", status: 401, needsPassword: true };
  }

  return { ok: true };
}

/**
 * Absolute share URL for the client — also the QR payload.
 * `/gallery/:slug` is a distinct frontend route from the exact `/gallery` marketing page.
 */
export function galleryShareUrl(baseUrl: string, slug: string): string {
  return `${String(baseUrl ?? "").replace(/\/$/, "")}/gallery/${slug}`;
}

// ── Operational alerts ───────────────────────────────────────────────────────

export type AlertSeverity = "info" | "warning" | "critical";

export type OperationalAlert = {
  type: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  entityType: string;
  entityId: number;
  href: string;
};

export type AlertInputs = {
  now: Date;
  shoots: Array<{
    id: number;
    eventId: number;
    stage: string;
    eventDate: string;
    eventTime: string | null;
    customerName: string;
    clientToken: string;
    checkedOutAssets: number;
  }>;
  cards: Array<{ id: number; label: string; status: string; shootId: number | null }>;
  editProjects: Array<{
    id: number;
    shootId: number;
    status: string;
    dueDate: string | null;
    customerName: string;
    clientToken: string | null;
  }>;
};

const HOUR = 3_600_000;

/**
 * Derives alerts from state the system already knows. Deliberately excludes anything
 * requiring telemetry the platform does not have (battery level, weather, live location).
 *
 * Every alert carries a stable `type` + entity pair so the notification layer can dedupe.
 */
export function deriveOperationalAlerts(input: AlertInputs): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
  const { now } = input;
  const today = now.toISOString().slice(0, 10);

  for (const shoot of input.shoots) {
    const href = `/staff/photography/shoots/${shoot.clientToken}`;

    // Upcoming: the job is tomorrow or sooner and nobody has started preparing.
    if (shoot.stage === "assigned" && shoot.eventDate >= today) {
      const eventStart = new Date(`${shoot.eventDate}T${shoot.eventTime || "00:00"}:00`);
      const hoursAway = (eventStart.getTime() - now.getTime()) / HOUR;
      if (Number.isFinite(hoursAway) && hoursAway <= 48 && hoursAway > 0) {
        alerts.push({
          type: "photography_upcoming_shoot",
          severity: hoursAway <= 12 ? "warning" : "info",
          title: "مهمة تصوير قريبة",
          body: `${shoot.customerName} — بعد ${Math.round(hoursAway)} ساعة، ولم يبدأ التحضير بعد`,
          entityType: "photography_event",
          entityId: shoot.eventId,
          href,
        });
      }
    }

    // Late arrival: the event has started and the photographer has not checked in.
    if (["assigned", "preparing", "on_the_way"].includes(shoot.stage) && shoot.eventTime) {
      const eventStart = new Date(`${shoot.eventDate}T${shoot.eventTime}:00`);
      const lateBy = (now.getTime() - eventStart.getTime()) / HOUR;
      if (Number.isFinite(lateBy) && lateBy > 0.5) {
        alerts.push({
          type: "photography_late_arrival",
          severity: "critical",
          title: "تأخر وصول المصور",
          body: `${shoot.customerName} — بدأت المناسبة قبل ${Math.round(lateBy)} ساعة والحالة «${shoot.stage}»`,
          entityType: "photography_event",
          entityId: shoot.eventId,
          href,
        });
      }
    }

    // Equipment still in custody after the job is done.
    if (shoot.stage === "completed" && shoot.checkedOutAssets > 0) {
      alerts.push({
        type: "photography_equipment_unreturned",
        severity: "warning",
        title: "معدات لم تُرجَع",
        body: `${shoot.customerName} — ${shoot.checkedOutAssets} معدة ما زالت بالعهدة رغم اكتمال المهمة`,
        entityType: "photography_event",
        entityId: shoot.eventId,
        href,
      });
    }
  }

  // Cards that are full or still out.
  for (const card of input.cards) {
    if (card.status === "full") {
      alerts.push({
        type: "photography_card_full",
        severity: "warning",
        title: "بطاقة ذاكرة ممتلئة",
        body: `${card.label} — بانتظار نسخ الملفات`,
        entityType: "photography_card",
        entityId: card.id,
        href: "/staff/photography/cards",
      });
    }
    if (card.status === "damaged") {
      alerts.push({
        type: "photography_card_damaged",
        severity: "critical",
        title: "بطاقة ذاكرة تالفة",
        body: card.label,
        entityType: "photography_card",
        entityId: card.id,
        href: "/staff/photography/cards",
      });
    }
  }

  // Editing past its due date and not yet delivered.
  for (const project of input.editProjects) {
    if (!project.dueDate || project.status === "delivered") continue;
    if (project.dueDate >= today) continue;
    alerts.push({
      type: "photography_editing_overdue",
      severity: "warning",
      title: "مونتاج متأخر",
      body: `${project.customerName} — كان مستحقاً في ${project.dueDate}`,
      entityType: "photography_edit_project",
      entityId: project.id,
      href: "/staff/photography/editing",
    });
  }

  return alerts;
}
