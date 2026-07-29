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
  [50, 35, 1.15], [43, 40, 1.08], [57, 40, 1.08], [50, 46, 1.04],
  [35, 39, .98], [65, 39, .98], [41, 29, .92], [59, 29, .92],
  [28, 47, .86], [72, 47, .86], [37, 52, .9], [63, 52, .9],
  [23, 38, .76], [77, 38, .76], [30, 57, .8], [70, 57, .8],
] as const;
const COMPACT_FILLER_SLOTS = [[29, 31], [71, 31], [22, 45], [78, 45], [36, 24], [64, 24], [41, 49], [59, 49], [48, 27], [52, 53]] as const;
const COMPACT_GREENERY_SLOTS = [[21, 49], [79, 49], [27, 30], [73, 30], [16, 39], [84, 39], [35, 20], [65, 20]] as const;

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

  if (!items.length) return <div className={cn("bouquet-preview-canvas bouquet-preview-canvas--empty", className)}><Flower2 /><p>اختر الورد والتغليف لتظهر الباقة هنا</p></div>;

  return <section className={cn("bouquet-preview-canvas", className)} aria-live="polite" aria-label="معاينة الباقة">
    <header className="bouquet-preview-canvas__header"><strong>معاينة الباقة</strong><div className="bouquet-preview-canvas__tabs" role="tablist"><button type="button" role="tab" aria-selected={mode === "instant"} className={mode === "instant" ? "is-active" : ""} onClick={() => setMode("instant")}>معاينة فورية</button><button type="button" role="tab" aria-selected={mode === "realistic"} disabled={!realisticEnabled} className={mode === "realistic" ? "is-active" : ""} onClick={() => setMode("realistic")}>معاينة واقعية</button></div></header>
    {mode === "realistic" && realisticEnabled ? <div className="bouquet-preview-canvas__generation"><Sparkles /><strong>المعاينة الواقعية تستخدم خدمة التوليد الآمنة المفعّلة.</strong><button type="button" onClick={() => setMode("instant")}>العودة للمعاينة الفورية</button></div> : <div className="bouquet-preview-canvas__studio">
      <div className="bouquet-preview-canvas__floor-shadow" />
      {readyMade ? <CompleteBouquet item={readyMade} /> : <>
        {wrapping ? <img src={wrapping.previewCutoutUrl || getPhotorealisticFallbackAsset("WRAPPING")} alt="" aria-hidden="true" className="bouquet-preview-canvas__wrapping bouquet-preview-canvas__wrapping--back" /> : null}
        {placements.filter((item) => item.elementType === "GREENERY").map((placement) => <AssetLayer key={placement.key} item={placement} placement={placement} className="is-greenery" />)}
        {placements.filter((item) => item.elementType !== "GREENERY" && item.elementType !== "ACCESSORY").sort((a, b) => a.depth - b.depth).map((placement) => <AssetLayer key={placement.key} item={placement} placement={placement} />)}
        {wrapping ? <img src={wrapping.previewCutoutUrl || getPhotorealisticFallbackAsset("WRAPPING")} alt="" aria-hidden="true" className="bouquet-preview-canvas__wrapping bouquet-preview-canvas__wrapping--front" /> : null}
        {ribbon ? <img src={ribbon.previewCutoutUrl || getPhotorealisticFallbackAsset("RIBBON")} alt="" aria-hidden="true" className="bouquet-preview-canvas__ribbon" /> : null}
        {accessories.map((placement) => <AssetLayer key={placement.key} item={placement} placement={placement} className="is-accessory" />)}
      </>}
    </div>}
    <p className="bouquet-preview-canvas__note">{note ? `بطاقة الإهداء: ${note}` : "المعاينة تقريبية وقد يختلف التنفيذ النهائي حسب توفر الورد وطريقة التنسيق."}</p>
  </section>;
}

/** Compatibility export for callers during the component migration. */
export const BouquetPreviewCanvas = PhotorealisticBouquetPreview;
