import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListOrders, useListDeliveryZones, useUpdateDeliveryZone, useCreateDeliveryZone, getListDeliveryZonesQueryKey } from "@workspace/api-client-react";
import { MapPin, ExternalLink, Truck, Plus, X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import { formatIraqiPhone } from "@/lib/phone";

const STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار", confirmed: "مؤكد", processing: "قيد التجهيز",
  shipped: "في الطريق", delivered: "تم التوصيل", cancelled: "ملغي",
};

type ZoneDraft = {
  price: string;
  estimatedDays: string;
  isActive: boolean;
  areas: string[];
  newArea: string;
};

export default function DeliveryPage() {
  const qc = useQueryClient();
  const { data: zones, isLoading: zLoading } = useListDeliveryZones();
  const { data: orders, isLoading: oLoading } = useListOrders({});
  const updateZone = useUpdateDeliveryZone();
  const createZone = useCreateDeliveryZone();
  const [drafts, setDrafts] = useState<Record<number, ZoneDraft>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newZone, setNewZone] = useState({ governorateAr: "", governorate: "", price: "5000", estimatedDays: "2", areas: [] as string[], newArea: "" });

  const deliveryOrders = (orders ?? []).filter(o => o.status !== "delivered" && o.status !== "cancelled");

  function getDraft(id: number): ZoneDraft {
    const z = zones?.find(x => x.id === id);
    return drafts[id] ?? {
      price: String(z?.price ?? 0),
      estimatedDays: String(z?.estimatedDays ?? 2),
      isActive: z?.isActive ?? true,
      areas: (z?.areas ?? []) as string[],
      newArea: "",
    };
  }
  function patchDraft(id: number, patch: Partial<ZoneDraft>) {
    setDrafts(d => ({ ...d, [id]: { ...getDraft(id), ...patch } }));
  }
  async function saveDraft(id: number) {
    const d = getDraft(id);
    await updateZone.mutateAsync({ id, data: {
      price: parseFloat(d.price) || 0,
      estimatedDays: parseInt(d.estimatedDays) || 1,
      isActive: d.isActive,
      areas: d.areas,
    }});
    qc.invalidateQueries({ queryKey: getListDeliveryZonesQueryKey() });
    setDrafts(rest => { const c = { ...rest }; delete c[id]; return c; });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">إدارة التوصيل</h1>
        <Button onClick={() => setShowCreate(v => !v)} size="sm" className="gap-2">
          <Plus className="w-4 h-4" /> إضافة منطقة
        </Button>
      </div>

      {showCreate && (
        <section className="bg-card rounded-xl border border-primary/30 p-6 space-y-3">
          <h2 className="font-semibold text-foreground">منطقة جديدة</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input placeholder="المحافظة (عربي) *" value={newZone.governorateAr}
              onChange={e => setNewZone(z => ({ ...z, governorateAr: e.target.value, governorate: z.governorate || e.target.value }))}
              className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Governorate (en)" value={newZone.governorate}
              onChange={e => setNewZone(z => ({ ...z, governorate: e.target.value }))}
              className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
            <input type="number" placeholder="السعر" value={newZone.price}
              onChange={e => setNewZone(z => ({ ...z, price: e.target.value }))}
              className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
            <input type="number" placeholder="عدد الأيام" value={newZone.estimatedDays}
              onChange={e => setNewZone(z => ({ ...z, estimatedDays: e.target.value }))}
              className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">المناطق الفرعية</label>
            <AreaEditor areas={newZone.areas} value={newZone.newArea}
              onChangeValue={v => setNewZone(z => ({ ...z, newArea: v }))}
              onAdd={() => setNewZone(z => z.newArea.trim() ? { ...z, areas: [...z.areas, z.newArea.trim()], newArea: "" } : z)}
              onRemove={i => setNewZone(z => ({ ...z, areas: z.areas.filter((_, idx) => idx !== i) }))} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={async () => {
              if (!newZone.governorateAr) return;
              await createZone.mutateAsync({ data: {
                governorate: newZone.governorate || newZone.governorateAr,
                governorateAr: newZone.governorateAr,
                price: parseFloat(newZone.price) || 0,
                estimatedDays: parseInt(newZone.estimatedDays) || 1,
                areas: newZone.areas,
                isActive: true,
              }});
              qc.invalidateQueries({ queryKey: getListDeliveryZonesQueryKey() });
              setShowCreate(false);
              setNewZone({ governorateAr: "", governorate: "", price: "5000", estimatedDays: "2", areas: [], newArea: "" });
            }}>حفظ</Button>
            <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>إلغاء</Button>
          </div>
        </section>
      )}

      <section className="bg-card rounded-xl border border-border/30 p-6">
        <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" /> مناطق التوصيل</h2>
        {zLoading ? <Skeleton className="h-40 rounded-lg" /> : !zones || zones.length === 0 ? <EmptyState message="لا توجد مناطق" /> : (
          <div className="space-y-3">
            {zones.map(z => {
              const d = getDraft(z.id);
              const dirty = drafts[z.id] !== undefined;
              return (
                <div key={z.id} className="bg-background/40 rounded-lg p-4 border border-border/20 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <p className="font-semibold text-foreground">{z.governorateAr ?? z.governorate}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                        السعر:
                        <input type="number" value={d.price} onChange={e => patchDraft(z.id, { price: e.target.value })}
                          className="bg-background border border-border/40 rounded px-2 py-1 text-sm w-24" />
                        <span className="text-primary">{formatCurrency(parseFloat(d.price) || 0)}</span>
                      </label>
                      <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                        المدة:
                        <input type="number" value={d.estimatedDays} onChange={e => patchDraft(z.id, { estimatedDays: e.target.value })}
                          className="bg-background border border-border/40 rounded px-2 py-1 text-sm w-16" />
                        يوم
                      </label>
                      <label className="text-xs flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={d.isActive} onChange={e => patchDraft(z.id, { isActive: e.target.checked })} className="accent-primary" />
                        <span className={d.isActive ? "text-green-400" : "text-red-400"}>{d.isActive ? "نشط" : "معطل"}</span>
                      </label>
                      {dirty && (
                        <Button size="sm" onClick={() => saveDraft(z.id)} className="gap-1.5"><Save className="w-3.5 h-3.5" /> حفظ</Button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1.5">المناطق الفرعية</label>
                    <AreaEditor areas={d.areas} value={d.newArea}
                      onChangeValue={v => patchDraft(z.id, { newArea: v })}
                      onAdd={() => d.newArea.trim() && patchDraft(z.id, { areas: [...d.areas, d.newArea.trim()], newArea: "" })}
                      onRemove={i => patchDraft(z.id, { areas: d.areas.filter((_, idx) => idx !== i) })} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="bg-card rounded-xl border border-border/30 p-6">
        <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Truck className="w-4 h-4 text-primary" /> الطلبات قيد التوصيل ({deliveryOrders.length})</h2>
        {oLoading ? <Skeleton className="h-40 rounded-lg" /> : deliveryOrders.length === 0 ? <EmptyState message="لا توجد طلبات قيد التوصيل" /> : (
          <div className="space-y-3">
            {deliveryOrders.map(o => {
              const area = o.area ?? null;
              const mapsUrl = (o as { mapsUrl?: string | null }).mapsUrl ?? null;
              const fallbackQuery = [o.governorate, area, o.address].filter(Boolean).join(" ");
              const fallbackMaps = fallbackQuery ? `https://www.google.com/maps/search/${encodeURIComponent(fallbackQuery)}` : null;
              const finalMaps = mapsUrl || fallbackMaps;
              return (
                <div key={o.id} className="bg-background/40 rounded-lg p-4 border border-border/20">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex-1 min-w-[200px]">
                      <p className="font-mono text-sm font-bold text-foreground">{o.trackingCode}</p>
                      <p className="text-sm text-foreground">
                        {o.customerName} —{" "}
                        <a href={`tel:${formatIraqiPhone(o.customerPhone)}`} className="text-primary hover:underline">{formatIraqiPhone(o.customerPhone)}</a>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[o.governorate, area].filter(Boolean).join(" • ") || "—"}
                        {o.address ? ` • ${o.address}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">{STATUS_LABELS[o.status] ?? o.status}</span>
                      <span className="text-primary font-bold">{formatCurrency(o.total)}</span>
                      {finalMaps && (
                        <a href={finalMaps} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20">
                          <MapPin className="w-3.5 h-3.5" /> الخارطة <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function AreaEditor({ areas, value, onChangeValue, onAdd, onRemove }: {
  areas: string[]; value: string; onChangeValue: (v: string) => void; onAdd: () => void; onRemove: (i: number) => void;
}) {
  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input value={value} onChange={e => onChangeValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
          placeholder="أضف منطقة..."
          className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-primary/50" />
        <button type="button" onClick={onAdd} className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs hover:bg-primary/20">+ إضافة</button>
      </div>
      {areas.length > 0 ? (
        <div className="flex gap-1.5 flex-wrap">
          {areas.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
              {a}
              <button type="button" onClick={() => onRemove(i)} className="hover:text-red-400"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      ) : <p className="text-xs text-muted-foreground">لا توجد مناطق فرعية</p>}
    </div>
  );
}
