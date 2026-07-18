/**
 * A4 print-layout maths, in real millimetres.
 *
 * Everything is computed in mm and only converted to pixels at the very edge
 * (canvas export) or to CSS mm units (screen preview / native print). That is
 * what makes "Actual Size / 100%" printing come out physically correct.
 */

export type Orientation = "portrait" | "landscape";

export type PageMm = { w: number; h: number };

export const A4: Record<Orientation, PageMm> = {
  portrait: { w: 210, h: 297 },
  landscape: { w: 297, h: 210 },
};

export type Margins = { top: number; right: number; bottom: number; left: number };

/** Most consumer printers cannot image the outer ~3–5 mm of the sheet. */
export const SAFE_MARGIN_MM = 5;

export type Side = "front" | "back";

export type LayoutConfig = {
  orientation: Orientation;
  margins: Margins;
  /** Printed size of one copy, in mm. Never stretched — see `fitWithin`. */
  itemW: number;
  itemH: number;
  gapX: number;
  gapY: number;
  /** Requested grid. Actual placement is clamped to what physically fits. */
  rows: number;
  cols: number;
  /** Border thickness in mm; 0 disables the border. */
  border: number;
  rounded: boolean;
  cutMarks: boolean;
};

export type PlacedItem = {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  side: Side;
};

export type Capacity = {
  cols: number;
  rows: number;
  max: number;
  availW: number;
  availH: number;
  /** True when not even one copy fits at the requested size. */
  overflow: boolean;
};

export function defaultMargins(mm = 10): Margins {
  return { top: mm, right: mm, bottom: mm, left: mm };
}

/** How many copies of `itemW × itemH` fit inside the printable area. */
export function capacity(cfg: LayoutConfig): Capacity {
  const page = A4[cfg.orientation];
  const availW = page.w - cfg.margins.left - cfg.margins.right;
  const availH = page.h - cfg.margins.top - cfg.margins.bottom;

  const fit = (avail: number, item: number, gap: number) => {
    if (item <= 0) return 0;
    if (item > avail) return 0;
    // n items need n*item + (n-1)*gap <= avail
    return Math.max(0, Math.floor((avail + gap) / (item + gap)));
  };

  const cols = fit(availW, cfg.itemW, cfg.gapX);
  const rows = fit(availH, cfg.itemH, cfg.gapY);
  return {
    cols,
    rows,
    max: cols * rows,
    availW,
    availH,
    overflow: cols === 0 || rows === 0,
  };
}

/**
 * Places `sides.length` copies on the sheet, centring the whole block inside
 * the printable area. Returns fewer items than requested when the sheet runs
 * out — the caller surfaces that to the user rather than shrinking anything.
 */
export function placeItems(cfg: LayoutConfig, sides: Side[]): PlacedItem[] {
  const cap = capacity(cfg);
  if (cap.overflow) return [];

  const cols = Math.max(1, Math.min(cfg.cols || cap.cols, cap.cols));
  const rows = Math.max(1, Math.min(cfg.rows || cap.rows, cap.rows));
  const count = Math.min(sides.length, cols * rows);

  const blockW = cols * cfg.itemW + (cols - 1) * cfg.gapX;
  const blockH = rows * cfg.itemH + (rows - 1) * cfg.gapY;
  const originX = cfg.margins.left + Math.max(0, (cap.availW - blockW) / 2);
  const originY = cfg.margins.top + Math.max(0, (cap.availH - blockH) / 2);

  const items: PlacedItem[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    items.push({
      index: i,
      x: originX + c * (cfg.itemW + cfg.gapX),
      y: originY + r * (cfg.itemH + cfg.gapY),
      w: cfg.itemW,
      h: cfg.itemH,
      side: sides[i],
    });
  }
  return items;
}

/**
 * Scales a document's natural size down to fit a target box while preserving
 * its aspect ratio. Used by "Fit" — the document is never distorted.
 */
export function fitWithin(
  naturalW: number,
  naturalH: number,
  boxW: number,
  boxH: number,
): { w: number; h: number } {
  if (naturalW <= 0 || naturalH <= 0) return { w: boxW, h: boxH };
  const scale = Math.min(boxW / naturalW, boxH / naturalH);
  return { w: naturalW * scale, h: naturalH * scale };
}

/** Aspect-preserving size for a given width. */
export function sizeForWidth(naturalW: number, naturalH: number, targetW: number) {
  const ratio = naturalH / naturalW;
  return { w: targetW, h: targetW * ratio };
}

// ─── Preset physical sizes ──────────────────────────────────────────────────

export type SizePreset = {
  value: string;
  label: string;
  /** null = use the document's own scanned dimensions. */
  w: number | null;
  h: number | null;
};

export const SIZE_PRESETS: SizePreset[] = [
  { value: "original", label: "قياس المستمسك الأصلي", w: null, h: null },
  { value: "id1", label: "بطاقة ID-1 — 85.6 × 53.98 ملم", w: 85.6, h: 53.98 },
  { value: "5x5", label: "5 × 5 سم", w: 50, h: 50 },
  { value: "4x6", label: "4 × 6 سم", w: 40, h: 60 },
  { value: "passport", label: "صفحة جواز — 125 × 88 ملم", w: 125, h: 88 },
  { value: "custom", label: "قياس مخصص", w: null, h: null },
];

// ─── Templates ──────────────────────────────────────────────────────────────

export type TemplateId =
  | "one_large"
  | "front_back_side"
  | "front_back_stack"
  | "copies_2"
  | "copies_4"
  | "copies_6"
  | "copies_8"
  | "custom_grid"
  | "passport_copy"
  | "national_id_fb";

export type TemplateDef = {
  id: TemplateId;
  label: string;
  /** Needs both sides scanned before it can be used. */
  needsBothSides: boolean;
  description: string;
};

export const TEMPLATES: TemplateDef[] = [
  { id: "one_large", label: "مستمسك واحد كبير في الوسط", needsBothSides: false, description: "نسخة واحدة بأكبر قياس ممكن" },
  { id: "front_back_side", label: "الأمامي والخلفي جنباً إلى جنب", needsBothSides: true, description: "الوجهان في صف واحد" },
  { id: "front_back_stack", label: "الأمامي فوق والخلفي تحت", needsBothSides: true, description: "الوجهان في عمود واحد" },
  { id: "copies_2", label: "نسختان متطابقتان", needsBothSides: false, description: "نسختان من الوجه المختار" },
  { id: "copies_4", label: "أربع نسخ متطابقة", needsBothSides: false, description: "شبكة 2 × 2" },
  { id: "copies_6", label: "ست نسخ متطابقة", needsBothSides: false, description: "شبكة 2 × 3" },
  { id: "copies_8", label: "ثماني نسخ بقياس الهوية", needsBothSides: false, description: "شبكة 2 × 4 بقياس ID-1" },
  { id: "national_id_fb", label: "البطاقة الوطنية — أمامي وخلفي", needsBothSides: true, description: "أربع مجموعات (أمامي + خلفي)" },
  { id: "passport_copy", label: "نسخة جواز السفر", needsBothSides: false, description: "صفحة الجواز بقياسها الفعلي" },
  { id: "custom_grid", label: "شبكة مخصصة", needsBothSides: false, description: "تحكّم كامل بالصفوف والأعمدة" },
];

export type TemplatePlan = {
  config: Partial<LayoutConfig>;
  /** Which side each slot shows, in order. */
  sides: Side[];
  /** Preferred physical size preset, when the template implies one. */
  sizePreset?: string;
};

/**
 * Turns a template into a concrete grid + slot plan.
 * `available` lists which sides the user actually scanned.
 */
export function planForTemplate(
  id: TemplateId,
  available: Side[],
  primary: Side,
): TemplatePlan {
  const has = (s: Side) => available.includes(s);
  const both: Side[] = has("front") && has("back") ? ["front", "back"] : [primary];
  const repeat = (s: Side, n: number): Side[] => Array.from({ length: n }, () => s);

  switch (id) {
    case "one_large":
      return { config: { rows: 1, cols: 1, gapX: 0, gapY: 0 }, sides: [primary] };
    case "front_back_side":
      return { config: { rows: 1, cols: 2, gapX: 6, gapY: 6 }, sides: both };
    case "front_back_stack":
      return { config: { rows: 2, cols: 1, gapX: 6, gapY: 6 }, sides: both };
    case "copies_2":
      return { config: { rows: 2, cols: 1, gapX: 6, gapY: 6 }, sides: repeat(primary, 2) };
    case "copies_4":
      return { config: { rows: 2, cols: 2, gapX: 6, gapY: 6 }, sides: repeat(primary, 4) };
    case "copies_6":
      return { config: { rows: 3, cols: 2, gapX: 6, gapY: 6 }, sides: repeat(primary, 6) };
    case "copies_8":
      return {
        config: { rows: 4, cols: 2, gapX: 5, gapY: 5 },
        sides: repeat(primary, 8),
        sizePreset: "id1",
      };
    case "national_id_fb": {
      // Four front/back sets stacked as pairs.
      const sides: Side[] = has("back")
        ? ["front", "back", "front", "back", "front", "back", "front", "back"]
        : repeat("front", 8);
      return { config: { rows: 4, cols: 2, gapX: 5, gapY: 5 }, sides, sizePreset: "id1" };
    }
    case "passport_copy":
      return { config: { rows: 2, cols: 1, gapX: 8, gapY: 8 }, sides: both, sizePreset: "passport" };
    case "custom_grid":
    default:
      return { config: {}, sides: repeat(primary, 1) };
  }
}

// ─── Unit conversion ────────────────────────────────────────────────────────

export const MM_PER_INCH = 25.4;

export function mmToPx(mm: number, dpi = 300): number {
  return Math.round((mm / MM_PER_INCH) * dpi);
}

export function pxToMm(px: number, dpi = 300): number {
  return (px / dpi) * MM_PER_INCH;
}

/** Effective DPI of an image printed at a given physical width. */
export function printDpi(imagePx: number, printedMm: number): number {
  if (printedMm <= 0) return 0;
  return Math.round(imagePx / (printedMm / MM_PER_INCH));
}

export type PrintQuality = { label: string; tone: "ok" | "warn" | "bad" };

/** Human verdict on whether the image is dense enough for its printed size. */
export function qualityForDpi(dpi: number): PrintQuality {
  if (dpi >= 300) return { label: "ممتازة (300+ نقطة/بوصة)", tone: "ok" };
  if (dpi >= 200) return { label: "مقبولة (200–299 نقطة/بوصة)", tone: "warn" };
  return { label: "منخفضة — يُفضّل إعادة المسح", tone: "bad" };
}
