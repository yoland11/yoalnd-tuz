import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type BrainPriority = "critical" | "high" | "medium" | "low";
export type BrainAlert = {
  id: string;
  priority: BrainPriority;
  category: string;
  title: string;
  body: string;
  href: string;
  entityType?: string;
  entityId?: number;
};

export type BrainEvent = {
  id: number;
  bookingNo: string;
  customerName: string;
  eventDate: string;
  eventTime: string | null;
  stage: string;
  timeline: Array<{ label: string; complete: boolean }>;
  score: { planning: number; financial: number; execution: number; satisfaction: number; staff: number; overall: number };
};

const rows = <T>(result: any): T[] => (result?.rows ?? []) as T[];
const n = (value: unknown) => Number(value ?? 0) || 0;
const money = (value: unknown) => Math.round(n(value) * 100) / 100;

export async function ensureEventBrainTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_event_brain_settings (
      id integer PRIMARY KEY DEFAULT 1,
      alerts_enabled boolean NOT NULL DEFAULT true,
      recommendations_enabled boolean NOT NULL DEFAULT true,
      daily_brief_enabled boolean NOT NULL DEFAULT true,
      executive_summary_enabled boolean NOT NULL DEFAULT true,
      warehouse_analysis_enabled boolean NOT NULL DEFAULT true,
      payroll_analysis_enabled boolean NOT NULL DEFAULT true,
      accounting_analysis_enabled boolean NOT NULL DEFAULT true,
      customer_analysis_enabled boolean NOT NULL DEFAULT true,
      updated_by integer,
      updated_at timestamp NOT NULL DEFAULT now(),
      CHECK (id = 1)
    );
    INSERT INTO ai_event_brain_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS ai_event_brain_feedback (
      id serial PRIMARY KEY,
      insight_id varchar(160) NOT NULL,
      action varchar(20) NOT NULL,
      note text,
      actor_id integer,
      actor_name text NOT NULL DEFAULT '',
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ai_event_brain_feedback_insight_idx ON ai_event_brain_feedback (insight_id, created_at DESC);
  `);
}

export async function getEventBrainSettings() {
  await ensureEventBrainTables();
  return rows<any>(await db.execute(sql`SELECT * FROM ai_event_brain_settings WHERE id = 1`))[0];
}

export async function saveEventBrainSettings(input: Record<string, unknown>, actor: { id: number; name: string }) {
  await ensureEventBrainTables();
  const bool = (key: string) => input[key] !== false;
  const result = await db.execute(sql`
    UPDATE ai_event_brain_settings SET
      alerts_enabled=${bool("alertsEnabled")}, recommendations_enabled=${bool("recommendationsEnabled")},
      daily_brief_enabled=${bool("dailyBriefEnabled")}, executive_summary_enabled=${bool("executiveSummaryEnabled")},
      warehouse_analysis_enabled=${bool("warehouseAnalysisEnabled")}, payroll_analysis_enabled=${bool("payrollAnalysisEnabled")},
      accounting_analysis_enabled=${bool("accountingAnalysisEnabled")}, customer_analysis_enabled=${bool("customerAnalysisEnabled")},
      updated_by=${actor.id}, updated_at=now()
    WHERE id=1 RETURNING *
  `);
  return rows<any>(result)[0];
}

const timelineStages = [
  ["تم إنشاء الحجز", "booked"], ["تم استلام العربون", "deposit"], ["تم تجهيز المستودع", "preparing"],
  ["تم إرسال المركبة", "dispatched"], ["تم تركيب الكوشة", "installed"], ["بدأ التصوير", "photography"],
  ["وصول الضيوف", "guests"], ["انتهى الحدث", "completed"], ["تمت إعادة المعدات", "returned"],
] as const;

function stageIndex(value: string | null | undefined) {
  const index = timelineStages.findIndex(([, stage]) => stage === value);
  return index < 0 ? 0 : index;
}

function priorityRank(priority: BrainPriority) { return ({ critical: 0, high: 1, medium: 2, low: 3 })[priority]; }

export async function getEventBrainDashboard() {
  await ensureEventBrainTables();
  const [bookingsResult, overdueResult, tasksResult, stockResult, maintenanceResult, workloadResult, financeResult, payrollResult, attendanceResult, servicesResult, topEmployeeResult] = await Promise.all([
    db.execute(sql`SELECT id, coalesce(tracking_code, 'KB-' || id) AS booking_no, customer_name, event_date, event_time, execution_stage, tracking_status, total_amount::float AS total, paid_amount::float AS paid, remaining_amount::float AS remaining, payment_status, assigned_staff_id
      FROM kosha_bookings WHERE archived_at IS NULL AND status NOT IN ('cancelled','canceled') AND event_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND event_date::date BETWEEN current_date AND current_date + 14 ORDER BY event_date::date, event_time NULLS LAST LIMIT 30`),
    db.execute(sql`SELECT id, coalesce(tracking_code, 'KB-' || id) AS booking_no, customer_name, event_date, remaining_amount::float AS remaining, due_date::text AS due_date
      FROM kosha_bookings WHERE archived_at IS NULL AND remaining_amount::numeric > 0 AND (due_date <= current_date OR (event_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND event_date::date <= current_date + 1)) ORDER BY due_date NULLS FIRST, event_date LIMIT 20`),
    db.execute(sql`SELECT id, coalesce(task_no, 'TASK-' || id) AS task_no, title, priority, due_at::text AS due_at FROM tasks WHERE archived_at IS NULL AND status NOT IN ('completed','done','cancelled','canceled') AND due_at < now() ORDER BY due_at LIMIT 20`),
    db.execute(sql`SELECT id, coalesce(name_ar, name, 'صنف') AS name, stock::float AS stock, min_stock::float AS min_stock FROM products WHERE archived_at IS NULL AND is_active=true AND stock <= min_stock ORDER BY stock ASC LIMIT 20`),
    db.execute(sql`SELECT a.id, coalesce(p.name_ar, p.name, 'أصل') AS name, a.usage_count, a.maintenance_every_uses FROM asset_profiles a JOIN products p ON p.id=a.product_id WHERE a.deleted_at IS NULL AND (a.status IN ('maintenance','under_maintenance') OR a.usage_count >= a.maintenance_every_uses) ORDER BY a.usage_count DESC LIMIT 20`),
    db.execute(sql`SELECT s.id, s.full_name AS name, count(t.id)::int AS open_tasks FROM staff s LEFT JOIN tasks t ON t.archived_at IS NULL AND t.status NOT IN ('completed','done','cancelled','canceled') AND t.assigned_staff_ids @> to_jsonb(array[s.id]) WHERE s.is_active=true GROUP BY s.id, s.full_name ORDER BY open_tasks DESC LIMIT 10`),
    db.execute(sql`SELECT (SELECT coalesce(current_balance::numeric,0)::float FROM master_cash_box WHERE code='MASTER' LIMIT 1) AS cashbox, coalesce(sum(amount::numeric) filter(where direction='revenue' and transaction_date=current_date),0)::float AS today_revenue, coalesce(sum(amount::numeric) filter(where direction='revenue' and transaction_date >= date_trunc('month', current_date)),0)::float AS month_revenue FROM financial_transactions WHERE approval_status='executed'`),
    db.execute(sql`SELECT coalesce(sum(total_net::numeric) filter(where status IN ('draft','submitted','pending','approved')),0)::float AS pending FROM payroll_runs WHERE period=to_char(current_date,'YYYY-MM') AND deleted_at IS NULL`),
    db.execute(sql`SELECT count(*) filter(where lower(status) IN ('absent','no_show'))::int AS absent, count(*) filter(where lower(status) IN ('present','late','out'))::int AS present FROM attendance_records WHERE check_in_at >= current_date AND check_in_at < current_date + interval '1 day'`),
    db.execute(sql`SELECT coalesce(package_name, 'كوشة') AS name, count(*)::int AS total, coalesce(sum(total_amount::numeric),0)::float AS revenue FROM kosha_bookings WHERE archived_at IS NULL GROUP BY package_name ORDER BY total DESC LIMIT 5`),
    db.execute(sql`SELECT full_name AS name, count(t.id)::int AS completed FROM staff s LEFT JOIN tasks t ON t.archived_at IS NULL AND t.status IN ('completed','done') AND t.completed_at >= date_trunc('month', current_date) AND t.assigned_staff_ids @> to_jsonb(array[s.id]) WHERE s.is_active=true GROUP BY s.id, s.full_name ORDER BY completed DESC LIMIT 1`),
  ]);
  const bookingRows = rows<any>(bookingsResult);
  const overdue = rows<any>(overdueResult); const lateTasks = rows<any>(tasksResult); const lowStock = rows<any>(stockResult); const maintenance = rows<any>(maintenanceResult); const workload = rows<any>(workloadResult);
  const finance = rows<any>(financeResult)[0] ?? {}; const payroll = rows<any>(payrollResult)[0] ?? {}; const attendance = rows<any>(attendanceResult)[0] ?? {}; const services = rows<any>(servicesResult); const topEmployee = rows<any>(topEmployeeResult)[0] ?? null;
  const events: BrainEvent[] = bookingRows.map((booking) => {
    const financial = booking.total > 0 ? Math.min(100, Math.round((n(booking.paid) / n(booking.total)) * 100)) : 100;
    const stage = stageIndex(booking.execution_stage || booking.tracking_status);
    const execution = Math.round((stage / Math.max(1, timelineStages.length - 1)) * 100);
    const planning = booking.assigned_staff_id ? 100 : 60;
    const satisfaction = booking.payment_status === "paid" ? 90 : 75;
    const staff = booking.assigned_staff_id ? 90 : 55;
    return { id: booking.id, bookingNo: booking.booking_no, customerName: booking.customer_name, eventDate: booking.event_date, eventTime: booking.event_time, stage: booking.execution_stage || booking.tracking_status || "booked", timeline: timelineStages.map(([label], index) => ({ label, complete: index <= stage })), score: { planning, financial, execution, satisfaction, staff, overall: Math.round((planning + financial + execution + satisfaction + staff) / 5) } };
  });
  const alerts: BrainAlert[] = [];
  overdue.forEach((row: any) => alerts.push({ id: `payment-${row.id}`, priority: row.event_date === new Date().toISOString().slice(0, 10) ? "critical" : "high", category: "payment_overdue", title: "دفعة عميل مستحقة", body: `${row.customer_name} عليه ${money(row.remaining).toLocaleString("ar-IQ")} د.ع للحجز ${row.booking_no}.`, href: `/admin/kosha-bookings?focus=${row.id}`, entityType: "kosha_booking", entityId: row.id }));
  lateTasks.forEach((row: any) => alerts.push({ id: `task-${row.id}`, priority: row.priority === "urgent" ? "critical" : "high", category: "task_delayed", title: "مهمة متأخرة", body: `${row.title} تجاوزت موعدها المحدد.`, href: `/admin/tasks?focus=${row.id}`, entityType: "task", entityId: row.id }));
  lowStock.forEach((row: any) => alerts.push({ id: `stock-${row.id}`, priority: n(row.stock) <= 0 ? "critical" : "high", category: "inventory_shortage", title: "مخزون منخفض", body: `${row.name}: المتاح ${n(row.stock)} والحد الأدنى ${n(row.min_stock)}.`, href: `/admin/inventory-alerts`, entityType: "product", entityId: row.id }));
  maintenance.forEach((row: any) => alerts.push({ id: `asset-${row.id}`, priority: "medium", category: "maintenance_required", title: "صيانة أصل مطلوبة", body: `${row.name} بلغ ${row.usage_count} استخداماً.`, href: `/admin/asset-reports`, entityType: "asset_profile", entityId: row.id }));
  workload.filter((row: any) => n(row.open_tasks) >= 5).forEach((row: any) => alerts.push({ id: `workload-${row.id}`, priority: "medium", category: "employee_overload", title: "حمل عمل مرتفع", body: `${row.name} لديه ${row.open_tasks} مهام مفتوحة.`, href: `/admin/tasks`, entityType: "staff", entityId: row.id }));
  if (n(payroll.pending) > 0) alerts.push({ id: "payroll-pending", priority: "medium", category: "payroll_pending", title: "رواتب بانتظار الإجراء", body: `يوجد ${money(payroll.pending).toLocaleString("ar-IQ")} د.ع من الرواتب غير المرحلة.`, href: "/admin/hr?tab=payroll" });
  if (n(finance.cashbox) < 0) alerts.push({ id: "cashbox-low", priority: "high", category: "cashbox_low", title: "رصيد الصندوق منخفض", body: `رصيد الصندوق الحالي ${money(finance.cashbox).toLocaleString("ar-IQ")} د.ع.`, href: "/admin/finance/master-cash" });
  alerts.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  const recommendations = alerts.slice(0, 8).map((alert) => ({ ...alert, id: `recommendation-${alert.id}`, recommendation: alert.category === "inventory_shortage" ? "أنشئ طلب شراء أو انقل مخزوناً قبل الحجز القادم." : alert.category === "payment_overdue" ? "تواصل مع العميل وثبّت التحصيل قبل موعد الحدث." : alert.category === "employee_overload" ? "وزع المهام على فريق بديل لتقليل مخاطر التأخير." : "راجع المصدر واتخذ الإجراء التشغيلي المناسب." }));
  const riskLevel: BrainPriority = alerts.some((a) => a.priority === "critical") ? "critical" : alerts.some((a) => a.priority === "high") ? "high" : alerts.length ? "medium" : "low";
  return { generatedAt: new Date().toISOString(), riskLevel, alerts, recommendations, events, metrics: { upcomingEvents: events.length, pendingCollections: overdue.reduce((sum, row) => sum + n(row.remaining), 0), lateTasks: lateTasks.length, lowStock: lowStock.length, warehouseStatus: lowStock.length ? "attention" : "healthy", cashbox: money(finance.cashbox), todayRevenue: money(finance.today_revenue), monthlyRevenue: money(finance.month_revenue), payrollPending: money(payroll.pending), absent: n(attendance.absent), present: n(attendance.present), topEmployee, topService: services[0] ?? null, customerSatisfaction: events.length ? Math.round(events.reduce((sum, event) => sum + event.score.satisfaction, 0) / events.length) : 0, netProfitForecast: money(finance.month_revenue) }, workload, dailyBrief: { todayEvents: events.filter((event) => event.eventDate === new Date().toISOString().slice(0, 10)).length, pendingPayments: overdue.length, lateTasks: lateTasks.length, warehouseAlerts: lowStock.length, employeesAbsent: n(attendance.absent), profitExpectedToday: money(finance.today_revenue), estimatedWorkload: workload.reduce((sum: number, row: any) => sum + n(row.open_tasks), 0) } };
}

export async function smartEventBrainSearch(query: string) {
  const text = query.trim().toLowerCase();
  if (!text) return { intent: "empty", results: [] };
  if (/مدفوع|مبلغ|باقي|payment|invoice|invoice/.test(text)) return { intent: "payments", results: rows(await db.execute(sql`SELECT id, coalesce(tracking_code, 'KB-' || id) AS reference, customer_name AS title, remaining_amount::float AS amount, event_date AS detail FROM kosha_bookings WHERE archived_at IS NULL AND remaining_amount::numeric > 0 ORDER BY remaining_amount::numeric DESC LIMIT 20`)) };
  if (/موظف|مهمة|task|employee/.test(text)) return { intent: "workload", results: rows(await db.execute(sql`SELECT s.id, s.full_name AS title, count(t.id)::int AS amount, 'مهام مفتوحة' AS detail FROM staff s LEFT JOIN tasks t ON t.archived_at IS NULL AND t.status NOT IN ('completed','done','cancelled','canceled') AND t.assigned_staff_ids @> to_jsonb(array[s.id]) WHERE s.is_active=true GROUP BY s.id,s.full_name ORDER BY amount DESC LIMIT 20`)) };
  if (/ورد|زهور|flower/.test(text)) return { intent: "flowers", results: rows(await db.execute(sql`SELECT id, coalesce(tracking_code, 'KB-' || id) AS reference, customer_name AS title, event_date AS detail FROM kosha_bookings WHERE archived_at IS NULL AND event_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND event_date::date >= current_date AND selected_addons::text ~* 'flower|ورد|زهور' ORDER BY event_date LIMIT 20`)) };
  if (/أصل|معدات|صيانة|asset|maintenance/.test(text)) return { intent: "assets", results: rows(await db.execute(sql`SELECT a.id, coalesce(p.name_ar,p.name,'أصل') AS title, a.usage_count AS amount, a.status AS detail FROM asset_profiles a JOIN products p ON p.id=a.product_id WHERE a.deleted_at IS NULL AND (a.status IN ('maintenance','under_maintenance') OR a.usage_count >= a.maintenance_every_uses) LIMIT 20`)) };
  return { intent: "inventory", results: rows(await db.execute(sql`SELECT id, coalesce(name_ar,name,'صنف') AS title, stock::float AS amount, 'المتاح في المخزون' AS detail FROM products WHERE archived_at IS NULL AND is_active=true AND stock <= min_stock ORDER BY stock LIMIT 20`)) };
}

export async function addEventBrainFeedback(input: { insightId: string; action: "accepted" | "ignored"; note?: string }, actor: { id: number; name: string }) {
  await ensureEventBrainTables();
  const result = await db.execute(sql`INSERT INTO ai_event_brain_feedback (insight_id, action, note, actor_id, actor_name) VALUES (${input.insightId}, ${input.action}, ${input.note ?? null}, ${actor.id}, ${actor.name}) RETURNING *`);
  return rows<any>(result)[0];
}
