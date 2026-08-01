import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import JsBarcode from "jsbarcode";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileDown,
  FileSpreadsheet,
  Gift,
  Loader2,
  MessageCircle,
  Palette,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  Search,
  Shirt,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Users,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/money";
import { downloadElementPdf } from "@/lib/pdf";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { GRADUATION_STAGE_LABELS, GRADUATION_STAGES } from "@/lib/graduation";
import { adminFetch, apiErrorMessage } from "./_lib";
import {
  printWhenImagesReadyScript,
  sheetReportCss,
  thermalReceiptCss,
} from "./print-helpers";

type AccessoryItem = {
  itemId: number;
  templateId: number | null;
  name: string;
  code: string;
  image: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  required: boolean;
  free: boolean;
};

type AccessoryProduct = {
  id: number;
  code: string;
  name: string;
  image: string | null;
  unitPrice: number;
  defaultPrice: number;
  discountPrice: number | null;
  trackStock: boolean;
  stock: number;
  available: boolean;
  required: boolean;
  maxQuantity: number | null;
};

type StudentRow = {
  id: number;
  orderType: "individual" | "group";
  sequence: number;
  studentCode: string;
  barcodeValue: string;
  receiptNo: string;
  qrValue: string;
  orderNo: string;
  customerName: string;
  phone: string;
  phone2: string;
  gender: string;
  height: string | number;
  weight: string | number;
  size: string;
  shoulder: string | number;
  sleeveLength: string | number;
  chest: string | number;
  measurementStatus: "none" | "partial" | "complete";
  university: string;
  college: string;
  department: string;
  graduationYear: string;
  robeType: string;
  robeColor: string;
  sashType: string;
  sashColor: string;
  capType: string;
  rightText: string;
  leftText: string;
  printingType: string;
  embroideryType: string;
  accessories: string[];
  accessoryItems: AccessoryItem[];
  accessoriesCount: number;
  accessoriesTotal: number;
  total: number;
  discount: number;
  paid: number;
  remaining: number;
  paymentStatus: string;
  designStatus: string;
  productionStage: string;
  deliveryStatus: string;
  notes: string;
  trackingUrl: string;
};

type GroupDetail = {
  group: any;
  students: StudentRow[];
  totals: Record<string, number>;
  sizeDistribution: Record<string, number>;
  duplicates: Array<{ id: number; studentCode: string; name: string; phone: string }>;
  missingData: Array<{ id: number; studentCode: string; name: string; missing: string[] }>;
  materialRequirements: Record<string, number>;
  shortages: Array<{ productId: number; name: string; required: number; available: number; shortage: number }>;
};

const DESIGN_LABELS: Record<string, string> = {
  approved: "معتمد",
  waiting_approval: "بانتظار الموافقة",
  waiting_preview: "بانتظار المعاينة",
};

const missingLabels: Record<string, string> = {
  phone: "الهاتف",
  size: "المقاس",
  approval: "اعتماد التصميم",
  payment: "الدفع",
  university: "الجامعة",
  delivery: "موعد التسليم",
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function barcodeSvg(value: string) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, value, {
    format: "CODE128",
    displayValue: true,
    font: "Cairo, Arial",
    fontSize: 12,
    height: 42,
    margin: 0,
  });
  return svg.outerHTML;
}

function studentReceiptMarkup(receipt: any, settings: any) {
  const row = receipt.snapshot;
  return `<main class="receipt"><header class="r-head"><img class="r-logo" src="${escapeHtml(logoSrc(settings))}" alt="AJN"><div class="r-company">مجموعة علي جان نهاد</div><div class="r-sub">وصل تجهيزات تخرج</div><div class="r-sub num">${escapeHtml(receipt.receiptNo)} · ${new Date().toLocaleDateString("ar-IQ")}</div></header><hr class="rule">
    <div class="kv"><span>الطالب</span><span class="v">${escapeHtml(row.studentName)}</span></div><div class="kv"><span>كود الطالب</span><span class="v num">${escapeHtml(row.studentCode)}</span></div><div class="kv"><span>الهاتف</span><span class="v num">${escapeHtml(row.phone || "غير مسجل")}</span></div><div class="kv"><span>الجامعة</span><span class="v">${escapeHtml(row.university || "—")}</span></div><div class="kv"><span>الكلية / القسم</span><span class="v">${escapeHtml([row.college, row.department].filter(Boolean).join(" · ") || "—")}</span></div><hr class="rule dashed">
    <div class="kv"><span>الروب</span><span class="v">${escapeHtml([row.robeType, row.robeColor].filter(Boolean).join(" · ") || "—")}</span></div><div class="kv"><span>الوشاح</span><span class="v">${escapeHtml([row.sashType, row.sashColor].filter(Boolean).join(" · ") || "—")}</span></div><div class="kv"><span>القبعة</span><span class="v">${escapeHtml(row.capType || "—")}</span></div><div class="kv"><span>المقاس</span><span class="v">${escapeHtml(row.size || "—")}</span></div>
    <section class="totals"><div class="grand"><span>الإجمالي</span><span class="num">${formatCurrency(row.total)}</span></div><div class="payline"><span>المدفوع</span><span class="num">${formatCurrency(row.paid)}</span></div><div class="payline remain"><span>المتبقي</span><span class="num">${formatCurrency(row.remaining)}</span></div></section>
    <div class="qr"><img src="${escapeHtml(receipt.qrDataUrl)}" alt="QR"><div class="cap num">${escapeHtml(row.studentCode)}</div></div><div class="center">${barcodeSvg(String(receipt.barcodeValue || row.studentCode))}</div><div class="thanks">شكراً لاختياركم مجموعة علي جان نهاد</div></main>`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function StatusBadge({ value, kind }: { value: string; kind: "design" | "production" | "delivery" }) {
  const label =
    kind === "design"
      ? DESIGN_LABELS[value] || value
      : kind === "production"
        ? GRADUATION_STAGE_LABELS[value as keyof typeof GRADUATION_STAGE_LABELS] || value
        : value === "delivered"
          ? "تم التسليم"
          : "بانتظار التسليم";
  const variant =
    value === "approved" || value === "ready" || value === "delivered"
      ? "default"
      : "secondary";
  return <Badge variant={variant}>{label}</Badge>;
}

function MeasurementBadge({ value }: { value: StudentRow["measurementStatus"] }) {
  const labels = {
    none: "القياسات غير مدخلة",
    partial: "قياسات جزئية",
    complete: "القياسات مكتملة",
  };
  const tone =
    value === "complete"
      ? "border-status-success/30 bg-status-success/10 text-status-success"
      : value === "partial"
        ? "border-status-warning/30 bg-status-warning/10 text-status-warning"
        : "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400";
  return <Badge variant="outline" className={tone}>{labels[value] || labels.none}</Badge>;
}

function EditableCell({
  value,
  type = "text",
  onCommit,
  className = "w-28",
}: {
  value: string | number;
  type?: "text" | "number" | "color";
  onCommit: (value: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value ?? ""));
  return (
    <Input
      type={type}
      className={`h-8 ${className}`}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== String(value ?? "")) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

const emptyStudent = {
  customerName: "",
  phone: "",
  phone2: "",
  gender: "unspecified",
  height: "",
  weight: "",
  size: "",
  robeType: "",
  robeColor: "#111111",
  sashType: "",
  sashColor: "#d4af37",
  totalAmount: 0,
  notes: "",
};

function ReceiptActions({ student }: { student: StudentRow }) {
  const { toast } = useToast();
  const { data: settings } = usePublicSettings();
  const [loading, setLoading] = useState(false);
  async function loadReceipt() {
    return adminFetch<any>(`/admin/graduation/orders/${student.id}/receipt`, { method: "POST" });
  }
  async function printReceipt() {
    setLoading(true);
    try {
      const data = await loadReceipt();
      const receipt = data.receipt;
      const popup = window.open("", "_blank", "width=520,height=760");
      if (!popup) throw new Error("تعذر فتح نافذة الطباعة");
      popup.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(receipt.receiptNo)}</title><style>${thermalReceiptCss("80mm")}</style></head><body>${studentReceiptMarkup(receipt, settings)}${printWhenImagesReadyScript()}</body></html>`);
      popup.document.close();
    } catch (error) {
      toast({ title: "تعذرت طباعة الوصل", description: apiErrorMessage(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  async function downloadPdf() {
    setLoading(true);
    const wrapper = document.createElement("div");
    try {
      const data = await loadReceipt();
      wrapper.dir = "rtl";
      wrapper.style.width = "80mm";
      wrapper.innerHTML = `<style>${thermalReceiptCss("80mm")}</style>${studentReceiptMarkup(data.receipt, settings)}`;
      document.body.appendChild(wrapper);
      await downloadElementPdf(wrapper, `${data.receipt.receiptNo}.pdf`, { format: [80, 240], margin: 0, scale: 2 });
    } catch (error) {
      toast({ title: "تعذر تنزيل PDF", description: apiErrorMessage(error), variant: "destructive" });
    } finally {
      wrapper.remove();
      setLoading(false);
    }
  }
  function sendWhatsApp() {
    const phone = student.phone.replace(/\D/g, "").replace(/^0/, "964");
    if (!phone) {
      toast({ title: "رقم هاتف الطالب غير مسجل", variant: "destructive" });
      return;
    }
    const url = `${window.location.origin}${student.trackingUrl}`;
    const message = `مرحباً ${student.customerName}، هذا رابط ملف تجهيزات التخرج الخاص بك (${student.studentCode}): ${url}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }
  return (
    <div className="flex items-center gap-0.5">
      <Button size="icon" variant="ghost" title="إصدار وطباعة وصل الطالب" onClick={printReceipt} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />}</Button>
      <Button size="icon" variant="ghost" title="تحميل PDF" onClick={downloadPdf} disabled={loading}><FileDown className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" title="إرسال واتساب" onClick={sendWhatsApp}><MessageCircle className="h-4 w-4" /></Button>
    </div>
  );
}

function AddStudentDialog({ groupId, open, onOpenChange }: { groupId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const [form, setForm] = useState(emptyStudent);
  const add = useMutation({
    mutationFn: () =>
      adminFetch(`/admin/graduation/groups/${groupId}/students`, {
        method: "POST",
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin", "graduation", "group-workspace", groupId] });
      setForm(emptyStudent);
      onOpenChange(false);
      toast({ title: "تمت إضافة الطالب وتوليد كوده ووصل مستقل له" });
    },
    onError: (error) => toast({ title: "تعذرت إضافة الطالب", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const fields: Array<[keyof typeof form, string, string?]> = [
    ["customerName", "اسم الطالب"],
    ["phone", "رقم الهاتف الأول"],
    ["phone2", "رقم الهاتف الثاني"],
    ["height", "الطول", "number"],
    ["weight", "الوزن", "number"],
    ["size", "المقاس"],
    ["robeType", "نوع الروب"],
    ["sashType", "نوع الوشاح"],
    ["totalAmount", "السعر", "number"],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-2xl">
        <DialogHeader><DialogTitle>إضافة طالب إلى المجموعة</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(([key, label, type]) => (
            <div key={key}>
              <Label>{label}</Label>
              <Input className="mt-2" type={type || "text"} value={String(form[key])} onChange={(event) => setForm((current) => ({ ...current, [key]: type === "number" ? Number(event.target.value) : event.target.value }))} />
            </div>
          ))}
          <div>
            <Label>الجنس</Label>
            <Select value={form.gender} onValueChange={(value) => setForm((current) => ({ ...current, gender: value }))}>
              <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="unspecified">غير محدد</SelectItem><SelectItem value="male">ذكر</SelectItem><SelectItem value="female">أنثى</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>لون الروب</Label><Input type="color" className="mt-2" value={form.robeColor} onChange={(event) => setForm((current) => ({ ...current, robeColor: event.target.value }))} /></div>
            <div><Label>لون الوشاح</Label><Input type="color" className="mt-2" value={form.sashColor} onChange={(event) => setForm((current) => ({ ...current, sashColor: event.target.value }))} /></div>
          </div>
        </div>
        <div><Label>ملاحظات</Label><Textarea className="mt-2" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></div>
        <DialogFooter className="sm:justify-start"><Button onClick={() => add.mutate()} disabled={add.isPending || form.customerName.trim().length < 2}>{add.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Plus className="ml-2 h-4 w-4" />}إضافة الطالب</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ groupId, students, open, onOpenChange }: { groupId: number; students: StudentRow[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const [amount, setAmount] = useState(0);
  const [strategy, setStrategy] = useState("equal");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [selected, setSelected] = useState<number[]>([]);
  const [manualAmounts, setManualAmounts] = useState<Record<number, number>>({});
  const [notes, setNotes] = useState("");
  const receive = useMutation({
    mutationFn: () => adminFetch<any>(`/admin/graduation/groups/${groupId}/payments`, {
      method: "POST",
      body: JSON.stringify({
        amount,
        strategy,
        paymentMethod,
        selectedStudentIds: selected,
        allocations: Object.entries(manualAmounts).map(([orderId, allocatedAmount]) => ({ orderId: Number(orderId), amount: allocatedAmount })),
        idempotencyKey: crypto.randomUUID(),
        notes,
      }),
    }),
    onSuccess: (result) => {
      client.invalidateQueries({ queryKey: ["admin", "graduation"] });
      onOpenChange(false);
      toast({ title: "تم تسجيل دفعة المجموعة", description: `موزع: ${formatCurrency(result.allocated)} · رصيد غير مخصص: ${formatCurrency(result.unallocated)}` });
    },
    onError: (error) => toast({ title: "تعذر تسجيل الدفعة", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-xl">
        <DialogHeader><DialogTitle>استلام دفعة للمجموعة</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label>المبلغ</Label><Input className="mt-2" type="number" min={1} value={amount || ""} onChange={(event) => setAmount(Number(event.target.value))} /></div>
          <div><Label>طريقة الدفع</Label><Select value={paymentMethod} onValueChange={setPaymentMethod}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">نقدي</SelectItem><SelectItem value="card">بطاقة</SelectItem><SelectItem value="transfer">تحويل</SelectItem><SelectItem value="other">أخرى</SelectItem></SelectContent></Select></div>
          <div className="sm:col-span-2"><Label>طريقة التوزيع</Label><Select value={strategy} onValueChange={setStrategy}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="equal">توزيع متساوٍ</SelectItem><SelectItem value="oldest">الأقدم غير المدفوع أولاً</SelectItem><SelectItem value="selected">طلاب محددون</SelectItem><SelectItem value="manual">مبلغ يدوي لكل طالب</SelectItem><SelectItem value="unallocated">رصيد مجموعة غير مخصص</SelectItem></SelectContent></Select></div>
        </div>
        {strategy === "selected" ? <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border p-3">{students.filter((student) => student.remaining > 0).map((student) => <label key={student.id} className="flex items-center gap-2 text-sm"><Checkbox checked={selected.includes(student.id)} onCheckedChange={(checked) => setSelected((current) => checked ? [...current, student.id] : current.filter((id) => id !== student.id))} /><span className="flex-1">{student.customerName}</span><span>{formatCurrency(student.remaining)}</span></label>)}</div> : null}
        {strategy === "manual" ? <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-border p-3">{students.filter((student) => student.remaining > 0).map((student) => <div key={student.id} className="grid grid-cols-[1fr_120px] items-center gap-3 text-sm"><div><strong>{student.customerName}</strong><p className="text-xs text-muted-foreground">متبقي {formatCurrency(student.remaining)}</p></div><Input type="number" min={0} max={student.remaining} value={manualAmounts[student.id] || ""} onChange={(event) => setManualAmounts((current) => ({ ...current, [student.id]: Math.min(student.remaining, Math.max(0, Number(event.target.value))) }))} placeholder="المبلغ" /></div>)}</div> : null}
        <div><Label>ملاحظات الدفعة</Label><Textarea className="mt-2" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
        <DialogFooter className="sm:justify-start"><Button onClick={() => receive.mutate()} disabled={receive.isPending || amount <= 0 || (strategy === "selected" && !selected.length)}>{receive.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <WalletCards className="ml-2 h-4 w-4" />}تسجيل وتوزيع الدفعة</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportStudentsDialog({ groupId, open, onOpenChange }: { groupId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const [rows, setRows] = useState<any[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  async function readFile(file: File) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    const mapped = data.map((row, index) => ({
      row: index + 2,
      customerName: row["اسم الطالب"] || row["Student name"] || row.studentName || "",
      phone: row["رقم الهاتف الأول"] || row["Mobile 1"] || row.phone || "",
      phone2: row["رقم الهاتف الثاني"] || row["Mobile 2"] || row.phone2 || "",
      gender: ({ ذكر: "male", أنثى: "female", male: "male", female: "female" } as any)[String(row["الجنس"] || row.gender).toLowerCase()] || "unspecified",
      height: Number(row["الطول"] || row.height || 0) || "",
      weight: Number(row["الوزن"] || row.weight || 0) || "",
      size: row["المقاس"] || row.size || "",
      university: row["الجامعة"] || row.university || "",
      college: row["الكلية"] || row.college || "",
      department: row["القسم"] || row.department || "",
      rightText: row["كتابة الجهة اليمنى"] || row.rightText || "",
      leftText: row["كتابة الجهة اليسرى"] || row.leftText || "",
      totalAmount: Number(row["السعر"] || row.price || 0) || 0,
      notes: row["ملاحظات"] || row.notes || "",
    }));
    const seenPhones = new Set<string>();
    const validation: string[] = [];
    mapped.forEach((row) => {
      if (String(row.customerName).trim().length < 2) validation.push(`السطر ${row.row}: اسم الطالب مطلوب`);
      const phone = String(row.phone).replace(/\D/g, "");
      if (phone && phone.length < 10) validation.push(`السطر ${row.row}: رقم الهاتف غير مكتمل`);
      if (phone && seenPhones.has(phone)) validation.push(`السطر ${row.row}: رقم هاتف مكرر داخل الملف`);
      if (phone) seenPhones.add(phone);
    });
    setRows(mapped);
    setErrors(validation);
  }
  async function importRows() {
    if (errors.length || !rows.length) return;
    setSaving(true);
    const failures: string[] = [];
    for (const row of rows) {
      try {
        await adminFetch(`/admin/graduation/groups/${groupId}/students`, { method: "POST", body: JSON.stringify(row) });
      } catch (error) {
        failures.push(`السطر ${row.row}: ${apiErrorMessage(error)}`);
      }
    }
    setSaving(false);
    if (failures.length) {
      setErrors(failures);
      return;
    }
    client.invalidateQueries({ queryKey: ["admin", "graduation"] });
    toast({ title: `تم استيراد ${rows.length} طالباً بنجاح` });
    setRows([]);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-4xl">
        <DialogHeader><DialogTitle>استيراد الطلاب من Excel</DialogTitle></DialogHeader>
        <div className="rounded-lg border border-dashed border-border p-6 text-center"><FileSpreadsheet className="mx-auto h-10 w-10 text-primary" /><p className="mt-2 text-sm text-muted-foreground">يدعم XLSX وXLS وCSV، مع معاينة وفحص قبل الحفظ.</p><Input className="mx-auto mt-4 max-w-sm" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => event.target.files?.[0] && readFile(event.target.files[0]).catch((error) => setErrors([apiErrorMessage(error)]))} /></div>
        {errors.length ? <div className="max-h-32 overflow-y-auto rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{errors.map((item) => <p key={item}>{item}</p>)}</div> : null}
        {rows.length ? <div className="max-h-72 overflow-auto rounded-lg border border-border"><Table><TableHeader><TableRow><TableHead>السطر</TableHead><TableHead>الطالب</TableHead><TableHead>الهاتف</TableHead><TableHead>المقاس</TableHead><TableHead>السعر</TableHead></TableRow></TableHeader><TableBody>{rows.slice(0, 100).map((row) => <TableRow key={row.row}><TableCell>{row.row}</TableCell><TableCell>{row.customerName || <span className="text-destructive">مفقود</span>}</TableCell><TableCell>{row.phone || "—"}</TableCell><TableCell>{row.size || "—"}</TableCell><TableCell>{formatCurrency(row.totalAmount)}</TableCell></TableRow>)}</TableBody></Table></div> : null}
        <DialogFooter className="sm:justify-start"><Button onClick={importRows} disabled={saving || !rows.length || Boolean(errors.length)}>{saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Upload className="ml-2 h-4 w-4" />}اعتماد الاستيراد</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GraduationGroupWorkspace({ groupId, onBack }: { groupId: number; onBack: () => void }) {
  const { toast } = useToast();
  const { data: settings } = usePublicSettings();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [productionFilter, setProductionFilter] = useState("all");
  const [measurementFilter, setMeasurementFilter] = useState("all");
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkPrice, setBulkPrice] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [accessoryOpen, setAccessoryOpen] = useState(false);
  const [studentAccessory, setStudentAccessory] = useState<StudentRow | null>(null);
  const { data, isLoading } = useQuery<GroupDetail>({
    queryKey: ["admin", "graduation", "group-workspace", groupId],
    queryFn: () => adminFetch(`/admin/graduation/groups/${groupId}`),
  });
  const { data: templates } = useQuery<any>({ queryKey: ["admin", "graduation", "templates"], queryFn: () => adminFetch("/admin/graduation/templates") });
  const patch = useMutation({
    mutationFn: ({ id, changes }: { id: number; changes: Record<string, unknown> }) => adminFetch(`/admin/graduation/groups/${groupId}/students/${id}`, { method: "PATCH", body: JSON.stringify(changes) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "graduation", "group-workspace", groupId] }),
    onError: (error) => toast({ title: "تعذر حفظ التعديل", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const bulk = useMutation({
    mutationFn: (payload: Record<string, unknown>) => adminFetch(`/admin/graduation/groups/${groupId}/bulk`, { method: "POST", body: JSON.stringify({ ...payload, studentIds: selected }) }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin", "graduation"] });
      toast({ title: "تم تطبيق التحديث الجماعي" });
    },
    onError: (error) => toast({ title: "تعذر التحديث الجماعي", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const previews = useMutation({
    mutationFn: () => adminFetch<any>(`/admin/graduation/groups/${groupId}/previews`, { method: "POST", body: JSON.stringify({ studentIds: selected }) }),
    onSuccess: (result) => {
      client.invalidateQueries({ queryKey: ["admin", "graduation"] });
      toast({ title: "اكتمل توليد المعاينات", description: `${result.count} / ${selected.length || data?.students.length || 0} معاينة` });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/graduation/groups/${groupId}/students/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "graduation"] }),
  });
  const filtered = useMemo(() => (data?.students || []).filter((student) => {
    const needle = search.trim().toLocaleLowerCase("ar");
    const matches = !needle || [student.customerName, student.phone, student.phone2, student.studentCode, student.orderNo, student.receiptNo, student.barcodeValue].some((value) => String(value || "").toLocaleLowerCase("ar").includes(needle));
    return matches &&
      (productionFilter === "all" || student.productionStage === productionFilter) &&
      (measurementFilter === "all" || student.measurementStatus === measurementFilter);
  }), [data?.students, search, productionFilter, measurementFilter]);
  if (isLoading || !data) return <Skeleton className="h-[620px] w-full" />;
  const allSelected = filtered.length > 0 && filtered.every((row) => selected.includes(row.id));
  async function exportExcel() {
    const XLSX = await import("xlsx");
    const rows = data!.students.map((student) => ({
      "كود الطالب": student.studentCode,
      "اسم الطالب": student.customerName,
      "رقم الهاتف الأول": student.phone,
      "رقم الهاتف الثاني": student.phone2,
      الجنس: student.gender,
      الطول: student.height,
      الوزن: student.weight,
      المقاس: student.size,
      "حالة القياسات": student.measurementStatus === "complete" ? "مكتملة" : student.measurementStatus === "partial" ? "جزئية" : "غير مدخلة",
      الجامعة: student.university,
      الكلية: student.college,
      القسم: student.department,
      "نوع الروب": student.robeType,
      "لون الروب": student.robeColor,
      "نوع الوشاح": student.sashType,
      "لون الوشاح": student.sashColor,
      السعر: student.total,
      المدفوع: student.paid,
      المتبقي: student.remaining,
      "حالة الإنتاج": GRADUATION_STAGE_LABELS[student.productionStage as keyof typeof GRADUATION_STAGE_LABELS] || student.productionStage,
      "حالة التسليم": student.deliveryStatus,
      ملاحظات: student.notes,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "الطلاب");
    XLSX.writeFile(workbook, `${data!.group.groupNo}-students.xlsx`);
  }
  async function printGroupReceipt() {
    try {
      const result = await adminFetch<any>(`/admin/graduation/groups/${groupId}/receipt`, { method: "POST" });
      const receipt = result.receipt;
      const snapshot = receipt.snapshot;
      const popup = window.open("", "_blank", "width=960,height=760");
      if (!popup) throw new Error("تعذر فتح نافذة الطباعة");
      const rows = snapshot.students.map((student: any) => `<tr><td>${escapeHtml(student.studentCode)}</td><td>${escapeHtml(student.name)}</td><td>${formatCurrency(student.total)}</td><td>${formatCurrency(student.paid)}</td><td>${formatCurrency(student.remaining)}</td></tr>`).join("");
      popup.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(receipt.receiptNo)}</title><style>${sheetReportCss("a4")}</style></head><body><main class="report-sheet"><header class="report-head"><img class="report-logo" src="${escapeHtml(logoSrc(settings))}" alt="AJN"><div><div class="report-company">مجموعة علي جان نهاد</div><div class="report-title">وصل المجموعة</div></div><div class="report-meta">${escapeHtml(receipt.receiptNo)}<br>${new Date().toLocaleDateString("ar-IQ")}</div></header><section class="report-summary"><div class="report-stat">رمز المجموعة<strong>${escapeHtml(snapshot.groupCode)}</strong></div><div class="report-stat">عدد الطلاب<strong>${snapshot.totals.students}</strong></div><div class="report-stat">الإجمالي<strong>${formatCurrency(snapshot.totals.orderValue)}</strong></div><div class="report-stat">المتبقي<strong>${formatCurrency(snapshot.totals.remaining)}</strong></div></section><table class="report-table"><thead><tr><th>كود الطالب</th><th>الاسم</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>${rows}</tbody></table><div style="display:flex;justify-content:center;margin-top:16px"><img src="${escapeHtml(receipt.qrDataUrl)}" width="140" height="140" alt="QR"></div><footer class="report-footer">هذا الوصل ملخص للمجموعة ولا يحل محل وصل كل طالب.</footer></main>${printWhenImagesReadyScript()}</body></html>`);
      popup.document.close();
    } catch (error) {
      toast({ title: "تعذرت طباعة وصل المجموعة", description: apiErrorMessage(error), variant: "destructive" });
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3"><Button size="icon" variant="ghost" onClick={onBack}><ArrowRight className="h-5 w-5" /></Button><div><h2 className="text-xl font-bold">{data.group.title}</h2><p className="mt-1 text-sm text-muted-foreground">{data.group.groupNo} · {[data.group.university, data.group.college, data.group.department].filter(Boolean).join(" · ")}</p></div></div>
        <div className="flex flex-wrap gap-2"><Button onClick={() => setAddOpen(true)}><Plus className="ml-2 h-4 w-4" />إضافة طالب</Button><Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="ml-2 h-4 w-4" />استيراد Excel</Button><Button variant="outline" onClick={exportExcel}><Download className="ml-2 h-4 w-4" />تصدير Excel</Button><Button variant="outline" onClick={printGroupReceipt}><Printer className="ml-2 h-4 w-4" />وصل المجموعة</Button><Button variant="outline" onClick={() => setAccessoryOpen(true)}><Gift className="ml-2 h-4 w-4" />إدارة إكسسوارات المجموعة</Button><Button variant="outline" onClick={() => setPaymentOpen(true)}><WalletCards className="ml-2 h-4 w-4" />استلام دفعة</Button></div>
      </div>
      {(data.duplicates.length || data.shortages.length) ? <div className="grid gap-3 lg:grid-cols-2">{data.duplicates.length ? <div className="rounded-xl border border-status-warning/40 bg-status-warning/5 p-3"><div className="flex items-center gap-2 font-semibold text-status-warning"><AlertTriangle className="h-4 w-4" />تنبيه أسماء أو هواتف متكررة</div><p className="mt-1 text-sm text-muted-foreground">راجع {data.duplicates.length} سجلاً قبل اعتماد الطباعة.</p></div> : null}{data.shortages.length ? <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3"><div className="flex items-center gap-2 font-semibold text-destructive"><AlertTriangle className="h-4 w-4" />نقص في مواد المجموعة</div><p className="mt-1 text-sm text-muted-foreground">{data.shortages.map((item) => `${item.name}: ${item.shortage}`).join(" · ")}</p></div> : null}</div> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">{[["الطلاب", data.totals.students], ["الإجمالي", formatCurrency(data.totals.orderValue)], ["المدفوع", formatCurrency(data.totals.paid)], ["المتبقي", formatCurrency(data.totals.remaining)], ["قيمة الإكسسوارات", formatCurrency(data.totals.accessoriesValue || 0)], ["تم التسليم", data.totals.delivered]].map(([label, value]) => <Card key={String(label)}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><strong className="mt-1 block text-lg">{value}</strong></CardContent></Card>)}</div>
      <GroupAccessorySection groupId={groupId} selected={selected} studentCount={data.students.length} />

      <section className="rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-60 flex-1"><Label>بحث داخل المجموعة</Label><div className="relative mt-2"><Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="الاسم، الهاتف، كود الطالب، الوصل..." /></div></div>
          <div><Label>مرحلة الإنتاج</Label><Select value={productionFilter} onValueChange={setProductionFilter}><SelectTrigger className="mt-2 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل المراحل</SelectItem>{GRADUATION_STAGES.map((stage) => <SelectItem key={stage} value={stage}>{GRADUATION_STAGE_LABELS[stage]}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>حالة القياسات</Label><Select value={measurementFilter} onValueChange={setMeasurementFilter}><SelectTrigger className="mt-2 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="none">غير مدخلة</SelectItem><SelectItem value="partial">جزئية</SelectItem><SelectItem value="complete">مكتملة</SelectItem></SelectContent></Select></div>
          <Button variant="outline" onClick={() => previews.mutate()} disabled={previews.isPending}>{previews.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Sparkles className="ml-2 h-4 w-4" />}توليد معاينات {selected.length ? "المحددين" : "الجميع"}</Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2">
          <span className="text-xs font-semibold">تطبيق على {selected.length ? `${selected.length} محدد` : "جميع الطلاب"}:</span>
          <Select onValueChange={(value) => bulk.mutate({ action: "apply_template", templateId: Number(value) })}><SelectTrigger className="h-8 w-44"><SelectValue placeholder="نموذج جاهز" /></SelectTrigger><SelectContent>{templates?.items?.filter((item: any) => item.isActive).map((item: any) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select>
          <Button size="sm" variant="outline" onClick={() => bulk.mutate({ action: "robe", value: "standard" })}><Shirt className="ml-1 h-3.5 w-3.5" />الروب</Button>
          <Button size="sm" variant="outline" onClick={() => bulk.mutate({ action: "sash", value: "standard" })}>الوشاح</Button>
          <Button size="sm" variant="outline" onClick={() => bulk.mutate({ action: "color", robeColor: "#111111", sashColor: "#d4af37" })}><Palette className="ml-1 h-3.5 w-3.5" />أسود × ذهبي</Button>
          <div className="flex items-center gap-1"><Input className="h-8 w-28" type="number" min={0} value={bulkPrice || ""} onChange={(event) => setBulkPrice(Number(event.target.value))} placeholder="السعر" /><Button size="sm" variant="outline" disabled={bulkPrice < 0} onClick={() => bulk.mutate({ action: "price", value: bulkPrice })}>تطبيق السعر</Button></div>
          <Select onValueChange={(value) => bulk.mutate({ action: "production_stage", value })}><SelectTrigger className="h-8 w-44"><SelectValue placeholder="تحديث الإنتاج" /></SelectTrigger><SelectContent>{GRADUATION_STAGES.map((stage) => <SelectItem key={stage} value={stage}>{GRADUATION_STAGE_LABELS[stage]}</SelectItem>)}</SelectContent></Select>
        </div>
      </section>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
        <Table className="min-w-[3520px] text-xs">
          <TableHeader><TableRow><TableHead className="sticky right-0 z-10 bg-card"><Checkbox checked={allSelected} onCheckedChange={(checked) => setSelected(checked ? filtered.map((row) => row.id) : [])} /></TableHead><TableHead>ت</TableHead><TableHead>كود الطالب / QR</TableHead><TableHead>اسم الطالب</TableHead><TableHead>الهاتف الأول</TableHead><TableHead>الهاتف الثاني</TableHead><TableHead>الجنس</TableHead><TableHead>الطول</TableHead><TableHead>الوزن</TableHead><TableHead>المقاس</TableHead><TableHead>حالة القياسات</TableHead><TableHead>نوع الروب</TableHead><TableHead>لون الروب</TableHead><TableHead>نوع الوشاح</TableHead><TableHead>لون الوشاح</TableHead><TableHead>كتابة اليمين</TableHead><TableHead>كتابة اليسار</TableHead><TableHead>الجامعة</TableHead><TableHead>الكلية</TableHead><TableHead>القسم</TableHead><TableHead>سنة التخرج</TableHead><TableHead>الطباعة</TableHead><TableHead>التطريز</TableHead><TableHead>الإكسسوارات</TableHead><TableHead>عدد الإكسسوارات</TableHead><TableHead>سعر الإكسسوارات</TableHead><TableHead>السعر</TableHead><TableHead>المدفوع</TableHead><TableHead>المتبقي</TableHead><TableHead>التصميم</TableHead><TableHead>الإنتاج</TableHead><TableHead>التسليم</TableHead><TableHead>الوصل</TableHead><TableHead>الإجراءات</TableHead></TableRow></TableHeader>
          <TableBody>{filtered.map((student) => <TableRow key={student.id}><TableCell className="sticky right-0 z-10 bg-card"><Checkbox checked={selected.includes(student.id)} onCheckedChange={(checked) => setSelected((current) => checked ? [...current, student.id] : current.filter((id) => id !== student.id))} /></TableCell><TableCell>{student.sequence}</TableCell><TableCell><div className="font-mono text-[11px] text-primary">{student.studentCode}</div><div className="mt-1 flex gap-1"><QrCode className="h-3.5 w-3.5" /><span>{student.barcodeValue}</span></div></TableCell><TableCell><EditableCell value={student.customerName} className="w-40" onCommit={(value) => patch.mutate({ id: student.id, changes: { customerName: value } })} /></TableCell><TableCell><EditableCell value={student.phone} onCommit={(value) => patch.mutate({ id: student.id, changes: { phone: value } })} /></TableCell><TableCell><EditableCell value={student.phone2} onCommit={(value) => patch.mutate({ id: student.id, changes: { phone2: value } })} /></TableCell><TableCell><Select value={student.gender} onValueChange={(value) => patch.mutate({ id: student.id, changes: { gender: value } })}><SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unspecified">—</SelectItem><SelectItem value="male">ذكر</SelectItem><SelectItem value="female">أنثى</SelectItem></SelectContent></Select></TableCell><TableCell><EditableCell type="number" value={student.height} className="w-20" onCommit={(value) => patch.mutate({ id: student.id, changes: { height: Number(value) } })} /></TableCell><TableCell><EditableCell type="number" value={student.weight} className="w-20" onCommit={(value) => patch.mutate({ id: student.id, changes: { weight: Number(value) } })} /></TableCell><TableCell><EditableCell value={student.size} className="w-20" onCommit={(value) => patch.mutate({ id: student.id, changes: { size: value } })} /></TableCell><TableCell><MeasurementBadge value={student.measurementStatus} /></TableCell><TableCell><EditableCell value={student.robeType} onCommit={(value) => patch.mutate({ id: student.id, changes: { robeType: value } })} /></TableCell><TableCell><EditableCell type="color" value={student.robeColor || "#111111"} className="w-16" onCommit={(value) => patch.mutate({ id: student.id, changes: { robeColor: value } })} /></TableCell><TableCell><EditableCell value={student.sashType} onCommit={(value) => patch.mutate({ id: student.id, changes: { sashType: value } })} /></TableCell><TableCell><EditableCell type="color" value={student.sashColor || "#d4af37"} className="w-16" onCommit={(value) => patch.mutate({ id: student.id, changes: { sashColor: value } })} /></TableCell><TableCell><EditableCell value={student.rightText} className="w-40" onCommit={(value) => patch.mutate({ id: student.id, changes: { rightText: value } })} /></TableCell><TableCell><EditableCell value={student.leftText} className="w-40" onCommit={(value) => patch.mutate({ id: student.id, changes: { leftText: value } })} /></TableCell><TableCell><EditableCell value={student.university} className="w-40" onCommit={(value) => patch.mutate({ id: student.id, changes: { university: value } })} /></TableCell><TableCell><EditableCell value={student.college} className="w-36" onCommit={(value) => patch.mutate({ id: student.id, changes: { college: value } })} /></TableCell><TableCell><EditableCell value={student.department} className="w-32" onCommit={(value) => patch.mutate({ id: student.id, changes: { department: value } })} /></TableCell><TableCell><EditableCell value={student.graduationYear} className="w-20" onCommit={(value) => patch.mutate({ id: student.id, changes: { graduationYear: value } })} /></TableCell><TableCell><EditableCell value={student.printingType} onCommit={(value) => patch.mutate({ id: student.id, changes: { printingType: value } })} /></TableCell><TableCell><EditableCell value={student.embroideryType} onCommit={(value) => patch.mutate({ id: student.id, changes: { embroideryType: value } })} /></TableCell><TableCell><div className="flex max-w-56 flex-wrap items-center gap-1">{student.accessoryItems?.length ? student.accessoryItems.map((item) => <Badge key={item.itemId} variant="secondary" className="text-[10px]">{item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ""}{item.free ? " (مجاني)" : ""}</Badge>) : <span className="text-muted-foreground">—</span>}<Button size="icon" variant="ghost" className="h-6 w-6" title="إدارة إكسسوارات الطالب" onClick={() => setStudentAccessory(student)}><Plus className="h-3.5 w-3.5" /></Button></div></TableCell><TableCell className="text-center">{student.accessoriesCount || 0}</TableCell><TableCell>{formatCurrency(student.accessoriesTotal || 0)}</TableCell><TableCell><EditableCell type="number" value={student.total} onCommit={(value) => patch.mutate({ id: student.id, changes: { totalAmount: Number(value) } })} /></TableCell><TableCell>{formatCurrency(student.paid)}</TableCell><TableCell className={student.remaining > 0 ? "font-bold text-destructive" : "font-bold text-status-success"}>{formatCurrency(student.remaining)}</TableCell><TableCell><StatusBadge kind="design" value={student.designStatus} /></TableCell><TableCell><StatusBadge kind="production" value={student.productionStage} /></TableCell><TableCell><StatusBadge kind="delivery" value={student.deliveryStatus} /></TableCell><TableCell><ReceiptActions student={student} /></TableCell><TableCell><div className="flex gap-1"><Button size="icon" variant="ghost" title="نسخ إعدادات الطالب" onClick={() => navigator.clipboard.writeText(JSON.stringify(student)).then(() => toast({ title: "تم نسخ إعدادات الطالب" }))}><Copy className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="فتح ملف الطالب" onClick={() => window.open(student.trackingUrl, "_blank")}><Eye className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="text-destructive" title="أرشفة الطالب" onClick={() => confirm("سيتم أرشفة الطالب مع حفظ سجله. هل تريد المتابعة؟") && remove.mutate(student.id)}><Trash2 className="h-4 w-4" /></Button></div></TableCell></TableRow>)}</TableBody>
        </Table>
      </div>
      <div className="space-y-3 md:hidden">{filtered.map((student) => <Card key={student.id}><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Checkbox checked={selected.includes(student.id)} onCheckedChange={(checked) => setSelected((current) => checked ? [...current, student.id] : current.filter((id) => id !== student.id))} /><strong>{student.customerName}</strong></div><p className="mt-1 font-mono text-xs text-primary">{student.studentCode}</p></div><ReceiptActions student={student} /></div><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><span className="text-muted-foreground">المقاس</span><strong className="block">{student.size || "—"}</strong></div><div><span className="text-muted-foreground">حالة القياسات</span><div className="mt-1"><MeasurementBadge value={student.measurementStatus} /></div></div><div><span className="text-muted-foreground">المتبقي</span><strong className="block">{formatCurrency(student.remaining)}</strong></div><div><StatusBadge kind="design" value={student.designStatus} /></div><div><StatusBadge kind="production" value={student.productionStage} /></div></div></CardContent></Card>)}</div>
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4"><h3 className="font-bold">توزيع المقاسات</h3><div className="mt-3 space-y-2">{Object.entries(data.sizeDistribution).map(([size, count]) => <div key={size} className="flex items-center justify-between text-sm"><span>{size}</span><strong>{count}</strong></div>)}</div></div>
        <div className="rounded-xl border border-border bg-card p-4"><h3 className="font-bold">احتياج المواد</h3><div className="mt-3 grid grid-cols-2 gap-2 text-sm">{Object.entries(data.materialRequirements).map(([key, value]) => <div key={key} className="rounded-lg bg-muted p-2"><span className="text-muted-foreground">{key}</span><strong className="block">{value}</strong></div>)}</div></div>
        <div className="rounded-xl border border-border bg-card p-4"><h3 className="font-bold">مركز البيانات الناقصة</h3><p className="mt-1 text-sm text-muted-foreground">{data.missingData.length} طالب يحتاج استكمالاً</p><div className="mt-3 max-h-44 space-y-2 overflow-y-auto">{data.missingData.slice(0, 20).map((row) => <div key={row.id} className="rounded-lg border border-border p-2 text-xs"><strong>{row.name}</strong><p className="mt-1 text-muted-foreground">{row.missing.map((item) => missingLabels[item] || item).join(" · ")}</p></div>)}</div></div>
      </section>
      <div className="sticky bottom-3 z-20 grid gap-2 rounded-xl border border-border bg-card p-3 shadow-md sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-12">{[["عدد الطلاب", data.totals.students], ["الروب", data.totals.robes], ["الوشاح", data.totals.sashes], ["القبعات", data.totals.caps], ["الإضافات", data.totals.accessories], ["الإجمالي", formatCurrency(data.totals.orderValue)], ["الخصومات", formatCurrency(data.totals.discounts)], ["المدفوع", formatCurrency(data.totals.paid)], ["المتبقي", formatCurrency(data.totals.remaining)], ["تصاميم معتمدة", data.totals.completedDesigns], ["قيد الإنتاج", data.totals.inProduction], ["جاهز / مسلم", `${data.totals.ready} / ${data.totals.delivered}`]].map(([label, value]) => <div key={String(label)}><p className="text-[11px] text-muted-foreground">{label}</p><strong className="text-sm">{value}</strong></div>)}</div>
      <AddStudentDialog groupId={groupId} open={addOpen} onOpenChange={setAddOpen} />
      <PaymentDialog groupId={groupId} students={data.students} open={paymentOpen} onOpenChange={setPaymentOpen} />
      <ImportStudentsDialog groupId={groupId} open={importOpen} onOpenChange={setImportOpen} />
      <GroupAccessoryDialog groupId={groupId} students={data.students} open={accessoryOpen} onOpenChange={setAccessoryOpen} />
      <StudentAccessoryDialog groupId={groupId} student={studentAccessory} students={data.students} open={Boolean(studentAccessory)} onOpenChange={(open) => !open && setStudentAccessory(null)} />
    </div>
  );
}

export function GraduationStudentsDirectory() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery<any>({
    queryKey: ["admin", "graduation", "students", search],
    queryFn: () => adminFetch(`/admin/graduation/students?search=${encodeURIComponent(search)}`),
  });
  return (
    <div className="space-y-4">
      <div className="relative"><Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pr-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم، الهاتف، كود الطالب، كود الطلب، الوصل، QR أو الباركود..." /></div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card"><Table><TableHeader><TableRow><TableHead>كود الطالب</TableHead><TableHead>الطالب</TableHead><TableHead>نوع الطلب</TableHead><TableHead>الجامعة</TableHead><TableHead>المقاس</TableHead><TableHead>المالية</TableHead><TableHead>الإنتاج</TableHead><TableHead>الوصل</TableHead><TableHead>الملف</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <TableRow><TableCell colSpan={9}><Skeleton className="h-20" /></TableCell></TableRow> : data?.items?.length ? data.items.map((student: StudentRow) => <TableRow key={student.id}><TableCell className="font-mono text-xs text-primary">{student.studentCode}</TableCell><TableCell><strong>{student.customerName}</strong><p className="text-xs text-muted-foreground">{student.phone || "بدون هاتف"}</p></TableCell><TableCell>{student.orderType === "group" ? "مجموعة" : "فردي"}</TableCell><TableCell>{student.university || "—"}</TableCell><TableCell>{student.size || "—"}</TableCell><TableCell><p>{formatCurrency(student.total)}</p><p className="text-xs text-destructive">متبقي {formatCurrency(student.remaining)}</p></TableCell><TableCell><StatusBadge kind="production" value={student.productionStage} /></TableCell><TableCell><ReceiptActions student={student} /></TableCell><TableCell><Button size="icon" variant="ghost" onClick={() => window.open(student.trackingUrl, "_blank")}><Eye className="h-4 w-4" /></Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">لا توجد سجلات مطابقة</TableCell></TableRow>}</TableBody></Table></div>
    </div>
  );
}

const emptyTemplate = {
  name: "",
  code: "",
  templateType: "package",
  university: "",
  college: "",
  department: "",
  previewImageUrl: "",
  modelUrl: "",
  defaultPrice: 0,
  robeType: "standard",
  robeColor: "#111111",
  sashType: "standard",
  sashColor: "#d4af37",
  capType: "standard",
  borderColor: "#d4af37",
  printingStyle: "",
  embroideryStyle: "",
  font: "Cairo",
  isActive: true,
  isFeatured: false,
};

export function GraduationTemplateLibrary() {
  const { toast } = useToast();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyTemplate);
  const { data, isLoading } = useQuery<any>({ queryKey: ["admin", "graduation", "templates"], queryFn: () => adminFetch("/admin/graduation/templates") });
  const save = useMutation({
    mutationFn: () => adminFetch(editingId ? `/admin/graduation/templates/${editingId}` : "/admin/graduation/templates", { method: editingId ? "PATCH" : "POST", body: JSON.stringify({ name: form.name, code: form.code || undefined, templateType: form.templateType, university: form.university, college: form.college, department: form.department, previewImageUrl: form.previewImageUrl, modelUrl: form.modelUrl, defaultPrice: form.defaultPrice, isActive: form.isActive, isFeatured: form.isFeatured, configuration: { robeType: form.robeType, colors: { robe: form.robeColor, sash: form.sashColor, border: form.borderColor }, garmentDetails: { robeType: form.robeType, robeColor: form.robeColor, sashType: form.sashType, sashColor: form.sashColor, capType: form.capType, printingStyle: form.printingStyle, embroideryStyle: form.embroideryStyle, font: form.font }, placeholders: ["{{student_name_ar}}", "{{student_name_en}}", "{{university}}", "{{college}}", "{{department}}", "{{graduation_year}}", "{{student_code}}"] } }) }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ["admin", "graduation", "templates"] }); setOpen(false); setEditingId(null); setForm(emptyTemplate); toast({ title: "تم حفظ النموذج ونسخته التاريخية" }); },
    onError: (error) => toast({ title: "تعذر حفظ النموذج", description: apiErrorMessage(error), variant: "destructive" }),
  });
  function edit(item: any) {
    const configuration = item.configuration || {};
    const garments = configuration.garmentDetails || {};
    setEditingId(item.id);
    setForm({ ...emptyTemplate, ...item, defaultPrice: Number(item.defaultPrice), robeType: configuration.robeType || garments.robeType || "standard", robeColor: configuration.colors?.robe || garments.robeColor || "#111111", sashType: garments.sashType || "standard", sashColor: configuration.colors?.sash || garments.sashColor || "#d4af37", capType: garments.capType || "standard", borderColor: configuration.colors?.border || "#d4af37", printingStyle: garments.printingStyle || "", embroideryStyle: garments.embroideryStyle || "", font: garments.font || "Cairo" });
    setOpen(true);
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">مكتبة النماذج</h2><p className="mt-1 text-sm text-muted-foreground">كل تعديل ينشئ نسخة جديدة؛ الطلبات التاريخية تحتفظ بالنسخة التي تم اعتمادها.</p></div><Button onClick={() => { setEditingId(null); setForm(emptyTemplate); setOpen(true); }}><Plus className="ml-2 h-4 w-4" />إنشاء نموذج جديد</Button></div>
      {isLoading ? <Skeleton className="h-72" /> : data?.items?.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.items.map((item: any) => <Card key={item.id} className="overflow-hidden"><div className="aspect-[16/9] bg-muted">{item.previewImageUrl ? <img src={item.previewImageUrl} alt={item.name} className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center"><Shirt className="h-12 w-12 text-muted-foreground" /></div>}</div><CardContent className="p-4"><div className="flex items-start justify-between gap-2"><div><h3 className="font-bold">{item.name}</h3><p className="text-xs text-muted-foreground">{item.code} · النسخة {item.currentVersion}</p></div><div className="flex gap-1">{item.isFeatured ? <Badge>مميز</Badge> : null}{!item.isActive ? <Badge variant="secondary">مخفي</Badge> : null}</div></div><div className="mt-3 flex items-center justify-between text-sm"><span>{item.templateType}</span><strong>{formatCurrency(item.defaultPrice)}</strong></div><Button className="mt-4 w-full" variant="outline" onClick={() => edit(item)}>تعديل وإنشاء نسخة جديدة</Button></CardContent></Card>)}</div> : <div className="rounded-xl border border-dashed border-border p-12 text-center"><Sparkles className="mx-auto h-10 w-10 text-primary" /><h3 className="mt-3 font-bold">لا توجد نماذج محفوظة</h3><p className="mt-1 text-sm text-muted-foreground">أنشئ أول نموذج ليصبح متاحاً للطلبات الفردية والجماعية.</p></div>}
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-bold">تركيبات ألوان جاهزة</h3><div className="mt-3 flex flex-wrap gap-2">{[["أسود × ذهبي", "#111111", "#d4af37"], ["أسود × فضي", "#111111", "#c0c0c0"], ["كحلي × ذهبي", "#172554", "#d4af37"], ["عنابي × ذهبي", "#7f1d1d", "#d4af37"], ["أخضر × ذهبي", "#14532d", "#d4af37"], ["أبيض × ذهبي", "#ffffff", "#d4af37"], ["رصاصي × فضي", "#52525b", "#c0c0c0"], ["بنفسجي × ذهبي", "#581c87", "#d4af37"]].map(([label, first, second]) => <span key={label} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm"><i className="h-4 w-4 rounded-full border" style={{ background: first }} /><i className="h-4 w-4 rounded-full border" style={{ background: second }} />{label}</span>)}</div></section>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent dir="rtl" className="max-h-[92dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{editingId ? "تعديل النموذج" : "إنشاء نموذج جديد"}</DialogTitle></DialogHeader><div className="grid gap-4 sm:grid-cols-2">{[["name", "اسم النموذج"], ["code", "الكود"], ["university", "الجامعة"], ["college", "الكلية"], ["department", "القسم"], ["previewImageUrl", "رابط صورة المعاينة"], ["modelUrl", "رابط نموذج 3D"], ["robeType", "نوع الروب"], ["sashType", "نوع الوشاح"], ["capType", "تصميم القبعة"], ["printingStyle", "أسلوب الطباعة"], ["embroideryStyle", "أسلوب التطريز"], ["font", "الخط"]].map(([key, label]) => <div key={key}><Label>{label}</Label><Input className="mt-2" value={String((form as any)[key] || "")} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} /></div>)}<div><Label>نوع النموذج</Label><Select value={form.templateType} onValueChange={(value) => setForm((current) => ({ ...current, templateType: value }))}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="robe">روب</SelectItem><SelectItem value="sash">وشاح</SelectItem><SelectItem value="cap">قبعة</SelectItem><SelectItem value="package">باقة كاملة</SelectItem><SelectItem value="university">خاص بجامعة</SelectItem><SelectItem value="college">خاص بكلية</SelectItem><SelectItem value="department">خاص بقسم</SelectItem></SelectContent></Select></div><div><Label>السعر الافتراضي</Label><Input className="mt-2" type="number" value={form.defaultPrice} onChange={(event) => setForm((current) => ({ ...current, defaultPrice: Number(event.target.value) }))} /></div><div className="grid grid-cols-3 gap-3 sm:col-span-2">{[["robeColor", "لون الروب"], ["sashColor", "لون الوشاح"], ["borderColor", "لون الحافة"]].map(([key, label]) => <div key={key}><Label>{label}</Label><Input className="mt-2" type="color" value={String((form as any)[key])} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} /></div>)}</div><label className="flex items-center gap-2"><Checkbox checked={form.isActive} onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked === true }))} />نشط</label><label className="flex items-center gap-2"><Checkbox checked={form.isFeatured} onCheckedChange={(checked) => setForm((current) => ({ ...current, isFeatured: checked === true }))} />مميز</label></div><div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">العناصر النائبة المتاحة: {`{{student_name_ar}} · {{student_name_en}} · {{university}} · {{college}} · {{department}} · {{graduation_year}} · {{student_code}}`}</div><DialogFooter className="sm:justify-start"><Button onClick={() => save.mutate()} disabled={save.isPending || form.name.trim().length < 2}>{save.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="ml-2 h-4 w-4" />}حفظ النموذج</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

// ── Group-order accessories UI (Phase 1) ─────────────────────────────────────
function useAccessoryCatalog(groupId: number) {
  return useQuery<{ accessories: AccessoryProduct[] }>({
    queryKey: ["admin", "graduation", "accessory-catalog", groupId],
    queryFn: () => adminFetch(`/admin/graduation/groups/${groupId}/accessories/catalog`),
  });
}

// "إكسسوارات المجموعة" — catalog cards with quick apply (to selected if any, else all).
function GroupAccessorySection({ groupId, selected, studentCount }: { groupId: number; selected: number[]; studentCount: number }) {
  const client = useQueryClient();
  const { toast } = useToast();
  const catalog = useAccessoryCatalog(groupId);
  const [qty, setQty] = useState<Record<number, number>>({});
  const apply = useMutation({
    mutationFn: (vars: { templateId: number; quantity: number; scope: string }) =>
      adminFetch(`/admin/graduation/groups/${groupId}/accessories`, { method: "POST", body: JSON.stringify({ ...vars, studentOrderIds: selected }) }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ["admin", "graduation", "group-workspace", groupId] }); toast({ title: "تمت إضافة الإكسسوار للطلبة" }); },
    onError: (error) => toast({ title: "تعذرت إضافة الإكسسوار", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const scope = selected.length ? "selected" : "all";
  const items = catalog.data?.accessories ?? [];
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-bold"><Gift className="h-4 w-4 text-primary" />إكسسوارات المجموعة</h3>
        <span className="text-xs text-muted-foreground">{selected.length ? `سيُضاف إلى ${selected.length} طالب محدد` : `سيُضاف إلى جميع الطلبة (${studentCount})`}</span>
      </div>
      {catalog.isLoading ? <Skeleton className="h-24" /> : items.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border border-border/60 p-3">
              <div className="flex gap-3">
                {item.image ? <img src={item.image} alt={item.name} className="h-14 w-14 rounded-md object-cover" loading="lazy" decoding="async" /> : <div className="grid h-14 w-14 place-items-center rounded-md bg-muted text-muted-foreground"><Gift className="h-5 w-5" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1"><strong className="truncate text-sm">{item.name}</strong>{item.required ? <Badge className="text-[10px]">إلزامي</Badge> : <Badge variant="outline" className="text-[10px]">اختياري</Badge>}</div>
                  <p className="font-mono text-[11px] text-muted-foreground">{item.code}</p>
                  <p className="text-xs">{formatCurrency(item.unitPrice)} · {item.trackStock ? `المتوفر ${item.stock}` : "غير مخزَّن"}</p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Input type="number" min={1} className="h-8 w-20" value={qty[item.id] ?? 1} onChange={(event) => setQty((current) => ({ ...current, [item.id]: Math.max(1, Number(event.target.value) || 1) }))} />
                <Button size="sm" disabled={apply.isPending} onClick={() => apply.mutate({ templateId: item.id, quantity: qty[item.id] ?? 1, scope })}><Plus className="ml-1 h-3.5 w-3.5" />إضافة</Button>
              </div>
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-muted-foreground">لا توجد إكسسوارات مُفعّلة. أضِفها من إدارة منتجات التخرج (النوع: إكسسوار).</p>}
    </section>
  );
}

// "إدارة إكسسوارات المجموعة" — full bulk editor: catalog + student multi-select.
function GroupAccessoryDialog({ groupId, students, open, onOpenChange }: { groupId: number; students: StudentRow[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const { toast } = useToast();
  const catalog = useAccessoryCatalog(groupId);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState("");
  const [free, setFree] = useState(false);
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<number[]>([]);
  const items = catalog.data?.accessories ?? [];
  const product = items.find((item) => item.id === templateId) ?? null;
  const effectiveUnit = free ? 0 : unitPrice !== "" ? Number(unitPrice) : product?.unitPrice ?? 0;
  const totalQty = quantity * selectedStudents.length;
  const allSelected = students.length > 0 && selectedStudents.length === students.length;
  const apply = useMutation({
    mutationFn: () => adminFetch(`/admin/graduation/groups/${groupId}/accessories`, { method: "POST", body: JSON.stringify({ templateId, quantity, scope: "selected", studentOrderIds: selectedStudents, unitPrice: unitPrice !== "" ? Number(unitPrice) : undefined, free, reason: reason || undefined, managerApproved: override }) }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ["admin", "graduation", "group-workspace", groupId] }); toast({ title: "تم تطبيق الإكسسوار على الطلبة المحددين" }); onOpenChange(false); setSelectedStudents([]); },
    onError: (error) => toast({ title: "تعذر التطبيق", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-3xl">
        <DialogHeader><DialogTitle>إدارة إكسسوارات المجموعة</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div><Label>الإكسسوار</Label><Select value={templateId ? String(templateId) : ""} onValueChange={(value) => setTemplateId(Number(value))}><SelectTrigger className="mt-2"><SelectValue placeholder="اختر إكسسواراً" /></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name} · {formatCurrency(item.unitPrice)}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>الكمية لكل طالب</Label><Input type="number" min={1} className="mt-2" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} /></div>
              <div><Label>سعر الوحدة</Label><Input type="number" min={0} className="mt-2" value={free ? 0 : unitPrice} disabled={free} placeholder={product ? String(product.unitPrice) : ""} onChange={(event) => setUnitPrice(event.target.value)} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={free} onCheckedChange={(checked) => setFree(Boolean(checked))} />إكسسوار مجاني</label>
            {free || unitPrice !== "" ? <div><Label>سبب تغيير السعر</Label><Input className="mt-2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مطلوب عند تغيير السعر" /></div> : null}
            {product?.trackStock ? <label className="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={override} onCheckedChange={(checked) => setOverride(Boolean(checked))} />تجاوز نقص المخزون (بموافقة المدير)</label> : null}
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <div className="flex justify-between"><span>الطلبة المحددون</span><b>{selectedStudents.length}</b></div>
              <div className="flex justify-between"><span>إجمالي الكمية</span><b>{totalQty}</b></div>
              <div className="flex justify-between"><span>الإجمالي</span><b>{formatCurrency(effectiveUnit * totalQty)}</b></div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label>الطلبة</Label><label className="flex items-center gap-2 text-xs"><Checkbox checked={allSelected} onCheckedChange={(checked) => setSelectedStudents(checked ? students.map((student) => student.id) : [])} />تحديد الكل</label></div>
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {students.map((student) => <label key={student.id} className="flex items-center gap-2 text-sm"><Checkbox checked={selectedStudents.includes(student.id)} onCheckedChange={(checked) => setSelectedStudents((current) => checked ? [...current, student.id] : current.filter((id) => id !== student.id))} /><span className="flex-1 truncate">{student.customerName}</span><span className="text-xs text-muted-foreground">{student.studentCode}</span></label>)}
            </div>
          </div>
        </div>
        <DialogFooter className="sm:justify-start"><Button disabled={!templateId || !selectedStudents.length || apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Gift className="ml-2 h-4 w-4" />}تطبيق على {selectedStudents.length} طالب</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Per-student accessories: view / add / remove / change quantity / copy from another student.
function StudentAccessoryDialog({ groupId, student, students, open, onOpenChange }: { groupId: number; student: StudentRow | null; students: StudentRow[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const { toast } = useToast();
  const catalog = useAccessoryCatalog(groupId);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const invalidate = () => client.invalidateQueries({ queryKey: ["admin", "graduation", "group-workspace", groupId] });
  const items = catalog.data?.accessories ?? [];
  const current = students.find((row) => row.id === student?.id) ?? student;
  const add = useMutation({
    mutationFn: () => adminFetch(`/admin/graduation/groups/${groupId}/accessories`, { method: "POST", body: JSON.stringify({ templateId, quantity, scope: "student", studentOrderIds: current ? [current.id] : [] }) }),
    onSuccess: () => { invalidate(); toast({ title: "تمت إضافة الإكسسوار" }); setTemplateId(null); setQuantity(1); },
    onError: (error) => toast({ title: "تعذرت الإضافة", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const removeItem = useMutation({
    mutationFn: (itemId: number) => adminFetch(`/admin/graduation/groups/${groupId}/accessories/${itemId}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
    onError: (error) => toast({ title: "تعذرت الإزالة", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const changeQty = useMutation({
    mutationFn: (vars: { itemId: number; quantity: number }) => adminFetch(`/admin/graduation/groups/${groupId}/accessories/${vars.itemId}`, { method: "PATCH", body: JSON.stringify({ quantity: vars.quantity }) }),
    onSuccess: () => invalidate(),
    onError: (error) => toast({ title: "تعذر التعديل", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const copy = useMutation({
    mutationFn: () => adminFetch(`/admin/graduation/groups/${groupId}/students/${current!.id}/accessories-copy`, { method: "POST", body: JSON.stringify({ sourceOrderId: copyFrom }) }),
    onSuccess: () => { invalidate(); toast({ title: "تم نسخ الإكسسوارات" }); setCopyFrom(null); },
    onError: (error) => toast({ title: "تعذر النسخ", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle>إكسسوارات الطالب — {current?.customerName}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            {current?.accessoryItems?.length ? current.accessoryItems.map((item) => (
              <div key={item.itemId} className="flex items-center gap-2 rounded-lg border border-border/60 p-2 text-sm">
                <span className="flex-1 truncate">{item.name}{item.free ? " (مجاني)" : ""}</span>
                <Input type="number" min={1} className="h-8 w-16" defaultValue={item.quantity} onBlur={(event) => { const next = Math.max(1, Number(event.target.value) || 1); if (next !== item.quantity) changeQty.mutate({ itemId: item.itemId, quantity: next }); }} />
                <span className="w-24 text-left">{formatCurrency(item.lineTotal)}</span>
                <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeItem.mutate(item.itemId)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            )) : <p className="text-sm text-muted-foreground">لا توجد إكسسوارات لهذا الطالب.</p>}
          </div>
          <div className="flex items-end gap-2 border-t border-border pt-3">
            <div className="flex-1"><Label>إضافة إكسسوار</Label><Select value={templateId ? String(templateId) : ""} onValueChange={(value) => setTemplateId(Number(value))}><SelectTrigger className="mt-2"><SelectValue placeholder="اختر" /></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name} · {formatCurrency(item.unitPrice)}</SelectItem>)}</SelectContent></Select></div>
            <Input type="number" min={1} className="w-16" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} />
            <Button disabled={!templateId || add.isPending} onClick={() => add.mutate()}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1"><Label>نسخ إكسسوارات من طالب آخر</Label><Select value={copyFrom ? String(copyFrom) : ""} onValueChange={(value) => setCopyFrom(Number(value))}><SelectTrigger className="mt-2"><SelectValue placeholder="اختر الطالب المصدر" /></SelectTrigger><SelectContent>{students.filter((row) => row.id !== current?.id).map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.customerName}</SelectItem>)}</SelectContent></Select></div>
            <Button variant="outline" disabled={!copyFrom || copy.isPending} onClick={() => copy.mutate()}><Copy className="ml-1 h-4 w-4" />نسخ</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
