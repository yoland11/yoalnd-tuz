import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useGetService, useCreateServiceOrder } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, MapPinIcon, PhoneIcon, UserIcon } from "lucide-react";

const formSchema = z.object({
  customerName: z.string().min(2, "الاسم يجب أن يكون حرفين على الأقل"),
  phone: z.string().min(10, "رقم الهاتف غير صالح"),
  eventDate: z.string().min(1, "تاريخ المناسبة مطلوب"),
  eventLocation: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function ServiceRequest() {
  const params = useParams();
  const id = parseInt(params.id || "1", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: service, isLoading } = useGetService(id, {
    query: { enabled: !!id, queryKey: ['/api/services', id] }
  });

  const createOrder = useCreateServiceOrder();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerName: "",
      phone: "",
      eventDate: "",
      eventLocation: "",
      notes: "",
    },
  });

  function onSubmit(data: FormValues) {
    createOrder.mutate({
      data: {
        serviceId: id,
        ...data
      }
    }, {
      onSuccess: (order) => {
        toast({
          title: "تم استلام طلبك",
          description: "سنتواصل معك قريباً لتأكيد التفاصيل.",
        });
        setLocation(order.trackingCode ? `/track?code=${order.trackingCode}` : "/track");
      },
      onError: () => {
        toast({
          title: "حدث خطأ",
          description: "يرجى المحاولة مرة أخرى لاحقاً.",
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
          طلب خدمة: {service?.nameAr || "خدمة مخصصة"}
        </h1>
        <p className="text-muted-foreground">
          {service?.descriptionAr || "الرجاء ملء النموذج أدناه لطلب الخدمة وسنقوم بالتواصل معك."}
        </p>
      </div>

      <Card className="bg-card border-border shadow-lg">
        <CardHeader className="border-b border-border/50 bg-muted/20">
          <CardTitle className="text-xl">تفاصيل الطلب</CardTitle>
          <CardDescription>جميع الحقول المميزة بنجمة (*) مطلوبة</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              <FormField
                control={form.control}
                name="customerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>الاسم الكامل *</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <UserIcon className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="الاسم" className="pr-10 bg-background" {...field} />
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
                    <FormLabel>رقم الهاتف *</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <PhoneIcon className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="07XX XXX XXXX" dir="ltr" className="pr-10 text-right bg-background" {...field} />
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
                    <FormLabel>تاريخ المناسبة *</FormLabel>
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

              <FormField
                control={form.control}
                name="eventLocation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>موقع المناسبة</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <MapPinIcon className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="العنوان التفصيلي (اختياري)" className="pr-10 bg-background" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ملاحظات إضافية</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="أي تفاصيل أخرى تود إضافتها للطلب..." 
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
                {createOrder.isPending ? "جاري الإرسال..." : "إرسال الطلب"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
