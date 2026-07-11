// ─────────────────────────────────────────────────────────────────────────────
// AJN ERP — Employee Performance Engine
//
// Computes a 0–100 performance score per employee across six categories, purely
// from EXISTING data (no new source tables): tasks, attendance_records,
// financial_transactions, order_reviews, asset_profiles/passports +
// equipment_custody. The only runtime-provisioned table is
// employee_performance_actions (manager notes / rewards / penalties / bonuses /
// suspensions) — created via `create table if not exists`, no migration.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export type PerfRange = { from: string; to: string };

export type CategoryKey =
  | "commitment"
  | "speed"
  | "errors"
  | "assetCare"
  | "profit"
  | "satisfaction";

export type PerfLevel = "elite" | "excellent" | "good" | "improve" | "poor";

export const CATEGORY_WEIGHTS: Record<CategoryKey, number> = {
  commitment: 0.2,
  speed: 0.15,
  errors: 0.2,
  assetCare: 0.15,
  profit: 0.15,
  satisfaction: 0.15,
};

export type EmployeeScore = {
  staffId: number;
  name: string;
  role: string;
  department: string;
  categories: Record<CategoryKey, number>;
  overall: number;
  baseOverall: number; // before manager bonus/penalty
  adjustment: number; // manager bonus (+) / penalty (−) points
  level: PerfLevel;
  suspended: boolean;
  rank: number;
  details: EmployeeDetails;
};

export type EmployeeDetails = {
  // commitment
  present: number;
  late: number;
  absent: number;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksMissed: number;
  tasksLate: number;
  // speed
  avgCompleteHours: number;
  onTimeRate: number;
  // errors
  errorEvents: number;
  negativeReviews: number;
  // asset care
  brokenAssets: number;
  lostAssets: number;
  repairCost: number;
  // profit
  jobsCompleted: number;
  revenue: number;
  salesRevenue: number;
  avgPerJob: number;
  // satisfaction
  reviewsCount: number;
  avgRating: number;
  positiveReviews: number;
  recommendRate: number;
};

// ───── helpers ─────

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n);
const rows = <T = any>(r: any): T[] => (r?.rows ?? []) as T[];

export function levelFor(overall: number): PerfLevel {
  if (overall >= 90) return "elite";
  if (overall >= 80) return "excellent";
  if (overall >= 70) return "good";
  if (overall >= 60) return "improve";
  return "poor";
}

export const LEVEL_LABEL: Record<PerfLevel, string> = {
  elite: "النخبة",
  excellent: "ممتاز",
  good: "جيد",
  improve: "يحتاج تحسين",
  poor: "ضعيف",
};

/** Derive a coarse department label from role + permissions (no new field). */
function departmentOf(role: string, permissions: string[]): string {
  const p = new Set(permissions ?? []);
  if (role === "admin" || role === "manager") return "الإدارة";
  if (p.has("photography")) return "التصوير";
  if (p.has("koshas")) return "الكوشات";
  if (p.has("delivery")) return "التوصيل";
  if (p.has("invoices") || p.has("accounting") || p.has("pos")) return "المبيعات";
  if (p.has("products") || p.has("orders")) return "المتجر";
  return "عام";
}

function defaultRange(): PerfRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 365);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export async function ensureEmployeePerformanceTables(): Promise<void> {
  await db.execute(sql`
    create table if not exists "employee_performance_actions" (
      "id" serial primary key,
      "staff_id" integer not null,
      "kind" varchar(20) not null,
      "points" integer not null default 0,
      "title" text,
      "note" text,
      "created_by" integer,
      "created_by_name" text not null default '',
      "created_at" timestamp not null default now()
    )
  `);
  await db.execute(sql`create index if not exists "emp_perf_actions_staff_idx" on "employee_performance_actions" ("staff_id")`);
}

// ───── scoring ─────

function scoreCommitment(d: EmployeeDetails): number {
  const attTotal = d.present + d.late + d.absent;
  const attRate = attTotal ? d.present / attTotal : 1;
  const onTime = d.present + d.late ? d.present / (d.present + d.late) : 1;
  const comp = d.tasksAssigned ? d.tasksCompleted / d.tasksAssigned : 1;
  const missPenalty = d.tasksAssigned ? d.tasksMissed / d.tasksAssigned : 0;
  return clamp(round(100 * (0.35 * attRate + 0.25 * onTime + 0.3 * comp + 0.1 * (1 - missPenalty))));
}

function scoreSpeed(d: EmployeeDetails): number {
  // Faster average task completion → higher. ≤8h = 100, 72h ≈ 55, decays after.
  let speedScore = 80; // neutral when no completed tasks
  if (d.tasksCompleted > 0) {
    const h = d.avgCompleteHours;
    speedScore = h <= 8 ? 100 : h <= 72 ? 100 - ((h - 8) / 64) * 45 : Math.max(30, 55 - (h - 72) / 24);
  }
  const onTimeDelivery = d.tasksCompleted ? (d.tasksCompleted - d.tasksLate) / d.tasksCompleted : 1;
  return clamp(round(0.6 * speedScore + 0.4 * onTimeDelivery * 100));
}

function scoreErrors(d: EmployeeDetails): number {
  const jobs = Math.max(d.tasksAssigned + d.jobsCompleted + d.reviewsCount, 1);
  const errorRate = Math.min(d.errorEvents / jobs, 1);
  return clamp(round(100 * (1 - errorRate)));
}

function scoreAssetCare(d: EmployeeDetails): number {
  const events = d.brokenAssets + d.lostAssets;
  if (events === 0) return 100;
  // Each break −8, each loss −14, small extra penalty for repeat frequency.
  const jobs = Math.max(d.jobsCompleted + d.tasksAssigned, 1);
  const freqPenalty = Math.min(events / jobs, 1) * 15;
  return clamp(round(100 - d.brokenAssets * 8 - d.lostAssets * 14 - freqPenalty));
}

function scoreProfit(revenue: number, topRevenue: number): number {
  if (topRevenue <= 0) return revenue > 0 ? 100 : 0;
  // sqrt curve so mid-earners still score fairly, not only the top performer.
  return clamp(round(100 * Math.sqrt(Math.max(revenue, 0) / topRevenue)));
}

function scoreSatisfaction(d: EmployeeDetails): number {
  if (d.reviewsCount === 0) return 80; // neutral, no ratings yet
  return clamp(round((d.avgRating / 5) * 100));
}

// ───── data fetch + assembly ─────

export async function computeEmployeeScores(range: PerfRange = defaultRange()): Promise<EmployeeScore[]> {
  await ensureEmployeePerformanceTables();
  const from = range.from;
  const to = range.to;
  const toPlus = `${to} 23:59:59`;

  const [staffR, tasksR, attR, finR, revR, dmgR, actR] = await Promise.all([
    db.execute(sql`select id, full_name, username, role, permissions from staff where is_active = true order by id`),
    db.execute(sql`
      select sid::int as staff_id,
        count(*)::int as assigned,
        count(*) filter (where lower(status) in ('completed','delivered','done','closed'))::int as completed,
        count(*) filter (where lower(status) not in ('completed','delivered','done','closed','cancelled','canceled','archived') and due_at is not null and due_at < now())::int as missed,
        count(*) filter (where lower(status) in ('completed','delivered','done','closed') and due_at is not null and updated_at > due_at)::int as late_completed,
        coalesce(avg(extract(epoch from (updated_at - created_at))/3600.0) filter (where lower(status) in ('completed','delivered','done','closed')),0)::float as avg_complete_hours
      from tasks, jsonb_array_elements_text(assigned_staff_ids) as sid
      where archived_at is null
      group by sid::int
    `),
    db.execute(sql`
      select staff_id,
        count(*) filter (where lower(status) = 'present')::int as present,
        count(*) filter (where lower(status) = 'late')::int as late,
        count(*) filter (where lower(status) in ('absent','no_show'))::int as absent
      from attendance_records
      where check_in_at >= ${from} and check_in_at <= ${toPlus}
      group by staff_id
    `),
    db.execute(sql`
      select requested_by as staff_id, department,
        count(*)::int as jobs,
        coalesce(sum(amount::numeric),0)::float as revenue
      from financial_transactions
      where approval_status = 'executed' and direction = 'revenue' and requested_by is not null
        and transaction_date >= ${from} and transaction_date <= ${to}
      group by requested_by, department
    `),
    db.execute(sql`
      select staff_id, count(*)::int as cnt, coalesce(avg(rating),0)::float as avg_rating,
        count(*) filter (where rating >= 4)::int as positive,
        count(*) filter (where rating <= 2)::int as negative
      from (
        select case r.order_kind
                 when 'kosha' then kb.assigned_staff_id
                 when 'photography' then po.assigned_staff_id
               end as staff_id,
               r.rating
        from order_reviews r
        left join kosha_bookings kb on r.order_kind = 'kosha' and kb.id = r.order_id
        left join photography_orders po on r.order_kind = 'photography' and po.id = r.order_id
        where r.created_at >= ${from} and r.created_at <= ${toPlus}
      ) t
      where staff_id is not null
      group by staff_id
    `),
    db.execute(sql`
      select ec.staff_id,
        count(*) filter (where ap.status = 'maintenance')::int as broken,
        count(*) filter (where ap.status = 'lost')::int as lost,
        coalesce(sum(coalesce(pass.maintenance_cost::numeric, 0)), 0)::float as repair_cost
      from asset_profiles ap
      join lateral (
        select staff_id from equipment_custody where product_id = ap.product_id order by issued_at desc limit 1
      ) ec on true
      left join asset_passports pass on pass.product_id = ap.product_id
      where ap.status in ('lost','maintenance') and ec.staff_id is not null
      group by ec.staff_id
    `),
    db.execute(sql`select staff_id, kind, coalesce(points,0)::int as points, created_at from "employee_performance_actions" order by created_at`),
  ]);

  const tasksBy = new Map<number, any>(rows(tasksR).map((r) => [Number(r.staff_id), r]));
  const attBy = new Map<number, any>(rows(attR).map((r) => [Number(r.staff_id), r]));
  const revBy = new Map<number, any>(rows(revR).map((r) => [Number(r.staff_id), r]));
  const dmgBy = new Map<number, any>(rows(dmgR).map((r) => [Number(r.staff_id), r]));

  // financial rows are per (staff, department) — fold to per staff.
  const finBy = new Map<number, { revenue: number; jobs: number; salesRevenue: number }>();
  for (const r of rows(finR)) {
    const id = Number(r.staff_id);
    const cur = finBy.get(id) ?? { revenue: 0, jobs: 0, salesRevenue: 0 };
    cur.revenue += Number(r.revenue) || 0;
    cur.jobs += Number(r.jobs) || 0;
    if (["store", "sales", "pos"].includes(String(r.department))) cur.salesRevenue += Number(r.revenue) || 0;
    finBy.set(id, cur);
  }

  // manager actions → adjustment points + suspension state.
  const adjustBy = new Map<number, number>();
  const suspendState = new Map<number, boolean>();
  for (const a of rows(actR)) {
    const id = Number(a.staff_id);
    const kind = String(a.kind);
    if (kind === "bonus" || kind === "reward") adjustBy.set(id, (adjustBy.get(id) ?? 0) + Number(a.points || 0));
    if (kind === "penalty") adjustBy.set(id, (adjustBy.get(id) ?? 0) - Math.abs(Number(a.points || 0)));
    if (kind === "suspend") suspendState.set(id, true);
    if (kind === "unsuspend") suspendState.set(id, false);
  }

  const topRevenue = Math.max(0, ...[...finBy.values()].map((f) => f.revenue));

  const scores: EmployeeScore[] = rows(staffR).map((s) => {
    const id = Number(s.id);
    const t = tasksBy.get(id) ?? {};
    const a = attBy.get(id) ?? {};
    const f = finBy.get(id) ?? { revenue: 0, jobs: 0, salesRevenue: 0 };
    const rv = revBy.get(id) ?? {};
    const dm = dmgBy.get(id) ?? {};

    const negativeReviews = Number(rv.negative || 0);
    const tasksMissed = Number(t.missed || 0);
    const lostAssets = Number(dm.lost || 0);

    const details: EmployeeDetails = {
      present: Number(a.present || 0),
      late: Number(a.late || 0),
      absent: Number(a.absent || 0),
      tasksAssigned: Number(t.assigned || 0),
      tasksCompleted: Number(t.completed || 0),
      tasksMissed,
      tasksLate: Number(t.late_completed || 0),
      avgCompleteHours: Number(t.avg_complete_hours || 0),
      onTimeRate: Number(t.completed || 0) ? (Number(t.completed) - Number(t.late_completed || 0)) / Number(t.completed) : 1,
      errorEvents: negativeReviews + tasksMissed + lostAssets,
      negativeReviews,
      brokenAssets: Number(dm.broken || 0),
      lostAssets,
      repairCost: Number(dm.repair_cost || 0),
      jobsCompleted: Number(f.jobs || 0),
      revenue: Number(f.revenue || 0),
      salesRevenue: Number(f.salesRevenue || 0),
      avgPerJob: Number(f.jobs || 0) ? Number(f.revenue || 0) / Number(f.jobs) : 0,
      reviewsCount: Number(rv.cnt || 0),
      avgRating: Number(rv.avg_rating || 0),
      positiveReviews: Number(rv.positive || 0),
      recommendRate: Number(rv.cnt || 0) ? Number(rv.positive || 0) / Number(rv.cnt) : 0,
    };

    const categories: Record<CategoryKey, number> = {
      commitment: scoreCommitment(details),
      speed: scoreSpeed(details),
      errors: scoreErrors(details),
      assetCare: scoreAssetCare(details),
      profit: scoreProfit(details.revenue, topRevenue),
      satisfaction: scoreSatisfaction(details),
    };

    const baseOverall = clamp(
      round(
        (Object.keys(CATEGORY_WEIGHTS) as CategoryKey[]).reduce(
          (sum, k) => sum + categories[k] * CATEGORY_WEIGHTS[k],
          0,
        ),
      ),
    );
    const adjustment = adjustBy.get(id) ?? 0;
    const overall = clamp(baseOverall + adjustment);

    return {
      staffId: id,
      name: s.full_name || s.username,
      role: s.role,
      department: departmentOf(s.role, s.permissions ?? []),
      categories,
      overall,
      baseOverall,
      adjustment,
      level: levelFor(overall),
      suspended: suspendState.get(id) ?? false,
      rank: 0,
      details,
    };
  });

  // rank active (non-suspended) employees by overall.
  const ranked = scores.filter((s) => !s.suspended).sort((a, b) => b.overall - a.overall);
  ranked.forEach((s, i) => (s.rank = i + 1));
  return scores;
}

// ───── leaderboards ─────

export type LeaderboardEntry = { key: string; label: string; icon: string; staffId: number | null; name: string; score: number; metric: string };

const LEADERBOARDS: Array<{ key: string; label: string; icon: string; perm: string; by: CategoryKey | "overall"; metricLabel: string }> = [
  { key: "photographer", label: "أفضل مصوّر", icon: "📷", perm: "photography", by: "satisfaction", metricLabel: "رضا العملاء" },
  { key: "kosha", label: "أفضل فريق كوشات", icon: "🎪", perm: "koshas", by: "overall", metricLabel: "الأداء العام" },
  { key: "store", label: "أفضل موظف متجر", icon: "🛍️", perm: "products", by: "overall", metricLabel: "الأداء العام" },
  { key: "sales", label: "أفضل موظف مبيعات", icon: "💰", perm: "invoices", by: "profit", metricLabel: "المساهمة بالربح" },
  { key: "driver", label: "أفضل سائق", icon: "🚚", perm: "delivery", by: "speed", metricLabel: "السرعة" },
  { key: "installer", label: "أفضل فنّي تركيب", icon: "🔧", perm: "koshas", by: "speed", metricLabel: "السرعة" },
];

export async function getLeaderboards(range?: PerfRange): Promise<LeaderboardEntry[]> {
  const scores = await computeEmployeeScores(range);
  const permR = await db.execute(sql`select id, permissions, role from staff where is_active = true`);
  const permBy = new Map<number, string[]>(rows(permR).map((r) => [Number(r.id), (r.permissions ?? []) as string[]]));

  return LEADERBOARDS.map((lb) => {
    const eligible = scores.filter((s) => !s.suspended && (s.role === "admin" || s.role === "manager" || (permBy.get(s.staffId) ?? []).includes(lb.perm)));
    const metricValue = (s: EmployeeScore) => (lb.by === "overall" ? s.overall : s.categories[lb.by]);
    const best = eligible.sort((a, b) => metricValue(b) - metricValue(a))[0];
    return {
      key: lb.key,
      label: lb.label,
      icon: lb.icon,
      staffId: best?.staffId ?? null,
      name: best?.name ?? "—",
      score: best ? metricValue(best) : 0,
      metric: lb.metricLabel,
    };
  });
}

// ───── trends (weekly / monthly / yearly) ─────

export async function getPerformanceTrends(
  staffId: number | null,
  granularity: "week" | "month" | "year" = "month",
): Promise<Array<{ period: string; revenue: number; jobs: number; avgRating: number }>> {
  const trunc = granularity === "year" ? "year" : granularity === "week" ? "week" : "month";
  const back = granularity === "year" ? "5 years" : granularity === "week" ? "12 weeks" : "12 months";
  const staffFilter = staffId ? sql`and requested_by = ${staffId}` : sql``;
  const finR = await db.execute(sql`
    select to_char(date_trunc(${trunc}, transaction_date::timestamp), 'YYYY-MM-DD') as period,
      count(*)::int as jobs,
      coalesce(sum(amount::numeric),0)::float as revenue
    from financial_transactions
    where approval_status = 'executed' and direction = 'revenue'
      and transaction_date::timestamp >= now() - interval '${sql.raw(back)}'
      ${staffFilter}
    group by 1 order by 1
  `);
  return rows(finR).map((r) => ({
    period: String(r.period),
    revenue: Number(r.revenue) || 0,
    jobs: Number(r.jobs) || 0,
    avgRating: 0,
  }));
}

// ───── employee profile ─────

export async function getEmployeeProfile(staffId: number, range?: PerfRange) {
  const scores = await computeEmployeeScores(range);
  const me = scores.find((s) => s.staffId === staffId);
  if (!me) return null;

  const [infoR, actionsR, timelineR, reviewsR, damageR] = await Promise.all([
    db.execute(sql`select id, full_name, username, role, permissions, is_active, created_at, last_activity_at from staff where id = ${staffId} limit 1`),
    db.execute(sql`select id, kind, points, title, note, created_by_name, created_at from "employee_performance_actions" where staff_id = ${staffId} order by created_at desc limit 50`),
    db.execute(sql`select type, title, body, created_at from entity_timeline where entity_type = 'staff' and entity_id = ${staffId} order by created_at desc limit 30`),
    db.execute(sql`
      select r.rating, r.comment, r.order_kind, r.created_at
      from order_reviews r
      left join kosha_bookings kb on r.order_kind = 'kosha' and kb.id = r.order_id
      left join photography_orders po on r.order_kind = 'photography' and po.id = r.order_id
      where coalesce(case r.order_kind when 'kosha' then kb.assigned_staff_id when 'photography' then po.assigned_staff_id end, 0) = ${staffId}
      order by r.created_at desc limit 20
    `),
    db.execute(sql`
      select p.name_ar, p.name, ap.status, coalesce(pass.maintenance_cost::numeric,0)::float as cost
      from asset_profiles ap
      join lateral (select staff_id from equipment_custody where product_id = ap.product_id order by issued_at desc limit 1) ec on true
      left join asset_passports pass on pass.product_id = ap.product_id
      left join products p on p.id = ap.product_id
      where ap.status in ('lost','maintenance') and ec.staff_id = ${staffId}
      order by ap.updated_at desc limit 30
    `),
  ]);
  const info = rows(infoR)[0] ?? {};

  return {
    ...me,
    info: {
      id: info.id,
      name: info.full_name || info.username,
      username: info.username,
      role: info.role,
      permissions: info.permissions ?? [],
      isActive: info.is_active,
      createdAt: info.created_at,
      lastActivityAt: info.last_activity_at,
    },
    actions: rows(actionsR).map((a) => ({ id: a.id, kind: a.kind, points: a.points, title: a.title, note: a.note, by: a.created_by_name, at: a.created_at })),
    timeline: rows(timelineR).map((t) => ({ type: t.type, title: t.title, body: t.body, at: t.created_at })),
    reviews: rows(reviewsR).map((r) => ({ rating: r.rating, comment: r.comment, kind: r.order_kind, at: r.created_at })),
    damageHistory: rows(damageR).map((d) => ({ name: d.name_ar || d.name, status: d.status, cost: Number(d.cost) || 0 })),
  };
}
