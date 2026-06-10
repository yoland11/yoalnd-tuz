import { type AppearanceSettings, normalizeAppearanceSettings } from "@/lib/appearance";

export type SeasonalTheme = {
  id: string;
  label: string;
  /** تاريخ البداية بصيغة YYYY-MM-DD */
  start: string;
  /** تاريخ النهاية بصيغة YYYY-MM-DD (شامل) */
  end: string;
  enabled: boolean;
  colors: AppearanceSettings;
};

export function normalizeSeasonalThemes(value: unknown): SeasonalTheme[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s, index) => ({
      id: typeof s.id === "string" && s.id ? s.id : `season-${index}`,
      label: typeof s.label === "string" && s.label.trim() ? s.label : "موسم",
      start: isIsoDate(s.start) ? (s.start as string) : "",
      end: isIsoDate(s.end) ? (s.end as string) : "",
      enabled: s.enabled !== false,
      colors: normalizeAppearanceSettings(s.colors),
    }));
}

function isIsoDate(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function localIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * يعيد الموسم النشط اليوم (إن وُجد). صيغة YYYY-MM-DD تُقارَن نصياً بأمان.
 * عند تداخل أكثر من موسم، يُختار الأول حسب الترتيب.
 */
export function findActiveSeason(seasons: SeasonalTheme[], now: Date = new Date()): SeasonalTheme | null {
  const today = localIsoDate(now);
  for (const season of seasons) {
    if (!season.enabled || !season.start || !season.end) continue;
    if (season.start <= today && today <= season.end) return season;
  }
  return null;
}
