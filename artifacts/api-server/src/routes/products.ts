import { Router } from "express";
import { db } from "@workspace/db";
import { productsTable, reviewsTable } from "@workspace/db";
import { eq, ilike, and, sql } from "drizzle-orm";
import { CreateProductBody, UpdateProductBody, ListProductsQueryParams } from "@workspace/api-zod";
import { requirePermission } from "../lib/admin-auth";

const router = Router();

function formatProduct(p: any, avgRating?: number, reviewCount?: number) {
  return {
    id: p.id,
    name: p.name,
    nameAr: p.nameAr,
    description: p.description ?? null,
    descriptionAr: p.descriptionAr ?? null,
    price: parseFloat(p.price),
    originalPrice: p.originalPrice ? parseFloat(p.originalPrice) : null,
    stock: p.stock,
    category: p.category ?? null,
    images: p.images ?? [],
    colors: p.colors ?? [],
    subcategory: p.subcategory ?? null,
    isFeatured: p.isFeatured,
    isActive: p.isActive ?? true,
    sortOrder: p.sortOrder ?? 0,
    rating: avgRating ?? null,
    reviewCount: reviewCount ?? 0,
    createdAt: p.createdAt.toISOString(),
  };
}

router.get("/products/featured", async (req, res) => {
  const products = await db.query.productsTable.findMany({
    where: eq(productsTable.isFeatured, true),
    limit: 8,
  });
  return res.json(products.map((p) => formatProduct(p)));
});

router.get("/products/categories", async (req, res) => {
  const result = await db
    .select({ category: productsTable.category, count: sql<number>`count(*)::int` })
    .from(productsTable)
    .where(sql`${productsTable.category} is not null`)
    .groupBy(productsTable.category);
  return res.json(result.map((r) => ({ name: r.category!, count: r.count })));
});

router.get("/products", async (req, res) => {
  const params = ListProductsQueryParams.safeParse(req.query);
  const { category, search, inStock } = params.success ? params.data : {};

  const products = await db.query.productsTable.findMany({
    where: and(
      category ? eq(productsTable.category, category) : undefined,
      search ? ilike(productsTable.nameAr, `%${search}%`) : undefined,
      inStock ? sql`${productsTable.stock} > 0` : undefined
    ),
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });
  return res.json(products.map((p) => formatProduct(p)));
});

router.get("/products/:id", async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صحيح" });

  const product = await db.query.productsTable.findFirst({
    where: eq(productsTable.id, id),
  });
  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

  const reviews = await db.query.reviewsTable.findMany({
    where: eq(reviewsTable.productId, id),
  });
  const avgRating = reviews.length > 0
    ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length
    : undefined;

  return res.json(formatProduct(product, avgRating, reviews.length));
});

router.post("/products", requirePermission("products"), async (req, res) => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });

  const data = parsed.data as any;
  const [product] = await db.insert(productsTable).values({
    name: data.name,
    nameAr: data.nameAr,
    description: data.description,
    descriptionAr: data.descriptionAr,
    price: data.price.toString(),
    originalPrice: data.originalPrice?.toString(),
    stock: data.stock,
    category: data.category,
    images: data.images ?? [],
    colors: data.colors ?? [],
    isFeatured: data.isFeatured ?? false,
    subcategory: data.subcategory ?? null,
    isActive: data.isActive ?? true,
    sortOrder: data.sortOrder ?? 0,
  }).returning();

  return res.status(201).json(formatProduct(product));
});

router.patch("/products/:id", requirePermission("products"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صحيح" });

  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });

  const data = parsed.data as any;
  const update: any = { updatedAt: new Date() };
  if (data.name !== undefined) update.name = data.name;
  if (data.nameAr !== undefined) update.nameAr = data.nameAr;
  if (data.description !== undefined) update.description = data.description;
  if (data.price !== undefined) update.price = data.price.toString();
  if (data.originalPrice !== undefined) update.originalPrice = data.originalPrice.toString();
  if (data.stock !== undefined) update.stock = data.stock;
  if (data.category !== undefined) update.category = data.category;
  if (data.images !== undefined) update.images = data.images;
  if (data.colors !== undefined) update.colors = data.colors;
  if (data.isFeatured !== undefined) update.isFeatured = data.isFeatured;
  if (data.descriptionAr !== undefined) update.descriptionAr = data.descriptionAr;
  if (data.subcategory !== undefined) update.subcategory = data.subcategory;
  if (data.isActive !== undefined) update.isActive = data.isActive;
  if (data.sortOrder !== undefined) update.sortOrder = data.sortOrder;

  const [product] = await db.update(productsTable).set(update).where(eq(productsTable.id, id)).returning();
  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

  return res.json(formatProduct(product));
});

router.delete("/products/:id", requirePermission("products"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صحيح" });

  await db.delete(productsTable).where(eq(productsTable.id, id));
  return res.json({ message: "تم حذف المنتج" });
});

export default router;
