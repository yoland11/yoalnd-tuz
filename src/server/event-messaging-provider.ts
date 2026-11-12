import { createHmac, timingSafeEqual } from "node:crypto";
import { MESSAGE_FIELDS } from "../lib/event-messaging";
export class MetaMessagingError extends Error {
  readonly existingBooking = undefined;
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
    this.name = "MetaMessagingError";
  }
}
export type ApprovedMetaTemplate = {
  name: string;
  language: string;
  body: string;
  footer: string;
  fields: string[];
};
export function verifyMetaSignature(
  raw: string,
  signature?: string | null,
  secret?: string,
): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature))
    return false;
  return timingSafeEqual(
    Buffer.from(signature.slice(7), "hex"),
    createHmac("sha256", secret).update(raw).digest(),
  );
}
export function approvedTemplateSnapshot(
  template: any,
  fields: string[],
): ApprovedMetaTemplate {
  if (
    template?.status !== "APPROVED" ||
    !/^\w{1,512}$/.test(template?.name) ||
    !/^\w{2,12}$/.test(template?.language) ||
    !Array.isArray(template.components)
  )
    throw new MetaMessagingError(
      422,
      "META_TEMPLATE_INVALID",
      "قالب Meta غير معتمد أو غير صالح",
    );
  if (
    template.components.some((c: any) => !["BODY", "FOOTER"].includes(c.type))
  )
    throw new MetaMessagingError(
      422,
      "META_TEMPLATE_UNSUPPORTED",
      "اختر قالباً نصياً بدون وسائط أو أزرار؛ لضمان مطابقة المعاينة",
    );
  const body = template.components.find((c: any) => c.type === "BODY")?.text;
  if (typeof body !== "string" || !body.trim() || body.length > 4000)
    throw new MetaMessagingError(
      422,
      "META_TEMPLATE_INVALID",
      "قالب Meta لا يحتوي نصاً صالحاً",
    );
  const slots = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const count = Math.max(0, ...slots);
  if (
    count !== fields.length ||
    count > MESSAGE_FIELDS.length ||
    fields.some((f) => !MESSAGE_FIELDS.includes(f as any)) ||
    Array.from({ length: count }, (_, i) => i + 1).some(
      (n) => !slots.includes(n),
    ) ||
    /\{\{[^0-9]/.test(body)
  )
    throw new MetaMessagingError(
      422,
      "META_TEMPLATE_VARIABLES",
      "متغيرات القالب لا تطابق حقول المعاينة",
    );
  return {
    name: template.name,
    language: template.language,
    body,
    footer: String(
      template.components.find((c: any) => c.type === "FOOTER")?.text ?? "",
    ),
    fields,
  };
}
export function buildMetaTemplate(
  to: string,
  template: ApprovedMetaTemplate,
  values: Record<string, string>,
) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      components: template.fields.length
        ? [
            {
              type: "body",
              parameters: template.fields.map((key) => ({
                type: "text",
                text: values[key] || "غير محدد",
              })),
            },
          ]
        : [],
    },
  };
}
export function renderMetaTemplate(
  template: ApprovedMetaTemplate,
  values: Record<string, string>,
): string {
  return (
    template.body.replace(
      /\{\{(\d+)\}\}/g,
      (_, n) => values[template.fields[Number(n) - 1]] || "غير محدد",
    ) + (template.footer ? "\n" + template.footer : "")
  );
}
function config() {
  const version = process.env.META_WA_GRAPH_VERSION;
  if (
    !version ||
    !/^v\d+\.\d+$/.test(version) ||
    !process.env.META_WA_PHONE_ID ||
    !process.env.META_WA_TOKEN ||
    !process.env.META_WA_BUSINESS_ID
  )
    throw new MetaMessagingError(
      503,
      "META_NOT_CONFIGURED",
      "أكمل إعدادات Meta الرسمية وإصدار Graph API قبل الإرسال",
    );
  return {
    base: `https://graph.facebook.com/${version}`,
    token: process.env.META_WA_TOKEN,
    phoneId: process.env.META_WA_PHONE_ID,
    businessId: process.env.META_WA_BUSINESS_ID,
  };
}
export async function liveMetaTemplates(
  fetcher: typeof fetch = fetch,
): Promise<any[]> {
  const c = config();
  let result: Response;
  try {
    result = await fetcher(
      `${c.base}/${encodeURIComponent(c.businessId)}/message_templates?limit=100&fields=name,language,status,components`,
      {
        headers: { Authorization: `Bearer ${c.token}` },
        signal: AbortSignal.timeout(15000),
        cache: "no-store",
      },
    );
  } catch {
    throw new MetaMessagingError(
      502,
      "META_TEMPLATES_UNAVAILABLE",
      "تعذر الاتصال بـ Meta للتحقق من القوالب",
      true,
    );
  }
  if (!result.ok)
    throw new MetaMessagingError(
      502,
      "META_TEMPLATES_UNAVAILABLE",
      `تعذر التحقق من قوالب Meta (HTTP ${result.status})`,
      true,
    );
  let data: any;
  try {
    data = await result.json();
  } catch {
    throw new MetaMessagingError(
      502,
      "META_TEMPLATES_INVALID",
      "استجابة قوالب Meta غير صحيحة",
      true,
    );
  }
  if (!Array.isArray(data.data))
    throw new MetaMessagingError(
      502,
      "META_TEMPLATES_INVALID",
      "استجابة قوالب Meta غير صحيحة",
      true,
    );
  // Explicitly bounded. Templates beyond first 100 require a narrow provider-side catalogue.
  return data.data.filter((t: any) => t.status === "APPROVED");
}
export type MetaSendResult =
  | { status: "accepted"; id: string }
  | { status: "failed" | "unknown"; code: string };
/** A timeout is ambiguous: never resend automatically after a claim. */
export async function sendMetaTemplate(
  to: string,
  template: ApprovedMetaTemplate,
  values: Record<string, string>,
  fetcher: typeof fetch = fetch,
): Promise<MetaSendResult> {
  const c = config();
  let response: Response;
  try {
    response = await fetcher(
      `${c.base}/${encodeURIComponent(c.phoneId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildMetaTemplate(to, template, values)),
        signal: AbortSignal.timeout(20000),
      },
    );
  } catch {
    return { status: "unknown", code: "PROVIDER_RESPONSE_UNKNOWN" };
  }
  // Provider failure bodies may contain phone/token/customer details. Persist only safe status codes.
  if (!response.ok)
    return {
      status: response.status >= 500 ? "unknown" : "failed",
      code: `META_HTTP_${response.status}`,
    };
  let body: any;
  try {
    body = await response.json();
  } catch {
    return { status: "unknown", code: "PROVIDER_RESPONSE_INVALID" };
  }
  const id = body?.messages?.[0]?.id;
  return typeof id === "string" && id.length <= 512
    ? { status: "accepted", id }
    : { status: "unknown", code: "PROVIDER_MESSAGE_ID_MISSING" };
}
