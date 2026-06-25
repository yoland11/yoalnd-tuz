export type ProductColor = {
  name: string;
  hex: string;
  image?: string | null;
  imageUrl?: string | null;
};

export type ProductColorInput = ProductColor | string | null | undefined;

export const PRODUCT_COLOR_PALETTE: ProductColor[] = [
  { name: "أسود", hex: "#000000" },
  { name: "أبيض", hex: "#FFFFFF" },
  { name: "رمادي", hex: "#808080" },
  { name: "فضي", hex: "#C0C0C0" },
  { name: "ذهبي", hex: "#D4AF37" },
  { name: "شامبين", hex: "#F7E7CE" },
  { name: "بيج", hex: "#F5F5DC" },
  { name: "عاجي", hex: "#FFFFF0" },
  { name: "بني", hex: "#8B4513" },
  { name: "كراميل", hex: "#C68E17" },
  { name: "أحمر", hex: "#FF0000" },
  { name: "خمري", hex: "#800020" },
  { name: "وردي", hex: "#FFC0CB" },
  { name: "زهري فاتح", hex: "#F8BBD0" },
  { name: "بنفسجي", hex: "#800080" },
  { name: "لافندر", hex: "#E6E6FA" },
  { name: "أزرق", hex: "#0000FF" },
  { name: "كحلي", hex: "#000080" },
  { name: "سماوي", hex: "#87CEEB" },
  { name: "تركواز", hex: "#40E0D0" },
  { name: "أخضر", hex: "#008000" },
  { name: "زيتي", hex: "#808000" },
  { name: "نعناعي", hex: "#98FF98" },
  { name: "أصفر", hex: "#FFFF00" },
  { name: "برتقالي", hex: "#FFA500" },
  { name: "خوخي", hex: "#FFE5B4" },
  { name: "مرجاني", hex: "#FF7F50" },
  { name: "ذهبي وردي", hex: "#B76E79" },
  { name: "نحاسي", hex: "#B87333" },
  { name: "عنابي", hex: "#4A0000" },
  { name: "فستقي", hex: "#93C572" },
  { name: "موف", hex: "#E0B0FF" },
  { name: "فيروزي غامق", hex: "#008B8B" },
  { name: "رمادي غامق", hex: "#2F2F2F" },
  { name: "أوف وايت", hex: "#FAF9F6" },
];

const COLOR_NAME_INDEX = new Map(
  PRODUCT_COLOR_PALETTE.map((color) => [normalizeSearchText(color.name), color]),
);
const COLOR_HEX_INDEX = new Map(
  PRODUCT_COLOR_PALETTE.map((color) => [color.hex.toUpperCase(), color]),
);

export function normalizeHex(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const match = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toUpperCase()}` : "";
}

export function normalizeColor(value: ProductColorInput | Record<string, unknown>): ProductColor | null {
  if (!value) return null;

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    const hex = normalizeHex(text);
    if (hex) return COLOR_HEX_INDEX.get(hex) ?? { name: text, hex };
    const byName = COLOR_NAME_INDEX.get(normalizeSearchText(text));
    if (byName) return byName;
    return { name: text, hex: "" };
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const rawName = typeof value.name === "string" ? value.name.trim() : "";
    const rawHex = normalizeHex(value.hex);
    const image = typeof value.image === "string" ? value.image : null;
    const imageUrl = typeof value.imageUrl === "string" ? value.imageUrl : null;
    const byHex = rawHex ? COLOR_HEX_INDEX.get(rawHex) : null;
    const byName = rawName ? COLOR_NAME_INDEX.get(normalizeSearchText(rawName)) : null;
    const base = byHex ?? byName;
    const name = rawName || base?.name || rawHex || "";
    const hex = rawHex || base?.hex || "";
    if (!name && !hex) return null;
    return { name, hex, image, imageUrl };
  }

  return null;
}

export function normalizeColors(value: unknown): ProductColor[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const colors: ProductColor[] = [];

  for (const item of value) {
    const color = normalizeColor(item as ProductColorInput | Record<string, unknown>);
    if (!color) continue;
    const key = colorKey(color);
    if (seen.has(key)) continue;
    seen.add(key);
    colors.push(color);
  }

  return colors;
}

export function colorKey(color: ProductColorInput | Record<string, unknown>): string {
  const normalized = normalizeColor(color);
  if (!normalized) return "";
  return `${normalized.hex || "custom"}:${normalizeSearchText(normalized.name)}`;
}

export function colorLabel(color: ProductColorInput | Record<string, unknown>): string {
  const normalized = normalizeColor(color);
  if (!normalized) return "";
  return normalized.hex ? `${normalized.name} ${normalized.hex}` : normalized.name;
}

export function isLightColor(hex: string): boolean {
  const normalized = normalizeHex(hex);
  if (!normalized) return false;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 170;
}

export function colorImage(color: ProductColorInput | Record<string, unknown>): string | null {
  const normalized = normalizeColor(color);
  return normalized?.imageUrl || normalized?.image || null;
}

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
