import { Link } from "wouter";
import { useGetFeaturedProducts, useListServices } from "@workspace/api-client-react";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { handleDefaultLogoError, logoSrc, usePublicSettings } from "@/lib/public-settings";
import { ProductColorDots } from "@/components/product-colors";
import { useT } from "@/lib/i18n";
import { useContentLocalizer } from "@/lib/content-i18n";
import { FeaturedKoshasSection } from "@/views/koshas";
import { formatCurrency } from "@/lib/money";

export default function Home() {
  const { data: featuredProducts, isLoading } = useGetFeaturedProducts();
  const { data: services = [], isLoading: loadingServices } = useListServices();
  const { data: settings } = usePublicSettings();
  const t = useT();
  const cl = useContentLocalizer();
  const siteName = settings?.site_name ?? "مجموعة علي جان";
  const products = Array.isArray(featuredProducts)
    ? featuredProducts
    : (featuredProducts as any)?.items || (featuredProducts as any)?.data || [];

  return (
    <div className="w-full bg-background text-foreground">
      <section className="container mx-auto px-4 pb-8 pt-6 md:pb-14 md:pt-10">
        <div className="grid overflow-hidden rounded-[28px] border border-border/60 bg-card md:grid-cols-[0.92fr_1.08fr]">
          <div className="order-2 flex min-h-[360px] flex-col justify-center px-6 py-10 sm:px-10 md:order-1 md:min-h-[520px] md:px-14">
            <img
              src={logoSrc(settings)}
              alt={siteName}
              width={120}
              height={72}
              fetchPriority="high"
              decoding="async"
              onError={handleDefaultLogoError}
              className="mb-8 h-14 w-28 object-contain object-right"
            />
            <p className="mb-3 text-xs font-medium tracking-[0.16em] text-muted-foreground">AJN COLLECTION</p>
            <h1 className="max-w-xl text-4xl font-semibold leading-[1.25] tracking-tight text-balance md:text-6xl">
              {t("كل تفاصيل مناسبتك بمكان واحد")}
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-7 text-muted-foreground md:text-base">
              {t("اختار الكوشة، الخدمات والتجهيزات والمنتجات بسهولة وبواجهة مرتبة وواضحة.")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/koshas" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90">
                {t("تصفح الكوشات")}
              </Link>
              <Link href="/store" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-background px-6 text-sm font-medium transition-colors hover:bg-muted/60">
                {t("المتجر")}
              </Link>
            </div>
          </div>
          <div className="order-1 min-h-[300px] overflow-hidden bg-muted md:order-2 md:min-h-[520px]">
            <img
              src="/images/hero.png"
              alt={siteName}
              width={1200}
              height={900}
              fetchPriority="high"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12 md:py-16">
        <div className="mb-7 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs text-muted-foreground">{t("تصفح بسهولة")}</p>
            <h2 className="text-2xl font-semibold md:text-3xl">{t("الخدمات")}</h2>
          </div>
          <Link href="/services" className="hidden items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex">
            {t("عرض الكل")} <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
          {loadingServices
            ? Array(3).fill(0).map((_, i) => <Skeleton key={i} className="aspect-[4/5] rounded-2xl" />)
            : services.slice(0, 3).map((service: any) => (
                <Link key={service.id} href={`/services/${service.id}`} className="group block">
                  <div className="overflow-hidden rounded-2xl bg-muted">
                    <div className="aspect-[4/5] overflow-hidden">
                      <img
                        src={service.image || serviceImageFor(service.type)}
                        alt={cl.name(service) || service.name}
                        width={640}
                        height={800}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                        style={{ objectFit: (service as any).imageMetadata?.objectFit ?? "cover" }}
                      />
                    </div>
                  </div>
                  <h3 className="mt-3 text-sm font-medium md:text-base">{cl.name(service) || service.name}</h3>
                </Link>
              ))}
        </div>
      </section>

      <div className="border-y border-border/50 bg-muted/20">
        <FeaturedKoshasSection />
      </div>

      <section className="container mx-auto px-4 py-12 md:py-16">
        <div className="mb-7 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs text-muted-foreground">{t("اختيارات جديدة")}</p>
            <h2 className="text-2xl font-semibold md:text-3xl">{t("وصل حديثاً")}</h2>
          </div>
          <Link href="/store" className="hidden items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex">
            {t("تسوق الآن")} <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-4 md:gap-x-5">
          {isLoading
            ? Array(4).fill(0).map((_, i) => (
                <div key={i}>
                  <Skeleton className="aspect-[4/5] rounded-2xl" />
                  <Skeleton className="mt-3 h-4 w-2/3" />
                  <Skeleton className="mt-2 h-4 w-1/3" />
                </div>
              ))
            : products.slice(0, 4).map((product: any) => (
                <Link key={product.id} href={`/store/${product.id}`} className="group block min-w-0">
                  <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-muted">
                    <img
                      src={(Array.isArray(product.images) ? product.images[0] : null) || product.imageUrl || product.image_url || "/images/hero.png"}
                      alt={cl.name(product) || product.name || "منتج"}
                      width={500}
                      height={625}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                      style={{ objectFit: product.imageMetadata?.[0]?.objectFit ?? "cover" }}
                    />
                  </div>
                  <div className="pt-3">
                    <h3 className="line-clamp-2 text-sm font-medium md:text-base">{cl.name(product) || product.name || "منتج"}</h3>
                    <ProductColorDots colors={product.colors} />
                    <p className="mt-1 text-sm text-muted-foreground">{formatCurrency(product.price)}</p>
                  </div>
                </Link>
              ))}
        </div>
      </section>

      <section className="border-t border-border/50 bg-card">
        <div className="container mx-auto grid gap-8 px-4 py-14 md:grid-cols-[0.8fr_1.2fr] md:items-center md:py-20">
          <div>
            <p className="mb-2 text-xs text-muted-foreground">{t("عن AJN")}</p>
            <h2 className="text-2xl font-semibold md:text-3xl">{t("اختيارات مرتبة. تجربة أبسط.")}</h2>
          </div>
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
            {t("نرتب الكوشات والخدمات والتجهيزات والمنتجات بطريقة واضحة حتى توصل للي تحتاجه بسرعة وبدون زحمة.")}
          </p>
        </div>
      </section>
    </div>
  );
}

function serviceImageFor(type?: string | null): string {
  const key = String(type ?? "");
  if (key.includes("photo")) return "/images/photo.png";
  if (key.includes("kosha")) return "/images/kosha.png";
  if (key.includes("gift")) return "/images/gifts.png";
  if (key.includes("album")) return "/images/album.png";
  if (key.includes("research")) return "/images/research.png";
  return "/images/setup.png";
}
