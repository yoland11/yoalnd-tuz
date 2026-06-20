import { boolean, date, integer, jsonb, numeric, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
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
  brideName: text("bride_name"),
  groomName: text("groom_name"),
  eventDate: text("event_date"),
  eventTime: varchar("event_time", { length: 20 }),
  eventType: varchar("event_type", { length: 40 }),
  serviceLevel: varchar("service_level", { length: 20 }),
  venueType: varchar("venue_type", { length: 20 }),
  themeColor: varchar("theme_color", { length: 20 }),
  province: text("province"),
  area: text("area"),
  mahalla: text("mahalla"),
  nearestPoint: text("nearest_point"),
  addressNotes: text("address_notes"),
  bridePhone: varchar("bride_phone", { length: 20 }),
  groomPhone: varchar("groom_phone", { length: 20 }),
  alternatePhone: varchar("alternate_phone", { length: 20 }),
  cityArea: text("city_area"),
  hallLocation: text("hall_location"),
  selectedAddons: jsonb("selected_addons").$type<string[]>().notNull().default([]),
  welcomeBoards: jsonb("welcome_boards").$type<string[]>().notNull().default([]),
  selectedAccessories: jsonb("selected_accessories").$type<string[]>().notNull().default([]),
  venueImages: jsonb("venue_images").$type<string[]>().notNull().default([]),
  bookingDetails: jsonb("booking_details").$type<Record<string, unknown>>().notNull().default({}),
  notes: text("notes"),
  status: varchar("status", { length: 30 }).notNull().default("new"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  remainingAmount: numeric("remaining_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("unpaid"),
  dueDate: date("due_date"),
  internalNotes: text("internal_notes"),
  // Kosha Staff Portal — field-crew execution stage + optional assignment.
  executionStage: varchar("execution_stage", { length: 30 }).notNull().default("preparing"),
  assignedStaffId: integer("assigned_staff_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const koshaAccessoriesTable = pgTable("kosha_accessories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  price: numeric("price", { precision: 14, scale: 2 }).notNull().default("0"),
  description: text("description"),
  mainImage: text("main_image"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const koshaAddonsTable = pgTable("kosha_addons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  price: numeric("price", { precision: 14, scale: 2 }).notNull().default("0"),
  description: text("description"),
  mainImage: text("main_image"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const koshaWelcomeBoardsTable = pgTable("kosha_welcome_boards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  price: numeric("price", { precision: 14, scale: 2 }).notNull().default("0"),
  description: text("description"),
  mainImage: text("main_image"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const koshaProvincesTable = pgTable("kosha_provinces", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertKoshaSchema = createInsertSchema(koshasTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertKoshaImageSchema = createInsertSchema(koshaImagesTable).omit({ id: true, createdAt: true });
export const insertKoshaBookingSchema = createInsertSchema(koshaBookingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertKoshaAccessorySchema = createInsertSchema(koshaAccessoriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertKoshaAddonSchema = createInsertSchema(koshaAddonsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertKoshaWelcomeBoardSchema = createInsertSchema(koshaWelcomeBoardsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertKoshaProvinceSchema = createInsertSchema(koshaProvincesTable).omit({ id: true, createdAt: true, updatedAt: true });

export type Kosha = typeof koshasTable.$inferSelect;
export type KoshaImage = typeof koshaImagesTable.$inferSelect;
export type KoshaBooking = typeof koshaBookingsTable.$inferSelect;
export type KoshaAccessory = typeof koshaAccessoriesTable.$inferSelect;
export type KoshaAddon = typeof koshaAddonsTable.$inferSelect;
export type KoshaWelcomeBoard = typeof koshaWelcomeBoardsTable.$inferSelect;
export type KoshaProvince = typeof koshaProvincesTable.$inferSelect;
export type InsertKosha = z.infer<typeof insertKoshaSchema>;
export type InsertKoshaImage = z.infer<typeof insertKoshaImageSchema>;
export type InsertKoshaBooking = z.infer<typeof insertKoshaBookingSchema>;
export type InsertKoshaAccessory = z.infer<typeof insertKoshaAccessorySchema>;
export type InsertKoshaAddon = z.infer<typeof insertKoshaAddonSchema>;
export type InsertKoshaWelcomeBoard = z.infer<typeof insertKoshaWelcomeBoardSchema>;
export type InsertKoshaProvince = z.infer<typeof insertKoshaProvinceSchema>;
