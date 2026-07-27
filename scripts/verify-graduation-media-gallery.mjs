/** Read-only contract checks for the shared Graduation Supplies media gallery. */
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const sharedSchema = read("lib/db/src/schema/gallery.ts");
const linkSchema = read("lib/db/src/schema/graduation-media.ts");
const migration = read("lib/db/migrations/0071_graduation_media_gallery.sql");
const server = read("src/server/graduation.ts");
const publicGallery = read("src/components/graduation-media-gallery.tsx");
const publicView = read("src/views/graduation.tsx");
const adminGallery = read("src/views/admin/graduation-media-gallery.tsx");
const adminView = read("src/views/admin/graduation.tsx");
const adminLayout = read("src/views/admin/_layout.tsx");

const checks = [
  [
    "extends the shared gallery registry",
    sharedSchema.includes('scope: varchar("scope"') &&
      linkSchema.includes("galleryItemsTable") &&
      !linkSchema.includes('pgTable("graduation_media"'),
  ],
  [
    "non-destructive additive migration",
    migration.includes("ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS") &&
      migration.includes("CREATE TABLE IF NOT EXISTS graduation_media_links") &&
      !/drop\s+(table|column)|truncate\s+/i.test(migration),
  ],
  [
    "one media file can link to multiple products",
    linkSchema.includes("mediaId") &&
      linkSchema.includes("templateId") &&
      linkSchema.includes("packageId") &&
      server.includes("replaceGraduationMediaLinks"),
  ],
  [
    "reuses Supabase media persistence",
    server.includes("persistMedia(data.mediaUrl") &&
      server.includes("SUPABASE_STORAGE_BUCKET"),
  ],
  [
    "validates image and video uploads",
    server.includes("GRADUATION_IMAGE_MIMES") &&
      server.includes("GRADUATION_VIDEO_MIMES") &&
      server.includes("GRADUATION_VIDEO_BYTES"),
  ],
  [
    "safe soft-delete preserves files and links",
    server.includes("softDelete: action === \"delete\"") &&
      server.includes("deletedAt: now") &&
      !server.includes("storage/v1/object/remove"),
  ],
  [
    "all gallery mutations are audited",
    ["graduation_media_uploaded", "graduation_media_updated", "graduation_media_reordered"]
      .every((action) => server.includes(action)) &&
      server.includes("auditGraduationMedia"),
  ],
  [
    "customer gallery filters and responsive viewer",
    ["gown", "sash", "cap", "packages", "images", "videos"]
      .every((filter) => publicGallery.includes(`\"${filter}\"`)) &&
      publicGallery.includes("MediaViewer") &&
      publicGallery.includes('loading="lazy"'),
  ],
  [
    "video playback is deferred and never autoplayed",
    publicGallery.includes('preload="metadata"') &&
      !publicGallery.includes("autoPlay") &&
      publicGallery.includes("youtube-nocookie.com"),
  ],
  [
    "custom package builder shows linked media",
    publicView.includes("GraduationMediaGallery") &&
      publicView.includes('target={{ type: "template", id: templateId }}') &&
      publicView.includes('type: "package"'),
  ],
  [
    "admin reuses the existing multi-media uploader",
    adminGallery.includes("ImageUploadEditor") &&
      adminGallery.includes("multiple={!editing}") &&
      adminGallery.includes("allowVideo"),
  ],
  [
    "admin supports visibility, featured, main image and ordering",
    ["customerVisible", "isFeatured", "isPrimary", "displayOrder", "draggable"]
      .every((field) => adminGallery.includes(field)),
  ],
  [
    "admin route is integrated into the existing graduation module",
    adminView.includes('Mode =') &&
      adminView.includes('"gallery"') &&
      adminLayout.includes("/admin/graduation/gallery"),
  ],
];

let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
  if (!passed) failed = true;
}

if (failed) process.exit(1);
console.log(`Graduation media gallery contract checks passed (${checks.length}/${checks.length})`);
