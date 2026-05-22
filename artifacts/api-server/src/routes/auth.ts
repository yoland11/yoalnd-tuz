import { Router } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { customersTable, otpCodesTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { RequestOtpBody, VerifyOtpBody } from "@workspace/api-zod";

const router = Router();

function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// In-memory sessions (simple approach)
const sessions = new Map<string, number>();

// ── Rate limiting (in-memory) ──
type Bucket = { count: number; resetAt: number };
const otpRequestByPhone = new Map<string, Bucket>();
const otpRequestByIp = new Map<string, Bucket>();
const otpVerifyByPhone = new Map<string, Bucket>();

function checkRateLimit(map: Map<string, Bucket>, key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = map.get(key);
  if (!b || b.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const m of [otpRequestByPhone, otpRequestByIp, otpVerifyByPhone]) {
    for (const [k, v] of m.entries()) if (v.resetAt < now) m.delete(k);
  }
}, 60_000).unref?.();

router.post("/auth/request-otp", async (req, res) => {
  const parsed = RequestOtpBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "رقم الهاتف مطلوب" });
  }
  const { phone } = parsed.data;
  const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown").toString();

  // 3 OTP requests / phone / 10 min, 10 / IP / hour
  if (!checkRateLimit(otpRequestByPhone, phone, 3, 10 * 60 * 1000)) {
    req.log.warn({ phone }, "OTP request rate-limited (phone)");
    return res.status(429).json({ error: "تجاوزت الحد المسموح، حاول لاحقاً" });
  }
  if (!checkRateLimit(otpRequestByIp, ip, 10, 60 * 60 * 1000)) {
    req.log.warn({ ip }, "OTP request rate-limited (ip)");
    return res.status(429).json({ error: "تجاوزت الحد المسموح، حاول لاحقاً" });
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  // Clean old OTPs
  await db.delete(otpCodesTable).where(eq(otpCodesTable.phone, phone));

  await db.insert(otpCodesTable).values({ phone, code, expiresAt });

  req.log.info({ phone }, "OTP generated");

  // In dev, return the OTP directly for testing
  return res.json({
    message: "تم إرسال رمز التحقق",
    devOtp: process.env.NODE_ENV !== "production" ? code : null,
  });
});

router.post("/auth/verify-otp", async (req, res) => {
  const parsed = VerifyOtpBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }
  const { phone, otp } = parsed.data;

  // 5 verification attempts / phone / 10 min
  if (!checkRateLimit(otpVerifyByPhone, phone, 5, 10 * 60 * 1000)) {
    req.log.warn({ phone }, "OTP verify rate-limited");
    return res.status(429).json({ error: "تجاوزت عدد المحاولات، حاول لاحقاً" });
  }

  const record = await db.query.otpCodesTable.findFirst({
    where: and(
      eq(otpCodesTable.phone, phone),
      eq(otpCodesTable.code, otp),
      eq(otpCodesTable.used, false),
      gt(otpCodesTable.expiresAt, new Date())
    ),
  });

  if (!record) {
    return res.status(400).json({ error: "رمز التحقق غير صحيح أو منتهي الصلاحية" });
  }

  await db.update(otpCodesTable).set({ used: true }).where(eq(otpCodesTable.id, record.id));

  let customer = await db.query.customersTable.findFirst({
    where: eq(customersTable.phone, phone),
  });

  if (!customer) {
    [customer] = await db.insert(customersTable).values({ phone, name: phone }).returning();
  }

  const token = generateToken();
  sessions.set(token, customer.id);

  return res.json({
    customer: {
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
      role: customer.role,
      createdAt: customer.createdAt.toISOString(),
    },
    token,
  });
});

router.get("/auth/me", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: "غير مخول" });
  }
  const customerId = sessions.get(token)!;
  const customer = await db.query.customersTable.findFirst({
    where: eq(customersTable.id, customerId),
  });
  if (!customer) {
    return res.status(404).json({ error: "المستخدم غير موجود" });
  }
  return res.json({
    id: customer.id,
    phone: customer.phone,
    name: customer.name,
    role: customer.role,
    createdAt: customer.createdAt.toISOString(),
  });
});

router.post("/auth/logout", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) sessions.delete(token);
  return res.json({ message: "تم تسجيل الخروج" });
});

export { sessions };
export default router;
