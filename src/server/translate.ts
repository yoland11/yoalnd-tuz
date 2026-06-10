// ترجمة محتوى تلقائية من جهة السيرفر فقط (لحماية مفتاح الـAPI).
// تُستدعى مرة واحدة عند الضغط على زر «ترجمة تلقائية» في لوحة الإدارة،
// ولا تُستعمل إطلاقاً أثناء زيارة الزبون (الواجهة تعتمد على الحقول المحفوظة + fallback للعربية).

export type AutoTranslateResult = {
  nameKu: string;
  nameTr: string;
  descriptionKu: string;
  descriptionTr: string;
};

type TranslateInput = { name?: string | null; description?: string | null };

const EMPTY: AutoTranslateResult = { nameKu: "", nameTr: "", descriptionKu: "", descriptionTr: "" };
const TIMEOUT_MS = 20000;

function currentProvider(): string {
  return (process.env.AUTO_TRANSLATE_PROVIDER || "openai").trim().toLowerCase();
}

export function autoTranslateStatus(): { available: boolean; provider: string; reason?: string } {
  const provider = currentProvider();
  if (provider === "openai") {
    return process.env.OPENAI_API_KEY
      ? { available: true, provider }
      : { available: false, provider, reason: "OPENAI_API_KEY غير مضبوط في متغيرات البيئة" };
  }
  if (provider === "google") {
    return process.env.GOOGLE_TRANSLATE_API_KEY
      ? { available: true, provider }
      : { available: false, provider, reason: "GOOGLE_TRANSLATE_API_KEY غير مضبوط في متغيرات البيئة" };
  }
  if (provider === "libretranslate" || provider === "libre") {
    return process.env.LIBRETRANSLATE_URL
      ? { available: true, provider: "libretranslate" }
      : { available: false, provider: "libretranslate", reason: "LIBRETRANSLATE_URL غير مضبوط في متغيرات البيئة" };
  }
  return { available: false, provider, reason: `مزود ترجمة غير مدعوم: ${provider}` };
}

export async function autoTranslate(input: TranslateInput): Promise<AutoTranslateResult> {
  const name = String(input.name ?? "").trim();
  const description = String(input.description ?? "").trim();
  if (!name && !description) return EMPTY;

  const status = autoTranslateStatus();
  if (!status.available) throw new Error(status.reason || "الترجمة التلقائية غير مفعّلة");

  if (status.provider === "openai") return openaiTranslate(name, description);
  if (status.provider === "google") return googleTranslate(name, description);
  return libreTranslate(name, description);
}

// ============================ OpenAI ============================
async function openaiTranslate(name: string, description: string): Promise<AutoTranslateResult> {
  const key = process.env.OPENAI_API_KEY!;
  const model = process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a professional translator for an events/e-commerce website. " +
            "Translate the provided Arabic fields into Central Kurdish (Sorani, ckb) and Turkish (tr). " +
            'Return ONLY a JSON object with exactly these keys: "nameKu", "nameTr", "descriptionKu", "descriptionTr". ' +
            "If a source field is empty, return an empty string for its translations. " +
            "Translate faithfully and naturally; do not add commentary, quotes, or extra text.",
        },
        { role: "user", content: JSON.stringify({ name, description }) },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI (${res.status}): ${text.slice(0, 180)}`);
  }
  const data = await res.json().catch(() => ({}));
  let parsed: any = {};
  try {
    parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
  } catch {
    parsed = {};
  }
  return {
    nameKu: name ? cleanText(parsed.nameKu) : "",
    nameTr: name ? cleanText(parsed.nameTr) : "",
    descriptionKu: description ? cleanText(parsed.descriptionKu) : "",
    descriptionTr: description ? cleanText(parsed.descriptionTr) : "",
  };
}

// ======================== Google Translate ========================
async function googleOne(text: string, target: string): Promise<string> {
  if (!text) return "";
  const key = process.env.GOOGLE_TRANSLATE_API_KEY!;
  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ q: text, source: "ar", target, format: "text" }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Google Translate (${res.status}): ${t.slice(0, 180)}`);
  }
  const data = await res.json().catch(() => ({}));
  return cleanText(data?.data?.translations?.[0]?.translatedText);
}

async function googleTranslate(name: string, description: string): Promise<AutoTranslateResult> {
  // الكردية السورانية في Google = ckb
  const [nameKu, nameTr, descriptionKu, descriptionTr] = await Promise.all([
    googleOne(name, "ckb"),
    googleOne(name, "tr"),
    googleOne(description, "ckb"),
    googleOne(description, "tr"),
  ]);
  return { nameKu, nameTr, descriptionKu, descriptionTr };
}

// ========================= LibreTranslate =========================
async function libreOne(text: string, target: string): Promise<string> {
  if (!text) return "";
  const base = (process.env.LIBRETRANSLATE_URL || "").replace(/\/+$/, "");
  const res = await fetch(`${base}/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      q: text,
      source: "ar",
      target,
      format: "text",
      ...(process.env.LIBRETRANSLATE_API_KEY ? { api_key: process.env.LIBRETRANSLATE_API_KEY } : {}),
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LibreTranslate (${res.status}): ${t.slice(0, 180)}`);
  }
  const data = await res.json().catch(() => ({}));
  return cleanText(data?.translatedText);
}

async function libreTranslate(name: string, description: string): Promise<AutoTranslateResult> {
  // LibreTranslate قد لا يدعم السورانية؛ نستخدم "ku" كأقرب متاح.
  const [nameKu, nameTr, descriptionKu, descriptionTr] = await Promise.all([
    libreOne(name, "ku"),
    libreOne(name, "tr"),
    libreOne(description, "ku"),
    libreOne(description, "tr"),
  ]);
  return { nameKu, nameTr, descriptionKu, descriptionTr };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
