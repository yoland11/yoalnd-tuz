import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  index,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { customerFollowupsTable } from "./customer-followups";
import { notificationsTable } from "./admin-extensions";
export const eventMessageConsentsTable = pgTable(
  "event_message_consents",
  {
    recipientKey: varchar("recipient_key", { length: 80 }).notNull(),
    phone: varchar("phone", { length: 30 }).notNull(),
    optedIn: boolean("opted_in").notNull().default(false),
    blocked: boolean("blocked").notNull().default(false),
    evidence: text("evidence").notNull(),
    actorId: integer("actor_id")
      .notNull()
      .references(() => staffTable.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.recipientKey, t.phone] })],
);
export const eventMessageCampaignsTable = pgTable(
  "event_message_campaigns",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    templateKey: varchar("template_key", { length: 40 }).notNull(),
    channel: varchar("channel", { length: 12 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    suspensionCode: varchar("suspension_code", { length: 80 }),
    createdBy: integer("created_by")
      .notNull()
      .references(() => staffTable.id, { onDelete: "restrict" }),
    approvedBy: integer("approved_by").references(() => staffTable.id, {
      onDelete: "restrict",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    providerTemplate: jsonb("provider_template"),
    requestToken: varchar("request_token", { length: 160 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("event_message_campaigns_due_idx").on(t.status, t.scheduledAt, t.id),
    check(
      "event_message_campaigns_channel_check",
      sql`${t.channel} IN ('manual','meta')`,
    ),
    check(
      "event_message_campaigns_status_check",
      sql`${t.status} IN ('pending','approved','rejected','cancelled','complete','suspended')`,
    ),
    check(
      "event_message_campaigns_approval_check",
      sql`${t.status} NOT IN ('approved','complete') OR (${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL)`,
    ),
  ],
);
export const eventMessageRecipientsTable = pgTable(
  "event_message_recipients",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => eventMessageCampaignsTable.id, {
        onDelete: "restrict",
      }),
    recipientKey: varchar("recipient_key", { length: 80 }).notNull(),
    phone: varchar("phone", { length: 30 }).notNull(),
    snapshot: jsonb("snapshot").notNull(),
    message: text("message").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    providerMessageId: text("provider_message_id").unique(),
    claimToken: varchar("claim_token", { length: 64 }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    errorCode: varchar("error_code", { length: 80 }),
  },
  (t) => [
    uniqueIndex("event_message_recipients_campaign_phone_uq").on(
      t.campaignId,
      t.phone,
    ),
    uniqueIndex("event_message_recipients_campaign_key_uq").on(
      t.campaignId,
      t.recipientKey,
    ),
    index("event_message_recipients_pending_idx").on(
      t.campaignId,
      t.status,
      t.id,
    ),
    check(
      "event_message_recipients_status_check",
      sql`${t.status} IN ('pending','sending','accepted','sent','delivered','read','failed','unknown','manual_opened','blocked')`,
    ),
  ],
);
export const eventMessageEventsTable = pgTable("event_message_events", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(
    () => eventMessageCampaignsTable.id,
    { onDelete: "restrict" },
  ),
  recipientId: integer("recipient_id").references(
    () => eventMessageRecipientsTable.id,
    { onDelete: "restrict" },
  ),
  actorId: integer("actor_id").references(() => staffTable.id, {
    onDelete: "restrict",
  }),
  action: varchar("action", { length: 40 }).notNull(),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const eventMessageDeliveryInboxTable = pgTable(
  "event_message_delivery_inbox",
  {
    providerMessageId: text("provider_message_id").primaryKey(),
    phone: varchar("phone", { length: 30 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "event_message_delivery_inbox_status_check",
      sql`${t.status} IN ('sent','delivered','read','failed')`,
    ),
  ],
);
export const eventFollowupRemindersTable = pgTable(
  "event_followup_reminders",
  {
    followupId: integer("followup_id")
      .notNull()
      .references(() => customerFollowupsTable.id, { onDelete: "restrict" }),
    followupAt: timestamp("followup_at", { withTimezone: true }).notNull(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staffTable.id, { onDelete: "restrict" }),
    notificationId: integer("notification_id")
      .notNull()
      .references(() => notificationsTable.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.followupId, t.followupAt, t.staffId] })],
);
