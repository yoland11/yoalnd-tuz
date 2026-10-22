import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  CalendarRange,
  ChevronDown,
  ClipboardList,
  FileDown,
  History,
  Info,
  Loader2,
  Package,
  PackageCheck,
  Pencil,
  Printer,
  QrCode,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { exportReport, type ReportColumn } from "@/lib/pdf-report";
import { PRODUCT_KIND_LABELS, type ProductKind } from "@/lib/product-insights";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import { QuantityAssetPanel } from "./quantity-asset-panel";
import { CreateWorkOrderDialog } from "@/components/work-commands/create-order-dialog";
import { useWorkMe } from "@/components/work-commands/shared";

type Channel = {
  quantity: number;
  invoices: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  cogs: number | null;
  grossProfit: number | null;
  margin: number | null;
  returnsQuantity: number;
  returnsValue: number;
};
type Movement = {
  id: number;
  createdAt: string | null;
  label: string;
  quantityIn: number;
  quantityOut: number;
  balanceAfter: number;
  reference: { label: string; href: string | null } | null;
  warehouse: string | null;
  employee: string | null;
  note: string | null;
};
type Insights = {
  product: {
    id: number;
    name: string;
    nameEn: string | null;
    barcode: string | null;
    code: string;
    category: string | null;
    unit: string;
    kind: ProductKind;
    price: number;
    wholesalePrice: number | null;
    costPrice: number | null;
    margin: number | null;
    isActive: boolean;
    isRental: boolean;
    isAsset: boolean;
    description: string | null;
    imageCount: number;
    createdAt: string | null;
    sharedStockProductId: number | null;
  };
  access: { finance: boolean; customers: boolean };
  range: { from: string; to: string };
  kpis: {
    purchasedQuantity: number | null;
    soldQuantity: number;
    bundleQuantity: number;
    stock: number;
    availableQuantity: number;
    reservedQuantity: number;
    damagedQuantity: number;
    grossSales: number;
    netSales: number;
    cogs: number | null;
    grossProfit: number | null;
    margin: number | null;
    uncostedNetSales: number;
  };
  sales: {
    totals: Channel & { averagePrice: number | null; uncostedNetSales: number };
    retail: Channel;
    wholesale: Channel;
    online: Channel;
    bundles: { quantity: number; invoices: number };
    series: Array<{ period: string; quantity: number; net: number; cogs: number | null }>;
    customers: Array<{ customerId: number | null; name: string; quantity: number; invoices: number; net: number; lastDate: string | null }> | null;
    employees: Array<{ staffId: number | null; name: string; invoices: number; quantity: number; gross: number; net: number; returnsQuantity: number }> | null;
  };
  purchases: null | {
    quantity: number;
    value: number;
    attributableCosts: number;
    averageCost: number | null;
    averageLandedCost: number | null;
    latestCost: number | null;
    returnsQuantity: number;
    returnsValue: number;
    suppliers: Array<{ supplierId: number | null; name: string; quantity: number; value: number; returnsQuantity: number; latestPrice: number | null; averagePrice: number | null; lastDate: string | null; purchases: number }>;
    history: Array<{ invoiceId: number; invoiceNo: string; date: string; supplier: string; variantLabel: string | null; quantity: number; unitCost: number; total: number; status: string }>;
  };
  inventory: {
    stock: number;
    reserved: number;
    available: number;
    minStock: number;
    checkedOut: number | null;
    damaged: number;
    warehouses: Array<{ id: number; name: string; quantity: number }>;
    stockValue: number | null;
  };
  movements: { total: number; page: number; totalPages: number; data: Movement[] };
  variants: Array<{ id: number; name: string; sku: string | null; barcode: string | null; isActive: boolean; stock: number; reserved: number; available: number; purchased: number | null; sold: number; price: number | null; cost: number | null; revenue: number; grossProfit: number | null }>;
  prices: {
    changes: Array<{ at: string | null; employee: string | null; changes: Array<{ field: string; from: unknown; to: unknown; valuesRecorded: boolean }> }>;
    sellingByMonth: Array<{ month: string; averagePrice: number; minPrice: number; maxPrice: number }>;
  };
  timeline: Array<{ at: string | null; type: string; title: string; detail: string | null; href: string | null }>;
  intelligence: {
    slow: { ageDays: number | null; daysSinceSale: number | null; lastSaleDate: string | null; thresholdDays: number; velocityPerDay: number; isSlow: boolean; tooNew: boolean };
    forecast:
      | null
      | { sufficient: false; message: string }
      | { sufficient: true; averageDaily: number; windowDays: number; daysRemaining: number; leadTimeDays: number; reorderPoint: number; recommendedQuantity: number; reorderNow: boolean; seasonal: string | null };
    alerts: Array<{ key: string; level: "danger" | "warning" | "info"; title: string; reason: string; action?: { label: string; href: string } }>;
  };
  related: {
    bundles: Array<{ id: number; name: string; quantity: number; price: number; isActive: boolean }>;
    boughtTogether: Array<{ productId: number; name: string; invoices: number; quantity: number }>;
  };
  asset: null | {
    quantity: unknown;
    status: string;
    usageCount: number;
    expectedLifeUses: number | null;
    qrToken: string | null;
    serialNumber: string | null;
    location: string | null;
    warehouse: string | null;
    nextMaintenanceDate: string | null;
    bookingsUsed: number;
    activeBookings: number;
    bookings: Array<{ source: string; bookingId: number; day: string | null; customerName: string | null; required: number; outstanding: number; checkedOut: number; returned: number; stage: string }>;
    custody: Array<{ id: number; quantity: number; status: string; issuedAt: string | null; returnedAt: string | null; staff: string | null; notes: string | null }>;
    maintenanceHistory: Array<{ type: string; title: string; body: string | null; actor: string | null; at: string | null }>;
    finance: null | {
      acquisitionCost: number;
      currentValue: number;
      maintenanceCost: number;
      rentals: number;
      attributableRevenue: number;
      roi: { calculable: true; contribution: number; roi: number } | { calculable: false; reason: string };
    };
  };
};

type Preset = "all" | "today" | "week" | "month" | "year" | "custom";
const PRESETS: Array<[Preset, string]> = [
  ["all", "كل الفترة"],
  ["today", "اليوم"],
  ["week", "هذا الأسبوع"],
  ["month", "هذا الشهر"],
  ["year", "هذه السنة"],
  ["custom", "فترة مخصصة"],
];
const PRICE_FIELD_LABELS: Record<string, string> = {
  price: "سعر البيع",
  costPrice: "سعر التكلفة",
  wholesalePrice: "سعر الجملة",
  originalPrice: "السعر قبل الخصم",
};

const isoDay = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
function presetRange(preset: Preset, custom: { from: string; to: string }) {
  const today = isoDay(new Date());
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") return { from: isoDay(new Date(Date.now() - 6 * 86_400_000)), to: today };
  if (preset === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (preset === "custom") return { from: custom.from, to: custom.to };
  return { from: "", to: "" };
}
const qty = (value: number | null | undefined) =>
  value == null ? "—" : Number(value).toLocaleString("ar-IQ-u-nu-latn", { maximumFractionDigits: 3 });
const money = (value: number | null | undefined) => (value == null ? "—" : formatCurrency(value));
const percent = (value: number | null | undefined) => (value == null ? "—" : `${Number(value).toLocaleString("ar-IQ-u-nu-latn", { maximumFractionDigits: 1 })}%`);
const when = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "medium", timeStyle: value.length > 10 ? "short" : undefined }) : "—";
const compact = (value: number) =>
  Math.abs(value) >= 1_000_000 ? `${(value / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}M` : Math.abs(value) >= 1_000 ? `${(value / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K` : String(Math.round(value));

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-primary/15 bg-card p-4 shadow-sm ${className}`}>{children}</section>;
}
function SectionTitle({ icon: Icon, title, hint }: { icon: any; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-foreground"><Icon className="h-4 w-4 text-primary" /> {title}</h3>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" | "warn" }) {
  const toneClass = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-red-600 dark:text-red-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-foreground";
  return (
    <div className="rounded-xl border border-primary/15 bg-card p-3">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
function Table({ head, rows, empty, minWidth = 640 }: { head: string[]; rows: React.ReactNode[][]; empty: string; minWidth?: number }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border/40">
      <table className="w-full text-xs" style={{ minWidth }}>
        <thead className="bg-primary/5 text-muted-foreground">
          <tr>{head.map((label) => <th key={label} className="p-2 text-right font-semibold">{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {rows.map((cells, index) => (
            <tr key={index} className="hover:bg-primary/[0.03]">{cells.map((cell, cellIndex) => <td key={cellIndex} className="p-2 align-top">{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Net sales per period: one series, columns from a single baseline, hover tooltip. */
function SalesChart({ series, unit }: { series: Insights["sales"]["series"]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!series.length) return <p className="text-xs text-muted-foreground">لا توجد مبيعات في هذه الفترة.</p>;
  const width = 640;
  const height = 200;
  const pad = { top: 18, right: 40, bottom: 26, left: 8 };
  const max = Math.max(...series.map((point) => point.net), 0);
  const top = max <= 0 ? 1 : Math.pow(10, Math.floor(Math.log10(max))) * Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max))));
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const band = plotWidth / series.length;
  const barWidth = Math.max(2, Math.min(24, band - 2));
  const y = (value: number) => pad.top + plotHeight - (Math.max(0, value) / top) * plotHeight;
  const peak = series.reduce((best, point, index) => (point.net > series[best].net ? index : best), 0);
  const ticks = [0, top / 2, top];
  const hovered = hover === null ? null : series[hover];
  return (
    <div className="relative" dir="ltr">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full" role="img" aria-label="صافي المبيعات حسب الفترة">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="hsl(var(--border))" strokeWidth={1} />
            <text x={width - pad.right + 6} y={y(tick) + 4} fontSize={10} fill="hsl(var(--muted-foreground))">{compact(tick)}</text>
          </g>
        ))}
        {series.map((point, index) => {
          const x = pad.left + index * band + (band - barWidth) / 2;
          const top = y(point.net);
          const h = Math.max(0, pad.top + plotHeight - top);
          const r = Math.min(4, h, barWidth / 2);
          // Rounded data end, square at the baseline.
          const d = h <= 0 ? "" : `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barWidth - r} Q${x + barWidth},${top} ${x + barWidth},${top + r} V${top + h} Z`;
          return (
            <g key={point.period} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.left + index * band} y={pad.top} width={band} height={plotHeight} fill="transparent" />
              {d ? <path d={d} fill="hsl(var(--primary))" opacity={hover === null || hover === index ? 1 : 0.45} /> : null}
            </g>
          );
        })}
        {series[peak].net > 0 ? (
          <text x={pad.left + peak * band + band / 2} y={y(series[peak].net) - 5} fontSize={10} textAnchor="middle" fill="hsl(var(--foreground))">{compact(series[peak].net)}</text>
        ) : null}
        {[0, series.length - 1].filter((index, position, list) => list.indexOf(index) === position).map((index) => (
          <text key={index} x={pad.left + index * band + band / 2} y={height - 8} fontSize={10} textAnchor="middle" fill="hsl(var(--muted-foreground))">{series[index].period}</text>
        ))}
      </svg>
      {hovered ? (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-md" dir="rtl">
          <p className="font-semibold">{hovered.period}</p>
          <p>صافي المبيعات: {money(hovered.net)}</p>
          <p>الكمية: {qty(hovered.quantity)} {unit}</p>
          {hovered.cogs != null ? <p>الربح: {money(hovered.net - hovered.cogs)}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ChannelTable({ data, finance }: { data: Insights["sales"]; finance: boolean }) {
  const rows: Array<[string, Channel]> = [
    ["مبيعات المفرد", data.retail],
    ["مبيعات الجملة", data.wholesale],
    ["المتجر الإلكتروني", data.online],
  ];
  const perUnit = (channel: Channel) => (channel.grossProfit != null && channel.quantity > 0 ? channel.grossProfit / channel.quantity : null);
  const best = (pick: (channel: Channel) => number | null) =>
    rows.reduce<string | null>((winner, [label, channel]) => {
      const value = pick(channel);
      if (value == null || value <= 0) return winner;
      const current = winner ? pick(rows.find(([name]) => name === winner)![1]) : null;
      return current == null || value > current ? label : winner;
    }, null);
  return (
    <>
      <Table
        head={["القناة", "الكمية", "الفواتير", "الخصومات", "صافي الإيراد", ...(finance ? ["التكلفة", "مجمل الربح", "الهامش", "ربح القطعة"] : []), "المرتجع / الملغى"]}
        rows={rows.map(([label, channel]) => [
          <b key="l">{label}</b>,
          qty(channel.quantity),
          qty(channel.invoices),
          money(channel.discounts),
          money(channel.netSales),
          ...(finance
            ? [
                channel.cogs == null ? <span key="c" className="text-muted-foreground">غير مسجلة</span> : money(channel.cogs),
                money(channel.grossProfit),
                percent(channel.margin),
                money(perUnit(channel)),
              ]
            : []),
          `${qty(channel.returnsQuantity)} · ${money(channel.returnsValue)}`,
        ])}
        empty=""
        minWidth={720}
      />
      <p className="mt-2 text-[11px] text-muted-foreground">
        الأعلى إيراداً: {best((channel) => channel.netSales) ?? "—"}
        {finance ? ` · الأعلى ربحاً: ${best((channel) => channel.grossProfit) ?? "—"} · الأعلى ربحاً للقطعة: ${best(perUnit) ?? "—"}` : ""}
        {data.bundles.quantity > 0 ? ` · بيع ${qty(data.bundles.quantity)} ضمن بكجات (لا يُقسم إيراد البكج على مكوناته).` : ""}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        المرتجع/الملغى: فواتير ملغاة أو معكوسة مالياً، وهي مستبعدة من الصافي أصلاً. طلبات المتجر لا تحمل تكلفة مسجلة فلا يُقدّر ربحها.
      </p>
    </>
  );
}

export default function ProductDetailsPage() {
  const params = useParams<{ id: string }>();
  const productId = Number(params.id) || 0;
  const { toast } = useToast();
  const [preset, setPreset] = useState<Preset>("all");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [group, setGroup] = useState<"day" | "month" | "year">("month");
  const [slowDays, setSlowDays] = useState(60);
  const [leadTime, setLeadTime] = useState(14);
  const [movementPage, setMovementPage] = useState(1);
  const [tab, setTab] = useState("overview");
  const [workOrderOpen, setWorkOrderOpen] = useState(false);
  const workMe = useWorkMe();
  const range = presetRange(preset, custom);
  const query = new URLSearchParams({ group, slowDays: String(slowDays), leadTime: String(leadTime) });
  if (range.from) query.set("from", range.from);
  if (range.to) query.set("to", range.to);
  const insights = useQuery<Insights>({
    queryKey: ["admin", "product-insights", productId, query.toString()],
    queryFn: () => adminFetch(`/admin/product-insights/${productId}?${query.toString()}`),
    enabled: productId > 0 && (preset !== "custom" || Boolean(custom.from && custom.to)),
    placeholderData: (previous) => previous,
  });
  const movements = useQuery<Insights["movements"]>({
    queryKey: ["admin", "product-insights", productId, "movements", movementPage],
    queryFn: () => adminFetch(`/admin/product-insights/${productId}/movements?page=${movementPage}`),
    enabled: productId > 0 && tab === "inventory",
    placeholderData: (previous) => previous,
  });
  const data = insights.data;
  const kind = data?.product.kind;
  const visibleTabs = useMemo(() => {
    if (!data) return [] as Array<[string, string]>;
    const tabs: Array<[string, string]> = [["overview", "نظرة عامة"], ["sales", "المبيعات"]];
    if (data.purchases && kind !== "service") tabs.push(["purchases", "المشتريات والتكاليف"]);
    if (kind !== "service") tabs.push(["inventory", "المخزون والحركات"]);
    if (data.variants.length) tabs.push(["variants", "المتغيرات"]);
    if (data.asset) tabs.push(["asset", "تفاصيل الأصل"]);
    tabs.push(["reports", "التقارير"]);
    return tabs;
  }, [data, kind]);

  if (!productId) return <EmptyState message="معرّف المنتج غير صحيح" />;
  if (insights.isLoading)
    return <div className="grid min-h-64 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  if (insights.isError || !data)
    return (
      <div className="space-y-3" dir="rtl">
        <Link href="/admin/products" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowRight className="h-3.5 w-3.5" /> رجوع إلى المنتجات</Link>
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600">تعذّر تحميل تفاصيل المنتج: {apiErrorMessage(insights.error, "حاول مرة أخرى")}</div>
      </div>
    );

  const { product, kpis, access } = data;
  const isAsset = product.isAsset;
  const editHref = isAsset ? `/admin/assets/new?edit=${product.id}` : `/admin/products?edit=${product.id}`;
  const unit = product.unit;
  const images = Array.from({ length: Math.min(product.imageCount, 6) }, (_, index) => `/api/media/product/${product.id}/${index}`);
  const title = isAsset ? "تفاصيل الأصل" : "تفاصيل المنتج";
  const periodLabel = range.from ? `${range.from} — ${range.to}` : "كل الفترة";

  async function report(kindName: string, mode: "print" | "download") {
    if (!data) return;
    const base = { company: undefined, subtitle: `${product.name} · ${periodLabel}`, orientation: "landscape" as const };
    try {
      if (kindName === "sales") {
        const columns: ReportColumn<any>[] = [
          { key: "period", header: "الفترة", width: 12 },
          { key: "quantity", header: "الكمية", width: 8, kind: "number", align: "center" },
          { key: "net", header: "صافي المبيعات", width: 12, kind: "money" },
          ...(access.finance ? [{ key: "profit", header: "مجمل الربح", width: 12, kind: "money" as const, value: (row: any) => (row.cogs == null ? null : row.net - row.cogs) }] : []),
        ];
        await exportReport({ options: { ...base, title: "تقرير مبيعات المنتج", summary: [{ label: "الكمية المباعة", value: qty(kpis.soldQuantity) }, { label: "صافي المبيعات", value: money(kpis.netSales) }, ...(access.finance ? [{ label: "مجمل الربح", value: money(kpis.grossProfit) }] : [])] }, columns, rows: data.sales.series, filename: `مبيعات-${product.id}.pdf`, mode });
      } else if (kindName === "profit") {
        const rows = [["مبيعات المفرد", data.sales.retail], ["مبيعات الجملة", data.sales.wholesale], ["المتجر الإلكتروني", data.sales.online]].map(([label, channel]: any) => ({ label, ...channel }));
        await exportReport({ options: { ...base, title: "تقرير ربحية المنتج" }, columns: [
          { key: "label", header: "القناة", width: 12 },
          { key: "quantity", header: "الكمية", width: 8, kind: "number", align: "center" },
          { key: "netSales", header: "صافي الإيراد", width: 12, kind: "money" },
          { key: "cogs", header: "التكلفة", width: 12, kind: "money" },
          { key: "grossProfit", header: "مجمل الربح", width: 12, kind: "money" },
          { key: "margin", header: "الهامش %", width: 8, kind: "number", align: "center" },
        ], rows, filename: `ربحية-${product.id}.pdf`, mode });
      } else if (kindName === "purchases" && data.purchases) {
        await exportReport({ options: { ...base, title: "تقرير مشتريات المنتج", summary: [{ label: "الكمية المشتراة", value: qty(data.purchases.quantity) }, { label: "قيمة الشراء", value: money(data.purchases.value) }, { label: "متوسط التكلفة", value: money(data.purchases.averageCost) }] }, columns: [
          { key: "date", header: "التاريخ", width: 10 },
          { key: "invoiceNo", header: "الفاتورة", width: 10, kind: "code" },
          { key: "supplier", header: "المورد", width: 16 },
          { key: "quantity", header: "الكمية", width: 8, kind: "number", align: "center" },
          { key: "unitCost", header: "سعر الوحدة", width: 10, kind: "money" },
          { key: "total", header: "الإجمالي", width: 10, kind: "money" },
          { key: "status", header: "الحالة", width: 8, value: (row: any) => (row.status === "active" ? "معتمدة" : "مرتجعة/ملغاة") },
        ], rows: data.purchases.history, filename: `مشتريات-${product.id}.pdf`, mode });
      } else if (kindName === "movements") {
        const all: Movement[] = [];
        for (let page = 1; page <= 10; page++) {
          const result = await adminFetch<Insights["movements"]>(`/admin/product-insights/${product.id}/movements?page=${page}&limit=200`);
          all.push(...result.data);
          if (page >= result.totalPages) break;
        }
        await exportReport({ options: { ...base, title: "تقرير حركات المخزون" }, columns: [
          { key: "createdAt", header: "التاريخ", width: 12, value: (row: Movement) => when(row.createdAt) },
          { key: "label", header: "نوع الحركة", width: 14 },
          { key: "reference", header: "المستند", width: 12, value: (row: Movement) => row.reference?.label ?? "—" },
          { key: "warehouse", header: "المستودع", width: 10, value: (row: Movement) => row.warehouse ?? "—" },
          { key: "quantityIn", header: "وارد", width: 7, kind: "number", align: "center" },
          { key: "quantityOut", header: "صادر", width: 7, kind: "number", align: "center" },
          { key: "balanceAfter", header: "الرصيد", width: 7, kind: "number", align: "center" },
          { key: "employee", header: "الموظف", width: 10, value: (row: Movement) => row.employee ?? "—" },
        ], rows: all, filename: `حركات-${product.id}.pdf`, mode });
      } else if (kindName === "variants") {
        await exportReport({ options: { ...base, title: "أداء المتغيرات" }, columns: [
          { key: "name", header: "المتغير", width: 14 },
          { key: "sku", header: "SKU", width: 10, kind: "code", value: (row: any) => row.sku ?? "—" },
          { key: "available", header: "المتاح", width: 8, kind: "number", align: "center" },
          { key: "sold", header: "المباع", width: 8, kind: "number", align: "center" },
          { key: "revenue", header: "الإيراد", width: 10, kind: "money" },
          ...(access.finance ? [{ key: "grossProfit", header: "مجمل الربح", width: 10, kind: "money" as const }] : []),
        ], rows: data.variants, filename: `متغيرات-${product.id}.pdf`, mode });
      } else if (kindName === "suppliers" && data.purchases) {
        await exportReport({ options: { ...base, title: "مقارنة الموردين" }, columns: [
          { key: "name", header: "المورد", width: 16 },
          { key: "quantity", header: "الكمية", width: 8, kind: "number", align: "center" },
          { key: "latestPrice", header: "آخر سعر", width: 10, kind: "money" },
          { key: "averagePrice", header: "متوسط السعر", width: 10, kind: "money" },
          { key: "value", header: "الإجمالي", width: 10, kind: "money" },
          { key: "returnsQuantity", header: "المرتجع", width: 8, kind: "number", align: "center" },
          { key: "lastDate", header: "آخر شراء", width: 10, value: (row: any) => row.lastDate ?? "—" },
        ], rows: data.purchases.suppliers, filename: `موردين-${product.id}.pdf`, mode });
      } else if (kindName === "employees" && data.sales.employees) {
        await exportReport({ options: { ...base, title: "المبيعات حسب الموظف" }, columns: [
          { key: "name", header: "الموظف", width: 16 },
          { key: "invoices", header: "الفواتير", width: 8, kind: "number", align: "center" },
          { key: "quantity", header: "الكمية", width: 8, kind: "number", align: "center" },
          { key: "gross", header: "الإجمالي", width: 10, kind: "money" },
          { key: "returnsQuantity", header: "المرتجع", width: 8, kind: "number", align: "center" },
          { key: "net", header: "الصافي", width: 10, kind: "money" },
        ], rows: data.sales.employees, filename: `موظفين-${product.id}.pdf`, mode });
      } else if (kindName === "asset" && data.asset) {
        await exportReport({ options: { ...base, title: "تقرير استخدام الأصل", summary: [{ label: "عدد الحجوزات", value: qty(data.asset.bookingsUsed) }, { label: "مرات الاستخدام", value: qty(data.asset.usageCount) }] }, columns: [
          { key: "bookingId", header: "الحجز", width: 8, value: (row: any) => `#${row.bookingId}` },
          { key: "customerName", header: "الزبون", width: 14, value: (row: any) => row.customerName ?? "—" },
          { key: "day", header: "التاريخ", width: 10, value: (row: any) => row.day ?? "—" },
          { key: "required", header: "المطلوب", width: 8, kind: "number", align: "center" },
          { key: "checkedOut", header: "الخارج", width: 8, kind: "number", align: "center" },
          { key: "returned", header: "المرتجع", width: 8, kind: "number", align: "center" },
        ], rows: data.asset.bookings, filename: `استخدام-اصل-${product.id}.pdf`, mode });
      }
    } catch (error) {
      toast({ title: "تعذّر إنشاء التقرير", description: apiErrorMessage(error), variant: "destructive" });
    }
  }

  const reports: Array<[string, string, boolean]> = [
    ["sales", "تقرير مبيعات المنتج", true],
    ["profit", "تقرير الربحية", access.finance],
    ["purchases", "تقرير المشتريات", Boolean(data.purchases)],
    ["movements", "تقرير حركات المخزون", kind !== "service"],
    ["variants", "أداء المتغيرات", data.variants.length > 0],
    ["suppliers", "مقارنة الموردين", Boolean(data.purchases?.suppliers.length)],
    ["employees", "المبيعات حسب الموظف", Boolean(data.sales.employees)],
    ["asset", "تقرير استخدام الأصل", Boolean(data.asset)],
  ];
  const forecast = data.intelligence.forecast;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={isAsset ? "/admin/assets" : "/admin/products"} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowRight className="h-3.5 w-3.5" /> {isAsset ? "رجوع إلى الأصول" : "رجوع إلى المنتجات"}
        </Link>
        <p className="text-xs text-muted-foreground">{title}</p>
      </div>

      {/* Header: image, identity, price/cost/margin, quick actions */}
      <Card className="grid gap-4 md:grid-cols-[200px_1fr]">
        <div className="mx-auto w-full max-w-[180px] space-y-2 md:max-w-none">
          {images.length ? (
            <img src={images[0]} alt={product.name} className="aspect-square w-full rounded-xl border border-primary/15 bg-white object-cover" />
          ) : (
            <div className="grid aspect-square w-full place-items-center rounded-xl border border-dashed border-primary/25 bg-primary/5 text-primary/60"><Package className="h-12 w-12" /></div>
          )}
          {images.length > 1 ? (
            <div className="grid grid-cols-5 gap-1">
              {images.slice(1).map((src) => <img key={src} src={src} alt="" loading="lazy" className="aspect-square w-full rounded-md border border-border/40 object-cover" />)}
            </div>
          ) : null}
        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold text-foreground">{product.name}</h1>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">{PRODUCT_KIND_LABELS[product.kind]}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${product.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{product.isActive ? "نشط" : "غير نشط"}</span>
                {data.intelligence.slow.isSlow ? <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-600">منتج راكد</span> : null}
              </div>
              {product.nameEn && product.nameEn !== product.name ? <p className="text-sm text-muted-foreground">{product.nameEn}</p> : null}
              <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <div>الرمز: <span dir="ltr" className="font-mono text-foreground">{product.code}</span></div>
                {product.barcode ? <div>الباركود: <span dir="ltr" className="font-mono text-foreground">{product.barcode}</span></div> : null}
                <div>الفئة: <span className="text-foreground">{product.category ?? "غير مصنف"}</span></div>
                <div>الوحدة: <span className="text-foreground">{unit}</span></div>
              </dl>
            </div>
            <DropdownMenu dir="rtl">
              <DropdownMenuTrigger asChild>
                <Button className="gap-1"><Sparkles className="h-4 w-4" /> إجراءات سريعة <ChevronDown className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild><Link href={editHref}><Pencil className="h-4 w-4" /> {isAsset ? "تعديل الأصل" : "تعديل المنتج"}</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href={editHref}><Pencil className="h-4 w-4" /> تعديل سعر البيع</Link></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTab("sales")}><BarChart3 className="h-4 w-4" /> عرض فواتير البيع</DropdownMenuItem>
                {data.purchases ? <DropdownMenuItem onSelect={() => setTab("purchases")}><ShoppingCart className="h-4 w-4" /> عرض فواتير الشراء</DropdownMenuItem> : null}
                <DropdownMenuItem asChild><Link href={`/admin/print-labels?productId=${product.id}&kind=${isAsset ? "asset" : "product"}`}><QrCode className="h-4 w-4" /> طباعة الباركود</Link></DropdownMenuItem>
                <DropdownMenuSeparator />
                {kind !== "service" ? <DropdownMenuItem asChild><Link href="/admin/warehouse-transfers"><Truck className="h-4 w-4" /> تحويل بين المستودعات</Link></DropdownMenuItem> : null}
                {kind !== "service" ? (
                  <DropdownMenuItem asChild>
                    <Link href={kind === "quantity_asset" ? `/admin/assets/new?edit=${product.id}#quantities` : editHref}><Warehouse className="h-4 w-4" /> إنشاء تسوية مخزون</Link>
                  </DropdownMenuItem>
                ) : null}
                {kind !== "service" ? <DropdownMenuItem onSelect={() => setTab("inventory")}><History className="h-4 w-4" /> عرض سجل الحركات</DropdownMenuItem> : null}
                <DropdownMenuItem onSelect={() => setTab("reports")}><FileDown className="h-4 w-4" /> تصدير تقرير</DropdownMenuItem>
                {workMe.data?.ready && workMe.data.access.canCreate ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setWorkOrderOpen(true)}><ClipboardList className="h-4 w-4" /> إصدار أمر عمل</DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <CreateWorkOrderDialog
              open={workOrderOpen}
              onOpenChange={setWorkOrderOpen}
              defaults={{ productId: product.id, contextLabel: `${isAsset ? "الأصل" : "المنتج"}: ${product.name}` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="سعر البيع" value={money(product.price)} hint={product.wholesalePrice ? `الجملة ${formatCurrency(product.wholesalePrice)}` : undefined} />
            {access.finance ? <Kpi label="تكلفة الوحدة" value={money(product.costPrice)} hint="التكلفة الحالية على بطاقة المنتج" /> : null}
            {access.finance ? <Kpi label="هامش السعر" value={percent(product.margin)} tone={product.margin != null && product.margin < 0 ? "bad" : undefined} /> : null}
            {kind !== "service" ? <Kpi label="المتوفر الآن" value={`${qty(kpis.availableQuantity)} ${unit}`} tone={kpis.availableQuantity <= 0 ? "bad" : undefined} /> : null}
          </div>
          {product.description ? <p className="line-clamp-3 text-sm text-muted-foreground">{product.description}</p> : null}
        </div>
      </Card>

      {/* Date filter */}
      <Card className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="الفترة">
          {PRESETS.map(([value, label]) => (
            <Button key={value} size="sm" variant={preset === value ? "default" : "outline"} onClick={() => setPreset(value)}>{label}</Button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label>من تاريخ<input type="date" value={custom.from} onChange={(event) => setCustom({ ...custom, from: event.target.value })} className="mt-1 block rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" /></label>
            <label>إلى تاريخ<input type="date" value={custom.to} onChange={(event) => setCustom({ ...custom, to: event.target.value })} className="mt-1 block rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" /></label>
          </div>
        ) : null}
        <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarRange className="h-4 w-4" /> {periodLabel}
          {insights.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {kind !== "service" && kpis.purchasedQuantity != null ? <Kpi label="الكمية المشتراة" value={qty(kpis.purchasedQuantity)} /> : null}
        <Kpi label="الكمية المباعة" value={qty(kpis.soldQuantity)} hint={kpis.bundleQuantity ? `منها ${qty(kpis.bundleQuantity)} ضمن بكجات` : undefined} />
        {kind !== "service" ? <Kpi label="الكمية المتوفرة" value={qty(kpis.availableQuantity)} hint={`الرصيد ${qty(kpis.stock)}`} /> : null}
        {kind !== "service" ? <Kpi label="الكمية المحجوزة" value={qty(kpis.reservedQuantity)} /> : null}
        {kind !== "service" ? <Kpi label="الكمية التالفة" value={qty(data.inventory.damaged)} hint="تالف أو مفقود مسجل" /> : null}
        <Kpi label="إجمالي المبيعات" value={money(kpis.grossSales)} />
        <Kpi label="صافي المبيعات" value={money(kpis.netSales)} hint="بعد الخصومات" />
        {access.finance ? <Kpi label="تكلفة البضاعة المباعة" value={money(kpis.cogs)} /> : null}
        {access.finance ? <Kpi label="مجمل الربح" value={money(kpis.grossProfit)} tone={kpis.grossProfit != null && kpis.grossProfit < 0 ? "bad" : "good"} hint={kpis.uncostedNetSales > 0 ? `بدون ${formatCurrency(kpis.uncostedNetSales)} من طلبات المتجر` : undefined} /> : null}
        {access.finance ? <Kpi label="هامش الربح" value={percent(kpis.margin)} /> : null}
      </div>

      <Tabs value={tab} onValueChange={setTab} dir="rtl">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-primary/5 p-1">
          {visibleTabs.map(([value, label]) => <TabsTrigger key={value} value={value} className="text-xs sm:text-sm">{label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {data.intelligence.alerts.length ? (
            <Card>
              <SectionTitle icon={AlertTriangle} title="تنبيهات المنتج" hint="محسوبة من البيانات الفعلية عند فتح الصفحة؛ لا تُرسل إشعارات إضافية." />
              <ul className="grid gap-2 sm:grid-cols-2">
                {data.intelligence.alerts.map((alert) => (
                  <li key={alert.key} className={`rounded-xl border p-3 text-sm ${alert.level === "danger" ? "border-red-500/30 bg-red-500/5" : alert.level === "warning" ? "border-amber-500/30 bg-amber-500/5" : "border-border/40 bg-background/60"}`}>
                    <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" /> {alert.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{alert.reason}</p>
                    {alert.action ? <Link href={alert.action.href} className="mt-1 inline-block text-xs text-primary hover:underline">{alert.action.label}</Link> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            {kind !== "service" && kind !== "individual_asset" ? (
              <Card>
                <SectionTitle icon={TrendingDown} title="تحليل المنتجات الراكدة" />
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-muted-foreground">آخر بيع</dt><dd className="font-semibold">{data.intelligence.slow.lastSaleDate ?? "لم يُبع بعد"}</dd></div>
                  <div><dt className="text-muted-foreground">أيام منذ آخر بيع</dt><dd className="font-semibold">{qty(data.intelligence.slow.daysSinceSale)}</dd></div>
                  <div><dt className="text-muted-foreground">المخزون الحالي</dt><dd className="font-semibold">{qty(kpis.stock)} {unit}</dd></div>
                  <div><dt className="text-muted-foreground">قيمة المخزون</dt><dd className="font-semibold">{money(data.inventory.stockValue)}</dd></div>
                  <div><dt className="text-muted-foreground">سرعة البيع (آخر 30 يوماً)</dt><dd className="font-semibold">{qty(data.intelligence.slow.velocityPerDay)} / يوم</dd></div>
                  <div><dt className="text-muted-foreground">عمر المنتج</dt><dd className="font-semibold">{data.intelligence.slow.ageDays == null ? "—" : `${qty(data.intelligence.slow.ageDays)} يوماً`}</dd></div>
                </dl>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-1">حدّ الركود
                    <select value={slowDays} onChange={(event) => setSlowDays(Number(event.target.value))} className="rounded-lg border border-border/40 bg-background px-2 py-1">
                      <option value={30}>30 يوماً</option><option value={60}>60 يوماً</option><option value={90}>90 يوماً</option>
                    </select>
                  </label>
                  <span className={data.intelligence.slow.isSlow ? "font-semibold text-amber-600" : "text-muted-foreground"}>
                    {data.intelligence.slow.isSlow ? "منتج راكد" : data.intelligence.slow.tooNew ? "منتج جديد — لا يُقيَّم بعد" : "ليس راكداً"}
                  </span>
                </div>
              </Card>
            ) : null}
            {forecast ? (
              <Card>
                <SectionTitle icon={Boxes} title="توقع نفاد المخزون" hint="من متوسط المبيعات الفعلية لآخر 90 يوماً." />
                {forecast.sufficient ? (
                  <>
                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <div><dt className="text-muted-foreground">المتاح</dt><dd className="font-semibold">{qty(kpis.availableQuantity)} {unit}</dd></div>
                      <div><dt className="text-muted-foreground">متوسط البيع اليومي</dt><dd className="font-semibold">{qty(forecast.averageDaily)}</dd></div>
                      <div><dt className="text-muted-foreground">يكفي تقريباً</dt><dd className="font-semibold">{qty(forecast.daysRemaining)} يوماً</dd></div>
                      <div><dt className="text-muted-foreground">نقطة إعادة الطلب</dt><dd className="font-semibold">{qty(forecast.reorderPoint)}</dd></div>
                      <div><dt className="text-muted-foreground">الكمية المقترحة للشراء</dt><dd className="font-semibold">{qty(forecast.recommendedQuantity)}</dd></div>
                      <div>
                        <dt className="text-muted-foreground">مدة التوريد (يوم)</dt>
                        <dd><input type="number" min={1} max={365} value={leadTime} onChange={(event) => setLeadTime(Math.max(1, Math.min(365, Number(event.target.value) || 1)))} className="w-20 rounded-lg border border-border/40 bg-background px-2 py-1" /></dd>
                      </div>
                    </dl>
                    {forecast.reorderNow ? <p className="mt-2 rounded-lg bg-amber-500/10 p-2 text-xs font-semibold text-amber-700">حان وقت إعادة الطلب.</p> : null}
                    {forecast.seasonal ? <p className="mt-2 text-xs text-muted-foreground">{forecast.seasonal}</p> : null}
                    <p className="mt-2 text-[11px] text-muted-foreground">مدة التوريد غير مسجلة للموردين؛ عدّلها هنا لحساب الكمية المقترحة.</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{forecast.message}</p>
                )}
              </Card>
            ) : null}
          </div>
          <Card>
            <SectionTitle icon={BarChart3} title="مقارنة المفرد والجملة" />
            <ChannelTable data={data.sales} finance={access.finance} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle icon={PackageCheck} title="المنتجات المرتبطة والبكجات" />
              {data.related.bundles.length ? (
                <ul className="mb-3 space-y-1 text-xs">
                  {data.related.bundles.map((bundle) => (
                    <li key={bundle.id} className="flex justify-between gap-2 rounded-lg border border-border/40 p-2">
                      <Link href="/admin/product-bundles" className="font-medium hover:text-primary">{bundle.name}</Link>
                      <span className="text-muted-foreground">× {qty(bundle.quantity)} · {money(bundle.price)}{bundle.isActive ? "" : " · غير نشط"}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mb-2 text-xs text-muted-foreground">ليس ضمن أي بكج.</p>}
              <p className="mb-1 text-xs font-semibold">يُشترى معه غالباً</p>
              {data.related.boughtTogether.length ? (
                <ul className="flex flex-wrap gap-1.5 text-xs">
                  {data.related.boughtTogether.map((item) => (
                    <li key={item.productId}><Link href={`/admin/products/${item.productId}`} className="inline-block rounded-full border border-primary/25 px-2.5 py-1 hover:bg-primary/5">{item.name} <span className="text-muted-foreground">({qty(item.invoices)} فاتورة)</span></Link></li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted-foreground">لا توجد بيانات كافية.</p>}
            </Card>
            <Card>
              <SectionTitle icon={History} title="سجل تغيّر الأسعار" hint="التغييرات المسجلة في سجل التدقيق؛ لا تتغير أسعار الفواتير السابقة." />
              {data.prices.changes.length ? (
                <ul className="space-y-1.5 text-xs">
                  {data.prices.changes.slice(0, 12).map((change, index) => (
                    <li key={index} className="rounded-lg border border-border/40 p-2">
                      <p className="text-muted-foreground">{when(change.at)} · {change.employee ?? "—"}</p>
                      {change.changes.map((item) => (
                        <p key={item.field}>{PRICE_FIELD_LABELS[item.field] ?? item.field}: {item.valuesRecorded ? <><span dir="ltr">{String(item.from ?? "—")}</span> ← <b dir="ltr">{String(item.to ?? "—")}</b></> : <span className="text-muted-foreground">تغيّر (القيم السابقة غير مسجلة)</span>}</p>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted-foreground">لا يوجد تغيير أسعار مسجل.</p>}
              {data.prices.sellingByMonth.length ? (
                <>
                  <p className="mb-1 mt-3 text-xs font-semibold">متوسط سعر البيع الفعلي شهرياً</p>
                  <Table head={["الشهر", "المتوسط", "الأدنى", "الأعلى"]} rows={data.prices.sellingByMonth.slice(0, 6).map((row) => [row.month, money(row.averagePrice), money(row.minPrice), money(row.maxPrice)])} empty="" minWidth={320} />
                </>
              ) : null}
            </Card>
          </div>
          <Card>
            <SectionTitle icon={ClipboardList} title="سجل حياة المنتج" hint="من سجل الحركات والتدقيق الموجود؛ كل حدث مرتبط بمستنده." />
            <ol className="relative space-y-2 border-r border-primary/20 pr-4">
              {data.timeline.slice(0, 25).map((event, index) => (
                <li key={index} className="relative text-xs">
                  <span className="absolute -right-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
                  <p className="text-muted-foreground">{when(event.at)}</p>
                  <p className="font-medium">{event.href ? <Link href={event.href} className="hover:text-primary hover:underline">{event.title}</Link> : event.title}</p>
                  {event.detail ? <p className="text-muted-foreground">{event.detail}</p> : null}
                </li>
              ))}
            </ol>
          </Card>
        </TabsContent>

        <TabsContent value="sales" className="space-y-4">
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SectionTitle icon={BarChart3} title="صافي المبيعات حسب الفترة" />
              <div className="flex gap-1" role="group" aria-label="التجميع">
                {([["day", "يومي"], ["month", "شهري"], ["year", "سنوي"]] as const).map(([value, label]) => (
                  <Button key={value} size="sm" variant={group === value ? "default" : "outline"} onClick={() => setGroup(value)}>{label}</Button>
                ))}
              </div>
            </div>
            <SalesChart series={data.sales.series} unit={unit} />
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">عرض كجدول</summary>
              <div className="mt-2"><Table head={["الفترة", "الكمية", "صافي المبيعات", ...(access.finance ? ["مجمل الربح"] : [])]} rows={data.sales.series.map((point) => [point.period, qty(point.quantity), money(point.net), ...(access.finance ? [money(point.cogs == null ? null : point.net - point.cogs)] : [])])} empty="" minWidth={360} /></div>
            </details>
          </Card>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Kpi label="الوحدات المباعة" value={qty(data.sales.totals.quantity)} />
            <Kpi label="عدد الفواتير والطلبات" value={qty(data.sales.totals.invoices)} />
            <Kpi label="الخصومات" value={money(data.sales.totals.discounts)} />
            <Kpi label="المرتجع / الملغى" value={qty(data.sales.totals.returnsQuantity)} hint={money(data.sales.totals.returnsValue)} />
            <Kpi label="متوسط سعر البيع" value={money(data.sales.totals.averagePrice)} />
          </div>
          <Card>
            <SectionTitle icon={BarChart3} title="مبيعات المفرد والجملة" />
            <ChannelTable data={data.sales} finance={access.finance} />
          </Card>
          {data.sales.customers ? (
            <Card>
              <SectionTitle icon={Users} title="أكثر العملاء شراءً" hint="من فواتير البيع المعتمدة في الفترة." />
              <Table head={["الزبون", "الكمية", "الفواتير", "صافي المبيعات", "آخر شراء"]} rows={data.sales.customers.map((row) => [row.customerId ? <Link key="c" href={`/admin/customers?customer=${row.customerId}`} className="hover:text-primary">{row.name}</Link> : row.name, qty(row.quantity), qty(row.invoices), money(row.net), row.lastDate ?? "—"])} empty="لا توجد مبيعات للعملاء في هذه الفترة." />
            </Card>
          ) : null}
          {data.sales.employees ? (
            <Card>
              <SectionTitle icon={Users} title="المبيعات حسب الموظف" hint="حسب منشئ الفاتورة المسجل؛ الفاتورة تُحسب لموظف واحد فقط." />
              <Table head={["الموظف", "الفواتير", "الكمية", "الإجمالي", "المرتجع", "الصافي"]} rows={data.sales.employees.map((row) => [row.name, qty(row.invoices), qty(row.quantity), money(row.gross), qty(row.returnsQuantity), money(row.net)])} empty="لا توجد مبيعات." />
            </Card>
          ) : null}
        </TabsContent>

        {data.purchases ? (
          <TabsContent value="purchases" className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="الكمية المشتراة" value={qty(data.purchases.quantity)} />
              <Kpi label="قيمة الشراء" value={money(data.purchases.value)} />
              <Kpi label="آخر سعر شراء" value={money(data.purchases.latestCost)} />
              <Kpi label="متوسط تكلفة الوحدة" value={money(data.purchases.averageCost)} hint={data.purchases.attributableCosts ? `مع الشحن ${money(data.purchases.averageLandedCost)}` : undefined} />
              <Kpi label="تكاليف اقتناء إضافية" value={money(data.purchases.attributableCosts)} hint="حصة الشحن من فواتير الشراء" />
              <Kpi label="مرتجعات الشراء" value={qty(data.purchases.returnsQuantity)} hint={money(data.purchases.returnsValue)} />
              <Kpi label="تكلفة البطاقة الحالية" value={money(product.costPrice)} hint="تُستخدم كتكلفة للمبيعات الجديدة" />
            </div>
            <Card>
              <SectionTitle icon={Info} title="طريقة التقييم" />
              <p className="text-xs text-muted-foreground">
                تكلفة البضاعة المباعة تؤخذ من تكلفة الوحدة المحفوظة في كل سطر فاتورة وقت البيع (من بطاقة المنتج)، ولا تُحسب الشراء كتكلفة مبيعات، ولا تُضاف دفعات الموردين كمصروف. لم يتغير أسلوب التقييم الحالي.
              </p>
            </Card>
            <Card>
              <SectionTitle icon={Truck} title="تحليل الموردين" />
              <Table head={["المورد", "الكمية", "آخر سعر", "متوسط السعر", "الإجمالي", "المرتجع", "آخر شراء"]} rows={data.purchases.suppliers.map((row) => [row.supplierId ? <Link key="s" href="/admin/suppliers" className="hover:text-primary">{row.name}</Link> : row.name, qty(row.quantity), money(row.latestPrice), money(row.averagePrice), money(row.value), qty(row.returnsQuantity), row.lastDate ?? "—"])} empty="لا توجد مشتريات في هذه الفترة." />
              <p className="mt-2 text-[11px] text-muted-foreground">مدة التوريد غير مسجلة في فواتير الشراء، لذلك لا يُعرض متوسطها.</p>
            </Card>
            <Card>
              <SectionTitle icon={ShoppingCart} title="سجل فواتير الشراء وأسعارها" />
              <Table head={["التاريخ", "الفاتورة", "المورد", "المتغير", "الكمية", "سعر الوحدة", "الإجمالي", "الحالة"]} rows={data.purchases.history.map((row) => [row.date, <Link key="i" href={`/admin/purchases?invoice=${row.invoiceId}`} className="font-mono text-primary hover:underline" dir="ltr">{row.invoiceNo}</Link>, row.supplier, row.variantLabel ?? "—", qty(row.quantity), money(row.unitCost), money(row.total), row.status === "active" ? "معتمدة" : "مرتجعة/ملغاة"])} empty="لا توجد فواتير شراء لهذا المنتج." minWidth={760} />
            </Card>
          </TabsContent>
        ) : null}

        <TabsContent value="inventory" className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <Kpi label="إجمالي الرصيد" value={qty(data.inventory.stock)} />
            <Kpi label="المتاح" value={qty(data.inventory.available)} />
            <Kpi label="المحجوز" value={qty(data.inventory.reserved)} />
            {data.inventory.checkedOut != null ? <Kpi label="الخارج" value={qty(data.inventory.checkedOut)} /> : null}
            <Kpi label="التالف المسجل" value={qty(data.inventory.damaged)} />
            <Kpi label="الحد الأدنى" value={qty(data.inventory.minStock)} tone={data.inventory.minStock > 0 && data.inventory.available <= data.inventory.minStock ? "warn" : undefined} />
          </div>
          {product.sharedStockProductId ? <p className="text-xs text-muted-foreground">هذا المنتج يستخدم مخزون المنتج #{product.sharedStockProductId}.</p> : null}
          <Card>
            <SectionTitle icon={Warehouse} title="الكمية حسب المستودع" />
            <Table head={["المستودع", "الكمية"]} rows={data.inventory.warehouses.map((row) => [row.name, qty(row.quantity)])} empty="لا يوجد توزيع مستودعات مسجل لهذا المنتج." minWidth={280} />
          </Card>
          <Card>
            <SectionTitle icon={History} title="سجل الحركات" hint="الرصيد بعد كل حركة محسوب من الرصيد الحالي عبر الحركات المسجلة." />
            {movements.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : movements.isError ? (
              <p role="alert" className="text-xs text-red-600">تعذّر تحميل الحركات: {apiErrorMessage(movements.error)}</p>
            ) : (
              <>
                <Table
                  head={["التاريخ", "نوع الحركة", "المستند", "المستودع", "وارد", "صادر", "الرصيد", "الموظف", "ملاحظات"]}
                  rows={(movements.data?.data ?? []).map((row) => [
                    when(row.createdAt),
                    row.label,
                    row.reference ? (row.reference.href ? <Link key="r" href={row.reference.href} className="text-primary hover:underline">{row.reference.label}</Link> : row.reference.label) : "—",
                    row.warehouse ?? "—",
                    row.quantityIn ? <span key="in" className="text-emerald-600">+{qty(row.quantityIn)}</span> : "—",
                    row.quantityOut ? <span key="out" className="text-red-600">-{qty(row.quantityOut)}</span> : "—",
                    <b key="b">{qty(row.balanceAfter)}</b>,
                    row.employee ?? "—",
                    row.note ?? "—",
                  ])}
                  empty="لا توجد حركات مسجلة."
                  minWidth={900}
                />
                {(movements.data?.totalPages ?? 1) > 1 ? (
                  <div className="mt-2 flex items-center justify-end gap-2 text-xs">
                    <Button size="sm" variant="outline" disabled={movementPage <= 1} onClick={() => setMovementPage((page) => page - 1)}>السابق</Button>
                    <span>{movementPage} / {movements.data?.totalPages}</span>
                    <Button size="sm" variant="outline" disabled={movementPage >= (movements.data?.totalPages ?? 1)} onClick={() => setMovementPage((page) => page + 1)}>التالي</Button>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </TabsContent>

        {data.variants.length ? (
          <TabsContent value="variants">
            <Card>
              <SectionTitle icon={Boxes} title="تحليل المتغيرات" hint="المبيعات لكل متغير من حركات المخزون المرتبطة بأسطر الفواتير، ومن طلبات المتجر." />
              <Table
                head={["المتغير", "SKU", "الباركود", "المتاح", ...(access.finance ? ["المشترى"] : []), "المباع", "سعر البيع", ...(access.finance ? ["التكلفة", "مجمل الربح"] : []), "الإيراد"]}
                rows={data.variants.map((row) => [
                  <span key="n">{row.name}{row.isActive ? "" : <span className="mr-1 text-muted-foreground">(غير نشط)</span>}</span>,
                  <span key="s" dir="ltr" className="font-mono">{row.sku ?? "—"}</span>,
                  <span key="b" dir="ltr" className="font-mono">{row.barcode ?? "—"}</span>,
                  qty(row.available),
                  ...(access.finance ? [qty(row.purchased)] : []),
                  qty(row.sold),
                  money(row.price),
                  ...(access.finance ? [money(row.cost), money(row.grossProfit)] : []),
                  money(row.revenue),
                ])}
                empty=""
                minWidth={820}
              />
            </Card>
          </TabsContent>
        ) : null}

        {data.asset ? (
          <TabsContent value="asset" className="space-y-4">
            {kind === "quantity_asset" ? <QuantityAssetPanel productId={product.id} assetName={product.name} /> : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="الحالة" value={data.asset.status} />
              <Kpi label="مرات الاستخدام" value={`${qty(data.asset.usageCount)}${data.asset.expectedLifeUses ? ` / ${qty(data.asset.expectedLifeUses)}` : ""}`} />
              <Kpi label="الحجوزات المستخدمة" value={qty(data.asset.bookingsUsed)} hint={`نشطة الآن ${qty(data.asset.activeBookings)}`} />
              <Kpi label="الموقع" value={data.asset.warehouse ?? data.asset.location ?? "—"} hint={data.asset.nextMaintenanceDate ? `الصيانة القادمة ${data.asset.nextMaintenanceDate}` : undefined} />
            </div>
            {data.asset.finance ? (
              <Card>
                <SectionTitle icon={BarChart3} title="ربحية الأصل والعائد" hint="لا يُنسب إيراد الحجز كاملاً لكل أصل مستخدم فيه؛ الإيراد المنسوب هنا من أوامر الإيجار المباشرة فقط." />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Kpi label="تكلفة الاقتناء" value={money(data.asset.finance.acquisitionCost)} />
                  <Kpi label="القيمة الدفترية" value={money(data.asset.finance.currentValue)} />
                  <Kpi label="الصيانة والإصلاح" value={money(data.asset.finance.maintenanceCost)} />
                  <Kpi label="إيراد الإيجار المباشر" value={money(data.asset.finance.attributableRevenue)} hint={`${qty(data.asset.finance.rentals)} إيجار`} />
                  <Kpi label="العائد على الاستثمار" value={data.asset.finance.roi.calculable ? percent(data.asset.finance.roi.roi) : "—"} hint={data.asset.finance.roi.calculable ? `المساهمة ${formatCurrency(data.asset.finance.roi.contribution)}` : data.asset.finance.roi.reason} />
                </div>
              </Card>
            ) : null}
            <Card>
              <SectionTitle icon={CalendarRange} title="الحجوزات المرتبطة" />
              <Table head={["الحجز", "الزبون", "التاريخ", "المطلوب", "الخارج", "المرتجع", "المرحلة"]} rows={data.asset.bookings.map((row) => [<Link key="b" href={`/admin/bookings/${row.source === "service_order" ? "service" : "kosha"}/${row.bookingId}`} className="text-primary hover:underline">#{row.bookingId}</Link>, row.customerName ?? "—", row.day ?? "—", qty(row.required), qty(row.checkedOut), qty(row.returned), row.stage])} empty="لم يُستخدم في أي حجز بعد." />
            </Card>
            {data.asset.custody.length ? (
              <Card>
                <SectionTitle icon={History} title="سجل الإخراج والإرجاع (العهد)" />
                <Table head={["الموظف", "الكمية", "الحالة", "الخروج", "الإرجاع", "ملاحظات"]} rows={data.asset.custody.map((row) => [row.staff ?? "—", qty(row.quantity), row.status === "issued" ? "خارج" : "مُرجع", when(row.issuedAt), when(row.returnedAt), row.notes ?? "—"])} empty="" />
              </Card>
            ) : null}
            <Card>
              <SectionTitle icon={History} title="سجل الصيانة والحالة" />
              <Table head={["التاريخ", "الحدث", "التفاصيل", "بواسطة"]} rows={data.asset.maintenanceHistory.map((row) => [when(row.at), row.title, row.body ?? "—", row.actor ?? "—"])} empty="لا يوجد سجل صيانة." />
            </Card>
          </TabsContent>
        ) : null}

        <TabsContent value="reports">
          <Card>
            <SectionTitle icon={Printer} title="التقارير" hint={`حسب الفترة المحددة (${periodLabel}). تُطبع أو تُحفظ PDF بنظام الطباعة الحالي.`} />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {reports.filter(([, , show]) => show).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-2 rounded-xl border border-primary/15 p-3 text-sm">
                  <span className="font-medium">{label}</span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => void report(key, "print")}><Printer className="h-3.5 w-3.5" /> طباعة</Button>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => void report(key, "download")}><FileDown className="h-3.5 w-3.5" /> PDF</Button>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
