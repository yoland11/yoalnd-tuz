import { db, whatsappSettingsTable, whatsappLogTable } from "@workspace/db";

const logger = {
  warn: (...args: unknown[]) => console.warn(...args),
};

export type WaEvent =
  | "placed"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "booking_placed"
  | "booking_confirmed"
  | "booking_processing"
  | "booking_ready"
  | "booking_completed"
  | "booking_cancelled"
  | "test";

export const WA_EVENTS: WaEvent[] = [
  "placed",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
];

export const WA_BOOKING_EVENTS: WaEvent[] = [
  "booking_placed",
  "booking_confirmed",
  "booking_processing",
  "booking_ready",
  "booking_completed",
  "booking_cancelled",
];

export const WA_EVENT_LABELS: Record<WaEvent, string> = {
  placed: "عند إنشاء الطلب",
  confirmed: "عند تأكيد الطلب",
  processing: "قيد التجهيز",
  shipped: "في الطريق",
  delivered: "تم التسليم",
  cancelled: "إلغاء الطلب",
  booking_placed: "عند استلام الحجز",
  booking_confirmed: "عند تأكيد الحجز",
  booking_processing: "الحجز قيد التحضير",
  booking_ready: "الحجز جاهز/قيد التركيب",
  booking_completed: "اكتمل الحجز",
  booking_cancelled: "إلغاء الحجز",
  test: "رسالة اختبار",
};

export const DEFAULT_TEMPLATES: Record<WaEvent, string> = {
  placed:
    "مرحباً {name} 🌟\nتم استلام طلبك من مجموعة علي جان.\nرقم التتبع: {tracking}\nالإجمالي: {total}\nتابع طلبك من هنا: {link}",
  confirmed:
    "مرحباً {name} ✅\nتم تأكيد طلبك ({tracking}) وسنبدأ التجهيز فوراً.\nرابط التتبع: {link}",
  processing:
    "مرحباً {name} 🛠️\nطلبك ({tracking}) قيد التجهيز الآن.\nرابط التتبع: {link}",
  shipped:
    "مرحباً {name} 🚚\nطلبك ({tracking}) في الطريق إليك.\nرابط التتبع: {link}",
  delivered:
    "مرحباً {name} 🎉\nتم تسليم طلبك ({tracking}) بنجاح. شكراً لثقتك بمجموعة علي جان.\nرابط التتبع: {link}",
  cancelled:
    "مرحباً {name}\nنأسف، تم إلغاء طلبك ({tracking}). للاستفسار يرجى التواصل معنا.",
  booking_placed:
    "مرحباً {name} 🌟\nتم استلام حجزك لخدمة ({service}) من مجموعة علي جان.\nرقم الحجز: {tracking}\nسنتواصل معك قريباً للتأكيد.\nتابع حجزك: {link}",
  booking_confirmed:
    "مرحباً {name} ✅\nتم تأكيد حجزك لخدمة ({service}) برقم {tracking}.\nرابط التتبع: {link}",
  booking_processing:
    "مرحباً {name} 🛠️\nحجزك ({tracking}) لخدمة ({service}) قيد التحضير الآن.\nرابط التتبع: {link}",
  booking_ready:
    "مرحباً {name} 📦\nحجزك ({tracking}) لخدمة ({service}) جاهز/قيد التركيب.\nرابط التتبع: {link}",
  booking_completed:
    "مرحباً {name} 🎉\nاكتمل حجزك ({tracking}) لخدمة ({service}) بنجاح. شكراً لثقتك بمجموعة علي جان.",
  booking_cancelled:
    "مرحباً {name}\nنأسف، تم إلغاء حجزك ({tracking}) لخدمة ({service}). للاستفسار يرجى التواصل معنا.",
  test:
    "رسالة اختبار من مجموعة علي جان ✅",
};

export const DEFAULT_ENABLED: Record<string, boolean> = {
  placed: false,
  confirmed: false,
  processing: false,
  shipped: false,
  delivered: false,
  cancelled: false,
  booking_placed: false,
  booking_confirmed: false,
  booking_processing: false,
  booking_ready: false,
  booking_completed: false,
  booking_cancelled: false,
};

export type WaSettings = {
  id: number;
  provider: string;
  enabledEvents: Record<string, boolean>;
  templates: Record<string, string>;
  automationEnabled: boolean;
};

// ─── Provider credentials (env-only, never persisted) ──────────────────
// Each provider declares the Replit secrets it needs. The admin UI shows
// the names + whether they are set, but values are NEVER returned to the UI.
export type ProviderSpec = {
  id: string;
  label: string;
  envVars: { key: string; label: string }[];
};

export const PROVIDER_SPECS: ProviderSpec[] = [
  {
    id: "ultramsg",
    label: "UltraMsg",
    envVars: [
      { key: "ULTRAMSG_INSTANCE_ID", label: "Instance ID" },
      { key: "ULTRAMSG_TOKEN", label: "API Token" },
    ],
  },
  {
    id: "wassenger",
    label: "Wassenger",
    envVars: [
      { key: "WASSENGER_API_KEY", label: "API Key" },
      { key: "WASSENGER_DEVICE", label: "Device ID (اختياري)" },
    ],
  },
  {
    id: "twilio",
    label: "Twilio WhatsApp",
    envVars: [
      { key: "TWILIO_ACCOUNT_SID", label: "Account SID" },
      { key: "TWILIO_AUTH_TOKEN", label: "Auth Token" },
      { key: "TWILIO_WHATSAPP_FROM", label: "From (whatsapp:+...)" },
    ],
  },
  {
    id: "meta",
    label: "Meta WhatsApp Cloud",
    envVars: [
      { key: "META_WA_PHONE_ID", label: "Phone Number ID" },
      { key: "META_WA_TOKEN", label: "Access Token" },
    ],
  },
];

export function getProviderStatus(): Record<string, { configured: boolean; envVars: { key: string; label: string; set: boolean }[] }> {
  const out: Record<string, any> = {};
  for (const p of PROVIDER_SPECS) {
    const envVars = p.envVars.map(v => ({ key: v.key, label: v.label, set: !!process.env[v.key] }));
    // "configured" means every required (non-optional) var is set. We treat
    // anything labeled with "اختياري" as optional.
    const requiredSet = envVars.filter(v => !/اختياري/.test(v.label)).every(v => v.set);
    out[p.id] = { configured: requiredSet, envVars };
  }
  return out;
}

export function normalizeIraqiPhone(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00964")) return digits.slice(2);
  if (digits.startsWith("964")) return digits;
  if (digits.startsWith("0")) return "964" + digits.slice(1);
  return "964" + digits;
}

export function renderTemplate(
  tpl: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

export async function getSettings(): Promise<WaSettings> {
  const rows = await db.query.whatsappSettingsTable.findMany();
  if (rows.length > 0) {
    const r = rows[0];
    return {
      id: r.id,
      provider: r.provider,
      enabledEvents: { ...DEFAULT_ENABLED, ...(r.enabledEvents ?? {}) },
      templates: { ...DEFAULT_TEMPLATES, ...(r.templates ?? {}) },
      automationEnabled: r.automationEnabled,
    };
  }
  const [created] = await db
    .insert(whatsappSettingsTable)
    .values({
      provider: "ultramsg",
      enabledEvents: DEFAULT_ENABLED,
      templates: DEFAULT_TEMPLATES,
      automationEnabled: false,
    })
    .returning();
  return {
    id: created.id,
    provider: created.provider,
    enabledEvents: created.enabledEvents ?? DEFAULT_ENABLED,
    templates: created.templates ?? DEFAULT_TEMPLATES,
    automationEnabled: created.automationEnabled,
  };
}

export async function updateSettings(
  patch: Partial<Omit<WaSettings, "id">>,
): Promise<WaSettings> {
  const current = await getSettings();
  const merged = {
    provider: patch.provider ?? current.provider,
    enabledEvents: patch.enabledEvents ?? current.enabledEvents,
    templates: patch.templates ?? current.templates,
    automationEnabled:
      patch.automationEnabled ?? current.automationEnabled,
    updatedAt: new Date(),
  };
  const { eq } = await import("drizzle-orm");
  await db
    .update(whatsappSettingsTable)
    .set(merged)
    .where(eq(whatsappSettingsTable.id, current.id));
  return { id: current.id, ...merged };
}

// ─── Providers ───────────────────────────────────────────
type SendResult = { ok: boolean; error?: string };

async function sendUltraMsg(to: string, body: string): Promise<SendResult> {
  const instanceId = process.env.ULTRAMSG_INSTANCE_ID;
  const token = process.env.ULTRAMSG_TOKEN;
  if (!instanceId || !token) return { ok: false, error: "ULTRAMSG_INSTANCE_ID/TOKEN missing" };
  const url = `https://api.ultramsg.com/${instanceId}/messages/chat`;
  const form = new URLSearchParams({ token, to, body });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${await res.text()}` };
  const json: any = await res.json().catch(() => ({}));
  if (json?.sent === "true" || json?.sent === true || json?.id) return { ok: true };
  return { ok: false, error: JSON.stringify(json) };
}

async function sendTwilio(to: string, body: string): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) return { ok: false, error: "Twilio secrets missing" };
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const form = new URLSearchParams({
    To: `whatsapp:+${to}`,
    From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    Body: body,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
    },
    body: form.toString(),
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${await res.text()}` };
  return { ok: true };
}

async function sendMetaCloud(to: string, body: string): Promise<SendResult> {
  const phoneId = process.env.META_WA_PHONE_ID;
  const token = process.env.META_WA_TOKEN;
  if (!phoneId || !token) return { ok: false, error: "Meta secrets missing" };
  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${await res.text()}` };
  return { ok: true };
}

async function sendWassenger(to: string, body: string): Promise<SendResult> {
  const apiKey = process.env.WASSENGER_API_KEY;
  const device = process.env.WASSENGER_DEVICE;
  if (!apiKey) return { ok: false, error: "Wassenger secret missing" };
  const res = await fetch("https://api.wassenger.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", Token: apiKey },
    body: JSON.stringify({ phone: `+${to}`, message: body, ...(device ? { device } : {}) }),
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${await res.text()}` };
  return { ok: true };
}

async function dispatch(provider: string, to: string, body: string): Promise<SendResult> {
  switch (provider) {
    case "ultramsg": return sendUltraMsg(to, body);
    case "twilio": return sendTwilio(to, body);
    case "meta": return sendMetaCloud(to, body);
    case "wassenger": return sendWassenger(to, body);
    default: return { ok: false, error: `Unknown provider: ${provider}` };
  }
}

export async function whatsappSend(
  phone: string,
  message: string,
  event: WaEvent = "test",
  settings?: WaSettings,
): Promise<SendResult> {
  const s = settings ?? (await getSettings());
  const to = normalizeIraqiPhone(phone);
  let result: SendResult = { ok: false, error: "no-phone" };
  if (!to) {
    await logEntry(to, event, message, "failed", "phone empty", s.provider);
    return result;
  }
  try {
    result = await dispatch(s.provider, to, message);
  } catch (err: any) {
    result = { ok: false, error: err?.message ?? String(err) };
  }
  await logEntry(to, event, message, result.ok ? "sent" : "failed", result.error, s.provider);
  if (!result.ok) {
    logger.warn({ event, to, err: result.error }, "whatsapp send failed");
  }
  return result;
}

async function logEntry(
  phone: string,
  event: string,
  message: string,
  status: string,
  error: string | undefined,
  provider: string,
): Promise<void> {
  try {
    await db.insert(whatsappLogTable).values({
      phone, event, message, status, error: error ?? null, provider,
    });
  } catch (err) {
    logger.warn({ err }, "whatsapp log insert failed");
  }
}

export function buildTrackingLink(trackingCode: string): string {
  const base = process.env.PUBLIC_BASE_URL
    ?? (process.env.REPLIT_DOMAINS?.split(",")[0]
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
      : "");
  if (!base) return `track?code=${trackingCode}`;
  return `${base.replace(/\/$/, "")}/track?code=${trackingCode}`;
}

export type OrderCtx = {
  name: string;
  phone: string;
  tracking: string;
  total?: number | string;
  status?: string;
  service?: string;
};

export async function fireOrderEvent(
  event: WaEvent,
  ctx: OrderCtx,
): Promise<void> {
  try {
    const s = await getSettings();
    if (!s.automationEnabled) return;
    if (!s.enabledEvents[event]) return;
    if (!ctx.phone || !ctx.tracking) return;
    const tpl = s.templates[event] ?? DEFAULT_TEMPLATES[event];
    const link = buildTrackingLink(ctx.tracking);
    const message = renderTemplate(tpl, {
      name: ctx.name ?? "",
      tracking: ctx.tracking,
      total: ctx.total ?? "",
      status: ctx.status ?? "",
      service: ctx.service ?? "",
      link,
    });
    // Fire and forget — caller doesn't await success
    void whatsappSend(ctx.phone, message, event, s);
  } catch (err) {
    logger.warn({ err, event }, "fireOrderEvent failed");
  }
}

export function eventForStatus(status: string): WaEvent | null {
  const s = (status ?? "").toLowerCase();
  if (s === "pending") return "placed";
  if (s === "confirmed") return "confirmed";
  if (s === "processing" || s === "preparing" || s === "writing" || s === "designing") return "processing";
  if (s === "shipped" || s === "installing") return "shipped";
  if (s === "delivered" || s === "completed" || s === "ready") return "delivered";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return null;
}

export function eventForBookingStatus(status: string): WaEvent | null {
  const s = (status ?? "").toLowerCase();
  if (s === "pending") return "booking_placed";
  if (s === "confirmed") return "booking_confirmed";
  if (s === "processing" || s === "preparing" || s === "writing" || s === "designing") return "booking_processing";
  if (s === "ready" || s === "installing" || s === "shipped") return "booking_ready";
  if (s === "completed" || s === "delivered") return "booking_completed";
  if (s === "cancelled" || s === "canceled") return "booking_cancelled";
  return null;
}
