import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { useListProducts, type Product } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Filter, Grid3X3, ChevronLeft, Heart, Star } from "lucide-react";
import { ProductColorDots } from "@/components/product-colors";
import { logCustomerActivity } from "@/lib/customer-activity";
import { useWishlist } from "@/lib/wishlist";
import { useT } from "@/lib/i18n";
import { useContentLocalizer } from "@/lib/content-i18n";
import { cn } from "@/lib/utils";

type StoreCategory = {
  id: number;
  name: string;
  nameAr: string;
  nameKu?: string | null;
  nameTr?: string | null;
  slug: string;
  parentId: number | null;
  imageUrl?: string | null;
  productCount?: number;
};

const fallbackCategoryImage = "https://placehold.co/400x400/1a1a1a/c9a84c?text=AJN";
const fallbackProductImage = "https://placehold.co/400x400/1a1a1a/c9a84c?text=AJN";

async function fetchStoreCategories(parent?: string): Promise<StoreCategory[]> {
  const suffix = parent ? `?parent=${encodeURIComponent(parent)}` : "";
  const res = await fetch(`/api/products/store-categories${suffix}`, { credentials: "include" });
  if (!res.ok) throw new Error("تعذر تحميل الأقسام");
  return res.json();
}

export default function Store() {
  const [, subcategoryMatch] = useRoute<{ categorySlug: string; subcategorySlug: string }>("/store/category/:categorySlug/:subcategorySlug");
  const [, categoryMatch] = useRoute<{ categorySlug: string }>("/store/category/:categorySlug");
  const categorySlug = subcategoryMatch?.categorySlug ?? categoryMatch?.categorySlug ?? "";
  const subcategorySlug = subcategoryMatch?.subcategorySlug ?? "";
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [sort, setSort] = useState<ProductSort>("newest");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [discountedOnly, setDiscountedOnly] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const filtersActive = inStockOnly || discountedOnly || minPrice !== "" || maxPrice !== "" || sort !== "newest";
  const clearFilters = () => { setSort("newest"); setInStockOnly(false); setDiscountedOnly(false); setMinPrice(""); setMaxPrice(""); };
  const t = useT();
  const cl = useContentLocalizer();

  const { data: mainCategories, isLoading: mainLoading } = useQuery({
    queryKey: ["/api/products/store-categories"],
    queryFn: () => fetchStoreCategories(),
    staleTime: 5 * 60_000,
  });
  const { data: subcategories, isLoading: subLoading } = useQuery({
    queryKey: ["/api/products/store-categories", categorySlug],
    queryFn: () => fetchStoreCategories(categorySlug),
    enabled: !!categorySlug,
    staleTime: 5 * 60_000,
  });

  const { data: products, isLoading: productsLoading } = useListProducts(
    {
      search: deferredSearch || undefined,
      category: categorySlug || undefined,
      subcategory: subcategorySlug || undefined,
      limit: 80,
    },
    {
      query: {
        enabled: !!subcategorySlug,
        queryKey: ["/api/products", categorySlug, subcategorySlug, deferredSearch],
        staleTime: 2 * 60_000,
      },
    }
  );

  const displayedProducts = useMemo(
    () => applyProductFilters(products ?? [], { sort, inStockOnly, discountedOnly, minPrice, maxPrice }),
    [products, sort, inStockOnly, discountedOnly, minPrice, maxPrice],
  );

  const selectedCategory = mainCategories?.find((item) => item.slug === categorySlug);
  const selectedSubcategory = subcategories?.find((item) => item.slug === subcategorySlug);
  const showingProducts = !!subcategorySlug;
  const rows = categorySlug ? (subcategories ?? []) : (mainCategories ?? []);
  const categoriesLoading = categorySlug ? subLoading : mainLoading;
  const title = (selectedSubcategory && cl.name(selectedSubcategory)) || (selectedCategory && cl.name(selectedCategory)) || t("المتجر");
  const subtitle = t(
    showingProducts
      ? "منتجات القسم المختار"
      : categorySlug
        ? "اختر القسم الفرعي المناسب"
        : "اختر القسم الرئيسي للمتجر",
  );

  useEffect(() => {
    logCustomerActivity({
      action: categorySlug ? "category_open" : "visit",
      entityType: subcategorySlug ? "subcategory" : categorySlug ? "category" : "store",
      entityLabel: title,
    });
  }, [categorySlug, subcategorySlug, title]);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div className="w-full md:w-auto">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Link href="/store" className="hover:text-primary transition-colors">{t("المتجر")}</Link>
            {selectedCategory && (
              <>
                <ChevronLeft className="h-4 w-4" />
                <Link href={`/store/category/${selectedCategory.slug}`} className="hover:text-primary transition-colors">{cl.name(selectedCategory)}</Link>
              </>
            )}
            {selectedSubcategory && (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span className="text-foreground">{cl.name(selectedSubcategory)}</span>
              </>
            )}
          </div>
          <h1 className="text-3xl font-bold text-foreground">{title}</h1>
          <p className="text-muted-foreground mt-1">{subtitle}</p>
        </div>

        {showingProducts && (
          <div className="flex w-full md:w-auto gap-2">
            <div className="relative w-full md:w-64">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("ابحث داخل القسم...")}
                className="pr-9 bg-card border-border"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {!showingProducts ? (
        <CategoryGrid
          isLoading={categoriesLoading}
          categories={rows}
          parentSlug={categorySlug}
        />
      ) : (
        <>
          <ProductFilterBar
            total={products?.length ?? 0}
            shown={displayedProducts.length}
            sort={sort}
            onSortChange={setSort}
            inStockOnly={inStockOnly}
            onToggleInStock={() => setInStockOnly((v) => !v)}
            discountedOnly={discountedOnly}
            onToggleDiscounted={() => setDiscountedOnly((v) => !v)}
            minPrice={minPrice}
            onMinPrice={setMinPrice}
            maxPrice={maxPrice}
            onMaxPrice={setMaxPrice}
            filtersActive={filtersActive}
            onClear={clearFilters}
          />
          <ProductsGrid
            isLoading={productsLoading}
            products={displayedProducts}
            onClearSearch={() => { setSearch(""); clearFilters(); }}
          />
        </>
      )}
    </div>
  );
}

function CategoryGrid({ isLoading, categories, parentSlug }: { isLoading: boolean; categories: StoreCategory[]; parentSlug?: string }) {
  const t = useT();
  const cl = useContentLocalizer();
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
        {Array(8).fill(0).map((_, i) => (
          <Card key={i} className="bg-card border-border overflow-hidden">
            <Skeleton className="aspect-square w-full rounded-none" />
            <CardContent className="p-4">
              <Skeleton className="h-4 w-2/3 mb-2" />
              <Skeleton className="h-4 w-1/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="py-20 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
          <Grid3X3 className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-xl font-medium text-foreground mb-2">{t("لا توجد أقسام")}</h3>
        <p className="text-muted-foreground">{t("سيظهر هذا القسم عند إضافة أقسام من لوحة الإدارة")}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
      {categories.map((category, i) => {
        const href = parentSlug
          ? `/store/category/${parentSlug}/${category.slug}`
          : `/store/category/${category.slug}`;
        return (
          <Link key={category.id} href={href} className="animate-fade-up" style={{ animationDelay: `${Math.min(i * 45, 360)}ms` }}>
            <Card className="bg-card border-border overflow-hidden group cursor-pointer hover:border-primary/50 transition-colors h-full flex flex-col">
              <div className="relative aspect-square overflow-hidden bg-muted">
                <img
                  src={category.imageUrl || fallbackCategoryImage}
                  alt={cl.name(category)}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  loading="lazy"
                />
              </div>
              <CardContent className="p-4 flex flex-col flex-1">
                <h3 className="font-medium text-sm md:text-base line-clamp-2 mb-2 text-foreground group-hover:text-primary transition-colors">
                  {cl.name(category)}
                </h3>
                <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                  <span>{typeof category.productCount === "number" ? `${category.productCount} ${t("منتج")}` : t("عرض القسم")}</span>
                  <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

function ProductsGrid({ isLoading, products, onClearSearch }: { isLoading: boolean; products: Product[]; onClearSearch: () => void }) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
      {isLoading ? (
        Array(8).fill(0).map((_, i) => (
          <Card key={i} className="bg-card border-border overflow-hidden">
            <Skeleton className="aspect-square w-full rounded-none" />
            <CardContent className="p-4">
              <Skeleton className="h-4 w-2/3 mb-2" />
              <Skeleton className="h-4 w-1/3 mb-4" />
              <Skeleton className="h-8 w-full" />
            </CardContent>
          </Card>
        ))
      ) : products.length === 0 ? (
        <div className="col-span-full py-20 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
            <Filter className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-medium text-foreground mb-2">{t("لا توجد منتجات")}</h3>
          <p className="text-muted-foreground">{t("لم يتم العثور على منتجات داخل هذا القسم")}</p>
          <Button variant="link" className="text-primary mt-4" onClick={onClearSearch}>
            {t("مسح البحث")}
          </Button>
        </div>
      ) : (
        products.map((product, i) => <ProductCard key={product.id} product={product} index={i} />)
      )}
    </div>
  );
}

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const { has, toggle } = useWishlist();
  const favorited = has(product.id);
  const t = useT();
  const cl = useContentLocalizer();
  const productName = cl.name(product);
  const description = shortProductDescription(cl.description(product));
  return (
    <Link href={`/store/${product.id}`} className="animate-fade-up block" style={{ animationDelay: `${Math.min(index * 45, 360)}ms` }}>
      <Card className="bg-card border-border overflow-hidden group cursor-pointer hover:border-primary/50 transition-[colors,shadow] duration-200 hover:shadow-lg hover:shadow-black/10 h-full flex flex-col">
        <div className="relative aspect-square overflow-hidden bg-muted">
          <img
            src={product.images[0] || fallbackProductImage}
            alt={productName}
            className="w-full h-full transition-transform duration-500 group-hover:scale-110"
            style={{ objectFit: String(product.imageMetadata?.[0]?.objectFit ?? "cover") as any }}
            loading="lazy"
          />
          {product.stock <= 0 && (
            <div className="absolute top-2 right-2 bg-destructive/90 text-destructive-foreground text-xs font-bold px-2 py-1 rounded backdrop-blur-sm">
              {t("نفذت الكمية")}
            </div>
          )}
          {product.originalPrice && product.originalPrice > product.price && (
            <div className="absolute top-2 left-2 bg-primary/90 text-primary-foreground text-xs font-bold px-2 py-1 rounded backdrop-blur-sm">
              {t("تخفيض")}
            </div>
          )}
        </div>
        <CardContent className="p-4 flex flex-col flex-1">
          <div className="text-xs text-muted-foreground mb-1">{product.subcategoryName ?? product.categoryName ?? product.subcategory ?? product.category}</div>
          <h3 className="font-medium text-sm md:text-base line-clamp-2 mb-2 text-foreground group-hover:text-primary transition-colors">
            {productName}
          </h3>
          {typeof product.rating === "number" && product.rating > 0 && (
            <div className="mb-2 flex items-center gap-1">
              <div className="flex">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} className={cn("h-3.5 w-3.5", s <= Math.round(product.rating!) ? "fill-primary text-primary" : "text-muted-foreground/40")} />
                ))}
              </div>
              <span className="text-[11px] text-muted-foreground">({product.reviewCount ?? 0})</span>
            </div>
          )}
          {description && (
            <p className="mb-2 text-xs leading-5 text-muted-foreground line-clamp-2">
              {description}
            </p>
          )}
          <ProductColorDots colors={product.colors} />

          <div className="mt-auto pt-4 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="font-bold text-primary">{product.price.toLocaleString("en-US")} د.ع</span>
              {product.originalPrice && product.originalPrice > product.price && (
                <span className="text-xs text-muted-foreground line-through">
                  {product.originalPrice.toLocaleString("en-US")} د.ع
                </span>
              )}
            </div>
            <span
              role="button"
              tabIndex={0}
              aria-label={favorited ? t("إزالة من المفضّلة") : t("إضافة إلى المفضّلة")}
              aria-pressed={favorited}
              title={favorited ? t("إزالة من المفضّلة") : t("إضافة إلى المفضّلة")}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(product.id); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggle(product.id); } }}
              className={cn(
                "h-8 w-8 flex items-center justify-center rounded-full transition-colors shrink-0",
                favorited ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10",
              )}
            >
              <Heart className={cn("h-4 w-4", favorited && "fill-current")} />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

type ProductSort = "newest" | "price-asc" | "price-desc" | "rating" | "name";

const SORT_OPTIONS: Array<{ value: ProductSort; label: string }> = [
  { value: "newest", label: "الأحدث" },
  { value: "price-asc", label: "السعر: الأقل أولاً" },
  { value: "price-desc", label: "السعر: الأعلى أولاً" },
  { value: "rating", label: "الأعلى تقييماً" },
  { value: "name", label: "الاسم (أ - ي)" },
];

function applyProductFilters(
  list: Product[],
  opts: { sort: ProductSort; inStockOnly: boolean; discountedOnly: boolean; minPrice: string; maxPrice: string },
): Product[] {
  const min = opts.minPrice.trim() === "" ? null : Number(opts.minPrice);
  const max = opts.maxPrice.trim() === "" ? null : Number(opts.maxPrice);

  const filtered = list.filter((p) => {
    if (opts.inStockOnly && p.stock <= 0) return false;
    if (opts.discountedOnly && !(p.originalPrice && p.originalPrice > p.price)) return false;
    if (min != null && !Number.isNaN(min) && p.price < min) return false;
    if (max != null && !Number.isNaN(max) && p.price > max) return false;
    return true;
  });

  const sorted = [...filtered];
  switch (opts.sort) {
    case "price-asc":
      sorted.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      sorted.sort((a, b) => b.price - a.price);
      break;
    case "rating":
      sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
      break;
    case "name":
      sorted.sort((a, b) => a.nameAr.localeCompare(b.nameAr, "ar"));
      break;
    case "newest":
    default:
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      break;
  }
  return sorted;
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-primary bg-primary/10 text-primary" : "border-border/40 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ProductFilterBar(props: {
  total: number;
  shown: number;
  sort: ProductSort;
  onSortChange: (value: ProductSort) => void;
  inStockOnly: boolean;
  onToggleInStock: () => void;
  discountedOnly: boolean;
  onToggleDiscounted: () => void;
  minPrice: string;
  onMinPrice: (value: string) => void;
  maxPrice: string;
  onMaxPrice: (value: string) => void;
  filtersActive: boolean;
  onClear: () => void;
}) {
  const t = useT();
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border/30 bg-card/60 p-3">
      <span className="text-xs text-muted-foreground">
        {t("عرض {shown} من {total}").replace("{shown}", String(props.shown)).replace("{total}", String(props.total))}
      </span>
      <div className="hidden flex-1 sm:block" />
      <FilterChip active={props.inStockOnly} onClick={props.onToggleInStock}>{t("متوفر فقط")}</FilterChip>
      <FilterChip active={props.discountedOnly} onClick={props.onToggleDiscounted}>{t("العروض")}</FilterChip>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          inputMode="numeric"
          dir="ltr"
          placeholder={t("السعر من")}
          value={props.minPrice}
          onChange={(e) => props.onMinPrice(e.target.value)}
          className="h-9 w-24 bg-card border-border text-xs"
        />
        <span className="text-xs text-muted-foreground">—</span>
        <Input
          type="number"
          inputMode="numeric"
          dir="ltr"
          placeholder={t("السعر إلى")}
          value={props.maxPrice}
          onChange={(e) => props.onMaxPrice(e.target.value)}
          className="h-9 w-20 bg-card border-border text-xs"
        />
      </div>
      <select
        value={props.sort}
        onChange={(e) => props.onSortChange(e.target.value as ProductSort)}
        aria-label={t("ترتيب المنتجات")}
        className="h-9 rounded-lg border border-border/40 bg-card px-3 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{t(o.label)}</option>
        ))}
      </select>
      {props.filtersActive && (
        <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={props.onClear}>
          {t("مسح")}
        </Button>
      )}
    </div>
  );
}

function shortProductDescription(value: string): string {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const max = 92;
  return raw.length > max ? `${raw.slice(0, max).trim()}...` : raw;
}
