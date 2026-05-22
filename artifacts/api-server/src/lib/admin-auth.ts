import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, staffTable, adminSessionsTable } from "@workspace/db";
import { and, eq, gt, lt } from "drizzle-orm";

export const COOKIE_NAME = "ajn_admin_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const ALL_PERMISSIONS = [
  "dashboard",
  "orders",
  "bookings",
  "services",
  "products",
  "gallery",
  "delivery",
  "customers",
  "staff",
  "settings",
  "invoices",
  "whatsapp",
  "accounting",
  "backup",
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

export type AdminUser = {
  id: number;
  username: string;
  fullName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
};

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  if (!hash) return false;
  if (hash.startsWith("$2")) {
    try { return bcrypt.compareSync(plain, hash); } catch { return false; }
  }
  // Legacy scrypt format: "salt:hash"
  const [salt, expected] = hash.split(":");
  if (!salt || !expected) return false;
  try {
    const got = crypto.scryptSync(plain, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  } catch { return false; }
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(adminSessionsTable).values({ token, userId, expiresAt });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(adminSessionsTable).where(eq(adminSessionsTable.token, token));
}

export async function pruneExpiredSessions(): Promise<void> {
  try { await db.delete(adminSessionsTable).where(lt(adminSessionsTable.expiresAt, new Date())); }
  catch { /* swallow */ }
}

function readToken(req: Request): string | null {
  // cookie-parser sets req.cookies; also accept Bearer for tooling
  const cookieToken = (req as any).cookies?.[COOKIE_NAME];
  if (typeof cookieToken === "string" && cookieToken) return cookieToken;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export async function getAdminUser(req: Request): Promise<AdminUser | null> {
  const token = readToken(req);
  if (!token) return null;
  const session = await db.query.adminSessionsTable.findFirst({
    where: and(eq(adminSessionsTable.token, token), gt(adminSessionsTable.expiresAt, new Date())),
  });
  if (!session) return null;
  const user = await db.query.staffTable.findFirst({ where: eq(staffTable.id, session.userId) });
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    permissions: user.permissions ?? [],
    isActive: user.isActive,
  };
}

export function hasPermission(user: AdminUser | null, perm: Permission | null): boolean {
  if (!user || !user.isActive) return false;
  if (user.role === "admin") return true;
  if (!perm) return true;
  return user.permissions.includes(perm);
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  getAdminUser(req)
    .then((user) => {
      if (!user) { res.status(401).json({ error: "غير مخول" }); return; }
      (req as any).adminUser = user;
      next();
    })
    .catch(next);
}

export function requirePermission(perm: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    getAdminUser(req)
      .then((user) => {
        if (!user) { res.status(401).json({ error: "غير مخول" }); return; }
        if (!hasPermission(user, perm)) { res.status(403).json({ error: "ليس لديك صلاحية" }); return; }
        (req as any).adminUser = user;
        next();
      })
      .catch(next);
  };
}

// Back-compat shim for any remaining callers
export const requireAdmin = requireAdminAuth;
export function isAdmin(_req: Request): boolean { return false; }

export async function seedAdminUser(): Promise<void> {
  try {
    const username = process.env.ADMIN_USERNAME?.trim() || "alijan";
    const password = process.env.ADMIN_PASSWORD?.trim();
    const fullName = process.env.ADMIN_FULL_NAME?.trim() || "المدير الرئيسي";
    const fallbackPassword = process.env.NODE_ENV === "production" ? null : "123123";
    const initialPassword = password || fallbackPassword;

    // Migrate legacy "admin" account to "alijan" if present (keeps id, password, sessions, permissions).
    const legacy = await db.query.staffTable.findFirst({ where: eq(staffTable.username, "admin") });
    if (legacy) {
      const taken = await db.query.staffTable.findFirst({ where: eq(staffTable.username, username) });
      if (!taken) {
        await db.update(staffTable).set({ username }).where(eq(staffTable.id, legacy.id));
      }
    }
    const existing = await db.query.staffTable.findFirst({ where: eq(staffTable.username, username) });
    if (existing) {
      // Ensure admin remains active with admin role and full permissions (auto-grants new perms on boot)
      const current = Array.isArray(existing.permissions) ? existing.permissions : [];
      const missing = ALL_PERMISSIONS.filter(p => !current.includes(p));
      if (!existing.isActive || existing.role !== "admin" || missing.length > 0) {
        await db.update(staffTable)
          .set({ isActive: true, role: "admin", permissions: [...ALL_PERMISSIONS] })
          .where(eq(staffTable.id, existing.id));
      }
      return;
    }
    if (!initialPassword) {
      console.error("ADMIN_PASSWORD is required to seed the first admin in production.");
      return;
    }
    await db.insert(staffTable).values({
      username,
      passwordHash: hashPassword(initialPassword),
      fullName,
      role: "admin",
      permissions: [...ALL_PERMISSIONS],
      isActive: true,
    });
  } catch (err) {
    // Don't crash boot if seeding fails; just log
    // eslint-disable-next-line no-console
    console.error("seedAdminUser failed:", err);
  }
}
