import { useQueries } from "@tanstack/react-query";
import { Link } from "wouter";
import { getProduct, getGetProductQueryKey, type Product } from "@workspace/api-client-react";
import { Heart, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWishlist } from "@/lib/wishlist";
import { useT } from "@/lib/i18n";
import { ProductCard } from "@/views/store/index";

export default function Favorites() {
  const { ids, count, clear } = useWishlist();
  const t = useT();

  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: getGetProductQueryKey(id),
      queryFn: () => getProduct(id),
      staleTime: 2 * 60_000,
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  const products = results.map((r) => r.data).filter((p): p is Product => !!p);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/store" className="hover:text-primary transition-colors">{t("المتجر")}</Link>
            <ChevronLeft className="h-4 w-4" />
            <span className="text-foreground">{t("المفضّلة")}</span>
          </div>
          <h1 className="text-3xl font-bold text-foreground">{t("مفضّلتي")}</h1>
          <p className="mt-1 text-muted-foreground">
            {count > 0 ? t("{count} منتج في قائمتك").replace("{count}", String(count)) : t("أضف منتجاتك المفضّلة من المتجر")}
          </p>
        </div>
        {count > 0 && (
          <Button variant="outline" size="sm" onClick={clear}>{t("مسح الكل")}</Button>
        )}
      </div>

      {count === 0 ? (
        <div className="py-20 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Heart className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="mb-2 text-xl font-medium text-foreground">{t("قائمة المفضّلة فارغة")}</h3>
          <p className="text-muted-foreground">{t("اضغط على ♥ في أي منتج لإضافته هنا")}</p>
          <Link href="/store">
            <Button variant="link" className="mt-4 text-primary">{t("تصفّح المتجر")}</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
          {isLoading && products.length === 0
            ? Array(Math.min(count, 8)).fill(0).map((_, i) => (
                <Card key={i} className="overflow-hidden border-border bg-card">
                  <Skeleton className="aspect-square w-full rounded-none" />
                  <CardContent className="p-4">
                    <Skeleton className="mb-2 h-4 w-2/3" />
                    <Skeleton className="h-4 w-1/3" />
                  </CardContent>
                </Card>
              ))
            : products.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      )}
    </div>
  );
}
