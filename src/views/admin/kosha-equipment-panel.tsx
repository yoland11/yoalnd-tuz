import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Save, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  equipmentKey,
  normalizeEquipment,
  type KoshaEquipmentLine,
} from "@/lib/kosha-equipment";
import { adminFetch } from "./_lib";

type Line = KoshaEquipmentLine & { name: string; imageUrl?: string | null };
type Catalog = {
  id: number;
  name: string;
  imageUrl?: string | null;
  stock: number;
  variants: Array<{ id: number; name: string; stock: number }>;
};

export function KoshaEquipmentPanel({ koshaId }: { koshaId: number }) {
  const client = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [draft, setDraft] = useState<Line[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const path = `/admin/koshas/${koshaId}/equipment`;
  const key = ["admin", "kosha-equipment", koshaId];
  const template = useQuery<{ items: Line[] }>({
    queryKey: key,
    queryFn: () => adminFetch(path),
  });
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const catalog = useQuery<{ items: Catalog[] }>({
    queryKey: [...key, "catalog", debounced],
    queryFn: () =>
      adminFetch(`${path}/catalog?q=${encodeURIComponent(debounced)}`),
    enabled: open,
  });
  const lines = draft ?? template.data?.items ?? [];
  const save = useMutation({
    mutationFn: () =>
      adminFetch(path, {
        method: "PUT",
        body: JSON.stringify({ items: normalizeEquipment(lines) }),
      }),
    onSuccess: async () => {
      setDirty(false);
      setDraft(null);
      await client.invalidateQueries({ queryKey: key });
      toast({ title: "تم حفظ قائمة معدات الكوشة" });
    },
    onError: (error: Error) =>
      toast({
        title: "تعذر حفظ المعدات",
        description: error.message,
        variant: "destructive",
      }),
  });
  const change = (next: Line[]) => {
    setDraft(next);
    setDirty(true);
  };
  const patch = (index: number, value: Partial<Line>) => {
    if (save.isPending) return;
    change(
      lines.map((line, i) => (i === index ? { ...line, ...value } : line)),
    );
  };
  function add(product: Catalog, variantId: number | null) {
    const next: Line = {
      productId: product.id,
      variantId,
      name: product.name,
      imageUrl: product.imageUrl,
      quantity: 1,
      unit: "قطعة",
      returnable: true,
      required: true,
      notes: "",
    };
    if (
      save.isPending ||
      lines.some((l) => equipmentKey(l) === equipmentKey(next))
    )
      return;
    change([...lines, next]);
  }
  return (
    <section
      className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5"
      dir="rtl"
      aria-label="المعدات والمواد"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Package className="h-5 w-5 text-primary" /> المعدات والمواد
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            معدات مشتركة من المخزن. حفظ القالب لا يحجز ولا يخصم المخزون.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setOpen(!open)}>
          <Plus className="ml-2 h-4 w-4" /> إدارة معدات الكوشة
        </Button>
      </header>
      {template.isPending ? (
        <p role="status">جاري تحميل المعدات...</p>
      ) : template.error ? (
        <div role="alert" className="text-destructive">
          تعذر تحميل المعدات: {(template.error as Error).message}{" "}
          <Button
            type="button"
            variant="outline"
            onClick={() => template.refetch()}
          >
            إعادة المحاولة
          </Button>
        </div>
      ) : (
        <>
          {open ? (
            <div className="space-y-3 rounded-xl bg-muted/30 p-3">
              <label className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ابحث عن المعدات أو المواد بالاسم والباركود..."
                  aria-label="بحث معدات المخزن"
                />
              </label>
              {catalog.isPending ? (
                <p role="status">جاري البحث...</p>
              ) : catalog.error ? (
                <p role="alert" className="text-destructive">
                  تعذر تحميل مواد المخزن: {(catalog.error as Error).message}
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {catalog.data?.items.map((product) => (
                    <article
                      key={product.id}
                      className="flex gap-3 rounded-xl border bg-card p-3"
                    >
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt=""
                          loading="lazy"
                          className="h-14 w-14 rounded-xl object-cover"
                        />
                      ) : (
                        <Package className="h-14 w-14 rounded-xl bg-muted p-3 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <b className="block break-words text-sm">
                          {product.name}
                        </b>
                        <small className="text-muted-foreground">
                          المخزون: {product.stock}
                        </small>
                        {product.variants.length ? (
                          <select
                            aria-label={`اختر متغير ${product.name}`}
                            value=""
                            onChange={(e) =>
                              add(product, Number(e.target.value))
                            }
                            className="mt-1 min-h-10 w-full rounded-lg border bg-background p-2 text-sm"
                          >
                            <option value="">إضافة متغير...</option>
                            {product.variants.map((v) => (
                              <option
                                key={v.id}
                                value={v.id}
                                disabled={lines.some(
                                  (l) =>
                                    l.productId === product.id &&
                                    l.variantId === v.id,
                                )}
                              >
                                {v.name || v.id} · {v.stock}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-1 w-full"
                            onClick={() => add(product, null)}
                            disabled={lines.some(
                              (l) =>
                                l.productId === product.id &&
                                l.variantId === null,
                            )}
                          >
                            إضافة
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          {!lines.length ? (
            <p className="rounded-xl bg-muted/30 p-6 text-center text-muted-foreground">
              لم تُضف معدات للكوشة بعد.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {lines.map((line, index) => (
                <article
                  key={equipmentKey(line)}
                  className="space-y-3 rounded-xl border p-3"
                >
                  <header className="flex items-center gap-3">
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
                    <div className="min-w-0 flex-1">
                      <b className="break-words">{line.name}</b>
                      {line.variantId ? (
                        <small className="block text-muted-foreground">
                          متغير #{line.variantId}
                        </small>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`إزالة ${line.name} من القالب`}
                      disabled={save.isPending}
                      onClick={() =>
                        change(lines.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </header>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-sm">
                      الكمية الافتراضية
                      <Input
                        type="number"
                        min={line.returnable ? 1 : 0.001}
                        step={line.returnable ? 1 : 0.001}
                        value={line.quantity}
                        onChange={(e) =>
                          patch(index, { quantity: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      الوحدة
                      <Input
                        maxLength={40}
                        value={line.unit}
                        onChange={(e) => patch(index, { unit: e.target.value })}
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      نوع المادة
                      <select
                        className="min-h-10 w-full rounded-lg border bg-background p-2"
                        value={line.returnable ? "returnable" : "consumable"}
                        onChange={(e) =>
                          patch(index, {
                            returnable: e.target.value === "returnable",
                          })
                        }
                      >
                        <option value="returnable">معدات قابلة للإرجاع</option>
                        <option value="consumable">مواد مستهلكة</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={line.required}
                        onChange={(e) =>
                          patch(index, { required: e.target.checked })
                        }
                      />{" "}
                      مطلوب
                    </label>
                  </div>
                  <label className="block space-y-1 text-sm">
                    ملاحظات
                    <Input
                      maxLength={2000}
                      value={line.notes}
                      onChange={(e) => patch(index, { notes: e.target.value })}
                    />
                  </label>
                </article>
              ))}
            </div>
          )}
          <Button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
            className="w-full sm:w-auto"
          >
            <Save className="ml-2 h-4 w-4" />{" "}
            {save.isPending ? "جاري الحفظ..." : "حفظ قائمة المعدات"}
          </Button>
        </>
      )}
    </section>
  );
}
