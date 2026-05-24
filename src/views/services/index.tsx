import { Link } from "wouter";
import { useListServices } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

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
  
  const services = apiServices ?? [];

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-foreground mb-4">خدماتنا</h1>
        <div className="h-1 w-20 bg-primary mx-auto rounded-full mb-6" />
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          اختر من مجموعة خدماتنا المتكاملة لنصنع لك مناسبة استثنائية تليق بك
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
            <CardContent className="p-8 text-center text-muted-foreground">لا توجد خدمات متاحة حالياً</CardContent>
          </Card>
        ) : (
          services.map((service) => (
            <Card key={service.id} className="bg-card border-border overflow-hidden flex flex-col">
              <div className="relative h-64 overflow-hidden bg-muted">
                <img 
                  src={(service as any).image || serviceImages[service.type] || '/images/hero.png'} 
                  alt={service.nameAr}
                  width={640}
                  height={420}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full transition-transform duration-700 hover:scale-105"
                  style={{ objectFit: (service as any).imageMetadata?.objectFit ?? "cover" }}
                />
                <div className="absolute bottom-3 right-3 rounded-lg bg-black/55 border border-white/10 px-3 py-1 text-xs text-white backdrop-blur-sm">
                  صور وتفاصيل الخدمة
                </div>
              </div>
              <CardContent className="p-6 flex flex-col flex-1">
                <h2 className="text-2xl font-bold text-foreground mb-3">{service.nameAr}</h2>
                <p className="text-muted-foreground mb-6 flex-1">
                  {service.descriptionAr}
                </p>
                <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
                  <Link href="/gallery" className="rounded-lg border border-border/30 bg-background/60 px-3 py-2 text-center text-muted-foreground hover:text-primary transition-colors">
                    أعمالنا
                  </Link>
                  <Link href={`/services/${service.id}`} className="rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-center text-primary transition-colors">
                    احجز الآن
                  </Link>
                </div>
                <Link href={`/services/${service.id}`}>
                  <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                    طلب الخدمة
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
