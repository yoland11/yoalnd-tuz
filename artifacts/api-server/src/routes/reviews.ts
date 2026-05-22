import { Router } from "express";
import { db } from "@workspace/db";
import { reviewsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateReviewBody, ListReviewsQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/reviews", async (req, res) => {
  const params = ListReviewsQueryParams.safeParse(req.query);
  if (!params.success) return res.status(400).json({ error: "معرف المنتج مطلوب" });

  const reviews = await db.query.reviewsTable.findMany({
    where: eq(reviewsTable.productId, params.data.productId),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });

  return res.json(reviews.map((r) => ({
    id: r.id,
    productId: r.productId,
    customerId: r.customerId ?? null,
    customerName: r.customerName,
    rating: r.rating,
    comment: r.comment ?? null,
    createdAt: r.createdAt.toISOString(),
  })));
});

router.post("/reviews", async (req, res) => {
  const parsed = CreateReviewBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });

  const [review] = await db.insert(reviewsTable).values(parsed.data).returning();
  return res.status(201).json({
    id: review.id,
    productId: review.productId,
    customerId: review.customerId ?? null,
    customerName: review.customerName,
    rating: review.rating,
    comment: review.comment ?? null,
    createdAt: review.createdAt.toISOString(),
  });
});

export default router;
