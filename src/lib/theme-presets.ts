import {
  DEFAULT_APPEARANCE_SETTINGS,
  normalizeAppearanceSettings,
  type AppearanceSettings,
} from "@/lib/appearance";

export type ThemePreset = {
  /** Stable identifier used for matching the active preset. */
  id: string;
  /** Latin name (kept for reference / analytics). */
  name: string;
  /** Arabic label shown in the UI. */
  label: string;
  /** Full appearance palette applied when the preset is selected. */
  colors: AppearanceSettings;
};

/**
 * Ready-made theme presets for "الإعدادات → مظهر الموقع → الثيمات الجاهزة".
 *
 * Every preset is just a complete {@link AppearanceSettings} palette, so it
 * reuses the exact same theming pipeline already in place
 * (appearanceCssVariables -> ThemeVariables -> CSS variables). No layout,
 * spacing, fonts or component structure is touched — only colors.
 *
 * "Classic AJN" intentionally mirrors {@link DEFAULT_APPEARANCE_SETTINGS} so it
 * doubles as the default/restore theme and is highlighted as active on a fresh
 * install.
 */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "classic-ajn",
    name: "Classic AJN",
    label: "AJN الكلاسيكي",
    colors: { ...DEFAULT_APPEARANCE_SETTINGS },
  },
  {
    id: "ajn-premium",
    name: "AJN Premium",
    label: "AJN بريميوم",
    colors: {
      background: "#0B0B0D",
      header: "#0B0B0D",
      footer: "#0B0B0D",
      sidebar: "#141417",
      primaryButton: "#E5C158",
      secondaryButton: "#1F1F24",
      headings: "#F5F0E6",
      text: "#E8E3D8",
      cards: "#15151A",
      links: "#E5C158",
      hover: "#E5C158",
    },
  },
  {
    id: "luxury-gold",
    name: "Luxury Gold",
    label: "الذهبي الفاخر",
    colors: {
      background: "#0A0A0A",
      header: "#100D06",
      footer: "#100D06",
      sidebar: "#15110A",
      primaryButton: "#D4AF37",
      secondaryButton: "#2A2310",
      headings: "#F7E9C2",
      text: "#EFE6D2",
      cards: "#15110A",
      links: "#E6C66A",
      hover: "#E6C66A",
    },
  },
  {
    id: "royal-blue",
    name: "Royal Blue",
    label: "الأزرق الملكي",
    colors: {
      background: "#0A0F1F",
      header: "#0A0F1F",
      footer: "#0A0F1F",
      sidebar: "#0F1730",
      primaryButton: "#3B82F6",
      secondaryButton: "#15203B",
      headings: "#EAF1FF",
      text: "#DCE6F7",
      cards: "#0F1730",
      links: "#6BA6FF",
      hover: "#3B82F6",
    },
  },
  {
    id: "midnight-black",
    name: "Midnight Black",
    label: "أسود منتصف الليل",
    colors: {
      background: "#050505",
      header: "#050505",
      footer: "#050505",
      sidebar: "#0D0D0D",
      primaryButton: "#4B5563",
      secondaryButton: "#161616",
      headings: "#ECECEC",
      text: "#D6D6D6",
      cards: "#0D0D0D",
      links: "#9CA3AF",
      hover: "#6B7280",
    },
  },
  {
    id: "emerald-green",
    name: "Emerald Green",
    label: "الأخضر الزمردي",
    colors: {
      background: "#07140F",
      header: "#07140F",
      footer: "#07140F",
      sidebar: "#0B1F17",
      primaryButton: "#10B981",
      secondaryButton: "#103026",
      headings: "#E6FFF4",
      text: "#D2F1E5",
      cards: "#0B1F17",
      links: "#34D399",
      hover: "#10B981",
    },
  },
  {
    id: "rose-gold",
    name: "Rose Gold",
    label: "الذهبي الوردي",
    colors: {
      background: "#14100F",
      header: "#14100F",
      footer: "#14100F",
      sidebar: "#1E1614",
      primaryButton: "#B76E79",
      secondaryButton: "#2A1E1C",
      headings: "#FBEDEA",
      text: "#F0DEDA",
      cards: "#1E1614",
      links: "#D49AA0",
      hover: "#B76E79",
    },
  },
  {
    id: "modern-gray",
    name: "Modern Gray",
    label: "الرمادي العصري",
    colors: {
      background: "#111315",
      header: "#111315",
      footer: "#111315",
      sidebar: "#1A1D21",
      primaryButton: "#64748B",
      secondaryButton: "#232830",
      headings: "#F1F5F9",
      text: "#D9DEE6",
      cards: "#1A1D21",
      links: "#94A3B8",
      hover: "#64748B",
    },
  },
  {
    id: "deep-purple",
    name: "Deep Purple",
    label: "البنفسجي العميق",
    colors: {
      background: "#0F0A18",
      header: "#0F0A18",
      footer: "#0F0A18",
      sidebar: "#170F26",
      primaryButton: "#8B5CF6",
      secondaryButton: "#221836",
      headings: "#F1EAFF",
      text: "#DED3F2",
      cards: "#170F26",
      links: "#A78BFA",
      hover: "#8B5CF6",
    },
  },
  {
    id: "ocean-blue",
    name: "Ocean Blue",
    label: "أزرق المحيط",
    colors: {
      background: "#07131A",
      header: "#07131A",
      footer: "#07131A",
      sidebar: "#0B1E2A",
      primaryButton: "#0EA5E9",
      secondaryButton: "#103040",
      headings: "#E4F6FF",
      text: "#CDEAF7",
      cards: "#0B1E2A",
      links: "#38BDF8",
      hover: "#0EA5E9",
    },
  },
  {
    id: "soft-pink",
    name: "Soft Pink",
    label: "الوردي الناعم",
    colors: {
      background: "#FFF5F8",
      header: "#FFFFFF",
      footer: "#FFF0F5",
      sidebar: "#FFE9F1",
      primaryButton: "#EC4899",
      secondaryButton: "#FBD7E7",
      headings: "#4A1730",
      text: "#5A2540",
      cards: "#FFFFFF",
      links: "#DB2777",
      hover: "#EC4899",
    },
  },
  {
    id: "dark-red",
    name: "Dark Red",
    label: "الأحمر الداكن",
    colors: {
      background: "#140707",
      header: "#140707",
      footer: "#140707",
      sidebar: "#1F0C0C",
      primaryButton: "#DC2626",
      secondaryButton: "#301212",
      headings: "#FFEAEA",
      text: "#F2D6D6",
      cards: "#1F0C0C",
      links: "#F87171",
      hover: "#DC2626",
    },
  },
  {
    id: "coffee-brown",
    name: "Coffee Brown",
    label: "البني القهوة",
    colors: {
      background: "#14100B",
      header: "#14100B",
      footer: "#14100B",
      sidebar: "#1E1812",
      primaryButton: "#B5793F",
      secondaryButton: "#2C2016",
      headings: "#F3E7D8",
      text: "#E4D5C2",
      cards: "#1E1812",
      links: "#C99A66",
      hover: "#B5793F",
    },
  },
  {
    id: "silver-night",
    name: "Silver Night",
    label: "ليلة فضية",
    colors: {
      background: "#0C0E12",
      header: "#0C0E12",
      footer: "#0C0E12",
      sidebar: "#14171D",
      primaryButton: "#C0C0C0",
      secondaryButton: "#1E222A",
      headings: "#F4F6FA",
      text: "#D7DCE4",
      cards: "#14171D",
      links: "#CBD5E1",
      hover: "#C0C0C0",
    },
  },
  {
    id: "elegant-white",
    name: "Elegant White",
    label: "الأبيض الأنيق",
    colors: {
      background: "#FAFAFA",
      header: "#FFFFFF",
      footer: "#F4F4F5",
      sidebar: "#FFFFFF",
      primaryButton: "#C9A84C",
      secondaryButton: "#ECECEC",
      headings: "#1A1A1A",
      text: "#2A2A2A",
      cards: "#FFFFFF",
      links: "#B08A2E",
      hover: "#C9A84C",
    },
  },
  {
    id: "sunset-orange",
    name: "Sunset Orange",
    label: "برتقالي الغروب",
    colors: {
      background: "#160C06",
      header: "#160C06",
      footer: "#160C06",
      sidebar: "#21130A",
      primaryButton: "#F97316",
      secondaryButton: "#321B0E",
      headings: "#FFEEDD",
      text: "#F6DCC6",
      cards: "#21130A",
      links: "#FB923C",
      hover: "#F97316",
    },
  },
  {
    id: "turquoise",
    name: "Turquoise",
    label: "التركواز",
    colors: {
      background: "#061413",
      header: "#061413",
      footer: "#061413",
      sidebar: "#0A201E",
      primaryButton: "#14B8A6",
      secondaryButton: "#0F302C",
      headings: "#E2FFFB",
      text: "#CDF3EE",
      cards: "#0A201E",
      links: "#2DD4BF",
      hover: "#14B8A6",
    },
  },
  {
    id: "premium-black",
    name: "Premium Black",
    label: "الأسود البريميوم",
    colors: {
      background: "#000000",
      header: "#000000",
      footer: "#000000",
      sidebar: "#0A0A0A",
      primaryButton: "#FFFFFF",
      secondaryButton: "#141414",
      headings: "#FFFFFF",
      text: "#E5E5E5",
      cards: "#0A0A0A",
      links: "#FFFFFF",
      hover: "#D4D4D4",
    },
  },
  {
    id: "forest-green",
    name: "Forest Green",
    label: "أخضر الغابة",
    colors: {
      background: "#0A130C",
      header: "#0A130C",
      footer: "#0A130C",
      sidebar: "#101E13",
      primaryButton: "#22C55E",
      secondaryButton: "#16301E",
      headings: "#E8F7EC",
      text: "#D2EBD8",
      cards: "#101E13",
      links: "#4ADE80",
      hover: "#22C55E",
    },
  },
  {
    id: "golden-luxury",
    name: "Golden Luxury",
    label: "الذهب الفخم",
    colors: {
      background: "#0B0A06",
      header: "#0B0A06",
      footer: "#0B0A06",
      sidebar: "#14110A",
      primaryButton: "#E8B923",
      secondaryButton: "#2A2412",
      headings: "#FBF1D4",
      text: "#EFE2BE",
      cards: "#14110A",
      links: "#F4D27A",
      hover: "#E8B923",
    },
  },
];

/**
 * Returns the id of the preset whose palette matches the given appearance
 * settings exactly (after normalization), or null when the palette is custom.
 */
export function matchPresetId(appearance: unknown): string | null {
  const current = normalizeAppearanceSettings(appearance);
  for (const preset of THEME_PRESETS) {
    const palette = normalizeAppearanceSettings(preset.colors);
    const isMatch = (Object.keys(palette) as Array<keyof AppearanceSettings>).every(
      (key) => palette[key] === current[key],
    );
    if (isMatch) return preset.id;
  }
  return null;
}
