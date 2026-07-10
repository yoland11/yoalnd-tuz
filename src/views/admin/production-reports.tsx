import { useQuery } from "@tanstack/react-query";
import { BarChart3, ArrowRight, Boxes, Users, Wrench, TrendingUp, Package, CalendarDays } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";

type Reports = {
  summary: {
    totalOrders: number; activeOrders: number; deliveredCount: number; cancelledCount: number;
    totalUnits: number; totalMaterial: number; totalLabor: number; totalEquipment: number;
    totalCost: number; totalRevenue: number; totalProfit: number; profitMargin: number; efficiency: number;
  };
  daily: Array<{ date: string; orders: number; units: number; cost: number; revenue: number; profit: number }>;
  monthly: Array<{ month: string; orders: number; units: number; cost: number; revenue: number; profit: number; labor: number; equipment: number }>;
  materialConsumption: Array<{ productId: number; name: string; quantity: number; cost: number }>;
  mostUsedMaterials: Array<{ productId: number; name: string; quantity: number; cost: number }>;
  profitPerProduct: Array<{ productId: number; name: string; units: number; revenue: number; cost: number; profit: number; margin: number }>;
  profitPerBooking: Array<{ bookingType: string; bookingId: number; orders: number; revenue: number; cost: number; profit: number }>;
  laborCostReport: { total: number; byMonth: Array<{ month: string; labor: number }> };
  equipmentCostReport: { total: number; byMonth: Array<{ month: string; equipment: number }> };
  reorderList: Array<{ productId: number; name: string; stock: number; minStock: number; suggested: number }>;
};

export default function ProductionReportsPage() {
  const { data, isLoading } = useQuery<Reports>({
    queryKey: ["admin", "production-reports"],
    queryFn: () => adminFetch("/admin/production/reports"),
  });

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" /> تقارير الإنتاج
          </h1>
          <p className="text-sm text-muted-foreground mt-1">لوحات الإنتاج اليومي والشهري، استهلاك المواد، الأرباح، العمالة والمعدات، وكفاءة الإنتاج.</p>
        </div>
        <Link href="/admin/production">
          <Button variant="outline" className="gap-2"><ArrowRight className="w-4 h-4" /> أوامر الإنتاج</Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : !data ? (
        <EmptyState message="تعذر تحميل التقارير." />
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard icon={Package} label="إجمالي الأوامر" value={String(data.summary.totalOrders)} sub={`${data.summary.activeOrders} نشط`} />
            <SummaryCard icon={Boxes} label="وحدات مُنتَجة" value={String(data.summary.totalUnits)} />
            <SummaryCard icon={TrendingUp} label="صافي الربح" value={formatCurrency(data.summary.totalProfit)} sub={`هامش ${data.summary.profitMargin.toFixed(1)}%`} tone={data.summary.totalProfit >= 0 ? "ok" : "bad"} />
            <SummaryCard icon={CalendarDays} label="كفاءة التسليم" value={`${data.summary.efficiency.toFixed(0)}%`} sub={`${data.summary.deliveredCount} مُسلّم · ${data.summary.cancelledCount} ملغي`} />
            <SummaryCard icon={Boxes} label="تكلفة المواد" value={formatCurrency(data.summary.totalMaterial)} />
            <SummaryCard icon={Users} label="تكلفة العمالة" value={formatCurrency(data.summary.totalLabor)} />
            <SummaryCard icon={Wrench} label="تكلفة المعدات" value={formatCurrency(data.summary.totalEquipment)} />
            <SummaryCard icon={TrendingUp} label="إجمالي الإيراد" value={formatCurrency(data.summary.totalRevenue)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Daily */}
            <Panel title="📅 الإنتاج اليومي (آخر 30 يوم)">
              {data.daily.length === 0 ? <Empty /> : (
                <BarList items={data.daily.map((d) => ({ label: d.date, value: d.units, meta: `${d.orders} أمر · ${formatCurrency(d.profit)}` }))} />
              )}
            </Panel>

            {/* Monthly */}
            <Panel title="🗓 الإنتاج الشهري (آخر 12 شهر)">
              {data.monthly.length === 0 ? <Empty /> : (
                <BarList items={data.monthly.map((m) => ({ label: m.month, value: m.units, meta: `${formatCurrency(m.revenue)} إيراد · ${formatCurrency(m.profit)} ربح` }))} />
              )}
            </Panel>

            {/* Most used materials */}
            <Panel title="🔥 المواد الأكثر استهلاكاً">
              {data.mostUsedMaterials.length === 0 ? <Empty /> : (
                <BarList items={data.mostUsedMaterials.map((m) => ({ label: m.name, value: m.quantity, meta: formatCurrency(m.cost) }))} />
              )}
            </Panel>

            {/* Material consumption table */}
            <Panel title="📦 استهلاك المواد">
              {data.materialConsumption.length === 0 ? <Empty /> : (
                <Table head={["المادة", "الكمية", "التكلفة"]} rows={data.materialConsumption.slice(0, 15).map((m) => [m.name, String(m.quantity), formatCurrency(m.cost)])} />
              )}
            </Panel>

            {/* Profit per product */}
            <Panel title="💰 الربح لكل منتج">
              {data.profitPerProduct.length === 0 ? <Empty /> : (
                <Table head={["المنتج", "وحدات", "إيراد", "ربح", "هامش"]} rows={data.profitPerProduct.slice(0, 15).map((p) => [p.name, String(p.units), formatCurrency(p.revenue), formatCurrency(p.profit), `${p.margin.toFixed(0)}%`])} />
              )}
            </Panel>

            {/* Profit per booking */}
            <Panel title="🎊 الربح لكل حجز">
              {data.profitPerBooking.length === 0 ? <Empty /> : (
                <Table head={["الحجز", "أوامر", "إيراد", "ربح"]} rows={data.profitPerBooking.map((b) => [`${b.bookingType}#${b.bookingId}`, String(b.orders), formatCurrency(b.revenue), formatCurrency(b.profit)])} />
              )}
            </Panel>

            {/* Labor cost report */}
            <Panel title="👷 تقرير تكلفة العمالة">
              <p className="text-xs text-muted-foreground mb-2">الإجمالي: <span className="font-bold text-foreground">{formatCurrency(data.laborCostReport.total)}</span></p>
              {data.laborCostReport.byMonth.length === 0 ? <Empty /> : (
                <BarList items={data.laborCostReport.byMonth.map((m) => ({ label: m.month, value: m.labor, meta: formatCurrency(m.labor) }))} money />
              )}
            </Panel>

            {/* Reorder alerts */}
            <Panel title="🛒 تنبيهات إعادة الطلب">
              {data.reorderList.length === 0 ? (
                <p className="text-xs text-status-success py-2">✅ كل المواد فوق الحد الأدنى.</p>
              ) : (
                <Table head={["المادة", "المخزون", "الحد الأدنى", "اطلب"]} rows={data.reorderList.slice(0, 15).map((m) => [m.name, String(m.stock), String(m.minStock), String(m.suggested)])} />
              )}
            </Panel>

            {/* Equipment cost report */}
            <Panel title="🚚 تقرير تكلفة المعدات">
              <p className="text-xs text-muted-foreground mb-2">الإجمالي: <span className="font-bold text-foreground">{formatCurrency(data.equipmentCostReport.total)}</span></p>
              {data.equipmentCostReport.byMonth.length === 0 ? <Empty /> : (
                <BarList items={data.equipmentCostReport.byMonth.map((m) => ({ label: m.month, value: m.equipment, meta: formatCurrency(m.equipment) }))} money />
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub?: string; tone?: "ok" | "bad" }) {
  const color = tone === "ok" ? "text-status-success" : tone === "bad" ? "text-status-danger" : "text-foreground";
  return (
    <div className="bg-card rounded-xl border border-border/30 p-3">
      <div className="flex items-center gap-2 text-muted-foreground"><Icon className="w-4 h-4" /><span className="text-[11px]">{label}</span></div>
      <p className={`mt-1.5 text-lg font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border/30 p-4">
      <h2 className="text-sm font-semibold text-foreground mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-muted-foreground py-4 text-center">لا توجد بيانات بعد.</p>;
}

function BarList({ items, money }: { items: Array<{ label: string; value: number; meta?: string }>; money?: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="text-xs">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-foreground truncate">{it.label}</span>
            <span className="text-muted-foreground shrink-0">{it.meta ?? (money ? formatCurrency(it.value) : it.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, (it.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b border-border/30">
            {head.map((h, i) => <th key={i} className={`py-1.5 font-medium ${i === 0 ? "text-right" : "text-center"}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-border/15">
              {r.map((c, ci) => <td key={ci} className={`py-1.5 ${ci === 0 ? "text-right text-foreground" : "text-center text-muted-foreground"}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
