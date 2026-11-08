/**
 * The lines of a booking invoice: everything the booking holds — its services,
 * the flowers, gifts and video picked with them, photography lines, store
 * products, sound equipment and linked assets — grouped, priced where the
 * booking prices them, and marked «ضمن …» where they are part of a price.
 *
 * Pure: it reads values the server already loaded and computes no money of its
 * own except the agreed base amount, which is what the stored total leaves after
 * every separately priced line. Σ priced lines − discount always equals the
 * stored booking total, so the invoice never disagrees with the booking.
 */

export type BookingInvoiceLine = {
  id: string;
  /** Section heading the line is printed under. */
  group: string;
  productNameAr: string;
  category: string;
  description: string;
  selectedColor: string | null;
  quantity: number;
  /** Unit price; 0 for an included line. */
  price: number;
  discount: number;
  /** Part of the booking without a price of its own; `includedLabel` says where its money is. */
  included?: boolean;
  includedLabel?: string;
};

export type BookingInvoiceInput = {
  /** Stored booking total (already net of the booking discount). */
  total: number;
  /** Booking-level discount already taken off `total`. */
  discount: number;
  /** service_orders.custom_fields */
  fields: Record<string, unknown>;
  /** serviceOrderTransportation(fields) */
  transport: Record<string, unknown> | null;
  transportDescription?: string | null;
  /** The booked service's name, for bookings saved before the booking centre. */
  serviceName?: string | null;
  serviceItems?: Array<{ id: number | string; productName: string; unit?: string | null; quantity: number; unitPrice: number; discount: number }>;
  products?: Array<{ id: number | string; productName: string; variantLabel?: string | null; color?: string | null; category?: string | null; quantity: number; unitPrice: number; discount: number; status?: string | null }>;
  assets?: Array<{ productId: number; name: string; assetCode?: string | null; serialNumber?: string | null; category?: string | null; quantity: number }>;
};

export const BOOKING_SERVICE_LABELS: Record<string, string> = {
  kosha: "الكوشة",
  photography: "التصوير",
  sound: "الصوت",
  flowers: "الورد",
  gifts: "الهدايا والتوزيعات",
  graduation: "التخرج",
  led: "شاشات LED",
  transportation: "النقل",
  decorations: "الديكور",
};

export const INVOICE_GROUPS = {
  services: "خدمات الحجز",
  flowers: "الورد",
  gifts: "الهدايا والتوزيعات",
  photography: "التصوير",
  products: "منتجات المتجر",
  sound: "معدات الصوت",
  assets: "الأصول والمعدات",
} as const;

const round2 = (value: number) => Math.round(value * 100) / 100;
const num = (value: unknown) => {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const str = (value: unknown) => (typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim());
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item)) : [];
const named = (item: Record<string, unknown>) => {
  const name = str(item.name) || str(item.productName) || str(item.nameAr) || "منتج";
  const variant = str(item.variantLabel);
  return { name, variant };
};

/** What a line adds to the invoice: nothing for an included line. */
export const lineTotal = (row: Pick<BookingInvoiceLine, "included" | "price" | "quantity" | "discount">) =>
  row.included ? 0 : Math.max(0, row.price * row.quantity - row.discount);

/** Store products held for the booking from its workspace (released lines are no longer part of it). */
export function bookingProductInvoiceLines(products: NonNullable<BookingInvoiceInput["products"]>): BookingInvoiceLine[] {
  return products.filter((item) => item.status !== "released").map((item) => ({
    id: `product-${item.id}`,
    group: INVOICE_GROUPS.products,
    productNameAr: str(item.productName) || "منتج",
    category: str(item.category) || "منتج",
    description: str(item.variantLabel),
    selectedColor: str(item.color) || null,
    quantity: Math.max(1, num(item.quantity) || 1),
    price: round2(Math.max(0, num(item.unitPrice))),
    discount: Math.max(0, num(item.discount)),
  }));
}

/** Equipment and assets linked to the booking: listed with their quantity, priced inside the booking. */
export function bookingAssetInvoiceLines(assets: NonNullable<BookingInvoiceInput["assets"]>): BookingInvoiceLine[] {
  return assets.map((asset) => ({
    id: `asset-${asset.productId}`,
    group: INVOICE_GROUPS.assets,
    productNameAr: str(asset.name) || "أصل",
    category: str(asset.category) || "معدات",
    description: [str(asset.assetCode), str(asset.serialNumber)].filter(Boolean).join(" · "),
    selectedColor: null,
    quantity: Math.max(1, num(asset.quantity) || 1),
    price: 0,
    discount: 0,
    included: true,
    includedLabel: "ضمن الحجز",
  }));
}

export function buildServiceBookingInvoice(input: BookingInvoiceInput): {
  items: BookingInvoiceLine[];
  subtotal: number;
  discount: number;
  total: number;
} {
  const fields = input.fields ?? {};
  const total = round2(Math.max(0, num(input.total)));
  const storedDiscount = round2(Math.max(0, num(input.discount)));
  const services = (() => {
    const seen = new Set<string>();
    return list(fields.bookingCenterServices).flatMap((item) => {
      const type = str(item.type).toLowerCase();
      if (!type || seen.has(type)) return [];
      seen.add(type);
      return [{ type, amount: Math.max(0, num(item.amount)), notes: str(item.notes) }];
    });
  })();
  const types = new Set(services.map((service) => service.type));

  const serviceRows: BookingInvoiceLine[] = [];
  const detailRows: BookingInvoiceLine[] = [];
  const line = (row: Omit<BookingInvoiceLine, "selectedColor" | "discount"> & Partial<Pick<BookingInvoiceLine, "selectedColor" | "discount">>): BookingInvoiceLine =>
    ({ selectedColor: null, discount: 0, ...row, quantity: Math.max(1, num(row.quantity) || 1), price: round2(Math.max(0, num(row.price))) });

  // Store-priced picks saved with the booking (priced into its total at booking time).
  const picked = (key: "flowerItems" | "giftItems" | "videoItems", group: string, category: string) =>
    list(fields[key]).map((item, index) => {
      const { name, variant } = named(item);
      return line({ id: `${key}-${index}`, group, productNameAr: name, category, description: "", selectedColor: variant || null, quantity: num(item.quantity), price: num(item.unitPrice) });
    });
  const flowers = types.has("flowers") || !services.length ? picked("flowerItems", INVOICE_GROUPS.flowers, "ورد") : [];
  const gifts = types.has("gifts") || !services.length ? picked("giftItems", INVOICE_GROUPS.gifts, "توزيعات") : [];
  const video = types.has("photography") || !services.length ? picked("videoItems", INVOICE_GROUPS.photography, "تصوير فيديو") : [];
  const aerialPrice = types.has("photography") && fields.aerialPhotographyRequested === true ? num(fields.aerialPhotographyPrice) : 0;
  const aerial = aerialPrice > 0 ? [line({ id: "aerial", group: INVOICE_GROUPS.photography, productNameAr: "تصوير جوي", category: "تصوير", description: "", quantity: 1, price: aerialPrice })] : [];
  const photographyLines = (input.serviceItems ?? []).map((item) =>
    line({ id: `service-item-${item.id}`, group: INVOICE_GROUPS.photography, productNameAr: str(item.productName) || "بند تصوير", category: "خدمات التصوير", description: str(item.unit), quantity: num(item.quantity), price: num(item.unitPrice), discount: Math.max(0, num(item.discount)) }));
  detailRows.push(...flowers, ...gifts, ...video, ...aerial, ...photographyLines);

  // Transport follows the transport card (the one reader of a service order's transport).
  const transport = input.transport;
  if (transport?.mode === "ajn") {
    const fee = num(transport.fee);
    serviceRows.push(transport.inTotal === true
      ? line({ id: "transport", group: INVOICE_GROUPS.services, productNameAr: "النقل بواسطة AJN", category: "النقل", description: str(input.transportDescription), quantity: 1, price: fee })
      : line({ id: "transport", group: INVOICE_GROUPS.services, productNameAr: "النقل بواسطة AJN", category: "النقل", description: [str(input.transportDescription), fee > 0 ? `الأجرة ${fee.toLocaleString("en-US")} د.ع للعلم` : ""].filter(Boolean).join(" · "), quantity: 1, price: 0, included: true, includedLabel: "خارج الإجمالي" }));
  } else if (transport?.mode === "customer" || (types.has("transportation") && !transport)) {
    serviceRows.push(line({ id: "transport", group: INVOICE_GROUPS.services, productNameAr: "النقل", category: "النقل", description: transport?.mode === "customer" ? "النقل من مسؤولية الزبون" : "لم يُحدد النقل بعد", quantity: 1, price: 0, included: true, includedLabel: transport?.mode === "customer" ? "على الزبون" : "—" }));
  }

  // Services whose money is not carried by their own lines are part of the agreed base amount.
  const inBase: BookingInvoiceLine[] = [];
  for (const service of services) {
    if (service.type === "transportation") continue;
    const label = BOOKING_SERVICE_LABELS[service.type] ?? service.type;
    const detailed = service.type === "flowers" ? flowers.length > 0
      : service.type === "gifts" ? gifts.length > 0
        : service.type === "photography" ? video.length + aerial.length + photographyLines.length > 0
          : false;
    const photoSession = service.type === "photography" && Array.isArray(fields.photographyKinds) && fields.photographyKinds.includes("photo_session");
    if (detailed && !photoSession) continue;
    if (!detailed && service.amount > 0) {
      serviceRows.push(line({ id: `service-${service.type}`, group: INVOICE_GROUPS.services, productNameAr: label, category: "خدمة", description: service.notes, quantity: 1, price: service.amount }));
      continue;
    }
    const kosha = service.type === "kosha" && fields.koshaSelection && typeof fields.koshaSelection === "object" ? fields.koshaSelection as Record<string, unknown> : null;
    inBase.push(line({ id: `service-${service.type}`, group: INVOICE_GROUPS.services, productNameAr: kosha && str(kosha.name) ? `${label}: ${str(kosha.name)}` : label, category: "خدمة", description: service.notes, quantity: 1, price: 0, included: true, includedLabel: "ضمن المبلغ الأساسي" }));
  }
  if (!services.length && str(input.serviceName))
    inBase.push(line({ id: "service-main", group: INVOICE_GROUPS.services, productNameAr: str(input.serviceName), category: "خدمة", description: "", quantity: 1, price: 0, included: true, includedLabel: "ضمن المبلغ الأساسي" }));

  const products = bookingProductInvoiceLines(input.products ?? []);
  const assets = input.assets ?? [];
  const assetIds = new Set(assets.map((asset) => Number(asset.productId)));
  const sound = list(fields.soundItems).filter((item) => !assetIds.has(Number(item.productId))).map((item, index) =>
    line({ id: `sound-${index}`, group: INVOICE_GROUPS.sound, productNameAr: named(item).name, category: "صوت", description: str(item.barcode), quantity: num(item.quantity), price: 0, included: true, includedLabel: "ضمن خدمة الصوت" }));
  const assetRows = bookingAssetInvoiceLines(assets);

  const priced = round2([...serviceRows, ...detailRows, ...products].reduce((sum, row) => sum + lineTotal(row), 0));
  const base = round2(total + storedDiscount - priced);
  if (base > 0.009) {
    if (inBase.length === 1) inBase[0] = { ...inBase[0], price: base, included: false, includedLabel: undefined };
    else inBase.push(line({ id: "base", group: INVOICE_GROUPS.services, productNameAr: inBase.length ? "المبلغ الأساسي المتفق عليه" : "مبلغ الحجز المتفق عليه", category: "خدمة", description: inBase.length ? `يشمل: ${inBase.map((row) => row.productNameAr).join("، ")}` : "", quantity: 1, price: base }));
  }

  const items = [...inBase, ...serviceRows, ...detailRows, ...products, ...sound, ...assetRows];
  const subtotal = round2(items.reduce((sum, row) => sum + lineTotal(row), 0));
  // Lines priced above the stored total (a discount given after they were added) show as discount.
  return { items, subtotal, discount: round2(Math.max(0, subtotal - total)), total };
}
