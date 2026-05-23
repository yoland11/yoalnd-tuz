import { pgTable, serial, varchar, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const otpCodesTable = pgTable("otp_codes", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  code: varchar("code", { length: 10 }),
  codeHash: text("code_hash").notNull().default(""),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type OtpCode = typeof otpCodesTable.$inferSelect;
