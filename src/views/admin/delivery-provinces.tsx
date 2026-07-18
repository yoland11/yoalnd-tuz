import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, MapPin, Plus, Save, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, formatCurrency, hasPerm, type AdminMe } from "./_lib";
import { EmptyState } from "./_layout";

export type Province = {
  id: number;
  governorate: string;
  governorateAr: string;
  areas: string[];
  price: number;
  expressFee: number;
  sameDayFee: number;
  codFee: number;
  freeDeliveryThreshold: number;
  maxWeight: number;
  estimatedDays: number;
  deliveryCompany: string | null;
  sortOrder: number;
  notes: string | null;
  isActive: boolean;
};

export const provincesQueryKey = ["admin", "delivery", "provinces"] as const;

export function useProvinces(activeOnly = false) {
  return useQuery<Province[]>({
    queryKey: [...provincesQueryKey, activeOnly],
    queryFn: () => adminFetch(`/admin/delivery/provinces${activeOnly ? "?activeOnly=1" : ""}`),
    staleTime: 5 * 60 * 1000,
  });
}

type Draft = Record<string, string | boolean | string[]>;

const NUMERIC_FIELDS: Array<{ key: keyof Province; label: string; hint?: string }> = [
  { key: "price", label: "أجور التوصيل الافتراضية" },
  { key: "expressFee", label: "أجور التوصيل السريع", hint: "0 = يستخدم السعر الافتراضي" },
  { key: "sameDayFee", label: "أجور توصيل نفس اليوم", hint: "0 = يستخدم السعر الافتراضي" },
  { key: "codFee", label: "أجور الدفع عند الاستلام" },
  { key: "freeDeliveryThreshold", label: "حد التوصيل المجاني", hint: "0 = معطّل" },
  { key: "maxWeight", label: "أقصى وزن (كغم)", hint: "0 = غير محدود" },
];

export default function DeliveryProvinces({ me }: { me: AdminMe | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: provinces, isLoading } = useProvinces(false);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  const canManage = hasPerm(me, "delivery") || hasPerm(me, "delivery_provinces_manage");
  const canPrice = hasPerm(me, "delivery") || hasPerm(me, "delivery_pricing_manage");
  const canEdit = canManage || canPrice;

  const sorted = useMemo(
    () =>
      [...(provinces ?? [])].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.governorateAr.localeCompare(b.governorateAr, "ar"),
      ),
    [provinces],
  );

  function invalidate() {
    qc.invalidateQueries({ queryKey: provincesQueryKey });
  }

  const saveProvince = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
      adminFetch(`/admin/delivery/provinces/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: (_data, vars) => {
      invalidate();
      setDrafts((d) => {
        const next = { ...d };
        delete next[vars.id];
        return next;
      });
      toast({ title: "تم حفظ المحافظة" });
    },
    onError: (err: any) =>
      toast({ title: "تعذر حفظ المحافظة", description: err?.message, variant: "destructive" }),
  });

  const createProvince = useMutation({
    mutationFn: (governorateAr: string) =>
      adminFetch("/admin/delivery/provinces", {
        method: "POST",
        body: JSON.stringify({ governorateAr, sortOrder: sorted.length }),
      }),
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      setNewName("");
      toast({ title: "تمت إضافة المحافظة" });
    },
    onError: (err: any) =>
      toast({ title: "تعذر إضافة المحافظة", description: err?.message, variant: "destructive" }),
  });

  const reorder = useMutation({
    mutationFn: (ids: number[]) =>
      adminFetch("/admin/delivery/provinces/reorder", { method: "POST", body: JSON.stringify({ ids }) }),
    onSuccess: invalidate,
    onError: (err: any) =>
      toast({ title: "تعذر إعادة الترتيب", description: err?.message, variant: "destructive" }),
  });

  function getDraft(p: Province): Draft {
    return (
      drafts[p.id] ?? {
        price: String(p.price),
        expressFee: String(p.expressFee),
        sameDayFee: String(p.sameDayFee),
        codFee: String(p.codFee),
        freeDeliveryThreshold: String(p.freeDeliveryThreshold),
        maxWeight: String(p.maxWeight),
        estimatedDays: String(p.estimatedDays),
        deliveryCompany: p.deliveryCompany ?? "",
        notes: p.notes ?? "",
        areas: p.areas ?? [],
        newArea: "",
      }
    );
  }

  function patchDraft(p: Province, patch: Draft) {
    setDrafts((d) => ({ ...d, [p.id]: { ...getDraft(p), ...patch } }));
  }

  function save(p: Province) {
    const d = getDraft(p);
    saveProvince.mutate({
      id: p.id,
      patch: {
        price: Number(d.price) || 0,
        expressFee: Number(d.expressFee) || 0,
        sameDayFee: Number(d.sameDayFee) || 0,
        codFee: Number(d.codFee) || 0,
        freeDeliveryThreshold: Number(d.freeDeliveryThreshold) || 0,
        maxWeight: Number(d.maxWeight) || 0,
        estimatedDays: Number(d.estimatedDays) || 0,
        deliveryCompany: String(d.deliveryCompany || "") || null,
        notes: String(d.notes || "") || null,
        areas: (d.areas as string[]) ?? [],
      },
    });
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...sorted];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate(next.map((p) => p.id));
  }

  return (
    <section className="bg-card rounded-xl border border-border/30 p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <MapPin className="w-4 h-4 text-primary" /> المحافظات وأجور التوصيل
        </h2>
        {canManage && (
          <Button size="sm" className="gap-2" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="w-4 h-4" /> إضافة محافظة
          </Button>
        )}
      </div>

      {showCreate && canManage && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-background/40 p-4 flex flex-col sm:flex-row gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) createProvince.mutate(newName.trim());
            }}
            placeholder="اسم المحافظة"
            className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!newName.trim() || createProvince.isPending}
              onClick={() => createProvince.mutate(newName.trim())}
            >
              حفظ
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : sorted.length === 0 ? (
        <EmptyState message="لا توجد محافظات" />
      ) : (
        <div className="space-y-2">
          {sorted.map((p, index) => {
            const d = getDraft(p);
            const dirty = drafts[p.id] !== undefined;
            const open = expanded === p.id;
            return (
              <div key={p.id} className="rounded-lg border border-border/20 bg-background/40 overflow-hidden">
                <div className="flex items-center gap-2 p-3 flex-wrap">
                  {canManage && (
                    <div className="flex flex-col">
                      <button
                        type="button"
                        aria-label="تحريك للأعلى"
                        disabled={index === 0 || reorder.isPending}
                        onClick={() => move(index, -1)}
                        className="text-muted-foreground hover:text-primary disabled:opacity-30"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="تحريك للأسفل"
                        disabled={index === sorted.length - 1 || reorder.isPending}
                        onClick={() => move(index, 1)}
                        className="text-muted-foreground hover:text-primary disabled:opacity-30"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : p.id)}
                    className="flex-1 min-w-[140px] text-right"
                  >
                    <p className="font-semibold text-foreground">{p.governorateAr}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(p.price)} • {p.estimatedDays} يوم
                      {p.deliveryCompany ? ` • ${p.deliveryCompany}` : ""}
                    </p>
                  </button>

                  <span
                    className={`text-[11px] px-2 py-1 rounded-full border ${
                      p.isActive
                        ? "bg-status-success/10 text-status-success border-status-success/30"
                        : "bg-status-danger/10 text-status-danger border-status-danger/30"
                    }`}
                  >
                    {p.isActive ? "نشط" : "معطل"}
                  </span>

                  {canManage && (
                    <label className="text-xs flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={p.isActive}
                        onChange={(e) => saveProvince.mutate({ id: p.id, patch: { isActive: e.target.checked } })}
                        className="accent-primary"
                      />
                      <span className="text-muted-foreground">تفعيل</span>
                    </label>
                  )}

                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : p.id)}
                    aria-label={open ? "طي" : "توسيع"}
                    className="text-muted-foreground hover:text-primary"
                  >
                    {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>

                {open && (
                  <div className="border-t border-border/20 p-3 sm:p-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {NUMERIC_FIELDS.map((field) => (
                        <label key={String(field.key)} className="block">
                          <span className="block text-xs text-muted-foreground mb-1">{field.label}</span>
                          <input
                            type="number"
                            min={0}
                            inputMode="decimal"
                            disabled={!canPrice}
                            value={String(d[field.key as string] ?? "")}
                            onChange={(e) => patchDraft(p, { [field.key as string]: e.target.value })}
                            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                          {field.hint && (
                            <span className="block text-[11px] text-muted-foreground mt-1">{field.hint}</span>
                          )}
                        </label>
                      ))}
                      <label className="block">
                        <span className="block text-xs text-muted-foreground mb-1">مدة التوصيل (يوم)</span>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          disabled={!canEdit}
                          value={String(d.estimatedDays ?? "")}
                          onChange={(e) => patchDraft(p, { estimatedDays: e.target.value })}
                          className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-xs text-muted-foreground mb-1">شركة التوصيل</span>
                        <input
                          disabled={!canEdit}
                          value={String(d.deliveryCompany ?? "")}
                          onChange={(e) => patchDraft(p, { deliveryCompany: e.target.value })}
                          className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </label>
                    </div>

                    <label className="block">
                      <span className="block text-xs text-muted-foreground mb-1">ملاحظات</span>
                      <textarea
                        rows={2}
                        disabled={!canEdit}
                        value={String(d.notes ?? "")}
                        onChange={(e) => patchDraft(p, { notes: e.target.value })}
                        className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </label>

                    <div>
                      <span className="block text-xs text-muted-foreground mb-1.5">الأقضية / المناطق</span>
                      <AreaEditor
                        disabled={!canEdit}
                        areas={(d.areas as string[]) ?? []}
                        value={String(d.newArea ?? "")}
                        onChangeValue={(v) => patchDraft(p, { newArea: v })}
                        onAdd={() => {
                          const v = String(d.newArea ?? "").trim();
                          if (v) patchDraft(p, { areas: [...((d.areas as string[]) ?? []), v], newArea: "" });
                        }}
                        onRemove={(i) =>
                          patchDraft(p, { areas: ((d.areas as string[]) ?? []).filter((_, idx) => idx !== i) })
                        }
                      />
                    </div>

                    {canEdit && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={!dirty || saveProvince.isPending}
                          onClick={() => save(p)}
                        >
                          <Save className="w-3.5 h-3.5" /> حفظ
                        </Button>
                        {dirty && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setDrafts((x) => {
                                const next = { ...x };
                                delete next[p.id];
                                return next;
                              })
                            }
                          >
                            تراجع
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!canEdit && (
        <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
          <Truck className="w-3.5 h-3.5" /> لا تملك صلاحية تعديل المحافظات أو التسعير.
        </p>
      )}
    </section>
  );
}

function AreaEditor({
  areas, value, onChangeValue, onAdd, onRemove, disabled,
}: {
  areas: string[];
  value: string;
  onChangeValue: (v: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input
          value={value}
          disabled={disabled}
          onChange={(e) => onChangeValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder="أضف قضاء / منطقة..."
          className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={onAdd}
          className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs hover:bg-primary/20 disabled:opacity-50"
        >
          + إضافة
        </button>
      </div>
      {areas.length > 0 ? (
        <div className="flex gap-1.5 flex-wrap">
          {areas.map((a, i) => (
            <span
              key={`${a}-${i}`}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20"
            >
              {a}
              {!disabled && (
                <button type="button" onClick={() => onRemove(i)} className="hover:text-status-danger" aria-label="حذف">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">لا توجد مناطق</p>
      )}
    </div>
  );
}
