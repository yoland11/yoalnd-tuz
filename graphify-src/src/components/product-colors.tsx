import { Check, GripVertical, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  colorKey,
  colorLabel,
  isLightColor,
  normalizeColor,
  normalizeColors,
  normalizeHex,
  normalizeSearchText,
  PRODUCT_COLOR_PALETTE,
  type ProductColor,
  type ProductColorInput,
} from "@/lib/colors";

type ColorPickerProps = {
  value: ProductColorInput[];
  onChange: (colors: ProductColor[]) => void;
  allowMultiple?: boolean;
};

export function ProductColorPicker({ value, onChange, allowMultiple = true }: ColorPickerProps) {
  const selected = useMemo(() => normalizeColors(value), [value]);
  const [search, setSearch] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customHex, setCustomHex] = useState("#D4AF37");
  const [draggedKey, setDraggedKey] = useState<string | null>(null);

  const selectedKeys = useMemo(() => new Set(selected.map(colorKey)), [selected]);
  const filtered = useMemo(() => {
    const q = normalizeSearchText(search);
    if (!q) return PRODUCT_COLOR_PALETTE;
    return PRODUCT_COLOR_PALETTE.filter((color) =>
      normalizeSearchText(`${color.name} ${color.hex}`).includes(q),
    );
  }, [search]);

  function toggleColor(color: ProductColor) {
    const key = colorKey(color);
    if (selectedKeys.has(key)) {
      onChange(selected.filter((item) => colorKey(item) !== key));
      return;
    }
    onChange(allowMultiple ? [...selected, color] : [color]);
  }

  function removeColor(key: string) {
    onChange(selected.filter((item) => colorKey(item) !== key));
  }

  function addCustomColor() {
    const hex = normalizeHex(customHex);
    const name = customName.trim() || "لون مخصص";
    if (!hex) return;
    const color = normalizeColor({ name, hex });
    if (!color) return;
    const next = selectedKeys.has(colorKey(color)) ? selected : [...selected, color];
    onChange(allowMultiple ? next : [color]);
    setShowCustom(false);
    setCustomName("");
  }

  function moveSelected(targetKey: string) {
    if (!draggedKey || draggedKey === targetKey) return;
    const from = selected.findIndex((item) => colorKey(item) === draggedKey);
    const to = selected.findIndex((item) => colorKey(item) === targetKey);
    if (from < 0 || to < 0) return;
    const next = [...selected];
    const [picked] = next.splice(from, 1);
    next.splice(to, 0, picked);
    onChange(next);
    setDraggedKey(null);
  }

  return (
    <div className="space-y-3">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 rounded-xl border border-border/30 bg-background/40 p-2">
          {selected.map((color) => {
            const key = colorKey(color);
            return (
              <span
                key={key}
                draggable
                onDragStart={() => setDraggedKey(key)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => moveSelected(key)}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs text-primary"
                title={colorLabel(color)}
              >
                {allowMultiple && <GripVertical className="h-3 w-3 text-primary/70" />}
                <ColorDot color={color} size="sm" />
                <span>{color.name}</span>
                <span className="font-mono text-[10px] opacity-75" dir="ltr">{color.hex}</span>
                <button
                  type="button"
                  onClick={() => removeColor(key)}
                  className="mr-0.5 rounded-full p-0.5 hover:bg-primary/15"
                  aria-label={`إزالة ${color.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="relative">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ابحث بالاسم أو HEX مثل ذهبي أو #D4AF37"
          className="w-full rounded-lg border border-border/40 bg-background py-2 pl-3 pr-10 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
        />
      </div>

      <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4">
        {filtered.map((color) => {
          const key = colorKey(color);
          const selectedColor = selectedKeys.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleColor(color)}
              className={`group rounded-xl border p-2 text-right transition-all duration-200 hover:border-primary/45 hover:bg-primary/5 ${
                selectedColor ? "border-primary bg-primary/10 ring-1 ring-primary/25" : "border-border/30 bg-background/55"
              }`}
              title={colorLabel(color)}
            >
              <div className="flex items-center gap-2">
                <span className="relative">
                  <ColorDot color={color} size="lg" />
                  {selectedColor && (
                    <span className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-foreground">{color.name}</span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground" dir="ltr">{color.hex}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-border/30 bg-background/40 p-3">
        <button
          type="button"
          onClick={() => setShowCustom((open) => !open)}
          className="inline-flex items-center gap-2 text-xs text-primary hover:text-primary/80"
        >
          <Plus className="h-3.5 w-3.5" />
          إضافة لون مخصص
        </button>
        {showCustom && (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_auto]">
            <label className="flex h-10 w-14 cursor-pointer items-center justify-center rounded-lg border border-border/40 bg-card">
              <input
                type="color"
                value={customHex}
                onChange={(event) => setCustomHex(event.target.value)}
                className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label="اختيار لون مخصص"
              />
            </label>
            <input
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
              placeholder="اسم اللون"
              className="h-10 rounded-lg border border-border/40 bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
            />
            <button
              type="button"
              onClick={addCustomColor}
              className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              إضافة
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ColorDot({ color, size = "md" }: { color: ProductColorInput | Record<string, unknown>; size?: "sm" | "md" | "lg" }) {
  const normalized = normalizeColor(color);
  if (!normalized?.hex) {
    return <span className={`${dotSize(size)} rounded-full border border-border/50 bg-muted`} />;
  }
  return (
    <span
      className={`${dotSize(size)} rounded-full border shadow-sm`}
      style={{
        backgroundColor: normalized.hex,
        borderColor: isLightColor(normalized.hex) ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.22)",
      }}
    />
  );
}

export function ProductColorDots({ colors, max = 5 }: { colors: unknown; max?: number }) {
  const normalized = normalizeColors(colors);
  if (normalized.length === 0) return null;
  const visible = normalized.slice(0, max);
  const extra = normalized.length - visible.length;
  return (
    <div className="mt-2 flex items-center gap-1.5" aria-label="ألوان المنتج">
      {visible.map((color) => (
        <span key={colorKey(color)} title={colorLabel(color)}>
          <ColorDot color={color} size="sm" />
        </span>
      ))}
      {extra > 0 && <span className="text-[10px] text-muted-foreground">+{extra}</span>}
    </div>
  );
}

export function SelectedColorLabel({
  color,
  fallback,
  className = "text-xs text-muted-foreground",
}: {
  color?: ProductColorInput | Record<string, unknown> | null;
  fallback?: string | null;
  className?: string;
}) {
  const normalized = normalizeColor(color ?? fallback ?? null);
  if (!normalized) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <ColorDot color={normalized} size="sm" />
      <span>اللون: {normalized.name}</span>
      {normalized.hex && <span className="font-mono text-[10px] opacity-70" dir="ltr">{normalized.hex}</span>}
    </span>
  );
}

function dotSize(size: "sm" | "md" | "lg"): string {
  if (size === "lg") return "inline-block h-7 w-7";
  if (size === "sm") return "inline-block h-3.5 w-3.5";
  return "inline-block h-5 w-5";
}
