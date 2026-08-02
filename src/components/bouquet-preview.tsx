import { useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Live bouquet preview (illustrative, procedural SVG — NOT a product photo).
// Re-derives from its input on every render, so quantity, flower colour, wrapping
// colour and ribbon colour all update instantly. Blooms are arranged as a
// hand-tied florist dome (phyllotaxis spiral) that grows with the total flower
// count, cradled by a wrapping cone and finished with a ribbon bow.
//
// Shared by the flower designer (src/views/flower-designer.tsx) and the graduation
// "extras" step (src/views/graduation.tsx) via the normalized `BouquetInput`.
// ─────────────────────────────────────────────────────────────────────────────

export type BouquetFlower = {
  name: string;
  color?: string | null;
  colorHex?: string | null;
  quantity: number;
};
export type BouquetInput = {
  flowers: BouquetFlower[];
  wrapColor?: string | null;
  ribbonColor?: string | null;
};

type BloomKind = "focal" | "filler" | "greenery";
const NAMED_COLORS: [RegExp, string][] = [
  [/(أحمر|احمر|red|قرمزي|عنابي|بوردو|burgundy|maroon)/i, "#d1273a"],
  [/(أبيض|ابيض|white|عاجي|ivory|كريمي|cream)/i, "#f6f2ea"],
  [/(فوشيا|fuchsia|ماجنتا|magenta)/i, "#c0356b"],
  [/(وردي|زهري|pink|روز|rose|باهت)/i, "#ec7f9e"],
  [/(أصفر|اصفر|yellow)/i, "#f2c14e"],
  [/(برتقالي|orange|مشمشي|peach|خوخي)/i, "#ef8a3b"],
  [/(أزرق|ازرق|blue|سماوي|تركوازي|turquoise)/i, "#5b7fbd"],
  [/(بنفسج|purple|violet|lavender|لافندر|موف|أرجواني)/i, "#8e6bb0"],
  [/(أخضر|اخضر|green|زيتي|olive)/i, "#6fae6f"],
  [/(ذهبي|gold|golden)/i, "#c9a24b"],
  [/(فضي|silver|رمادي|gray|grey)/i, "#c3c7cc"],
  [/(بيج|beige|كرافت|kraft|بني|brown|tan)/i, "#d8c2a0"],
  [/(أسود|black)/i, "#3f3f45"],
];
function nameToHex(...names: (string | null | undefined)[]): string | null {
  const text = names.filter(Boolean).join(" ");
  if (!text) return null;
  for (const [re, hex] of NAMED_COLORS) if (re.test(text)) return hex;
  return null;
}
function validHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v) ? (v.startsWith("#") ? v : `#${v}`) : null;
}
function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = Number.parseInt(h.slice(0, 6), 16);
  return Number.isNaN(n) ? { r: 209, g: 39, b: 58 } : { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
// amt in [-1,1]: negative darkens toward black, positive lightens toward white.
function shade(hex: string, amt: number): string {
  const c = parseHex(hex);
  const target = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const mix = (v: number) => Math.round(v + (target - v) * p);
  return `#${[mix(c.r), mix(c.g), mix(c.b)].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}
// Deterministic pseudo-random from an index so the arrangement is stable across
// re-renders (no jitter when an unrelated value changes) yet looks organic.
function jitter(i: number, salt = 1): number {
  const x = Math.sin((i + 1) * 12.9898 * salt) * 43758.5453;
  return x - Math.floor(x);
}
function classifyFlower(name: string, color: string): BloomKind {
  const t = `${name} ${color}`.toLowerCase();
  if (/(بيبي|بيبى|نثري|جبسوفيليا|جبسوفيلا|gyp|baby|breath|فيلر|filler)/i.test(t)) return "filler";
  if (/(أوكالبتوس|يوكالبتوس|eucalyptus|ورق|أوراق|leaf|leaves|foliage|خضرة|نعناع|فرن|fern|سرخس)/i.test(t)) return "greenery";
  return "focal";
}

function Bloom({ x, y, size, hex, seed }: { x: number; y: number; size: number; hex: string; seed: number }) {
  const petal = shade(hex, 0.1);
  const dark = shade(hex, -0.2);
  const darker = shade(hex, -0.36);
  const light = shade(hex, 0.34);
  const rot = jitter(seed, 3) * Math.PI * 2;
  return (
    <g>
      {Array.from({ length: 6 }).map((_, k) => {
        const a = rot + (k / 6) * Math.PI * 2;
        return <circle key={k} cx={x + Math.cos(a) * size * 0.66} cy={y + Math.sin(a) * size * 0.66} r={size * 0.44} fill={petal} opacity={0.95} />;
      })}
      <circle cx={x} cy={y} r={size} fill={hex} />
      <circle cx={x} cy={y} r={size * 0.62} fill={dark} opacity={0.85} />
      <circle cx={x} cy={y} r={size * 0.3} fill={darker} />
      <circle cx={x - size * 0.28} cy={y - size * 0.3} r={size * 0.24} fill={light} opacity={0.55} />
    </g>
  );
}

export function BouquetPreview({ bouquet }: { bouquet: BouquetInput }) {
  const model = useMemo(() => {
    const focal: { hex: string; qty: number }[] = [];
    let fillerQty = 0;
    let greeneryQty = 0;
    for (const flower of bouquet.flowers) {
      const quantity = Math.max(0, Number(flower.quantity) || 0);
      if (quantity <= 0) continue;
      const colorName = flower.color ?? "";
      const kind = classifyFlower(flower.name || "", colorName);
      if (kind === "filler") { fillerQty += quantity; continue; }
      if (kind === "greenery") { greeneryQty += quantity; continue; }
      const hex = validHex(flower.colorHex) ?? nameToHex(colorName, flower.name) ?? "#d1273a";
      focal.push({ hex, qty: quantity });
    }
    const wrapHex = validHex(bouquet.wrapColor) ?? nameToHex(bouquet.wrapColor) ?? "#e9dcc4";
    const ribbonHex = validHex(bouquet.ribbonColor) ?? nameToHex(bouquet.ribbonColor) ?? "#c9a24b";
    const totalFocal = focal.reduce((s, f) => s + f.qty, 0);
    // Cap rendered blooms for performance while keeping true colour ratios and
    // letting the DOME SIZE reflect the real total count.
    const cap = 54;
    const scale = totalFocal > cap ? cap / totalFocal : 1;
    const groups = focal.map((f) => ({ hex: f.hex, n: Math.max(1, Math.round(f.qty * scale)) }));
    const beads: string[] = [];
    let remaining = groups.reduce((s, g) => s + g.n, 0);
    while (remaining > 0) for (const g of groups) if (g.n > 0) { beads.push(g.hex); g.n--; remaining--; }
    return { beads, totalFocal, fillerQty, greeneryQty, wrapHex, ribbonHex };
  }, [bouquet]);

  const { beads, totalFocal, fillerQty, greeneryQty, wrapHex, ribbonHex } = model;
  const hasContent = totalFocal > 0 || fillerQty > 0 || greeneryQty > 0;

  const cx = 160;
  const cy = 148;
  const R = Math.max(46, Math.min(140, 44 + 9 * Math.sqrt(Math.max(1, totalFocal))));
  const neckW = 18;
  const neckY = cy + R * 0.58;
  const bottomY = 338;

  // Focal blooms placed on a golden-angle (phyllotaxis) spiral, flattened into a
  // dome; painted back-to-front so front blooms overlap for a hand-tied look.
  const placed = beads.map((hex, i) => {
    const t = i + 0.5;
    const rr = R * 0.94 * Math.sqrt(t / Math.max(1, beads.length));
    const a = t * 2.399963;
    const jx = (jitter(i, 2) - 0.5) * R * 0.08;
    const jy = (jitter(i, 5) - 0.5) * R * 0.08;
    const x = cx + Math.cos(a) * rr + jx;
    const y = cy + Math.sin(a) * rr * 0.82 - R * 0.06 + jy;
    const size = R * (0.16 + jitter(i, 7) * 0.05);
    return { x, y, size, hex, seed: i };
  }).sort((p, q) => p.y - q.y);

  // Filler (baby's breath) accents scattered around the outer rim/gaps.
  const fillerCount = Math.min(24, Math.round(fillerQty));
  const fillers = Array.from({ length: fillerCount }).map((_, i) => {
    const a = i * 2.399963 + 0.6;
    const rr = R * (0.55 + jitter(i, 11) * 0.5);
    return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.82 - R * 0.06 };
  });

  // Greenery sprigs poking out at the lower edges.
  const greeneryCount = greeneryQty > 0 ? Math.min(7, Math.round(greeneryQty)) : 0;

  const wrapGradId = "ajn-wrap-grad";

  return (
    <div className="mb-4 rounded-2xl border border-border/40 bg-gradient-to-b from-muted/40 to-background p-2" dir="rtl">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-foreground">معاينة الباقة المباشرة</span>
        <span className="text-[10px] text-muted-foreground">
          {totalFocal + fillerQty + greeneryQty > 0 ? `${totalFocal} وردة` : ""}
        </span>
      </div>
      <svg viewBox="0 0 320 360" role="img" aria-label="معاينة تخيلية للباقة" className="mx-auto block h-56 w-full">
        <defs>
          <linearGradient id={wrapGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={shade(wrapHex, 0.18)} />
            <stop offset="55%" stopColor={wrapHex} />
            <stop offset="100%" stopColor={shade(wrapHex, -0.2)} />
          </linearGradient>
        </defs>

        {hasContent ? (
          <>
            {Array.from({ length: greeneryCount }).map((_, i) => {
              const side = i % 2 === 0 ? -1 : 1;
              const bx = cx + side * (R * 0.5 + i * 4);
              const by = cy + R * 0.2;
              const tipX = bx + side * (18 + jitter(i, 4) * 14);
              const tipY = by - 30 - jitter(i, 6) * 26;
              return (
                <g key={`g${i}`} opacity={0.9}>
                  <path d={`M ${bx} ${by} Q ${(bx + tipX) / 2 + side * 8} ${(by + tipY) / 2} ${tipX} ${tipY}`} fill="none" stroke="#5f9e5f" strokeWidth={2} strokeLinecap="round" />
                  {Array.from({ length: 3 }).map((__, k) => {
                    const f = (k + 1) / 4;
                    const lx = bx + (tipX - bx) * f;
                    const ly = by + (tipY - by) * f;
                    return <ellipse key={k} cx={lx} cy={ly} rx={5} ry={2.4} fill="#6fae6f" transform={`rotate(${side * (35 + k * 8)} ${lx} ${ly})`} />;
                  })}
                </g>
              );
            })}

            <path
              d={`M ${cx - R * 1.28} ${cy - R * 0.05} C ${cx - R * 1.0} ${cy + R * 0.55}, ${cx - neckW * 2} ${neckY}, ${cx - neckW * 0.5} ${neckY + 4} L ${cx} ${bottomY} L ${cx + neckW * 0.5} ${neckY + 4} C ${cx + neckW * 2} ${neckY}, ${cx + R * 1.0} ${cy + R * 0.55}, ${cx + R * 1.28} ${cy - R * 0.05} Z`}
              fill={shade(wrapHex, 0.12)}
              opacity={0.85}
            />
            <path
              d={`M ${cx - R * 1.05} ${cy + R * 0.02} C ${cx - R * 0.85} ${cy + R * 0.55}, ${cx - neckW * 1.3} ${neckY}, ${cx - neckW} ${neckY} L ${cx} ${bottomY} L ${cx + neckW} ${neckY} C ${cx + neckW * 1.3} ${neckY}, ${cx + R * 0.85} ${cy + R * 0.55}, ${cx + R * 1.05} ${cy + R * 0.02} Z`}
              fill={`url(#${wrapGradId})`}
            />
            {[-0.6, -0.2, 0.2, 0.6].map((f, i) => (
              <path key={`f${i}`} d={`M ${cx + f * neckW} ${neckY} L ${cx + f * R * 0.95} ${cy + R * 0.05}`} stroke={shade(wrapHex, -0.22)} strokeWidth={1} opacity={0.35} fill="none" />
            ))}

            {placed.map((b, i) => (
              <Bloom key={i} x={b.x} y={b.y} size={b.size} hex={b.hex} seed={b.seed} />
            ))}

            {fillers.map((p, i) => (
              <g key={`fl${i}`}>
                {[[0, 0], [3, -2], [-3, -1], [1, 3]].map(([dx, dy], k) => (
                  <circle key={k} cx={p.x + dx} cy={p.y + dy} r={1.7} fill="#f7f5ef" stroke="#e3ddcf" strokeWidth={0.4} />
                ))}
              </g>
            ))}

            <g>
              <path d={`M ${cx} ${neckY} C ${cx - 34} ${neckY - 22}, ${cx - 42} ${neckY + 16}, ${cx - 6} ${neckY + 6} Z`} fill={ribbonHex} stroke={shade(ribbonHex, -0.25)} strokeWidth={1} />
              <path d={`M ${cx} ${neckY} C ${cx + 34} ${neckY - 22}, ${cx + 42} ${neckY + 16}, ${cx + 6} ${neckY + 6} Z`} fill={ribbonHex} stroke={shade(ribbonHex, -0.25)} strokeWidth={1} />
              <path d={`M ${cx - 4} ${neckY + 5} q -8 24 -18 38 l 9 3 q 9 -20 13 -36 Z`} fill={shade(ribbonHex, -0.16)} />
              <path d={`M ${cx + 4} ${neckY + 5} q 8 24 18 38 l -9 3 q -9 -20 -13 -36 Z`} fill={shade(ribbonHex, -0.16)} />
              <ellipse cx={cx} cy={neckY + 2} rx={7} ry={9} fill={shade(ribbonHex, 0.2)} stroke={shade(ribbonHex, -0.25)} strokeWidth={1} />
            </g>
          </>
        ) : (
          <g>
            <path d={`M ${cx - 70} ${cy} C ${cx - 55} ${cy + 90}, ${cx - 18} ${neckY}, ${cx} ${bottomY} C ${cx + 18} ${neckY}, ${cx + 55} ${cy + 90}, ${cx + 70} ${cy} Z`} fill="hsl(var(--muted))" opacity={0.6} />
            <text x={cx} y={cy + 10} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 13 }}>اختر الورود لتظهر معاينة الباقة</text>
          </g>
        )}
      </svg>
      <p className="px-1 text-center text-[10px] leading-relaxed text-muted-foreground">
        معاينة تخيلية للتصميم فقط (ليست صورة المنتج الفعلي).
      </p>
    </div>
  );
}
