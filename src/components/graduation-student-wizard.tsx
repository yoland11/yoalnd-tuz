import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/money";
import { formatIraqiPhoneInput } from "@/lib/phone";
import { vocalizeArabicName } from "@/lib/graduation-name";
import {
  MEASUREMENTS,
  newStudent,
  SASH_FONTS,
  SASH_TYPES,
  STUDENT_STEPS,
  studentIssue,
  studentPayload,
  restoreStudentDraft,
  type StudentForm,
} from "@/lib/graduation-student-flow";

type CatalogProduct = {
  id: number;
  name: string;
  nameAr: string;
  images: string[];
  price: number;
  designerSection: string;
  stock: number;
  variants: {
    id: number;
    color: string | null;
    stock: number;
    price: number | null;
  }[];
};
type Receipt = {
  id: number;
  customerName: string;
  orderNo: string;
  trackingUrl: string;
  totalAmount?: number;
  [key: string]: any;
};

export function GraduationStudentSummary({
  order,
}: {
  order: Record<string, any>;
}) {
  const text = order.customText || {};
  const measurements = order.measurements || {};
  return (
    <div className="grid gap-4 text-sm sm:grid-cols-[1fr_180px]">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        {[
          ["الاسم", order.customerName],
          [
            "إجمالي الطلب المحفوظ",
            order.totalAmount !== undefined
              ? formatCurrency(order.totalAmount)
              : "",
          ],
          ["الهاتف", order.phone],
          ["القسم", text.department],
          ["الرقم الجامعي", text.studentId],
          [
            "نوع الوشاح",
            SASH_TYPES.find((item) => item.key === text.sashType)?.label ||
              order.garmentDetails?.sashType,
          ],
          ["الاسم على الوشاح", text.text],
          [
            "الخط",
            SASH_FONTS.find((item) => item.key === text.font)?.label ||
              text.font,
          ],
          ["لون الوشاح", order.colors?.sash],
          ["لون التطريز", order.colors?.embroidery],
          [
            "القياس",
            measurements.readySize ||
              measurements.suggestedSize ||
              text.preferredSize,
          ],
          [
            "الفئة",
            measurements.gender === "female"
              ? "نسائي"
              : measurements.gender === "male"
                ? "رجالي"
                : "",
          ],
          ...MEASUREMENTS.map(([key, label]) => [label, measurements[key]]),
        ]
          .filter(
            ([, value]) =>
              value !== undefined && value !== null && value !== "",
          )
          .map(([label, value]) => (
            <div
              key={label}
              className="col-span-2 flex flex-wrap justify-between gap-2 border-b border-border/50 pb-2"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{String(value)}</dd>
            </div>
          ))}
        {order.pricing?.lines
          ?.filter((line: any) => String(line.key).startsWith("flower:"))
          .map((line: any) => (
            <div
              key={line.key}
              className="col-span-2 flex justify-between gap-2"
            >
              <dt>{line.name}</dt>
              <dd>{formatCurrency(line.amount)}</dd>
            </div>
          ))}
      </dl>
      {text.sashType && (
        <div className="h-56 rounded-lg bg-muted/40 p-2">
          <SashPreview
            type={text.sashType}
            color={order.colors?.sash || "#182539"}
            thread={order.colors?.embroidery || "#D4AF37"}
            name={text.text || ""}
            font={text.font}
          />
        </div>
      )}
    </div>
  );
}

export function SashPreview({
  type,
  color,
  thread,
  name = "",
  font = "naskh",
}: {
  type: string;
  color: string;
  thread: string;
  name?: string;
  font?: string;
}) {
  const path =
    type === "side"
      ? "M76 25 L111 30 L195 242 L164 262 Z"
      : type === "royal"
        ? "M83 20 Q130 58 177 20 L194 59 L171 80 L182 254 L146 267 L142 81 L118 81 L114 267 L78 254 L89 80 L66 59 Z"
        : type === "american"
          ? "M91 24 L130 50 L169 24 L173 225 L151 258 L140 235 L140 77 L120 77 L120 235 L109 258 L87 225 Z"
          : "M91 24 Q130 61 169 24 L177 250 L141 265 L140 77 L120 77 L119 265 L83 250 Z";
  return (
    <svg
      viewBox="0 0 260 290"
      role="img"
      aria-label={`معاينة الوشاح ${SASH_TYPES.find((item) => item.key === type)?.label || ""}: ${name}`}
      className="mx-auto h-full max-h-80 w-full"
    >
      <path
        d="M83 17 L46 43 L16 122 L52 136 L63 104 L53 283 L207 283 L197 104 L208 136 L244 122 L214 43 L177 17 Q130 56 83 17"
        fill="#e7e4df"
      />
      <path
        d={path}
        fill={color}
        stroke={thread}
        strokeWidth={type === "royal" ? 4 : 1.5}
      />
      <path
        d="M97 36 Q130 66 163 36"
        fill="none"
        stroke="#ffffff"
        opacity=".2"
        strokeWidth="3"
      />
      <text
        x="0"
        y="0"
        transform={
          type === "side"
            ? "translate(143 170) rotate(69)"
            : "translate(159 170) rotate(90)"
        }
        textAnchor="middle"
        direction="rtl"
        fill={thread}
        style={{
          fontFamily: SASH_FONTS.find((item) => item.key === font)?.family,
          fontSize: name.length > 22 ? 12 : 17,
        }}
      >
        {name || "اسمك هنا"}
      </text>
    </svg>
  );
}

export function GraduationStudentWizard({
  base,
  scope,
  onComplete,
}: {
  base: Record<string, any>;
  scope: string;
  onComplete?: (order: Receipt) => void;
}) {
  const storageKey = `ajn-student-wizard:${scope}`;
  const seed = (): StudentForm => ({
    ...newStudent(),
    ...(scope === "individual"
      ? {
          customerName: base.customerName || "",
          phone: base.phone || "",
          notes: base.notes || "",
          department: base.customText?.department || "",
          sashName: base.customText?.text || base.customText?.studentName || "",
          font: base.customText?.font || "naskh",
          measurements: { ...base.measurements },
          gender: base.measurements?.gender || "male",
          size: base.measurements?.suggestedSize || "",
          flowers: [...(base.extras?.flowers || [])],
          photography: base.extras?.photography
            ? { ...base.extras.photography }
            : null,
        }
      : {}),
    sashColor: base.colors?.sash || "#182539",
    embroideryColor: base.colors?.embroidery || "#D4AF37",
  });
  const baseSeed = useRef(seed());
  const [form, setForm] = useState<StudentForm>(seed);
  const [step, setStep] = useState(0);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [attempt, setAttempt] = useState<{ key: string; body: string } | null>(
    null,
  );
  const saving = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.form)
          setForm(
            restoreStudentDraft(
              data.form,
              data.attempt ? undefined : data.baseSeed,
              baseSeed.current,
            ),
          );
        if (Array.isArray(data.receipts)) setReceipts(data.receipts);
        setDone(data.done === true);
        if (data.attempt?.key && data.attempt?.body) setAttempt(data.attempt);
        if (Number.isInteger(data.step) && data.step >= 0 && data.step < 4)
          setStep(data.step);
      } else if (scope !== "individual") {
        const legacy = localStorage.getItem(
          `graduation-student-draft:${scope}`,
        );
        if (legacy) {
          const data = JSON.parse(legacy);
          setForm({
            ...seed(),
            ...data,
            size: data.preferredSize || "",
            gender: data.measurements?.gender || "male",
            measurements: { ...data.measurements },
          });
        }
      }
    } catch {
      /* Browser draft storage is optional; server save errors are shown below. */
    }
    setHydrated(true);
    // This component is keyed by scope by its callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          form,
          step,
          receipts,
          done,
          attempt,
          baseSeed: baseSeed.current,
        }),
      );
    } catch {
      /* Private browsing may disable draft storage. */
    }
  }, [form, step, receipts, done, attempt, storageKey, hydrated]);

  const catalog = useQuery({
    queryKey: ["graduation-extras", "flowers"],
    queryFn: async () => {
      const response = await fetch("/api/products/designer-catalog");
      if (!response.ok)
        throw new Error("تعذر تحميل الورود والمسكات. أعد المحاولة.");
      return response.json() as Promise<{ products: CatalogProduct[] }>;
    },
    enabled: step === 1,
  });
  const products = (catalog.data?.products || []).filter((product) =>
    ["flowers", "bridal_bouquets", "ready_bouquets"].includes(
      product.designerSection,
    ),
  );
  const change = (patch: Partial<StudentForm>) =>
    setForm((current) => ({ ...current, ...patch }));
  function go(next: number) {
    setError("");
    setStep(next);
    requestAnimationFrame(() => heading.current?.focus());
  }
  function next() {
    const issue = studentIssue(form, step);
    if (issue) {
      setError(issue);
      return;
    }
    go(step + 1);
  }
  function another() {
    setForm({
      ...newStudent(),
      sashColor: base.colors?.sash || "#182539",
      embroideryColor: base.colors?.embroidery || "#D4AF37",
    });
    setDone(false);
    go(0);
  }
  async function save(addAnother: boolean) {
    if (saving.current) return;
    for (const index of [0, 2]) {
      const issue = studentIssue(form, index);
      if (issue) {
        setStep(index);
        setError(issue);
        return;
      }
    }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const submission = attempt || {
        key: crypto.randomUUID(),
        body: JSON.stringify(studentPayload(form, base)),
      };
      setAttempt(submission);
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            form,
            step,
            receipts,
            done,
            attempt: submission,
            baseSeed: baseSeed.current,
          }),
        );
      } catch {
        /* In-memory retry identity still protects this open page. */
      }
      const response = await fetch("/api/graduation/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": submission.key,
        },
        body: submission.body,
      });
      const result = await response.json();
      if (!response.ok) {
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 409
        )
          setAttempt(null);
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : result.error?.message || "تعذر حفظ الطالب",
        );
      }
      if (!result.order?.id || !result.order?.orderNo)
        throw new Error(
          "لم يصل تأكيد حفظ الطلب. تحقق من الاتصال قبل إعادة المحاولة.",
        );
      const updated = [
        ...receipts,
        { ...result.order, warning: result.warning } as Receipt,
      ];
      setReceipts(updated);
      const cleared = {
        ...newStudent(),
        sashColor: base.colors?.sash || "#182539",
        embroideryColor: base.colors?.embroidery || "#D4AF37",
      };
      // Record the receipt before resetting, so a reload cannot restore a submitted student.
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            form: cleared,
            step: 0,
            receipts: updated,
            done: !addAnother,
            baseSeed: baseSeed.current,
          }),
        );
        if (scope !== "individual")
          localStorage.removeItem(`graduation-student-draft:${scope}`);
      } catch {
        /* A confirmed server save remains successful without browser storage. */
      }
      setAttempt(null);
      setForm(cleared);
      setStep(0);
      setDone(!addAnother);
      if (!addAnother) onComplete?.(result.order);
      requestAnimationFrame(() => heading.current?.focus());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "تعذر حفظ الطلب. بقيت بياناتك لإعادة المحاولة.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="space-y-6" dir="rtl">
      {receipts.length > 0 && (
        <div
          className="rounded-xl border border-primary/30 bg-primary/5 p-4"
          aria-live="polite"
        >
          <h3 className="font-bold">
            الطلاب المحفوظون من هذا الجهاز ({receipts.length})
          </h3>
          <ul className="mt-2 space-y-2">
            {receipts.map((receipt) => (
              <li
                key={receipt.id}
                className="space-y-2 border-b border-border py-2 text-sm"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <span>{receipt.customerName}</span>
                  <a
                    className="text-primary underline"
                    href={receipt.trackingUrl}
                  >
                    {receipt.orderNo} — متابعة الطلب
                  </a>
                </div>
                {receipt.warning && (
                  <p
                    role="status"
                    className="rounded-lg border border-amber-500/40 p-3"
                  >
                    {receipt.warning}
                  </p>
                )}
                <details>
                  <summary className="cursor-pointer py-2">
                    عرض البيانات المحفوظة
                  </summary>
                  <GraduationStudentSummary order={receipt} />
                </details>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            كل طلب محفوظ بشكل مستقل ويمكن متابعة تفاصيله من رابطه.
          </p>
        </div>
      )}
      {done ? (
        <div className="space-y-4 rounded-xl border p-6 text-center">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-bold">
            اكتمل تسجيل الطلبات
          </h2>
          <p>تم حفظ بيانات الطلاب واختياراتهم بنجاح.</p>
          <Button onClick={another}>إضافة طالب آخر</Button>
        </div>
      ) : (
        <>
          <ol
            className="grid grid-cols-4 gap-2"
            aria-label="خطوات تسجيل الطالب"
          >
            {STUDENT_STEPS.map((label, index) => (
              <li
                key={label}
                aria-current={index === step ? "step" : undefined}
                className={`border-b-2 pb-3 text-center text-xs sm:text-sm ${index === step ? "border-primary font-bold text-primary" : "border-border text-muted-foreground"}`}
              >
                <span className="mb-1 block">{index + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <h2
            ref={heading}
            tabIndex={-1}
            className="text-xl font-bold outline-none"
          >
            {STUDENT_STEPS[step]}
          </h2>
          <fieldset
            disabled={busy || !hydrated || Boolean(attempt)}
            className="min-w-0 space-y-5"
          >
            {step === 0 && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["customerName", "الاسم الكامل *"],
                      ["phone", "رقم الهاتف *"],
                      ["studentId", "الرقم الجامعي"],
                      ["department", "القسم"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key}>
                      <Label htmlFor={`student-${key}`}>{label}</Label>
                      <Input
                        id={`student-${key}`}
                        className="mt-2"
                        value={form[key]}
                        maxLength={key === "phone" ? 30 : 160}
                        inputMode={key === "phone" ? "tel" : undefined}
                        onChange={(event) =>
                          change({
                            [key]:
                              key === "phone"
                                ? formatIraqiPhoneInput(event.target.value)
                                : event.target.value,
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
                <Label htmlFor="student-notes">ملاحظات الطلب</Label>
                <Textarea
                  id="student-notes"
                  value={form.notes}
                  onChange={(event) => change({ notes: event.target.value })}
                />
              </>
            )}
            {step === 1 && (
              <>
                <h3 className="font-semibold">نوع الوشاح</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {SASH_TYPES.map((type) => (
                    <button
                      key={type.key}
                      type="button"
                      aria-label={type.label}
                      aria-pressed={form.sashType === type.key}
                      onClick={() => change({ sashType: type.key })}
                      className={`rounded-xl border-2 p-3 focus-visible:outline focus-visible:outline-primary ${form.sashType === type.key ? "border-primary bg-primary/5" : "border-border"}`}
                    >
                      <div className="h-32">
                        <SashPreview
                          type={type.key}
                          color={form.sashColor}
                          thread={form.embroideryColor}
                        />
                      </div>
                      <span className="mt-2 block font-semibold">
                        {type.label}
                      </span>
                    </button>
                  ))}
                </div>
                <h3 className="font-semibold">
                  ورود ومسكات المتجر{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    (اختياري)
                  </span>
                </h3>
                {catalog.isLoading && <p role="status">جاري تحميل المنتجات…</p>}
                {catalog.isError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive p-3"
                  >
                    <p>{catalog.error.message}</p>
                    <Button
                      variant="outline"
                      onClick={() => void catalog.refetch()}
                    >
                      إعادة المحاولة
                    </Button>
                  </div>
                )}
                {catalog.isSuccess && products.length === 0 && (
                  <p>لا توجد ورود أو مسكات متاحة حالياً.</p>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {products.map((product) => (
                    <article
                      key={product.id}
                      className="space-y-2 rounded-xl border p-3"
                    >
                      {product.images?.[0] && (
                        <img
                          src={product.images[0]}
                          alt={product.nameAr || product.name}
                          className="h-32 w-full rounded-lg object-cover"
                          loading="lazy"
                        />
                      )}
                      <h4 className="text-sm font-semibold">
                        {product.nameAr || product.name}
                      </h4>
                      <p className="text-sm">{formatCurrency(product.price)}</p>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() =>
                          setForm((current) => {
                            const existing = current.flowers.find(
                              (flower) => flower.productId === product.id,
                            );
                            return {
                              ...current,
                              flowers: existing
                                ? current.flowers.map((flower) =>
                                    flower.productId === product.id
                                      ? {
                                          ...flower,
                                          quantity: Math.min(
                                            100,
                                            flower.quantity + 1,
                                          ),
                                        }
                                      : flower,
                                  )
                                : [
                                    ...current.flowers,
                                    {
                                      productId: product.id,
                                      name: product.nameAr || product.name,
                                      quantity: 1,
                                    },
                                  ],
                            };
                          })
                        }
                      >
                        إضافة
                      </Button>
                    </article>
                  ))}
                </div>
                {form.flowers.map((flower, index) => (
                  <div
                    key={`${flower.productId}-${index}`}
                    className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3"
                  >
                    <span className="flex-1 text-sm">{flower.name}</span>
                    <Input
                      aria-label={`كمية ${flower.name}`}
                      className="w-20"
                      type="number"
                      min={1}
                      max={100}
                      value={flower.quantity}
                      onChange={(event) =>
                        change({
                          flowers: form.flowers.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  quantity: Math.max(
                                    1,
                                    Math.min(
                                      100,
                                      Number(event.target.value) || 1,
                                    ),
                                  ),
                                }
                              : item,
                          ),
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      onClick={() =>
                        change({
                          flowers: form.flowers.filter((_, i) => i !== index),
                        })
                      }
                    >
                      حذف
                    </Button>
                  </div>
                ))}
              </>
            )}
            {step === 2 && (
              <>
                <div className="flex gap-3">
                  {[
                    ["male", "رجالي"],
                    ["female", "نسائي"],
                  ].map(([key, label]) => (
                    <Button
                      key={key}
                      type="button"
                      variant={form.gender === key ? "default" : "outline"}
                      aria-pressed={form.gender === key}
                      onClick={() => change({ gender: key })}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <Label htmlFor="student-size">
                  مقاس البدن (أو اكتب رقم مقاسك)
                </Label>
                <div className="flex flex-wrap gap-2">
                  {["XS", "S", "M", "L", "XL", "XXL"].map((size) => (
                    <Button
                      key={size}
                      variant={form.size === size ? "default" : "outline"}
                      aria-pressed={form.size === size}
                      onClick={() => change({ size })}
                    >
                      {size}
                    </Button>
                  ))}
                </div>
                <Input
                  id="student-size"
                  value={form.size}
                  maxLength={20}
                  placeholder="مثلاً: M أو 48"
                  onChange={(event) => change({ size: event.target.value })}
                />
                {form.size && (
                  <p className="text-sm text-muted-foreground">
                    مقاسك: {form.size}
                    {form.size === "XS" ? " — صغير جداً" : ""}
                    {form.size === "XS" && form.gender === "male"
                      ? " (44 رجالي، تقريبي حسب القالب)"
                      : ""}
                  </p>
                )}
                <details>
                  <summary className="cursor-pointer py-3 font-semibold">
                    أدخل قياساتك بالتفصيل (اختياري)
                  </summary>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    {MEASUREMENTS.map(([key, label, min, max]) => (
                      <div key={key}>
                        <Label htmlFor={`measure-${key}`}>{label}</Label>
                        <Input
                          id={`measure-${key}`}
                          className="mt-2"
                          type="number"
                          min={min}
                          max={max}
                          value={form.measurements[key] || ""}
                          onChange={(event) =>
                            change({
                              measurements: {
                                ...form.measurements,
                                [key]: event.target.value,
                              },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </details>
              </>
            )}
            {step === 3 && (
              <>
                <p className="text-sm leading-7 text-muted-foreground">
                  اكتب اسمك وشوف شكله على طرف الوشاح قبل لا تطلب. الكتابة بنفس
                  الترتيب اللي تكتبه. نضيف تشكيل الأسماء المعروفة عند مغادرة
                  الحقل، وتكدر تعدّله بنفسك.
                </p>
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="sash-name">اكتب اسمك</Label>
                      <Input
                        id="sash-name"
                        className="mt-2"
                        maxLength={50}
                        value={form.sashName}
                        onChange={(event) =>
                          change({ sashName: event.target.value })
                        }
                        onBlur={() =>
                          change({
                            sashName:
                              vocalizeArabicName(form.sashName) ||
                              form.sashName,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="sash-color">لون الوشاح</Label>
                      <Input
                        id="sash-color"
                        type="color"
                        className="mt-2 h-12"
                        value={form.sashColor}
                        onChange={(event) =>
                          change({ sashColor: event.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label>لون التطريز</Label>
                      <div className="mt-2 flex gap-2">
                        {[
                          ["#D4AF37", "ذهبي"],
                          ["#C0C0C0", "فضي"],
                        ].map(([color, label]) => (
                          <Button
                            key={color}
                            variant={
                              form.embroideryColor === color
                                ? "default"
                                : "outline"
                            }
                            aria-pressed={form.embroideryColor === color}
                            onClick={() => change({ embroideryColor: color })}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="sash-font">الخط</Label>
                      <select
                        id="sash-font"
                        value={form.font}
                        onChange={(event) =>
                          change({ font: event.target.value })
                        }
                        className="mt-2 h-11 w-full rounded-md border bg-background px-3"
                      >
                        {!SASH_FONTS.some((font) => font.key === form.font) && (
                          <option value={form.font}>
                            الخط السابق ({form.font})
                          </option>
                        )}
                        {SASH_FONTS.map((font) => (
                          <option key={font.key} value={font.key}>
                            {font.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="rounded-xl bg-muted/50 p-4">
                    <SashPreview
                      type={form.sashType}
                      color={form.sashColor}
                      thread={form.embroideryColor}
                      name={form.sashName}
                      font={form.font}
                    />
                    <p className="mt-3 text-center text-xs text-muted-foreground">
                      معاينة توضيحية؛ شكل الخط النهائي يعتمد على خط التطريز
                      المعتمد.
                    </p>
                  </div>
                </div>
                {form.photography && (
                  <div className="rounded-lg border p-3 text-sm">
                    <p>
                      جلسة التصوير المختارة:{" "}
                      {String(
                        form.photography.serviceName ||
                          form.photography.serviceId,
                      )}
                    </p>
                    <p>
                      {String(form.photography.date || "")}{" "}
                      {String(form.photography.time || "")}
                    </p>
                    <Button
                      variant="ghost"
                      onClick={() => change({ photography: null })}
                    >
                      إزالة جلسة التصوير
                    </Button>
                  </div>
                )}
                <div className="rounded-lg border p-4 text-sm">
                  <strong>{form.customerName}</strong>
                  <p className="mt-2">
                    {
                      SASH_TYPES.find((type) => type.key === form.sashType)
                        ?.label
                    }{" "}
                    · {form.size || "القياسات لاحقاً"} ·{" "}
                    {form.flowers.reduce(
                      (sum, flower) => sum + flower.quantity,
                      0,
                    )}{" "}
                    ورود ومسكات
                  </p>
                </div>
              </>
            )}
          </fieldset>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {attempt && !busy && (
            <p className="text-sm text-muted-foreground">
              لم يتأكد الحفظ بعد. اضغط زر الحفظ نفسه لإعادة المحاولة دون إنشاء
              طلب مكرر.
            </p>
          )}
          <div className="flex flex-wrap justify-between gap-3 border-t pt-5">
            <Button
              variant="outline"
              disabled={step === 0 || busy || Boolean(attempt)}
              onClick={() => go(step - 1)}
            >
              رجوع
            </Button>
            {step < 3 ? (
              <Button disabled={busy || !hydrated} onClick={next}>
                التالي
              </Button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void save(true)}
                >
                  {busy ? "جاري الحفظ…" : "إضافة طالب آخر"}
                </Button>
                <Button disabled={busy} onClick={() => void save(false)}>
                  {busy ? "جاري الحفظ…" : "اكتمال"}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
