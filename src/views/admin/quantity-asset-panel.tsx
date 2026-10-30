import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Boxes, Loader2 } from "lucide-react";
import { adminFetch, apiErrorMessage } from "./_lib";
import { QuantityManager } from "./quantity-manager";
import { DateField } from "@/components/ui/date-field";

export type QuantityBookingLine = {
  source: string;
  bookingId: number;
  day: string | null;
  status: string;
  customerName: string | null;
  required: number;
  reserved: number;
  prepared: number;
  checkedOut: number;
  outstanding: number;
  returnedGood: number;
  damaged: number;
  missing: number;
  returned: number;
  stage: string;
};

export type QuantitySummary = {
  productId: number;
  trackingMode: "quantity";
  unit: string;
  total: number;
  inWarehouse: number;
  checkedOut: number;
  damaged: number;
  maintenance: number;
  missing: number;
  reserved: number;
  available: number;
  availabilityDay: string;
  committedOnDay: number;
  peakCommitment: number;
  unitCost: number;
  totalValue: number;
  lowAvailability: boolean;
  reconciliation: { outstandingInBookings: number; matches: boolean };
  bookings: QuantityBookingLine[];
  /** The asset's warehouse from its passport (older summaries may omit it). */
  warehouse?: { id: number; name: string } | null;
};

const STAGE_LABELS: Record<string, string> = {
  linked: "مرتبط",
  reserved: "محجوز",
  picked: "مُجهّز",
  out: "خارج",
  returned: "مُرتجع",
  completed: "مكتمل",
};

const numberText = (value: number) => Number(value ?? 0).toLocaleString("ar-IQ-u-nu-latn");

function bookingHref(line: Pick<QuantityBookingLine, "source" | "bookingId">) {
  return `/admin/bookings/${line.source === "service_order" ? "service" : "kosha"}/${line.bookingId}`;
}

/**
 * Where a quantity asset's pieces are and who needs them: the exclusive-state
 * sum, availability on a chosen day and the linked bookings. Read-only; the
 * actions live in «إدارة الكميات» (QuantityManager).
 */
export function QuantityAvailability({ productId }: { productId: number }) {
  const [day, setDay] = useState("");
  const summary = useQuery<QuantitySummary>({
    queryKey: ["admin", "asset-quantity", productId, day],
    queryFn: () => adminFetch(`/admin/assets/quantity/${productId}${day ? `?day=${encodeURIComponent(day)}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const data = summary.data;
  const activeBookings = useMemo(
    () => (data?.bookings ?? []).filter((line) => line.outstanding > 0 || !["returned", "completed"].includes(line.stage)),
    [data?.bookings],
  );

  if (summary.isLoading)
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل التوفر والحجوزات…</div>;
  if (summary.isError || !data)
    return (
      <p className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600" role="alert">
        تعذّر تحميل التوفر والحجوزات: {apiErrorMessage(summary.error, "حاول مرة أخرى")}
      </p>
    );
  const unit = data.unit;

  return (
    <div className="space-y-3" dir="rtl">
      <p className="text-xs leading-5 text-muted-foreground">
        الحالات الفعلية متنافية وتساوي الإجمالي: في المستودع {numberText(data.inWarehouse)} + خارج {numberText(data.checkedOut)} + تالف {numberText(data.damaged)} + صيانة {numberText(data.maintenance)} + مفقود {numberText(data.missing)} = {numberText(data.total)} {unit}.
        الحجز التزام بالموعد ولا يُضاف للإجمالي.
      </p>
      {!data.reconciliation.matches ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          الكمية الخارجة المسجلة ({numberText(data.checkedOut)}) لا تطابق مجموع الحجوزات ({numberText(data.reconciliation.outstandingInBookings)}). راجع حركات الأصل قبل أي تعديل.
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/30 bg-background/50 p-3">
        <label className="text-xs text-muted-foreground">
          فحص التوفر بتاريخ
          <DateField type="date" dir="ltr" value={day} onChange={(event) => setDay(event.target.value)} className="mt-1 block min-h-10 rounded-lg border border-border/40 bg-background px-3 text-sm text-foreground" />
        </label>
        <p className="text-sm">
          المتاح {day ? `يوم ${day}` : "اليوم"}: <b className="text-primary">{numberText(data.available)} {unit}</b>
          <span className="ms-2 text-xs text-muted-foreground">(المحجوز والخارج في هذا اليوم: {numberText(data.committedOnDay)})</span>
        </p>
        {summary.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <div id="quantity-bookings" className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">الحجوزات المرتبطة <span className="text-xs font-normal text-muted-foreground">({numberText(activeBookings.length)} نشط من {numberText(data.bookings.length)})</span></h3>
        {data.bookings.length === 0 ? (
          <p className="text-xs text-muted-foreground">لا توجد حجوزات مرتبطة بهذا الأصل.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/30">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-background/60 text-muted-foreground">
                <tr>
                  {["الحجز", "التاريخ", "المطلوب", "المحجوز", "المجهّز", "الخارج", "المرتجع السليم", "التالف", "المفقود", "الحالة"].map((label) => <th key={label} className="p-2 text-start font-medium">{label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {data.bookings.map((line) => (
                  <tr key={`${line.source}-${line.bookingId}`}>
                    <td className="p-2"><Link href={bookingHref(line)} className="font-medium text-primary hover:underline">#{line.bookingId}</Link><div className="text-muted-foreground">{line.customerName ?? "—"}</div></td>
                    <td className="whitespace-nowrap p-2">{line.day ?? "—"}</td>
                    <td className="p-2 tabular-nums">{numberText(line.required)}</td>
                    <td className="p-2 tabular-nums">{numberText(line.reserved)}</td>
                    <td className="p-2 tabular-nums">{numberText(line.prepared)}</td>
                    <td className="p-2 tabular-nums">{numberText(line.outstanding)} <span className="text-muted-foreground">من {numberText(line.checkedOut)}</span></td>
                    <td className="p-2 tabular-nums">{numberText(line.returnedGood)}</td>
                    <td className="p-2 tabular-nums text-red-600">{line.damaged ? numberText(line.damaged) : "—"}</td>
                    <td className="p-2 tabular-nums text-red-600">{line.missing ? numberText(line.missing) : "—"}</td>
                    <td className="p-2">{STAGE_LABELS[line.stage] ?? line.stage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** Quantity management for pages outside the asset form (e.g. product details). */
export function QuantityAssetPanel({ productId, assetName = "" }: { productId: number; assetName?: string }) {
  return (
    <section className="space-y-4 rounded-xl border border-primary/25 bg-card p-4" id="quantities" dir="rtl">
      <h2 className="flex items-center gap-2 text-base font-bold text-foreground"><Boxes className="h-5 w-5 text-primary" /> إدارة الكميات</h2>
      <QuantityManager productId={productId} assetName={assetName} />
      <div className="border-t border-border/30 pt-3">
        <QuantityAvailability productId={productId} />
      </div>
    </section>
  );
}
