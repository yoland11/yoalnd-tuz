"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Flower2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type BouquetElementType = "FLOWER" | "GREENERY" | "FILLER" | "WRAPPING" | "RIBBON" | "ACCESSORY" | "TEMPLATE" | "EXCLUDED";

export type BouquetPreviewItem = {
  productId: string;
  elementType: BouquetElementType;
  quantity: number;
  color?: string | null;
  previewCutoutUrl?: string | null;
  readyMadePreviewUrl?: string | null;
  previewScale?: number | null;
  previewRotation?: number | null;
  previewLayer?: number | null;
  isReadyMadeBouquet?: boolean;
};

type Placement = BouquetPreviewItem & { key: string; x: number; y: number; rotate: number; scale: number; depth: number };

const COMPACT_FLOWER_SLOTS = [
  [50, 34, 1.16], [43, 38, 1.1], [57, 38, 1.1], [50, 43, 1.06],
  [37, 40, 1.0], [63, 40, 1.0], [43, 29, .96], [57, 29, .96],
  [31, 44, .9], [69, 44, .9], [39, 48, .94], [61, 48, .94],
  [34, 33, .84], [66, 33, .84], [46, 51, .86], [54, 51, .86],
] as const;
const COMPACT_FILLER_SLOTS = [[32, 30], [68, 30], [27, 42], [73, 42], [39, 25], [61, 25], [42, 47], [58, 47], [48, 28], [52, 51]] as const;
const COMPACT_GREENERY_SLOTS = [[24, 45], [76, 45], [30, 29], [70, 29], [21, 38], [79, 38], [38, 21], [62, 21]] as const;

const FALLBACK_ASSETS: Record<string, string> = {
  FLOWER: "/bouquet-preview-assets/rose-red-cutout.png",
  GREENERY: "/bouquet-preview-assets/greenery-cutout.png",
  FILLER: "/bouquet-preview-assets/baby-breath-cutout.png",
  WRAPPING: "/bouquet-preview-assets/wrapping-ribbon-cutout.png",
  RIBBON: "/bouquet-preview-assets/wrapping-ribbon-cutout.png",
  ACCESSORY: "/bouquet-preview-assets/baby-breath-cutout.png",
};

function stableSeed(input: string) {
  return [...input].reduce((value, char) => ((value * 31 + char.charCodeAt(0)) >>> 0), 23);
}

export function getPhotorealisticFallbackAsset(type: BouquetElementType, _color?: string | null) {
  return FALLBACK_ASSETS[type] ?? null;
}

function slotsFor(type: BouquetElementType) {
  if (type === "GREENERY") return COMPACT_GREENERY_SLOTS;
  if (type === "FILLER" || type === "ACCESSORY") return COMPACT_FILLER_SLOTS;
  return COMPACT_FLOWER_SLOTS;
}

function buildCompactPlacements(items: BouquetPreviewItem[]) {
  const visual = items.filter((item) => !["WRAPPING", "RIBBON", "TEMPLATE", "EXCLUDED"].includes(item.elementType));
  const placements: Placement[] = [];
  let count = 0;
  for (const item of visual) {
    const cap = item.elementType === "GREENERY" ? 8 : item.elementType === "FILLER" ? 12 : item.elementType === "ACCESSORY" ? 3 : 18;
    const copies = Math.min(Math.max(1, Math.round(item.quantity)), cap, 40 - count);
    const seed = stableSeed(`${item.productId}:${item.quantity}:${item.elementType}`);
    const slots = slotsFor(item.elementType);
    for (let index = 0; index < copies; index += 1) {
      // These anchors deliberately start at the centre then fill the compact oval;
      // they never use angle/radius maths and remain stable across React renders.
      const slot = slots[(seed + index) % slots.length];
      const jitterX = ((seed >>> ((index % 7) * 3)) % 5) - 2;
      const jitterY = ((seed >>> ((index % 5) * 4)) % 5) - 2;
      placements.push({
        ...item,
        key: `${item.productId}-${index}`,
        x: slot[0] + jitterX,
        y: slot[1] + jitterY,
        rotate: (item.previewRotation ?? 0) + (((seed + index * 19) % 18) - 9),
        scale: (item.previewScale ?? 1) * (slot[2] ?? 1) * (.94 + ((seed + index) % 5) / 40),
        depth: (item.previewLayer ?? 0) + (item.elementType === "GREENERY" ? 10 : item.elementType === "FILLER" ? 45 : item.elementType === "ACCESSORY" ? 82 : 58) + index,
      });
      count += 1;
      if (count >= 40) return placements;
    }
  }
  return placements;
}

function AssetLayer({ item, placement, className }: { item: BouquetPreviewItem; placement: Placement; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = item.previewCutoutUrl || getPhotorealisticFallbackAsset(item.elementType, item.color);
  if (!src || failed) return null;
  return <img src={src} alt="" aria-hidden="true" draggable={false} loading="eager" decoding="async" onError={() => setFailed(true)} className={cn("bouquet-preview-canvas__layer", className)} style={{ left: `${placement.x}%`, top: `${placement.y}%`, zIndex: placement.depth, transform: `translate(-50%, -50%) rotate(${placement.rotate}deg) scale(${placement.scale})` }} />;
}

function CompleteBouquet({ item }: { item: BouquetPreviewItem }) {
  const [failed, setFailed] = useState(false);
  if (!item.readyMadePreviewUrl || failed) return <div className="bouquet-preview-canvas__missing" role="status"><AlertTriangle /><strong>لا توجد صورة معاينة مفرغة لهذه الباقة</strong><span>أضف صورة معاينة الباقة الجاهزة من إعدادات المنتج.</span></div>;
  return <div className="bouquet-preview-canvas__ready"><img src={item.readyMadePreviewUrl} alt="معاينة الباقة الجاهزة" loading="eager" decoding="async" onError={() => setFailed(true)} /></div>;
}

export function PhotorealisticBouquetPreview({ items, note, className }: { items: BouquetPreviewItem[]; note?: string; className?: string }) {
  const [mode, setMode] = useState<"instant" | "realistic">("instant");
  // There is no configured server-side generation provider in this project.
  // Keep this mode unavailable rather than pretending to generate an image or
  // exposing a client-side key. It can be enabled only with a secured endpoint.
  const realisticEnabled = false;
  const placements = useMemo(() => buildCompactPlacements(items), [items]);
  const readyMade = items.find((item) => item.isReadyMadeBouquet || item.elementType === "TEMPLATE");
  const wrapping = items.filter((item) => item.elementType === "WRAPPING").at(-1);
  const ribbon = items.filter((item) => item.elementType === "RIBBON").at(-1);
  const accessories = placements.filter((item) => item.elementType === "ACCESSORY");
  const hasBouquetContents = placements.some((item) => ["FLOWER", "GREENERY", "FILLER"].includes(item.elementType));
  // A default physical wrap turns any selected botanical products into one
  // coherent bouquet. It is visual-only and never becomes a cart line.
  const wrappingSrc = wrapping?.previewCutoutUrl || (hasBouquetContents ? getPhotorealisticFallbackAsset("WRAPPING") : null);

  if (!items.length) return <div className={cn("bouquet-preview-canvas bouquet-preview-canvas--empty", className)}><Flower2 /><p>اختر الورد والتغليف لتظهر الباقة هنا</p></div>;

  return <section className={cn("bouquet-preview-canvas", className)} aria-label="معاينة الباقة">
    <header className="bouquet-preview-canvas__header"><strong id="bouquet-preview-heading">معاينة الباقة</strong><div className="bouquet-preview-canvas__tabs" role="tablist" aria-labelledby="bouquet-preview-heading"><button type="button" role="tab" aria-selected={mode === "instant"} aria-controls="bouquet-preview-stage" className={mode === "instant" ? "is-active" : ""} onClick={() => setMode("instant")}>معاينة فورية</button><button type="button" role="tab" aria-selected={mode === "realistic"} aria-controls="bouquet-preview-stage" disabled={!realisticEnabled} title={!realisticEnabled ? "تتوفر عند تفعيل خدمة توليد خادمية آمنة" : undefined} className={mode === "realistic" ? "is-active" : ""} onClick={() => setMode("realistic")}>معاينة واقعية</button></div></header>
    {mode === "realistic" && realisticEnabled ? <div id="bouquet-preview-stage" className="bouquet-preview-canvas__generation"><Sparkles /><strong>المعاينة الواقعية تستخدم خدمة التوليد الآمنة المفعّلة.</strong><button type="button" onClick={() => setMode("instant")}>العودة للمعاينة الفورية</button></div> : <div id="bouquet-preview-stage" className="bouquet-preview-canvas__studio">
      <div className="bouquet-preview-canvas__floor-shadow" />
      {readyMade ? <CompleteBouquet item={readyMade} /> : <>
        {wrappingSrc ? <img src={wrappingSrc} alt="" aria-hidden="true" className={cn("bouquet-preview-canvas__wrapping", "bouquet-preview-canvas__wrapping--back", !wrapping && "is-preview-default")} /> : null}
        <div className="bouquet-preview-canvas__bouquet">
          {placements.filter((item) => item.elementType === "GREENERY").map((placement) => <AssetLayer key={placement.key} item={placement} placement={placement} className="is-greenery" />)}
          {placements.filter((item) => item.elementType !== "GREENERY" && item.elementType !== "ACCESSORY").sort((a, b) => a.depth - b.depth).map((placement) => <AssetLayer key={placement.key} item={placement} placement={placement} />)}
        </div>
        {wrappingSrc ? <img src={wrappingSrc} alt="" aria-hidden="true" className={cn("bouquet-preview-canvas__wrapping", "bouquet-preview-canvas__wrapping--front", !wrapping && "is-preview-default")} /> : null}
        {ribbon ? <img src={ribbon.previewCutoutUrl || getPhotorealisticFallbackAsset("RIBBON")} alt="" aria-hidden="true" className="bouquet-preview-canvas__ribbon" /> : null}
        {accessories.map((placement) => <AssetLayer key={placement.key} item={placement} placement={placement} className="is-accessory" />)}
      </>}
    </div>}
    <p className="bouquet-preview-canvas__note">{note ? `بطاقة الإهداء: ${note}` : !wrapping && hasBouquetContents ? "تغليف افتراضي للمعاينة فقط؛ يُحتسب التغليف المختار عند إضافته." : "المعاينة تقريبية وقد يختلف التنفيذ النهائي حسب توفر الورد وطريقة التنسيق."}</p>
  </section>;
}

/** Compatibility export for callers during the component migration. */
export const BouquetPreviewCanvas = PhotorealisticBouquetPreview;
