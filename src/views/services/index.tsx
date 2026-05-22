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

// Fallback services if API fails or doesn't have them
const fallbackServices = [
  { id: 1, nameAr: "كوشات الأعراس", type: "kosha", descriptionAr: "تصميم وتنفيذ أرقى كوشات الأعراس بتفاصيل فخمة تناسب ذوقكم" },
  { id: 2, nameAr: "تجهيزات تخرج", type: "setup", descriptionAr: "تجهيز كامل لحفلات التخرج مع منصات التصوير والديكورات" },
  { id: 3, nameAr: "تصوير احترافي", type: "photography", descriptionAr: "توثيق أجمل اللحظات بعدسات احترافية وفريق متخصص" },
  { id: 4, nameAr: "ألبومات فاخرة", type: "album", descriptionAr: "صناعة وطباعة ألبومات صور بجلود فاخرة وتفاصيل ذهبية" },
  { id: 5, nameAr: "توزيعات وهدايا", type: "gifts", descriptionAr: "توزيعات وهدايا فخمة للمناسبات مصممة خصيصاً لكم" },
  { id: 6, nameAr: "بحوث وتقارير", type: "research", descriptionAr: "خدمات كتابة وتنسيق البحوث والتقارير الأكاديمية والمهنية" }
];

export default function Services() {
  const { data: apiServices, isLoading } = useListServices();
  
  const services = apiServices?.length ? apiServices : fallbackServices;

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
        ) : (
          services.map((service) => (
            <Card key={service.id} className="bg-card border-border overflow-hidden flex flex-col">
              <div className="relative h-64 overflow-hidden bg-muted">
                <img 
                  src={serviceImages[service.type] || (service as any).image || '/images/hero.png'} 
                  alt={service.nameAr}
                  className="w-full h-full object-cover transition-transform duration-700 hover:scale-105"
                />
              </div>
              <CardContent className="p-6 flex flex-col flex-1">
                <h2 className="text-2xl font-bold text-foreground mb-3">{service.nameAr}</h2>
                <p className="text-muted-foreground mb-6 flex-1">
                  {service.descriptionAr}
                </p>
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