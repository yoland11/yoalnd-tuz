import { Router, Request } from "express";
import { db } from "@workspace/db";
import { cartItemsTable, productsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { AddToCartBody, UpdateCartItemBody } from "@workspace/api-zod";

const router = Router();

function getSessionId(req: Request): string {
  const sid = req.headers["x-session-id"] as string;
  return sid || "anonymous";
}

async function buildCart(sessionId: string) {
  const items = await db.query.cartItemsTable.findMany({
    where: eq(cartItemsTable.sessionId, sessionId),
  });

  const enriched = await Promise.all(
    items.map(async (item) => {
      const product = await db.query.productsTable.findFirst({
        where: eq(productsTable.id, item.productId),
      });
      return {
        id: item.id,
        productId: item.productId,
        product: product ? {
          id: product.id,
          name: product.name,
          nameAr: product.nameAr,
          price: parseFloat(product.price),
          images: product.images ?? [],
          stock: product.stock,
          colors: product.colors ?? [],
          isFeatured: product.isFeatured,
          rating: null,
          reviewCount: 0,
          createdAt: product.createdAt.toISOString(),
        } : null,
        quantity: item.quantity,
        price: parseFloat(item.price),
        selectedColor: item.selectedColor ?? null,
        customization: item.customization ?? null,
      };
    })
  );

  const total = enriched.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const itemCount = enriched.reduce((sum, i) => sum + i.quantity, 0);

  return { items: enriched, total, itemCount };
}

router.get("/cart", async (req, res) => {
  const sessionId = getSessionId(req);
  const cart = await buildCart(sessionId);
  return res.json(cart);
});

router.post("/cart", async (req, res) => {
  const parsed = AddToCartBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });

  const sessionId = getSessionId(req);
  const { productId, quantity, selectedColor, customization } = parsed.data;

  const product = await db.query.productsTable.findFirst({
    where: eq(productsTable.id, productId),
  });
  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

  const existing = await db.query.cartItemsTable.findFirst({
    where: and(
      eq(cartItemsTable.sessionId, sessionId),
      eq(cartItemsTable.productId, productId)
    ),
  });

  if (existing) {
    await db.update(cartItemsTable)
      .set({ quantity: existing.quantity + quantity })
      .where(eq(cartItemsTable.id, existing.id));
  } else {
    await db.insert(cartItemsTable).values({
      sessionId,
      productId,
      quantity,
      price: product.price,
      selectedColor,
      customization,
    });
  }

  const cart = await buildCart(sessionId);
  return res.json(cart);
});

router.patch("/cart/:itemId", async (req, res) => {
  const itemId = parseInt(req.params.itemId);
  if (isNaN(itemId)) return res.status(400).json({ error: "معرف غير صحيح" });

  const parsed = UpdateCartItemBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });

  const sessionId = getSessionId(req);
  const { quantity } = parsed.data;

  if (quantity <= 0) {
    await db.delete(cartItemsTable).where(and(
      eq(cartItemsTable.id, itemId),
      eq(cartItemsTable.sessionId, sessionId)
    ));
  } else {
    await db.update(cartItemsTable)
      .set({ quantity })
      .where(and(
        eq(cartItemsTable.id, itemId),
        eq(cartItemsTable.sessionId, sessionId)
      ));
  }

  const cart = await buildCart(sessionId);
  return res.json(cart);
});

router.delete("/cart/:itemId", async (req, res) => {
  const itemId = parseInt(req.params.itemId);
  if (isNaN(itemId)) return res.status(400).json({ error: "معرف غير صحيح" });

  const sessionId = getSessionId(req);
  await db.delete(cartItemsTable).where(and(
    eq(cartItemsTable.id, itemId),
    eq(cartItemsTable.sessionId, sessionId)
  ));

  const cart = await buildCart(sessionId);
  return res.json(cart);
});

router.delete("/cart", async (req, res) => {
  const sessionId = getSessionId(req);
  await db.delete(cartItemsTable).where(eq(cartItemsTable.sessionId, sessionId));
  return res.json({ message: "تم مسح السلة" });
});

export default router;
