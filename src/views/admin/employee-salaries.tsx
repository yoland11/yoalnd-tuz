import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileDown,
  FileClock,
  FileSpreadsheet,
  Link2,
  Loader2,
  MinusCircle,
  Pencil,
  Paperclip,
  Plus,
  PlusCircle,
  Printer,
  Search,
  ShieldAlert,
  Trash2,
  Undo2,
  Wrench,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { adminFetch, getCachedAdminMe, hasPerm } from "./_lib";
import { downloadElementPdf } from "@/lib/pdf";
import { printWhenImagesReadyScript, salarySlipCss, sheetReportCss } from "./print-helpers";

type SalaryLine = {
  id: number;
  staff_id: number;
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  department: string;
  jobTitle?: string;
  baseSalary: number;
  attendanceAllowance: number;
  transportationAllowance: number;
  foodAllowance: number;
  phoneAllowance: number;
  housingAllowance: number;
  otherFixedAllowances: number;
  bonusAmount: number;
  commissionAmount: number;
  overtimeAmount: number;
  otherEarnings: number;
  penaltyAmount: number;
  advanceDeduction: number;
  attendanceDeduction: number;
  absenceDeduction: number;
  lateDeduction: number;
  manualDeduction: number;
  otherDeductions: number;
  fixedDeduction: number;
  grossSalary: number;
  netSalary: number;
  totalDeductions: number;
  amountPaid: number;
  remainingSalary: number;
  paymentStatus: string;
  paymentMethod: string;
  lineNotes?: string | null;
  financial_transaction_id?: number | null;
  sourceRecords?: { advances?: unknown[]; accounting?: { id: number; transaction_no: string } | null; cashboxTransactionId?: number | null };
};

type PayrollRun = {
  id: number;
  run_no: string;
  period: string;
  status: string;
  periodStartDate?: string | null;
  periodEndDate?: string | null;
  paymentDate?: string | null;
  payment_reference?: string | null;
  approved_by_name?: string;
  paid_by_name?: string;
  created_by_name?: string;
  approved_at?: string | null;
  paid_at?: string | null;
  lines: SalaryLine[];
  auditLog?: unknown[];
  timeline?: unknown[];
};

type SalaryRow = SalaryLine & {
  runId: number;
  salaryNumber: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  paymentDate: string;
  payrollStatus: string;
  runNo: string;
  origin: "historical" | "new";
  legacyIssues: string[];
  approvedBy?: string;
  paidBy?: string;
  createdBy?: string;
  auditLog?: unknown[];
  timeline?: unknown[];
};
type StaffOption = { id: number; fullName?: string; username?: string; department?: string };
type SalaryManagement = {
  payments: Array<{ id: number; amount: string | number; payment_date: string; payment_method: string; transaction_no: string; financial_transaction_id: number; status: string; created_by_name: string; balance_before?: string | number; balance_after?: string | number; reversal_txn_id?: number | null }>;
  adjustments: Array<{ id: number; direction: string; adjustment_type: string; amount: string | number; reason: string; status: string; include_in: string; effective_date: string; created_by_name: string; created_at: string }>;
  attachments: Array<{ id: number; name: string; mime_type: string; data_url: string; notes?: string; uploaded_by_name: string; created_at: string }>;
  events: Array<{ id: number; action: string; reason?: string; actor_name: string; old_values: unknown; new_values: unknown; financial_transaction_id?: number; created_at: string }>;
  suggestions: Array<{ id: number; transaction_no: string; transaction_date: string; amount: number; payment_method: string; description: string; match_score: number }>;
};

const money = new Intl.NumberFormat("ar-IQ", { style: "currency", currency: "IQD", maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("ar-IQ", { notation: "compact", maximumFractionDigits: 1 });
const periodLabel = (value: string) => value ? new Date(`${value}-01T00:00:00Z`).toLocaleDateString("ar-IQ", { month: "long", year: "numeric", timeZone: "UTC" }) : "—";
const n = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const normalized = String(value ?? "")
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/[٬,\s]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); }

const payrollLabels: Record<string, string> = {
  draft: "مسودة", calculated: "محسوب", under_review: "قيد المراجعة",
  pending_manager_approval: "بانتظار اعتماد المدير", approved: "معتمد",
  processing: "قيد الصرف", paid: "مدفوع", partially_paid: "مدفوع جزئياً",
  rejected: "مرفوض", cancelled: "ملغي", reversed: "معكوس",
};
const paymentLabels: Record<string, string> = { unpaid: "غير مدفوع", partially_paid: "مدفوع جزئياً", paid: "مدفوع", reversed: "معكوس" };

function statusTone(status: string) {
  if (["paid", "approved"].includes(status)) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20";
  if (["rejected", "cancelled", "reversed"].includes(status)) return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20";
  if (["pending_manager_approval", "processing", "partially_paid"].includes(status)) return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20";
  return "bg-muted text-muted-foreground";
}

function flattenRuns(runs: PayrollRun[]): SalaryRow[] {
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return runs.flatMap((run) => (run.lines || []).map((line) => {
    const legacyIssues: string[] = [];
    if (!run.periodStartDate || !run.periodEndDate) legacyIssues.push("فترة الراتب غير مكتملة");
    if (n(line.amountPaid) > 0 && !line.financial_transaction_id) legacyIssues.push("راتب قديم غير مربوط ماليًا");
    if (!line.paymentMethod) legacyIssues.push("طريقة الدفع غير مسجلة");
    if (!line.sourceRecords?.accounting && n(line.amountPaid) > 0) legacyIssues.push("قيد الدفع يحتاج مراجعة");
    const historical = run.period < currentPeriod || legacyIssues.length > 0;
    return {
      ...line,
      runId: run.id,
      salaryNumber: `SAL-${run.period.replace("-", "")}-${String(line.id).padStart(5, "0")}`,
      period: run.period,
      periodStart: run.periodStartDate || `${run.period}-01`,
      periodEnd: run.periodEndDate || "",
      paymentDate: run.paymentDate || (run.paid_at ? String(run.paid_at).slice(0, 10) : ""),
      payrollStatus: run.status,
      runNo: run.run_no,
      origin: historical ? "historical" : "new",
      legacyIssues,
      approvedBy: run.approved_by_name,
      paidBy: run.paid_by_name,
      createdBy: run.created_by_name,
      auditLog: run.auditLog,
      timeline: run.timeline,
    };
  }));
}

type EditorState = { mode: "create" | "edit" | "add" | "reduce"; row?: SalaryRow } | null;

export default function EmployeeSalariesPage() {
  const qc = useQueryClient();
  const me = getCachedAdminMe();
  const [location, navigate] = useLocation();
  const params = useMemo(() => new URLSearchParams(location.split("?")[1] || ""), [location]);
  const [search, setSearch] = useState(params.get("search") || "");
  const [month, setMonth] = useState(params.get("month") || "all");
  const [year, setYear] = useState(params.get("year") || "all");
  const [department, setDepartment] = useState(params.get("department") || "all");
  const [paymentStatus, setPaymentStatus] = useState(params.get("paymentStatus") || "all");
  const [payrollStatus, setPayrollStatus] = useState(params.get("payrollStatus") || "all");
  const [origin, setOrigin] = useState(params.get("origin") || "all");
  const [selected, setSelected] = useState<SalaryRow | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [deleteRow, setDeleteRow] = useState<SalaryRow | null>(null);
  const [reverseRow, setReverseRow] = useState<SalaryRow | null>(null);
  const [paymentRow, setPaymentRow] = useState<SalaryRow | null>(null);
  const [reconcileRow, setReconcileRow] = useState<SalaryRow | null>(null);
  const [correctionRow, setCorrectionRow] = useState<SalaryRow | null>(null);
  const [attachmentRow, setAttachmentRow] = useState<SalaryRow | null>(null);
  const [reversePayment, setReversePayment] = useState<{ row: SalaryRow; payment: SalaryManagement["payments"][number] } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const runsQuery = useQuery({ queryKey: ["employee-salaries"], queryFn: () => adminFetch<PayrollRun[]>("/admin/hr/payroll") });
  const staffQuery = useQuery({ queryKey: ["admin", "staff"], queryFn: () => adminFetch<StaffOption[]>("/admin/staff") });
  const detailTarget = selected || reconcileRow || correctionRow;
  const managementQuery = useQuery({ queryKey: ["employee-salary-management", detailTarget?.runId, detailTarget?.id], enabled: !!detailTarget, queryFn: () => adminFetch<SalaryManagement>(`/admin/hr/payroll/${detailTarget!.runId}/lines/${detailTarget!.id}/management`) });
  const rows = useMemo(() => flattenRuns(runsQuery.data || []), [runsQuery.data]);
  const departments = useMemo(() => [...new Set(rows.map((row) => row.department).filter(Boolean))].sort(), [rows]);
  const years = useMemo(() => [...new Set(rows.map((row) => row.period.slice(0, 4)))].sort().reverse(), [rows]);

  const filtered = useMemo(() => rows.filter((row) => {
    const needle = search.trim().toLocaleLowerCase("ar");
    if (needle && ![row.employeeName, row.employeeCode, row.salaryNumber, row.runNo, row.department].join(" ").toLocaleLowerCase("ar").includes(needle)) return false;
    if (month !== "all" && row.period.slice(5, 7) !== month) return false;
    if (year !== "all" && row.period.slice(0, 4) !== year) return false;
    if (department !== "all" && row.department !== department) return false;
    if (paymentStatus !== "all" && row.paymentStatus !== paymentStatus) return false;
    if (payrollStatus !== "all" && row.payrollStatus !== payrollStatus) return false;
    if (origin !== "all" && row.origin !== origin) return false;
    return true;
  }), [rows, search, month, year, department, paymentStatus, payrollStatus, origin]);

  const totals = useMemo(() => filtered.reduce((t, row) => {
    const allowances = n(row.attendanceAllowance) + n(row.transportationAllowance) + n(row.foodAllowance) + n(row.phoneAllowance) + n(row.housingAllowance) + n(row.otherFixedAllowances);
    t.base += n(row.baseSalary); t.additions += n(row.otherEarnings) + n(row.commissionAmount); t.bonuses += n(row.bonusAmount);
    t.allowances += allowances; t.deductions += Math.max(0, n(row.totalDeductions) - n(row.advanceDeduction)); t.advances += n(row.advanceDeduction);
    t.gross += n(row.grossSalary); t.net += n(row.netSalary); t.paid += n(row.amountPaid); t.remaining += n(row.remainingSalary); return t;
  }, { base: 0, additions: 0, bonuses: 0, allowances: 0, deductions: 0, advances: 0, gross: 0, net: 0, paid: 0, remaining: 0 }), [filtered]);

  function syncFilters(next: Record<string, string>) {
    const p = new URLSearchParams();
    const values = { search, month, year, department, paymentStatus, payrollStatus, origin, ...next };
    for (const [key, value] of Object.entries(values)) if (value && value !== "all") p.set(key, value);
    navigate(`/admin/employee-salaries${p.size ? `?${p}` : ""}`, { replace: true });
  }

  const runAction = useMutation({
    mutationFn: ({ row, action, payload }: { row: SalaryRow; action: string; payload?: unknown }) => adminFetch(`/admin/hr/payroll/${row.runId}/${action}`, { method: "POST", body: JSON.stringify(payload || {}) }),
    onSuccess: (_, variables) => { toast.success(variables.action === "approve" ? "تم اعتماد دورة الرواتب دون سحب من الصندوق" : variables.action === "pay" ? "تم صرف دورة الرواتب وتسجيل الحركة المالية" : "تم تنفيذ الإجراء بنجاح"); qc.invalidateQueries({ queryKey: ["employee-salaries"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const editMutation = useMutation({
    mutationFn: ({ row, payload }: { row: SalaryRow; payload: unknown }) => adminFetch(`/admin/hr/payroll/${row.runId}/lines/${row.id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: () => { toast.success("تم تحديث الراتب وإعادة احتساب الإجماليات"); setEditor(null); qc.invalidateQueries({ queryKey: ["employee-salaries"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const createMutation = useMutation({
    mutationFn: (payload: unknown) => adminFetch("/admin/hr/payroll", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => { toast.success("تم إنشاء سجل الراتب كمسودة دون سحب من الصندوق"); setEditor(null); qc.invalidateQueries({ queryKey: ["employee-salaries"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: ({ row, reason }: { row: SalaryRow; reason: string }) => adminFetch(`/admin/hr/payroll/${row.runId}/lines/${row.id}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
    onSuccess: () => { toast.success("تم حذف سجل الراتب غير المرحّل"); setDeleteRow(null); qc.invalidateQueries({ queryKey: ["employee-salaries"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const reverseMutation = useMutation({
    mutationFn: ({ row, reason }: { row: SalaryRow; reason: string }) => adminFetch(`/admin/hr/payroll/${row.runId}/reverse`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => { toast.success("تم عكس الصرف وحركة الصندوق والقيود واسترجاع خصومات السلف"); setReverseRow(null); qc.invalidateQueries({ queryKey: ["employee-salaries"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const paymentMutation = useMutation({
    mutationFn: ({ row, payload }: { row: SalaryRow; payload: unknown }) => adminFetch(`/admin/hr/payroll/${row.runId}/lines/${row.id}/pay`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => { toast.success("تم تسجيل دفعة الراتب والصندوق والقيد المحاسبي بنجاح"); setPaymentRow(null); qc.invalidateQueries({ queryKey: ["employee-salaries"] }); qc.invalidateQueries({ queryKey: ["employee-salary-management"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const adjustmentMutation = useMutation({
    mutationFn: ({ row, payload }: { row: SalaryRow; payload: unknown }) => adminFetch(`/admin/hr/payroll/${row.runId}/lines/${row.id}/adjustments`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => { toast.success("تم حفظ تعديل الراتب وسجل التدقيق"); setEditor(null); qc.invalidateQueries({ queryKey: ["employee-salaries"] }); qc.invalidateQueries({ queryKey: ["employee-salary-management"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const reconcileMutation = useMutation({
    mutationFn: ({ row, payload }: { row: SalaryRow; payload: unknown }) => adminFetch(`/admin/hr/payroll/${row.runId}/lines/${row.id}/reconcile`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => { toast.success("تم ربط الراتب القديم بالحركة المالية دون إنشاء حركة جديدة"); setReconcileRow(null); qc.invalidateQueries({ queryKey: ["employee-salaries"] }); qc.invalidateQueries({ queryKey: ["employee-salary-management"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const correctionMutation = useMutation({
    mutationFn: ({ row, payload }: { row: SalaryRow; payload: unknown }) => adminFetch(`/admin/hr/payroll/${row.runId}/lines/${row.id}/correct`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => { toast.success("تم عكس الدفعات وتصحيح الراتب؛ أصبح جاهزاً لإعادة الصرف"); setCorrectionRow(null); qc.invalidateQueries({ queryKey: ["employee-salaries"] }); qc.invalidateQueries({ queryKey: ["employee-salary-management"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const attachmentMutation = useMutation({
    mutationFn: ({ row, payload }: { row: SalaryRow; payload: unknown }) => adminFetch(`/admin/hr/payroll/${row.runId}/lines/${row.id}/attachments`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => { toast.success("تم إرفاق الملف بالراتب"); setAttachmentRow(null); qc.invalidateQueries({ queryKey: ["employee-salary-management"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const reversePaymentMutation = useMutation({
    mutationFn: ({ row, payment, reason }: { row: SalaryRow; payment: SalaryManagement["payments"][number]; reason: string }) => adminFetch(`/admin/hr/payroll/${row.runId}/lines/${row.id}/payments/${payment.id}/reverse`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => { toast.success("تم عكس دفعة الراتب وحركتها المالية مع حفظ السجل الأصلي"); setReversePayment(null); qc.invalidateQueries({ queryKey: ["employee-salaries"] }); qc.invalidateQueries({ queryKey: ["employee-salary-management"] }); },
    onError: (error: Error) => toast.error(error.message),
  });

  function openEditor(mode: NonNullable<EditorState>["mode"], row?: SalaryRow) {
    setEditor({ mode, row });
    setForm(row ? {
      period: row.period, baseSalary: String(row.baseSalary), allowances: String(n(row.attendanceAllowance) + n(row.transportationAllowance) + n(row.foodAllowance) + n(row.phoneAllowance) + n(row.housingAllowance) + n(row.otherFixedAllowances)),
      bonusAmount: String(row.bonusAmount), overtimeAmount: String(row.overtimeAmount), otherEarnings: String(row.otherEarnings), manualDeduction: String(row.manualDeduction), advanceDeduction: String(row.advanceDeduction), paymentMethod: row.paymentMethod || "cash", paymentDate: row.paymentDate, notes: row.lineNotes || "", amount: "", reason: "", includeIn: n(row.amountPaid) > 0 ? "next" : "current",
    } : (() => { const period = new Date().toISOString().slice(0, 7); const end = new Date(`${period}-01T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1, 0); return { period, employeeIds: "", periodStartDate: `${period}-01`, periodEndDate: end.toISOString().slice(0, 10), paymentDate: "", baseSalary: "0", allowances: "0", bonusAmount: "0", overtimeAmount: "0", manualAddition: "0", manualDeduction: "0", advanceDeduction: "0", paymentMethod: "cash", notes: "" }; })());
  }

  function submitEditor(): void {
    if (!editor) return;
    if (editor.mode === "create") {
      const employeeId = Number(form.employeeIds);
      if (!employeeId) { toast.error("اختر الموظف بإدخال رقمه الوظيفي"); return; }
      if (!form.periodStartDate || !form.periodEndDate || n(form.baseSalary) <= 0) { toast.error("أكمل فترة الراتب والراتب الأساسي"); return; }
      createMutation.mutate({ manual: true, employeeId, period: form.period, periodStartDate: form.periodStartDate, periodEndDate: form.periodEndDate, paymentDate: form.paymentDate || null, baseSalary: n(form.baseSalary), allowances: n(form.allowances), bonusAmount: n(form.bonusAmount), overtimeAmount: n(form.overtimeAmount), manualAddition: n(form.manualAddition), manualDeduction: n(form.manualDeduction), advanceDeduction: n(form.advanceDeduction), paymentMethod: form.paymentMethod || "cash", notes: form.notes || null });
      return;
    }
    const row = editor.row!;
    if (editor.mode === "add" || editor.mode === "reduce") {
      const amount = n(form.amount);
      if (amount <= 0 || String(form.reason || "").trim().length < 3) { toast.error("أدخل مبلغًا صحيحًا وسببًا واضحًا"); return; }
      if (n(row.amountPaid) > 0 && (form.includeIn || "current") === "current") { toast.error("الراتب مصروف؛ اختر تطبيق التعديل على الراتب القادم أو استخدم تصحيح الراتب المصروف"); return; }
      adjustmentMutation.mutate({ row, payload: { direction: editor.mode === "add" ? "addition" : "deduction", adjustmentType: form.adjustmentType || "manual", amount, reason: form.reason, notes: form.notes || null, effectiveDate: form.effectiveDate || new Date().toISOString().slice(0, 10), includeIn: form.includeIn || "current", attachment: form.attachment || null } });
      return;
    }
    editMutation.mutate({ row, payload: {
      baseSalary: n(form.baseSalary), bonusAmount: n(form.bonusAmount), overtimeAmount: n(form.overtimeAmount), otherEarnings: n(form.otherEarnings), manualDeduction: n(form.manualDeduction), advanceDeduction: n(form.advanceDeduction), paymentMethod: form.paymentMethod || "cash", paymentDate: form.paymentDate || null, notes: form.notes || null,
    } });
  }

  function exportCsv() {
    const head = ["رقم الراتب", "الموظف", "رمز الموظف", "القسم", "الشهر", "الأساسي", "الإجمالي", "الصافي", "المدفوع", "المتبقي", "حالة الدفع"];
    const lines = filtered.map((row) => [row.salaryNumber, row.employeeName, row.employeeCode, row.department, row.period, row.baseSalary, row.grossSalary, row.netSalary, row.amountPaid, row.remainingSalary, paymentLabels[row.paymentStatus] || row.paymentStatus]);
    const csv = "\uFEFF" + [head, ...lines].map((line) => line.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `employee-salaries-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  function exportExcel() {
    const columns = ["رقم الراتب", "الموظف", "رمز الموظف", "القسم", "الشهر", "الراتب الأساسي", "الإجمالي", "الصافي", "المدفوع", "المتبقي", "حالة الدفع"];
    const data = filtered.map((row) => [row.salaryNumber, row.employeeName, row.employeeCode, row.department, row.period, row.baseSalary, row.grossSalary, row.netSalary, row.amountPaid, row.remainingSalary, paymentLabels[row.paymentStatus] || row.paymentStatus]);
    const cell = (value: unknown, number = false) => `<Cell ss:StyleID="${number ? "Money" : "Text"}"><Data ss:Type="${number ? "Number" : "String"}">${esc(value)}</Data></Cell>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default"><Alignment ss:Vertical="Center" ss:ReadingOrder="RightToLeft"/><Font ss:FontName="Arial" ss:Size="11"/></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#E0685A" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:ReadingOrder="RightToLeft"/></Style><Style ss:ID="Text"><Alignment ss:ReadingOrder="RightToLeft"/></Style><Style ss:ID="Money"><NumberFormat ss:Format="#,##0 [$د.ع]"/><Alignment ss:Horizontal="Right"/></Style></Styles><Worksheet ss:Name="رواتب الموظفين"><Table><Row ss:Height="30"><Cell ss:MergeAcross="10" ss:StyleID="Header"><Data ss:Type="String">تقرير رواتب الموظفين - مجموعة علي جان نهاد</Data></Cell></Row><Row>${columns.map((value) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${esc(value)}</Data></Cell>`).join("")}</Row>${data.map((row) => `<Row>${row.map((value, index) => cell(value, index >= 5 && index <= 9)).join("")}</Row>`).join("")}<Row>${["الإجمالي", "", "", "", "", totals.base, totals.gross, totals.net, totals.paid, totals.remaining, ""].map((value, index) => cell(value, index >= 5 && index <= 9)).join("")}</Row></Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Selected/><FreezePanes/><FrozenNoSplit/><SplitHorizontal>2</SplitHorizontal><TopRowBottomPane>2</TopRowBottomPane><DisplayRightToLeft/></WorksheetOptions></Worksheet></Workbook>`;
    downloadBlob(new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" }), `employee-salaries-${new Date().toISOString().slice(0, 10)}.xls`);
  }

  async function exportPdf() {
    const wrapper = document.createElement("section"); wrapper.className = "report-sheet"; wrapper.dir = "rtl"; wrapper.style.width = "190mm";
    wrapper.innerHTML = `<style>${sheetReportCss("a4")}</style><header class="report-head"><div><div class="report-company">مجموعة علي جان نهاد</div><div class="report-title">تقرير رواتب الموظفين</div></div><div class="report-meta">${esc(new Date().toLocaleDateString("ar-IQ"))}<br>${filtered.length} سجل</div></header><div class="report-summary"><div class="report-stat">إجمالي الصافي<strong>${esc(money.format(totals.net))}</strong></div><div class="report-stat">المدفوع<strong>${esc(money.format(totals.paid))}</strong></div><div class="report-stat">المتبقي<strong>${esc(money.format(totals.remaining))}</strong></div><div class="report-stat">السجلات<strong>${filtered.length}</strong></div></div><table class="report-table"><thead><tr><th>رقم الراتب</th><th>الموظف</th><th>الشهر</th><th>الصافي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>${filtered.map((row) => `<tr><td>${esc(row.salaryNumber)}</td><td>${esc(row.employeeName)}</td><td>${esc(row.period)}</td><td>${esc(money.format(row.netSalary))}</td><td>${esc(money.format(row.amountPaid))}</td><td>${esc(money.format(row.remainingSalary))}</td><td>${esc(paymentLabels[row.paymentStatus] || row.paymentStatus)}</td></tr>`).join("")}</tbody></table><footer class="report-footer">نظام AJN ERP - تقرير مولد حسب الفلاتر الحالية</footer>`;
    document.body.appendChild(wrapper);
    try { await downloadElementPdf(wrapper, `employee-salaries-${new Date().toISOString().slice(0, 10)}.pdf`, { format: "a4", margin: 8 }); toast.success("تم إنشاء ملف PDF"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "تعذر إنشاء PDF"); }
    finally { wrapper.remove(); }
  }

  function printSalary(row: SalaryRow): void {
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) { toast.error("اسمح بالنوافذ المنبثقة لطباعة قسيمة الراتب"); return; }
    popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(row.salaryNumber)}</title><style>${salarySlipCss()}</style></head><body><section class="report-sheet salary-slip"><header class="report-head"><div><div class="report-company">مجموعة علي جان نهاد</div><div class="report-title">قسيمة راتب موظف</div></div><div class="report-meta">${esc(row.salaryNumber)}<br>${esc(periodLabel(row.period))}</div></header><div class="salary-person"><div class="field"><span>الموظف</span><b>${esc(row.employeeName)}</b></div><div class="field"><span>الرمز الوظيفي</span><b>${esc(row.employeeCode)}</b></div><div class="field"><span>القسم</span><b>${esc(row.department || "—")}</b></div><div class="field"><span>الفترة</span><b>${esc(row.periodStart)} - ${esc(row.periodEnd || "—")}</b></div></div><table class="salary-components"><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody><tr><td>الراتب الأساسي</td><td>${esc(money.format(row.baseSalary))}</td></tr><tr><td>الإضافات والمكافآت والبدلات</td><td>${esc(money.format(n(row.grossSalary)-n(row.baseSalary)))}</td></tr><tr><td>الاستقطاعات والسلف</td><td>${esc(money.format(row.totalDeductions))}</td></tr><tr><td>المدفوع</td><td>${esc(money.format(row.amountPaid))}</td></tr><tr><td>المتبقي</td><td>${esc(money.format(row.remainingSalary))}</td></tr></tbody></table><div class="salary-net"><span>صافي الراتب</span><b>${esc(money.format(row.netSalary))}</b></div><div class="salary-signatures"><div>توقيع الموظف</div><div>اعتماد الإدارة</div></div></section>${printWhenImagesReadyScript()}</body></html>`);
    popup.document.close();
  }

  const canEdit = (row: SalaryRow) => ["draft", "calculated", "under_review", "pending_manager_approval", "rejected"].includes(row.payrollStatus) && !row.financial_transaction_id && n(row.amountPaid) === 0;
  const canAdjust = (row: SalaryRow) => !["cancelled", "reversed"].includes(row.payrollStatus);
  const canDelete = (row: SalaryRow) => ["draft", "calculated", "under_review", "pending_manager_approval", "rejected"].includes(row.payrollStatus) && !row.financial_transaction_id && n(row.amountPaid) === 0;
  const metrics = [
    ["إجمالي الرواتب", totals.net, WalletCards, "text-primary"], ["المدفوع", totals.paid, CheckCircle2, "text-emerald-600"],
    ["المتبقي", totals.remaining, Banknote, "text-amber-600"], ["بانتظار الموافقة", filtered.filter((r) => r.payrollStatus === "pending_manager_approval").length, FileClock, "text-sky-600"],
    ["الرواتب القديمة", filtered.filter((r) => r.origin === "historical").length, ShieldAlert, "text-rose-600"], ["الرواتب الجديدة", filtered.filter((r) => r.origin === "new").length, PlusCircle, "text-violet-600"],
  ] as const;

  return <main className="mx-auto w-full max-w-[1700px] space-y-5 p-3 sm:p-5" dir="rtl">
    <header className="flex flex-col gap-4 rounded-2xl border bg-card/80 p-5 shadow-sm backdrop-blur sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10"><WalletCards className="h-6 w-6 text-primary" /></span><div><h1 className="text-xl font-bold sm:text-2xl">رواتب الموظفين</h1><p className="text-sm text-muted-foreground">إدارة السجلات القديمة والجديدة، الصرف، المحاسبة وقسائم الرواتب.</p></div></div>
      <div className="flex flex-wrap gap-2 sm:ms-auto"><Button variant="outline" onClick={exportCsv} disabled={!filtered.length}><Download className="ms-2 h-4 w-4" />CSV</Button><Button variant="outline" onClick={exportExcel} disabled={!filtered.length}><FileSpreadsheet className="ms-2 h-4 w-4" />Excel</Button><Button variant="outline" onClick={exportPdf} disabled={!filtered.length}><FileDown className="ms-2 h-4 w-4" />PDF</Button><Button onClick={() => openEditor("create")} disabled={!me || (!hasPerm(me, "payroll_edit") && me.role !== "admin")}><Plus className="ms-2 h-4 w-4" />إضافة راتب</Button></div>
    </header>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">{metrics.map(([label, value, Icon, tone]) => <Card key={label} className="overflow-hidden"><CardContent className="p-4"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className={`h-4 w-4 ${tone}`} /></div><b className="mt-3 block text-lg tabular-nums sm:text-xl">{typeof value === "number" && label.includes("إجمالي") || label === "المدفوع" || label === "المتبقي" ? compact.format(value as number) : value}</b></CardContent></Card>)}</section>

    <Card><CardHeader className="pb-3"><CardTitle className="text-base">البحث والتصفية</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
      <div className="relative sm:col-span-2"><Search className="absolute end-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(e) => { setSearch(e.target.value); syncFilters({ search: e.target.value }); }} placeholder="اسم، رمز، رقم راتب أو دورة" className="pe-9" /></div>
      <Filter value={month} onValue={(v) => { setMonth(v); syncFilters({ month: v }); }} placeholder="الشهر" items={Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, "0"), new Date(2024, i, 1).toLocaleDateString("ar-IQ", { month: "long" })])} />
      <Filter value={year} onValue={(v) => { setYear(v); syncFilters({ year: v }); }} placeholder="السنة" items={years.map((v) => [v, v])} />
      <Filter value={department} onValue={(v) => { setDepartment(v); syncFilters({ department: v }); }} placeholder="القسم" items={departments.map((v) => [v, v])} />
      <Filter value={paymentStatus} onValue={(v) => { setPaymentStatus(v); syncFilters({ paymentStatus: v }); }} placeholder="حالة الدفع" items={Object.entries(paymentLabels)} />
      <Filter value={origin} onValue={(v) => { setOrigin(v); syncFilters({ origin: v }); }} placeholder="نوع السجل" items={[["historical", "سجلات قديمة"], ["new", "سجلات جديدة"]]} />
      <div className="lg:col-span-2"><Filter value={payrollStatus} onValue={(v) => { setPayrollStatus(v); syncFilters({ payrollStatus: v }); }} placeholder="حالة دورة الرواتب" items={Object.entries(payrollLabels)} /></div>
    </CardContent></Card>

    <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[1500px] text-sm"><thead className="bg-muted/60 text-xs"><tr>{["رقم الراتب", "الموظف", "الشهر / الفترة", "الأساسي", "الإضافات", "المكافآت", "البدلات", "الاستقطاعات", "خصم السلفة", "الإجمالي", "الصافي", "المدفوع", "المتبقي", "الدفع", "الدورة", "الإجراءات"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-3 text-start font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y">
      {runsQuery.isLoading && <tr><td colSpan={16} className="p-12 text-center text-muted-foreground"><Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />جارٍ تحميل سجلات الرواتب…</td></tr>}
      {runsQuery.isError && <tr><td colSpan={16} className="p-12 text-center text-destructive">تعذر تحميل الرواتب. حاول تحديث الصفحة.</td></tr>}
      {!runsQuery.isLoading && filtered.map((row) => {
        const allowances = n(row.attendanceAllowance) + n(row.transportationAllowance) + n(row.foodAllowance) + n(row.phoneAllowance) + n(row.housingAllowance) + n(row.otherFixedAllowances);
        return <tr key={row.id} className="align-top transition-colors hover:bg-muted/30">
          <td className="px-3 py-3"><b className="font-mono text-xs">{row.salaryNumber}</b>{row.legacyIssues.length > 0 && <Badge variant="outline" className="mt-1 block w-fit border-amber-500/30 bg-amber-500/10 text-amber-700">بيانات قديمة تحتاج مراجعة</Badge>}</td>
          <td className="px-3 py-3"><b>{row.employeeName}</b><div className="text-xs text-muted-foreground">{row.employeeCode} · {row.department || "—"}</div></td>
          <td className="px-3 py-3"><b>{periodLabel(row.period)}</b><div className="text-xs text-muted-foreground">{row.periodStart} — {row.periodEnd || "—"}</div></td>
          <MoneyCell value={row.baseSalary} /><MoneyCell value={n(row.otherEarnings) + n(row.commissionAmount)} /><MoneyCell value={row.bonusAmount} /><MoneyCell value={allowances} /><MoneyCell value={Math.max(0, n(row.totalDeductions) - n(row.advanceDeduction))} /><MoneyCell value={row.advanceDeduction} /><MoneyCell value={row.grossSalary} strong /><MoneyCell value={row.netSalary} strong /><MoneyCell value={row.amountPaid} tone="text-emerald-600" /><MoneyCell value={row.remainingSalary} tone="text-amber-600" />
          <td className="px-3 py-3"><Badge variant="outline" className={statusTone(row.paymentStatus)}>{paymentLabels[row.paymentStatus] || row.paymentStatus}</Badge></td><td className="px-3 py-3"><Badge variant="outline" className={statusTone(row.payrollStatus)}>{payrollLabels[row.payrollStatus] || row.payrollStatus}</Badge></td>
          <td className="px-3 py-3"><div className="flex flex-wrap gap-1"><IconButton label="عرض التفاصيل" onClick={() => setSelected(row)}><Eye /></IconButton><IconButton label="طباعة القسيمة" onClick={() => printSalary(row)}><Printer /></IconButton><IconButton label="إرفاق مستند" onClick={() => setAttachmentRow(row)}><Paperclip /></IconButton><IconButton label={canEdit(row) ? "تعديل الراتب" : "لا يمكن تعديل راتب مصروف أو مرحّل"} disabled={!canEdit(row)} onClick={() => openEditor("edit", row)}><Pencil /></IconButton><IconButton label={canAdjust(row) ? "إضافة مبلغ للحالي أو القادم" : "لا يمكن تعديل راتب ملغي أو معكوس"} disabled={!canAdjust(row)} onClick={() => openEditor("add", row)}><PlusCircle /></IconButton><IconButton label={canAdjust(row) ? "تقليل مبلغ من الحالي أو القادم" : "لا يمكن تعديل راتب ملغي أو معكوس"} disabled={!canAdjust(row)} onClick={() => openEditor("reduce", row)}><MinusCircle /></IconButton>{["draft", "calculated"].includes(row.payrollStatus) && <IconButton label="إرسال الراتب لاعتماد المدير" onClick={() => runAction.mutate({ row, action: "submit" })}><FileClock /></IconButton>}{row.payrollStatus === "pending_manager_approval" && <IconButton label="اعتماد دورة الرواتب دون صرف" onClick={() => runAction.mutate({ row, action: "approve" })}><CheckCircle2 /></IconButton>}{["approved", "partially_paid"].includes(row.payrollStatus) && row.remainingSalary > 0 && <IconButton label="دفع كلي أو جزئي لهذا الموظف" onClick={() => setPaymentRow(row)}><Banknote /></IconButton>}{row.legacyIssues.some((issue) => issue.includes("غير مربوط ماليًا")) && <IconButton label="مطابقة الراتب القديم مع حركة مالية" onClick={() => setReconcileRow(row)}><Link2 /></IconButton>}{n(row.amountPaid) > 0 && <IconButton label="تصحيح راتب مصروف بأثر مالي واضح" onClick={() => setCorrectionRow(row)}><Wrench /></IconButton>}<IconButton label={canDelete(row) ? "حذف الراتب المسودة" : "لا يمكن حذف راتب مصروف؛ استخدم العكس المالي"} disabled={!canDelete(row)} onClick={() => setDeleteRow(row)} danger><Trash2 /></IconButton></div></td>
        </tr>;
      })}
      {!runsQuery.isLoading && !filtered.length && <tr><td colSpan={16} className="p-14 text-center"><WalletCards className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><b>لا توجد رواتب مطابقة</b><p className="mt-1 text-sm text-muted-foreground">غيّر البحث أو الفلاتر لعرض سجلات أخرى.</p></td></tr>}
    </tbody><tfoot className="border-t-2 bg-muted/40 font-semibold"><tr><td colSpan={3} className="px-3 py-4">{filtered.length.toLocaleString("ar-IQ")} سجل راتب</td>{[totals.base, totals.additions, totals.bonuses, totals.allowances, totals.deductions, totals.advances, totals.gross, totals.net, totals.paid, totals.remaining].map((v, i) => <td key={i} className="whitespace-nowrap px-3 py-4 text-xs">{money.format(v)}</td>)}<td colSpan={3} /></tr></tfoot></table></div></Card>

    <SalaryDetails row={selected} management={managementQuery.data} loading={managementQuery.isLoading} onClose={() => setSelected(null)} onPrint={printSalary} onReversePayment={(payment) => selected && setReversePayment({ row: selected, payment })} onAttach={() => selected && setAttachmentRow(selected)} />
    <SalaryEditor state={editor} form={form} setForm={setForm} onClose={() => setEditor(null)} onSubmit={submitEditor} busy={editMutation.isPending || createMutation.isPending || adjustmentMutation.isPending} employees={staffQuery.data || []} />
    {paymentRow && <PaymentDialog key={`pay-${paymentRow.id}`} row={paymentRow} busy={paymentMutation.isPending} onClose={() => setPaymentRow(null)} onSubmit={(payload) => paymentMutation.mutate({ row: paymentRow, payload })} />}
    {reconcileRow && <ReconciliationDialog key={`reconcile-${reconcileRow.id}`} row={reconcileRow} management={managementQuery.data} loading={managementQuery.isLoading} busy={reconcileMutation.isPending} onClose={() => setReconcileRow(null)} onSubmit={(payload) => reconcileMutation.mutate({ row: reconcileRow, payload })} />}
    {correctionRow && <CorrectionDialog key={`correct-${correctionRow.id}`} row={correctionRow} management={managementQuery.data} loading={managementQuery.isLoading} busy={correctionMutation.isPending} onClose={() => setCorrectionRow(null)} onSubmit={(payload) => correctionMutation.mutate({ row: correctionRow, payload })} />}
    {attachmentRow && <AttachmentDialog key={`attachment-${attachmentRow.id}`} row={attachmentRow} busy={attachmentMutation.isPending} onClose={() => setAttachmentRow(null)} onSubmit={(payload) => attachmentMutation.mutate({ row: attachmentRow, payload })} />}
    {reversePayment && <ReversePaymentDialog key={`reverse-payment-${reversePayment.payment.id}`} value={reversePayment} busy={reversePaymentMutation.isPending} onClose={() => setReversePayment(null)} onSubmit={(reason) => reversePaymentMutation.mutate({ ...reversePayment, reason })} />}
    <Dialog open={!!deleteRow} onOpenChange={(open) => !open && setDeleteRow(null)}><DialogContent dir="rtl"><DialogHeader><DialogTitle>حذف راتب غير مصروف</DialogTitle><DialogDescription>الحذف متاح للمسودة أو المحسوب أو المرفوض ما دام غير مدفوع وغير مرتبط بالصندوق أو المحاسبة.</DialogDescription></DialogHeader><Label>سبب الحذف *</Label><Textarea value={form.deleteReason || ""} onChange={(e) => setForm((f) => ({ ...f, deleteReason: e.target.value }))} placeholder="اكتب سببًا واضحًا للتدقيق" /><DialogFooter><Button variant="outline" onClick={() => setDeleteRow(null)}>رجوع</Button><Button variant="destructive" disabled={deleteMutation.isPending || String(form.deleteReason || "").trim().length < 3} onClick={() => deleteRow && deleteMutation.mutate({ row: deleteRow, reason: form.deleteReason })}>{deleteMutation.isPending && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}تأكيد الحذف</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!reverseRow} onOpenChange={(open) => !open && setReverseRow(null)}><DialogContent dir="rtl"><DialogHeader><DialogTitle>عكس راتب مصروف</DialogTitle><DialogDescription>سيُعكس صرف دورة الرواتب كاملة مع حركة الصندوق والقيد المحاسبي، وتُسترجع خصومات السلف. يبقى السجل الأصلي محفوظًا.</DialogDescription></DialogHeader><div className="rounded-xl border bg-muted/30 p-3 text-sm"><b>{reverseRow?.runNo}</b><p className="text-muted-foreground">الأثر المالي الظاهر لهذا السجل: {money.format(reverseRow?.amountPaid || 0)}</p></div><Label>سبب العكس *</Label><Textarea value={form.reverseReason || ""} onChange={(e) => setForm((f) => ({ ...f, reverseReason: e.target.value }))} placeholder="السبب إلزامي ويظهر في سجل التدقيق" /><DialogFooter><Button variant="outline" onClick={() => setReverseRow(null)}>رجوع</Button><Button variant="destructive" disabled={reverseMutation.isPending || String(form.reverseReason || "").trim().length < 3} onClick={() => reverseRow && reverseMutation.mutate({ row: reverseRow, reason: form.reverseReason })}>{reverseMutation.isPending && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}تأكيد عكس الدورة</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}

function Filter({ value, onValue, placeholder, items }: { value: string; onValue: (value: string) => void; placeholder: string; items: string[][] }) {
  return <Select value={value} onValueChange={onValue}><SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="all">{placeholder}: الكل</SelectItem>{items.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent></Select>;
}
function MoneyCell({ value, strong, tone = "" }: { value: number; strong?: boolean; tone?: string }) { return <td className={`whitespace-nowrap px-3 py-3 tabular-nums ${strong ? "font-bold" : ""} ${tone}`}>{money.format(n(value))}</td>; }
function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactElement }) { return <Button type="button" size="icon" variant="ghost" className={`h-8 w-8 [&_svg]:h-4 [&_svg]:w-4 ${danger ? "text-destructive" : ""}`} title={label} aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>; }

function SalaryDetails({ row, management, loading, onClose, onPrint, onReversePayment, onAttach }: { row: SalaryRow | null; management?: SalaryManagement; loading: boolean; onClose: () => void; onPrint: (row: SalaryRow) => void; onReversePayment: (payment: SalaryManagement["payments"][number]) => void; onAttach: () => void }) {
  if (!row) return null;
  const allowances = n(row.attendanceAllowance) + n(row.transportationAllowance) + n(row.foodAllowance) + n(row.phoneAllowance) + n(row.housingAllowance) + n(row.otherFixedAllowances);
  const items = [["الراتب الأساسي", row.baseSalary], ["البدلات", allowances], ["المكافآت", row.bonusAmount], ["العمل الإضافي", row.overtimeAmount], ["الإضافات اليدوية والعمولة", n(row.otherEarnings) + n(row.commissionAmount)], ["الاستقطاعات", Math.max(0, n(row.totalDeductions) - n(row.advanceDeduction))], ["خصم السلفة", row.advanceDeduction], ["إجمالي الراتب", row.grossSalary], ["صافي الراتب", row.netSalary], ["المدفوع", row.amountPaid], ["المتبقي", row.remainingSalary]] as const;
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto" dir="rtl"><DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2">تفاصيل الراتب <Badge variant="outline">{row.salaryNumber}</Badge></DialogTitle><DialogDescription>{row.employeeName} · {row.employeeCode} · {periodLabel(row.period)}</DialogDescription></DialogHeader>
    {row.legacyIssues.length > 0 && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"><b>بيانات قديمة تحتاج مراجعة</b><ul className="mt-1 list-inside list-disc">{row.legacyIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
    <Tabs defaultValue="components"><TabsList className="h-auto w-full flex-wrap justify-start"><TabsTrigger value="components">مكونات الراتب</TabsTrigger><TabsTrigger value="payments">المدفوعات</TabsTrigger><TabsTrigger value="adjustments">التعديلات</TabsTrigger><TabsTrigger value="accounting">المحاسبة والصندوق</TabsTrigger><TabsTrigger value="history">التدقيق والخط الزمني</TabsTrigger><TabsTrigger value="attachments">المرفقات</TabsTrigger></TabsList>
      <TabsContent value="components" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(([label, value]) => <div key={label} className="rounded-xl border bg-muted/20 p-3"><span className="text-xs text-muted-foreground">{label}</span><b className="mt-1 block tabular-nums">{money.format(value)}</b></div>)}</TabsContent>
      <TabsContent value="payments" className="space-y-2">{loading ? <LoadingBlock /> : management?.payments.length ? management.payments.map((payment) => <div key={payment.id} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b>{money.format(n(payment.amount))}</b><Badge variant="outline" className={statusTone(payment.status)}>{payment.status === "paid" ? "مدفوعة" : "معكوسة"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{payment.payment_date} · {payment.payment_method} · {payment.transaction_no} · {payment.created_by_name || "—"}</p></div>{payment.status === "paid" && <Button size="sm" variant="outline" className="text-destructive" onClick={() => onReversePayment(payment)}><Undo2 className="ms-2 h-4 w-4" />عكس الدفعة</Button>}</div>) : <EmptyBlock text="لا توجد دفعات تفصيلية مسجلة. قد يكون هذا سجلًا قديمًا يحتاج مطابقة." />}</TabsContent>
      <TabsContent value="adjustments" className="space-y-2">{loading ? <LoadingBlock /> : management?.adjustments.length ? management.adjustments.map((adjustment) => <div key={adjustment.id} className="rounded-xl border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><b>{adjustment.direction === "addition" ? "إضافة" : "تخفيض"} · {money.format(n(adjustment.amount))}</b><Badge variant="outline">{adjustment.include_in === "next" ? "الراتب القادم" : "الراتب الحالي"}</Badge></div><p className="mt-1 text-sm">{adjustment.reason}</p><p className="mt-1 text-xs text-muted-foreground">{adjustment.effective_date} · {adjustment.created_by_name}</p></div>) : <EmptyBlock text="لا توجد إضافات أو تخفيضات مسجلة." />}</TabsContent>
      <TabsContent value="accounting" className="space-y-3"><InfoRows rows={[["دورة الرواتب", row.runNo], ["خصومات السلف المرتبطة", String(row.sourceRecords?.advances?.length || 0)]]} /><div className="grid gap-2 sm:grid-cols-3"><QuickLink href={`/admin/finance/master-cash?search=${encodeURIComponent(row.salaryNumber)}`} label="فتح حركات الصندوق" /><QuickLink href={`/admin/accounting?search=${encodeURIComponent(row.salaryNumber)}`} label="فتح القيود المحاسبية" /><QuickLink href={`/admin/employee-advances?employeeId=${row.staff_id}`} label="فتح سلف الموظف" /></div></TabsContent>
      <TabsContent value="history" className="space-y-2"><InfoRows rows={[["أنشئ بواسطة", row.createdBy || "النظام القديم"], ["اعتمد بواسطة", row.approvedBy || "—"], ["سجلات الدورة", `${row.auditLog?.length || 0} تدقيق · ${row.timeline?.length || 0} خط زمني`]]} />{loading ? <LoadingBlock /> : management?.events.length ? management.events.map((event) => <div key={event.id} className="rounded-xl border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><b>{event.action.replaceAll("_", " ")}</b><span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString("ar-IQ")}</span></div><p className="mt-1 text-muted-foreground">{event.actor_name}{event.reason ? ` · ${event.reason}` : ""}</p></div>) : <EmptyBlock text="لا توجد أحداث تفصيلية إضافية." />}</TabsContent>
      <TabsContent value="attachments" className="space-y-2">{loading ? <LoadingBlock /> : management?.attachments.length ? management.attachments.map((attachment) => <a key={attachment.id} href={attachment.data_url} download={attachment.name} className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"><Paperclip className="h-4 w-4" /><div className="min-w-0 flex-1"><b className="block truncate text-sm">{attachment.name}</b><span className="text-xs text-muted-foreground">{attachment.uploaded_by_name} · {new Date(attachment.created_at).toLocaleString("ar-IQ")}</span></div><Download className="h-4 w-4" /></a>) : <EmptyBlock text="لا توجد مرفقات مسجلة لهذا الراتب." />}<Button variant="outline" onClick={onAttach}><Paperclip className="ms-2 h-4 w-4" />إضافة مرفق</Button></TabsContent>
    </Tabs>
    <DialogFooter><Button variant="outline" onClick={onClose}>إغلاق</Button><Button onClick={() => onPrint(row)}><Printer className="ms-2 h-4 w-4" />طباعة القسيمة</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function InfoRows({ rows }: { rows: Array<[string, string]> }) { return <div className="divide-y rounded-xl border">{rows.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 p-3"><span className="text-sm text-muted-foreground">{label}</span><b className="text-sm">{value}</b></div>)}</div>; }
function LoadingBlock() { return <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />جارٍ تحميل التفاصيل…</div>; }
function EmptyBlock({ text }: { text: string }) { return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{text}</div>; }
function QuickLink({ href, label }: { href: string; label: string }) { return <a href={href} className="inline-flex h-10 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted">{label}<ExternalLink className="me-2 h-4 w-4" /></a>; }

function PaymentDialog({ row, busy, onClose, onSubmit }: { row: SalaryRow; busy: boolean; onClose: () => void; onSubmit: (payload: unknown) => void }) {
  const [value, setValue] = useState({ amount: String(row.remainingSalary), paymentMethod: row.paymentMethod || "cash", paymentDate: new Date().toISOString().slice(0, 10), referenceNo: "", notes: "" });
  const [idempotencyKey] = useState(() => `salary:${row.id}:payment:${crypto.randomUUID()}`);
  const amount = n(value.amount); const remaining = Math.max(0, row.remainingSalary - amount); const valid = amount > 0 && amount <= row.remainingSalary;
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent dir="rtl"><DialogHeader><DialogTitle>دفع راتب الموظف</DialogTitle><DialogDescription>يمكن دفع كامل المتبقي أو جزء منه. تُنشأ حركة صندوق وقيد واحدان لهذه الدفعة فقط.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="مبلغ الدفعة *"><Input inputMode="decimal" value={value.amount} onChange={(e) => setValue((old) => ({ ...old, amount: e.target.value }))} /></Field><Field label="طريقة الدفع"><Select value={value.paymentMethod} onValueChange={(paymentMethod) => setValue((old) => ({ ...old, paymentMethod }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="cash">نقدي</SelectItem><SelectItem value="main_cash_box">الصندوق الرئيسي</SelectItem><SelectItem value="bank">مصرف</SelectItem><SelectItem value="transfer">تحويل</SelectItem></SelectContent></Select></Field><Field label="تاريخ الدفع"><Input type="date" value={value.paymentDate} onChange={(e) => setValue((old) => ({ ...old, paymentDate: e.target.value }))} /></Field><Field label="رقم المرجع"><Input value={value.referenceNo} onChange={(e) => setValue((old) => ({ ...old, referenceNo: e.target.value }))} /></Field><div className="sm:col-span-2"><Field label="ملاحظات"><Textarea value={value.notes} onChange={(e) => setValue((old) => ({ ...old, notes: e.target.value }))} /></Field></div></div><div className="grid grid-cols-3 gap-2 rounded-xl bg-muted/40 p-3 text-center text-sm"><div><span className="text-muted-foreground">مدفوع سابقًا</span><b className="block">{money.format(row.amountPaid)}</b></div><div><span className="text-muted-foreground">الدفعة</span><b className="block text-primary">{money.format(amount)}</b></div><div><span className="text-muted-foreground">المتبقي بعدها</span><b className="block">{money.format(remaining)}</b></div></div>{amount > row.remainingSalary && <p className="text-sm text-destructive">لا يمكن أن تتجاوز الدفعة المبلغ المتبقي.</p>}<DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button disabled={busy || !valid} onClick={() => onSubmit({ ...value, amount, idempotencyKey })}>{busy && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}تأكيد الدفع</Button></DialogFooter></DialogContent></Dialog>;
}

function ReconciliationDialog({ row, management, loading, busy, onClose, onSubmit }: { row: SalaryRow; management?: SalaryManagement; loading: boolean; busy: boolean; onClose: () => void; onSubmit: (payload: unknown) => void }) {
  const [transactionId, setTransactionId] = useState(""); const [reason, setReason] = useState("");
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="max-w-2xl" dir="rtl"><DialogHeader><DialogTitle>مطابقة راتب قديم</DialogTitle><DialogDescription>يعرض النظام اقتراحات فقط. لن ينشئ حركة صندوق أو قيدًا جديدًا، ولن يتم الربط إلا بعد اختيارك وتأكيد السبب.</DialogDescription></DialogHeader>{loading ? <LoadingBlock /> : management?.suggestions.length ? <div className="max-h-72 space-y-2 overflow-y-auto">{management.suggestions.map((item) => <button type="button" key={item.id} onClick={() => setTransactionId(String(item.id))} className={`w-full rounded-xl border p-3 text-start transition-colors ${transactionId === String(item.id) ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}><div className="flex flex-wrap items-center justify-between gap-2"><b>{item.transaction_no}</b><Badge variant="outline">تطابق {item.match_score}%</Badge></div><p className="mt-1 text-sm">{money.format(item.amount)} · {item.transaction_date} · {item.payment_method}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.description}</p></button>)}</div> : <EmptyBlock text="لم يُعثر على حركة مالية مطابقة آمنة. لن يخمّن النظام الرابط." />}<Field label="سبب المطابقة *"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب واضح ومصدر التحقق" /></Field><div className="rounded-xl bg-muted/40 p-3 text-sm">صافي الراتب: <b>{money.format(row.netSalary)}</b> · المدفوع القديم: <b>{money.format(row.amountPaid)}</b></div><DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button disabled={busy || !transactionId || reason.trim().length < 3} onClick={() => onSubmit({ financialTransactionId: Number(transactionId), reason })}>{busy && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}ربط الحركة المختارة</Button></DialogFooter></DialogContent></Dialog>;
}

function CorrectionDialog({ row, management, loading, busy, onClose, onSubmit }: { row: SalaryRow; management?: SalaryManagement; loading: boolean; busy: boolean; onClose: () => void; onSubmit: (payload: unknown) => void }) {
  const [value, setValue] = useState({ reason: "", baseSalary: String(row.baseSalary), overtimeAmount: String(row.overtimeAmount), bonusAmount: String(row.bonusAmount), manualAddition: String(n(row.otherEarnings) + n(row.commissionAmount)), manualDeduction: String(row.manualDeduction), advanceDeduction: String(row.advanceDeduction), notes: row.lineNotes || "" });
  const nextNet = Math.max(0, n(value.baseSalary) + n(value.overtimeAmount) + n(value.bonusAmount) + n(value.manualAddition) - n(value.manualDeduction) - n(value.advanceDeduction));
  const set = (key: string, next: string) => setValue((old) => ({ ...old, [key]: next }));
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto" dir="rtl"><DialogHeader><DialogTitle>تعديل راتب مصروف</DialogTitle><DialogDescription>سيتم عكس كل الدفعات المرتبطة أولًا داخل مسار مالي آمن، ثم تحديث الراتب ليصبح معتمدًا وغير مدفوع وجاهزًا لإعادة الصرف.</DialogDescription></DialogHeader>{loading ? <LoadingBlock /> : <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><b>معاينة الأثر</b><p className="mt-1">دفعات ستُعكس: {management?.payments.filter((payment) => payment.status === "paid").length || 0} · قيمة حالية: {money.format(row.amountPaid)}</p><p>الصندوق والمحاسبة: إنشاء قيود عكسية مع إبقاء التاريخ الأصلي.</p></div>}<div className="grid gap-4 sm:grid-cols-2"><Field label="الراتب الأساسي"><Input inputMode="decimal" value={value.baseSalary} onChange={(e) => set("baseSalary", e.target.value)} /></Field><Field label="العمل الإضافي"><Input inputMode="decimal" value={value.overtimeAmount} onChange={(e) => set("overtimeAmount", e.target.value)} /></Field><Field label="المكافأة"><Input inputMode="decimal" value={value.bonusAmount} onChange={(e) => set("bonusAmount", e.target.value)} /></Field><Field label="الإضافة اليدوية"><Input inputMode="decimal" value={value.manualAddition} onChange={(e) => set("manualAddition", e.target.value)} /></Field><Field label="الخصم اليدوي"><Input inputMode="decimal" value={value.manualDeduction} onChange={(e) => set("manualDeduction", e.target.value)} /></Field><Field label="خصم السلفة"><Input inputMode="decimal" value={value.advanceDeduction} onChange={(e) => set("advanceDeduction", e.target.value)} /></Field><div className="sm:col-span-2"><Field label="سبب التصحيح *"><Textarea value={value.reason} onChange={(e) => set("reason", e.target.value)} /></Field></div><div className="sm:col-span-2"><Field label="ملاحظات"><Textarea value={value.notes} onChange={(e) => set("notes", e.target.value)} /></Field></div></div><div className="rounded-xl bg-primary/10 p-4"><span className="text-sm text-muted-foreground">الصافي الجديد التقريبي</span><b className="block text-xl text-primary">{money.format(nextNet)}</b></div><DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button variant="destructive" disabled={busy || loading || value.reason.trim().length < 3 || !management?.payments.some((payment) => payment.status === "paid")} onClick={() => onSubmit({ ...value, baseSalary: n(value.baseSalary), overtimeAmount: n(value.overtimeAmount), bonusAmount: n(value.bonusAmount), manualAddition: n(value.manualAddition), manualDeduction: n(value.manualDeduction), advanceDeduction: n(value.advanceDeduction) })}>{busy && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}عكس وتصحيح الراتب</Button></DialogFooter></DialogContent></Dialog>;
}

function AttachmentDialog({ row, busy, onClose, onSubmit }: { row: SalaryRow; busy: boolean; onClose: () => void; onSubmit: (payload: unknown) => void }) {
  const [file, setFile] = useState<File | null>(null); const [notes, setNotes] = useState(""); const [reading, setReading] = useState(false);
  async function save() { if (!file) return; if (file.size > 5_000_000) { toast.error("حجم المرفق يجب ألا يتجاوز 5 ميغابايت"); return; } setReading(true); try { const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("تعذر قراءة الملف")); reader.readAsDataURL(file); }); onSubmit({ name: file.name, mimeType: file.type || "application/octet-stream", dataUrl, notes: notes || null }); } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر قراءة الملف"); } finally { setReading(false); } }
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent dir="rtl"><DialogHeader><DialogTitle>إضافة مرفق للراتب</DialogTitle><DialogDescription>{row.salaryNumber} · يدعم الصور وPDF بحد أقصى 5 ميغابايت.</DialogDescription></DialogHeader><Field label="الملف *"><Input type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field><Field label="ملاحظات"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field><DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button disabled={busy || reading || !file} onClick={save}>{(busy || reading) && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}حفظ المرفق</Button></DialogFooter></DialogContent></Dialog>;
}

function ReversePaymentDialog({ value, busy, onClose, onSubmit }: { value: { row: SalaryRow; payment: SalaryManagement["payments"][number] }; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent dir="rtl"><DialogHeader><DialogTitle>عكس دفعة راتب</DialogTitle><DialogDescription>لن تُحذف الدفعة. سيُنشأ قيد عكسي وتُعاد أرصدة الراتب والصندوق والمحاسبة.</DialogDescription></DialogHeader><div className="rounded-xl bg-muted/40 p-3 text-sm"><b>{value.payment.transaction_no}</b><p>{value.row.employeeName} · {money.format(n(value.payment.amount))}</p></div><Field label="سبب العكس *"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field><DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => onSubmit(reason)}>{busy && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}تأكيد العكس</Button></DialogFooter></DialogContent></Dialog>;
}

function SalaryEditor({ state, form, setForm, onClose, onSubmit, busy, employees }: { state: EditorState; form: Record<string, string>; setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>; onClose: () => void; onSubmit: () => void; busy: boolean; employees: StaffOption[] }) {
  if (!state) return null;
  const title = { create: "إضافة راتب موظف", edit: "تعديل الراتب", add: "إضافة مبلغ", reduce: "تقليل مبلغ" }[state.mode];
  const uniqueEmployees = [...employees].sort((a, b) => String(a.fullName || a.username).localeCompare(String(b.fullName || b.username), "ar"));
  const set = (key: string, value: string) => setForm((old) => ({ ...old, [key]: value }));
  const preview = n(form.baseSalary) + n(form.allowances) + n(form.bonusAmount) + n(form.overtimeAmount) + n(form.otherEarnings) - n(form.manualDeduction) - n(form.advanceDeduction);
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto" dir="rtl"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{state.mode === "create" ? "يُحفظ السجل كمسودة ولا يسحب أي مبلغ من الصندوق قبل الاعتماد." : state.mode === "edit" ? "سيُعاد احتساب إجمالي وصافي الراتب وتحديث مجموع دورة الرواتب." : "يُسجل السبب داخل ملاحظات الراتب وسجل التدقيق."}</DialogDescription></DialogHeader>
    {state.mode === "create" ? <div className="grid gap-4 sm:grid-cols-2"><Field label="الموظف *"><Select value={form.employeeIds || ""} onValueChange={(v) => set("employeeIds", v)}><SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger><SelectContent dir="rtl">{uniqueEmployees.map((employee) => <SelectItem key={employee.id} value={String(employee.id)}>{employee.fullName || employee.username || `موظف #${employee.id}`} · EMP-{String(employee.id).padStart(6, "0")}</SelectItem>)}</SelectContent></Select></Field><Field label="شهر الراتب *"><Input type="month" value={form.period || ""} onChange={(e) => { const period = e.target.value; const end = new Date(`${period}-01T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1, 0); setForm((old) => ({ ...old, period, periodStartDate: `${period}-01`, periodEndDate: end.toISOString().slice(0, 10) })); }} /></Field><Field label="بداية الفترة *"><Input type="date" value={form.periodStartDate || ""} onChange={(e) => set("periodStartDate", e.target.value)} /></Field><Field label="نهاية الفترة *"><Input type="date" value={form.periodEndDate || ""} onChange={(e) => set("periodEndDate", e.target.value)} /></Field><Field label="الراتب الأساسي *"><Input inputMode="decimal" value={form.baseSalary || ""} onChange={(e) => set("baseSalary", e.target.value)} /></Field><Field label="البدلات"><Input inputMode="decimal" value={form.allowances || ""} onChange={(e) => set("allowances", e.target.value)} /></Field><Field label="المكافأة"><Input inputMode="decimal" value={form.bonusAmount || ""} onChange={(e) => set("bonusAmount", e.target.value)} /></Field><Field label="العمل الإضافي"><Input inputMode="decimal" value={form.overtimeAmount || ""} onChange={(e) => set("overtimeAmount", e.target.value)} /></Field><Field label="إضافة يدوية"><Input inputMode="decimal" value={form.manualAddition || ""} onChange={(e) => set("manualAddition", e.target.value)} /></Field><Field label="خصم يدوي"><Input inputMode="decimal" value={form.manualDeduction || ""} onChange={(e) => set("manualDeduction", e.target.value)} /></Field><Field label="خصم سلفة"><Input inputMode="decimal" value={form.advanceDeduction || ""} onChange={(e) => set("advanceDeduction", e.target.value)} /></Field><Field label="طريقة الدفع"><Select value={form.paymentMethod || "cash"} onValueChange={(v) => set("paymentMethod", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="cash">نقدي</SelectItem><SelectItem value="main_cash_box">الصندوق الرئيسي</SelectItem><SelectItem value="bank">مصرف</SelectItem><SelectItem value="transfer">تحويل</SelectItem></SelectContent></Select></Field><Field label="تاريخ الدفع المتوقع"><Input type="date" value={form.paymentDate || ""} onChange={(e) => set("paymentDate", e.target.value)} /></Field><Field label="ملاحظات"><Textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} /></Field><div className="sm:col-span-2 rounded-xl bg-primary/10 p-4"><span className="text-sm text-muted-foreground">معاينة صافي الراتب</span><b className="mt-1 block text-xl text-primary">{money.format(Math.max(0, n(form.baseSalary) + n(form.allowances) + n(form.bonusAmount) + n(form.overtimeAmount) + n(form.manualAddition) - n(form.manualDeduction) - n(form.advanceDeduction)))}</b></div></div>
    : state.mode === "add" || state.mode === "reduce" ? <div className="space-y-4">
      <Field label="المبلغ *"><Input inputMode="decimal" value={form.amount || ""} onChange={(e) => set("amount", e.target.value)} placeholder="0" /></Field>
      <Field label={state.mode === "add" ? "نوع الإضافة *" : "نوع التخفيض *"}><Select value={form.adjustmentType || "manual"} onValueChange={(v) => set("adjustmentType", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent dir="rtl">{(state.mode === "add" ? [["salary_adjustment", "تعديل راتب"], ["additional_work", "عمل إضافي"], ["overtime", "تعديل إضافي"], ["allowance", "بدل"], ["commission", "عمولة"], ["manual", "إضافة يدوية"], ["other", "أخرى"]] : [["manual", "خصم يدوي"], ["advance", "خصم سلفة"], ["absence", "غياب"], ["late", "تأخير"], ["other", "أخرى"]]).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="تطبيق التعديل"><Select value={form.includeIn || "current"} onValueChange={(v) => set("includeIn", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="current">ضمن الراتب الحالي</SelectItem><SelectItem value="next">ضمن الراتب القادم</SelectItem></SelectContent></Select></Field>
      {n(state.row?.amountPaid) > 0 && form.includeIn !== "next" && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">الراتب مصروف؛ اختر «ضمن الراتب القادم» أو استخدم تصحيح الراتب المصروف.</p>}
      <Field label="السبب *"><Textarea value={form.reason || ""} onChange={(e) => set("reason", e.target.value)} placeholder="سبب واضح يظهر في سجل التدقيق" /></Field>
      <Field label="ملاحظات"><Textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} /></Field>
      <Field label="تاريخ السريان"><Input type="date" value={form.effectiveDate || new Date().toISOString().slice(0, 10)} onChange={(e) => set("effectiveDate", e.target.value)} /></Field>
      <Field label="مرفق اختياري"><Input type="file" accept="image/*,.pdf" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 5_000_000) { toast.error("حجم المرفق يجب ألا يتجاوز 5 ميغابايت"); return; } const reader = new FileReader(); reader.onload = () => set("attachment", String(reader.result)); reader.onerror = () => toast.error("تعذر قراءة المرفق"); reader.readAsDataURL(file); }} /></Field>
    </div>
    : <div className="grid gap-4 sm:grid-cols-2"><Field label="الراتب الأساسي"><Input inputMode="decimal" value={form.baseSalary || ""} onChange={(e) => set("baseSalary", e.target.value)} /></Field><Field label="البدلات"><Input inputMode="decimal" value={form.allowances || ""} disabled title="البدلات الثابتة تُدار من إعدادات راتب الموظف" /></Field><Field label="المكافآت"><Input inputMode="decimal" value={form.bonusAmount || ""} onChange={(e) => set("bonusAmount", e.target.value)} /></Field><Field label="العمل الإضافي"><Input inputMode="decimal" value={form.overtimeAmount || ""} onChange={(e) => set("overtimeAmount", e.target.value)} /></Field><Field label="إضافة يدوية"><Input inputMode="decimal" value={form.otherEarnings || ""} onChange={(e) => set("otherEarnings", e.target.value)} /></Field><Field label="خصم يدوي"><Input inputMode="decimal" value={form.manualDeduction || ""} onChange={(e) => set("manualDeduction", e.target.value)} /></Field><Field label="خصم السلفة"><Input inputMode="decimal" value={form.advanceDeduction || ""} onChange={(e) => set("advanceDeduction", e.target.value)} /></Field><Field label="طريقة الدفع"><Select value={form.paymentMethod || "cash"} onValueChange={(v) => set("paymentMethod", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="cash">نقدي</SelectItem><SelectItem value="main_cash_box">الصندوق الرئيسي</SelectItem><SelectItem value="bank">مصرف</SelectItem><SelectItem value="transfer">تحويل</SelectItem></SelectContent></Select></Field><Field label="تاريخ الدفع"><Input type="date" value={form.paymentDate || ""} onChange={(e) => set("paymentDate", e.target.value)} /></Field><Field label="الملاحظات"><Textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} /></Field><div className="sm:col-span-2 rounded-xl bg-primary/10 p-4"><span className="text-sm text-muted-foreground">معاينة صافي الراتب</span><b className="mt-1 block text-xl text-primary">{money.format(Math.max(0, preview))}</b></div></div>}
    <DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button disabled={busy} onClick={onSubmit}>{busy && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}حفظ</Button></DialogFooter>
  </DialogContent></Dialog>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
