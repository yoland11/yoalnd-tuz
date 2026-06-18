import { boolean, integer, jsonb, numeric, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const koshasTable = pgTable("koshas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 160 }).notNull().unique(),
  description: text("description"),
  price: numeric("price", { precision: 14, scale: 2 }).notNull().default("0"),
  oldPrice: numeric("old_price", { precision: 14, scale: 2 }),
  discountPercentage: integer("discount_percentage").notNull().default(0),
  mainImage: text("main_image"),
  numberOfPieces: integer("number_of_pieces"),
  mainColor: varchar("main_color", { length: 80 }),
  flowerColor: varchar("flower_color", { length: 80 }),
  koshaSpace: varchar("kosha_space", { length: 120 }),
  sideConsoleSpace: varchar("side_console_space", { length: 120 }),
  accessories: jsonb("accessories").$type<string[]>().notNull().default([]),
  notes: text("notes"),
  availabilityStatus: varchar("availability_status", { length: 40 }).notNull().default("available"),
  isFeatured: boolean("is_featured").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const koshaImagesTable = pgTable("kosha_images", {
  id: serial("id").primaryKey(),
  koshaId: integer("kosha_id").notNull().references(() => koshasTable.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  imageMetadata: jsonb("image_metadata").$type<Record<string, unknown>>().notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const koshaBookingsTable = pgTable("kosha_bookings", {
  id: serial("id").primaryKey(),
  koshaId: integer("kosha_id").references(() => koshasTable.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  eventDate: text("event_date"),
  eventTime: varchar("event_time", { length: 20 }),
  cityArea: text("city_area"),
  hallLocation: text("hall_location"),
  notes: text("notes"),
  status: varchar("status", { length: 30 }).notNull().default("new"),
  internalNotes: text("internal_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertKoshaSchema = createInsertSchema(koshasTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertKoshaImageSchema = createInsertSchema(koshaImagesTable).omit({ id: true, createdAt: true });
export const insertKoshaBookingSchema = createInsertSchema(koshaBookingsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type Kosha = typeof koshasTable.$inferSelect;
export type KoshaImage = typeof koshaImagesTable.$inferSelect;
export type KoshaBooking = typeof koshaBookingsTable.$inferSelect;
export type InsertKosha = z.infer<typeof insertKoshaSchema>;
export type InsertKoshaImage = z.infer<typeof insertKoshaImageSchema>;
export type InsertKoshaBooking = z.infer<typeof insertKoshaBookingSchema>;
