import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Download, AlertTriangle, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { equipmentKey, type KoshaEquipmentLine } from "@/lib/kosha-equipment";
import { adminFetch } from "./_lib";

type PreviewLine = KoshaEquipmentLine & {
  name: string;
  imageUrl: string | null;
  available: number;
  reserved: number;
  missing: number;
  alreadyImported: boolean;
};
export function KoshaEquipmentImport({
  base,
  queryKey,
}: {
  base: string;
  queryKey: unknown[];
}) {
  const client = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(true);
  const [choices, setChoices] = useState<
    Record<string, { selected: boolean; quantity: number; notes: string }>
  >({});
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const preview = useQuery<{
    koshaId: number | null;
    items: PreviewLine[];
    message?: string;
  }>({
    queryKey: [...queryKey, "kosha-equipment"],
    queryFn: () => adminFetch(`${base}/kosha-equipment`),
    enabled: open,
  });
  const lines = preview.data?.items ?? [];
  const choice = (line: PreviewLine) =>
    choices[equipmentKey(line)] ?? {
      selected: line.required && !line.alreadyImported,
      quantity: line.quantity,
      notes: line.notes,
    };
  const selected = lines.filter(
    (l) => choice(l).selected && !l.alreadyImported,
  );
  const save = useMutation({
    mutationFn: () =>
      adminFetch<{ imported: number }>(`${base}/kosha-equipment`, {
        method: "POST",
        body: JSON.stringify({
          confirmation: true,
          items: selected.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            quantity: choice(l).quantity,
            notes: choice(l).notes,
          })),
        }),
      }),
    onSuccess: async (result) => {
      setChoices({});
      await client.invalidateQueries({ queryKey });
      toast({ title: `تم استيراد ${result.imported} عنصر من معدات الكوشة` });
    },
    onError: (e: Error) =>
      toast({
        title: "تعذر استيراد المعدات",
        description: e.message,
        variant: "destructive",
      }),
  });
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Package className="h-5 w-5 text-primary" /> معدات الكوشة المقترحة
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            راجع الكميات قبل الحجز. الاستيراد لا يغيّر القالب ولا يخصم المخزون.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setOpen(!open)}>
          <Download className="ml-2 h-4 w-4" /> استيراد معدات الكوشة
        </Button>
      </header>
      {open ? (
        <>
          {preview.isPending ? (
            <p role="status">جاري فحص التوفر...</p>
          ) : preview.error ? (
            <div role="alert" className="text-destructive">
              تعذر تحميل المعدات: {(preview.error as Error).message}{" "}
              <Button
                type="button"
                variant="outline"
                onClick={() => preview.refetch()}
              >
                إعادة المحاولة
              </Button>
            </div>
          ) : !lines.length ? (
            <p className="rounded-xl bg-muted/30 p-4">
              {preview.data?.message ||
                "لا توجد معدات محفوظة للكوشة. أضفها من إدارة الكوشات."}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="نوع المواد"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="min-h-10 rounded-xl border bg-background px-3"
                >
                  <option value="all">كل المواد</option>
                  <option value="returnable">معدات قابلة للإرجاع</option>
                  <option value="consumable">مواد مستهلكة</option>
                </select>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث في معدات الكوشة..."
                  aria-label="بحث المعدات المقترحة"
                  className="sm:max-w-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setChoices(
                      Object.fromEntries(
                        lines.map((l) => [
                          equipmentKey(l),
                          {
                            selected: !l.alreadyImported,
                            quantity: choice(l).quantity,
                            notes: choice(l).notes,
                          },
                        ]),
                      ),
                    )
                  }
                >
                  تحديد الكل
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setChoices(
                      Object.fromEntries(
                        lines.map((l) => [
                          equipmentKey(l),
                          {
                            selected: false,
                            quantity: choice(l).quantity,
                            notes: choice(l).notes,
                          },
                        ]),
                      ),
                    )
                  }
                >
                  إلغاء التحديد
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {lines
                  .filter(
                    (l) =>
                      l.name.includes(search.trim()) &&
                      (kind === "all" ||
                        (kind === "returnable" ? l.returnable : !l.returnable)),
                  )
                  .map((line) => {
                    const current = choice(line);
                    return (
                      <article
                        key={equipmentKey(line)}
                        className="space-y-3 rounded-xl border p-3"
                      >
                        <label className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={current.selected}
                            disabled={line.alreadyImported || save.isPending}
                            onChange={(e) =>
                              setChoices({
                                ...choices,
                                [equipmentKey(line)]: {
                                  ...current,
                                  selected: e.target.checked,
                                },
                              })
                            }
                          />
                          {line.imageUrl ? (
                            <img
                              src={line.imageUrl}
                              alt=""
                              loading="lazy"
                              className="h-14 w-14 rounded-xl object-cover"
                            />
                          ) : (
                            <Package className="h-12 w-12 rounded-xl bg-muted p-3" />
                          )}
                          <span className="min-w-0">
                            <b className="block break-words">{line.name}</b>
                            <small className="text-muted-foreground">
                              {line.returnable ? "قابل للإرجاع" : "مستهلك"} ·{" "}
                              {line.required ? "مطلوب" : "اختياري"}
                              {line.variantId
                                ? ` · متغير #${line.variantId}`
                                : ""}
                            </small>
                          </span>
                        </label>
                        {line.alreadyImported ? (
                          <p className="text-sm text-muted-foreground">
                            موجود بالحجز — تبقى تعديلاته الحالية محفوظة
                          </p>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                            <label
                              htmlFor={`equipment-qty-${equipmentKey(line)}`}
                            >
                              الكمية المطلوبة ({line.unit})
                            </label>
                            <div className="flex items-center gap-1" dir="ltr">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                disabled={
                                  save.isPending ||
                                  current.quantity <=
                                    (line.returnable ? 1 : 0.001)
                                }
                                aria-label={`تقليل كمية ${line.name}`}
                                onClick={() =>
                                  setChoices({
                                    ...choices,
                                    [equipmentKey(line)]: {
                                      ...current,
                                      quantity: Math.max(
                                        line.returnable ? 1 : 0.001,
                                        Math.round(
                                          (current.quantity - 1) * 1000,
                                        ) / 1000,
                                      ),
                                    },
                                  })
                                }
                              >
                                <Minus className="h-4 w-4" />
                              </Button>
                              <Input
                                id={`equipment-qty-${equipmentKey(line)}`}
                                className="w-24 text-center"
                                type="number"
                                min={line.returnable ? 1 : 0.001}
                                step={line.returnable ? 1 : 0.001}
                                value={current.quantity}
                                disabled={save.isPending}
                                onChange={(e) =>
                                  setChoices({
                                    ...choices,
                                    [equipmentKey(line)]: {
                                      ...current,
                                      quantity: Number(e.target.value),
                                    },
                                  })
                                }
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                disabled={save.isPending}
                                aria-label={`زيادة كمية ${line.name}`}
                                onClick={() =>
                                  setChoices({
                                    ...choices,
                                    [equipmentKey(line)]: {
                                      ...current,
                                      quantity:
                                        Math.round(
                                          (current.quantity + 1) * 1000,
                                        ) / 1000,
                                    },
                                  })
                                }
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-3 text-sm">
                          <span>المتاح: {line.available}</span>
                          <span>المحجوز: {line.reserved}</span>
                          {!line.alreadyImported &&
                          current.quantity > line.available ? (
                            <span className="flex items-center gap-1 text-destructive">
                              <AlertTriangle className="h-4 w-4" /> الناقص:{" "}
                              {Math.max(0, current.quantity - line.available)}
                            </span>
                          ) : null}
                        </div>
                        {!line.alreadyImported ? (
                          <label className="block space-y-1 text-sm">
                            ملاحظة لهذا الحجز
                            <Input
                              maxLength={2000}
                              value={current.notes}
                              disabled={save.isPending}
                              onChange={(e) =>
                                setChoices({
                                  ...choices,
                                  [equipmentKey(line)]: {
                                    ...current,
                                    notes: e.target.value,
                                  },
                                })
                              }
                            />
                          </label>
                        ) : null}
                      </article>
                    );
                  })}
              </div>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={
                  save.isPending ||
                  selected.length === 0 ||
                  selected.some(
                    (l) =>
                      !(choice(l).quantity > 0) ||
                      choice(l).quantity > l.available ||
                      (l.returnable && !Number.isInteger(choice(l).quantity)),
                  )
                }
                onClick={() => save.mutate()}
              >
                {save.isPending
                  ? "جاري تأكيد الحجز..."
                  : `تأكيد استيراد المعدات (${selected.length})`}
              </Button>
              <p className="text-xs text-muted-foreground">
                التوفر يُفحص مجدداً من الخادم عند التأكيد. الإخراج والإرجاع من
                مسار المستودع الحالي.
              </p>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
