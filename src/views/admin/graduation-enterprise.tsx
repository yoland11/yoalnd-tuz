import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Expand,
  GraduationCap,
  Loader2,
  PackageCheck,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Save,
  ScanLine,
  Truck,
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
import { GRADUATION_STAGE_LABELS } from "@/lib/graduation";
import { adminFetch, apiErrorMessage } from "./_lib";
import {
  openGraduationLabelPrintWindow,
  openGraduationProductionSheet,
} from "./print-helpers";

const enterprisePath = "/admin/graduation/enterprise";

const componentLabels: Record<string, string> = {
  robe: "الروب",
  sash: "الوشاح",
  cap: "القبعة",
  accessory: "الإكسسوارات",
  kit: "حقيبة الطالب",
};

const productionSheetLabels: Record<string, string> = {
  cutting: "القص",
  sewing: "الخياطة",
  printing: "الطباعة",
  embroidery: "التطريز",
  quality_control: "فحص الجودة",
  packaging: "التغليف",
  delivery: "التسليم",
};

const stageLabels: Record<string, string> = {
  ...GRADUATION_STAGE_LABELS,
  incomplete_data: "بيانات غير مكتملة",
  awaiting_measurements: "بانتظار المقاسات",
  awaiting_design: "بانتظار التصميم",
  awaiting_approval: "بانتظار الموافقة",
  approved: "معتمد",
  awaiting_packaging: "بانتظار التغليف",
  completed: "مكتمل",
  cancelled: "ملغي",
};

function statusBadge(value: string) {
  const success = ["packed", "ready_for_delivery", "delivered", "ready", "completed"].includes(value);
  const warning = ["partial", "pending", "awaiting_packaging", "packaging"].includes(value);
  return <Badge variant={success ? "default" : warning ? "secondary" : "outline"}>{value}</Badge>;
}

type Catalog = {
  templates: any[];
  robeTemplates: any[];
  sashTemplates: any[];
  capTemplates: any[];
  packages: any[];
  universities: any[];
  colorCombinations: any[];
};

const emptyPackage = {
  name: "",
  code: "",
  description: "",
  previewImageUrl: "",
  defaultPrice: 0,
  defaultCost: 0,
  discountAmount: 0,
  productionDays: 7,
  robeTemplateId: "",
  sashTemplateId: "",
  capTemplateId: "none",
  isActive: true,
  isFeatured: false,
  sortOrder: 0,
};

export function GraduationPackagesCenter() {
  const { toast } = useToast();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyPackage);
  const { data, isLoading } = useQuery<Catalog>({
    queryKey: ["admin", "graduation", "enterprise", "packages"],
    queryFn: () => adminFetch(`${enterprisePath}/packages`),
  });
  const save = useMutation({
    mutationFn: () => {
      const templateById = new Map((data?.templates || []).map((item) => [String(item.id), item]));
      const item = (itemType: string, templateId: string, required: boolean) => {
        const template = templateById.get(templateId);
        return templateId && templateId !== "none" && template
          ? { itemType, templateId: Number(templateId), code: template.code, name: template.name, quantity: 1, unitPrice: Number(template.defaultPrice || 0), isRequired: required, configuration: template.configuration || {} }
          : null;
      };
      const items = [item("robe", form.robeTemplateId, true), item("sash", form.sashTemplateId, true), item("cap", form.capTemplateId, false)].filter(Boolean);
      return adminFetch(`${enterprisePath}/packages${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({ ...form, code: form.code || undefined, items }),
      });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin", "graduation", "enterprise", "packages"] });
      setOpen(false);
      setEditingId(null);
      setForm(emptyPackage);
      toast({ title: "تم حفظ باقة التخرج" });
    },
    onError: (err) => toast({ title: "تعذر حفظ الباقة", description: apiErrorMessage(err), variant: "destructive" }),
  });
  function edit(item: any) {
    const byType = new Map((item.items || []).map((row: any) => [row.itemType, row]));
    setEditingId(item.id);
    setForm({
      ...emptyPackage,
      ...item,
      defaultPrice: Number(item.defaultPrice || 0),
      defaultCost: Number(item.defaultCost || 0),
      discountAmount: Number(item.discountAmount || 0),
      robeTemplateId: String((byType.get("robe") as any)?.templateId || ""),
      sashTemplateId: String((byType.get("sash") as any)?.templateId || ""),
      capTemplateId: String((byType.get("cap") as any)?.templateId || "none"),
    });
    setOpen(true);
  }
  const templates = (type: "robe" | "sash" | "cap") => data?.templates.filter((item) => item.templateType === type) || [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-bold">الباقات الجاهزة</h2><p className="mt-1 text-sm text-muted-foreground">تجمع نموذج الروب والوشاح والقبعة والإضافات في إعداد قابل لإعادة الاستخدام.</p></div>
        <Button onClick={() => { setEditingId(null); setForm(emptyPackage); setOpen(true); }}><Plus className="ml-2 h-4 w-4" />إنشاء باقة جديدة</Button>
      </div>
      {isLoading ? <Skeleton className="h-72" /> : data?.packages.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.packages.map((item) => <Card key={item.id} className="overflow-hidden"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{item.name}</h3><p className="mt-1 font-mono text-xs text-muted-foreground">{item.code}</p></div><div className="flex gap-1">{item.isFeatured ? <Badge>مميزة</Badge> : null}{!item.isActive ? <Badge variant="secondary">مخفية</Badge> : null}</div></div><p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{item.description || "بدون وصف"}</p><div className="mt-4 flex flex-wrap gap-1">{item.items.map((row: any) => <Badge key={row.id} variant="outline">{componentLabels[row.itemType] || row.name}</Badge>)}</div><div className="mt-4 flex items-center justify-between"><strong>{formatCurrency(item.defaultPrice)}</strong><Button variant="outline" size="sm" onClick={() => edit(item)}>تعديل</Button></div></CardContent></Card>)}
        </div>
      ) : <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">لم تُنشأ باقات مؤسسية بعد. الباقات الحالية في صفحة العميل محفوظة ولن تتأثر.</div>}
      <Dialog open={open} onOpenChange={setOpen}><DialogContent dir="rtl" className="max-h-[92dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{editingId ? "تعديل الباقة" : "إنشاء باقة جديدة"}</DialogTitle></DialogHeader><div className="grid gap-4 sm:grid-cols-2">
        <div><Label>اسم الباقة</Label><Input className="mt-2" value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} /></div>
        <div><Label>الكود</Label><Input className="mt-2" value={form.code} onChange={(e) => setForm((c) => ({ ...c, code: e.target.value }))} placeholder="يُولّد تلقائياً" /></div>
        <div className="sm:col-span-2"><Label>الوصف</Label><Textarea className="mt-2" value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} /></div>
        {(["robe", "sash", "cap"] as const).map((type) => <div key={type}><Label>{componentLabels[type]}</Label><Select value={(form as any)[`${type}TemplateId`]} onValueChange={(value) => setForm((c) => ({ ...c, [`${type}TemplateId`]: value }))}><SelectTrigger className="mt-2"><SelectValue placeholder={`اختر ${componentLabels[type]}`} /></SelectTrigger><SelectContent>{type === "cap" ? <SelectItem value="none">بدون قبعة</SelectItem> : null}{templates(type).map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name} · {formatCurrency(item.defaultPrice)}</SelectItem>)}</SelectContent></Select></div>)}
        <div><Label>السعر</Label><Input className="mt-2" type="number" value={form.defaultPrice} onChange={(e) => setForm((c) => ({ ...c, defaultPrice: Number(e.target.value) }))} /></div>
        <div><Label>الكلفة</Label><Input className="mt-2" type="number" value={form.defaultCost} onChange={(e) => setForm((c) => ({ ...c, defaultCost: Number(e.target.value) }))} /></div>
        <div><Label>الخصم</Label><Input className="mt-2" type="number" value={form.discountAmount} onChange={(e) => setForm((c) => ({ ...c, discountAmount: Number(e.target.value) }))} /></div>
        <div><Label>أيام الإنتاج</Label><Input className="mt-2" type="number" min={1} value={form.productionDays} onChange={(e) => setForm((c) => ({ ...c, productionDays: Number(e.target.value) }))} /></div>
        <label className="flex items-center gap-2"><Checkbox checked={form.isActive} onCheckedChange={(v) => setForm((c) => ({ ...c, isActive: v === true }))} />نشطة</label>
        <label className="flex items-center gap-2"><Checkbox checked={form.isFeatured} onCheckedChange={(v) => setForm((c) => ({ ...c, isFeatured: v === true }))} />مميزة</label>
      </div><DialogFooter className="sm:justify-start"><Button disabled={save.isPending || !form.name.trim() || !form.robeTemplateId || !form.sashTemplateId} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />}حفظ الباقة</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

export function GraduationPackagingStation() {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [state, setState] = useState<any>(null);
  const queue = useQuery<any>({ queryKey: ["admin", "graduation", "packaging", "queue"], queryFn: () => adminFetch(`${enterprisePath}/packaging`), refetchInterval: 30_000 });
  const scan = useMutation<any, Error, boolean>({
    mutationFn: (complete) => adminFetch<any>(`${enterprisePath}/packaging/scan`, { method: "POST", body: JSON.stringify({ code: complete ? state?.kit?.kitCode : code, studentCode: state?.order?.studentCode, complete }) }),
    onSuccess: (result) => { setState(result); setCode(""); queue.refetch(); toast({ title: result.mode === "student" ? "تم فتح حقيبة الطالب" : "تم قبول الرمز ومطابقة القطعة" }); },
    onError: (err) => toast({ title: "تعذر قبول المسح", description: apiErrorMessage(err), variant: "destructive" }),
  });
  async function printLabel(component: any) {
    const qrDataUrl = await QRCode.toDataURL(component.componentCode || state.kit.kitCode, { width: 320, margin: 1 });
    openGraduationLabelPrintWindow({ qrDataUrl, studentName: state.order.studentName, studentCode: component.componentCode || state.kit.kitCode, itemType: componentLabels[component.componentType] || "حقيبة الطالب", size: component.size, color: component.color, paperSize: "40x30" });
  }
  return <div className="space-y-5">
    <section className="rounded-xl border border-border bg-card p-4"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><ScanLine className="h-5 w-5" /></span><div><h2 className="font-bold">محطة التحقق والتغليف</h2><p className="mt-1 text-sm text-muted-foreground">ابدأ بمسح كود الطالب، ثم امسح كل قطعة وحقيبة التخرج.</p></div></div><form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) scan.mutate(false); }}><Input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder={state ? "امسح QR أو باركود القطعة التالية" : "امسح كود الطالب أو QR"} /><Button disabled={scan.isPending || !code.trim()} type="submit">{scan.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <QrCode className="ml-2 h-4 w-4" />}تحقق</Button>{state ? <Button type="button" variant="outline" onClick={() => setState(null)}>طالب آخر</Button> : null}</form></section>
    {state ? <section className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold">{state.order.studentName}</h3><p className="font-mono text-xs text-primary">{state.order.studentCode}</p></div>{statusBadge(state.kit.status)}</div><div className="mt-4"><div className="mb-2 flex justify-between text-sm"><span>اكتمال الحقيبة</span><strong>{state.progress.packed}/{state.progress.required}</strong></div><Progress value={state.progress.percentage} /></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{state.components.map((component: any) => <div key={component.id} className="rounded-lg border border-border p-3"><div className="flex items-center justify-between"><strong className="text-sm">{componentLabels[component.componentType] || component.componentType}</strong>{component.packagingStatus === "packed" ? <CheckCircle2 className="h-5 w-5 text-status-success" /> : <AlertTriangle className="h-5 w-5 text-status-warning" />}</div><p className="mt-2 font-mono text-[10px] text-muted-foreground">{component.componentCode}</p><Button className="mt-3 w-full" size="sm" variant="outline" onClick={() => printLabel(component)}><Printer className="ml-2 h-4 w-4" />طباعة الملصق</Button></div>)}</div><div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={() => printLabel({ componentType: "kit" })}><Printer className="ml-2 h-4 w-4" />ملصق الحقيبة</Button><Button disabled={state.progress.missing.length > 0 || scan.isPending} onClick={() => scan.mutate(true)}><PackageCheck className="ml-2 h-4 w-4" />إكمال التغليف</Button></div>{state.sheets?.length ? <div className="mt-4 border-t border-border pt-4"><p className="mb-2 text-sm font-bold">ملفات العمل</p><div className="flex flex-wrap gap-2">{state.sheets.map((sheet: any) => <Button key={sheet.id} size="sm" variant="outline" onClick={() => openGraduationProductionSheet({ sheetType: sheet.sheetType, studentName: state.order.studentName, studentCode: state.order.studentCode, orderNo: state.order.orderNo, snapshot: sheet.snapshot })}><Printer className="ml-2 h-4 w-4" />{productionSheetLabels[sheet.sheetType] || sheet.sheetType}</Button>)}</div></div> : null}{state.progress.missing.length ? <p className="mt-3 text-sm text-destructive">القطع الناقصة: {state.progress.missing.map((item: string) => componentLabels[item] || item).join("، ")}</p> : null}</section> : null}
    <section className="rounded-xl border border-border bg-card p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-bold">طابور التغليف</h3><Button size="sm" variant="ghost" onClick={() => queue.refetch()}><RefreshCw className="h-4 w-4" /></Button></div>{queue.isLoading ? <Skeleton className="h-32" /> : queue.data?.items?.length ? <div className="space-y-2">{queue.data.items.slice(0, 30).map((item: any) => <button key={item.order.id} className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-right hover:bg-muted" onClick={() => { setCode(item.order.studentCode); }}><div><strong className="text-sm">{item.order.studentName}</strong><p className="font-mono text-xs text-muted-foreground">{item.order.studentCode}</p></div><span className="text-xs">{item.progress.percentage}%</span></button>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">لا توجد حقائب بانتظار التغليف.</p>}</section>
  </div>;
}

export function GraduationProductionWall() {
  const { data, isLoading, refetch } = useQuery<any>({ queryKey: ["admin", "graduation", "production-wall"], queryFn: () => adminFetch(`${enterprisePath}/production-wall`), refetchInterval: 15_000 });
  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const item of data?.items || []) map.set(item.stage, [...(map.get(item.stage) || []), item]);
    return map;
  }, [data]);
  if (isLoading) return <Skeleton className="h-[70dvh]" />;
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2"><Badge variant="outline">الإجمالي {data?.total || 0}</Badge><Badge variant={data?.late ? "destructive" : "secondary"}>المتأخر {data?.late || 0}</Badge></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="ml-2 h-4 w-4" />تحديث</Button><Button size="sm" variant="outline" onClick={() => document.documentElement.requestFullscreen?.()}><Expand className="ml-2 h-4 w-4" />ملء الشاشة</Button></div></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[...grouped.entries()].map(([stage, items]) => <section key={stage} className="rounded-xl border border-border bg-card"><header className="flex items-center justify-between border-b border-border p-3"><strong>{stageLabels[stage] || stage}</strong><Badge>{items.length}</Badge></header><div className="max-h-[58dvh] space-y-2 overflow-y-auto p-3">{items.map((item) => <div key={item.id} className="rounded-lg bg-muted p-3"><strong className="text-sm">{item.studentName}</strong><p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.studentCode}</p><p className="mt-2 text-xs text-muted-foreground">{item.dueDate || "بدون موعد"}</p></div>)}</div></section>)}</div></div>;
}

export function GraduationMaterialsCenter() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["admin", "graduation", "enterprise", "materials"], queryFn: () => adminFetch(`${enterprisePath}/materials`) });
  if (isLoading) return <Skeleton className="h-72" />;
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">المواد</p><strong className="text-xl">{data?.summary?.materials || 0}</strong></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">الإجمالي المطلوب</p><strong className="text-xl">{data?.summary?.required || 0}</strong></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">حالات النقص</p><strong className={data?.summary?.shortages ? "text-xl text-destructive" : "text-xl text-status-success"}>{data?.summary?.shortages || 0}</strong></CardContent></Card></div><div className="overflow-x-auto rounded-xl border border-border bg-card"><Table><TableHeader><TableRow><TableHead>المادة</TableHead><TableHead>الوحدة</TableHead><TableHead>المطلوب</TableHead><TableHead>المحجوز</TableHead><TableHead>المستهلك</TableHead><TableHead>المتاح</TableHead><TableHead>النقص</TableHead><TableHead>اقتراح الشراء</TableHead></TableRow></TableHeader><TableBody>{data?.items?.map((item: any) => <TableRow key={item.key}><TableCell className="font-medium">{item.name}</TableCell><TableCell>{item.unit}</TableCell><TableCell>{item.required}</TableCell><TableCell>{item.reserved}</TableCell><TableCell>{item.consumed}</TableCell><TableCell>{item.productId ? item.available : "—"}</TableCell><TableCell className={item.shortage ? "font-bold text-destructive" : "text-status-success"}>{item.shortage}</TableCell><TableCell>{item.purchaseRecommendation}</TableCell></TableRow>)}</TableBody></Table></div></div>;
}

export function GraduationDeliveryScanner() {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const deliver = useMutation({ mutationFn: () => adminFetch(`${enterprisePath}/delivery/confirm`, { method: "POST", body: JSON.stringify({ code, receivedBy, overrideReason: overrideReason || undefined }) }), onSuccess: () => { toast({ title: "تم تسليم حقيبة الطالب" }); setCode(""); setReceivedBy(""); setOverrideReason(""); }, onError: (err) => toast({ title: "تعذر تأكيد التسليم", description: apiErrorMessage(err), variant: "destructive" }) });
  return <section className="rounded-xl border border-border bg-card p-4"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Truck className="h-5 w-5" /></span><div><h2 className="font-bold">جلسة تسليم سريعة</h2><p className="mt-1 text-sm text-muted-foreground">يتحقق النظام من حقيبة الطالب والمبلغ المتبقي قبل التسليم.</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-3"><div><Label>QR الطالب أو الحقيبة</Label><Input className="mt-2" value={code} onChange={(e) => setCode(e.target.value)} /></div><div><Label>اسم المستلم</Label><Input className="mt-2" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} /></div><div><Label>سبب التجاوز إن وجد</Label><Input className="mt-2" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} /></div></div><Button className="mt-4" disabled={deliver.isPending || !code.trim() || !receivedBy.trim()} onClick={() => deliver.mutate()}>{deliver.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="ml-2 h-4 w-4" />}تأكيد التسليم</Button></section>;
}
