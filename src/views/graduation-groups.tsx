import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  ClipboardList,
  Copy,
  GraduationCap,
  Loader2,
  LockKeyhole,
  QrCode,
  Ruler,
  Shirt,
  UserRound,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { processImageFile } from "@/lib/image-tools";
import { formatIraqiPhoneInput } from "@/lib/phone";
import type { GraduationConfig } from "@/lib/graduation";

type PublicGraduationConfig = GraduationConfig & { aiAvailable: boolean };

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

export function GraduationOrderTypeChoice({
  onIndividual,
  onGroup,
  onJoin,
}: {
  onIndividual: () => void;
  onGroup: () => void;
  onJoin: (token: string) => void;
}) {
  const [code, setCode] = useState("");
  return (
    <main className="min-h-screen bg-background px-4 py-10" dir="rtl">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <GraduationCap className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold text-foreground sm:text-3xl">
            كيف تريد إنشاء طلب التخرج؟
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            اختر طلباً فردياً لتخصيص كل التفاصيل، أو أنشئ مجموعة موحدة لدفعة
            التخرج.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={onIndividual}
            className="group min-h-72 rounded-xl border border-border bg-card p-6 text-right transition-colors hover:border-primary/60 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-primary">
              <UserRound className="h-6 w-6" />
            </span>
            <h2 className="mt-7 text-xl font-bold">طلب فردي</h2>
            <p className="mt-2 min-h-12 text-sm leading-6 text-muted-foreground">
              لطالب واحد يريد اختيار التصميم والقياسات والقماش والألوان والطباعة
              بحرية.
            </p>
            <span className="mt-8 flex items-center gap-2 text-sm font-semibold text-primary">
              فتح مُعدّ التصميم
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            </span>
          </button>

          <button
            type="button"
            onClick={onGroup}
            className="group min-h-72 rounded-xl border border-primary/35 bg-primary/[0.04] p-6 text-right transition-colors hover:border-primary hover:bg-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Users className="h-6 w-6" />
            </span>
            <h2 className="mt-7 text-xl font-bold">طلب جماعي</h2>
            <p className="mt-2 min-h-12 text-sm leading-6 text-muted-foreground">
              للجامعات والكليات والأقسام؛ تُقفل الإعدادات المشتركة ويسجل كل طالب
              قياساته فقط.
            </p>
            <span className="mt-8 flex items-center gap-2 text-sm font-semibold text-primary">
              إنشاء مجموعة تخرج
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            </span>
          </button>
        </div>

        <section className="mt-5 rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Label htmlFor="graduation-group-code">لديك رمز مجموعة؟</Label>
              <Input
                id="graduation-group-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="AJN-GRP-00001"
                className="mt-2 text-left"
                dir="ltr"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => code.trim() && onJoin(code.trim())}
              disabled={!code.trim()}
            >
              <QrCode className="ml-2 h-4 w-4" />
              الانضمام للمجموعة
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}

const initialGroup = {
  title: "",
  university: "",
  college: "",
  department: "",
  graduationBatch: "",
  graduationYear: String(new Date().getFullYear()),
  representativeName: "",
  representativePhone: "",
  expectedStudentCount: 1,
  deliveryDate: "",
  notes: "",
  styleKey: "",
  packageKey: "",
  fabricKey: "",
  colors: {
    robe: "#111111",
    sash: "#D4B15A",
    cap: "#111111",
    tassel: "#D4B15A",
    embroidery: "#D4B15A",
  },
  decorationType: "none",
  universityLogo: "",
  collegeLogo: "",
  defaultDesign: "",
  accessories: [] as string[],
  defaultFont: "cairo",
};

export function GraduationGroupBuilder({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState(initialGroup);
  const [created, setCreated] = useState<any>(null);
  const { data: config, isLoading } = useQuery({
    queryKey: ["graduation", "config"],
    queryFn: () => graduationFetch<PublicGraduationConfig>("/config"),
    staleTime: 5 * 60_000,
  });
  const create = useMutation({
    mutationFn: () =>
      graduationFetch<{ group: any }>("/groups", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          university: form.university,
          college: form.college,
          department: form.department,
          graduationBatch: form.graduationBatch,
          graduationYear: form.graduationYear,
          representativeName: form.representativeName,
          representativePhone: form.representativePhone,
          expectedStudentCount: form.expectedStudentCount,
          deliveryDate: form.deliveryDate,
          notes: form.notes,
          defaultConfiguration: {
            styleKey: form.styleKey,
            packageKey: form.packageKey || undefined,
            colors: form.colors,
            fabric: { key: form.fabricKey },
            decoration: {
              type: form.decorationType,
              position: "front",
              universityLogo: form.universityLogo,
              collegeLogo: form.collegeLogo,
            },
            accessories: form.accessories,
            customText: {
              university: form.university,
              college: form.college,
              graduationYear: form.graduationYear,
              font: form.defaultFont,
            },
            universityTemplate: {
              university: form.university,
              college: form.college,
              department: form.department,
              logoUrl: form.universityLogo,
              collegeLogoUrl: form.collegeLogo,
              defaultDesign: form.defaultDesign,
            },
          },
        }),
      }),
    onSuccess: ({ group }) => setCreated(group),
    onError: (error: Error) =>
      toast({
        title: "تعذر إنشاء المجموعة",
        description: error.message,
        variant: "destructive",
      }),
  });

  async function setImage(
    key: "universityLogo" | "collegeLogo" | "defaultDesign",
    file: File,
  ) {
    const value = await processImageFile(file, {
      maxSize: 1600,
      quality: 0.86,
    });
    setForm((current) => ({ ...current, [key]: value }));
  }

  if (isLoading || !config)
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <Skeleton className="h-[640px]" />
      </div>
    );
  if (created)
    return (
      <main className="min-h-screen bg-background px-4 py-12" dir="rtl">
        <Card className="mx-auto max-w-2xl">
          <CardContent className="space-y-5 p-6 text-center sm:p-8">
            <BadgeCheck className="mx-auto h-14 w-14 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">تم إنشاء مجموعة التخرج</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                شارك الرمز أو الرابط أو QR مع الطلبة.
              </p>
            </div>
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <span className="text-xs text-muted-foreground">
                رمز المجموعة
              </span>
              <strong className="mt-1 block text-xl text-primary" dir="ltr">
                {created.groupNo}
              </strong>
            </div>
            {created.qrDataUrl ? (
              <img
                src={created.qrDataUrl}
                alt="QR الانضمام للمجموعة"
                className="mx-auto h-52 w-52 rounded-lg bg-white p-2"
              />
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(`${window.location.origin}${created.joinUrl}`)
                    .then(() => toast({ title: "تم نسخ رابط الانضمام" }))
                }
              >
                <Copy className="ml-2 h-4 w-4" />
                نسخ رابط الانضمام
              </Button>
              <Button variant="outline" onClick={onBack}>
                العودة للبداية
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );

  const valid =
    form.title.trim().length >= 2 &&
    form.representativeName.trim().length >= 2 &&
    form.representativePhone.replace(/\D/g, "").length >= 10 &&
    form.styleKey &&
    form.fabricKey;
  return (
    <main className="min-h-screen bg-background px-3 py-6 sm:px-5" dir="rtl">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="text-sm font-semibold text-primary">طلب تخرج جماعي</p>
            <h1 className="mt-1 text-2xl font-bold">
              إنشاء المجموعة والإعدادات المشتركة
            </h1>
          </div>
          <Button variant="outline" onClick={onBack}>
            <ArrowRight className="ml-2 h-4 w-4" />
            رجوع
          </Button>
        </header>

        <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="font-bold">معلومات المجموعة</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["university", "الجامعة"],
              ["college", "الكلية"],
              ["department", "القسم"],
              ["graduationBatch", "دفعة التخرج"],
              ["title", "اسم المجموعة"],
              ["representativeName", "اسم ممثل المجموعة"],
            ].map(([key, label]) => (
              <div key={key}>
                <Label>{label}</Label>
                <Input
                  className="mt-2"
                  value={(form as any)[key]}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
            <div>
              <Label>هاتف ممثل المجموعة</Label>
              <Input
                className="mt-2"
                inputMode="tel"
                value={form.representativePhone}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    representativePhone: formatIraqiPhoneInput(
                      event.target.value,
                    ),
                  }))
                }
              />
            </div>
            <div>
              <Label>العدد المتوقع</Label>
              <Input
                className="mt-2"
                type="number"
                min={1}
                value={form.expectedStudentCount}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    expectedStudentCount: Math.max(
                      1,
                      Number(event.target.value) || 1,
                    ),
                  }))
                }
              />
            </div>
            <div>
              <Label>موعد التسليم</Label>
              <Input
                className="mt-2"
                type="date"
                value={form.deliveryDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    deliveryDate: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div className="mt-4">
            <Label>ملاحظات المجموعة</Label>
            <Textarea
              className="mt-2"
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
            />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-bold">القالب المشترك المقفل</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                يرثه جميع الطلبة ولا يمكنهم تغييره بعد الانضمام.
              </p>
            </div>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <Label>نوع الروب</Label>
                <Select
                  value={form.styleKey}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, styleKey: value }))
                  }
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder="اختر النوع" />
                  </SelectTrigger>
                  <SelectContent>
                    {config.styles.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>نوع القماش</Label>
                <Select
                  value={form.fabricKey}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, fabricKey: value }))
                  }
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder="اختر القماش" />
                  </SelectTrigger>
                  <SelectContent>
                    {config.fabrics.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>الباقة</Label>
                <Select
                  value={form.packageKey || "none"}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      packageKey: value === "none" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون باقة</SelectItem>
                    {config.packages.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>طريقة الشعار</Label>
                <Select
                  value={form.decorationType}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      decorationType: value,
                    }))
                  }
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون</SelectItem>
                    <SelectItem value="printing">طباعة</SelectItem>
                    <SelectItem value="embroidery">تطريز</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>الألوان المشتركة</Label>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  ["robe", "الروب"],
                  ["sash", "الوشاح"],
                  ["cap", "القبعة"],
                  ["tassel", "الشرابة"],
                  ["embroidery", "التطريز"],
                ].map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm"
                  >
                    <span>{label}</span>
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
                      className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent"
                    />
                  </label>
                ))}
              </div>
              <Label className="mt-5 block">الإكسسوارات المضمنة</Label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {config.accessories.map((item) => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-2 text-sm"
                  >
                    <Checkbox
                      checked={form.accessories.includes(item.key)}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          accessories: checked
                            ? [...current.accessories, item.key]
                            : current.accessories.filter(
                                (key) => key !== item.key,
                              ),
                        }))
                      }
                    />
                    <span>{item.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              ["universityLogo", "شعار الجامعة"],
              ["collegeLogo", "شعار الكلية"],
              ["defaultDesign", "التصميم الافتراضي"],
            ].map(([key, label]) => (
              <label
                key={key}
                className="cursor-pointer rounded-lg border border-dashed border-border p-3 text-center text-sm hover:border-primary/60"
              >
                <span>{label}</span>
                {(form as any)[key] ? (
                  <Check className="mx-auto mt-2 h-5 w-5 text-primary" />
                ) : (
                  <span className="mt-2 block text-xs text-muted-foreground">
                    اختيار صورة
                  </span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) =>
                    event.target.files?.[0] &&
                    setImage(key as any, event.target.files[0])
                  }
                />
              </label>
            ))}
          </div>
        </section>

        <div className="flex justify-end">
          <Button
            size="lg"
            disabled={!valid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? (
              <Loader2 className="ml-2 h-4 w-4 animate-spin" />
            ) : (
              <Users className="ml-2 h-4 w-4" />
            )}
            إنشاء المجموعة وقفل القالب
          </Button>
        </div>
      </div>
    </main>
  );
}

const emptyMeasurements = {
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
};

export function GraduationGroupStudentRegistration({
  token,
  onBack,
}: {
  token: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    customerName: "",
    phone: "",
    department: "",
    preferredSize: "",
    sashName: "",
    studentId: "",
    notes: "",
    measurements: emptyMeasurements,
  });
  const [completed, setCompleted] = useState<any>(null);
  const groupQuery = useQuery({
    queryKey: ["graduation", "group", token],
    queryFn: () =>
      graduationFetch<{ group: any }>(`/groups/${encodeURIComponent(token)}`),
  });
  const group = groupQuery.data?.group;
  const locked = group?.defaultConfiguration ?? {};
  const submit = useMutation({
    mutationFn: () =>
      graduationFetch<{ order: any }>("/orders", {
        method: "POST",
        body: JSON.stringify({
          customerName: form.customerName,
          phone: form.phone,
          groupToken: token,
          status: "submitted",
          styleKey: locked.styleKey || "standard",
          packageKey: locked.packageKey || undefined,
          measurements: Object.fromEntries(
            Object.entries(form.measurements).map(([key, value]) => [
              key,
              key === "gender" || key === "suggestedSize"
                ? value
                : Number(value) || undefined,
            ]),
          ),
          colors: locked.colors || {},
          fabric: locked.fabric || { key: "standard" },
          decoration: locked.decoration || { type: "none", position: "front" },
          accessories: locked.accessories || [],
          universityTemplate: locked.universityTemplate || {},
          previewAssets: locked.previewAssets || {},
          customText: {
            ...(locked.customText || {}),
            studentName: form.customerName,
            department: form.department,
            text: form.sashName,
            studentId: form.studentId,
            preferredSize: form.preferredSize,
          },
          notes: form.notes,
          dueDate:
            group?.groupMeta?.deliveryDate || group?.eventDate || undefined,
        }),
      }),
    onSuccess: ({ order }) => setCompleted(order),
    onError: (error: Error) =>
      toast({
        title: "تعذر تسجيل الطالب",
        description: error.message,
        variant: "destructive",
      }),
  });
  const progress = useMemo(() => {
    const required = [
      form.customerName,
      form.phone,
      form.measurements.height,
      form.measurements.shoulder,
      form.measurements.chest,
      form.measurements.waist,
      form.measurements.sleeveLength,
    ];
    return Math.round(
      (required.filter(Boolean).length / required.length) * 100,
    );
  }, [form]);

  if (groupQuery.isLoading)
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Skeleton className="h-[620px]" />
      </div>
    );
  if (groupQuery.isError || !group)
    return (
      <main
        className="min-h-screen bg-background px-4 py-16 text-center"
        dir="rtl"
      >
        <QrCode className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-bold">تعذر فتح المجموعة</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          تحقق من رمز المجموعة أو اطلب رابطاً جديداً من ممثل الدفعة.
        </p>
        <Button className="mt-5" variant="outline" onClick={onBack}>
          العودة
        </Button>
      </main>
    );
  if (completed)
    return (
      <main className="min-h-screen bg-background px-4 py-12" dir="rtl">
        <Card className="mx-auto max-w-xl">
          <CardContent className="space-y-5 p-7 text-center">
            <BadgeCheck className="mx-auto h-14 w-14 text-primary" />
            <h1 className="text-2xl font-bold">تم تسجيلك في المجموعة</h1>
            <p className="text-muted-foreground">{group.title}</p>
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <span className="text-xs text-muted-foreground">رقم الطلب</span>
              <strong className="mt-1 block text-xl text-primary">
                {completed.orderNo}
              </strong>
            </div>
            {completed.qrDataUrl ? (
              <img
                src={completed.qrDataUrl}
                alt="QR متابعة طلب الطالب"
                className="mx-auto h-48 w-48 rounded-lg bg-white p-2"
              />
            ) : null}
            <Button
              className="w-full"
              onClick={() => window.location.assign(completed.trackingUrl)}
            >
              متابعة الإنتاج
            </Button>
          </CardContent>
        </Card>
      </main>
    );

  const ready = progress === 100 && form.phone.replace(/\D/g, "").length >= 10;
  return (
    <main className="min-h-screen bg-background px-3 py-6 sm:px-5" dir="rtl">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="text-sm font-semibold text-primary">
              {group.groupNo}
            </p>
            <h1 className="mt-1 text-2xl font-bold">{group.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {[group.university, group.college, group.department]
                .filter(Boolean)
                .join(" - ")}
            </p>
          </div>
          <Button variant="outline" onClick={onBack}>
            <ArrowRight className="ml-2 h-4 w-4" />
            رجوع
          </Button>
        </header>
        <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-primary/30 bg-primary/[0.04] p-4 lg:sticky lg:top-4">
            <div className="flex items-center gap-2">
              <LockKeyhole className="h-5 w-5 text-primary" />
              <h2 className="font-bold">إعدادات المجموعة</h2>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              هذه التفاصيل اختارها ممثل المجموعة وهي مقفلة لجميع الطلبة.
            </p>
            <div className="mt-4 space-y-2 text-sm">
              {[
                ["نوع الروب", locked.styleKey],
                ["القماش", locked.fabric?.key],
                ["الباقة", locked.packageKey || "بدون"],
                ["سنة التخرج", group.graduationYear],
                [
                  "موعد التسليم",
                  group.groupMeta?.deliveryDate || group.eventDate,
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <strong className="truncate">{value || "—"}</strong>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between text-xs">
                <span>اكتمال بياناتك</span>
                <strong className="text-primary">{progress}%</strong>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-[width] duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </aside>
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-5 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              <div>
                <h2 className="font-bold">بيانات الطالب والقياسات</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  أدخل بياناتك الشخصية فقط؛ بقية التصميم موروث من المجموعة.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["customerName", "الاسم الكامل"],
                ["phone", "رقم الهاتف"],
                ["studentId", "الرقم الجامعي"],
                ["department", "القسم"],
                ["preferredSize", "المقاس المفضل"],
                ["sashName", "الاسم على الوشاح"],
              ].map(([key, label]) => (
                <div key={key}>
                  <Label>{label}</Label>
                  <Input
                    className="mt-2"
                    inputMode={key === "phone" ? "tel" : undefined}
                    value={(form as any)[key]}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        [key]:
                          key === "phone"
                            ? formatIraqiPhoneInput(event.target.value)
                            : event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
            <div className="my-5 border-t border-border" />
            <div className="mb-3 flex items-center gap-2">
              <Ruler className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">القياسات</h3>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["height", "الطول (سم)"],
                ["weight", "الوزن (كغم)"],
                ["shoulder", "عرض الكتف"],
                ["chest", "محيط الصدر"],
                ["waist", "محيط الخصر"],
                ["hip", "محيط الورك"],
                ["sleeveLength", "طول الكم"],
                ["neck", "محيط الرقبة"],
              ].map(([key, label]) => (
                <div key={key}>
                  <Label>{label}</Label>
                  <Input
                    className="mt-2"
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
                  />
                </div>
              ))}
              <div>
                <Label>الجنس</Label>
                <Select
                  value={form.measurements.gender}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      measurements: { ...current.measurements, gender: value },
                    }))
                  }
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">ذكر</SelectItem>
                    <SelectItem value="female">أنثى</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-4">
              <Label>ملاحظات</Label>
              <Textarea
                className="mt-2"
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
            </div>
            <div className="mt-5 flex justify-end">
              <Button
                size="lg"
                disabled={!ready || submit.isPending}
                onClick={() => submit.mutate()}
              >
                {submit.isPending ? (
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                ) : (
                  <Shirt className="ml-2 h-4 w-4" />
                )}
                تسجيل طلب الطالب
              </Button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
