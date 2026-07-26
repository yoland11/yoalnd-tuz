import { createHash } from "node:crypto";
import {
  adminActivityLogsTable,
  categoriesTable,
  db,
  entityTimelineTable,
  photographyChecklistItemsTable,
  photographyEventsTable,
  photographyShootCrewTable,
  photographyShootEventsTable,
  photographyShootsTable,
  photographyWorkflowSettingsTable,
  productsTable,
  serviceOrdersTable,
  servicesTable,
  serviceOrderStatusHistoryTable,
  staffTable,
  type ServiceOrder,
} from "@workspace/db";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
  detectBookingDepartments,
  isProductInDepartment,
  matchesDepartment,
  resolveDepartmentCategoryIds,
} from "./sound-detection";
import { ensurePhotographyIntegrationTables } from "./photography-integration-schema";
import { normalizeShootStage, SHOOT_STAGE_LABELS } from "./photography-shoots";

type JsonMap = Record<string, any>;
export type PhotographySyncActor = {
  id?: number | null;
  name?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type PhotographyDetection = {
  isPhotography: boolean;
  reasons: string[];
  items: Array<Record<string, unknown>>;
  productIds: number[];
  missingCategoryMappings: string[];
  debug: Record<string, unknown>;
};

const PHOTOGRAPHY_CHECKLISTS = {
  before: [
    ["batteries_charged", "البطاريات مشحونة"],
    ["cards_formatted", "بطاقات الذاكرة مهيأة"],
    ["cameras_tested", "الكاميرات مجرّبة"],
    ["audio_tested", "الصوت مجرّب"],
    ["lenses_cleaned", "العدسات نظيفة"],
    ["customer_called", "تم الاتصال بالعميل"],
    ["location_confirmed", "تم تأكيد الموقع"],
    ["equipment_loaded", "تم تحميل المعدات"],
  ],
  during: [
    ["bride_captured", "تم تصوير تجهيز العروس"],
    ["groom_captured", "تم تصوير تجهيز العريس"],
    ["family_photos", "اكتملت صور العائلة"],
    ["ceremony_captured", "تم تصوير المراسم الرئيسية"],
    ["audio_recorded", "تم تسجيل الصوت"],
    ["backup_created", "تم إنشاء نسخة احتياطية"],
  ],
  after: [
    ["files_copied", "تم نسخ الملفات"],
    ["second_backup", "اكتملت النسخة الاحتياطية الثانية"],
    ["cards_returned", "تمت إعادة بطاقات الذاكرة"],
    ["equipment_inspected", "تم فحص المعدات"],
    ["file_count_registered", "تم تسجيل عدد الملفات"],
    ["editor_assigned", "تم تعيين المحرر"],
  ],
} as const;

const CUSTOMER_STATUS: Record<string, string> = {
  new_booking: "تم تأكيد الحجز",
  awaiting_assignment: "تم تأكيد الحجز",
  crew_assigned: "تم تعيين فريق التصوير",
  accepted: "تم تعيين فريق التصوير",
  waiting_event: "تم تعيين فريق التصوير",
  on_the_way: "تم تعيين فريق التصوير",
  arrived: "تم تعيين فريق التصوير",
  shooting: "تم تنفيذ التصوير",
  shoot_ended: "تم تنفيذ التصوير",
  files_received: "تم تنفيذ التصوير",
  transferring: "جاري المونتاج",
  sorting: "جاري المونتاج",
  editing: "جاري المونتاج",
  customer_review: "جاهز للمراجعة",
  revising: "جاري المونتاج",
  ready_print: "جاري الطباعة",
  printing: "جاري الطباعة",
  ready_delivery: "جاهز للاستلام",
  delivered: "تم التسليم",
  completed: "تم التسليم",
  cancelled: "ملغي",
};

function mapObject(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonMap)
    : {};
}

function arrays(...values: unknown[]): JsonMap[] {
  return values.flatMap((value) => (Array.isArray(value) ? value : [])).filter(
    (value): value is JsonMap => Boolean(value && typeof value === "object"),
  );
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validDate(value: unknown, fallback: Date): string {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return fallback.toISOString().slice(0, 10);
}

function boundedTime(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d/.test(text) ? text.slice(0, 5) : null;
}

function bookingCode(order: ServiceOrder): string {
  return order.trackingCode || `AJN-BK-${order.createdAt.getFullYear()}-${String(order.id).padStart(5, "0")}`;
}

function clientToken(bookingId: number): string {
  return createHash("sha256").update(`photography:service_order:${bookingId}`).digest("hex");
}

function itemProductId(item: JsonMap): number | null {
  return positiveId(item.productId ?? item.product_id ?? item.assetId ?? item.asset_id);
}

function itemName(item: JsonMap): string {
  return String(item.nameAr ?? item.name ?? item.productNameAr ?? item.productName ?? item.title ?? "").trim();
}

function photographyItemArrays(fields: JsonMap): JsonMap[] {
  return arrays(
    fields.items,
    fields.products,
    fields.assets,
    fields.bookingItems,
    fields.booking_items,
    fields.photographyItems,
    fields.photographyServices,
    fields.selectedServices,
    fields.packageItems,
  );
}

/** Identifier-first classification; localized names are only a legacy fallback. */
export async function detectPhotographyBooking(
  orderOrId: ServiceOrder | number,
): Promise<PhotographyDetection> {
  const order =
    typeof orderOrId === "number"
      ? await db.query.serviceOrdersTable.findFirst({
          where: eq(serviceOrdersTable.id, orderOrId),
        })
      : orderOrId;
  if (!order) {
    return {
      isPhotography: false,
      reasons: ["booking_not_found"],
      items: [],
      productIds: [],
      missingCategoryMappings: [],
      debug: { bookingId: typeof orderOrId === "number" ? orderOrId : null },
    };
  }

  const fields = mapObject(order.customFields);
  const service = await db.query.servicesTable.findFirst({
    where: eq(servicesTable.id, order.serviceId),
  });
  const allItems = photographyItemArrays(fields);
  const productIds = [...new Set(allItems.map(itemProductId).filter((id): id is number => id !== null))];
  const [categories, products] = await Promise.all([
    db.query.categoriesTable.findMany(),
    productIds.length
      ? db.query.productsTable.findMany({ where: inArray(productsTable.id, productIds) })
      : Promise.resolve([]),
  ]);
  const categoryIds = resolveDepartmentCategoryIds(categories, "photography");
  const photographyDepartmentIds = new Set<number>();
  for (const category of categories) {
    if (!categoryIds.has(category.id)) continue;
    const metadata = mapObject(category.imageMetadata);
    const departmentId = positiveId(metadata.departmentId);
    if (departmentId) photographyDepartmentIds.add(departmentId);
  }
  const productMap = new Map(products.map((product) => [product.id, product]));
  const productDepartments = new Map<number, Array<"photography">>();
  for (const product of products) {
    const metadata = Array.isArray(product.imageMetadata)
      ? product.imageMetadata.filter((value) => value && typeof value === "object")
      : [];
    const augmented = {
      ...product,
      productType: metadata.map((value: any) => value.productType ?? value.type).filter(Boolean).join(" "),
      department: metadata.map((value: any) => value.departmentCode ?? value.department).filter(Boolean).join(" "),
    };
    if (isProductInDepartment(augmented, categoryIds, "photography")) {
      productDepartments.set(product.id, ["photography"]);
    }
  }

  const bookingServices = arrays(fields.bookingCenterServices, fields.services);
  const taxonomy = [
    ...(Array.isArray(fields.departments) ? fields.departments : []),
    fields.departmentId,
    fields.departmentCode,
    fields.department,
    fields.serviceType,
    fields.bookingType,
    fields.photographyDepartmentId,
    fields.photographyCategoryId,
    fields.photographyFlag === true ? "PHOTOGRAPHY" : null,
    service?.type,
    service?.name,
    service?.nameAr,
    ...bookingServices.flatMap((entry) => [entry.departmentId, entry.categoryId, entry.type, entry.departmentCode]),
    ...allItems.flatMap((entry) => [entry.departmentId, entry.departmentCode, entry.categoryId, entry.serviceType, entry.assetCategory, entry.type]),
  ];
  const structuredDepartmentIds = [
    fields.departmentId,
    fields.photographyDepartmentId,
    ...bookingServices.map((entry) => entry.departmentId),
    ...allItems.map((entry) => entry.departmentId),
  ]
    .map(positiveId)
    .filter((id): id is number => id !== null);
  const isPhotographyDepartmentId = structuredDepartmentIds.some(
    (id) => photographyDepartmentIds.has(id) || categoryIds.has(id),
  );
  const detected = detectBookingDepartments({
    signals: {
      productIds,
      taxonomy,
      itemNames: allItems.map(itemName),
    },
    productDepartments,
  });

  const reasons: string[] = [];
  if (productIds.some((id) => productDepartments.has(id))) reasons.push("product_department_or_category_id");
  if (taxonomy.some((value) => matchesDepartment(value, "photography"))) reasons.push("structured_photography_taxonomy");
  if (isPhotographyDepartmentId) reasons.push("photography_department_id");
  if (fields.photographerId || fields.assignedPhotographerId || fields.photographyAssignments) {
    reasons.push("photographer_assignment");
  }
  const isPhotography =
    detected.includes("photography") ||
    isPhotographyDepartmentId ||
    reasons.includes("photographer_assignment");
  const photographyItems = allItems
    .filter((item) => {
      const id = itemProductId(item);
      return Boolean(
        (id && productDepartments.has(id)) ||
          [item.departmentCode, item.department, item.serviceType, item.type].some((value) =>
            matchesDepartment(value, "photography"),
          ) ||
          (!detected.length && matchesDepartment(itemName(item), "photography")),
      );
    })
    .map((item) => {
      const id = itemProductId(item);
      const product = id ? productMap.get(id) : null;
      return {
        ...item,
        productId: id,
        name: itemName(item) || product?.nameAr || product?.name || "خدمة تصوير",
        categoryId: product?.categoryId ?? item.categoryId ?? null,
        barcode: product?.barcode ?? item.barcode ?? null,
      };
    });

  return {
    isPhotography,
    reasons: isPhotography ? [...new Set(reasons.length ? reasons : ["legacy_item_name_fallback"])] : ["photography_item_not_detected"],
    items: photographyItems,
    productIds,
    missingCategoryMappings: categoryIds.size ? [] : ["PHOTOGRAPHY"],
    debug: {
      bookingId: order.id,
      bookingItems: allItems.length,
      serviceId: order.serviceId,
      serviceType: service?.type ?? null,
      categoryIds: [...categoryIds],
      photographyDepartmentIds: [...photographyDepartmentIds],
      productIds,
      productDepartmentMatches: [...productDepartments.keys()],
      photographyDetectionResult: isPhotography,
      assignedPhotographer: fields.assignedPhotographerId ?? fields.photographerId ?? null,
      statusFilter: order.status,
      dateFilter: order.eventDate,
      branchFilter: fields.branchId ?? null,
      archivedState: Boolean(order.archivedAt),
    },
  };
}

function eventStatus(order: ServiceOrder): string {
  return order.status === "cancelled" || Boolean(order.archivedAt) ? "cancelled" : "active";
}

function initialStage(order: ServiceOrder, fields: JsonMap): string {
  if (eventStatus(order) === "cancelled") return "cancelled";
  return fields.assignedPhotographerId || fields.photographerId
    ? "crew_assigned"
    : "awaiting_assignment";
}

async function writeSyncAudit(
  bookingId: number,
  action: string,
  actor: PhotographySyncActor,
  metadata: Record<string, unknown>,
) {
  await db.insert(adminActivityLogsTable).values({
    staffId: actor.id ?? null,
    userName: actor.name ?? "system",
    action,
    entityType: "service_order",
    entityId: bookingId,
    metadata,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
  });
}

export async function syncCentralBookingToPhotography(
  bookingId: number,
  actor: PhotographySyncActor = {},
) {
  await ensurePhotographyIntegrationTables();
  const order = await db.query.serviceOrdersTable.findFirst({
    where: eq(serviceOrdersTable.id, bookingId),
  });
  if (!order) return { linked: false, reason: "booking_not_found" } as const;
  const detection = await detectPhotographyBooking(order);
  if (!detection.isPhotography) {
    console.info("[photography-sync] booking skipped", detection.debug);
    return { linked: false, reason: "photography_item_not_detected", detection } as const;
  }

  const fields = mapObject(order.customFields);
  const date = validDate(order.eventDate, order.createdAt);
  const startTime = boundedTime(fields.eventStartTime ?? fields.eventTime ?? fields.startTime);
  const endTime = boundedTime(fields.eventEndTime ?? fields.endTime);
  const code = bookingCode(order);
  const assignmentInputs = [
    ...arrays(fields.photographyAssignments, fields.photographers, fields.assignedPhotographers),
    ...(positiveId(fields.assignedPhotographerId ?? fields.photographerId)
      ? [{
          employeeId: positiveId(fields.assignedPhotographerId ?? fields.photographerId),
          role: "main_photographer",
          isLead: true,
        }]
      : []),
  ];
  const assignmentIds = [
    ...new Set(
      assignmentInputs
        .map((entry) => positiveId(entry.employeeId ?? entry.staffId ?? entry.id))
        .filter((id): id is number => id !== null),
    ),
  ];
  const assignmentStaff = assignmentIds.length
    ? await db.query.staffTable.findMany({ where: inArray(staffTable.id, assignmentIds) })
    : [];
  const staffById = new Map(assignmentStaff.map((row) => [row.id, row]));
  const stage = eventStatus(order) === "cancelled"
    ? "cancelled"
    : assignmentIds.length
      ? "crew_assigned"
      : initialStage(order, fields);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(734721, ${bookingId})`);
    let event = await tx.query.photographyEventsTable.findFirst({
      where: eq(photographyEventsTable.bookingId, bookingId),
    });
    const scheduleChanged = Boolean(
      event &&
        (event.eventDate !== date ||
          (event.eventStartTime ?? null) !== startTime ||
          (event.eventEndTime ?? null) !== endTime),
    );
    const eventValues = {
      bookingCode: code,
      groomName: order.customerName,
      eventName: String(fields.eventType ?? fields.eventName ?? "تصوير مناسبة"),
      eventDate: date,
      location: order.eventLocation || null,
      mapUrl: fields.mapUrl ?? fields.locationUrl ?? fields.googleMapsUrl ?? null,
      phone: order.phone,
      phone2: fields.phone2 ?? fields.mobile2 ?? fields.alternatePhone ?? null,
      eventStartTime: startTime,
      eventEndTime: endTime,
      photographyItems: detection.items,
      requiredPhotographers: Math.max(1, Number(fields.requiredPhotographers ?? fields.photographersRequired ?? 1) || 1),
      customerNotes: order.notes ?? null,
      internalNotes: order.internalNotes ?? null,
      syncState: "linked",
      syncReason: detection.reasons.join(","),
      lastSyncedAt: new Date(),
      status: eventStatus(order),
      updatedAt: new Date(),
    };
    let created = false;
    if (!event) {
      [event] = await tx
        .insert(photographyEventsTable)
        .values({
          ...eventValues,
          bookingId,
          clientToken: clientToken(bookingId),
          createdBy: actor.id ?? null,
        })
        .returning();
      created = true;
    } else {
      [event] = await tx
        .update(photographyEventsTable)
        .set(eventValues)
        .where(eq(photographyEventsTable.id, event.id))
        .returning();
    }

    let shoot = await tx.query.photographyShootsTable.findFirst({
      where: eq(photographyShootsTable.bookingId, bookingId),
    });
    if (!shoot) {
      [shoot] = await tx
        .insert(photographyShootsTable)
        .values({
          bookingId,
          eventId: event.id,
          stage,
          venue: order.eventLocation || null,
          eventTime: startTime,
          notes: order.internalNotes ?? null,
          createdBy: actor.id ?? null,
          cancelledAt: stage === "cancelled" ? new Date() : null,
        })
        .returning();
    } else {
      const currentStage = normalizeShootStage(shoot.stage);
      const nextStage = stage === "cancelled" ? "cancelled" : currentStage;
      [shoot] = await tx
        .update(photographyShootsTable)
        .set({
          eventId: event.id,
          venue: order.eventLocation || null,
          eventTime: startTime,
          stage: nextStage,
          cancelledAt: nextStage === "cancelled" ? shoot.cancelledAt ?? new Date() : shoot.cancelledAt,
          updatedAt: new Date(),
        })
        .where(eq(photographyShootsTable.id, shoot.id))
        .returning();
    }

    const workflowSettings = scheduleChanged
      ? await tx.query.photographyWorkflowSettingsTable.findFirst({
          where: eq(photographyWorkflowSettingsTable.code, "default"),
        })
      : null;
    if (
      scheduleChanged &&
      workflowSettings?.requireReacceptOnScheduleChange !== false &&
      stage !== "cancelled"
    ) {
      await tx
        .update(photographyShootCrewTable)
        .set({
          assignmentStatus: "assigned",
          acceptedAt: null,
          conflictReason: "schedule_changed_reaccept_required",
        })
        .where(
          and(
            eq(photographyShootCrewTable.shootId, shoot.id),
            eq(photographyShootCrewTable.assignmentStatus, "accepted"),
          ),
        );
      if (!["delivered", "completed", "cancelled"].includes(normalizeShootStage(shoot.stage))) {
        [shoot] = await tx
          .update(photographyShootsTable)
          .set({ stage: "crew_assigned", updatedAt: new Date() })
          .where(eq(photographyShootsTable.id, shoot.id))
          .returning();
      }
      await tx.insert(photographyShootEventsTable).values({
        bookingId,
        shootId: shoot.id,
        staffId: actor.id ?? null,
        staffName: actor.name ?? "system",
        type: "schedule_changed_reaccept_required",
        toStage: normalizeShootStage(shoot.stage),
        note: `${date} ${startTime ?? ""}`.trim(),
      });
    }

    for (const assignment of assignmentInputs) {
      const staffId = positiveId(assignment.employeeId ?? assignment.staffId ?? assignment.id);
      const staff = staffId ? staffById.get(staffId) : null;
      if (!staffId || !staff) continue;
      await tx
        .insert(photographyShootCrewTable)
        .values({
          bookingId,
          shootId: shoot.id,
          staffId,
          staffName: staff.fullName || staff.username,
          role: String(assignment.role ?? "photographer").slice(0, 30),
          isLead: assignment.isLead === true || assignment.role === "main_photographer",
          assignmentStatus: "assigned",
          assignedBy: actor.id ?? null,
        })
        .onConflictDoUpdate({
          target: [photographyShootCrewTable.shootId, photographyShootCrewTable.staffId],
          set: {
            staffName: staff.fullName || staff.username,
            role: String(assignment.role ?? "photographer").slice(0, 30),
            isLead: assignment.isLead === true || assignment.role === "main_photographer",
          },
        });
    }
    const leadAssignment = assignmentInputs.find(
      (entry) => entry.isLead === true || entry.role === "main_photographer",
    ) ?? assignmentInputs[0];
    const leadId = positiveId(
      leadAssignment?.employeeId ?? leadAssignment?.staffId ?? leadAssignment?.id,
    );
    const leadStaff = leadId ? staffById.get(leadId) : null;
    if (leadStaff) {
      [event] = await tx
        .update(photographyEventsTable)
        .set({
          assignedStaffId: leadStaff.id,
          assignedStaffName: leadStaff.fullName || leadStaff.username,
          updatedAt: new Date(),
        })
        .where(eq(photographyEventsTable.id, event.id))
        .returning();
    }

    for (const [phase, items] of Object.entries(PHOTOGRAPHY_CHECKLISTS)) {
      for (const [itemKey, label] of items) {
        await tx
          .insert(photographyChecklistItemsTable)
          .values({ bookingId, shootId: shoot.id, phase, itemKey, label })
          .onConflictDoNothing();
      }
    }

    if (created || stage === "cancelled") {
      await tx.insert(photographyShootEventsTable).values({
        bookingId,
        shootId: shoot.id,
        staffId: actor.id ?? null,
        staffName: actor.name ?? "system",
        type: created ? "booking_synchronized" : "booking_cancelled",
        toStage: normalizeShootStage(shoot.stage),
        note: created ? "ربط الحجز المركزي ببوابة المصورين" : "تم إلغاء الحجز المركزي",
      });
      await tx.insert(entityTimelineTable).values({
        entityType: "service_order",
        entityId: bookingId,
        type: created ? "photography_synchronized" : "photography_cancelled",
        title: created ? "تم ربط الحجز ببوابة المصورين" : "تم إلغاء تنفيذ التصوير",
        body: code,
        actorId: actor.id ?? null,
        actorName: actor.name ?? "system",
        metadata: { eventId: event.id, shootId: shoot.id, reasons: detection.reasons },
      });
    }

    const departments = new Set(
      Array.isArray(fields.departments) ? fields.departments.map(String) : [],
    );
    departments.add("photography");
    await tx
      .update(serviceOrdersTable)
      .set({
        customFields: {
          ...fields,
          departments: [...departments],
          photographyPortal: {
            ...(mapObject(fields.photographyPortal)),
            eventId: event.id,
            shootId: shoot.id,
            bookingCode: code,
            status: normalizeShootStage(shoot.stage),
            customerStatus: CUSTOMER_STATUS[normalizeShootStage(shoot.stage)],
            syncedAt: new Date().toISOString(),
          },
        },
      })
      .where(eq(serviceOrdersTable.id, bookingId));

    return { event, shoot, created, scheduleChanged };
  });

  await writeSyncAudit(
    bookingId,
    result.created ? "photography_booking_detection" : "photography_portal_synchronization",
    actor,
    {
      reasons: detection.reasons,
      eventId: result.event.id,
      shootId: result.shoot.id,
      scheduleChanged: result.scheduleChanged,
    },
  );
  return { linked: true, ...result, detection } as const;
}

const CENTRAL_STATUS_BY_STAGE: Record<string, string> = {
  new_booking: "pending",
  awaiting_assignment: "pending",
  crew_assigned: "confirmed",
  accepted: "confirmed",
  waiting_event: "confirmed",
  on_the_way: "processing",
  arrived: "processing",
  shooting: "processing",
  shoot_ended: "processing",
  files_received: "processing",
  transferring: "processing",
  sorting: "processing",
  editing: "processing",
  customer_review: "processing",
  revising: "processing",
  ready_print: "processing",
  printing: "processing",
  ready_delivery: "completed",
  delivered: "delivered",
  completed: "completed",
  cancelled: "cancelled",
};

export async function syncPhotographyStageToCentralBooking(
  bookingId: number,
  stageValue: string,
  actor: PhotographySyncActor = {},
) {
  await ensurePhotographyIntegrationTables();
  const stage = normalizeShootStage(stageValue);
  const order = await db.query.serviceOrdersTable.findFirst({
    where: eq(serviceOrdersTable.id, bookingId),
  });
  if (!order) return { updated: false, reason: "booking_not_found" } as const;
  const fields = mapObject(order.customFields);
  const centralStatus = CENTRAL_STATUS_BY_STAGE[stage] ?? order.status;
  await db.transaction(async (tx) => {
    await tx
      .update(serviceOrdersTable)
      .set({
        status: centralStatus,
        customFields: {
          ...fields,
          photographyWorkflowStatus: stage,
          photographyCustomerStatus: CUSTOMER_STATUS[stage],
          photographyPortal: {
            ...mapObject(fields.photographyPortal),
            status: stage,
            customerStatus: CUSTOMER_STATUS[stage],
            syncedAt: new Date().toISOString(),
          },
        },
      })
      .where(eq(serviceOrdersTable.id, bookingId));
    await tx.insert(serviceOrderStatusHistoryTable).values({
      serviceOrderId: bookingId,
      status: centralStatus,
      notes: `تحديث مرحلة التصوير: ${stage}`,
    });
    await tx.insert(entityTimelineTable).values({
      entityType: "service_order",
      entityId: bookingId,
      type: "photography_status_changed",
      title: `مرحلة التصوير: ${SHOOT_STAGE_LABELS[stage]}`,
      body: CUSTOMER_STATUS[stage] ?? null,
      actorId: actor.id ?? null,
      actorName: actor.name ?? "system",
      metadata: { photographyStage: stage, centralStatus },
    });
  });
  await writeSyncAudit(bookingId, "photography_status_changed", actor, {
    oldValue: order.status,
    newValue: centralStatus,
    photographyStage: stage,
  });
  return { updated: true, status: centralStatus, stage } as const;
}

export async function findPhotographerConflict(input: {
  staffId: number;
  eventId: number;
  eventDate: string;
  startTime?: string | null;
  endTime?: string | null;
}) {
  await ensurePhotographyIntegrationTables();
  const assignments = await db
    .select({
      eventId: photographyEventsTable.id,
      bookingCode: photographyEventsTable.bookingCode,
      eventDate: photographyEventsTable.eventDate,
      startTime: photographyEventsTable.eventStartTime,
      endTime: photographyEventsTable.eventEndTime,
    })
    .from(photographyShootCrewTable)
    .innerJoin(photographyShootsTable, eq(photographyShootCrewTable.shootId, photographyShootsTable.id))
    .innerJoin(photographyEventsTable, eq(photographyShootsTable.eventId, photographyEventsTable.id))
    .where(
      and(
        eq(photographyShootCrewTable.staffId, input.staffId),
        ne(photographyShootCrewTable.assignmentStatus, "rejected"),
        ne(photographyEventsTable.id, input.eventId),
        eq(photographyEventsTable.eventDate, input.eventDate),
        ne(photographyEventsTable.status, "cancelled"),
      ),
    );
  const start = input.startTime || "00:00";
  const end = input.endTime || "23:59";
  return (
    assignments.find((row) => {
      const otherStart = row.startTime || "00:00";
      const otherEnd = row.endTime || "23:59";
      return start < otherEnd && otherStart < end;
    }) ?? null
  );
}

export type PhotographyBackfillReport = {
  dryRun: boolean;
  migrationReady: boolean;
  scanned: number;
  linked: number;
  alreadyLinked: number;
  skipped: number;
  ambiguous: number;
  missingCategoryMappings: number;
  duplicateCandidates: number;
  details: Array<Record<string, unknown>>;
};

export async function backfillPhotographyBookings(input: {
  dryRun?: boolean;
  limit?: number;
  actor?: PhotographySyncActor;
} = {}): Promise<PhotographyBackfillReport> {
  const dryRun = input.dryRun !== false;
  const limit = Math.min(Math.max(input.limit ?? 1000, 1), 5000);
  const orders = await db.query.serviceOrdersTable.findMany({
    orderBy: [desc(serviceOrdersTable.createdAt)],
    limit,
  });
  const migrationCheck = (await db.execute(sql`
    select exists(
      select 1 from information_schema.columns
      where table_schema=current_schema() and table_name='photography_events' and column_name='booking_id'
    ) as ready
  `)) as any;
  const migrationReady = Boolean(migrationCheck.rows?.[0]?.ready);
  if (!dryRun && !migrationReady) {
    throw new Error("Photography integration migration 0067 must be applied before backfill apply mode.");
  }
  const linkedResult = migrationReady
    ? ((await db.execute(sql.raw(
        "select booking_id from photography_events where booking_id is not null",
      ))) as any)
    : { rows: [] };
  const linkedIds = new Set<number>(
    (linkedResult.rows ?? [])
      .map((row: any) => positiveId(row.booking_id))
      .filter((id: number | null): id is number => id !== null),
  );
  const report: PhotographyBackfillReport = {
    dryRun,
    migrationReady,
    scanned: orders.length,
    linked: 0,
    alreadyLinked: 0,
    skipped: 0,
    ambiguous: 0,
    missingCategoryMappings: 0,
    duplicateCandidates: 0,
    details: [],
  };
  for (const order of orders) {
    if (linkedIds.has(order.id)) {
      report.alreadyLinked += 1;
      continue;
    }
    const detection = await detectPhotographyBooking(order);
    if (detection.missingCategoryMappings.length) report.missingCategoryMappings += 1;
    if (!detection.isPhotography) {
      report.skipped += 1;
      continue;
    }
    const legacyMatch = (await db.execute(sql`
      select id from photography_events
      where lower(groom_name)=lower(${order.customerName})
        and event_date=${validDate(order.eventDate, order.createdAt)}
        ${migrationReady ? sql`and booking_id is null` : sql``}
      limit 2
    `)) as any;
    const sameLegacyEvent = (legacyMatch.rows ?? []) as Array<{ id: number }>;
    if (sameLegacyEvent.length) {
      report.ambiguous += 1;
      report.duplicateCandidates += sameLegacyEvent.length;
      report.details.push({ bookingId: order.id, result: "ambiguous_legacy_match", eventIds: sameLegacyEvent.map((row) => row.id) });
      continue;
    }
    if (dryRun) {
      report.linked += 1;
      report.details.push({ bookingId: order.id, result: "would_link", reasons: detection.reasons });
      continue;
    }
    const synced = await syncCentralBookingToPhotography(order.id, input.actor);
    if (synced.linked) report.linked += 1;
  }
  return report;
}

let lazyBackfillAt = 0;
export async function ensurePhotographyPortalBackfill() {
  if (Date.now() - lazyBackfillAt < 5 * 60_000) return;
  lazyBackfillAt = Date.now();
  const report = await backfillPhotographyBookings({ dryRun: false, limit: 250 });
  console.info("[photography-sync] lazy backfill", {
    linked: report.linked,
    alreadyLinked: report.alreadyLinked,
    skipped: report.skipped,
    ambiguous: report.ambiguous,
  });
}
