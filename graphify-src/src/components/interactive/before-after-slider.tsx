import { useMemo, useState } from "react";
import { Images } from "lucide-react";

export type BeforeAfterPair = {
  id: string | number;
  beforeUrl: string;
  afterUrl: string;
  title?: string | null;
};

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function metaUrl(meta: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const nested = meta.beforeAfter;
  if (nested && typeof nested === "object") {
    for (const key of keys) {
      const value = (nested as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

function pairKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/قبل|بعد|before|after/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function buildBeforeAfterPairs(items: any[] | undefined | null, limit = 6): BeforeAfterPair[] {
  if (!Array.isArray(items)) return [];
  const pairs: BeforeAfterPair[] = [];
  const grouped = new Map<string, { before?: any; after?: any; title?: string }>();

  for (const item of items) {
    if (!item || item.mediaType === "video") continue;
    const meta = (item.imageMetadata && typeof item.imageMetadata === "object" ? item.imageMetadata : {}) as Record<string, unknown>;
    const beforeUrl = metaUrl(meta, ["beforeUrl", "beforeImage", "before"]);
    const afterUrl = metaUrl(meta, ["afterUrl", "afterImage", "after"]);
    const title = textOf(item.titleAr) || textOf(item.title) || "قبل / بعد";
    if (beforeUrl && afterUrl) {
      pairs.push({ id: item.id ?? pairs.length, beforeUrl, afterUrl, title });
      continue;
    }

    const label = `${title} ${item.category ?? ""}`.toLowerCase();
    const key = pairKey(title) || String(item.category ?? "general");
    const slot = grouped.get(key) ?? { title };
    if (/(قبل|before)/i.test(label)) slot.before = item;
    if (/(بعد|after)/i.test(label)) slot.after = item;
    grouped.set(key, slot);
  }

  for (const [key, slot] of grouped) {
    if (slot.before?.mediaUrl && slot.after?.mediaUrl) {
      pairs.push({
        id: key,
        beforeUrl: slot.before.mediaUrl,
        afterUrl: slot.after.mediaUrl,
        title: slot.title || slot.after.titleAr || slot.after.title,
      });
    }
  }

  return pairs.slice(0, limit);
}

export function BeforeAfterSlider({ pair }: { pair: BeforeAfterPair }) {
  const [position, setPosition] = useState(50);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/30 bg-card">
      <div className="relative aspect-[16/10] bg-background">
        <img src={pair.afterUrl} alt={pair.title ?? "بعد"} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
          <img src={pair.beforeUrl} alt={pair.title ?? "قبل"} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        </div>
        <div className="absolute inset-y-0 w-0.5 bg-primary shadow-[0_0_18px_rgba(201,168,76,0.55)]" style={{ right: `${100 - position}%` }} />
        <div className="absolute right-3 top-3 rounded-full border border-border/30 bg-black/45 px-2.5 py-1 text-[11px] text-white">
          قبل
        </div>
        <div className="absolute left-3 top-3 rounded-full border border-border/30 bg-black/45 px-2.5 py-1 text-[11px] text-white">
          بعد
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
          className="absolute inset-x-3 bottom-3 accent-primary"
          aria-label="تحريك المقارنة"
        />
      </div>
      {pair.title && <p className="px-4 py-3 text-sm font-medium text-foreground">{pair.title}</p>}
    </div>
  );
}

export function BeforeAfterSection({ items, title = "قبل / بعد" }: { items?: any[] | null; title?: string }) {
  const pairs = useMemo(() => buildBeforeAfterPairs(items), [items]);
  if (pairs.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Images className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {pairs.map((pair) => (
          <BeforeAfterSlider key={pair.id} pair={pair} />
        ))}
      </div>
    </section>
  );
}
