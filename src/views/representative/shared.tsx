import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { adminFetch, apiErrorMessage, formatCurrency } from "@/views/admin/_lib";
import { useToast } from "@/hooks/use-toast";
import { printWhenImagesReadyScript, thermalReceiptCss } from "@/views/admin/print-helpers";
import {
  DELIVERY_PHASE_LABELS,
  PAYMENT_PHASE_LABELS,
  PRODUCTION_PHASE_LABELS,
  STEP_STATE_LABELS,
  type DeliveryPhase,
  type PaymentPhase,
  type ProductionPhase,
  type StepState,
} from "@/lib/graduation-batches";
import type { GraduationConfig } from "@/lib/graduation";

export const repApi = <T,>(path: string, init?: RequestInit) => adminFetch<T>(`/admin/representative${path}`, init);

/** Burgundy brand accents used across the portal. */
export const BRAND = {
  button: "bg-[#7b1e3a] text-white hover:bg-[#66172f]",
  text: "text-[#7b1e3a]",
  soft: "bg-[#fbeff2]",
  border: "border-rose-100 dark:border-slate-800",
  card: "rounded-2xl border border-rose-100 bg-white shadow-[0_4px_16px_rgba(90,20,40,.04)] dark:border-slate-800 dark:bg-slate-900",
};

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("") || "ط";
}

export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] as string);
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = { cash: "نقدي", transfer: "تحويل مصرفي", card: "بطاقة", other: "أخرى" };
export const REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: "بانتظار الاعتماد", processing: "قيد المعالجة", approved: "معتمدة", rejected: "مرفوضة", cancelled: "ملغاة",
};

export function useGraduationConfig() {
  return useQuery({
    queryKey: ["graduation", "config"],
    queryFn: async () => {
      const response = await fetch("/api/graduation/config");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || payload?.error || "تعذر تحميل إعدادات التخرج");
      return payload as GraduationConfig;
    },
    staleTime: 5 * 60_000,
  });
}

/** Arabic option name from the graduation settings, falling back to the stored key. */
export function optionName(list: Array<{ key: string; name: string }> | undefined, key: unknown) {
  const value = String(key ?? "").trim();
  if (!value) return "—";
  return list?.find((item) => item.key === value)?.name || value;
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1">
          {index > 0 ? <ChevronLeft className="h-3.5 w-3.5 opacity-60" /> : null}
          {item.href ? <Link href={item.href} className="rounded px-1 py-0.5 font-medium hover:bg-rose-50 hover:text-[#7b1e3a]">{item.label}</Link>
            : <span className="px-1 font-semibold text-slate-700 dark:text-slate-200" aria-current="page">{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function Metric({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "green" | "brand" | "amber" }) {
  const color = tone === "green" ? "text-emerald-600" : tone === "brand" ? "text-[#7b1e3a]" : tone === "amber" ? "text-amber-600" : "";
  return (
    <Card className={`${BRAND.border} rounded-2xl shadow-[0_4px_16px_rgba(90,20,40,.035)]`}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <strong className={`mt-1 block text-lg tabular-nums ${color}`}>{value}</strong>
        {hint ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}

export function Progress({ label, value, tone = "brand" }: { label: string; value: number; tone?: "brand" | "green" | "sky" }) {
  const bar = tone === "green" ? "bg-emerald-500" : tone === "sky" ? "bg-sky-500" : "bg-[#7b1e3a]";
  return (
    <div>
      <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{label}</span><b className="tabular-nums">{value}%</b></div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-rose-100 dark:bg-slate-800" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

const pill = "inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ring-1";
export function PaymentBadge({ value }: { value: PaymentPhase }) {
  const tone = value === "paid" ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : value === "partial" ? "bg-amber-50 text-amber-700 ring-amber-100" : "bg-rose-50 text-rose-700 ring-rose-100";
  return <span className={`${pill} ${tone}`}>{PAYMENT_PHASE_LABELS[value]}</span>;
}
export function ProductionBadge({ value }: { value: ProductionPhase }) {
  const tone = value === "delivered" || value === "ready" ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : value === "in_production" ? "bg-violet-50 text-violet-700 ring-violet-100" : value === "cancelled" ? "bg-slate-100 text-slate-600 ring-slate-200" : "bg-sky-50 text-sky-700 ring-sky-100";
  return <span className={`${pill} ${tone}`}>{PRODUCTION_PHASE_LABELS[value]}</span>;
}
export function DeliveryBadge({ value }: { value: DeliveryPhase }) {
  const tone = value === "delivered" ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : value === "pending" ? "bg-slate-50 text-slate-600 ring-slate-200" : "bg-sky-50 text-sky-700 ring-sky-100";
  return <span className={`${pill} ${tone}`}>{DELIVERY_PHASE_LABELS[value]}</span>;
}
export function StepBadge({ value }: { value: StepState }) {
  const tone = value === "done" ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : value === "active" ? "bg-amber-50 text-amber-700 ring-amber-100" : value === "na" ? "bg-transparent text-slate-400 ring-slate-100" : "bg-slate-50 text-slate-600 ring-slate-200";
  return <span className={`${pill} ${tone}`}>{STEP_STATE_LABELS[value]}</span>;
}

export function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-rose-200 p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

export function ErrorCard({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <Card className="rounded-2xl border-destructive/30">
      <CardContent role="alert" className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-destructive">
        <span>{apiErrorMessage(error)}</span>
        {retry ? <Button variant="outline" size="sm" onClick={retry}>إعادة المحاولة</Button> : null}
      </CardContent>
    </Card>
  );
}

export type PaymentTarget = { id: number; name: string; studentCode: string; total: number; paid: number; remaining: number };

/** Records a representative payment request; approval and posting stay with the administration. */
export function PaymentDialog({ student, onClose }: { student: PaymentTarget | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ amount: "", paymentMethod: "cash", receiptNumber: "", notes: "" });
  const amount = Number(form.amount);
  const tooMuch = Boolean(student) && amount > (student?.remaining ?? 0);
  const save = useMutation({
    mutationFn: () => repApi("/payments", { method: "POST", body: JSON.stringify({ orderId: student?.id, ...form }) }),
    onSuccess: () => {
      toast({ title: "تم تسجيل الدفعة بانتظار اعتماد الإدارة" });
      void qc.invalidateQueries({ queryKey: ["representative"] });
      setForm({ amount: "", paymentMethod: "cash", receiptNumber: "", notes: "" });
      onClose();
    },
    onError: (error) => toast({ title: "تعذر تسجيل الدفعة", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return (
    <Dialog open={Boolean(student)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle>تسجيل دفعة للطالب</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl border border-rose-100 bg-[#fbeff2]/60 p-3 text-sm">
            <b>{student?.name}</b>
            <p className="text-xs text-muted-foreground">{student?.studentCode}</p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              <span>الإجمالي<b className="block tabular-nums">{formatCurrency(student?.total ?? 0)}</b></span>
              <span>المدفوع<b className="block tabular-nums text-emerald-600">{formatCurrency(student?.paid ?? 0)}</b></span>
              <span>المتبقي<b className="block tabular-nums text-[#7b1e3a]">{formatCurrency(student?.remaining ?? 0)}</b></span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="rep-pay-amount">مبلغ الدفعة</Label><Input id="rep-pay-amount" className="mt-1.5" inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value.replace(/[^0-9.]/g, "") })} placeholder="0" aria-invalid={tooMuch} />{tooMuch ? <p className="mt-1 text-xs text-destructive">المبلغ أكبر من المتبقي على الطالب</p> : null}</div>
            <div><Label>طريقة الدفع</Label><Select value={form.paymentMethod} onValueChange={(paymentMethod) => setForm({ ...form, paymentMethod })}><SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PAYMENT_METHOD_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div><Label htmlFor="rep-pay-ref">المرجع أو رقم الوصل</Label><Input id="rep-pay-ref" className="mt-1.5" value={form.receiptNumber} onChange={(event) => setForm({ ...form, receiptNumber: event.target.value })} /></div>
          <div><Label htmlFor="rep-pay-notes">ملاحظات</Label><Textarea id="rep-pay-notes" className="mt-1.5 min-h-16" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>
          <p className="text-xs text-muted-foreground">تُسجّل الدفعة بانتظار اعتماد الإدارة، ولا تدخل رصيد الطالب أو المجموعة قبل الاعتماد.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button className={BRAND.button} onClick={() => save.mutate()} disabled={!student || !(amount > 0) || tooMuch || save.isPending}>{save.isPending ? "جارٍ الحفظ…" : "تأكيد الدفعة"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Opens an 80mm thermal print window. Throws when the browser blocks the popup. */
export function openThermalPrint(title: string, bodyHtml: string) {
  const popup = window.open("", "_blank", "width=520,height=760");
  if (!popup) throw new Error("تعذر فتح نافذة الطباعة؛ اسمح بالنوافذ المنبثقة");
  popup.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${thermalReceiptCss("80mm")}</style></head><body>${bodyHtml}${printWhenImagesReadyScript()}</body></html>`);
  popup.document.close();
}

export function receiptHeaderHtml(logo: string, subtitle: string, number?: string | null) {
  return `<header class="r-head">${logo ? `<img class="r-logo" src="${escapeHtml(logo)}" alt="AJN">` : ""}<div class="r-company">مجموعة علي جان نهاد</div><div class="r-sub">${escapeHtml(subtitle)}</div>${number ? `<div class="r-sub num">${escapeHtml(number)}</div>` : ""}</header><hr class="rule">`;
}

export function downloadCsv(filename: string, header: string[], lines: Array<Array<unknown>>) {
  const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + [header, ...lines].map((line) => line.map(cell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
