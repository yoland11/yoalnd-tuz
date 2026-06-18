import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Images, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n";

export type KoshaImage = {
  id: number;
  imageUrl: string;
  imageMetadata?: Record<string, any>;
  sortOrder?: number;
};

export type Kosha = {
  id: number;
  name: string;
  slug: string;
  description: string;
  price: number;
  oldPrice?: number | null;
  discountPercentage?: number | null;
  mainImage?: string | null;
  galleryImages?: KoshaImage[];
  numberOfPieces?: number | null;
  mainColor?: string | null;
  flowerColor?: string | null;
  koshaSpace?: string | null;
  sideConsoleSpace?: string | null;
  accessories?: string[];
  notes?: string | null;
  availabilityStatus?: string;
  isFeatured?: boolean;
  isActive?: boolean;
  sortOrder?: number;
};

export function formatKoshaPrice(value: number | null | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "حسب الاتفاق";
  return `${n.toLocaleString("ar-IQ")} د.ع`;
}

function shortText(value: string | null | undefined) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 92 ? `${text.slice(0, 92).trim()}...` : text;
}

async function fetchKoshas(featured = false): Promise<Kosha[]> {
  const res = await fetch(`/api/koshas${featured ? "?featured=1" : ""}`);
  if (!res.ok) throw new Error("تعذر تحميل الكوشات");
  return res.json();
}

export function KoshaCard({ kosha, index = 0 }: { kosha: Kosha; index?: number }) {
  const image = kosha.mainImage || kosha.galleryImages?.[0]?.imageUrl || "/images/kosha.png";
  return (
    <Link href={`/koshas/${kosha.slug || kosha.id}`} className="animate-fade-up" style={{ animationDelay: `${Math.min(index * 60, 360)}ms` }}>
      <Card className="group h-full overflow-hidden border-border bg-card transition-colors hover:border-primary/50">
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          <img
            src={image}
            alt={kosha.name}
            width={560}
            height={420}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          {Number(kosha.discountPercentage ?? 0) > 0 && (
            <span className="absolute right-3 top-3 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
              خصم {kosha.discountPercentage}%
            </span>
          )}
        </div>
        <CardContent className="flex min-h-56 flex-col p-4">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-lg font-bold text-primary">{formatKoshaPrice(kosha.price)}</span>
            {kosha.oldPrice ? <span className="text-xs text-muted-foreground line-through">{formatKoshaPrice(kosha.oldPrice)}</span> : null}
          </div>
          <h3 className="text-lg font-bold text-foreground transition-colors group-hover:text-primary">{kosha.name}</h3>
          {shortText(kosha.description) ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{shortText(kosha.description)}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {kosha.numberOfPieces ? <span className="rounded-full bg-muted px-2.5 py-1">{kosha.numberOfPieces} قطعة</span> : null}
            {kosha.mainColor ? <span className="rounded-full bg-muted px-2.5 py-1">{kosha.mainColor}</span> : null}
            {kosha.koshaSpace ? <span className="rounded-full bg-muted px-2.5 py-1">{kosha.koshaSpace}</span> : null}
          </div>
          <Button className="mt-auto w-full gap-2">
            عرض التفاصيل
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </Link>
  );
}

export function FeaturedKoshasSection() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["koshas", "featured"],
    queryFn: () => fetchKoshas(true),
    staleTime: 2 * 60_000,
  });
  if (!isLoading && data.length === 0) return null;
  return (
    <section className="py-20 bg-card border-y border-border">
      <div className="container mx-auto px-4">
        <div className="mb-10 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-foreground mb-4 text-balance">كوشات مميزة</h2>
            <div className="h-1 w-20 bg-primary rounded-full" />
          </div>
          <Link href="/koshas">
            <Button variant="link" className="hidden text-primary sm:flex">عرض الكوشات</Button>
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {isLoading
            ? [1, 2, 3].map((item) => <Skeleton key={item} className="h-80 rounded-xl" />)
            : data.slice(0, 3).map((kosha, index) => <KoshaCard key={kosha.id} kosha={kosha} index={index} />)}
        </div>
      </div>
    </section>
  );
}

export default function KoshasPage() {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["koshas"],
    queryFn: () => fetchKoshas(false),
    staleTime: 2 * 60_000,
  });
  const t = useT();

  return (
    <div className="container mx-auto px-4 py-10 md:py-12">
      <section className="mb-10 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid lg:grid-cols-[0.95fr_1.05fr]">
          <div className="relative min-h-[300px] bg-muted lg:min-h-[420px]">
            <img src="/images/kosha.png" alt="الكوشات" width={1000} height={680} className="h-full min-h-[300px] w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-background/85 via-background/15 to-transparent" />
          </div>
          <div className="flex flex-col justify-center p-6 md:p-10">
            <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              الكوشات
            </div>
            <h1 className="max-w-2xl text-3xl font-bold leading-tight text-foreground md:text-5xl">كتالوج كوشات مستقل للحجز المباشر</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              تصفح الكوشات المتاحة، شاهد الصور والمواصفات، ثم أرسل طلب الحجز ليظهر مباشرة داخل لوحة الإدارة.
            </p>
            <a href="#koshas-list" className="mt-6 w-fit">
              <Button className="gap-2">
                <Images className="h-4 w-4" />
                عرض الكوشات
              </Button>
            </a>
          </div>
        </div>
      </section>

      <section id="koshas-list" className="scroll-mt-24">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground">الكوشات المتاحة</h2>
          <p className="mt-1 text-sm text-muted-foreground">هذا القسم منفصل عن منتجات المتجر.</p>
        </div>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, item) => <Skeleton key={item} className="h-80 rounded-xl" />)}
          </div>
        ) : isError ? (
          <Card className="border-border bg-card">
            <CardContent className="p-8 text-center text-muted-foreground">{t("تعذر تحميل البيانات")}</CardContent>
          </Card>
        ) : data.length === 0 ? (
          <Card className="border-border bg-card">
            <CardContent className="p-8 text-center text-muted-foreground">لا توجد كوشات ظاهرة حالياً.</CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.map((kosha, index) => <KoshaCard key={kosha.id} kosha={kosha} index={index} />)}
          </div>
        )}
      </section>
    </div>
  );
}
