/** Shared presentation contract. Persisted legacy statuses are never rewritten. */
export const RESEARCH_WORKFLOW_STAGES = [
  { key: 'new', label: 'طلب جديد', statuses: ['new'], targetStatus: 'new' },
  { key: 'requirements_review', label: 'مراجعة المتطلبات', statuses: ['accepted'], targetStatus: 'accepted' },
  { key: 'in_progress', label: 'قيد التنفيذ', statuses: ['searching_sources', 'writing'], targetStatus: 'writing' },
  { key: 'quality_review', label: 'مراجعة الجودة', statuses: ['review', 'formatting', 'plagiarism_check'], targetStatus: 'review' },
  { key: 'ready', label: 'جاهز للتسليم', statuses: ['completed'], targetStatus: 'completed' },
  { key: 'completed', label: 'مكتمل', statuses: ['delivered'], targetStatus: 'delivered' },
] as const;
export type ResearchWorkflowStage = typeof RESEARCH_WORKFLOW_STAGES[number]['key'];
export const RESEARCH_CATEGORIES: Record<string, string> = {
  theoretical: 'بحث نظري', software: 'مشروع برمجي', hardware: 'مشروع هاردوير',
  data_analysis: 'تحليل بيانات', matlab: 'MATLAB', python: 'Python', arduino: 'Arduino',
  proofreading: 'تدقيق وتنسيق أكاديمي', other: 'خدمات أخرى',
};
export const ACADEMIC_LEVELS: Record<string, string> = { bachelor: 'بكالوريوس', master: 'ماجستير', phd: 'دكتوراه' };
export const RESEARCH_FINANCIAL_STATUSES: Record<string, string> = { unpaid: 'غير مسدد', partial: 'مسدد جزئياً', paid: 'مسدد بالكامل', overdue: 'متأخر بالسداد' };
/** Editing the original cost must preserve its single department attribution. */
export function researchCostAttributionConflict(researchOrderId:unknown, lines:readonly Record<string,unknown>[]):boolean {
  return Number(researchOrderId)>0 && lines.some(line=>['koshaId','bookingId','constructionProjectId','costCategory'].some(key=>line[key]!==null&&line[key]!==undefined&&line[key]!==''));
}
export function researchWorkflowStage(status: string): ResearchWorkflowStage | null {
  return RESEARCH_WORKFLOW_STAGES.find(stage => (stage.statuses as readonly string[]).includes(status))?.key ?? null;
}
export function researchDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function researchFinancialStatus(input: { remainingAmount: unknown; paidAmount: unknown; totalAmount?: unknown; paymentDueDate?: string | null }, day = researchDate()): 'paid' | 'overdue' | 'partial' | 'unpaid' {
  const remaining = Number(input.remainingAmount), paid = Number(input.paidAmount);
  if (!Number.isFinite(remaining) || !Number.isFinite(paid) || remaining < 0 || paid < 0) throw new Error('قيمة مالية غير صحيحة في طلب البحث');
  if (remaining <= 0) return 'paid';
  if (input.paymentDueDate && input.paymentDueDate < day) return 'overdue';
  return paid > 0 || (input.totalAmount != null && Number(input.totalAmount) > remaining) ? 'partial' : 'unpaid';
}
export type ResearchFilters = {
  search: string; from: string | null; to: string | null; staffId: number | null;
  page: number; pageSize: number; stage: ResearchWorkflowStage | null; category: string | null;
  status: string | null; financialStatus: string | null; university: string | null;
};
const LEGACY_STATUSES = [...RESEARCH_WORKFLOW_STAGES.flatMap(stage => [...stage.statuses]), 'archived'];
function dateFilter(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('تاريخ التصفية غير صحيح');
  return value;
}
export function parseResearchFilters(params: URLSearchParams): ResearchFilters {
  const integer = (name: string, fallback: number, max: number) => {
    const raw = params.get(name); const value = raw ? Number(raw) : fallback;
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error('معامل التصفية غير صحيح');
    return value;
  };
  const from = dateFilter(params.get('from')), to = dateFilter(params.get('to'));
  if (from && to && from > to) throw new Error('فترة التاريخ غير صحيحة');
  const stage = params.get('stage') || null, category = params.get('category') || null;
  const status = params.get('status') || null, financialStatus = params.get('financialStatus') || null;
  if (stage && !RESEARCH_WORKFLOW_STAGES.some(row => row.key === stage)) throw new Error('مرحلة غير صحيحة');
  if (category && !Object.hasOwn(RESEARCH_CATEGORIES, category)) throw new Error('تصنيف غير صحيح');
  if (status && !(LEGACY_STATUSES as readonly string[]).includes(status)) throw new Error('حالة غير صحيحة');
  if (financialStatus && !Object.hasOwn(RESEARCH_FINANCIAL_STATUSES, financialStatus)) throw new Error('حالة تسديد غير صحيحة');
  return { search: (params.get('search') || params.get('q') || '').trim().slice(0, 180), from, to,
    staffId: params.get('staffId') ? integer('staffId', 1, 2147483647) : null,
    page: integer('page', 1, 100000), pageSize: integer('pageSize', 30, 100),
    stage: stage as ResearchWorkflowStage | null, category, status, financialStatus,
    university: params.get('university')?.trim().slice(0, 240) || null };
}
