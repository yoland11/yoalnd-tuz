import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Sparkles } from "lucide-react";

type ProductSuggestion = {
  id: number;
  nameAr?: string | null;
  name?: string | null;
  images?: string[] | null;
  price?: number | string | null;
};

type ServiceSuggestion = {
  id: number;
  nameAr?: string | null;
  name?: string | null;
  type?: string | null;
  image?: string | null;
};

type SuggestionItem = {
  key: string;
  title: string;
  image?: string | null;
  href: string;
  meta?: string | null;
};

const SERVICE_SUGGESTIONS: Record<string, string[]> = {
  kosha: ["photography", "album", "gifts"],
  photography: ["album", "setup"],
  album: ["photography", "gifts"],
  setup: ["photography", "album"],
  gifts: ["kosha", "photography"],
};

function serviceScore(context: string | undefined | null, type?: string | null): number {
  if (!type) return 0;
  const preferred = SERVICE_SUGGESTIONS[String(context ?? "")] ?? [];
  const index = preferred.indexOf(type);
  return index >= 0 ? 100 - index : 0;
}

export function SmartSuggestions({
  contextServiceType,
  products,
  services,
  title = "اقتراحات مناسبة لك",
  max = 4,
}: {
  contextServiceType?: string | null;
  products?: ProductSuggestion[] | null;
  services?: ServiceSuggestion[] | null;
  title?: string;
  max?: number;
}) {
  const [loaded, setLoaded] = useState<{ products: ProductSuggestion[]; services: ServiceSuggestion[] }>({ products: [], services: [] });

  useEffect(() => {
    if (products || services) return undefined;
    let mounted = true;
    Promise.all([
      fetch("/api/products/featured").then((res) => res.json()).catch(() => []),
      fetch("/api/services").then((res) => res.json()).catch(() => []),
    ]).then(([nextProducts, nextServices]) => {
      if (!mounted) return;
      setLoaded({
        products: Array.isArray(nextProducts) ? nextProducts : [],
        services: Array.isArray(nextServices) ? nextServices : [],
      });
    });
    return () => {
      mounted = false;
    };
  }, [products, services]);

  const items = useMemo<SuggestionItem[]>(() => {
    const sourceProducts = products ?? loaded.products;
    const sourceServices = services ?? loaded.services;
    const rankedServices = [...sourceServices]
      .filter((service) => !contextServiceType || service.type !== contextServiceType)
      .sort((a, b) => serviceScore(contextServiceType, b.type) - serviceScore(contextServiceType, a.type));

    return [
      ...rankedServices.map((service) => ({
        key: `s-${service.id}`,
        title: service.nameAr || service.name || "خدمة",
        image: service.image,
        href: `/services/${service.id}`,
        meta: "خدمة مقترحة",
      })),
      ...sourceProducts.map((product) => ({
        key: `p-${product.id}`,
        title: product.nameAr || product.name || "منتج",
        image: product.images?.[0],
        href: `/store/${product.id}`,
        meta: product.price ? `${Number(product.price).toLocaleString("ar-IQ")} د.ع` : "منتج مقترح",
      })),
    ].slice(0, max);
  }, [contextServiceType, loaded.products, loaded.services, max, products, services]);

  if (items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border/30 bg-card p-5">
      <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-foreground">
        <Sparkles className="h-5 w-5 text-primary" />
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="flex items-center gap-3 rounded-xl border border-border/25 bg-background/60 p-3 transition-colors hover:border-primary/40"
          >
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border/30 bg-card">
              {item.image ? <img src={item.image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
              {item.meta && <p className="mt-0.5 text-xs text-muted-foreground">{item.meta}</p>}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
