import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronRight, Clock, MapPin, Phone, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatIraqiPhoneInput } from "@/lib/phone";
import { formatKoshaPrice, type Kosha, type KoshaImage } from "./index";

type BookingForm = {
  customerName: string;
  phone: string;
  eventDate: string;
  eventTime: string;
  cityArea: string;
  hallLocation: string;
  notes: string;
};

async function fetchKosha(id: string): Promise<Kosha> {
  const res = await fetch(`/api/koshas/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("الكوشة غير موجودة");
  return res.json();
}

function Spec({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="rounded-lg bg-background/60 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold text-foreground">{value}</div>
    </div>
  );
}

function FormInput({
  label,
  icon,
  value,
  onChange,
  placeholder,
  type = "text",
  dir,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <div className="relative">
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</span>
        <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} dir={dir} className="bg-background pr-10" />
      </div>
    </div>
  );
}

export default function KoshaDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";
  const { toast } = useToast();
  const { data: kosha, isLoading, isError } = useQuery({
    queryKey: ["kosha", id],
    queryFn: () => fetchKosha(id),
    enabled: !!id,
    staleTime: 2 * 60_000,
  });
  const [selected, setSelected] = useState(0);
  const [lightbox, setLightbox] = useState<KoshaImage | null>(null);
  const [form, setForm] = useState<BookingForm>({
    customerName: "",
    phone: "",
    eventDate: "",
    eventTime: "",
    cityArea: "",
    hallLocation: "",
    notes: "",
  });

  const media = useMemo<KoshaImage[]>(() => {
    if (!kosha) return [];
    const list: KoshaImage[] = [];
    if (kosha.mainImage) list.push({ id: -kosha.id, imageUrl: kosha.mainImage, imageMetadata: {} });
    for (const image of kosha.galleryImages ?? []) {
      if (!list.some((item) => item.imageUrl === image.imageUrl)) list.push(image);
    }
    return list.length ? list : [{ id: 0, imageUrl: "/images/kosha.png", imageMetadata: {} }];
  }, [kosha]);

  const booking = useMutation({
    mutationFn: async () => {
      if (!kosha) throw new Error("الكوشة غير موجودة");
      const res = await fetch(`/api/koshas/${kosha.id}/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "تعذر إرسال الحجز");
      return payload;
    },
    onSuccess: () => {
      toast({ title: "تم إرسال طلب الحجز", description: "سنتواصل معك قريباً لتأكيد التفاصيل." });
      setForm({ customerName: "", phone: "", eventDate: "", eventTime: "", cityArea: "", hallLocation: "", notes: "" });
    },
    onError: (err: any) => toast({ title: "تعذر إرسال الحجز", description: err?.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-10">
        <Skeleton className="mb-5 h-6 w-32" />
        <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <Skeleton className="h-[430px] rounded-2xl" />
          <Skeleton className="h-[430px] rounded-2xl" />
        </div>
      </div>
    );
  }

  if (isError || !kosha) {
    return (
      <div className="container mx-auto px-4 py-16">
        <Card className="border-border bg-card">
          <CardContent className="p-8 text-center">
            <h1 className="text-2xl font-bold text-foreground">الكوشة غير موجودة</h1>
            <Link href="/koshas" className="mt-5 inline-flex"><Button>العودة للكوشات</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeImage = media[selected] ?? media[0];

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10 md:py-12">
      <Link href="/koshas" className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary">
        <ChevronRight className="h-4 w-4" />
        العودة للكوشات
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr] lg:items-start">
        <section className="space-y-3">
          <button type="button" onClick={() => setLightbox(activeImage)} className="block aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-card">
            <img
              src={activeImage.imageUrl}
              alt={kosha.name}
              width={900}
              height={680}
              className="h-full w-full"
              style={{ objectFit: activeImage.imageMetadata?.objectFit ?? "cover" }}
            />
          </button>
          {media.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {media.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => setSelected(index)}
                  className={`h-20 w-24 flex-shrink-0 overflow-hidden rounded-xl border bg-card transition-colors ${index === selected ? "border-primary" : "border-border/40 hover:border-primary/60"}`}
                >
                  <img src={image.imageUrl} alt="" width={120} height={96} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-5">
          <Card className="border-border bg-card">
            <CardContent className="p-6 md:p-7">
              <div className="mb-2 text-sm font-semibold text-primary">الكوشات</div>
              <h1 className="text-3xl font-bold leading-tight text-foreground">{kosha.name}</h1>
              <div className="mt-3 flex items-baseline gap-3">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">{formatKoshaPrice(kosha.price)}</span>
              </div>
              {kosha.description ? <p className="mt-4 text-sm leading-7 text-muted-foreground">{kosha.description}</p> : null}
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Spec label="عدد القطع" value={kosha.numberOfPieces} />
                <Spec label="اللون الرئيسي" value={kosha.mainColor} />
                <Spec label="لون الورد" value={kosha.flowerColor} />
                <Spec label="مساحة الكوشة" value={kosha.koshaSpace} />
                <Spec label="مساحة السايد كونسول" value={kosha.sideConsoleSpace} />
                <Spec label="الحالة" value={kosha.availabilityStatus === "available" ? "متاحة" : kosha.availabilityStatus} />
              </div>
              {kosha.accessories && kosha.accessories.length > 0 && (
                <div className="mt-5 rounded-xl border border-border/40 bg-background/45 p-4">
                  <h2 className="mb-3 font-bold text-foreground">الملحقات المشمولة</h2>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {kosha.accessories.map((item) => (
                      <li key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> {item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {kosha.notes ? <p className="mt-4 rounded-xl border border-border/40 bg-background/45 p-4 text-sm text-muted-foreground">{kosha.notes}</p> : null}
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="border-b border-border/40 bg-muted/20">
              <CardTitle className="text-xl">طلب حجز الكوشة</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  booking.mutate();
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormInput label="اسم الزبون" icon={<User className="h-4 w-4" />} value={form.customerName} onChange={(value) => setForm((f) => ({ ...f, customerName: value }))} placeholder="الاسم" />
                  <FormInput label="رقم الهاتف" icon={<Phone className="h-4 w-4" />} value={form.phone} onChange={(value) => setForm((f) => ({ ...f, phone: formatIraqiPhoneInput(value) }))} placeholder="07XX XXX XXXX" dir="ltr" />
                  <FormInput label="تاريخ المناسبة" icon={<CalendarDays className="h-4 w-4" />} value={form.eventDate} onChange={(value) => setForm((f) => ({ ...f, eventDate: value }))} type="date" />
                  <FormInput label="وقت المناسبة" icon={<Clock className="h-4 w-4" />} value={form.eventTime} onChange={(value) => setForm((f) => ({ ...f, eventTime: value }))} type="time" />
                  <FormInput label="المدينة / المنطقة" icon={<MapPin className="h-4 w-4" />} value={form.cityArea} onChange={(value) => setForm((f) => ({ ...f, cityArea: value }))} />
                  <FormInput label="القاعة / الموقع" icon={<MapPin className="h-4 w-4" />} value={form.hallLocation} onChange={(value) => setForm((f) => ({ ...f, hallLocation: value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">ملاحظات</label>
                  <Textarea value={form.notes} onChange={(event) => setForm((f) => ({ ...f, notes: event.target.value }))} className="bg-background" rows={4} />
                </div>
                <Button type="submit" disabled={booking.isPending} className="w-full gap-2">
                  {booking.isPending ? "جاري الإرسال..." : "إرسال طلب الحجز"}
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setLightbox(null)}>
          <button type="button" className="absolute right-4 top-4 text-white" onClick={() => setLightbox(null)} aria-label="إغلاق">
            <X className="h-6 w-6" />
          </button>
          <img src={lightbox.imageUrl} alt={kosha.name} className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}
