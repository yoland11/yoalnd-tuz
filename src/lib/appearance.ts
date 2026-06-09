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
  return {
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
}

export function hexToHslTriplet(hex: string): string {
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
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function readableForeground(hex: string): string {
  const normalized = normalizeHexColor(hex, "#000000").slice(1);
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0A0A0A" : "#F8F4EA";
}

export function appearanceCssVariables(settings: unknown): Record<string, string> {
  const appearance = normalizeAppearanceSettings(settings);
  const primaryForeground = hexToHslTriplet(readableForeground(appearance.primaryButton));
  const secondaryForeground = hexToHslTriplet(readableForeground(appearance.secondaryButton));
  return {
    "--background": hexToHslTriplet(appearance.background),
    "--foreground": hexToHslTriplet(appearance.text),
    "--card": hexToHslTriplet(appearance.cards),
    "--card-foreground": hexToHslTriplet(appearance.text),
    "--popover": hexToHslTriplet(appearance.cards),
    "--popover-foreground": hexToHslTriplet(appearance.text),
    "--primary": hexToHslTriplet(appearance.primaryButton),
    "--primary-foreground": primaryForeground,
    "--secondary": hexToHslTriplet(appearance.secondaryButton),
    "--secondary-foreground": secondaryForeground,
    "--accent": hexToHslTriplet(appearance.hover),
    "--accent-foreground": primaryForeground,
    "--ring": hexToHslTriplet(appearance.hover),
    "--sidebar": hexToHslTriplet(appearance.sidebar),
    "--sidebar-foreground": hexToHslTriplet(appearance.text),
    "--sidebar-primary": hexToHslTriplet(appearance.primaryButton),
    "--sidebar-primary-foreground": primaryForeground,
    "--sidebar-accent": hexToHslTriplet(appearance.secondaryButton),
    "--sidebar-accent-foreground": secondaryForeground,
    "--ajn-header": hexToHslTriplet(appearance.header),
    "--ajn-footer": hexToHslTriplet(appearance.footer),
    "--ajn-heading": hexToHslTriplet(appearance.headings),
    "--ajn-link": hexToHslTriplet(appearance.links),
    "--ajn-hover": hexToHslTriplet(appearance.hover),
  };
}
