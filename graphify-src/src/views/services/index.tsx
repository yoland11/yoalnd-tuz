import { Link } from "wouter";
import { useListServices } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { useContentLocalizer } from "@/lib/content-i18n";

// Since we're using real images from the prompt, let's map them to the types
const serviceImages: Record<string, string> = {
  'kosha': '/images/kosha.png',
  'photography': '/images/photo.png',
  'setup': '/images/setup.png',
  'gifts': '/images/gifts.png',
  'album': '/images/album.png',
  'research': '/images/research.png',
};

export default function Services() {
  const { data: apiServices, isLoading } = useListServices();
  const t = useT();
  const cl = useContentLocalizer();

  const services = apiServices ?? [];

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-foreground mb-4">{t("خدماتنا")}</h1>
        <div className="h-1 w-20 bg-primary mx-auto rounded-full mb-6" />
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          {t("اختر من مجموعة خدماتنا المتكاملة لنصنع لك مناسبة استثنائية تليق بك")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {isLoading ? (
          Array(6).fill(0).map((_, i) => (
            <Card key={i} className="bg-card border-border overflow-hidden">
              <Skeleton className="h-64 w-full rounded-none" />
              <CardContent className="p-6">
                <Skeleton className="h-6 w-2/3 mb-4" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-4/5 mb-6" />
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))
        ) : services.length === 0 ? (
          <Card className="bg-card border-border md:col-span-2 lg:col-span-3">
            <CardContent className="p-8 text-center text-muted-foreground">{t("لا توجد خدمات متاحة حالياً")}</CardContent>
          </Card>
        ) : (
          services.map((service, i) => (
            <Card key={service.id} className="bg-card border-border overflow-hidden flex flex-col group cursor-pointer hover:border-primary/50 transition-[colors,shadow] duration-200 hover:shadow-lg hover:shadow-black/10 animate-fade-up" style={{ animationDelay: `${Math.min(i * 80, 400)}ms` }}>
              <div className="relative h-64 overflow-hidden bg-muted">
                <img
                  src={(service as any).image || serviceImages[service.type] || '/images/hero.png'}
                  alt={cl.name(service)}
                  width={640}
                  height={420}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full transition-transform duration-700 group-hover:scale-105"
                  style={{ objectFit: (service as any).imageMetadata?.objectFit ?? "cover" }}
                />
              </div>
              <CardContent className="p-6 flex flex-col flex-1">
                <h2 className="text-2xl font-bold text-foreground mb-3 group-hover:text-primary transition-colors">{cl.name(service)}</h2>
                <p className="text-muted-foreground mb-6 flex-1 line-clamp-3">
                  {cl.description(service)}
                </p>
                <div className="flex gap-2">
                  <Link href="/gallery" className="flex-1 rounded-lg border border-border/30 bg-background/60 px-3 py-2 text-center text-xs text-muted-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    {t("أعمالنا")}
                  </Link>
                  <Link href={`/services/${service.id}`} className="flex-1">
                    <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                      {t("طلب الخدمة")}
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
