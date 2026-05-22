import { Router } from "express";
import { db } from "@workspace/db";
import { galleryItemsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { CreateGalleryItemBody, ListGalleryQueryParams } from "@workspace/api-zod";
import { requirePermission } from "../lib/admin-auth";

const router = Router();

router.get("/gallery/categories", async (req, res) => {
  const result = await db
    .select({ category: galleryItemsTable.category, count: sql<number>`count(*)::int` })
    .from(galleryItemsTable)
    .groupBy(galleryItemsTable.category);
  return res.json(result.map((r) => ({ name: r.category, count: r.count })));
});

router.get("/gallery", async (req, res) => {
  const params = ListGalleryQueryParams.safeParse(req.query);
  const { category } = params.success ? params.data : {};

  const items = await db.query.galleryItemsTable.findMany({
    where: category ? eq(galleryItemsTable.category, category) : undefined,
    orderBy: (g, { desc }) => [desc(g.createdAt)],
  });

  return res.json(items.map((i) => ({
    id: i.id,
    mediaUrl: i.mediaUrl,
    mediaType: i.mediaType,
    title: i.title ?? null,
    titleAr: i.titleAr ?? null,
    category: i.category,
    createdAt: i.createdAt.toISOString(),
  })));
});

router.post("/gallery", requirePermission("gallery"), async (req, res) => {
  const parsed = CreateGalleryItemBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });

  const [item] = await db.insert(galleryItemsTable).values(parsed.data).returning();
  return res.status(201).json({
    id: item.id,
    mediaUrl: item.mediaUrl,
    mediaType: item.mediaType,
    title: item.title ?? null,
    titleAr: item.titleAr ?? null,
    category: item.category,
    createdAt: item.createdAt.toISOString(),
  });
});

router.delete("/gallery/:id", requirePermission("gallery"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صحيح" });

  await db.delete(galleryItemsTable).where(eq(galleryItemsTable.id, id));
  return res.json({ message: "تم حذف الصورة" });
});

export default router;
