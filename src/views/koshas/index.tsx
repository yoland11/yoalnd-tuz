import { Link } from "wouter";
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCircle2, ChevronRight, CircleCheck, ClipboardList, DoorOpen, Flower2, Gem, Grid3X3, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/lib/i18n";
import { formatIraqiPhoneInput } from "@/lib/phone";
import { processImageFile } from "@/lib/image-tools";

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

export type KoshaOptionProduct = {
  id: number;
  name: string;
  price: number;
  description?: string | null;
  mainImage?: string | null;
  isActive?: boolean;
  sortOrder?: number;
};
type KoshaWizardOptions = {
  addons: KoshaOptionProduct[];
  welcomeBoards: KoshaOptionProduct[];
  accessories: KoshaOptionProduct[];
  provinces: { id: number; name: string }[];
};
type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;
type BookingForm = {
  brideName: string;
  groomName: string;
  eventDate: string;
  eventTime: string;
  eventType: string;
  serviceLevel: string;
  venueType: string;
  themeColor: string;
  province: string;
  area: string;
  mahalla: string;
  nearestPoint: string;
  addressNotes: string;
  bridePhone: string;
  groomPhone: string;
  alternatePhone: string;
  notes: string;
};

const WIZARD_STEPS = ["الكوشة", "الخدمات الإضافية", "بورد الترحيب", "الاكسسوارات", "البيانات", "التأكيد"] as const;
const WIZARD_STEP_ICONS = [Flower2, DoorOpen, Grid3X3, Gem, ClipboardList, CircleCheck] as const;
const EVENT_TYPES = ["زفاف", "خطوبة", "حنة", "سبوع", "توديع العزوبية"];
const SERVICE_LEVELS = ["عادي", "VIP"];
const VENUE_TYPES = ["داخلي", "خارجي"];
const THEME_COLORS = ["ذهبي", "فضي"];
const EMPTY_BOOKING_FORM: BookingForm = {
  brideName: "",
  groomName: "",
  eventDate: "",
  eventTime: "",
  eventType: "زفاف",
  serviceLevel: "عادي",
  venueType: "داخلي",
  themeColor: "ذهبي",
  province: "",
  area: "",
  mahalla: "",
  nearestPoint: "",
  addressNotes: "",
  bridePhone: "",
  groomPhone: "",
  alternatePhone: "",
  notes: "",
};

async function fetchKoshaOptions(): Promise<KoshaWizardOptions> {
  const res = await fetch("/api/koshas/options");
  if (!res.ok) throw new Error("تعذر تحميل خيارات الحجز");
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

function Stepper({ step }: { step: WizardStep }) {
  const progress = step / Math.max(WIZARD_STEPS.length - 1, 1);

  return (
    <div className="sticky top-20 z-20 -mx-1 mb-5 overflow-x-auto rounded-2xl border border-[#eadfd4] bg-[#fbf5ec] p-3 shadow-[0_8px_18px_rgba(85,65,58,0.08)]">
      <div className="relative flex min-w-[650px] items-start justify-between gap-3 px-3 pb-2 pt-3 sm:min-w-0">
        <span className="pointer-events-none absolute left-[54px] right-[54px] top-[39px] h-px rounded-full bg-[#d8cbc1]" />
        <span
          className="pointer-events-none absolute right-[54px] top-[39px] h-px rounded-full bg-[#8c6e6e] transition-[width] duration-500 ease-in-out"
          style={{ width: `calc((100% - 108px) * ${progress})` }}
        />
        {WIZARD_STEPS.map((label, index) => {
          const active = index === step;
          const done = index < step;
          const Icon = WIZARD_STEP_ICONS[index];
          return (
            <div
              key={label}
              className="relative z-10 flex min-w-20 flex-1 flex-col items-center text-center"
              aria-current={active ? "step" : undefined}
            >
              <span
                className={`relative grid h-14 w-14 place-items-center rounded-[18px] border transition-all duration-500 ease-in-out ${
                  active
                    ? "scale-[1.04] border-[#8c6e6e] bg-[#8c6e6e] text-white shadow-[0_0_0_5px_rgba(140,110,110,0.12),0_10px_18px_rgba(140,110,110,0.22)]"
                    : "border-[#efe6dc] bg-white text-[#a88f8f] shadow-[0_5px_12px_rgba(85,65,58,0.08)]"
                }`}
              >
                <Icon className="h-6 w-6 transition-transform duration-500 ease-in-out" strokeWidth={1.85} />
                {done ? (
                  <span className="absolute -left-1 -top-1 grid h-5 w-5 animate-kosha-check-pop place-items-center rounded-full bg-[#8c6e6e] text-white shadow-[0_3px_8px_rgba(140,110,110,0.22)]">
                    <Check className="h-3 w-3" strokeWidth={2.4} />
                  </span>
                ) : null}
              </span>
              <span className={`mt-2 max-w-24 text-[11px] font-semibold leading-5 transition-colors duration-300 ${active ? "text-[#8c6e6e]" : "text-[#8c8077]"}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SelectionMark({ selected }: { selected: boolean }) {
  if (!selected) return null;
  return (
    <span className="absolute right-3 top-3 grid h-7 w-7 animate-kosha-check-pop place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
      <Check className="h-4 w-4" />
    </span>
  );
}

function SelectablePill({ label, selected, onClick, tone = "default" }: { label: string; selected: boolean; onClick: () => void; tone?: "default" | "pink" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.98] ${
        selected
          ? "border-primary bg-primary/12 text-primary"
          : tone === "pink"
            ? "border-rose-200/60 bg-rose-100/70 text-rose-900 hover:border-primary/50 hover:bg-primary/10 hover:text-primary dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-100"
            : "border-border/40 bg-background text-foreground hover:border-primary/50 hover:text-primary"
      }`}
    >
      {selected && <CheckCircle2 className="h-4 w-4 animate-kosha-check-pop" />}
      {label}
    </button>
  );
}

function selectedOptionItems(options: KoshaOptionProduct[], selectedNames: string[]) {
  const selected = new Set(selectedNames);
  return options.filter((item) => selected.has(item.name));
}

function optionsTotal(items: KoshaOptionProduct[]) {
  return items.reduce((sum, item) => sum + (Number(item.price ?? 0) || 0), 0);
}

function KoshaOptionCard({ item, selected, onClick }: { item: KoshaOptionProduct; selected: boolean; onClick: () => void }) {
  const image = item.mainImage || "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl border bg-card text-right transition-all duration-300 active:scale-[0.99] ${
        selected ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.22)]" : "border-border/40 hover:border-primary/50"
      }`}
    >
      <SelectionMark selected={selected} />
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        {image ? (
          <img src={image} alt={item.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" decoding="async" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-background/70 px-3 text-center text-sm text-muted-foreground">بدون صورة</div>
        )}
      </div>
      <div className="space-y-2 p-4">
        <h3 className="font-bold text-foreground">{item.name}</h3>
        <p className="text-lg font-bold text-primary">{formatKoshaPrice(item.price)}</p>
        {shortText(item.description) ? <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{shortText(item.description)}</p> : null}
      </div>
    </button>
  );
}

function WizardInput({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | string[] | null }) {
  const text = Array.isArray(value) ? value.filter(Boolean).join("، ") : String(value ?? "").trim();
  if (!text) return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/20 py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[68%] text-left font-medium text-foreground">{text}</span>
    </div>
  );
}

export default function KoshasPage() {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["koshas"],
    queryFn: () => fetchKoshas(false),
    staleTime: 2 * 60_000,
  });
  const optionsQuery = useQuery({
    queryKey: ["koshas", "wizard-options"],
    queryFn: fetchKoshaOptions,
    staleTime: 5 * 60_000,
  });
  const t = useT();
  const { toast } = useToast();
  const [step, setStep] = useState<WizardStep>(0);
  const [selectedKosha, setSelectedKosha] = useState<Kosha | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [selectedBoards, setSelectedBoards] = useState<string[]>([]);
  const [selectedAccessories, setSelectedAccessories] = useState<string[]>([]);
  const [form, setForm] = useState<BookingForm>(EMPTY_BOOKING_FORM);
  const [venueImages, setVenueImages] = useState<string[]>(["", "", ""]);

  const options = optionsQuery.data ?? { addons: [], welcomeBoards: [], accessories: [], provinces: [] };
  const allAccessoryNames = options.accessories.map((item) => item.name);
  const selectedAddonItems = useMemo(() => selectedOptionItems(options.addons, selectedAddons), [options.addons, selectedAddons]);
  const selectedBoardItems = useMemo(() => selectedOptionItems(options.welcomeBoards, selectedBoards), [options.welcomeBoards, selectedBoards]);
  const selectedAccessoryItems = useMemo(() => selectedOptionItems(options.accessories, selectedAccessories), [options.accessories, selectedAccessories]);
  const koshaBasePrice = Number(selectedKosha?.price ?? 0) || 0;
  const selectedOptionsTotal = optionsTotal([...selectedAddonItems, ...selectedBoardItems, ...selectedAccessoryItems]);
  const bookingTotal = koshaBasePrice + selectedOptionsTotal;

  const booking = useMutation({
    mutationFn: async () => {
      if (!selectedKosha) throw new Error("اختر الكوشة أولاً");
      const res = await fetch(`/api/koshas/${selectedKosha.id}/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          customerName: [form.brideName, form.groomName].filter(Boolean).join(" و "),
          phone: form.bridePhone || form.groomPhone || form.alternatePhone,
          cityArea: [form.province, form.area].filter(Boolean).join(" - "),
          hallLocation: form.nearestPoint || form.area,
          selectedAddons,
          welcomeBoards: selectedBoards,
          selectedAccessories,
          venueImages: venueImages.filter(Boolean),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "تعذر إرسال الحجز");
      return payload;
    },
    onSuccess: () => {
      toast({ title: "تم إرسال الحجز", description: "وصل الطلب إلى لوحة الإدارة وسنتواصل معك قريباً." });
      setStep(0);
      setSelectedKosha(null);
      setSelectedAddons([]);
      setSelectedBoards([]);
      setSelectedAccessories([]);
      setForm(EMPTY_BOOKING_FORM);
      setVenueImages(["", "", ""]);
    },
    onError: (err: any) => toast({ title: "تعذر إرسال الحجز", description: err?.message, variant: "destructive" }),
  });

  function go(next: WizardStep) {
    setStep(next);
  }

  function toggleList(value: string, list: string[], setList: (next: string[]) => void) {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  async function updateVenueImage(index: number, file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "الملف غير مدعوم", description: "اختر صورة فقط.", variant: "destructive" });
      return;
    }
    const dataUrl = await processImageFile(file, { maxSize: 1400, quality: 0.78 });
    setVenueImages((current) => current.map((item, itemIndex) => (itemIndex === index ? dataUrl : item)));
  }

  return (
    <div className="container mx-auto px-4 py-10 md:py-12">
      <section id="koshas-list" className="scroll-mt-24">
        <Stepper step={step} />
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
          <div className="kosha-wizard-panel rounded-2xl border border-border/40 bg-card p-4 md:p-5">
            <div key={step} className="animate-kosha-step space-y-5">
              {step === 0 && (
                <>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">اختيار الكوشة</h2>
                    <p className="mt-1 text-sm text-muted-foreground">اختر الكوشة المناسبة، بعدها نكمل الحجز خطوة بخطوة.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {data.map((kosha) => {
                      const selected = selectedKosha?.id === kosha.id;
                      const image = kosha.mainImage || kosha.galleryImages?.[0]?.imageUrl || "/images/kosha.png";
                      return (
                        <button
                          key={kosha.id}
                          type="button"
                          onClick={() => {
                            setSelectedKosha(kosha);
                            window.setTimeout(() => setStep(1), 320);
                          }}
                          className={`group relative overflow-hidden rounded-xl border bg-card text-right transition-all duration-300 active:scale-[0.99] ${selected ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.22)]" : "border-border/40 hover:border-primary/50"}`}
                        >
                          <SelectionMark selected={selected} />
                          <div className="aspect-[4/3] overflow-hidden bg-muted">
                            <img src={image} alt={kosha.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                          </div>
                          <div className="space-y-2 p-4">
                            <div className="flex items-baseline gap-2">
                              <span className="text-lg font-bold text-primary">{formatKoshaPrice(kosha.price)}</span>
                              {kosha.oldPrice ? <span className="text-xs text-muted-foreground line-through">{formatKoshaPrice(kosha.oldPrice)}</span> : null}
                            </div>
                            <h3 className="font-bold text-foreground">{kosha.name}</h3>
                            {shortText(kosha.description) ? <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{shortText(kosha.description)}</p> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-2xl font-bold text-foreground">الخدمات الإضافية</h2>
                      <p className="mt-1 text-sm text-muted-foreground">اختيارية، اختر خدمة أو أكثر وسيتم احتساب السعر مباشرة.</p>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => { setSelectedAddons([]); go(2); }}>تخطّي هذه الخطوة</Button>
                      <Button type="button" onClick={() => go(2)}>التالي</Button>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {options.addons.map((item) => (
                      <KoshaOptionCard key={item.id} item={item} selected={selectedAddons.includes(item.name)} onClick={() => toggleList(item.name, selectedAddons, setSelectedAddons)} />
                    ))}
                    {options.addons.length === 0 && <p className="rounded-lg border border-border/30 bg-background/60 p-4 text-sm text-muted-foreground sm:col-span-2">لا توجد خدمات إضافية ظاهرة حالياً.</p>}
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-2xl font-bold text-foreground">بورد الترحيب</h2>
                      <p className="mt-1 text-sm text-muted-foreground">اختر بورد ترحيب واحد فقط، أو تخطى الخطوة.</p>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => { setSelectedBoards([]); go(3); }}>تخطّي هذه الخطوة</Button>
                      <Button type="button" onClick={() => go(3)}>التالي</Button>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {options.welcomeBoards.map((item) => (
                      <KoshaOptionCard
                        key={item.id}
                        item={item}
                        selected={selectedBoards.includes(item.name)}
                        onClick={() => setSelectedBoards(selectedBoards.includes(item.name) ? [] : [item.name])}
                      />
                    ))}
                    {options.welcomeBoards.length === 0 && <p className="rounded-lg border border-border/30 bg-background/60 p-4 text-sm text-muted-foreground sm:col-span-2">لا توجد بوردات ترحيب ظاهرة حالياً.</p>}
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">الاكسسوارات</h2>
                    <p className="mt-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">ملاحظة: سيتم طباعة الأحرف الأولى من اسم العروسين على الاكسسوارات المختارة.</p>
                  </div>
                  <div className="rounded-xl border border-border/30 bg-background/45 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-foreground">خيارات الاكسسوارات</h3>
                        <p className="mt-1 text-xs text-muted-foreground">كل اكسسوار يظهر كعنصر مستقل مع صورته وسعره.</p>
                      </div>
                      <SelectablePill
                        label="الكل"
                        tone="pink"
                        selected={allAccessoryNames.length > 0 && selectedAccessories.length === allAccessoryNames.length}
                        onClick={() => setSelectedAccessories(selectedAccessories.length === allAccessoryNames.length ? [] : allAccessoryNames)}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {options.accessories.map((item) => (
                        <KoshaOptionCard key={item.id} item={item} selected={selectedAccessories.includes(item.name)} onClick={() => toggleList(item.name, selectedAccessories, setSelectedAccessories)} />
                      ))}
                      {options.accessories.length === 0 && <p className="rounded-lg border border-border/30 bg-card p-4 text-sm text-muted-foreground sm:col-span-2">لا توجد اكسسوارات ظاهرة حالياً.</p>}
                    </div>
                  </div>
                  <div className="flex justify-between gap-2">
                    <Button type="button" variant="outline" onClick={() => go(2)}><ChevronRight className="ml-2 h-4 w-4" /> السابق</Button>
                    <Button type="button" onClick={() => go(4)}>التالي</Button>
                  </div>
                </>
              )}

              {step === 4 && (
                <>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">بيانات الحجز</h2>
                    <p className="mt-1 text-sm text-muted-foreground">املأ التفاصيل المتوفرة، ويمكن ترك أي حقل غير ضروري فارغاً.</p>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card className="border-border/40 bg-background/45">
                      <CardContent className="space-y-3 p-4">
                        <h3 className="font-bold text-foreground">معلومات العروسين</h3>
                        <WizardInput label="اسم العروس"><Input value={form.brideName} onChange={(e) => setForm((f) => ({ ...f, brideName: e.target.value }))} /></WizardInput>
                        <WizardInput label="اسم العريس"><Input value={form.groomName} onChange={(e) => setForm((f) => ({ ...f, groomName: e.target.value }))} /></WizardInput>
                      </CardContent>
                    </Card>
                    <Card className="border-border/40 bg-background/45">
                      <CardContent className="space-y-3 p-4">
                        <h3 className="font-bold text-foreground">تفاصيل الحفلة</h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <WizardInput label="تاريخ الحفل"><Input type="date" value={form.eventDate} onChange={(e) => setForm((f) => ({ ...f, eventDate: e.target.value }))} /></WizardInput>
                          <WizardInput label="وقت الحفل"><Input type="time" value={form.eventTime} onChange={(e) => setForm((f) => ({ ...f, eventTime: e.target.value }))} /></WizardInput>
                        </div>
                        <WizardInput label="نوع الحفل">
                          <select value={form.eventType} onChange={(e) => setForm((f) => ({ ...f, eventType: e.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                            {EVENT_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
                          </select>
                        </WizardInput>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <ButtonGroup label="مستوى الخدمة" options={SERVICE_LEVELS} value={form.serviceLevel} onChange={(value) => setForm((f) => ({ ...f, serviceLevel: value }))} />
                          <ButtonGroup label="نوع المكان" options={VENUE_TYPES} value={form.venueType} onChange={(value) => setForm((f) => ({ ...f, venueType: value }))} />
                          <ButtonGroup label="لون الثيم" options={THEME_COLORS} value={form.themeColor} onChange={(value) => setForm((f) => ({ ...f, themeColor: value }))} />
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="border-border/40 bg-background/45">
                      <CardContent className="space-y-3 p-4">
                        <h3 className="font-bold text-foreground">العنوان</h3>
                        <WizardInput label="المحافظة">
                          <select value={form.province} onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                            <option value="">اختر المحافظة</option>
                            {options.provinces.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                          </select>
                        </WizardInput>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <WizardInput label="المنطقة"><Input value={form.area} onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))} /></WizardInput>
                          <WizardInput label="المحلة"><Input value={form.mahalla} onChange={(e) => setForm((f) => ({ ...f, mahalla: e.target.value }))} /></WizardInput>
                        </div>
                        <WizardInput label="أقرب نقطة دالّة"><Input value={form.nearestPoint} onChange={(e) => setForm((f) => ({ ...f, nearestPoint: e.target.value }))} /></WizardInput>
                        <WizardInput label="ملاحظة العنوان"><Textarea rows={3} value={form.addressNotes} onChange={(e) => setForm((f) => ({ ...f, addressNotes: e.target.value }))} /></WizardInput>
                      </CardContent>
                    </Card>
                    <Card className="border-border/40 bg-background/45">
                      <CardContent className="space-y-3 p-4">
                        <h3 className="font-bold text-foreground">التواصل</h3>
                        <WizardInput label="رقم العروس"><Input dir="ltr" value={form.bridePhone} onChange={(e) => setForm((f) => ({ ...f, bridePhone: formatIraqiPhoneInput(e.target.value) }))} placeholder="077xxxxxxxx" /></WizardInput>
                        <WizardInput label="رقم العريس"><Input dir="ltr" value={form.groomPhone} onChange={(e) => setForm((f) => ({ ...f, groomPhone: formatIraqiPhoneInput(e.target.value) }))} placeholder="077xxxxxxxx" /></WizardInput>
                        <WizardInput label="رقم هاتف آخر"><Input dir="ltr" value={form.alternatePhone} onChange={(e) => setForm((f) => ({ ...f, alternatePhone: formatIraqiPhoneInput(e.target.value) }))} placeholder="077xxxxxxxx" /></WizardInput>
                      </CardContent>
                    </Card>
                  </div>
                  <Card className="border-border/40 bg-background/45">
                    <CardContent className="space-y-4 p-4">
                      <WizardInput label="ملاحظة إضافية"><Textarea rows={4} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></WizardInput>
                      <div>
                        <h3 className="mb-3 font-bold text-foreground">صور مكان المناسبة</h3>
                        <div className="grid gap-3 md:grid-cols-3">
                          {["الزاوية الأولى", "الزاوية الثانية", "الزاوية الثالثة"].map((label, index) => (
                            <label key={label} className="block cursor-pointer rounded-xl border border-dashed border-border/50 bg-card p-3 text-center transition-colors hover:border-primary/50">
                              <span className="mb-2 block text-sm font-medium text-foreground">{label}</span>
                              {venueImages[index] ? <img src={venueImages[index]} alt={label} className="h-32 w-full rounded-lg object-cover" /> : <span className="flex h-32 items-center justify-center rounded-lg bg-background text-muted-foreground"><ImagePlus className="h-6 w-6" /></span>}
                              <input type="file" accept="image/*" className="sr-only" onChange={(event) => void updateVenueImage(index, event.target.files?.[0] ?? null)} />
                            </label>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <div className="flex justify-between gap-2">
                    <Button type="button" variant="outline" onClick={() => go(3)}><ChevronRight className="ml-2 h-4 w-4" /> السابق</Button>
                    <Button type="button" onClick={() => go(5)}>مراجعة وتأكيد</Button>
                  </div>
                </>
              )}

              {step === 5 && (
                <>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">التأكيد</h2>
                    <p className="mt-1 text-sm text-muted-foreground">راجع تفاصيل الحجز قبل الإرسال إلى لوحة الإدارة.</p>
                  </div>
                  <Card className="border-border/40 bg-background/45">
                    <CardContent className="p-4 md:p-5">
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border/30 pb-4">
                        <div>
                          <p className="text-xs text-muted-foreground">فاتورة حجز كوشة</p>
                          <h3 className="text-xl font-bold text-foreground">{selectedKosha?.name ?? "لم يتم اختيار كوشة"}</h3>
                        </div>
                        <div className="text-left">
                          <p className="text-xs text-muted-foreground">السعر المبدئي</p>
                          <p className="text-xl font-bold text-primary">{formatKoshaPrice(koshaBasePrice)}</p>
                        </div>
                      </div>
                      <div className="grid gap-5 md:grid-cols-2">
                        <div>
                          <h4 className="mb-2 font-bold text-foreground">الاختيارات</h4>
                          <SummaryRow label="الخدمات الإضافية" value={selectedAddons} />
                          <SummaryRow label="بورد الترحيب" value={selectedBoards} />
                          <SummaryRow label="الاكسسوارات" value={selectedAccessories} />
                          <div className="mt-3 rounded-lg border border-border/30 bg-card p-3 text-sm">
                            <div className="flex items-center justify-between gap-3 py-1">
                              <span className="text-muted-foreground">سعر الكوشة</span>
                              <span className="font-bold text-foreground">{formatKoshaPrice(koshaBasePrice)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3 py-1">
                              <span className="text-muted-foreground">إضافات الحجز</span>
                              <span className="font-bold text-foreground">{formatKoshaPrice(selectedOptionsTotal)}</span>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/30 pt-3">
                              <span className="font-bold text-foreground">الإجمالي</span>
                              <span className="text-lg font-bold text-primary">{formatKoshaPrice(bookingTotal)}</span>
                            </div>
                          </div>
                        </div>
                        <div>
                          <h4 className="mb-2 font-bold text-foreground">البيانات</h4>
                          <SummaryRow label="العروسين" value={[form.brideName, form.groomName].filter(Boolean).join(" و ")} />
                          <SummaryRow label="موعد الحفل" value={[form.eventDate, form.eventTime].filter(Boolean).join(" - ")} />
                          <SummaryRow label="نوع الحفل" value={form.eventType} />
                          <SummaryRow label="مستوى الخدمة" value={form.serviceLevel} />
                          <SummaryRow label="المكان والثيم" value={[form.venueType, form.themeColor].filter(Boolean).join(" - ")} />
                          <SummaryRow label="العنوان" value={[form.province, form.area, form.mahalla, form.nearestPoint].filter(Boolean).join(" - ")} />
                          <SummaryRow label="التواصل" value={[form.bridePhone, form.groomPhone, form.alternatePhone].filter(Boolean).join(" / ")} />
                          <SummaryRow label="ملاحظات" value={form.notes} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <div className="flex justify-between gap-2">
                    <Button type="button" variant="outline" onClick={() => go(4)}><ChevronRight className="ml-2 h-4 w-4" /> السابق</Button>
                    <Button type="button" onClick={() => booking.mutate()} disabled={booking.isPending || !selectedKosha} className="gap-2">
                      {booking.isPending ? "جاري إرسال الحجز..." : "إرسال الحجز"}
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      <style>{`
        @keyframes kosha-step {
          from { opacity: 0; transform: translate3d(-18px, 0, 0) scale(0.992); filter: blur(2px); }
          to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0); }
        }
        @keyframes kosha-check-pop {
          0% { opacity: 0; transform: scale(0.72); }
          70% { opacity: 1; transform: scale(1.08); }
          100% { opacity: 1; transform: scale(1); }
        }
        .animate-kosha-step { animation: kosha-step 420ms cubic-bezier(0.4, 0, 0.2, 1) both; }
        .animate-kosha-check-pop { animation: kosha-check-pop 220ms cubic-bezier(0.16, 1, 0.3, 1) both; }
        @media (prefers-reduced-motion: reduce) {
          .animate-kosha-step,
          .animate-kosha-check-pop,
          .animate-fade-up {
            animation: none !important;
          }
          .kosha-wizard-panel * {
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
    </div>
  );
}

function ButtonGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        {options.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            className={`h-10 rounded-lg border px-3 text-sm transition-colors ${value === item ? "border-primary bg-primary/12 text-primary" : "border-border/40 bg-background text-foreground hover:border-primary/50"}`}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
