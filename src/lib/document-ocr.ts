/**
 * Client-side OCR and field extraction for scanned documents.
 *
 * Runs entirely in the browser via tesseract.js, so document images are never
 * uploaded for text recognition.
 *
 * HONEST LIMITS — the UI must reflect these, never hide them:
 *  • Arabic accuracy on ID cards is moderate. Decorative fonts, security
 *    guilloche patterns and low contrast all degrade it badly.
 *  • Kurdish (Sorani, `ckb`) has a weak trained model; treat output as a hint.
 *  • Every extracted field is a SUGGESTION. The user confirms or corrects each
 *    one before anything is saved — nothing machine-read is trusted.
 *
 * Language data (~10–15 MB per language) is fetched from a CDN on first use and
 * cached by the browser, so the first run needs a working connection.
 */

export type OcrLanguage = "ara" | "eng" | "tur" | "ckb";

export const OCR_LANGUAGES: Array<{
  value: OcrLanguage;
  label: string;
  /** Shown next to the option so expectations are set before it runs. */
  quality: string;
  reliable: boolean;
}> = [
  { value: "ara", label: "العربية", quality: "دقة متوسطة", reliable: false },
  { value: "eng", label: "الإنجليزية", quality: "دقة جيدة", reliable: true },
  { value: "tur", label: "التركية", quality: "دقة جيدة", reliable: true },
  { value: "ckb", label: "الكردية (سوراني)", quality: "دقة ضعيفة — للاستئناس", reliable: false },
];

export type OcrProgress = { status: string; progress: number };

export type OcrResult = {
  text: string;
  /** 0–100 as reported by the engine; low values mean "do not trust this". */
  confidence: number;
  language: string;
};

/**
 * Recognises text in an image. `languages` may combine scripts, e.g.
 * ["ara","eng"] for a bilingual Iraqi ID.
 */
export async function recognizeText(
  imageDataUrl: string,
  languages: OcrLanguage[],
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  if (!languages.length) throw new Error("اختر لغة واحدة على الأقل");
  // Imported lazily so the ~2 MB engine never lands in the initial bundle.
  const { createWorker } = await import("tesseract.js");
  const lang = languages.join("+");

  const worker = await createWorker(lang, 1, {
    logger: onProgress
      ? (m: any) => onProgress({ status: String(m.status ?? ""), progress: Number(m.progress ?? 0) })
      : undefined,
  });
  try {
    const { data } = await worker.recognize(imageDataUrl);
    return {
      text: String(data.text ?? "").trim(),
      confidence: Number((data as any).confidence ?? 0),
      language: lang,
    };
  } finally {
    await worker.terminate();
  }
}

// ─── Field extraction ───────────────────────────────────────────────────────

export type ExtractedFields = {
  documentNumber?: string;
  nationalId?: string;
  passportNumber?: string;
  fullName?: string;
  phone?: string;
  issueDate?: string;
  expiryDate?: string;
};

/** Converts a matched date to ISO, or null when the parts are out of range. */
function toIso(day: string, month: string, year: string): string | null {
  let y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (y < 100) y += y > 50 ? 1900 : 2000;
  if (!m || !d || m > 12 || d > 31 || y < 1900 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Normalises Arabic-Indic digits so the patterns below only see ASCII. */
function normalizeDigits(text: string): string {
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  return text.replace(/[٠-٩۰-۹]/g, (ch) => {
    const i = ar.indexOf(ch) >= 0 ? ar.indexOf(ch) : fa.indexOf(ch);
    return i >= 0 ? String(i) : ch;
  });
}

const DATE_PATTERNS = [
  /(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})/g, // 12/05/2030
  /(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})/g, // 2030-05-12
];

/**
 * Pulls likely field values out of raw OCR text.
 *
 * This is pattern matching, not understanding — it is wrong often enough that
 * the caller MUST present every value for confirmation. Returning nothing is
 * preferable to returning a confident guess, so ambiguous matches are dropped.
 */
export function extractFields(rawText: string, documentType?: string): ExtractedFields {
  const text = normalizeDigits(rawText);
  const out: ExtractedFields = {};

  // Iraqi national ID: 12 consecutive digits.
  const nid = text.match(/(?<!\d)(\d{12})(?!\d)/);
  if (nid) out.nationalId = nid[1];

  // Passport: one letter followed by 7–8 digits (e.g. A1234567).
  const passport = text.match(/\b([A-Z])\s?(\d{7,8})\b/);
  if (passport) out.passportNumber = `${passport[1]}${passport[2]}`;

  // Iraqi mobile: 07XXXXXXXXX, tolerating separators.
  const phone = text.match(/\b(07[\s\-]?\d{2}[\s\-]?\d{3}[\s\-]?\d{4})\b/);
  if (phone) out.phone = phone[1].replace(/[\s\-]/g, "");

  // Generic document number: a labelled alphanumeric run. Skipped when it just
  // repeats a value already captured in a more specific field.
  const docNo = text.match(/(?:رقم|no\.?|number)\s*[:：]?\s*([A-Z0-9\-]{4,20})/i);
  if (docNo && docNo[1] !== out.nationalId && docNo[1] !== out.passportNumber) {
    out.documentNumber = docNo[1];
  }

  // Dates: collect every candidate, then assign by order — the earliest is
  // taken as issue and the latest as expiry, which holds for most ID layouts.
  const dates: string[] = [];
  for (const pattern of DATE_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const iso =
        m[1].length === 4 ? toIso(m[3], m[2], m[1]) : toIso(m[1], m[2], m[3]);
      if (iso && !dates.includes(iso)) dates.push(iso);
    }
  }
  if (dates.length) {
    const sorted = [...dates].sort();
    // A single date on a passport or licence is far more likely an expiry.
    if (sorted.length === 1) {
      const isIdLike = ["passport", "driving_license", "national_id", "residence_card"].includes(
        documentType ?? "",
      );
      if (isIdLike) out.expiryDate = sorted[0];
      else out.issueDate = sorted[0];
    } else {
      out.issueDate = sorted[0];
      out.expiryDate = sorted[sorted.length - 1];
    }
  }

  const nameLine = extractNameLine(rawText);
  if (nameLine) out.fullName = nameLine;

  return out;
}

/**
 * Words that mark a line as a caption rather than a person's name. Without this
 * the longest-line heuristic happily returns "تاريخ الإصدار" or "REPUBLIC OF IRAQ".
 */
const NAME_STOPWORDS = [
  "تاريخ", "رقم", "الإصدار", "النفاذ", "الانتهاء", "الصلاحية", "جمهورية",
  "العراق", "البطاقة", "الوطنية", "هوية", "إجازة", "جواز", "سفر", "بطاقة",
  "مستند", "وزارة", "مديرية", "الأحوال", "المدنية", "محل", "الولادة", "الجنس",
  "republic", "passport", "date", "expiry", "issue", "number", "ministry",
  "identity", "card", "licence", "license", "name", "nationality",
];

/**
 * Picks the most name-like line: 2–5 words, no digits in ANY numeral system, and
 * free of caption keywords. Accepts Arabic or Latin scripts.
 *
 * Deliberately conservative — returning nothing beats returning a caption, since
 * a wrong pre-filled name is worse than an empty field the user simply types.
 */
function extractNameLine(rawText: string): string | undefined {
  const candidates = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length < 6 || line.length > 60) return false;
      // Digits in any numeral system disqualify the line.
      if (/[\d٠-٩۰-۹]/.test(normalizeDigits(line)) || /\d/.test(normalizeDigits(line))) return false;
      // Must be mostly letters, not punctuation or separators.
      if (!/[؀-ۿA-Za-z]/.test(line)) return false;
      const lower = line.toLowerCase();
      if (NAME_STOPWORDS.some((word) => lower.includes(word.toLowerCase()))) return false;
      const words = line.split(/\s+/).filter(Boolean);
      return words.length >= 2 && words.length <= 5;
    });
  if (!candidates.length) return undefined;
  // Prefer the longest remaining line — full names carry more characters than
  // stray fragments that survived the filters.
  return candidates.sort((a, b) => b.length - a.length)[0];
}

/** A confidence floor below which the UI should warn rather than pre-fill. */
export const LOW_CONFIDENCE_THRESHOLD = 60;
