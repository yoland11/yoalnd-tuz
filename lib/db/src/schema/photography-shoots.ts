import { boolean, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { staffTable } from "./staff";
import { photographyEventsTable } from "./photography-staff";

/**
 * Field-operations layer for photography.
 *
 * `photography_events` already models the booking (customer, date, location, assigned
 * photographer) and `photography_orders` models the print orders that come out of it.
 * Neither is touched here: a shoot is a purely additive 1:1 side-table that tracks what
 * happens on the day — preparation, travel, shooting, hand-off — so existing print and
 * payment workflows keep working exactly as before.
 */
export const PHOTOGRAPHY_SHOOT_STAGES = [
  "assigned",
  "preparing",
  "on_the_way",
  "arrived",
  "shooting",
  "uploading",
  "editing",
  "ready_for_review",
  "delivered",
  "completed",
] as const;
export type PhotographyShootStage = (typeof PHOTOGRAPHY_SHOOT_STAGES)[number];

/** Pre-shoot checklist keys. Every one must be confirmed before leaving `preparing`. */
export const PHOTOGRAPHY_CHECKLIST_KEYS = [
  "camera_ready",
  "lens_cleaned",
  "batteries_charged",
  "cards_empty",
  "mic_working",
  "flash_working",
  "gimbal_calibrated",
  "drone_ready",
  "tripod_packed",
] as const;
export type PhotographyChecklistKey = (typeof PHOTOGRAPHY_CHECKLIST_KEYS)[number];

export const photographyShootsTable = pgTable(
  "photography_shoots",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .unique()
      .references(() => photographyEventsTable.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 30 }).notNull().default("assigned"),

    // Venue + coordinates drive the Google Maps deep link and the arrival check-in.
    venue: text("venue"),
    gpsLat: numeric("gps_lat", { precision: 10, scale: 7 }),
    gpsLng: numeric("gps_lng", { precision: 10, scale: 7 }),
    eventTime: varchar("event_time", { length: 10 }),

    // Checklist state: { [key]: true }. `checklistCompletedAt` is the gate.
    checklist: jsonb("checklist").notNull().default({}),
    checklistCompletedAt: timestamp("checklist_completed_at"),
    checklistCompletedBy: integer("checklist_completed_by").references(() => staffTable.id, { onDelete: "set null" }),

    // Stage milestones — written once, by the transition that reaches them.
    departedAt: timestamp("departed_at"),
    arrivedAt: timestamp("arrived_at"),
    arrivedLat: numeric("arrived_lat", { precision: 10, scale: 7 }),
    arrivedLng: numeric("arrived_lng", { precision: 10, scale: 7 }),
    shootingStartedAt: timestamp("shooting_started_at"),
    shootingEndedAt: timestamp("shooting_ended_at"),
    deliveredAt: timestamp("delivered_at"),
    completedAt: timestamp("completed_at"),

    notes: text("notes"),
    cancelledAt: timestamp("cancelled_at"),
    createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    stageIdx: index("photography_shoots_stage_idx").on(table.stage, table.updatedAt),
  }),
);

/** Immutable stage-transition log — the timeline shown on the shoot screen. */
export const photographyShootEventsTable = pgTable(
  "photography_shoot_events",
  {
    id: serial("id").primaryKey(),
    shootId: integer("shoot_id")
      .notNull()
      .references(() => photographyShootsTable.id, { onDelete: "cascade" }),
    staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
    staffName: text("staff_name").notNull().default(""),
    type: varchar("type", { length: 40 }).notNull(),
    fromStage: varchar("from_stage", { length: 30 }),
    toStage: varchar("to_stage", { length: 30 }),
    note: text("note"),
    lat: numeric("lat", { precision: 10, scale: 7 }),
    lng: numeric("lng", { precision: 10, scale: 7 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    shootIdx: index("photography_shoot_events_shoot_idx").on(table.shootId, table.createdAt),
  }),
);

/** The crew working a shoot alongside the lead photographer. */
export const photographyShootCrewTable = pgTable(
  "photography_shoot_crew",
  {
    id: serial("id").primaryKey(),
    shootId: integer("shoot_id")
      .notNull()
      .references(() => photographyShootsTable.id, { onDelete: "cascade" }),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staffTable.id, { onDelete: "cascade" }),
    staffName: text("staff_name").notNull().default(""),
    role: varchar("role", { length: 30 }).notNull().default("photographer"),
    isLead: boolean("is_lead").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueMember: unique("photography_shoot_crew_unique").on(table.shootId, table.staffId),
  }),
);

export const insertPhotographyShootSchema = createInsertSchema(photographyShootsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type PhotographyShoot = typeof photographyShootsTable.$inferSelect;
export type PhotographyShootEvent = typeof photographyShootEventsTable.$inferSelect;
export type PhotographyShootCrew = typeof photographyShootCrewTable.$inferSelect;
export type InsertPhotographyShoot = z.infer<typeof insertPhotographyShootSchema>;
