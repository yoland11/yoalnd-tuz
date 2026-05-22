import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";

function loadDotEnv(): void {
  const current = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(current, "..", "..", "..");
  const envPath = path.join(root, ".env");

  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    const value = raw.replace(/^["']|["']$/g, "");
    process.env[key] ??= value;
  }
}

loadDotEnv();

const {
  db,
  categoriesTable,
  deliveryZonesTable,
  galleryItemsTable,
  productsTable,
  servicesTable,
} = await import("./index");

async function tableCount(table: any): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(table);
  return row?.count ?? 0;
}

async function seedCategories(): Promise<void> {
  if (await tableCount(categoriesTable)) return;

  await db.insert(categoriesTable).values([
    { name: "Wedding", nameAr: "أعراس", slug: "wedding", sortOrder: 1 },
    { name: "Graduation", nameAr: "تخرج", slug: "graduation", sortOrder: 2 },
    { name: "Albums", nameAr: "ألبومات", slug: "albums", sortOrder: 3 },
    { name: "Gifts", nameAr: "توزيعات", slug: "gifts", sortOrder: 4 },
    { name: "Research", nameAr: "بحوث", slug: "research", sortOrder: 5 },
  ]);
}

async function seedServices(): Promise<void> {
  if (await tableCount(servicesTable)) return;

  await db.insert(servicesTable).values([
    {
      name: "Wedding Koshat",
      nameAr: "كوشات الأعراس",
      description: "Luxury wedding kosha design and setup.",
      descriptionAr: "تصميم وتنفيذ كوشات أعراس فاخرة بتفاصيل تناسب ذوقكم.",
      type: "kosha",
      icon: "sparkles",
      image: "/images/kosha.png",
      sortOrder: 1,
    },
    {
      name: "Graduation Setups",
      nameAr: "تجهيزات تخرج",
      description: "Graduation decor, photo corners, and stage details.",
      descriptionAr: "تجهيز حفلات التخرج مع منصات تصوير وديكورات متكاملة.",
      type: "setup",
      icon: "graduation-cap",
      image: "/images/setup.png",
      sortOrder: 2,
    },
    {
      name: "Photography",
      nameAr: "تصوير احترافي",
      description: "Professional photography for events and products.",
      descriptionAr: "توثيق اللحظات بعدسات احترافية وفريق متخصص.",
      type: "photography",
      icon: "camera",
      image: "/images/photo.png",
      sortOrder: 3,
    },
    {
      name: "Luxury Albums",
      nameAr: "ألبومات فاخرة",
      description: "Printed albums with premium finishes.",
      descriptionAr: "صناعة وطباعة ألبومات صور بجلود فاخرة وتفاصيل ذهبية.",
      type: "album",
      icon: "book-image",
      image: "/images/album.png",
      sortOrder: 4,
    },
    {
      name: "Event Gifts",
      nameAr: "توزيعات وهدايا",
      description: "Custom gifts and giveaways for events.",
      descriptionAr: "توزيعات وهدايا فخمة للمناسبات مصممة حسب الطلب.",
      type: "gifts",
      icon: "gift",
      image: "/images/gifts.png",
      sortOrder: 5,
    },
    {
      name: "Research Services",
      nameAr: "بحوث وتقارير",
      description: "Academic and professional research formatting.",
      descriptionAr: "خدمات كتابة وتنسيق البحوث والتقارير الأكاديمية والمهنية.",
      type: "research",
      icon: "file-text",
      image: "/images/research.png",
      sortOrder: 6,
    },
  ]);
}

async function seedProducts(): Promise<void> {
  if (await tableCount(productsTable)) return;

  await db.insert(productsTable).values([
    {
      name: "Luxury Gift Box",
      nameAr: "علبة توزيعات فاخرة",
      descriptionAr: "علبة توزيعات بتغليف أسود وذهبي للمناسبات.",
      price: "15000",
      originalPrice: "18000",
      stock: 30,
      category: "توزيعات",
      images: ["/images/gifts.png"],
      colors: ["ذهبي", "أسود", "أبيض"],
      isFeatured: true,
      sortOrder: 1,
    },
    {
      name: "Premium Photo Album",
      nameAr: "ألبوم صور فاخر",
      descriptionAr: "ألبوم صور بجودة عالية وغلاف فاخر.",
      price: "45000",
      stock: 12,
      category: "ألبومات",
      images: ["/images/album.png"],
      colors: ["أسود", "بني", "أبيض"],
      isFeatured: true,
      sortOrder: 2,
    },
    {
      name: "Graduation Mini Setup",
      nameAr: "باقة تخرج مصغرة",
      descriptionAr: "تجهيز بسيط للتخرج مع ديكور وتصوير أولي.",
      price: "85000",
      stock: 8,
      category: "تخرج",
      images: ["/images/setup.png"],
      colors: ["ذهبي", "أزرق", "أبيض"],
      isFeatured: true,
      sortOrder: 3,
    },
    {
      name: "Research Formatting",
      nameAr: "تنسيق بحث",
      descriptionAr: "تنسيق ملف بحث أو تقرير وتسليمه بصيغة جاهزة للطباعة.",
      price: "25000",
      stock: 50,
      category: "بحوث",
      images: ["/images/research.png"],
      colors: [],
      isFeatured: false,
      sortOrder: 4,
    },
  ]);
}

async function seedDeliveryZones(): Promise<void> {
  if (await tableCount(deliveryZonesTable)) return;

  await db.insert(deliveryZonesTable).values([
    { governorate: "Salah Al-Din", governorateAr: "صلاح الدين", areas: ["طوزخورماتو", "تكريت", "سامراء"], price: "5000", estimatedDays: 1 },
    { governorate: "Kirkuk", governorateAr: "كركوك", areas: ["كركوك", "داقوق"], price: "6000", estimatedDays: 1 },
    { governorate: "Baghdad", governorateAr: "بغداد", areas: ["الكرخ", "الرصافة"], price: "8000", estimatedDays: 2 },
    { governorate: "Erbil", governorateAr: "أربيل", areas: ["أربيل"], price: "9000", estimatedDays: 2 },
    { governorate: "Sulaymaniyah", governorateAr: "السليمانية", areas: ["السليمانية"], price: "9000", estimatedDays: 2 },
    { governorate: "Diyala", governorateAr: "ديالى", areas: ["بعقوبة", "خانقين"], price: "7000", estimatedDays: 2 },
    { governorate: "Nineveh", governorateAr: "نينوى", areas: ["الموصل"], price: "10000", estimatedDays: 3 },
    { governorate: "Basra", governorateAr: "البصرة", areas: ["البصرة"], price: "12000", estimatedDays: 3 },
  ]);
}

async function seedGallery(): Promise<void> {
  if (await tableCount(galleryItemsTable)) return;

  await db.insert(galleryItemsTable).values([
    { mediaUrl: "/images/kosha.png", mediaType: "image", titleAr: "كوشة فاخرة", category: "كوشات" },
    { mediaUrl: "/images/photo.png", mediaType: "image", titleAr: "جلسة تصوير", category: "تصوير" },
    { mediaUrl: "/images/setup.png", mediaType: "image", titleAr: "تجهيز تخرج", category: "تخرج" },
  ]);
}

async function main(): Promise<void> {
  await seedCategories();
  await seedServices();
  await seedProducts();
  await seedDeliveryZones();
  await seedGallery();
  console.log("Database seed completed.");
}

main()
  .catch((err) => {
    console.error("Database seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { pool } = await import("./index");
    await pool.end();
  });
