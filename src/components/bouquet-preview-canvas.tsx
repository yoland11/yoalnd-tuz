"use client";

import { useMemo, useState } from "react";
import { Flower2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type BouquetElementType = "FLOWER" | "GREENERY" | "FILLER" | "WRAPPING" | "RIBBON" | "ACCESSORY" | "TEMPLATE" | "EXCLUDED";

export type BouquetPreviewItem = {
  productId: string;
  elementType: BouquetElementType;
  quantity: number;
  color?: string | null;
  previewAssetUrl?: string | null;
  previewScale?: number | null;
  previewLayer?: number | null;
};

type Placement = BouquetPreviewItem & { key: string; x: number; y: number; rotate: number; scale: number; layer: number };

const flowerSlots = [[50, 39], [35, 44], [65, 44], [43, 28], [57, 28], [24, 53], [76, 53], [49, 57], [34, 61], [66, 61], [26, 32], [74, 32]];
const fillerSlots = [[18, 31], [82, 32], [28, 21], [72, 22], [17, 52], [83, 52], [39, 35], [61, 35]];
const greenerySlots = [[22, 52], [78, 52], [31, 25], [69, 25], [15, 42], [85, 42], [49, 18]];

function seed(input: string) { return [...input].reduce((value, char) => ((value * 31 + char.charCodeAt(0)) >>> 0), 17); }
function typeSlots(type: BouquetElementType) { return type === "GREENERY" ? greenerySlots : type === "FILLER" ? fillerSlots : flowerSlots; }
function defaultColor(type: BouquetElementType) { return type === "GREENERY" ? "#4c7a58" : type === "FILLER" ? "#fff7f2" : type === "RIBBON" ? "#b33a55" : type === "WRAPPING" ? "#d7b0ae" : "#d55b73"; }

function buildPlacements(items: BouquetPreviewItem[]) {
  const placements: Placement[] = [];
  const visualItems = items.filter((item) => !["WRAPPING", "RIBBON", "TEMPLATE", "EXCLUDED"].includes(item.elementType));
  let count = 0;
  for (const item of visualItems) {
    const cap = item.elementType === "ACCESSORY" ? 3 : item.elementType === "GREENERY" ? 8 : item.elementType === "FILLER" ? 12 : 16;
    const copies = Math.min(Math.max(1, Math.round(item.quantity)), cap, 36 - count);
    const slots = typeSlots(item.elementType);
    const base = seed(item.productId);
    for (let index = 0; index < copies; index += 1) {
      const slot = slots[(base + index) % slots.length];
      const spread = ((base >> (index % 12)) % 7) - 3;
      placements.push({ ...item, key: `${item.productId}-${index}`, x: slot[0] + spread, y: slot[1] + (index % 2 ? 2 : -1), rotate: ((base + index * 17) % 24) - 12, scale: (item.previewScale ?? 1) * (0.78 + ((base + index) % 12) / 50), layer: (item.previewLayer ?? 0) + (item.elementType === "GREENERY" ? 12 : item.elementType === "FILLER" ? 34 : item.elementType === "ACCESSORY" ? 72 : 46) + index });
      count += 1;
      if (count >= 36) return placements;
    }
  }
  return placements;
}

function GenericElement({ type, color }: { type: BouquetElementType; color: string }) {
  if (type === "GREENERY") return <g fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"><path d="M50 105C47 74 51 40 61 13" /><path fill={color} stroke="none" d="M57 50C22 42 18 18 23 12c28 3 37 18 34 38Zm0 22C82 61 91 38 86 30c-28 6-37 22-29 42Zm-4 10C25 86 13 107 18 117c27-5 37-18 35-35Zm7-4c26 6 39 25 35 36-24 1-35-11-35-36Z" /></g>;
  if (type === "FILLER") return <g fill={color}><path d="M51 57c-18-22-26-38-21-44 10 0 17 10 21 22C55 23 64 13 74 15c2 10-5 21-18 27 16-3 29 1 31 10-8 8-22 7-33 2 10 10 12 23 4 29-10-4-13-15-9-26-5 12-16 18-27 14-1-10 8-18 29-14Z" /><path fill="#e6b14c" d="M51 44c8 0 12 6 9 13-3 6-13 6-17 0-4-7 0-13 8-13Z" /></g>;
  if (type === "ACCESSORY") return <g fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"><path d="M24 63c10-26 39-37 56-13 16-24 44-13 54 13-21 7-38 21-54 42-16-21-33-35-56-42Z" /><path d="M80 46v57" /></g>;
  return <g><path fill={color} d="M80 13c12 20 9 35 0 43 18-11 33-6 39 7-14 15-29 17-43 11 12 16 9 32-7 40-18-8-23-24-17-40-16 12-33 8-40-7 9-17 25-21 40-12-10-17-6-34 8-43 8 13 10 28 3 43 14-14 29-16 40-5-5 15-18 23-35 22 16 6 24 20 18 34-18 5-32-4-37-19-3 18-16 29-32 26-10-16-2-31 14-38-19 2-32-8-33-24 15-10 30-5 42 7-6-18 0-33 14-40Z" /><path fill="#f4c65a" d="M79 54c15 0 22 11 17 24-5 13-25 14-32 1-7-13 1-25 15-25Z" /></g>;
}

function PreviewNode({ item, placement }: { item: BouquetPreviewItem; placement: Placement }) {
  const [failed, setFailed] = useState(false);
  const color = item.color || defaultColor(item.elementType);
  return <g transform={`translate(${placement.x * 6 - 45} ${placement.y * 5 - 50}) rotate(${placement.rotate} 50 58) scale(${placement.scale})`} style={{ transition: "transform 200ms cubic-bezier(.16,1,.3,1)" }}>
    {item.previewAssetUrl && !failed ? <image href={item.previewAssetUrl} x="0" y="0" width="110" height="118" preserveAspectRatio="xMidYMid meet" onError={() => setFailed(true)} /> : <GenericElement type={item.elementType} color={color} />}
  </g>;
}

export function BouquetPreviewCanvas({ items, note, className }: { items: BouquetPreviewItem[]; note?: string; className?: string }) {
  const placements = useMemo(() => buildPlacements(items), [items]);
  const wrapping = items.filter((item) => item.elementType === "WRAPPING").at(-1);
  const ribbon = items.filter((item) => item.elementType === "RIBBON").at(-1);
  const accessories = items.filter((item) => item.elementType === "ACCESSORY");
  if (!items.length) return <div className={cn("bouquet-preview-canvas bouquet-preview-canvas--empty", className)}><Flower2 /><p>ابدأ باختيار الورد لتظهر معاينة الباقة هنا</p></div>;
  return <div className={cn("bouquet-preview-canvas", className)} aria-live="polite" aria-label="معاينة الباقة">
    <div className="bouquet-preview-canvas__header"><strong>معاينة الباقة</strong><span>معاينة فورية</span></div>
    <svg viewBox="0 0 600 580" role="img" aria-label="تكوين تقريبي للباقة" className="bouquet-preview-canvas__art">
      <defs><filter id="bouquet-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="9" floodOpacity=".22" /></filter></defs>
      <ellipse cx="300" cy="526" rx="166" ry="25" fill="rgba(0,0,0,.18)" />
      {wrapping ? <path d="M112 470C145 294 204 184 300 177c96 7 155 117 188 293l-108 49H220l-108-49Z" fill={wrapping.color || defaultColor("WRAPPING")} opacity=".9" filter="url(#bouquet-shadow)" /> : null}
      {placements.filter((p) => p.elementType === "GREENERY").map((placement) => <PreviewNode key={placement.key} item={placement} placement={placement} />)}
      {placements.filter((p) => p.elementType !== "GREENERY" && p.elementType !== "ACCESSORY").sort((a, b) => a.layer - b.layer).map((placement) => <PreviewNode key={placement.key} item={placement} placement={placement} />)}
      {wrapping ? <path d="M164 439c37 56 78 76 136 77 58-1 99-21 136-77l-35 62H199l-35-62Z" fill={wrapping.color || defaultColor("WRAPPING")} opacity=".75" /> : null}
      {ribbon ? <g transform="translate(246 457)" fill={ribbon.color || defaultColor("RIBBON")} filter="url(#bouquet-shadow)"><path d="M54 24C15-11-19 0 3 36c19 18 36 11 51-4-2 30-2 50-16 75l27-19 26 19c-14-25-14-45-16-75 15 15 32 22 51 4C148 0 114-11 76 24l-11 8-11-8Z" /></g> : null}
      {accessories.slice(0, 3).map((item, index) => <g key={`${item.productId}-${index}`} transform={`translate(${110 + index * 180} ${300 + (index % 2) * 55}) scale(.48)`}><GenericElement type="ACCESSORY" color={item.color || defaultColor("ACCESSORY")} /></g>)}
    </svg>
    <p className="bouquet-preview-canvas__note">{note ? `بطاقة الإهداء: ${note}` : "الصورة تقريبية وقد يختلف التنفيذ النهائي حسب توفر الورد وطريقة التنسيق."}</p>
  </div>;
}
