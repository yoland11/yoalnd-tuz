import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Box,
  Camera,
  Check,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  FileImage,
  GraduationCap,
  Layers3,
  Loader2,
  PackageCheck,
  Palette,
  QrCode,
  Ruler,
  ScanLine,
  Scissors,
  Shirt,
  Sparkles,
  Upload,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { processImageFile } from "@/lib/image-tools";
import { formatCurrency } from "@/lib/money";
import { formatIraqiPhoneInput } from "@/lib/phone";
import {
  GRADUATION_STAGE_LABELS,
  graduationPriceSummary,
  recommendedGraduationSize,
  type GraduationConfig,
  type GraduationOption,
} from "@/lib/graduation";
import { ModelViewerCard } from "@/components/interactive/model-viewer";

type PublicGraduationConfig = GraduationConfig & { aiAvailable: boolean };

const STEPS = [
  { label: "النوع", icon: GraduationCap },
  { label: "القياسات", icon: Ruler },
  { label: "الألوان", icon: Palette },
  { label: "القماش", icon: Layers3 },
  { label: "الطباعة / التطريز", icon: Scissors },
  { label: "النصوص", icon: FileImage },
  { label: "الإكسسوارات", icon: PackageCheck },
  { label: "المعاينة", icon: ScanLine },
  { label: "ملخص السعر", icon: CircleDollarSign },
  { label: "التأكيد", icon: ClipboardCheck },
] as const;

const GRADUATION_THEME_STYLE = {
  "--primary": "43 59% 59%",
  "--primary-foreground": "240 24% 6%",
  "--ring": "43 59% 59%",
} as CSSProperties;

const MEASUREMENTS = [
  ["height", "الطول (سم)"],
  ["weight", "الوزن (كغم)"],
  ["shoulder", "عرض الكتف (سم)"],
  ["chest", "محيط الصدر (سم)"],
  ["waist", "محيط الخصر (سم)"],
  ["hip", "محيط الورك (سم)"],
  ["sleeveLength", "طول الكم (سم)"],
  ["neck", "محيط الرقبة (سم)"],
] as const;

const DECORATION_POSITIONS = [
  ["front", "الواجهة الأمامية"],
  ["back", "الخلف"],
  ["sleeve", "الكم"],
  ["sash", "الوشاح"],
] as const;

function colorContrast(left: string, right: string) {
  const luminance = (hex: string) => {
    const value = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
    const channels = [0, 2, 4]
      .map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255)
      .map((channel) =>
        channel <= 0.03928
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const initialForm = {
  customerName: "",
  phone: "",
  styleKey: "",
  packageKey: "",
  groupToken: "",
  status: "submitted" as const,
  measurements: {
    height: "",
    weight: "",
    shoulder: "",
    chest: "",
    waist: "",
    hip: "",
    sleeveLength: "",
    neck: "",
    gender: "male",
    suggestedSize: "",
  },
  colors: {
    robe: "#111111",
    sash: "#D4B15A",
    cap: "#111111",
    tassel: "#D4B15A",
    embroidery: "#D4B15A",
  },
  fabric: { key: "" },
  decoration: { type: "none", position: "front", file: "", fileName: "" },
  customText: {
    studentName: "",
    university: "",
    college: "",
    department: "",
    graduationYear: String(new Date().getFullYear()),
    text: "",
    font: "cairo",
    size: 28,
    color: "#D4B15A",
    alignment: "center",
  },
  accessories: [] as string[],
  universityTemplate: {} as Record<string, unknown>,
  previewAssets: {} as Record<string, unknown>,
  discountAmount: 0,
  dueDate: "",
  notes: "",
};

async function graduationFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/graduation${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "تعذر إكمال العملية");
  return payload;
}

function OptionCard({
  item,
  selected,
  onClick,
  compact = false,
}: {
  item: GraduationOption;
  selected: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative min-w-0 overflow-hidden rounded-xl border text-right transition-all duration-200 ${selected ? "border-primary bg-primary/10 shadow-[0_0_22px_hsl(var(--primary)/.12)]" : "border-border bg-card hover:border-primary/50"}`}
    >
      {item.imageUrl ? (
        <div
          className={`${compact ? "aspect-[16/9]" : "aspect-[4/5]"} overflow-hidden bg-muted`}
        >
          <img
            src={item.imageUrl}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
          />
        </div>
      ) : (
        <div
          className={`${compact ? "h-20" : "h-28"} flex items-center justify-center bg-muted/60`}
        >
          <GraduationCap className="h-10 w-10 text-primary/70" />
        </div>
      )}
      <div className="space-y-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <strong className="truncate text-sm text-foreground">
            {item.name}
          </strong>
          {selected ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
          ) : null}
        </div>
        {item.description ? (
          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
            {item.description}
          </p>
        ) : null}
        {item.price > 0 ? (
          <p className="text-sm font-bold text-primary">
            {formatCurrency(item.price)}
          </p>
        ) : null}
      </div>
    </button>
  );
}

function StepRail({ current }: { current: number }) {
  return (
    <div className="overflow-x-auto border-b border-border bg-card/95 px-3 py-3 backdrop-blur md:sticky md:top-0 md:z-30">
      <div
        className="mx-auto flex min-w-[840px] max-w-7xl items-start justify-between"
        dir="rtl"
      >
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          const active = index === current;
          const done = index < current;
          return (
            <div
              key={step.label}
              className="relative flex w-[9.5%] flex-col items-center gap-1.5 text-center"
            >
              {index < STEPS.length - 1 ? (
                <span
                  className={`absolute right-[58%] top-4 h-px w-[90%] transition-colors ${done ? "bg-primary" : "bg-border"}`}
                />
              ) : null}
              <motion.span
                animate={{ scale: active ? 1.08 : 1 }}
                className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full border text-xs font-bold transition-colors ${active ? "border-primary bg-primary text-primary-foreground shadow-[0_0_18px_hsl(var(--primary)/.22)]" : done ? "border-primary bg-background text-primary" : "border-border bg-card text-muted-foreground"}`}
              >
                {done ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </motion.span>
              <span
                className={`whitespace-nowrap text-[11px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewPanel({
  config,
  form,
}: {
  config: PublicGraduationConfig;
  form: typeof initialForm;
}) {
  const style = config.styles.find((item) => item.key === form.styleKey);
  const image = String(form.previewAssets.tryOnUrl || style?.imageUrl || "");
  const robe = form.colors.robe;
  const sash = form.colors.sash;
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-bold text-foreground">معاينة التصميم</h2>
        <span className="text-xs text-muted-foreground">
          {style?.name || "اختر النوع"}
        </span>
      </div>
      <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden bg-muted/50">
        {image ? (
          <img
            src={image}
            alt="معاينة تصميم التخرج"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <Shirt className="h-28 w-28" style={{ color: robe }} />
            <p className="max-w-[220px] text-sm text-muted-foreground">
              تظهر صورة التصميم هنا بعد اختيار نوع مرفوع من الإدارة
            </p>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-px bg-border text-xs">
        <div className="bg-card p-3">
          <span className="text-muted-foreground">الاسم</span>
          <p className="mt-1 truncate font-semibold">
            {form.customText.studentName || "لم يُدخل بعد"}
          </p>
        </div>
        <div className="bg-card p-3">
          <span className="text-muted-foreground">الجامعة</span>
          <p className="mt-1 truncate font-semibold">
            {form.customText.university || "لم تُحدد"}
          </p>
        </div>
      </div>
    </section>
  );
}

export default function GraduationConfigurator() {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [completed, setCompleted] = useState<any>(null);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);
  const [tryOnOpen, setTryOnOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiConcepts, setAiConcepts] = useState<any[]>([]);
  const [scanImage, setScanImage] = useState("");
  const [tryOnImage, setTryOnImage] = useState("");

  const { data: config, isLoading } = useQuery({
    queryKey: ["graduation", "config"],
    queryFn: () => graduationFetch<PublicGraduationConfig>("/config"),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!config) return;
    setForm((current) => ({
      ...current,
      styleKey: current.styleKey || config.styles[0]?.key || "",
      fabric: { key: current.fabric.key || config.fabrics[0]?.key || "" },
    }));
    const token =
      new URLSearchParams(window.location.search).get("group") || "";
    if (!token) return;
    graduationFetch<{ group: any }>(`/groups/${encodeURIComponent(token)}`)
      .then(({ group }) => {
        setForm((current) => ({
          ...current,
          groupToken: token,
          customText: {
            ...current.customText,
            university: group.university || "",
            college: group.college || "",
            department: group.department || "",
            graduationYear:
              group.graduationYear || current.customText.graduationYear,
          },
          ...(group.defaultConfiguration || {}),
        }));
        toast({ title: "تم ربط الطلب بالمجموعة", description: group.title });
      })
      .catch((error) =>
        toast({
          title: "تعذر فتح الطلب الجماعي",
          description: error.message,
          variant: "destructive",
        }),
      );
  }, [config, toast]);

  const pricing = useMemo(
    () =>
      config
        ? graduationPriceSummary(form as any, config)
        : { lines: [], subtotal: 0, discount: 0, total: 0, cost: 0, profit: 0 },
    [config, form],
  );
  const selectedStyle = config?.styles.find(
    (item) => item.key === form.styleKey,
  );
  const harmony = colorContrast(form.colors.robe, form.colors.sash);

  const submit = useMutation({
    mutationFn: () =>
      graduationFetch<{ order: any }>("/orders", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          measurements: Object.fromEntries(
            Object.entries(form.measurements).map(([key, value]) => [
              key,
              key === "gender" || key === "suggestedSize"
                ? value
                : Number(value),
            ]),
          ),
        }),
      }),
    onSuccess: ({ order }) => {
      setCompleted(order);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (error: Error) =>
      toast({
        title: "تعذر إرسال الطلب",
        description: error.message,
        variant: "destructive",
      }),
  });
  const scan = useMutation({
    mutationFn: () =>
      graduationFetch<any>("/ai/size", {
        method: "POST",
        body: JSON.stringify({
          image: scanImage,
          height: form.measurements.height,
        }),
      }),
    onSuccess: (result) => {
      setForm((current) => ({
        ...current,
        measurements: {
          ...current.measurements,
          ...Object.fromEntries(
            ["height", "shoulder", "sleeveLength"]
              .filter((key) => result[key])
              .map((key) => [key, String(result[key])]),
          ),
          suggestedSize:
            result.suggestedSize || current.measurements.suggestedSize,
        },
      }));
      setSizeOpen(false);
      toast({
        title: "تم تقدير القياسات",
        description:
          result.confidence < 0.7
            ? "الثقة منخفضة؛ راجع القياسات يدوياً"
            : result.suggestedSize,
      });
    },
    onError: (error: Error) =>
      toast({
        title: "تعذر فحص القياسات",
        description: error.message,
        variant: "destructive",
      }),
  });
  const designer = useMutation({
    mutationFn: () =>
      graduationFetch<any>("/ai/designer", {
        method: "POST",
        body: JSON.stringify({ prompt: aiPrompt }),
      }),
    onSuccess: (result) =>
      setAiConcepts(Array.isArray(result.concepts) ? result.concepts : []),
    onError: (error: Error) =>
      toast({
        title: "تعذر إنشاء المقترحات",
        description: error.message,
        variant: "destructive",
      }),
  });
  const tryOn = useMutation({
    mutationFn: () =>
      graduationFetch<any>("/ai/try-on", {
        method: "POST",
        body: JSON.stringify({
          image: tryOnImage,
          styleName: selectedStyle?.name,
          colors: form.colors,
        }),
      }),
    onSuccess: (result) => {
      setForm((current) => ({
        ...current,
        previewAssets: { ...current.previewAssets, tryOnUrl: result.imageUrl },
      }));
      setTryOnOpen(false);
      toast({ title: "المعاينة الافتراضية جاهزة" });
    },
    onError: (error: Error) =>
      toast({
        title: "تعذر إنشاء المعاينة",
        description: error.message,
        variant: "destructive",
      }),
  });

  function validateStep() {
    if (step === 0 && !form.styleKey) return "اختر نوع تجهيز التخرج";
    if (step === 1) {
      const missing = [
        "height",
        "shoulder",
        "chest",
        "waist",
        "sleeveLength",
      ].find((key) => !Number((form.measurements as any)[key]));
      if (missing) return "أكمل القياسات الأساسية";
    }
    if (step === 3 && !form.fabric.key) return "اختر نوع القماش";
    if (
      step === 9 &&
      (!form.customerName.trim() || form.phone.replace(/\D/g, "").length < 10)
    )
      return "أدخل اسم الزبون ورقم هاتف صحيح";
    return "";
  }
  function next() {
    const issue = validateStep();
    if (issue) {
      toast({
        title: "أكمل هذه الخطوة",
        description: issue,
        variant: "destructive",
      });
      return;
    }
    setStep((value) => Math.min(9, value + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function previous() {
    setStep((value) => Math.max(0, value - 1));
  }
  function choosePackage(key: string) {
    const pack = config?.packages.find((item) => item.key === key);
    setForm((current) => ({
      ...current,
      packageKey: key,
      styleKey: pack?.styleKey || current.styleKey,
      accessories: [
        ...new Set([...(pack?.accessories || []), ...current.accessories]),
      ],
    }));
  }
  async function fileData(
    file: File,
    target: "decoration" | "scan" | "try-on",
  ) {
    const data = await processImageFile(file, { maxSize: 1800, quality: 0.86 });
    if (target === "scan") setScanImage(data);
    else if (target === "try-on") setTryOnImage(data);
    else
      setForm((current) => ({
        ...current,
        decoration: { ...current.decoration, file: data, fileName: file.name },
      }));
  }

  if (isLoading || !config)
    return (
      <div className="container mx-auto space-y-5 px-4 py-10">
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <Skeleton className="h-[620px]" />
          <Skeleton className="h-[620px]" />
        </div>
      </div>
    );
  if (completed)
    return (
      <div
        className="container mx-auto max-w-2xl px-4 py-16"
        dir="rtl"
        style={GRADUATION_THEME_STYLE}
      >
        <Card>
          <CardContent className="space-y-6 p-8 text-center">
            <BadgeCheck className="mx-auto h-16 w-16 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">تم إرسال طلب التخرج</h1>
              <p className="mt-2 text-muted-foreground">
                احتفظ برقم الطلب ورمز الاستلام
              </p>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
              <p className="text-sm text-muted-foreground">رقم الطلب</p>
              <p className="mt-1 text-2xl font-bold text-primary">
                {completed.orderNo}
              </p>
            </div>
            {completed.qrDataUrl ? (
              <img
                src={completed.qrDataUrl}
                alt="رمز استلام طلب التخرج"
                className="mx-auto h-52 w-52 rounded-lg bg-white p-2"
              />
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                className="flex-1"
                onClick={() => window.location.assign(completed.trackingUrl)}
              >
                تتبع الإنتاج
              </Button>
              <Button
                className="flex-1"
                variant="outline"
                onClick={() => {
                  setCompleted(null);
                  setForm(initialForm);
                  setStep(0);
                }}
              >
                طلب جديد
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );

  return (
    <div
      className="min-h-screen bg-background pb-24"
      dir="rtl"
      style={GRADUATION_THEME_STYLE}
    >
      <StepRail current={step} />
      <div className="container mx-auto max-w-[1500px] px-3 py-5 sm:px-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-primary">تجهيزات التخرج</p>
            <h1 className="mt-1 text-2xl font-bold text-foreground">
              {STEPS[step].label}
            </h1>
          </div>
          {config.aiAvailable ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSizeOpen(true)}
              >
                <ScanLine className="ml-2 h-4 w-4" />
                مسح القياسات
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDesignerOpen(true)}
              >
                <WandSparkles className="ml-2 h-4 w-4" />
                مصمم ذكي
              </Button>
            </div>
          ) : null}
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -18 }}
                transition={{ duration: 0.28, ease: "easeInOut" }}
                className="min-h-[520px]"
              >
                {step === 0 ? (
                  <div className="space-y-7">
                    <div>
                      <h2 className="mb-3 font-bold">اختر نوع التخرج</h2>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {config.styles.map((item) => (
                          <OptionCard
                            key={item.key}
                            item={item}
                            selected={form.styleKey === item.key}
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                styleKey: item.key,
                              }))
                            }
                          />
                        ))}
                      </div>
                    </div>
                    {config.packages.length ? (
                      <div>
                        <h2 className="mb-3 font-bold">الباقات الجاهزة</h2>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          {config.packages.map((item) => (
                            <OptionCard
                              key={item.key}
                              item={item}
                              selected={form.packageKey === item.key}
                              onClick={() => choosePackage(item.key)}
                              compact
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {step === 1 ? (
                  <div className="space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="font-bold">قياسات الروب</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          أدخل القياسات بالسنتيمتر للحصول على مقاس دقيق.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => setSizeOpen(true)}
                        disabled={!config.aiAvailable}
                      >
                        <Camera className="ml-2 h-4 w-4" />
                        تقدير من صورة
                      </Button>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {MEASUREMENTS.map(([key, label]) => (
                        <div key={key}>
                          <Label htmlFor={key}>{label}</Label>
                          <Input
                            id={key}
                            inputMode="decimal"
                            value={(form.measurements as any)[key]}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                measurements: {
                                  ...current.measurements,
                                  [key]: event.target.value,
                                },
                              }))
                            }
                            className="mt-2"
                          />
                        </div>
                      ))}
                    </div>
                    <div>
                      <Label>الجنس</Label>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {[
                          ["male", "ذكر"],
                          ["female", "أنثى"],
                        ].map(([key, label]) => (
                          <Button
                            key={key}
                            type="button"
                            variant={
                              form.measurements.gender === key
                                ? "default"
                                : "outline"
                            }
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                measurements: {
                                  ...current.measurements,
                                  gender: key,
                                },
                              }))
                            }
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    {form.measurements.chest && form.measurements.height ? (
                      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                        <span className="text-sm text-muted-foreground">
                          المقاس المقترح
                        </span>
                        <strong className="mr-3 text-primary">
                          {form.measurements.suggestedSize ||
                            recommendedGraduationSize({
                              chest: Number(form.measurements.chest),
                              height: Number(form.measurements.height),
                            })}
                        </strong>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {step === 2 ? (
                  <div className="space-y-6">
                    <p className="text-sm text-muted-foreground">
                      اختر لون كل جزء. يمكن تطبيق قالب الجامعة أولاً ثم تعديل أي
                      لون.
                    </p>
                    {config.universities.length ? (
                      <div>
                        <Label>قالب الجامعة</Label>
                        <Select
                          onValueChange={(key) => {
                            const template = config.universities.find(
                              (item) => item.key === key,
                            );
                            if (template)
                              setForm((current) => ({
                                ...current,
                                styleKey: template.styleKey || current.styleKey,
                                universityTemplate: template as any,
                                colors: {
                                  ...current.colors,
                                  robe:
                                    template.robeColor || current.colors.robe,
                                  sash:
                                    template.sashColor || current.colors.sash,
                                  cap: template.capColor || current.colors.cap,
                                  tassel:
                                    template.tasselColor ||
                                    current.colors.tassel,
                                  embroidery:
                                    template.embroideryColor ||
                                    current.colors.embroidery,
                                },
                                customText: {
                                  ...current.customText,
                                  university: template.university,
                                  college: template.college || "",
                                  department: template.department || "",
                                },
                              }));
                          }}
                        >
                          <SelectTrigger className="mt-2">
                            <SelectValue placeholder="اختر الجامعة / الكلية" />
                          </SelectTrigger>
                          <SelectContent>
                            {config.universities.map((item) => (
                              <SelectItem key={item.key} value={item.key}>
                                {[
                                  item.university,
                                  item.college,
                                  item.department,
                                ]
                                  .filter(Boolean)
                                  .join(" - ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                    <div className="space-y-5">
                      {[
                        ["robe", "لون الروب"],
                        ["sash", "لون الوشاح"],
                        ["cap", "لون القبعة"],
                        ["tassel", "لون الشرابة"],
                        ["embroidery", "لون التطريز"],
                      ].map(([key, label]) => (
                        <div key={key}>
                          <div className="mb-2 flex items-center justify-between">
                            <Label>{label}</Label>
                            <span className="font-mono text-xs text-muted-foreground">
                              {(form.colors as any)[key]}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {config.colors.map((color) => (
                              <button
                                key={color.key}
                                type="button"
                                title={color.name}
                                aria-label={`${label}: ${color.name}`}
                                onClick={() =>
                                  setForm((current) => ({
                                    ...current,
                                    colors: {
                                      ...current.colors,
                                      [key]: color.hex,
                                    },
                                  }))
                                }
                                className={`h-10 w-10 rounded-full border-2 transition-transform hover:scale-105 ${(form.colors as any)[key] === color.hex ? "border-primary ring-2 ring-primary/20" : "border-border"}`}
                                style={{ backgroundColor: color.hex }}
                              />
                            ))}
                            <label className="relative h-10 w-10 overflow-hidden rounded-full border-2 border-border">
                              <input
                                type="color"
                                value={(form.colors as any)[key]}
                                onChange={(event) =>
                                  setForm((current) => ({
                                    ...current,
                                    colors: {
                                      ...current.colors,
                                      [key]: event.target.value,
                                    },
                                  }))
                                }
                                className="absolute -inset-2 h-14 w-14 cursor-pointer"
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {step === 3 ? (
                  <div>
                    <h2 className="mb-4 font-bold">اختر نوع القماش</h2>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                      {config.fabrics.map((item) => (
                        <OptionCard
                          key={item.key}
                          item={item}
                          selected={form.fabric.key === item.key}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              fabric: { key: item.key },
                            }))
                          }
                          compact
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {step === 4 ? (
                  <div className="space-y-6">
                    <div>
                      <Label>طريقة التنفيذ</Label>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {[
                          ["none", "بدون"],
                          ["printing", "طباعة"],
                          ["embroidery", "تطريز"],
                        ].map(([key, label]) => (
                          <Button
                            key={key}
                            variant={
                              form.decoration.type === key
                                ? "default"
                                : "outline"
                            }
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                decoration: {
                                  ...current.decoration,
                                  type: key,
                                },
                              }))
                            }
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    {form.decoration.type !== "none" ? (
                      <>
                        <div>
                          <Label>الموقع</Label>
                          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {DECORATION_POSITIONS.map(([key, label]) => (
                              <Button
                                key={key}
                                variant={
                                  form.decoration.position === key
                                    ? "default"
                                    : "outline"
                                }
                                onClick={() =>
                                  setForm((current) => ({
                                    ...current,
                                    decoration: {
                                      ...current.decoration,
                                      position: key,
                                    },
                                  }))
                                }
                              >
                                {label}
                              </Button>
                            ))}
                          </div>
                        </div>
                        <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-primary/50 bg-primary/5 p-5 text-center">
                          <Upload className="h-8 w-8 text-primary" />
                          <strong className="mt-3">
                            ارفع الشعار أو التصميم
                          </strong>
                          <span className="mt-1 text-xs text-muted-foreground">
                            PNG أو JPG أو SVG
                          </span>
                          {form.decoration.fileName ? (
                            <span className="mt-3 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground">
                              {form.decoration.fileName}
                            </span>
                          ) : null}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            className="sr-only"
                            onChange={(event) =>
                              event.target.files?.[0] &&
                              fileData(event.target.files[0], "decoration")
                            }
                          />
                        </label>
                      </>
                    ) : null}
                  </div>
                ) : null}

                {step === 5 ? (
                  <div className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      {[
                        ["studentName", "اسم الطالب"],
                        ["university", "الجامعة"],
                        ["college", "الكلية"],
                        ["department", "القسم"],
                        ["graduationYear", "سنة التخرج"],
                      ].map(([key, label]) => (
                        <div key={key}>
                          <Label>{label}</Label>
                          <Input
                            className="mt-2"
                            value={(form.customText as any)[key]}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                customText: {
                                  ...current.customText,
                                  [key]: event.target.value,
                                },
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                    <div>
                      <Label>نص مخصص</Label>
                      <Textarea
                        className="mt-2"
                        value={form.customText.text}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            customText: {
                              ...current.customText,
                              text: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <Label>الخط</Label>
                        <Select
                          value={form.customText.font}
                          onValueChange={(value) =>
                            setForm((current) => ({
                              ...current,
                              customText: {
                                ...current.customText,
                                font: value,
                              },
                            }))
                          }
                        >
                          <SelectTrigger className="mt-2">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {config.fonts.map((font) => (
                              <SelectItem key={font.key} value={font.key}>
                                {font.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>الحجم: {form.customText.size}px</Label>
                        <Slider
                          className="mt-5"
                          min={12}
                          max={72}
                          step={1}
                          value={[form.customText.size]}
                          onValueChange={([value]) =>
                            setForm((current) => ({
                              ...current,
                              customText: {
                                ...current.customText,
                                size: value || 28,
                              },
                            }))
                          }
                        />
                      </div>
                      <div>
                        <Label>لون النص</Label>
                        <Input
                          type="color"
                          className="mt-2 h-10 p-1"
                          value={form.customText.color}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              customText: {
                                ...current.customText,
                                color: event.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                      <div
                        className={`rounded-lg border p-4 text-sm ${harmony >= 2.2 ? "border-status-success/30 bg-status-success/5" : "border-status-warning/30 bg-status-warning/5"}`}
                      >
                        <div className="flex items-center gap-2 font-semibold">
                          <Sparkles
                            className={`h-4 w-4 ${harmony >= 2.2 ? "text-status-success" : "text-status-warning"}`}
                          />
                          تحليل تناغم الألوان
                        </div>
                        <p className="mt-2 text-muted-foreground">
                          {harmony >= 2.2
                            ? "ألوان الروب والوشاح متباينة بوضوح ومناسبة للتصوير."
                            : "التباين بين الروب والوشاح منخفض؛ جرّب لوناً أفتح أو أغمق لإظهار التفاصيل."}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {step === 6 ? (
                  <div className="space-y-6">
                    <div>
                      <h2 className="font-bold">اختر الإكسسوارات</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        يمكن اختيار أكثر من قطعة، ويُحدّث السعر مباشرة.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                      {config.accessories.map((item) => (
                        <OptionCard
                          key={item.key}
                          item={item}
                          selected={form.accessories.includes(item.key)}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              accessories: current.accessories.includes(
                                item.key,
                              )
                                ? current.accessories.filter(
                                    (key) => key !== item.key,
                                  )
                                : [...current.accessories, item.key],
                            }))
                          }
                          compact
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {step === 7 ? (
                  <div className="space-y-5">
                    <PreviewPanel config={config} form={form} />
                    {selectedStyle?.modelUrl ? (
                      <ModelViewerCard
                        modelUrl={selectedStyle.modelUrl}
                        title="معاينة ثلاثية الأبعاد - تدوير وتكبير"
                      />
                    ) : null}
                    <div className="rounded-xl border border-border p-4">
                      <h3 className="font-bold">المعاينة الافتراضية</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        ارفع صورة شخصية واضحة لتجربة الروب المختار. تتم المعالجة
                        عند توفر خدمة الذكاء الاصطناعي.
                      </p>
                      <Button
                        className="mt-4"
                        variant="outline"
                        disabled={!config.aiAvailable}
                        onClick={() => setTryOnOpen(true)}
                      >
                        <Camera className="ml-2 h-4 w-4" />
                        بدء التجربة
                      </Button>
                    </div>
                  </div>
                ) : null}

                {step === 8 ? (
                  <div className="space-y-5">
                    <h2 className="font-bold">ملخص السعر والإنتاج</h2>
                    <div className="divide-y divide-border rounded-xl border border-border">
                      {pricing.lines.map((line) => (
                        <div
                          key={line.key}
                          className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                        >
                          <span>{line.name}</span>
                          <strong>{formatCurrency(line.amount)}</strong>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-4 py-4 text-lg">
                        <strong>الإجمالي</strong>
                        <strong className="text-primary">
                          {formatCurrency(pricing.total)}
                        </strong>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-border p-4">
                        <p className="text-sm text-muted-foreground">
                          مدة الإنتاج المتوقعة
                        </p>
                        <strong className="mt-2 block text-xl">
                          {config.productionDays} أيام عمل
                        </strong>
                      </div>
                      <div className="rounded-xl border border-border p-4">
                        <Label>موعد التسليم المطلوب</Label>
                        <Input
                          type="date"
                          className="mt-2"
                          value={form.dueDate}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              dueDate: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {step === 9 ? (
                  <div className="space-y-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label>اسم الزبون *</Label>
                        <Input
                          className="mt-2"
                          value={form.customerName}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              customerName: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <Label>رقم الهاتف *</Label>
                        <Input
                          className="mt-2"
                          inputMode="tel"
                          dir="ltr"
                          value={form.phone}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              phone: formatIraqiPhoneInput(event.target.value),
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <Label>ملاحظات</Label>
                      <Textarea
                        className="mt-2 min-h-24"
                        value={form.notes}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
                      <PreviewPanel config={config} form={form} />
                      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
                        <h3 className="font-bold">تأكيد الطلب</h3>
                        <div className="mt-4 space-y-3 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">النوع</span>
                            <strong>{selectedStyle?.name}</strong>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              المقاس
                            </span>
                            <strong>
                              {form.measurements.suggestedSize ||
                                recommendedGraduationSize({
                                  chest: Number(form.measurements.chest),
                                  height: Number(form.measurements.height),
                                })}
                            </strong>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              الإجمالي
                            </span>
                            <strong className="text-primary">
                              {formatCurrency(pricing.total)}
                            </strong>
                          </div>
                        </div>
                        <Button
                          className="mt-6 w-full"
                          size="lg"
                          disabled={submit.isPending}
                          onClick={() => {
                            const issue = validateStep();
                            if (issue) {
                              toast({
                                title: "بيانات ناقصة",
                                description: issue,
                                variant: "destructive",
                              });
                              return;
                            }
                            submit.mutate();
                          }}
                        >
                          {submit.isPending ? (
                            <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="ml-2 h-4 w-4" />
                          )}
                          إرسال الطلب
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>
            <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
              <Button
                variant="outline"
                onClick={previous}
                disabled={step === 0}
              >
                <ArrowRight className="ml-2 h-4 w-4" />
                السابق
              </Button>
              {step < 9 ? (
                <Button onClick={next}>
                  التالي
                  <ArrowLeft className="mr-2 h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </section>
          <div className="space-y-4 lg:sticky lg:top-24">
            <PreviewPanel config={config} form={form} />
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  إجمالي الطلب
                </span>
                <strong className="text-lg text-primary">
                  {formatCurrency(pricing.total)}
                </strong>
              </div>
              <Progress
                className="mt-3"
                value={((step + 1) / STEPS.length) * 100}
              />
            </section>
          </div>
        </div>
      </div>

      <Dialog open={sizeOpen} onOpenChange={setSizeOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>ماسح القياسات الذكي</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              ارفع صورة واضحة للجسم بالكامل. النتيجة تقديرية ويجب مراجعتها قبل
              الطلب.
            </p>
            {scanImage ? (
              <img
                src={scanImage}
                alt="صورة فحص القياسات"
                className="mx-auto max-h-72 rounded-lg object-contain"
              />
            ) : null}
            <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-primary/50">
              <Camera className="h-8 w-8 text-primary" />
              <span className="mt-2 text-sm">اختيار صورة</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(event) =>
                  event.target.files?.[0] &&
                  fileData(event.target.files[0], "scan")
                }
              />
            </label>
            <Button
              className="w-full"
              disabled={!scanImage || scan.isPending}
              onClick={() => scan.mutate()}
            >
              {scan.isPending ? (
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
              ) : (
                <ScanLine className="ml-2 h-4 w-4" />
              )}
              تحليل القياسات
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={designerOpen} onOpenChange={setDesignerOpen}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>مصمم التخرج الذكي</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="مثال: أريد روباً ملكياً أسود مع وشاح ذهبي وتطريز أمامي"
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
            />
            <Button
              disabled={!aiPrompt.trim() || designer.isPending}
              onClick={() => designer.mutate()}
            >
              {designer.isPending ? (
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="ml-2 h-4 w-4" />
              )}
              إنشاء 3 مقترحات
            </Button>
            {aiConcepts.length ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {aiConcepts.map((concept, index) => (
                  <button
                    key={`${concept.nameAr}-${index}`}
                    type="button"
                    onClick={() => {
                      setForm((current) => ({
                        ...current,
                        styleKey: concept.styleKey || current.styleKey,
                        fabric: {
                          key: concept.fabricKey || current.fabric.key,
                        },
                        colors: {
                          ...current.colors,
                          robe: concept.robeColor || current.colors.robe,
                          sash: concept.sashColor || current.colors.sash,
                          cap: concept.capColor || current.colors.cap,
                          tassel: concept.tasselColor || current.colors.tassel,
                          embroidery:
                            concept.embroideryColor ||
                            current.colors.embroidery,
                        },
                        decoration: {
                          ...current.decoration,
                          type:
                            concept.decorationType || current.decoration.type,
                          position:
                            concept.decorationPosition ||
                            current.decoration.position,
                        },
                      }));
                      setDesignerOpen(false);
                    }}
                    className="rounded-xl border border-border p-4 text-right hover:border-primary"
                  >
                    <strong className="text-sm">{concept.nameAr}</strong>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {concept.descriptionAr}
                    </p>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={tryOnOpen} onOpenChange={setTryOnOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تجربة الروب افتراضياً</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              استخدم صورة واضحة للجسم بالكامل وبإضاءة جيدة للحصول على نتيجة
              أفضل.
            </p>
            {tryOnImage ? (
              <img
                src={tryOnImage}
                alt="صورة التجربة الافتراضية"
                className="mx-auto max-h-72 rounded-lg object-contain"
              />
            ) : null}
            <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-primary/50">
              <UserRound className="h-8 w-8 text-primary" />
              <span className="mt-2 text-sm">اختيار صورة شخصية</span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) =>
                  event.target.files?.[0] &&
                  fileData(event.target.files[0], "try-on")
                }
              />
            </label>
            <Button
              className="w-full"
              disabled={!tryOnImage || tryOn.isPending}
              onClick={() => tryOn.mutate()}
            >
              {tryOn.isPending ? (
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="ml-2 h-4 w-4" />
              )}
              إنشاء المعاينة
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function GraduationTracking() {
  const token = window.location.pathname.split("/").filter(Boolean).pop() || "";
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["graduation", "track", token],
    queryFn: () => graduationFetch<any>(`/track/${token}`),
    refetchInterval: 30_000,
  });
  const approve = useMutation({
    mutationFn: () =>
      graduationFetch(`/track/${token}/approve-design`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      refetch();
      toast({ title: "تم اعتماد التصميم" });
    },
  });
  if (isLoading)
    return (
      <div className="container mx-auto max-w-3xl space-y-4 px-4 py-12">
        <Skeleton className="h-36" />
        <Skeleton className="h-80" />
      </div>
    );
  const order = data?.order;
  if (!order)
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <h1 className="text-2xl font-bold">طلب التخرج غير موجود</h1>
      </div>
    );
  const currentIndex = Object.keys(GRADUATION_STAGE_LABELS).indexOf(
    order.productionStage,
  );
  return (
    <div className="container mx-auto max-w-4xl space-y-5 px-4 py-10" dir="rtl">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-primary">تتبع تجهيزات التخرج</p>
            <h1 className="mt-1 text-2xl font-bold">{order.orderNo}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {order.customerName}
            </p>
          </div>
          <div className="rounded-xl border border-primary/30 bg-primary/5 px-5 py-3 text-center">
            <p className="text-xs text-muted-foreground">الحالة الحالية</p>
            <strong className="mt-1 block text-primary">
              {order.stageLabel}
            </strong>
          </div>
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-bold">تقدم الإنتاج</h2>
        <Progress
          className="mt-4"
          value={Math.max(
            5,
            ((currentIndex + 1) / Object.keys(GRADUATION_STAGE_LABELS).length) *
              100,
          )}
        />
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {Object.entries(GRADUATION_STAGE_LABELS).map(
            ([key, label], index) => (
              <div
                key={key}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${index <= currentIndex ? "border-primary/40 bg-primary/5" : "border-border"}`}
              >
                {index <= currentIndex ? (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                ) : (
                  <Box className="h-4 w-4 text-muted-foreground" />
                )}
                <span>{label}</span>
              </div>
            ),
          )}
        </div>
      </section>
      <div className="grid gap-5 md:grid-cols-[1fr_260px]">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-bold">آخر التحديثات</h2>
          <div className="mt-4 space-y-4">
            {data.timeline?.map((item: any) => (
              <div
                key={`${item.type}-${item.createdAt}`}
                className="border-r-2 border-primary pr-4"
              >
                <strong className="text-sm">{item.title}</strong>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(item.createdAt).toLocaleString("ar-IQ")}
                </p>
              </div>
            ))}
          </div>
        </section>
        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 text-sm">
            <p className="text-muted-foreground">الإجمالي</p>
            <strong className="mt-1 block text-lg">
              {formatCurrency(order.totalAmount)}
            </strong>
            <p className="mt-4 text-muted-foreground">المتبقي</p>
            <strong className="mt-1 block text-primary">
              {formatCurrency(order.remainingAmount)}
            </strong>
          </div>
          {data.qrDataUrl ? (
            <div className="rounded-xl border border-border bg-card p-4 text-center">
              <img
                src={data.qrDataUrl}
                alt="رمز استلام الطلب"
                className="mx-auto h-44 w-44 bg-white p-2"
              />
              <p className="mt-2 text-xs text-muted-foreground">رمز الاستلام</p>
            </div>
          ) : null}
          {!order.designApprovedAt ? (
            <Button
              className="w-full"
              onClick={() => approve.mutate()}
              disabled={approve.isPending}
            >
              <BadgeCheck className="ml-2 h-4 w-4" />
              اعتماد التصميم
            </Button>
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm text-primary">
              <CheckCircle2 className="h-4 w-4" />
              تم اعتماد التصميم
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
