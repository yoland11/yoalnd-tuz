import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useGetService, useCreateServiceOrder } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ServiceDetailFields } from "@/components/service-detail-fields";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { BeforeAfterSection } from "@/components/interactive/before-after-slider";
import { LocationMapCard } from "@/components/interactive/location-map-card";
import { ModelViewerCard } from "@/components/interactive/model-viewer";
import { SmartSuggestions } from "@/components/interactive/smart-suggestions";
import {
  type CrewOption,
  defaultServiceDetails,
  primaryLocationFromDetails,
  validateServiceDetails,
  withDerivedServiceDetails,
} from "@/lib/service-details";
import { formatIraqiPhoneInput, normalizeIraqiPhone } from "@/lib/phone";
import { CalendarIcon, PhoneIcon, UserIcon } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useContentLocalizer } from "@/lib/content-i18n";

const formSchema = z.object({
  customerName: z.string().optional(),
  phone: z.string().optional(),
  eventDate: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function ServiceRequest() {
  const params = useParams();
  const id = parseInt(params.id || "1", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const t = useT();
  const cl = useContentLocalizer();

  const { data: service, isLoading } = useGetService(id, {
    query: { enabled: !!id, queryKey: ['/api/services', id] }
  });

  const createOrder = useCreateServiceOrder();
  const [serviceDetails, setServiceDetails] = useState<Record<string, any>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const serviceType = service?.type ?? null;
  const { data: galleryItems = [] } = useQuery({
    queryKey: ["gallery", serviceType],
    enabled: !!serviceType,
    queryFn: async () => {
      const res = await fetch(`/api/gallery?category=${encodeURIComponent(String(serviceType))}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: crews = [] } = useQuery({
    queryKey: ["crews"],
    queryFn: async () => {
      const res = await fetch("/api/crews");
      if (!res.ok) throw new Error("Failed to load crews");
      return res.json() as Promise<CrewOption[]>;
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerName: "",
      phone: "",
      eventDate: "",
      notes: "",
    },
  });
  const serviceModelUrl =
    service?.imageMetadata && typeof service.imageMetadata === "object"
      ? String((service.imageMetadata as Record<string, unknown>).modelUrl ?? "")
      : "";
  const requestLocation = primaryLocationFromDetails(serviceType, serviceDetails);

  useEffect(() => {
    setServiceDetails(defaultServiceDetails(serviceType));
    setDetailErrors({});
  }, [serviceType]);

  function onSubmit(data: FormValues) {
    const phone = normalizeIraqiPhone(data.phone ?? "");
    if (!phone) {
      form.setError("phone", { message: t("أدخل رقم عراقي صحيح مثل 07700000000") });
      return;
    }
    const details = withDerivedServiceDetails(serviceType, serviceDetails);
    const errors = validateServiceDetails(serviceType, details);
    setDetailErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast({
        title: t("راجع تفاصيل الخدمة"),
        description: t("يرجى مراجعة القيم غير الصحيحة قبل إرسال الطلب."),
        variant: "destructive",
      });
      return;
    }

    createOrder.mutate({
      data: {
        serviceId: id,
        customerName: data.customerName ?? "",
        phone,
        eventDate: data.eventDate || "",
        eventLocation: primaryLocationFromDetails(serviceType, details),
        notes: data.notes,
        customFields: details,
      }
    }, {
      onSuccess: (order) => {
        toast({
          title: t("تم استلام طلبك"),
          description: t("سنتواصل معك قريباً لتأكيد التفاصيل."),
        });
        setLocation(order.trackingCode ? `/track?code=${order.trackingCode}` : "/track");
      },
      onError: (err: any) => {
        toast({
          title: t("تعذر إرسال الطلب"),
          description: err?.message ?? t("يرجى المحاولة مرة أخرى لاحقاً."),
          variant: "destructive"
        });
      }
    });
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <Skeleton className="h-8 w-1/3 mb-4" />
        <Skeleton className="h-4 w-2/3 mb-8" />
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="space-y-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">
          {t("طلب خدمة")}: {(service && cl.name(service)) || t("خدمة مخصصة")}
        </h1>
        <p className="text-muted-foreground">
          {(service && cl.description(service)) || t("الرجاء ملء النموذج أدناه لطلب الخدمة وسنقوم بالتواصل معك.")}
        </p>
      </div>

      {galleryItems.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-2">
          {galleryItems.slice(0, 3).map((item: any) => (
            <div key={item.id} className="aspect-[4/3] overflow-hidden rounded-xl border border-border/30 bg-card">
              {item.mediaType === "video" ? (
                <video src={item.mediaUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              ) : (
                <img src={item.mediaUrl} alt={item.titleAr || item.title || service?.nameAr || "عمل سابق"} width={260} height={195} loading="lazy" decoding="async" className="h-full w-full" style={{ objectFit: item.imageMetadata?.objectFit ?? "cover" }} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 space-y-6">
        <BeforeAfterSection items={galleryItems as any[]} title={t("قبل / بعد من أعمالنا")} />
        <ModelViewerCard modelUrl={serviceModelUrl || null} title={t("معاينة الخدمة ثلاثية الأبعاد")} />
      </div>

      <Card className="bg-card border-border shadow-lg">
        <CardHeader className="border-b border-border/50 bg-muted/20">
          <CardTitle className="text-xl">{t("تفاصيل الطلب")}</CardTitle>
          <CardDescription>{t("رقم الهاتف ضروري للتواصل، وباقي التفاصيل يمكن إكمالها لاحقاً")}</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              <FormField
                control={form.control}
                name="customerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("الاسم الكامل")}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <UserIcon className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input placeholder={t("الاسم")} className="pr-10 bg-background" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("رقم الهاتف")}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <PhoneIcon className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="07XX XXX XXXX"
                          dir="ltr"
                          inputMode="numeric"
                          className="pr-10 text-right bg-background"
                          {...field}
                          onChange={(e) => field.onChange(formatIraqiPhoneInput(e.target.value))}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="eventDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("تاريخ الحجز")}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <CalendarIcon className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input type="date" className="pr-10 bg-background" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <ServiceDetailFields
                serviceType={serviceType}
                value={serviceDetails}
                onChange={(next) => {
                  setServiceDetails(next);
                  setDetailErrors({});
                }}
                crews={crews}
                errors={detailErrors}
                grid={false}
                density="form"
              />
              <LocationMapCard address={requestLocation || null} title={t("موقع المناسبة")} compact />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ملاحظات إضافية")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t("أي تفاصيل أخرى تود إضافتها للطلب...")}
                        className="min-h-[100px] bg-background" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button 
                type="submit" 
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90" 
                disabled={createOrder.isPending}
              >
                {createOrder.isPending ? t("جاري الإرسال...") : t("إرسال الطلب")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <div className="mt-6">
        <SmartSuggestions contextServiceType={serviceType} title={t("خدمات تكمل حجزك")} />
      </div>
    </div>
  );
}
