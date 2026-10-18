import { normalizeQuantityLine, lineOutstanding } from "./quantity-assets";

export type DailySource = "kosha" | "service";
export type DailyFilters = {
  period: "today" | "tomorrow" | "week";
  search: string; category: string; status: string;
  employee: number | null; vehicle: number | null; location: string;
};
export type DailyBookingFact = {
  source: DailySource; id: number; number: string; customerName: string;
  eventDate: string; eventTime: string | null; location: string | null;
  status: string; category: string; details: Record<string, any>;
  assignedStaffId: number | null; vehicleId: number | null; vehicleName: string | null;
  transportationMode: string | null; crewName: string | null;
  overdueTasks: number; openTasks: number;
  staff?: Array<{ id: number; name: string }>;
  products: Array<{ productId: number; variantId: number | null; quantity: number; status: string }>;
};
type Check = { id: string; label: string; state: "pass" | "fail" | "unknown"; reason: string; href: string };
const record = (value: any): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value: any): any[] => Array.isArray(value) ? value : [];
const positiveId = (value: any) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export function dailyAssignedStaffIds(fact: Pick<DailyBookingFact, "details" | "assignedStaffId">) {
  const d = record(fact.details);
  return [...new Set([fact.assignedStaffId, d.primaryEmployeeId, d.assistantEmployeeId,
    ...array(d.assignedStaffIds), ...array(d.bookingStaffAssignments).map((s) => s?.id),
  ].map(positiveId).filter((id): id is number => id !== null))];
}

export function parseDailyOperationsFilters(params: URLSearchParams): DailyFilters {
  const period = params.get("period") || "today";
  if (!["today", "tomorrow", "week"].includes(period)) throw new Error("الفترة غير صحيحة");
  const id = (key: string, label: string) => {
    const value = params.get(key);
    if (!value) return null;
    const parsed = positiveId(value);
    if (!parsed) throw new Error(`معرف ${label} غير صحيح`);
    return parsed;
  };
  const text = (key: string, fallback = "") => {
    const value = (params.get(key) || fallback).trim();
    if (value.length > 100) throw new Error("نص البحث طويل جداً");
    return value;
  };
  return { period: period as DailyFilters["period"], search: text("search"), category: text("category", "all"), status: text("status", "all"), employee: id("employee", "الموظف"), vehicle: id("vehicle", "المركبة"), location: text("location") };
}

export function dailyOperationsRange(period: DailyFilters["period"], now: Date) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const day = new Date(`${today}T00:00:00Z`);
  if (period === "tomorrow") day.setUTCDate(day.getUTCDate() + 1);
  const from = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + (period === "week" ? 7 : 1));
  return { from, to: day.toISOString().slice(0, 10) };
}

/** Read-only projection of saved evidence. Never substitutes stock or payment math. */
export function projectDailyBooking(fact: DailyBookingFact) {
  const href = `/admin/bookings/${fact.source}/${fact.id}`;
  const ops = record(fact.details?.bookingOperations);
  // Same precedence as the existing booking transportation reader/writer.
  const transport = ops.transportation ?? (fact.source === "kosha" ? { mode: fact.transportationMode } : null);
  const transportationMode = record(transport).mode;
  const meta = record(ops.productMeta);
  const assets = new Map<number, any>();
  for (const a of [...array(fact.details?.linkedAssets), ...array(ops.assets)]) {
    const id = positiveId(a?.productId);
    if (id) assets.set(id, a); // Same precedence as the existing booking asset reader.
  }
  let prepared = 0, problems = 0, shortage = 0, pendingReturn = 0;
  for (const product of fact.products) {
    const status = meta[`${product.productId}:${product.variantId ?? 0}`]?.prep?.status;
    if (["ready", "completed"].includes(status) || product.status === "consumed") prepared++;
    if (["damaged", "lost", "unavailable"].includes(status)) problems++;
    if (["shortage", "needs_purchase", "reserved_elsewhere"].includes(status)) shortage++;
  }
  for (const asset of assets.values()) {
    const line = normalizeQuantityLine(asset);
    const status = meta[`asset:${asset.productId}`]?.prep?.status;
    const problem = ["damaged", "lost", "unavailable"].includes(status) || (asset.problem && asset.problem !== "none") || asset.maintenanceRequired || line.returnedDamagedQty > 0 || line.missingQty > 0;
    if (!problem && line.requiredQty > 0 && line.preparedQty >= line.requiredQty) prepared++;
    if (problem) problems++;
    pendingReturn += lineOutstanding(line);
  }
  const manual = array(ops.manualPrepItems).filter((item) => String(item?.id ?? "").trim() && !item?.infoOnly);
  for (const item of manual) {
    const status = meta[`manual:${String(item.id).trim()}`]?.prep?.status;
    if (["ready", "completed"].includes(status)) prepared++;
    if (["damaged", "lost"].includes(status)) problems++;
  }
  const total = fact.products.length + assets.size + manual.length;
  const staffIds = dailyAssignedStaffIds(fact);
  const stage = String(ops.bookingStage || fact.status);
  const checks: Check[] = [
    { id: "date", label: "الموعد", state: fact.eventTime ? "pass" : "unknown", reason: fact.eventTime ? "تاريخ ووقت المناسبة مسجلان" : "وقت المناسبة غير مسجل", href },
    { id: "location", label: "الموقع", state: fact.location?.trim() ? "pass" : "fail", reason: fact.location?.trim() ? "موقع المناسبة مسجل" : "موقع المناسبة مطلوب", href },
    { id: "preparation", label: "التجهيز", state: problems || shortage ? "fail" : total ? prepared === total ? "pass" : "fail" : "unknown", reason: problems ? `${problems} عناصر بها تلف أو مشكلة مسجلة` : shortage ? `${shortage} عناصر بها نقص مسجل` : total ? `مجهز ${prepared} من ${total} عناصر حسب السجل` : "قائمة المتطلبات لم تُراجع بعد", href: `${href}?tab=assets` },
    { id: "staff", label: "الفريق", state: staffIds.length || fact.crewName ? "pass" : "fail", reason: staffIds.length || fact.crewName ? "الفريق معيّن؛ تأكيد الحضور يحتاج مراجعة" : "لم يُعيّن فريق للحجز", href },
    { id: "staff-confirmation", label: "تأكيد الفريق", state: "unknown", reason: "التعيين وحده لا يثبت تأكيد حضور الفريق", href },
    { id: "vehicle", label: "النقل", state: transportationMode === "customer" ? "pass" : transportationMode === "ajn" ? fact.vehicleId ? "pass" : "fail" : "unknown", reason: transportationMode === "customer" ? "النقل بترتيب العميل" : fact.vehicleId ? "مركبة معيّنة؛ التوفر يحتاج مراجعة" : "راجع مسؤولية النقل وتعيين المركبة", href },
    { id: "conflicts", label: "تعارض الموارد", state: "unknown", reason: "لم يُعتمد فحص كامل لفترة إشغال الموارد؛ راجع المعدات والفريق والمركبة قبل التنفيذ", href: `${href}?tab=assets` },
    { id: "requirements", label: "متطلبات التنفيذ", state: "unknown", reason: "راجع متطلبات التركيب والوثائق والموافقات التشغيلية", href: `${href}?tab=documents` },
  ];
  const passed = checks.filter((c) => c.state === "pass").length;
  const issues = checks.filter((c) => c.state === "fail").map((c) => ({ kind: c.id === "preparation" ? "equipment" : c.id, label: c.reason, href: c.href }));
  if (fact.overdueTasks > 0) issues.push({ kind: "tasks", label: `${fact.overdueTasks} مهام متأخرة`, href: `${href}?tab=tasks` });
  const firstIssue = issues[0];
  const nextCheck = checks.find((c) => c.state === "unknown")!;
  return { key: `${fact.source}:${fact.id}`, source: fact.source, id: fact.id, number: fact.number, customerName: fact.customerName, eventDate: fact.eventDate, eventTime: fact.eventTime, location: fact.location, category: fact.category, status: fact.status, stage, href,
    staff: staffIds.map((id) => ({ id, name: fact.staff?.find((s) => s.id === id)?.name || "موظف معيّن" })), crewName: fact.crewName, vehicleId: fact.vehicleId, vehicleName: fact.vehicleName,
    preparation: { total, prepared, problems, shortage, percentage: total ? Math.round(prepared / total * 100) : null },
    pendingReturn, overdueTasks: fact.overdueTasks, openTasks: fact.openTasks,
    readiness: { status: checks.some((c) => c.state === "fail") ? "not_ready" as const : "needs_followup" as const, percentage: Math.round(passed / checks.length * 100), checks },
    issues, nextAction: firstIssue ? { label: firstIssue.label, href: firstIssue.href } : { label: nextCheck.reason, href: nextCheck.href },
  };
}
export type DailyBooking = ReturnType<typeof projectDailyBooking>;

export function buildDailyOperations(facts: DailyBookingFact[], filters: DailyFilters, truncated: boolean, now: Date) {
  const all = facts.map(projectDailyBooking);
  const rows = all.filter((b) => (filters.category === "all" || b.category === filters.category)
    && (filters.status === "all" || b.stage === filters.status)
    && (!filters.employee || b.staff.some((s) => s.id === filters.employee))
    && (!filters.vehicle || b.vehicleId === filters.vehicle)
    && (!filters.location || b.location?.toLocaleLowerCase("ar").includes(filters.location.toLocaleLowerCase("ar")))
    && (!filters.search || `${b.number} ${b.customerName}`.toLocaleLowerCase("ar").includes(filters.search.toLocaleLowerCase("ar"))));
  return { generatedAt: now.toISOString(), range: dailyOperationsRange(filters.period, now), filters, truncated,
    summary: { bookings: rows.length, needsPreparation: rows.filter((b) => !b.preparation.total || b.preparation.prepared < b.preparation.total || b.preparation.problems > 0 || b.preparation.shortage > 0).length,
      ready: null, conflicts: null, active: rows.filter((b) => ["assets_out", "event_active", "in_progress", "installing", "executing"].includes(b.stage)).length,
      shortage: rows.reduce((n, b) => n + b.preparation.shortage, 0), problems: rows.reduce((n, b) => n + b.preparation.problems, 0), pendingReturns: rows.filter((b) => b.pendingReturn > 0).length, overdueTasks: rows.reduce((n, b) => n + b.overdueTasks, 0) },
    options: { categories: [...new Set(all.map((b) => b.category))].sort(), statuses: [...new Set(all.map((b) => b.stage))].sort(),
      employees: [...new Map(all.flatMap((b) => b.staff).map((s) => [s.id, s])).values()],
      vehicles: [...new Map(all.filter((b) => b.vehicleId).map((b) => [b.vehicleId!, { id: b.vehicleId!, name: b.vehicleName || "مركبة معيّنة" }])).values()] }, rows };
}
export type DailyOperations = ReturnType<typeof buildDailyOperations>;
