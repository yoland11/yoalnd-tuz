/**
 * Equipment rental documents on the shared branded receipt
 * (src/lib/branded-receipt.ts): the contract, the rental receipt (totals with
 * approved payments only), and the dispatch and return receipts. Branded A5
 * (+ WhatsApp image) or 80mm. Pure presentation over the saved rental.
 */
import type { EquipmentRentalDetail, EquipmentRentalDispatch, EquipmentRentalReturn } from "@/lib/equipment-rentals";
import { EQUIPMENT_RENTAL_STATUS_LABELS } from "@/lib/equipment-rentals";
import { buildBrandedReceiptHtml, type BrandedReceiptSize, type ReceiptColumn, type ReceiptFact } from "@/lib/branded-receipt";
import type { ReceiptBrand } from "@/lib/receipt-brand";

export type RentalPrintSize = BrandedReceiptSize;

const cash = (value: unknown) => `${Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} د.ع`;
const count = (value: unknown) => Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
const at = (value: string) => new Date(value).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad" });
const when = (date: string, time: string | null | undefined) => [date, time].filter(Boolean).join(" ");

/** Calendar days the rental covers (start and end day included), for display only. */
export function rentalDayCount(startDate: string, endDate: string): number | null {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

function dayText(days: number | null) {
  if (!days) return "";
  if (days === 1) return "يوم واحد";
  if (days === 2) return "يومان";
  return `${days} ${days <= 10 ? "أيام" : "يوماً"}`;
}

const movementFacts = (rental: Pick<EquipmentRentalDetail, "orderNo" | "customerName">, label: string, time: string, actor: string, requestId: string): ReceiptFact[] => [
  { label: "رقم العقد", value: rental.orderNo, icon: "receipt" },
  { label: label, value: at(time), icon: "clock" },
  { label: "العميل", value: rental.customerName, icon: "user" },
  { label: "سجّله", value: actor, icon: "id" },
  { label: "مرجع العملية", value: requestId, icon: "hash", wide: true },
];

export function equipmentRentalDispatchPrintHtml(
  rental: Pick<EquipmentRentalDetail, "orderNo" | "customerName">,
  record: EquipmentRentalDispatch,
  size: RentalPrintSize = "a5",
  brand?: ReceiptBrand,
) {
  return buildBrandedReceiptHtml({
    documentTitle: `سند تسليم معدات · ${rental.orderNo}`,
    title: "سند تسليم معدات",
    icon: "truck",
    facts: movementFacts(rental, "وقت التسليم", record.dispatchedAt, record.actorName, record.requestId),
    items: {
      columns: [
        { key: "i", label: "#", role: "index" },
        { key: "name", label: "المعدة", role: "name" },
        { key: "employee", label: "مسؤول التسليم", wideOnly: true },
        { key: "source", label: "مخزن المصدر", wideOnly: true },
        { key: "quantity", label: "المُسلّم", role: "number" },
        { key: "remaining", label: "باقي التسليم", role: "total" },
      ],
      rows: record.lines.map((line) => ({
        cells: {
          name: line.name,
          employee: line.employeeName,
          source: line.warehouses.map((source) => `${source.name} × ${count(source.quantity)}`).join("، "),
          quantity: count(line.quantity),
          remaining: count(line.remaining),
        },
        sub: line.code,
      })),
    },
    notes: record.note || null,
    signatures: ["توقيع العميل", "توقيع مسؤول التسليم"],
  }, size, brand);
}

export function equipmentRentalReturnPrintHtml(
  rental: Pick<EquipmentRentalDetail, "orderNo" | "customerName">,
  record: EquipmentRentalReturn,
  size: RentalPrintSize = "a5",
  brand?: ReceiptBrand,
) {
  return buildBrandedReceiptHtml({
    documentTitle: `سند استرجاع معدات · ${rental.orderNo}`,
    title: "سند استرجاع معدات",
    icon: "undo",
    facts: movementFacts(rental, "وقت الاسترجاع", record.returnedAt, record.actorName, record.requestId),
    items: {
      columns: [
        { key: "i", label: "#", role: "index" },
        { key: "name", label: "المعدة", role: "name" },
        { key: "receiver", label: "المستلم والمخزن", wideOnly: true },
        { key: "good", label: "سليم", role: "number" },
        { key: "damaged", label: "تالف", role: "number", wideOnly: true },
        { key: "missing", label: "مفقود", role: "number", wideOnly: true },
        { key: "pending", label: "بانتظار الفحص", role: "number", wideOnly: true },
        { key: "left", label: "المتبقي لدى العميل", role: "total" },
      ],
      rows: record.lines.map((line) => ({
        cells: {
          name: line.name,
          receiver: `${line.receivingEmployeeName} · ${line.warehouseName || "—"}`,
          good: count(line.good),
          damaged: count(line.damaged),
          missing: count(line.missing),
          pending: count(line.pending),
          left: count(line.outstandingAfter),
        },
        sub: [line.code, line.note && line.note !== record.note ? line.note : ""].filter(Boolean).join(" · "),
      })),
    },
    sections: [{ title: "المبالغ", text: "تُسوّى مبالغ الإيجار والتأمين عبر الموافقات المالية." }],
    notes: record.note || null,
    signatures: ["توقيع العميل", "توقيع المستلم"],
  }, size, brand);
}

/**
 * The contract (terms + signatures) or the rental receipt. Paid is the
 * approved amount the server reports; pending payments are not in it.
 */
export function equipmentRentalPrintHtml(
  rental: EquipmentRentalDetail,
  size: RentalPrintSize,
  document: "contract" | "receipt" = "contract",
  brand?: ReceiptBrand,
) {
  const details = rental.details;
  const contract = document === "contract";
  const hasDiscount = details.assets.some((line) => Number(line.discount) > 0);
  const columns: ReceiptColumn[] = [
    { key: "i", label: "#", role: "index" },
    { key: "name", label: "المادة / المعدة", role: "name" },
    { key: "quantity", label: "الكمية", role: "number", wideOnly: true },
    { key: "duration", label: "المدة", role: "number", wideOnly: true },
    { key: "unitPrice", label: "سعر الوحدة", role: "number", wideOnly: true },
    ...(hasDiscount ? [{ key: "discount", label: "الخصم", role: "number" as const, wideOnly: true }] : []),
    { key: "lineTotal", label: "الإجمالي", role: "total" },
  ];
  const optional = (label: string, value: number) => (Number(value) ? [{ label, value: cash(value) }] : []);
  return buildBrandedReceiptHtml({
    documentTitle: `${contract ? "عقد إيجار" : "وصل إيجار"} ${rental.orderNo}`,
    title: contract ? "عقد إيجار معدات" : "وصل إيجار معدات",
    icon: contract ? "note" : "receipt",
    facts: [
      { label: "رقم العقد", value: rental.orderNo, icon: "receipt" },
      { label: "الحالة", value: EQUIPMENT_RENTAL_STATUS_LABELS[rental.status] || rental.status, icon: "layers" },
      { label: "اسم العميل", value: rental.customerName, icon: "user" },
      { label: "الهاتف", value: rental.phone, icon: "phone" },
      { label: "التسليم", value: when(rental.startDate, details.startTime), icon: "calendar" },
      { label: "الإرجاع المتوقع", value: when(rental.endDate, details.endTime), icon: "clock" },
      { label: "مدة الإيجار", value: dayText(rentalDayCount(rental.startDate, rental.endDate)), icon: "calendar" },
      { label: "التأمين (مسترد)", value: `المطلوب ${cash(details.depositRequired)} · المحتفظ به ${cash(rental.finance.depositHeld)}`, icon: "wallet", wide: true },
      { label: "العنوان", value: details.address, icon: "pin", wide: true },
    ],
    items: {
      columns,
      rows: details.assets.map((line) => ({
        cells: {
          name: line.name,
          quantity: count(line.quantity),
          duration: count(line.duration),
          unitPrice: cash(line.unitPrice),
          discount: cash(line.discount),
          lineTotal: cash(line.lineTotal),
        },
        image: line.image,
        sub: `${line.code} · مخزن ${line.warehouseId ?? "الرئيسي"}`,
      })),
    },
    totals: [
      ...optional("التوصيل", details.deliveryCharge),
      ...optional("التركيب", details.installationCharge),
      ...optional("خصم العقد", details.discount),
      { label: "الإجمالي", value: cash(rental.total) },
      { label: "المدفوع (المعتمد)", value: cash(rental.paid) },
      { label: "المتبقي", value: cash(rental.remaining), tone: "due" },
    ],
    totalsNote: "الدفعات المعلقة لا تدخل في المدفوع أعلاه. التأمين المسترد التزام مستقل؛ لا يخفض رصيد الإيجار إلا بتسوية معتمدة.",
    sections: [
      ...(contract
        ? [
            {
              title: "شروط الإيجار المتفق عليها",
              text: details.terms || "يلتزم المستأجر بإعادة المعدات بالعدد والحالة المبينة في محضر التسليم. تُراجع أي رسوم تأخير أو تلف أو فقد وفق الشروط المتفق عليها وبعد الاعتماد.",
            },
            {
              title: "حالة المعدات عند التسليم",
              text: details.assets.map((line) => `${line.name}: ${String(line.conditionAtDispatch || "تراجع في محضر التسليم")}`).join(" · "),
            },
          ]
        : []),
    ],
    signatures: contract ? ["توقيع العميل", "ممثل الشركة"] : undefined,
  }, size, brand);
}
