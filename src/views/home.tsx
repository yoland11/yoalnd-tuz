import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useGetFeaturedProducts, useListServices } from "@workspace/api-client-react";
import { ChevronLeft, MapPin, MessageCircle, Phone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { buildWhatsAppLink } from "@/lib/order-stages";
import { ProductColorDots } from "@/components/product-colors";
import { useT } from "@/lib/i18n";
import { useContentLocalizer } from "@/lib/content-i18n";
import { FeaturedKoshasSection } from "@/views/koshas";

export default function Home() {
  const { data: featuredProducts, isLoading } = useGetFeaturedProducts();
  const { data: services = [], isLoading: loadingServices } = useListServices();
  const { data: settings } = usePublicSettings();
  const t = useT();
  const cl = useContentLocalizer();
  const siteName = settings?.site_name ?? "مجموعة علي جان";
  const waLink = settings?.whatsapp ? buildWhatsAppLink(settings.whatsapp, "مرحباً، أريد الاستفسار عن خدمات AJN") : "";

  return (
    <div className="flex flex-col w-full">
      {/* Hero Section */}
      <section className="relative h-[80vh] min-h-[600px] w-full flex items-center justify-center overflow-hidden">
<div className="absolute inset-0 z-0">
          <img 
            src="/images/hero.png" 
            alt="مجموعة علي جان" 
            width={1600}
            height={1000}
            fetchPriority="high"
            className="w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-black/60 bg-gradient-to-t from-background via-black/40 to-transparent" />
        </div>
        
        <div className="relative z-10 container mx-auto px-4 text-center">
          <img src={logoSrc(settings)} alt={siteName} width={160} height={96} fetchPriority="high" decoding="async" className="h-20 md:h-24 w-40 mx-auto mb-5 object-contain drop-shadow-lg animate-fade-up" />
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-4 tracking-tight drop-shadow-lg text-balance animate-fade-up [animation-delay:80ms]">
            {siteName}
          </h1>
          <p className="text-xl md:text-2xl text-primary font-medium mb-10 max-w-2xl mx-auto drop-shadow animate-fade-up [animation-delay:160ms]">
            {t("للمناسبات والتجهيزات")}
          </p>
          <div className="flex flex-wrap justify-center gap-3 mb-8 text-sm text-white/85 animate-fade-up [animation-delay:220ms]">
            {settings?.phone && (
              <a href={`tel:${settings.phone}`} className="inline-flex items-center gap-2 hover:text-primary transition-colors">
                <Phone className="w-4 h-4" /> {settings.phone}
              </a>
            )}
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-primary transition-colors">
                <MessageCircle className="w-4 h-4" /> {t("واتساب")}
              </a>
            )}
            {settings?.map_url && (
              <a href={settings.map_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-primary transition-colors">
                <MapPin className="w-4 h-4" /> {t("موقع المحل")}
              </a>
            )}
          </div>
          
          <div className="flex flex-wrap justify-center gap-4 max-w-3xl mx-auto animate-fade-up [animation-delay:280ms]">
            <Link href="/services">
              <Button size="lg" className="w-40 bg-primary text-primary-foreground hover:bg-primary/90">
                {t("الخدمات")}
              </Button>
            </Link>
            <Link href="/store">
              <Button size="lg" variant="outline" className="w-40 border-primary text-primary hover:bg-primary/10">
                {t("المتجر")}
              </Button>
            </Link>
            <Link href="/track">
              <Button size="lg" variant="outline" className="w-40 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm">
                {t("تتبع الطلب")}
              </Button>
            </Link>
            <Link href="/gallery">
              <Button size="lg" variant="outline" className="w-40 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm">
                {t("أعمالنا")}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Services Overview */}
      <section className="py-20 bg-card border-y border-border">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground mb-4 text-balance">{t("خدماتنا المتميزة")}</h2>
            <div className="h-1 w-20 bg-primary mx-auto rounded-full" />
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
              {t("نقدم مجموعة متكاملة من خدمات تنسيق وتجهيز المناسبات بأعلى مستويات الجودة والفخامة")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {loadingServices ? (
              Array(3).fill(0).map((_, i) => (
                <Skeleton key={i} className="h-64 rounded-lg" />
              ))
            ) : services.slice(0, 3).map((service: any, i: number) => (
              <Link key={service.id} href={`/services/${service.id}`}>
                <div className="group relative h-64 overflow-hidden rounded-lg cursor-pointer border border-border animate-fade-up" style={{ animationDelay: `${i * 80}ms` }}>
                  <img
                    src={service.image || serviceImageFor(service.type)}
                    alt={cl.name(service) || service.name}
                    width={640}
                    height={420}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full transition-transform duration-700 group-hover:scale-105"
                    style={{ objectFit: (service as any).imageMetadata?.objectFit ?? "cover" }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex items-end p-6">
                    <h3 className="text-xl font-bold text-white">{cl.name(service) || service.name}</h3>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          
          <div className="mt-10 text-center">
            <Link href="/services">
              <Button variant="ghost" className="text-primary hover:text-primary hover:bg-primary/10">
                {t("عرض جميع الخدمات")}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <FeaturedKoshasSection />

      {/* Featured Products */}
{/* Featured Products */}
<section className="py-20 bg-background">
  <div className="container mx-auto px-4">
    <div className="flex justify-between items-end mb-10">
      <div>
        <h2 className="text-3xl font-bold text-foreground mb-4 text-balance">{t("وصل حديثاً")}</h2>
        <div className="h-1 w-20 bg-primary rounded-full" />
      </div>
      <Link href="/store">
        <Button variant="link" className="text-primary hidden sm:flex">
          {t("تسوق الآن")}
        </Button>
      </Link>
    </div>

    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
      {isLoading ? (
        Array(4).fill(0).map((_, i) => (
          <Card key={i} className="bg-card border-border overflow-hidden">
            <Skeleton className="h-48 w-full rounded-none" />
            <CardContent className="p-4">
              <Skeleton className="h-4 w-2/3 mb-2" />
              <Skeleton className="h-4 w-1/3" />
            </CardContent>
          </Card>
        ))
      ) : (
        (Array.isArray(featuredProducts)
          ? featuredProducts
          : (featuredProducts as any)?.items || (featuredProducts as any)?.data || []
        )
          .slice(0, 4)
          .map((product: any, i: number) => (
            <Link key={product.id} href={`/store/${product.id}`} className="animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
              <Card className="bg-card border-border overflow-hidden group cursor-pointer hover:border-primary/50 transition-colors h-full flex flex-col">
                <div className="relative aspect-square overflow-hidden bg-muted">
                  <img
                    src={
                      (Array.isArray(product.images) ? product.images[0] : null) ||
                      product.imageUrl ||
                      product.image_url ||
                      "/images/hero.png"
                    }
                    alt={cl.name(product) || product.name || "منتج"}
                    width={400}
                    height={400}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full transition-transform duration-500 group-hover:scale-110"
                    style={{ objectFit: product.imageMetadata?.[0]?.objectFit ?? "cover" }}
                  />
                </div>
                <CardContent className="p-4 flex flex-col flex-1">
                  <h3 className="font-medium text-sm md:text-base line-clamp-2 mb-2 text-foreground group-hover:text-primary transition-colors">
                    {cl.name(product) || product.name || "منتج"}
                  </h3>
                  <ProductColorDots colors={product.colors} />
                  <div className="mt-auto flex items-center justify-between">
                    <span className="font-bold text-primary">
                      {Number(product.price || 0).toLocaleString("en-US")} د.ع
                    </span>
                    <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
      )}
    </div>
  </div>
</section>
      {/* About snippet */}
      <section className="py-24 bg-card border-t border-border relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '32px 32px' }} />
        <div className="container mx-auto px-4 text-center relative z-10 max-w-3xl">
          <h2 className="text-3xl font-bold text-primary mb-6 text-balance">{t("قصتنا")}</h2>
          <p className="text-lg text-muted-foreground leading-relaxed mb-8 [text-wrap:pretty] max-w-prose mx-auto">
            {t("تأسست {name} في {city} لترتقي بمفهوم المناسبات والتجهيزات. نجمع بين أصالة الثقافة العراقية في الاحتفالات ولمسات الفخامة العصرية، لنصنع ذكريات لا تُنسى في أهم لحظات حياتكم.")
              .replace("{name}", siteName)
              .replace("{city}", settings?.city || "طوزخورماتو")}
          </p>
          <div className="flex justify-center gap-4">
            <div className="w-16 h-[1px] bg-primary/40 mt-4" />
            <div className="w-2 h-2 rounded-full bg-primary mt-3" />
            <div className="w-16 h-[1px] bg-primary/40 mt-4" />
          </div>
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
