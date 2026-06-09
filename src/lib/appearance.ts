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

export type AppearancePreset = {
  id: string;
  name: string;
  description: string;
  settings: AppearanceSettings;
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

export const APPEARANCE_PRESETS: AppearancePreset[] = [
  {
    id: "ajn-black-gold",
    name: "أسود ذهبي AJN",
    description: "فخم وهادئ",
    settings: DEFAULT_APPEARANCE_SETTINGS,
  },
  {
    id: "champagne-ivory",
    name: "شامبين عاجي",
    description: "ناعم ومناسب للأعراس",
    settings: {
      background: "#F8F2E7",
      header: "#FFF8EA",
      footer: "#EADDC6",
      sidebar: "#201B16",
      primaryButton: "#C79A32",
      secondaryButton: "#EFE2CC",
      headings: "#2A2018",
      text: "#3E3329",
      cards: "#FFFDF7",
      links: "#A97920",
      hover: "#D4AF37",
    },
  },
  {
    id: "emerald-royal",
    name: "زمردي ملكي",
    description: "راقي وقوي",
    settings: {
      background: "#061B14",
      header: "#08271D",
      footer: "#061B14",
      sidebar: "#092219",
      primaryButton: "#D4AF37",
      secondaryButton: "#123B2D",
      headings: "#F8F2D8",
      text: "#E8F2EA",
      cards: "#0D2A20",
      links: "#E5C76A",
      hover: "#19A974",
    },
  },
  {
    id: "midnight-pearl",
    name: "كحلي لؤلؤي",
    description: "حديث ومميز",
    settings: {
      background: "#07111F",
      header: "#0B1830",
      footer: "#07111F",
      sidebar: "#0A1425",
      primaryButton: "#D0B46C",
      secondaryButton: "#172A46",
      headings: "#F4F7FB",
      text: "#DDE7F2",
      cards: "#0F1E35",
      links: "#E3C678",
      hover: "#6EA8FE",
    },
  },
  {
    id: "burgundy-rose",
    name: "عنابي وردي",
    description: "رومانسي واحتفالي",
    settings: {
      background: "#1B070B",
      header: "#2B0B13",
      footer: "#1B070B",
      sidebar: "#240A10",
      primaryButton: "#B76E79",
      secondaryButton: "#3B131D",
      headings: "#FFF0F3",
      text: "#F5DDE2",
      cards: "#2B1018",
      links: "#F1A8B8",
      hover: "#D4AF37",
    },
  },
  {
    id: "modern-white-gold",
    name: "أبيض عصري",
    description: "نظيف وسريع",
    settings: {
      background: "#F7F7F5",
      header: "#FFFFFF",
      footer: "#EFEDEA",
      sidebar: "#141414",
      primaryButton: "#C9A84C",
      secondaryButton: "#E9E7E1",
      headings: "#171717",
      text: "#2A2A2A",
      cards: "#FFFFFF",
      links: "#9B7423",
      hover: "#D4AF37",
    },
  },
  {
    id: "graphite-amber",
    name: "گرافيت كهرماني",
    description: "داشبورد فاخر",
    settings: {
      background: "#111214",
      header: "#18191B",
      footer: "#111214",
      sidebar: "#161719",
      primaryButton: "#F0B84A",
      secondaryButton: "#2A2B2E",
      headings: "#F3F0E8",
      text: "#E4E0D8",
      cards: "#1E2023",
      links: "#F0B84A",
      hover: "#FFCF70",
    },
  },
  {
    id: "espresso-copper",
    name: "اسبريسو نحاسي",
    description: "دافئ ومناسب للهدايا",
    settings: {
      background: "#18100B",
      header: "#21160F",
      footer: "#18100B",
      sidebar: "#1F140E",
      primaryButton: "#B87333",
      secondaryButton: "#332218",
      headings: "#FFF3E2",
      text: "#F0DAC3",
      cards: "#251910",
      links: "#E2A66A",
      hover: "#D4AF37",
    },
  },
  {
    id: "royal-purple",
    name: "بنفسجي ملكي",
    description: "ستايل بوتيك",
    settings: {
      background: "#11091E",
      header: "#1A0E2C",
      footer: "#11091E",
      sidebar: "#160C25",
      primaryButton: "#C9A84C",
      secondaryButton: "#2B1748",
      headings: "#F5F0FF",
      text: "#E9DDFB",
      cards: "#1F1135",
      links: "#D9BEFF",
      hover: "#9D6CFF",
    },
  },
  {
    id: "sand-terracotta",
    name: "رملي تيراكوتا",
    description: "دافئ ومميز",
    settings: {
      background: "#F3E7D6",
      header: "#FFF5E6",
      footer: "#E4CBB0",
      sidebar: "#2D2118",
      primaryButton: "#B85C38",
      secondaryButton: "#EAD6BE",
      headings: "#2B2119",
      text: "#46362A",
      cards: "#FFF9F0",
      links: "#9F4F31",
      hover: "#D28C60",
    },
  },
  {
    id: "sky-minimal",
    name: "سماوي هادئ",
    description: "خفيف ومريح",
    settings: {
      background: "#F4FAFC",
      header: "#FFFFFF",
      footer: "#E5F1F5",
      sidebar: "#0E2430",
      primaryButton: "#2F7D95",
      secondaryButton: "#DDEEF4",
      headings: "#102A36",
      text: "#243C48",
      cards: "#FFFFFF",
      links: "#2F7D95",
      hover: "#65B3C8",
    },
  },
  {
    id: "olive-heritage",
    name: "زيتي تراثي",
    description: "راقي وعملي",
    settings: {
      background: "#15170D",
      header: "#1E2113",
      footer: "#15170D",
      sidebar: "#1A1D10",
      primaryButton: "#C8A64B",
      secondaryButton: "#30351D",
      headings: "#F4F0D8",
      text: "#E5E1C8",
      cards: "#222614",
      links: "#D6B95C",
      hover: "#93A85F",
    },
  },
  {
    id: "ruby-night",
    name: "ياقوت ليلي",
    description: "قوي وفخم",
    settings: {
      background: "#0D0709",
      header: "#1A0A0D",
      footer: "#0D0709",
      sidebar: "#13080A",
      primaryButton: "#C72E45",
      secondaryButton: "#291014",
      headings: "#FFF1F3",
      text: "#EBD9DC",
      cards: "#190D10",
      links: "#FF9CAA",
      hover: "#D4AF37",
    },
  },
  {
    id: "teal-pearl",
    name: "فيروزي لؤلؤي",
    description: "منعش وأنيق",
    settings: {
      background: "#062224",
      header: "#0A3033",
      footer: "#062224",
      sidebar: "#08282A",
      primaryButton: "#D4AF37",
      secondaryButton: "#104245",
      headings: "#F1FFFE",
      text: "#D8F4F2",
      cards: "#0C3437",
      links: "#8FE7DF",
      hover: "#40E0D0",
    },
  },
  {
    id: "orchid-luxe",
    name: "أوركيد ناعم",
    description: "نسائي وفخم",
    settings: {
      background: "#20101E",
      header: "#2A1427",
      footer: "#20101E",
      sidebar: "#241122",
      primaryButton: "#D7A6C8",
      secondaryButton: "#3B1C36",
      headings: "#FFF2FB",
      text: "#F1DCEB",
      cards: "#30172D",
      links: "#F0B6DA",
      hover: "#D4AF37",
    },
  },
  {
    id: "mono-premium",
    name: "مونوكروم بريميوم",
    description: "راقي ومحايد",
    settings: {
      background: "#0F0F10",
      header: "#161617",
      footer: "#0F0F10",
      sidebar: "#141415",
      primaryButton: "#E2E2DF",
      secondaryButton: "#29292B",
      headings: "#FFFFFF",
      text: "#E8E8E5",
      cards: "#1B1B1D",
      links: "#D4AF37",
      hover: "#BFBFB8",
    },
  },
  {
    id: "blush-wedding",
    name: "وردي أعراس",
    description: "ناعم وراقي",
    settings: {
      background: "#FFF5F6",
      header: "#FFFFFF",
      footer: "#F2DFE2",
      sidebar: "#2A171B",
      primaryButton: "#B76E79",
      secondaryButton: "#F1DDE1",
      headings: "#2B171C",
      text: "#493038",
      cards: "#FFFFFF",
      links: "#A45D68",
      hover: "#D4AF37",
    },
  },
  {
    id: "bronze-dark",
    name: "برونزي داكن",
    description: "قوي وذهبي",
    settings: {
      background: "#0E0A06",
      header: "#181008",
      footer: "#0E0A06",
      sidebar: "#140E08",
      primaryButton: "#CD7F32",
      secondaryButton: "#25190F",
      headings: "#FFF0DE",
      text: "#EAD7BF",
      cards: "#1C130B",
      links: "#E1A15F",
      hover: "#D4AF37",
    },
  },
  {
    id: "mint-cream",
    name: "نعناعي كريمي",
    description: "خفيف ومشرق",
    settings: {
      background: "#F2FBF6",
      header: "#FFFFFF",
      footer: "#DFF0E7",
      sidebar: "#10261C",
      primaryButton: "#5D9B78",
      secondaryButton: "#DDEFE5",
      headings: "#13251D",
      text: "#2A4035",
      cards: "#FFFFFF",
      links: "#4A8665",
      hover: "#98CFAF",
    },
  },
  {
    id: "midnight-copper",
    name: "ليلي نحاسي",
    description: "احترافي وحاد",
    settings: {
      background: "#070A0D",
      header: "#0D1218",
      footer: "#070A0D",
      sidebar: "#0A0E13",
      primaryButton: "#B87333",
      secondaryButton: "#17202A",
      headings: "#F2F6FA",
      text: "#DCE5ED",
      cards: "#101820",
      links: "#D08B4C",
      hover: "#C9A84C",
    },
  },
];

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
