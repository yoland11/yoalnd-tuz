import { Link } from "wouter";
import { Armchair, ChevronLeft, Flower2, Gift, Package, ShoppingBag, Sparkles } from "lucide-react";
import { useGetFeaturedProducts, useListServices } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublicSettings } from "@/lib/public-settings";
import { ProductColorDots } from "@/components/product-colors";
import { useT } from "@/lib/i18n";
import { useContentLocalizer } from "@/lib/content-i18n";
import { FeaturedKoshasSection } from "@/views/koshas";
import { formatCurrency } from "@/lib/money";

const categories = [
  ["/koshas", "الكوشات", "كوشات عصرية وفاخرة", Armchair], ["/services", "التجهيزات", "كل ما تحتاجه مناسبتك", Package], ["/design", "الورود", "تنسيقات ورد طبيعية", Flower2], ["/store", "الهدايا", "هدايا راقية ومميزة", Gift], ["/store", "الكوزمتك", "منتجات مختارة بعناية", Sparkles],
] as const;

export default function Home() {
  const { data: featuredProducts, isLoading } = useGetFeaturedProducts();
  const { data: services = [], isLoading: loadingServices } = useListServices();
  const { data: settings } = usePublicSettings();
  const t = useT(); const cl = useContentLocalizer();
  const products = (Array.isArray(featuredProducts) ? featuredProducts : (featuredProducts as any)?.items || (featuredProducts as any)?.data || []).slice(0, 4);
  return <div className="ajn-storefront">
    <section className="ajn-store-shell pt-7 md:pt-8"><div className="ajn-calm-hero"><div className="ajn-calm-hero-copy"><p className="ajn-eyebrow">مجموعة علي جان</p><h1>كل تفاصيل مناسبتك<br />بمكان واحد</h1><p>كوشات فاخرة، تجهيزات متكاملة، ورود طبيعية، هدايا راقية ومنتجات مختارة بعناية.</p><div className="ajn-calm-hero-actions"><Link href="/koshas" className="ajn-calm-primary">تصفح الكوشات</Link><Link href="/store" className="ajn-calm-secondary">تسوق الأقسام <ChevronLeft aria-hidden="true" /></Link></div></div><img src="/images/hero.png" alt="كوشة من أعمال مجموعة علي جان" width={900} height={600} fetchPriority="high" className="ajn-calm-hero-image" /></div></section>
    <section className="ajn-store-shell ajn-calm-categories" aria-label="أقسام التسوق">{categories.map(([href, label, detail, Icon]) => <Link key={label} href={href} className="ajn-calm-category"><Icon aria-hidden="true" /><span><b>{label}</b><small>{detail}</small></span></Link>)}</section>
    <section className="ajn-store-shell ajn-calm-section"><div className="ajn-calm-section-heading"><h2>الأكثر طلباً</h2><Link href="/store">عرض الكل <ChevronLeft aria-hidden="true" /></Link></div><div className="ajn-calm-product-grid">{isLoading ? Array.from({ length: 4 }, (_, i) => <div key={i}><Skeleton className="aspect-[4/3] w-full rounded-xl" /><Skeleton className="mt-3 h-4 w-2/3" /></div>) : products.map((product: any) => { const name = cl.name(product) || product.name || "منتج"; const image = (Array.isArray(product.images) ? product.images[0] : null) || product.imageUrl || product.image_url || "/images/hero.png"; return <Link key={product.id} href={`/store/${product.id}`} className="ajn-calm-product"><div className="ajn-calm-product-image"><img src={image} alt={name} width={600} height={450} loading="lazy" decoding="async" style={{ objectFit: product.imageMetadata?.[0]?.objectFit ?? "cover" }} /><span aria-label="عرض المنتج"><ShoppingBag aria-hidden="true" /></span></div><div className="ajn-calm-product-meta"><h3>{name}</h3><ProductColorDots colors={product.colors} /><b>{formatCurrency(product.price)}</b></div></Link>; })}</div></section>
    <section className="ajn-store-shell ajn-calm-section"><div className="ajn-calm-section-heading"><h2>خدماتنا</h2><Link href="/services">عرض الخدمات <ChevronLeft aria-hidden="true" /></Link></div><div className="ajn-calm-service-grid">{loadingServices ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="aspect-[4/3] rounded-xl" />) : services.slice(0, 3).map((service: any) => <Link key={service.id} href={`/services/${service.id}`} className="ajn-calm-service"><img src={service.image || "/images/setup.png"} alt={cl.name(service) || service.name} width={640} height={480} loading="lazy" decoding="async" style={{ objectFit: service.imageMetadata?.objectFit ?? "cover" }} /><h3>{cl.name(service) || service.name}</h3></Link>)}</div></section>
    <div className="ajn-calm-kosha"><FeaturedKoshasSection /></div><section className="ajn-calm-note"><div><b>{settings?.site_name ?? "مجموعة علي جان"}</b><p>{t("نصنع مناسبات هادئة ومميزة، بتفاصيل مختارة بعناية.")}</p></div></section>
  </div>;
}
