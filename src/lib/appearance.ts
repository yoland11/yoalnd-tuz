export type AppearanceSettings = {
  background: string;
  header: string;
  footer: string;
  sidebar: string;
  primaryButton: string;
  secondaryButton: string;
  headings: string;
  text: string;
  cards: string;
  links: string;
  hover: string;
};

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  background: "#0B0B12",
  header: "#12131A",
  footer: "#12131A",
  sidebar: "#12131A",
  primaryButton: "#D4B15A",
  secondaryButton: "#12131A",
  headings: "#FFFFFF",
  text: "#FFFFFF",
  cards: "#1A1C25",
  links: "#D4B15A",
  hover: "#E7D6A0",
};

const LEGACY_DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  background: "#0A0A0A",
  header: "#0A0A0A",
  footer: "#0A0A0A",
  sidebar: "#121212",
  primaryButton: "#D4AF37",
  secondaryButton: "#262626",
  headings: "#F3EFE8",
  text: "#F3EFE8",
  cards: "#121212",
  links: "#D4AF37",
  hover: "#D4AF37",
};

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeHexColor(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (!HEX_RE.test(raw)) return fallback;
  if (raw.length === 4) {
    const [, r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return raw.toUpperCase();
}

export function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const source = value && typeof value === "object" ? value as Partial<AppearanceSettings> : {};
  const normalized = {
    background: normalizeHexColor(source.background, DEFAULT_APPEARANCE_SETTINGS.background),
    header: normalizeHexColor(source.header, DEFAULT_APPEARANCE_SETTINGS.header),
    footer: normalizeHexColor(source.footer, DEFAULT_APPEARANCE_SETTINGS.footer),
    sidebar: normalizeHexColor(source.sidebar, DEFAULT_APPEARANCE_SETTINGS.sidebar),
    primaryButton: normalizeHexColor(source.primaryButton, DEFAULT_APPEARANCE_SETTINGS.primaryButton),
    secondaryButton: normalizeHexColor(source.secondaryButton, DEFAULT_APPEARANCE_SETTINGS.secondaryButton),
    headings: normalizeHexColor(source.headings, DEFAULT_APPEARANCE_SETTINGS.headings),
    text: normalizeHexColor(source.text, DEFAULT_APPEARANCE_SETTINGS.text),
    cards: normalizeHexColor(source.cards, DEFAULT_APPEARANCE_SETTINGS.cards),
    links: normalizeHexColor(source.links, DEFAULT_APPEARANCE_SETTINGS.links),
    hover: normalizeHexColor(source.hover, DEFAULT_APPEARANCE_SETTINGS.hover),
  };
  return sameAppearance(normalized, LEGACY_DEFAULT_APPEARANCE_SETTINGS) ? { ...DEFAULT_APPEARANCE_SETTINGS } : normalized;
}

function sameAppearance(a: AppearanceSettings, b: AppearanceSettings): boolean {
  return (Object.keys(DEFAULT_APPEARANCE_SETTINGS) as Array<keyof AppearanceSettings>).every((key) => a[key] === b[key]);
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const normalized = normalizeHexColor(hex, "#000000").slice(1);
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function clampChannel(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function hslTriplet(h: number, s: number, l: number): string {
  return `${clampChannel(h, 360)} ${clampChannel(s, 100)}% ${clampChannel(l, 100)}%`;
}

// يرفع لمعان الأسطح الداكنة ويخفض لمعان الفاتحة، بحيث يبقى الإطار ظاهراً ومتناسقاً مع أي ثيم
function frameLightness(baseL: number, darkOffset: number, lightOffset: number): number {
  return baseL < 50 ? baseL + darkOffset : baseL - lightOffset;
}

// لون إطار مشتق من لون السطح نفسه (يحافظ على التدرج اللوني للثيم)
function surfaceBorderTriplet(hex: string, darkOffset: number, lightOffset: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslTriplet(h, s, frameLightness(l, darkOffset, lightOffset));
}

export function hexToHslTriplet(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  return `${h} ${s}% ${l}%`;
}

export function readableForeground(hex: string): string {
  const normalized = normalizeHexColor(hex, "#000000").slice(1);
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0B0B12" : "#FFFFFF";
}

export function appearanceCssVariables(settings: unknown): Record<string, string> {
  const appearance = normalizeAppearanceSettings(settings);
  const primaryForeground = hexToHslTriplet(readableForeground(appearance.primaryButton));
  const secondaryForeground = hexToHslTriplet(readableForeground(appearance.secondaryButton));
  const accentForeground = hexToHslTriplet(readableForeground("#A97B8B"));

  const bg = hexToHsl(appearance.background);
  // الثيمات الفاتحة تحتاج طبقات إبراز/إطار داكنة، والداكنة تحتاج فاتحة — حتى لا تختفي الإطارات
  const isLightTheme = bg.l > 55;

  return {
    "--background": hexToHslTriplet(appearance.background),
    "--foreground": hexToHslTriplet(appearance.text),
    "--card": hexToHslTriplet(appearance.cards),
    "--card-foreground": hexToHslTriplet(appearance.text),
    "--card-border": hexToHslTriplet("#2A2D36"),
    "--popover": hexToHslTriplet(appearance.cards),
    "--popover-foreground": hexToHslTriplet(appearance.text),
    "--popover-border": hexToHslTriplet("#2A2D36"),
    "--primary": hexToHslTriplet(appearance.primaryButton),
    "--primary-foreground": primaryForeground,
    "--secondary": hexToHslTriplet(appearance.secondaryButton),
    "--secondary-foreground": secondaryForeground,
    "--muted": hexToHslTriplet("#1A1C25"),
    "--muted-foreground": hexToHslTriplet("#C8CBD3"),
    "--accent": hexToHslTriplet("#A97B8B"),
    "--accent-foreground": accentForeground,
    // الإطار العام (يُستخدم في كل الحدود الافتراضية وبطاقات الموقع والهيدر)
    "--border": hexToHslTriplet("#2A2D36"),
    "--input": hexToHslTriplet("#2A2D36"),
    "--ring": hexToHslTriplet(appearance.primaryButton),
    "--sidebar": hexToHslTriplet(appearance.sidebar),
    "--sidebar-foreground": hexToHslTriplet(appearance.text),
    "--sidebar-border": hexToHslTriplet("#2A2D36"),
    "--sidebar-primary": hexToHslTriplet(appearance.primaryButton),
    "--sidebar-primary-foreground": primaryForeground,
    "--sidebar-accent": hexToHslTriplet(appearance.secondaryButton),
    "--sidebar-accent-foreground": secondaryForeground,
    "--sidebar-ring": hexToHslTriplet(appearance.hover),
    // اتجاه إطار الأزرار المعتمة: يفتّح في الثيم الداكن ويغمّق في الفاتح
    "--opaque-button-border-intensity": isLightTheme ? "-10" : "9",
    // إطار الأزرار + إطار الشارات + طبقات اللمعان عند المرور/الضغط (إحساس الفخامة)
    "--button-outline": "rgba(212, 177, 90, .22)",
    "--badge-outline": "rgba(212, 177, 90, .16)",
    "--elevate-1": "rgba(212, 177, 90, .055)",
    "--elevate-2": "rgba(212, 177, 90, .10)",
    "--ajn-header": hexToHslTriplet(appearance.header),
    "--ajn-footer": hexToHslTriplet(appearance.footer),
    "--ajn-heading": hexToHslTriplet(appearance.headings),
    "--ajn-link": hexToHslTriplet(appearance.links),
    "--ajn-hover": hexToHslTriplet(appearance.hover),
    // Semantic status tokens — darker shades for light themes to maintain contrast
    "--status-success": hexToHslTriplet(appearance.primaryButton),
    "--status-danger": isLightTheme ? "0 75% 42%" : "0 84% 70%",
    "--status-warning": "41 50% 48%",
  };
}

// أسطح فاتحة/داكنة جاهزة للوضع البديل (تبقى ألوان الهوية كما هي)
const LIGHT_SURFACES = {
  background: "#0B0B12",
  header: "#12131A",
  footer: "#12131A",
  sidebar: "#12131A",
  cards: "#1A1C25",
  secondaryButton: "#12131A",
  headings: "#FFFFFF",
  text: "#FFFFFF",
} as const;

const DARK_SURFACES = {
  background: "#0B0B12",
  header: "#12131A",
  footer: "#12131A",
  sidebar: "#12131A",
  cards: "#1A1C25",
  secondaryButton: "#12131A",
  headings: "#FFFFFF",
  text: "#FFFFFF",
} as const;

/**
 * يشتق نسخة معاكسة من الثيم (نهاري ↔ ليلي) بقلب الأسطح فقط مع الحفاظ التام على
 * ألوان الهوية (الزر الأساسي، الروابط، Hover). يُستخدم في زر التبديل للزبون.
 */
export function deriveAlternateAppearance(value: unknown): AppearanceSettings {
  const appearance = normalizeAppearanceSettings(value);
  const isDark = hexToHsl(appearance.background).l < 55;
  const surfaces = isDark ? LIGHT_SURFACES : DARK_SURFACES;
  return normalizeAppearanceSettings({
    ...surfaces,
    primaryButton: appearance.primaryButton,
    links: appearance.links,
    hover: appearance.hover,
  });
}
