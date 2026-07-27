import { boolean, index, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { galleryItemsTable } from "./gallery";
import { graduationTemplatesTable } from "./graduation";
import { graduationPackagesTable } from "./graduation-enterprise";

/**
 * Links the shared gallery media record to any number of graduation products.
 * The file lives once in gallery_items / Supabase Storage; links never duplicate it.
 */
export const graduationMediaLinksTable = pgTable(
  "graduation_media_links",
  {
    id: serial("id").primaryKey(),
    mediaId: integer("media_id")
      .notNull()
      .references(() => galleryItemsTable.id, { onDelete: "restrict" }),
    targetType: varchar("target_type", { length: 24 }).notNull(),
    templateId: integer("template_id").references(() => graduationTemplatesTable.id, { onDelete: "restrict" }),
    packageId: integer("package_id").references(() => graduationPackagesTable.id, { onDelete: "restrict" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_media_links_template_unique_idx").on(table.mediaId, table.templateId),
    uniqueIndex("graduation_media_links_package_unique_idx").on(table.mediaId, table.packageId),
    index("graduation_media_links_media_idx").on(table.mediaId),
    index("graduation_media_links_template_idx").on(table.templateId, table.sortOrder),
    index("graduation_media_links_package_idx").on(table.packageId, table.sortOrder),
  ],
);

export type GraduationMediaLink = typeof graduationMediaLinksTable.$inferSelect;
