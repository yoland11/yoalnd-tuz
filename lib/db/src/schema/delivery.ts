import { pgTable, serial, text, numeric, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type PricedRegion = { name: string; price: number; estimatedDays?: number };

export const deliveryZonesTable = pgTable("delivery_zones", {
  id: serial("id").primaryKey(),
  governorate: text("governorate").notNull(),
  governorateAr: text("governorate_ar").notNull(),
  areas: jsonb("areas").$type<string[]>().notNull().default([]),
  pricedRegions: jsonb("priced_regions").$type<PricedRegion[]>().notNull().default([]),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  estimatedDays: integer("estimated_days").notNull().default(2),
  isActive: boolean("is_active").notNull().default(true),
});

export const insertDeliveryZoneSchema = createInsertSchema(deliveryZonesTable).omit({ id: true });
export type InsertDeliveryZone = z.infer<typeof insertDeliveryZoneSchema>;
export type DeliveryZone = typeof deliveryZonesTable.$inferSelect;
