import { z } from "zod/v4";

const optionalTrimmedText = (max: number) =>
  z.string().trim().max(max).nullish().transform((value) => value || null);

export const wholesaleCustomerProfileSchema = z.object({
  customerType: z.enum(["retail", "wholesale"]).default("retail"),
  businessName: optionalTrimmedText(240),
  ownerName: optionalTrimmedText(200),
  province: optionalTrimmedText(100),
  creditLimit: z.coerce.number().finite().nonnegative().nullable().optional().transform((value) => value ?? null),
  specialDiscountPercent: z.coerce.number().finite().min(0).max(100).nullable().optional().transform((value) => value ?? null),
  notes: optionalTrimmedText(2_000),
}).superRefine((profile, context) => {
  if (profile.customerType !== "wholesale") return;
  if (!profile.businessName)
    context.addIssue({ code: "custom", path: ["businessName"], message: "اسم المتجر مطلوب لعميل الجملة" });
  if (!profile.ownerName)
    context.addIssue({ code: "custom", path: ["ownerName"], message: "اسم صاحب المتجر مطلوب لعميل الجملة" });
});

export type WholesaleCustomerProfile = z.infer<typeof wholesaleCustomerProfileSchema>;

export function customerWholesaleDiscount(amount: number, percent: number | null | undefined): number {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("مبلغ الفاتورة غير صالح");
  const discountPercent = percent == null ? 0 : Number(percent);
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100)
    throw new Error("نسبة خصم العميل غير صالحة");
  return Math.round((amount * discountPercent / 100 + Number.EPSILON) * 100) / 100;
}
