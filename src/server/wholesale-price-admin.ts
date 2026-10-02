import { z } from "zod/v4";
import { validateWholesaleTiers, type WholesalePriceTier } from "./wholesale-pricing";

export const wholesalePriceUpdateSchema = z.object({
  wholesalePrice: z.coerce.number().finite().nonnegative().nullable().optional(),
  tiers: z.array(z.object({
    minimumQuantity: z.coerce.number().finite(),
    unitPrice: z.coerce.number().finite(),
    isActive: z.boolean().optional().default(true),
  })).max(100).default([]),
}).superRefine((input, context) => {
  const result = validateWholesaleTiers(input.tiers as WholesalePriceTier[]);
  if (!result.ok) context.addIssue({ code: "custom", path: ["tiers"], message: result.message });
});

export const customerProductPriceSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().finite().nonnegative(),
});
