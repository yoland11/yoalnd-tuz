import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { useListProducts, type Product } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShoppingCart, Search, Filter, Grid3X3, ChevronLeft } from "lucide-react";
import { ProductColorDots } from "@/components/product-colors";

type StoreCategory = {
  id: number;
  name: string;
  nameAr: string;
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

  const selectedCategory = mainCategories?.find((item) => item.slug === categorySlug);
  const selectedSubcategory = subcategories?.find((item) => item.slug === subcategorySlug);
  const showingProducts = !!subcategorySlug;
  const rows = categorySlug ? (subcategories ?? []) : (mainCategories ?? []);
  const categoriesLoading = categorySlug ? subLoading : mainLoading;
  const title = selectedSubcategory?.nameAr ?? selectedCategory?.nameAr ?? "المتجر";
  const subtitle = showingProducts
    ? "منتجات القسم المختار"
    : categorySlug
      ? "اختر القسم الفرعي المناسب"
      : "اختر القسم الرئيسي للمتجر";

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div className="w-full md:w-auto">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Link href="/store" className="hover:text-primary transition-colors">المتجر</Link>
            {selectedCategory && (
              <>
                <ChevronLeft className="h-4 w-4" />
                <Link href={`/store/category/${selectedCategory.slug}`} className="hover:text-primary transition-colors">{selectedCategory.nameAr}</Link>
              </>
            )}
            {selectedSubcategory && (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span className="text-foreground">{selectedSubcategory.nameAr}</span>
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
                placeholder="ابحث داخل القسم..."
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
        <ProductsGrid
          isLoading={productsLoading}
          products={products ?? []}
          onClearSearch={() => setSearch("")}
        />
      )}
    </div>
  );
}

function CategoryGrid({ isLoading, categories, parentSlug }: { isLoading: boolean; categories: StoreCategory[]; parentSlug?: string }) {
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
        <h3 className="text-xl font-medium text-foreground mb-2">لا توجد أقسام</h3>
        <p className="text-muted-foreground">سيظهر هذا القسم عند إضافة أقسام من لوحة الإدارة</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
      {categories.map((category) => {
        const href = parentSlug
          ? `/store/category/${parentSlug}/${category.slug}`
          : `/store/category/${category.slug}`;
        return (
          <Link key={category.id} href={href}>
            <Card className="bg-card border-border overflow-hidden group cursor-pointer hover:border-primary/50 transition-colors h-full flex flex-col">
              <div className="relative aspect-square overflow-hidden bg-muted">
                <img
                  src={category.imageUrl || fallbackCategoryImage}
                  alt={category.nameAr}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  loading="lazy"
                />
              </div>
              <CardContent className="p-4 flex flex-col flex-1">
                <h3 className="font-medium text-sm md:text-base line-clamp-2 mb-2 text-foreground group-hover:text-primary transition-colors">
                  {category.nameAr}
                </h3>
                <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                  <span>{typeof category.productCount === "number" ? `${category.productCount} منتج` : "عرض القسم"}</span>
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
          <h3 className="text-xl font-medium text-foreground mb-2">لا توجد منتجات</h3>
          <p className="text-muted-foreground">لم يتم العثور على منتجات داخل هذا القسم</p>
          <Button variant="link" className="text-primary mt-4" onClick={onClearSearch}>
            مسح البحث
          </Button>
        </div>
      ) : (
        products.map((product) => <ProductCard key={product.id} product={product} />)
      )}
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  return (
    <Link href={`/store/${product.id}`}>
      <Card className="bg-card border-border overflow-hidden group cursor-pointer hover:border-primary/50 transition-colors h-full flex flex-col">
        <div className="relative aspect-square overflow-hidden bg-muted">
          <img
            src={product.images[0] || fallbackProductImage}
            alt={product.nameAr}
            className="w-full h-full transition-transform duration-500 group-hover:scale-110"
            style={{ objectFit: String(product.imageMetadata?.[0]?.objectFit ?? "cover") as any }}
            loading="lazy"
          />
          {product.stock <= 0 && (
            <div className="absolute top-2 right-2 bg-destructive/90 text-destructive-foreground text-xs font-bold px-2 py-1 rounded backdrop-blur-sm">
              نفذت الكمية
            </div>
          )}
          {product.originalPrice && product.originalPrice > product.price && (
            <div className="absolute top-2 left-2 bg-primary/90 text-primary-foreground text-xs font-bold px-2 py-1 rounded backdrop-blur-sm">
              تخفيض
            </div>
          )}
        </div>
        <CardContent className="p-4 flex flex-col flex-1">
          <div className="text-xs text-muted-foreground mb-1">{product.subcategoryName ?? product.categoryName ?? product.subcategory ?? product.category}</div>
          <h3 className="font-medium text-sm md:text-base line-clamp-2 mb-2 text-foreground group-hover:text-primary transition-colors">
            {product.nameAr}
          </h3>
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
            <span className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors shrink-0">
              <ShoppingCart className="h-4 w-4" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
