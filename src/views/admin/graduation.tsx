import { type CSSProperties, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  BarChart3,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  GraduationCap,
  GripVertical,
  Layers3,
  Loader2,
  PackageCheck,
  Plus,
  Printer,
  RefreshCw,
  Ruler,
  Save,
  Scissors,
  Search,
  Settings2,
  Shirt,
  Sparkles,
  Trash2,
  Truck,
  Upload,
  UserRound,
  Users,
  Wrench,
  X,
} from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { downloadElementPdf } from "@/lib/pdf";
import { formatCurrency } from "@/lib/money";
import { processImageFile } from "@/lib/image-tools";
import {
  GRADUATION_STAGES,
  GRADUATION_STAGE_LABELS,
  type GraduationConfig,
  type GraduationOption,
} from "@/lib/graduation";
import { adminFetch, apiErrorMessage } from "./_lib";

type Mode =
  | "dashboard"
  | "orders"
  | "customers"
  | "configurator"
  | "measurements"
  | "production"
  | "tailoring"
  | "printing"
  | "embroidery"
  | "delivery"
  | "reports"
  | "settings";

const MODE_LABELS: Record<Mode, string> = {
  dashboard: "لوحة تجهيزات التخرج",
  orders: "طلبات التخرج",
  customers: "عملاء التخرج",
  configurator: "مُعدّ تصميم التخرج",
  measurements: "القياسات",
  production: "لوحة الإنتاج",
  tailoring: "الخياطة",
  printing: "الطباعة",
  embroidery: "التطريز",
  delivery: "التسليم",
  reports: "تقارير التخرج",
  settings: "إعدادات التخرج",
};

const GRADUATION_THEME_STYLE = {
  "--primary": "43 59% 59%",
  "--primary-foreground": "240 24% 6%",
  "--ring": "43 59% 59%",
} as CSSProperties;

const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  submitted: "مرسل",
  confirmed: "مؤكد",
  in_production: "قيد الإنتاج",
  ready: "جاهز",
  delivered: "تم التسليم",
  cancelled: "ملغي",
  paid: "مدفوع",
  partial: "جزئي",
  unpaid: "غير مدفوع",
};

function currentMode(path: string): Mode {
  const value = path.split("/")[3] as Mode | undefined;
  return value && value in MODE_LABELS ? value : "dashboard";
}

function Metric({
  label,
  value,
  icon: Icon,
  tone = "primary",
}: {
  label: string;
  value: string | number;
  icon: any;
  tone?: "primary" | "success" | "warning";
}) {
  const color =
    tone === "success"
      ? "text-status-success"
      : tone === "warning"
        ? "text-status-warning"
        : "text-primary";
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <strong className="mt-1 block truncate text-xl text-foreground">
            {value}
          </strong>
        </div>
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted ${color}`}
        >
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold text-foreground">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "graduation", "dashboard"],
    queryFn: () => adminFetch<any>("/admin/graduation/dashboard"),
    refetchInterval: 45_000,
  });
  if (isLoading)
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  const cards = data?.cards ?? {};
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="طلبات اليوم"
          value={cards.today ?? 0}
          icon={CalendarClock}
        />
        <Metric
          label="قيد الإنتاج"
          value={cards.inProduction ?? 0}
          icon={Wrench}
        />
        <Metric
          label="جاهزة"
          value={cards.ready ?? 0}
          icon={PackageCheck}
          tone="success"
        />
        <Metric
          label="متأخرة"
          value={cards.delayed ?? 0}
          icon={CalendarClock}
          tone="warning"
        />
        <Metric
          label="إجمالي الإيرادات"
          value={formatCurrency(cards.revenue)}
          icon={CircleDollarSign}
        />
        <Metric
          label="المبالغ المستلمة"
          value={formatCurrency(cards.paid)}
          icon={CircleDollarSign}
          tone="success"
        />
        <Metric
          label="الربح المتوقع"
          value={formatCurrency(cards.profit)}
          icon={BarChart3}
        />
        <Metric
          label="إجمالي الطلبات"
          value={cards.orders ?? 0}
          icon={GraduationCap}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-bold">طاقة الإنتاج حسب المرحلة</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {GRADUATION_STAGES.map((stage) => (
              <div
                key={stage}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span>{GRADUATION_STAGE_LABELS[stage]}</span>
                <strong className="text-primary">
                  {data?.stages?.[stage] ?? 0}
                </strong>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-bold">تنبيهات التشغيل</h2>
          {data?.recommendations?.length ? (
            <div className="mt-4 space-y-3">
              {data.recommendations.map((item: string) => (
                <div
                  key={item}
                  className="rounded-lg border border-status-warning/30 bg-status-warning/5 p-3 text-sm leading-6"
                >
                  {item}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-8 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-status-success" />
              لا توجد تنبيهات حرجة
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function GroupOrders() {
  const { toast } = useToast();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    representativeName: "",
    representativePhone: "",
    university: "",
    college: "",
    department: "",
    graduationYear: String(new Date().getFullYear()),
    eventDate: "",
  });
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "graduation", "groups"],
    queryFn: () => adminFetch<any>("/admin/graduation/groups"),
  });
  const create = useMutation({
    mutationFn: () =>
      adminFetch<any>("/admin/graduation/groups", {
        method: "POST",
        body: JSON.stringify(form),
      }),
    onSuccess: ({ group }) => {
      client.invalidateQueries({ queryKey: ["admin", "graduation", "groups"] });
      setOpen(false);
      navigator.clipboard
        ?.writeText(`${window.location.origin}${group.joinUrl}`)
        .catch(() => undefined);
      toast({
        title: "تم إنشاء الطلب الجماعي",
        description: "تم نسخ رابط انضمام الطلبة",
      });
    },
    onError: (error) =>
      toast({
        title: "تعذر الإنشاء",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  const close = useMutation({
    mutationFn: (id: number) =>
      adminFetch(`/admin/graduation/groups/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "closed" }),
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["admin", "graduation", "groups"] }),
  });
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold">الطلبات الجماعية</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            أنشئ رابطاً واحداً لينضم كل طالب بقياساته وتصميمه.
          </p>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Users className="ml-2 h-4 w-4" />
          إنشاء مجموعة
        </Button>
      </div>
      <div className="mt-4 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المجموعة</TableHead>
              <TableHead>الجامعة</TableHead>
              <TableHead>الممثل</TableHead>
              <TableHead>الموعد</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>الرابط</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-16" />
                </TableCell>
              </TableRow>
            ) : data?.items?.length ? (
              data.items.slice(0, 8).map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <strong>{item.title}</strong>
                    <p className="text-xs text-muted-foreground">
                      {item.groupNo}
                    </p>
                  </TableCell>
                  <TableCell>{item.university || "—"}</TableCell>
                  <TableCell>{item.representativeName || "—"}</TableCell>
                  <TableCell>{item.eventDate || "—"}</TableCell>
                  <TableCell>
                    {item.status === "open" ? "مفتوحة" : "مغلقة"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          navigator.clipboard
                            ?.writeText(
                              `${window.location.origin}/graduation?group=${item.joinToken}`,
                            )
                            .then(() => toast({ title: "تم نسخ الرابط" }));
                        }}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      {item.status === "open" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => close.mutate(item.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  لا توجد مجموعات بعد
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>إنشاء طلب تخرج جماعي</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["title", "اسم الدفعة / المجموعة"],
              ["representativeName", "اسم ممثل الطلبة"],
              ["representativePhone", "هاتف الممثل"],
              ["university", "الجامعة"],
              ["college", "الكلية"],
              ["department", "القسم"],
              ["graduationYear", "سنة التخرج"],
            ].map(([key, label]) => (
              <div key={key}>
                <Label>{label}</Label>
                <Input
                  className="mt-2"
                  value={(form as any)[key]}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
            <div>
              <Label>موعد الحفل</Label>
              <Input
                type="date"
                className="mt-2"
                value={form.eventDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    eventDate: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter className="sm:justify-start">
            <Button
              onClick={() => create.mutate()}
              disabled={!form.title.trim() || create.isPending}
            >
              {create.isPending ? (
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="ml-2 h-4 w-4" />
              )}
              إنشاء ونسخ الرابط
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function DashboardWithGroups() {
  return (
    <div className="space-y-5">
      <Dashboard />
      <GroupOrders />
    </div>
  );
}

function OrderDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "graduation", "order", id],
    queryFn: () => adminFetch<any>(`/admin/graduation/orders/${id}`),
  });
  const { data: staffOptions } = useQuery({
    queryKey: ["admin", "graduation", "staff-options"],
    queryFn: () => adminFetch<any>("/admin/graduation/staff-options"),
    staleTime: 5 * 60_000,
  });
  const order = data?.order;
  const [draft, setDraft] = useState<any>({});
  const save = useMutation({
    mutationFn: () =>
      adminFetch(`/admin/graduation/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      }),
    onSuccess: () => {
      toast({ title: "تم تحديث الطلب" });
      client.invalidateQueries({ queryKey: ["admin", "graduation"] });
      setDraft({});
    },
    onError: (error) =>
      toast({
        title: "تعذر الحفظ",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  if (isLoading || !order)
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent dir="rtl">
          <Skeleton className="h-96" />
        </DialogContent>
      </Dialog>
    );
  const total = Number(draft.totalAmount ?? order.totalAmount ?? 0);
  const paid = Number(draft.paidAmount ?? order.paidAmount ?? 0);
  const checklist = {
    ...(order.qualityChecklist ?? {}),
    ...(draft.qualityChecklist ?? {}),
  };
  const delivery = { ...(order.delivery ?? {}), ...(draft.delivery ?? {}) };
  function printPickupLabel() {
    if (!order.qrDataUrl) return;
    const popup = window.open("", "_blank", "width=480,height=680");
    if (!popup) return;
    popup.document.write(
      `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${order.orderNo}</title><style>@page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#000;text-align:center;margin:0;font-weight:700}img{display:block;width:45mm;height:45mm;object-fit:contain;margin:4mm auto;image-rendering:pixelated}.no{font-size:16px}.name{font-size:14px;margin-top:2mm}.meta{font-size:11px;margin-top:2mm;border-top:1px solid #000;padding-top:2mm}</style></head><body><div class="no">${order.orderNo}</div><img src="${order.qrDataUrl}" alt="QR"><div class="name">${order.customerName}</div><div class="meta">تجهيزات التخرج · طرد رقم ${order.id}</div><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`,
    );
    popup.document.close();
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        dir="rtl"
        className="max-h-[92vh] max-w-5xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>تفاصيل {order.orderNo}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="details">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="details">الطلب</TabsTrigger>
            <TabsTrigger value="production">الإنتاج</TabsTrigger>
            <TabsTrigger value="quality">الجودة</TabsTrigger>
            <TabsTrigger value="finance">المالية</TabsTrigger>
            <TabsTrigger value="delivery">التسليم</TabsTrigger>
            <TabsTrigger value="pickup">QR والتغليف</TabsTrigger>
            <TabsTrigger value="timeline">السجل</TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Info label="الزبون" value={order.customerName} />
              <Info label="النوع" value={order.styleKey} />
              <Info label="القماش" value={order.fabric?.key} />
              <Info
                label="المقاس"
                value={order.measurements?.suggestedSize || "حسب القياسات"}
              />
              <Info label="التسليم" value={order.dueDate || "غير محدد"} />
              <Info
                label="الحالة"
                value={STATUS_LABELS[order.status] || order.status}
              />
            </div>
            <div className="rounded-lg border border-border p-4">
              <h3 className="font-semibold">القياسات</h3>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {Object.entries(order.measurements ?? {})
                  .filter(([, value]) => value !== "")
                  .map(([key, value]) => (
                    <Info key={key} label={key} value={String(value)} />
                  ))}
              </div>
            </div>
          </TabsContent>
          <TabsContent value="production" className="space-y-4">
            <div>
              <Label>مرحلة الإنتاج</Label>
              <Select
                value={draft.productionStage ?? order.productionStage}
                onValueChange={(value) =>
                  setDraft((current: any) => ({
                    ...current,
                    productionStage: value,
                    status:
                      value === "ready"
                        ? "ready"
                        : value === "delivered"
                          ? "delivered"
                          : "in_production",
                  }))
                }
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRADUATION_STAGES.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {GRADUATION_STAGE_LABELS[stage]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              {order.tasks?.map((task: any) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span>{task.title}</span>
                  <span
                    className={
                      task.status === "completed"
                        ? "text-status-success"
                        : task.status === "in_progress"
                          ? "text-primary"
                          : "text-muted-foreground"
                    }
                  >
                    {task.status === "completed"
                      ? "مكتملة"
                      : task.status === "in_progress"
                        ? "جارية"
                        : "بانتظار"}
                  </span>
                </div>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="quality" className="grid gap-3 sm:grid-cols-2">
            {[
              ["measurements", "مطابقة القياسات"],
              ["fabric", "سلامة القماش"],
              ["printing", "جودة الطباعة"],
              ["embroidery", "جودة التطريز"],
              ["accessories", "اكتمال الإكسسوارات"],
              ["cleaning", "التنظيف والكي"],
              ["packaging", "التغليف"],
            ].map(([key, label]) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3"
              >
                <Checkbox
                  checked={checklist[key] === true}
                  onCheckedChange={(checked) =>
                    setDraft((current: any) => ({
                      ...current,
                      qualityChecklist: {
                        ...(current.qualityChecklist ?? {}),
                        [key]: checked === true,
                      },
                    }))
                  }
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </TabsContent>
          <TabsContent value="finance" className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>المبلغ الكلي</Label>
              <Input
                className="mt-2"
                inputMode="numeric"
                value={draft.totalAmount ?? order.totalAmount}
                onChange={(event) =>
                  setDraft((current: any) => ({
                    ...current,
                    totalAmount: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>المبلغ المدفوع</Label>
              <Input
                className="mt-2"
                inputMode="numeric"
                value={draft.paidAmount ?? order.paidAmount}
                onChange={(event) =>
                  setDraft((current: any) => ({
                    ...current,
                    paidAmount: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>طريقة الدفع</Label>
              <Select
                value={draft.paymentMethod ?? order.paymentMethod ?? "cash"}
                onValueChange={(value) =>
                  setDraft((current: any) => ({
                    ...current,
                    paymentMethod: value,
                  }))
                }
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقدي</SelectItem>
                  <SelectItem value="card">بطاقة</SelectItem>
                  <SelectItem value="transfer">تحويل</SelectItem>
                  <SelectItem value="other">أخرى</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm text-muted-foreground">المتبقي بعد الحفظ</p>
              <strong className="mt-2 block text-xl text-primary">
                {formatCurrency(Math.max(0, total - paid))}
              </strong>
            </div>
          </TabsContent>
          <TabsContent value="delivery" className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>موظف التسليم</Label>
              <Select
                value={String(
                  draft.assignedStaffId ?? order.assignedStaffId ?? "none",
                )}
                onValueChange={(value) =>
                  setDraft((current: any) => ({
                    ...current,
                    assignedStaffId: value === "none" ? null : Number(value),
                  }))
                }
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="اختر الموظف" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">غير معين</SelectItem>
                  {staffOptions?.items?.map((item: any) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name || item.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>حالة التسليم</Label>
              <Select
                value={String(delivery.status ?? "pending")}
                onValueChange={(value) =>
                  setDraft((current: any) => ({
                    ...current,
                    delivery: { ...(current.delivery ?? {}), status: value },
                  }))
                }
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">بانتظار التعيين</SelectItem>
                  <SelectItem value="assigned">تم التعيين</SelectItem>
                  <SelectItem value="out_for_delivery">بالطريق</SelectItem>
                  <SelectItem value="delivered">تم التسليم</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>رابط الموقع المباشر</Label>
              <Input
                className="mt-2"
                dir="ltr"
                value={String(delivery.mapUrl ?? "")}
                onChange={(event) =>
                  setDraft((current: any) => ({
                    ...current,
                    delivery: {
                      ...(current.delivery ?? {}),
                      mapUrl: event.target.value,
                    },
                  }))
                }
                placeholder="https://maps.google.com/..."
              />
            </div>
            <div className="sm:col-span-2">
              <Label>ملاحظات التسليم</Label>
              <Textarea
                className="mt-2"
                value={String(delivery.notes ?? "")}
                onChange={(event) =>
                  setDraft((current: any) => ({
                    ...current,
                    delivery: {
                      ...(current.delivery ?? {}),
                      notes: event.target.value,
                    },
                  }))
                }
              />
            </div>
            {delivery.mapUrl ? (
              <Button
                variant="outline"
                onClick={() => window.open(String(delivery.mapUrl), "_blank")}
              >
                <Truck className="ml-2 h-4 w-4" />
                فتح الموقع
              </Button>
            ) : null}
          </TabsContent>
          <TabsContent value="pickup">
            <div className="mx-auto max-w-sm rounded-xl border border-border bg-card p-5 text-center">
              {order.qrDataUrl ? (
                <img
                  src={order.qrDataUrl}
                  alt="QR استلام الطلب"
                  className="mx-auto h-56 w-56 rounded-lg bg-white p-2"
                />
              ) : null}
              <strong className="mt-3 block text-lg">{order.orderNo}</strong>
              <p className="mt-1 text-sm text-muted-foreground">
                {order.customerName}
              </p>
              <Button className="mt-5 w-full" onClick={printPickupLabel}>
                <Printer className="ml-2 h-4 w-4" />
                طباعة ملصق الاستلام
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="timeline" className="space-y-4">
            {order.timeline?.map((item: any) => (
              <div key={item.id} className="border-r-2 border-primary pr-4">
                <strong className="text-sm">{item.title}</strong>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.actorName} ·{" "}
                  {new Date(item.createdAt).toLocaleString("ar-IQ")}
                </p>
              </div>
            ))}
          </TabsContent>
        </Tabs>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !Object.keys(draft).length}
          >
            {save.isPending ? (
              <Loader2 className="ml-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="ml-2 h-4 w-4" />
            )}
            حفظ التعديلات
          </Button>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">
        {value || "—"}
      </p>
    </div>
  );
}

function Orders({
  measurementOnly = false,
  deliveryOnly = false,
}: {
  measurementOnly?: boolean;
  deliveryOnly?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const stage = measurementOnly ? "measurements" : deliveryOnly ? "ready" : "";
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "graduation", "orders", search, status, stage],
    queryFn: () =>
      adminFetch<any>(
        `/admin/graduation/orders?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&stage=${encodeURIComponent(stage)}`,
      ),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            className="pr-10"
            placeholder="بحث بالاسم أو الهاتف أو رقم الطلب"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          value={status || "all"}
          onValueChange={(value) => setStatus(value === "all" ? "" : value)}
        >
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder="كل الحالات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {Object.entries(STATUS_LABELS)
              .filter(([key]) => !["paid", "partial", "unpaid"].includes(key))
              .map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الطلب</TableHead>
              <TableHead>الزبون</TableHead>
              <TableHead>المرحلة</TableHead>
              <TableHead>التسليم</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="w-24">إجراء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-8" />
                  </TableCell>
                </TableRow>
              ))
            ) : data?.items?.length ? (
              data.items.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium text-primary">
                    {item.orderNo}
                  </TableCell>
                  <TableCell>
                    <div>{item.customerName}</div>
                    <span className="text-xs text-muted-foreground">
                      {item.phone}
                    </span>
                  </TableCell>
                  <TableCell>{item.stageLabel}</TableCell>
                  <TableCell>{item.dueDate || "—"}</TableCell>
                  <TableCell>{formatCurrency(item.totalAmount)}</TableCell>
                  <TableCell>
                    {STATUS_LABELS[item.status] || item.status}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelected(item.id)}
                      title="فتح التفاصيل"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-36 text-center text-muted-foreground"
                >
                  لا توجد طلبات مطابقة
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {selected ? (
        <OrderDetail id={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

function Production({ focus }: { focus?: string }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "graduation", "production"],
    queryFn: () => adminFetch<any>("/admin/graduation/production"),
    refetchInterval: 30_000,
  });
  const move = useMutation({
    mutationFn: ({ id, stage }: { id: number; stage: string }) =>
      adminFetch(`/admin/graduation/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          productionStage: stage,
          status: stage === "ready" ? "ready" : "in_production",
        }),
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["admin", "graduation"] }),
    onError: (error) =>
      toast({
        title: "تعذر نقل الطلب",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  if (isLoading) return <Skeleton className="h-[600px]" />;
  const visible = focus
    ? data.columns.filter((column: any) => column.stage === focus)
    : data.columns;
  return (
    <div className="overflow-x-auto pb-3">
      <div className="flex min-w-max gap-3">
        {visible.map((column: any) => (
          <section
            key={column.stage}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const id = Number(event.dataTransfer.getData("text/plain"));
              if (id) move.mutate({ id, stage: column.stage });
            }}
            className="w-72 shrink-0 rounded-xl border border-border bg-muted/30"
          >
            <header className="flex items-center justify-between border-b border-border px-3 py-3">
              <strong className="text-sm">{column.label}</strong>
              <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
                {column.items.length}
              </span>
            </header>
            <div className="max-h-[68vh] space-y-2 overflow-y-auto p-2">
              {column.items.map((item: any) => (
                <article
                  key={item.id}
                  draggable
                  onDragStart={(event) =>
                    event.dataTransfer.setData("text/plain", String(item.id))
                  }
                  className="cursor-grab rounded-lg border border-border bg-card p-3 active:cursor-grabbing"
                >
                  <div className="flex items-start gap-2">
                    <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">
                        {item.customerName}
                      </strong>
                      <p className="mt-1 text-xs text-primary">
                        {item.orderNo}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{item.dueDate || "بدون موعد"}</span>
                    <span>{formatCurrency(item.totalAmount)}</span>
                  </div>
                  <div className="mt-3 flex gap-1">
                    {GRADUATION_STAGES.indexOf(column.stage) > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 flex-1 text-xs"
                        onClick={() =>
                          move.mutate({
                            id: item.id,
                            stage:
                              GRADUATION_STAGES[
                                GRADUATION_STAGES.indexOf(column.stage) - 1
                              ],
                          })
                        }
                      >
                        السابق
                      </Button>
                    ) : null}
                    {GRADUATION_STAGES.indexOf(column.stage) <
                    GRADUATION_STAGES.length - 1 ? (
                      <Button
                        size="sm"
                        className="h-7 flex-1 text-xs"
                        onClick={() =>
                          move.mutate({
                            id: item.id,
                            stage:
                              GRADUATION_STAGES[
                                GRADUATION_STAGES.indexOf(column.stage) + 1
                              ],
                          })
                        }
                      >
                        التالي
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Customers() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "graduation", "customers"],
    queryFn: () => adminFetch<any>("/admin/graduation/customers"),
  });
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {isLoading ? (
        Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36" />
        ))
      ) : data?.items?.length ? (
        data.items.map((item: any) => (
          <Card key={`${item.customerId}-${item.phone}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <UserRound className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <strong className="block truncate">{item.name}</strong>
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {item.phone}
                  </span>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <Info label="الطلبات" value={item.orders} />
                <Info label="الإجمالي" value={formatCurrency(item.total)} />
                <Info label="المتبقي" value={formatCurrency(item.remaining)} />
              </div>
            </CardContent>
          </Card>
        ))
      ) : (
        <div className="col-span-full py-24 text-center text-muted-foreground">
          لا يوجد عملاء تخرج بعد
        </div>
      )}
    </div>
  );
}

type ResourceType = "fabric_roll" | "sewing_machine" | "heat_press";
function Resources({ type }: { type: ResourceType }) {
  const labels = {
    fabric_roll: "لفات القماش",
    sewing_machine: "مكائن الخياطة",
    heat_press: "مكابس الطباعة",
  };
  const { toast } = useToast();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    name: "",
    code: "",
    status: "available",
    operatorName: "",
    metrics: {},
  });
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "graduation", "resources", type],
    queryFn: () => adminFetch<any>(`/admin/graduation/resources?type=${type}`),
  });
  const save = useMutation({
    mutationFn: () =>
      adminFetch("/admin/graduation/resources", {
        method: "POST",
        body: JSON.stringify({ ...form, resourceType: type }),
      }),
    onSuccess: () => {
      setOpen(false);
      setForm({
        name: "",
        code: "",
        status: "available",
        operatorName: "",
        metrics: {},
      });
      client.invalidateQueries({
        queryKey: ["admin", "graduation", "resources"],
      });
      toast({ title: "تم حفظ مورد الإنتاج" });
    },
    onError: (error) =>
      toast({
        title: "تعذر الحفظ",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="ml-2 h-4 w-4" />
          إضافة
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : data?.items?.length ? (
          data.items.map((item: any) => (
            <Card key={item.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <strong>{item.name}</strong>
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${item.status === "available" ? "bg-status-success/10 text-status-success" : "bg-status-warning/10 text-status-warning"}`}
                  >
                    {item.status === "available" ? "متاح" : item.status}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Info label="الكود" value={item.code} />
                  <Info
                    label="المشغل"
                    value={item.operatorName || "غير معين"}
                  />
                  <Info label="مرات الاستخدام" value={item.usageCount} />
                  <Info
                    label="الصيانة"
                    value={
                      item.maintenanceDueAt
                        ? new Date(item.maintenanceDueAt).toLocaleDateString(
                            "ar-IQ",
                          )
                        : "غير محدد"
                    }
                  />
                </div>
                {type === "fabric_roll" ? (
                  <div className="mt-4">
                    <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                      <span>المتبقي</span>
                      <span>{item.metrics?.remainingMeters ?? 0} م</span>
                    </div>
                    <Progress
                      value={
                        item.metrics?.totalMeters
                          ? (Number(item.metrics.remainingMeters || 0) /
                              Number(item.metrics.totalMeters)) *
                            100
                          : 0
                      }
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="col-span-full py-20 text-center text-muted-foreground">
            لم تُضف {labels[type]} بعد
          </div>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة {labels[type]}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>الاسم</Label>
              <Input
                className="mt-2"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>الكود / QR</Label>
              <Input
                className="mt-2"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </div>
            <div>
              <Label>المشغل</Label>
              <Input
                className="mt-2"
                value={form.operatorName}
                onChange={(e) =>
                  setForm({ ...form, operatorName: e.target.value })
                }
              />
            </div>
            <div>
              <Label>موعد الصيانة</Label>
              <Input
                type="datetime-local"
                className="mt-2"
                value={form.maintenanceDueAt || ""}
                onChange={(e) =>
                  setForm({ ...form, maintenanceDueAt: e.target.value })
                }
              />
            </div>
            {type === "fabric_roll" ? (
              <>
                <div>
                  <Label>إجمالي الأمتار</Label>
                  <Input
                    className="mt-2"
                    inputMode="decimal"
                    onChange={(e) =>
                      setForm({
                        ...form,
                        metrics: {
                          ...form.metrics,
                          totalMeters: Number(e.target.value),
                          remainingMeters: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>عدد الأرواب المنتجة</Label>
                  <Input
                    className="mt-2"
                    inputMode="numeric"
                    onChange={(e) =>
                      setForm({
                        ...form,
                        metrics: {
                          ...form.metrics,
                          gownsProduced: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
              </>
            ) : type === "heat_press" ? (
              <>
                <div>
                  <Label>الحرارة</Label>
                  <Input
                    className="mt-2"
                    inputMode="numeric"
                    onChange={(e) =>
                      setForm({
                        ...form,
                        metrics: {
                          ...form.metrics,
                          temperature: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>الوقت بالثواني</Label>
                  <Input
                    className="mt-2"
                    inputMode="numeric"
                    onChange={(e) =>
                      setForm({
                        ...form,
                        metrics: {
                          ...form.metrics,
                          seconds: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter className="sm:justify-start">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="ml-2 h-4 w-4" />
              )}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Reports() {
  const reportRef = useRef<HTMLDivElement>(null);
  const [from, setFrom] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .slice(0, 10),
  );
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [pdf, setPdf] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "graduation", "reports", from, to],
    queryFn: () =>
      adminFetch<any>(`/admin/graduation/reports?from=${from}&to=${to}`),
  });
  function csv() {
    if (!data?.items?.length) return;
    const header = [
      "رقم الطلب",
      "الزبون",
      "الحالة",
      "المرحلة",
      "الإجمالي",
      "المدفوع",
      "المتبقي",
      "التاريخ",
    ];
    const lines: Array<Array<string | number>> = data.items.map((row: any) => [
      row.orderNo,
      row.customerName,
      row.status,
      row.stageLabel,
      row.totalAmount,
      row.paidAmount,
      row.remainingAmount,
      new Date(row.createdAt).toLocaleDateString("en-CA"),
    ]);
    const blob = new Blob(
      [
        "\uFEFF" +
          [header, ...lines]
            .map((line) =>
              line
                .map(
                  (cell: string | number) =>
                    `"${String(cell).replace(/"/g, '""')}"`,
                )
                .join(","),
            )
            .join("\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `graduation-report-${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  async function exportPdf() {
    if (!reportRef.current) return;
    setPdf(true);
    try {
      await downloadElementPdf(
        reportRef.current,
        `graduation-report-${from}-${to}.pdf`,
        { margin: 8 },
      );
    } finally {
      setPdf(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>من</Label>
          <Input
            type="date"
            className="mt-2"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <Label>إلى</Label>
          <Input
            type="date"
            className="mt-2"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="ml-2 h-4 w-4" />
          طباعة
        </Button>
        <Button variant="outline" onClick={exportPdf} disabled={pdf}>
          <Download className="ml-2 h-4 w-4" />
          PDF
        </Button>
        <Button variant="outline" onClick={csv}>
          <FileSpreadsheet className="ml-2 h-4 w-4" />
          Excel / CSV
        </Button>
      </div>
      <div ref={reportRef} className="space-y-4 bg-background p-1">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric
            label="الطلبات"
            value={data?.totals?.orders ?? 0}
            icon={GraduationCap}
          />
          <Metric
            label="الإيرادات"
            value={formatCurrency(data?.totals?.revenue)}
            icon={CircleDollarSign}
          />
          <Metric
            label="المستلم"
            value={formatCurrency(data?.totals?.paid)}
            icon={CircleDollarSign}
            tone="success"
          />
          <Metric
            label="المتبقي"
            value={formatCurrency(data?.totals?.remaining)}
            icon={CalendarClock}
            tone="warning"
          />
          <Metric
            label="استهلاك القماش"
            value={`${data?.totals?.fabricMeters ?? 0} م`}
            icon={Layers3}
          />
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الطلب</TableHead>
                <TableHead>الزبون</TableHead>
                <TableHead>المرحلة</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الإجمالي</TableHead>
                <TableHead>المدفوع</TableHead>
                <TableHead>المتبقي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-28" />
                  </TableCell>
                </TableRow>
              ) : (
                data?.items?.map((row: any) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.orderNo}</TableCell>
                    <TableCell>{row.customerName}</TableCell>
                    <TableCell>{row.stageLabel}</TableCell>
                    <TableCell>{row.styleKey}</TableCell>
                    <TableCell>{formatCurrency(row.totalAmount)}</TableCell>
                    <TableCell>{formatCurrency(row.paidAmount)}</TableCell>
                    <TableCell>{formatCurrency(row.remainingAmount)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function Settings() {
  const { toast } = useToast();
  const client = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "graduation", "settings"],
    queryFn: () => adminFetch<any>("/admin/graduation/settings"),
  });
  const [draft, setDraft] = useState<GraduationConfig | null>(null);
  const config = draft ?? data?.config;
  const save = useMutation({
    mutationFn: () =>
      adminFetch("/admin/graduation/settings", {
        method: "PUT",
        body: JSON.stringify({ config }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin", "graduation"] });
      setDraft(null);
      toast({ title: "تم حفظ إعدادات التخرج" });
    },
    onError: (error) =>
      toast({
        title: "تعذر الحفظ",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  if (isLoading || !config) return <Skeleton className="h-[600px]" />;
  function changeList(
    key: "styles" | "fabrics" | "accessories" | "packages",
    next: any[],
  ) {
    setDraft({ ...config, [key]: next });
  }
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || !draft}
        >
          {save.isPending ? (
            <Loader2 className="ml-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="ml-2 h-4 w-4" />
          )}
          حفظ الإعدادات
        </Button>
      </div>
      <Tabs defaultValue="styles">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="styles">الأنواع</TabsTrigger>
          <TabsTrigger value="fabrics">الأقمشة</TabsTrigger>
          <TabsTrigger value="accessories">الإكسسوارات</TabsTrigger>
          <TabsTrigger value="packages">الباقات</TabsTrigger>
          <TabsTrigger value="prices">الطباعة والتطريز</TabsTrigger>
          <TabsTrigger value="universities">الجامعات</TabsTrigger>
        </TabsList>
        {(["styles", "fabrics", "accessories", "packages"] as const).map(
          (key) => (
            <TabsContent key={key} value={key}>
              <ConfigList
                items={config[key] as GraduationOption[]}
                onChange={(items) => changeList(key, items)}
              />
            </TabsContent>
          ),
        )}
        <TabsContent value="prices">
          <div className="grid gap-5 lg:grid-cols-2">
            <PriceGrid
              title="أسعار الطباعة"
              value={config.printingPrices}
              onChange={(value) =>
                setDraft({ ...config, printingPrices: value })
              }
            />
            <PriceGrid
              title="أسعار التطريز"
              value={config.embroideryPrices}
              onChange={(value) =>
                setDraft({ ...config, embroideryPrices: value })
              }
            />
          </div>
        </TabsContent>
        <TabsContent value="universities">
          <UniversityList
            config={config}
            onChange={(universities) => setDraft({ ...config, universities })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConfigList({
  items,
  onChange,
}: {
  items: GraduationOption[];
  onChange: (items: GraduationOption[]) => void;
}) {
  async function image(index: number, file: File) {
    const value = await processImageFile(file, {
      maxSize: 1600,
      quality: 0.84,
    });
    onChange(
      items.map((row, i) => (i === index ? { ...row, imageUrl: value } : row)),
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          onClick={() =>
            onChange([
              ...items,
              {
                key: `item-${Date.now()}`,
                name: "",
                price: 0,
                cost: 0,
                isActive: true,
              },
            ])
          }
        >
          <Plus className="ml-2 h-4 w-4" />
          إضافة عنصر
        </Button>
      </div>
      {items.map((item, index) => (
        <div
          key={item.key}
          className="grid items-end gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-[1fr_130px_130px_1fr_auto_auto]"
        >
          <div>
            <Label>الاسم</Label>
            <Input
              className="mt-2"
              value={item.name}
              onChange={(e) =>
                onChange(
                  items.map((row, i) =>
                    i === index ? { ...row, name: e.target.value } : row,
                  ),
                )
              }
            />
          </div>
          <div>
            <Label>السعر</Label>
            <Input
              className="mt-2"
              inputMode="numeric"
              value={item.price}
              onChange={(e) =>
                onChange(
                  items.map((row, i) =>
                    i === index
                      ? { ...row, price: Number(e.target.value) }
                      : row,
                  ),
                )
              }
            />
          </div>
          <div>
            <Label>التكلفة</Label>
            <Input
              className="mt-2"
              inputMode="numeric"
              value={item.cost || 0}
              onChange={(e) =>
                onChange(
                  items.map((row, i) =>
                    i === index
                      ? { ...row, cost: Number(e.target.value) }
                      : row,
                  ),
                )
              }
            />
          </div>
          <div>
            <Label>الصورة</Label>
            <div className="mt-2 flex gap-2">
              <Input
                value={
                  item.imageUrl?.startsWith("data:")
                    ? "صورة جاهزة للرفع"
                    : item.imageUrl || ""
                }
                onChange={(e) =>
                  onChange(
                    items.map((row, i) =>
                      i === index ? { ...row, imageUrl: e.target.value } : row,
                    ),
                  )
                }
              />
              <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md border border-input bg-background">
                <Upload className="h-4 w-4" />
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) =>
                    event.target.files?.[0] &&
                    image(index, event.target.files[0])
                  }
                />
              </label>
            </div>
          </div>
          <label className="flex h-10 items-center gap-2">
            <Checkbox
              checked={item.isActive !== false}
              onCheckedChange={(checked) =>
                onChange(
                  items.map((row, i) =>
                    i === index ? { ...row, isActive: checked === true } : row,
                  ),
                )
              }
            />
            ظاهر
          </label>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function PriceGrid({
  title,
  value,
  onChange,
}: {
  title: string;
  value: Record<string, number>;
  onChange: (value: Record<string, number>) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-bold">{title}</h2>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[
          ["front", "الأمام"],
          ["back", "الخلف"],
          ["sleeve", "الكم"],
          ["sash", "الوشاح"],
        ].map(([key, label]) => (
          <div key={key}>
            <Label>{label}</Label>
            <Input
              className="mt-2"
              inputMode="numeric"
              value={value[key] || 0}
              onChange={(e) =>
                onChange({ ...value, [key]: Number(e.target.value) })
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function UniversityList({
  config,
  onChange,
}: {
  config: GraduationConfig;
  onChange: (items: GraduationConfig["universities"]) => void;
}) {
  const items = config.universities;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          onClick={() =>
            onChange([
              ...items,
              {
                key: `university-${Date.now()}`,
                university: "",
                isActive: true,
              },
            ])
          }
        >
          <Plus className="ml-2 h-4 w-4" />
          إضافة قالب جامعة
        </Button>
      </div>
      {items.map((item, index) => (
        <div
          key={item.key}
          className="grid gap-3 rounded-xl border border-border p-3 md:grid-cols-4"
        >
          <Input
            placeholder="الجامعة"
            value={item.university}
            onChange={(e) =>
              onChange(
                items.map((row, i) =>
                  i === index ? { ...row, university: e.target.value } : row,
                ),
              )
            }
          />
          <Input
            placeholder="الكلية"
            value={item.college || ""}
            onChange={(e) =>
              onChange(
                items.map((row, i) =>
                  i === index ? { ...row, college: e.target.value } : row,
                ),
              )
            }
          />
          <Input
            placeholder="القسم"
            value={item.department || ""}
            onChange={(e) =>
              onChange(
                items.map((row, i) =>
                  i === index ? { ...row, department: e.target.value } : row,
                ),
              )
            }
          />
          <div className="flex gap-2">
            <Input
              type="color"
              value={item.sashColor || "#D4B15A"}
              onChange={(e) =>
                onChange(
                  items.map((row, i) =>
                    i === index ? { ...row, sashColor: e.target.value } : row,
                  ),
                )
              }
            />
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GraduationAdminPage() {
  const [location, navigate] = useLocation();
  const mode = currentMode(location);
  const description =
    mode === "dashboard"
      ? "إدارة الطلبات والإنتاج والمخزون والمالية من مسار واحد"
      : undefined;
  const actions =
    mode === "configurator" ? (
      <Button onClick={() => window.open("/graduation", "_blank")}>
        <Eye className="ml-2 h-4 w-4" />
        فتح المُعدّ
      </Button>
    ) : null;
  return (
    <div className="space-y-5" dir="rtl" style={GRADUATION_THEME_STYLE}>
      <PageHeader
        title={MODE_LABELS[mode]}
        description={description}
        actions={actions}
      />
      {mode === "dashboard" ? (
        <DashboardWithGroups />
      ) : mode === "orders" ? (
        <Orders />
      ) : mode === "customers" ? (
        <Customers />
      ) : mode === "configurator" ? (
        <section className="rounded-xl border border-border bg-card p-8 text-center">
          <GraduationCap className="mx-auto h-12 w-12 text-primary" />
          <h2 className="mt-4 text-xl font-bold">مُعدّ تصميم التخرج للزبون</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            تدار الأنواع والأقمشة والألوان والأسعار من الإعدادات، ويستخدمها
            المُعدّ العام مباشرة.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={() => window.open("/graduation", "_blank")}>
              فتح المُعدّ
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/admin/graduation/settings")}
            >
              الإعدادات
            </Button>
          </div>
        </section>
      ) : mode === "measurements" ? (
        <Orders measurementOnly />
      ) : mode === "production" ? (
        <Production />
      ) : mode === "tailoring" ? (
        <Production focus="tailoring" />
      ) : mode === "printing" ? (
        <div className="space-y-5">
          <Production focus="printing" />
          <Resources type="heat_press" />
        </div>
      ) : mode === "embroidery" ? (
        <Production focus="embroidery" />
      ) : mode === "delivery" ? (
        <Orders deliveryOnly />
      ) : mode === "reports" ? (
        <Reports />
      ) : mode === "settings" ? (
        <div className="space-y-6">
          <Settings />
          <Resources type="fabric_roll" />
          <Resources type="sewing_machine" />
        </div>
      ) : null}
    </div>
  );
}
