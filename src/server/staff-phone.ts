import { z } from "zod/v4";
import { normalizeIraqiPhone } from "../lib/phone";

/** Omitted PATCH fields preserve the contact. Empty/null explicitly removes it. */
export const staffPhoneUpdateSchema = z.object({
  phone: z.string().trim().max(40)
    .refine(value => !value || (/^[+()\s.\-0-9٠-٩۰-۹]+$/.test(value) && normalizeIraqiPhone(value) !== null), "أدخل رقم موبايل عراقي صحيحاً أو اتركه فارغاً")
    .transform(value => value ? normalizeIraqiPhone(value) : null)
    .nullable().optional(),
});
