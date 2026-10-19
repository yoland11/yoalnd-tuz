import { normalizeQuantityLine, lineOutstanding } from "./quantity-assets";
import { evaluateBookingReadiness } from "./booking-operational-readiness";

export type DailySource = "kosha" | "service";
export type DailyFilters = {
  period: "today" | "tomorrow" | "week" | "recent";
  search: string; category: string; status: string;
  employee: number | null; vehicle: number | null; location: string;
  attention?: "all" | "issues" | "preparation" | "returns" | "tasks" | "team" | "transport";
};
export type DailyBookingFact = {
  source: DailySource; id: number; number: string; customerName: string;
  eventDate: string; eventTime: string | null; location: string | null;
  status: string; category: string; details: Record<string, any>;
  assignedStaffId: number | null; vehicleId: number | null; vehicleName: string | null;
  transportationMode: string | null; crewName: string | null;
  overdueTasks: number; openTasks: number;
  staff?: Array<{ id: number; name: string }>;
  executionStaffIds?: number[];
  staffConfirmation?: { trackedIds: number[]; acceptedIds: number[] };
  vehicleState?: { active: boolean; status: string } | null;
  execution?: { stage: string; requiredArrivalAt?: string | null; arrivedAt?: string | null };
  workOrderAssets?: Array<{ productId: number; checkedOut: boolean; returned: boolean; condition: string | null }>;
  products: Array<{ productId: number; variantId: number | null; quantity: number; status: string }>;
};
type Check = { id: string; label: string; state: "pass" | "fail" | "unknown"; reason: string; href: string; applicable?: boolean };
const record = (value: any): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value: any): any[] => Array.isArray(value) ? value : [];
const positiveId = (value: any) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export function dailyAssignedStaffIds(fact: Pick<DailyBookingFact, "details" | "assignedStaffId" | "executionStaffIds">) {
  const d = record(fact.details);
  return [...new Set([fact.assignedStaffId, d.primaryEmployeeId, d.assistantEmployeeId,
    ...array(d.assignedStaffIds), ...array(d.bookingStaffAssignments).map((s) => s?.id), ...array(fact.executionStaffIds),
  ].map(positiveId).filter((id): id is number => id !== null))];
}

export function parseDailyOperationsFilters(params: URLSearchParams): DailyFilters {
  const period = params.get("period") || "today";
  if (!["today", "tomorrow", "week", "recent"].includes(period)) throw new Error("الفترة غير صحيحة");
  const attention = params.get("attention") || "all";
  if (!["all", "issues", "preparation", "returns", "tasks", "team", "transport"].includes(attention)) throw new Error("نوع المتابعة غير صحيح");
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
  return { period: period as DailyFilters["period"], search: text("search"), category: text("category", "all"), status: text("status", "all"), employee: id("employee", "الموظف"), vehicle: id("vehicle", "المركبة"), location: text("location"), attention: attention as DailyFilters["attention"] };
}

const urlKeys = { period:"opsPeriod", search:"opsSearch", category:"opsCategory", status:"opsStatus", employee:"opsEmployee", vehicle:"opsVehicle", location:"opsLocation", attention:"opsAttention" } as const;
export function dailyFiltersFromUrl(params: URLSearchParams) {
  const filters = new URLSearchParams();
  for (const [key, name] of Object.entries(urlKeys)) { const value=params.get(name); if(value!==null) filters.set(key,value); }
  return parseDailyOperationsFilters(filters);
}
export function dailyFiltersToUrl(params: URLSearchParams, filters: DailyFilters) {
  const next = new URLSearchParams(params);
  for (const [key,name] of Object.entries(urlKeys)) {
    const value=filters[key as keyof DailyFilters];
    if(value===null || value===undefined || value==="" || value==="all" || key==="period" && value==="today") next.delete(name);
    else next.set(name,String(value));
  }
  return next;
}

export function dailyOperationsRange(period: DailyFilters["period"], now: Date) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const day = new Date(`${today}T00:00:00Z`);
  if (period === "tomorrow") day.setUTCDate(day.getUTCDate() + 1);
  if (period === "recent") day.setUTCDate(day.getUTCDate() - 30);
  const from = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + (period === "week" ? 7 : period === "recent" ? 31 : 1));
  return { from, to: day.toISOString().slice(0, 10) };
}

/** Read-only projection of saved evidence. Never substitutes stock or payment math. */
export function projectDailyBooking(fact: DailyBookingFact, now = new Date()) {
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
  let returnEvidenceIncomplete = false;
  // The native work-order manifest uses one physical product per row. Union by
  // that identity, never sum it with a possibly overlapping JSON quantity line.
  for (const custody of fact.workOrderAssets ?? []) {
    if (!custody.checkedOut) continue;
    const existing = assets.get(custody.productId);
    const outside = custody.returned ? 0 : 1;
    const problem = custody.returned && ["damaged","missing","maintenance"].includes(custody.condition || "") ? custody.condition : null;
    if (!existing) {
      assets.set(custody.productId, {productId:custody.productId,quantity:1,stage:custody.returned ? "returned" : "out",problem:problem === "maintenance" ? null : problem,maintenanceRequired:problem === "maintenance"});
    } else {
      const line = normalizeQuantityLine(existing);
      if (lineOutstanding(line) !== outside || outside > 0 && (existing.trackingMode === "quantity" || line.requiredQty !== 1)) returnEvidenceIncomplete = true;
      assets.set(custody.productId, {...existing,custodyOutstanding:outside,custodyProblem:problem});
    }
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
    const problem = ["damaged", "lost", "unavailable"].includes(status) || (asset.problem && asset.problem !== "none") || asset.custodyProblem || asset.maintenanceRequired || line.returnedDamagedQty > 0 || line.missingQty > 0;
    if (!problem && line.requiredQty > 0 && line.preparedQty >= line.requiredQty) prepared++;
    if (problem) problems++;
    pendingReturn += Math.max(lineOutstanding(line), asset.custodyOutstanding ?? 0);
  }
  const manual = array(ops.manualPrepItems).filter((item) => String(item?.id ?? "").trim() && !item?.infoOnly);
  for (const item of manual) {
    const status = meta[`manual:${String(item.id).trim()}`]?.prep?.status;
    if (["ready", "completed"].includes(status)) prepared++;
    if (["damaged", "lost"].includes(status)) problems++;
  }
  const total = fact.products.length + assets.size + manual.length;
  const staffIds = dailyAssignedStaffIds(fact);
  const stage = String(fact.execution?.stage || ops.bookingStage || fact.status).toLowerCase();
  const closed = [stage, String(fact.status).toLowerCase()].some(s => ["completed","delivered","closed","cancelled","canceled"].includes(s));
  const tracked = new Set(fact.staffConfirmation?.trackedIds ?? []);
  const accepted = new Set(fact.staffConfirmation?.acceptedIds ?? []);
  const pending = staffIds.filter(id => tracked.has(id) && !accepted.has(id)).length;
  const allAccepted = staffIds.length > 0 && staffIds.every(id => tracked.has(id) && accepted.has(id));
  const vehicleBad = fact.vehicleState === null || fact.vehicleState && (!fact.vehicleState.active || ["maintenance","inactive","retired","sold"].includes(fact.vehicleState.status.toLowerCase()));
  const time = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(fact.eventTime || "");
  const validTime = time && Number(time[1]) < 24 && Number(time[2]) < 60;
  const day = fact.eventDate.slice(0,10);
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) === day;
  const checks: Check[] = [
    { id: "date", label: "الموعد", state: validDay && validTime ? "pass" : "unknown", reason: validDay && validTime ? "تاريخ ووقت المناسبة مسجلان" : "تحقق من تاريخ ووقت المناسبة", href },
    { id: "location", label: "الموقع", state: fact.location?.trim() ? "pass" : "fail", reason: fact.location?.trim() ? "موقع المناسبة مسجل" : "موقع المناسبة مطلوب", href },
    { id: "preparation", label: "التجهيز", state: problems || shortage ? "fail" : total ? prepared === total ? "pass" : "fail" : "unknown", reason: problems ? `${problems} عناصر بها تلف أو مشكلة مسجلة` : shortage ? `${shortage} عناصر بها نقص مسجل` : total ? `مجهز ${prepared} من ${total} عناصر حسب السجل` : "قائمة المتطلبات لم تُراجع بعد", href: `${href}?tab=assets` },
    { id: "staff", label: "الفريق", state: staffIds.length || fact.crewName ? "pass" : "fail", reason: staffIds.length || fact.crewName ? "الفريق معيّن للحجز" : "لم يُعيّن فريق للحجز", href },
    { id: "staff-confirmation", label: "تأكيد الفريق", state: pending ? "fail" : allAccepted ? "pass" : "unknown", reason: pending ? `${pending} من الفريق لم يؤكدوا قبول المهمة` : allAccepted ? "قبول المهمة موثق لجميع الموظفين المعيّنين" : "التعيين وحده لا يثبت تأكيد حضور الفريق", href },
    { id: "vehicle", label: "النقل", state: transportationMode === "customer" ? "pass" : transportationMode === "ajn" ? fact.vehicleId ? "pass" : "fail" : "unknown", reason: transportationMode === "customer" ? "النقل بترتيب العميل" : fact.vehicleId ? "مركبة معيّنة؛ التوفر يحتاج مراجعة" : "راجع مسؤولية النقل وتعيين المركبة", href },
    { id: "vehicle-condition", label: "حالة المركبة", applicable:transportationMode!=="customer", state: transportationMode==="customer" ? "pass" : transportationMode==="ajn" && fact.vehicleId && vehicleBad ? "fail" : transportationMode==="ajn" && fact.vehicleId && fact.vehicleState?.active ? "pass" : "unknown", reason: transportationMode==="customer" ? "لا تلزم مركبة AJN لنقل العميل" : vehicleBad ? "المركبة المعيّنة غير متاحة أو غير فعالة أو تحتاج صيانة" : fact.vehicleState?.active ? "المركبة فعالة؛ تعارض مواعيدها فحص منفصل" : "لم تتحقق حالة المركبة المعيّنة", href },
    { id: "conflicts", label: "تعارض الموارد", state: "unknown", reason: "لم يُعتمد فحص كامل لفترة إشغال الموارد؛ راجع المعدات والفريق والمركبة قبل التنفيذ", href: `${href}?tab=assets` },
    { id: "requirements", label: "متطلبات التنفيذ", state: "unknown", reason: "راجع متطلبات التركيب والوثائق والموافقات التشغيلية", href: `${href}?tab=documents` },
  ];
  const applicable = checks.filter(c=>c.applicable!==false);
  const categories:Record<string,string>={date:"location",location:"location",preparation:"equipment",staff:"staff","staff-confirmation":"staff",vehicle:"transport","vehicle-condition":"transport",conflicts:"equipment",requirements:"requirements"};
  const readiness=evaluateBookingReadiness(checks.map(c=>({...c,category:categories[c.id],mandatory:true,applicable:c.applicable!==false})));
  const issues = applicable.filter((c) => c.state === "fail").map((c) => ({ kind: c.id === "preparation" ? "equipment" : c.id, label: c.reason, href: c.href }));
  if (returnEvidenceIncomplete) issues.push({kind:"custody-review",label:"سجلات عهدة المعدات غير متطابقة؛ راجع الإرجاع قبل اعتماد الكمية",href:`${href}?tab=assets`});
  if (fact.overdueTasks > 0) issues.push({ kind: "tasks", label: `${fact.overdueTasks} مهام متأخرة`, href: `${href}?tab=tasks` });
  const arrival = Date.parse(fact.execution?.requiredArrivalAt || "");
  if (!closed && Number.isFinite(arrival) && arrival < now.getTime() && !fact.execution?.arrivedAt) issues.push({kind:"late-arrival",label:"تجاوز موعد الوصول المطلوب ولم يُسجل الوصول",href});
  const today = dailyOperationsRange("today",now).from;
  if (pendingReturn > 0 && validDay && day < today) issues.push({kind:"previous-event-return",label:"معدات مناسبة سابقة ما زالت خارج المستودع",href:`${href}?tab=assets`});
  const eventAt = validDay && validTime ? Date.parse(`${day}T${time[1].padStart(2,"0")}:${time[2]}:00+03:00`) : NaN;
  if (!closed && eventAt >= now.getTime() && eventAt-now.getTime() <= 86_400_000 && applicable.some(c=>c.state!=="pass")) issues.push({kind:"approaching",label:"المناسبة خلال 24 ساعة وتوجد فحوص أو متطلبات غير مكتملة",href});
  const firstIssue = issues[0];
  const nextCheck = checks.find((c) => c.state === "unknown")!;
  return { key: `${fact.source}:${fact.id}`, source: fact.source, id: fact.id, number: fact.number, customerName: fact.customerName, eventDate: fact.eventDate, eventTime: fact.eventTime, location: fact.location, category: fact.category, status: fact.status, stage, href,
    staff: staffIds.map((id) => ({ id, name: fact.staff?.find((s) => s.id === id)?.name || "موظف معيّن" })), crewName: fact.crewName, vehicleId: fact.vehicleId, vehicleName: fact.vehicleName,
    preparation: { total, prepared, problems, shortage, percentage: total ? Math.round(prepared / total * 100) : null }, closed,
    pendingReturn, returnEvidenceIncomplete, overdueTasks: fact.overdueTasks, openTasks: fact.openTasks,
    readiness: {...readiness,percentage:readiness.percentage ?? 0},
    issues, nextAction: firstIssue ? { label: firstIssue.label, href: firstIssue.href } : { label: nextCheck.reason, href: nextCheck.href },
  };
}
export type DailyBooking = ReturnType<typeof projectDailyBooking>;

export function buildDailyOperations(facts: DailyBookingFact[], filters: DailyFilters, truncated: boolean, now: Date) {
  const all = facts.filter(f=>!["cancelled","canceled","deleted"].includes(String(f.status).toLowerCase())).map(f=>projectDailyBooking(f,now));
  const matching = all.filter((b) => (filters.category === "all" || b.category === filters.category)
    && (filters.status === "all" || b.stage === filters.status)
    && (!filters.employee || b.staff.some((s) => s.id === filters.employee))
    && (!filters.vehicle || b.vehicleId === filters.vehicle)
    && (!filters.location || b.location?.toLocaleLowerCase("ar").includes(filters.location.toLocaleLowerCase("ar")))
    && (!filters.search || `${b.number} ${b.customerName}`.toLocaleLowerCase("ar").includes(filters.search.toLocaleLowerCase("ar"))));
  const needsPreparation = (b:DailyBooking) => !b.closed && (!b.preparation.total || b.preparation.prepared < b.preparation.total || b.preparation.problems > 0 || b.preparation.shortage > 0);
  const rows = matching.filter(b => !filters.attention || filters.attention==="all" || filters.attention==="issues" && b.issues.length>0 || filters.attention==="preparation" && needsPreparation(b) || filters.attention==="returns" && b.pendingReturn>0 || filters.attention==="tasks" && b.overdueTasks>0 || filters.attention==="team" && b.readiness.checks.some(c=>["staff","staff-confirmation"].includes(c.id) && c.state!=="pass") || filters.attention==="transport" && b.readiness.checks.some(c=>c.applicable!==false && ["vehicle","vehicle-condition"].includes(c.id) && c.state!=="pass"));
  return { generatedAt: now.toISOString(), range: dailyOperationsRange(filters.period, now), filters, truncated,
    summary: { bookings: matching.length, needsPreparation: matching.filter(needsPreparation).length,
      ready: null, conflicts: null, active: matching.filter((b) => !b.closed && ["assets_out", "event_active", "in_progress", "installing", "executing","on_the_way","arrived","shooting","event_in_progress","dismantling","returning","warehouse_checkout"].includes(b.stage)).length,
      prepared:matching.filter(b=>!b.closed && b.preparation.total>0 && b.preparation.prepared===b.preparation.total && !b.preparation.problems && !b.preparation.shortage).length,
      alerts:matching.reduce((n,b)=>n+b.issues.length,0),
      shortage: matching.reduce((n, b) => n + b.preparation.shortage, 0), problems: matching.reduce((n, b) => n + b.preparation.problems, 0), pendingReturns: matching.filter((b) => b.pendingReturn > 0).length, overdueTasks: matching.reduce((n, b) => n + b.overdueTasks, 0) },
    options: { categories: [...new Set(all.map((b) => b.category))].sort(), statuses: [...new Set(all.map((b) => b.stage))].sort(),
      employees: [...new Map(all.flatMap((b) => b.staff).map((s) => [s.id, s])).values()],
      vehicles: [...new Map(all.filter((b) => b.vehicleId).map((b) => [b.vehicleId!, { id: b.vehicleId!, name: b.vehicleName || "مركبة معيّنة" }])).values()] }, rows };
}
export type DailyOperations = ReturnType<typeof buildDailyOperations>;
