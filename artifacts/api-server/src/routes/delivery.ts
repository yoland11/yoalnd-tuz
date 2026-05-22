import { Router } from "express";
import { db } from "@workspace/db";
import { deliveryZonesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateDeliveryZoneBody, UpdateDeliveryZoneBody } from "@workspace/api-zod";
import { requirePermission } from "../lib/admin-auth";

const router = Router();

function formatZone(z: any) {
  return {
    id: z.id,
    governorate: z.governorate,
    governorateAr: z.governorateAr,
    areas: z.areas ?? [],
    price: parseFloat(z.price),
    estimatedDays: z.estimatedDays,
    isActive: z.isActive,
  };
}

router.get("/delivery-zones", async (req, res) => {
  const zones = await db.query.deliveryZonesTable.findMany({
    orderBy: (z, { asc }) => [asc(z.governorate)],
  });
  return res.json(zones.map(formatZone));
});

router.post("/delivery-zones", requirePermission("delivery"), async (req, res) => {
  const parsed = CreateDeliveryZoneBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });

  const data = parsed.data as any;
  const [zone] = await db.insert(deliveryZonesTable).values({
    governorate: data.governorate,
    governorateAr: data.governorateAr,
    areas: data.areas ?? [],
    price: data.price.toString(),
    estimatedDays: data.estimatedDays,
    isActive: data.isActive ?? true,
  }).returning();

  return res.status(201).json(formatZone(zone));
});

router.patch("/delivery-zones/:id", requirePermission("delivery"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صحيح" });

  const parsed = UpdateDeliveryZoneBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });

  const data = parsed.data as any;
  const update: any = {};
  if (data.price !== undefined) update.price = data.price.toString();
  if (data.estimatedDays !== undefined) update.estimatedDays = data.estimatedDays;
  if (data.isActive !== undefined) update.isActive = data.isActive;
  if (data.areas !== undefined) update.areas = data.areas;

  const [zone] = await db.update(deliveryZonesTable).set(update).where(eq(deliveryZonesTable.id, id)).returning();
  if (!zone) return res.status(404).json({ error: "المنطقة غير موجودة" });

  return res.json(formatZone(zone));
});

export default router;
