import React, { type ReactNode } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Hourglass,
  RefreshCw,
  Wallet,
  CircleDollarSign,
  Receipt,
  CalendarClock,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RESEARCH_CATEGORIES,
  RESEARCH_WORKFLOW_STAGES,
} from "@/lib/research-contract";
import { formatCurrency } from "@/lib/money";
import { adminFetch, apiErrorMessage } from "../_lib";
import type { ResearchFilters } from "./ui-model";

export const researchFetch = <T,>(path: string, init?: RequestInit) =>
  adminFetch<T>(`/admin/research${path}`, init);
export type ResearchRecord = Record<string, any>;
export const RESEARCH_TYPES: Record<string, string> = {
  graduation: "مشروع تخرج",
  diploma: "دبلوم",
  bachelor: "بكالوريوس",
  master: "ماجستير",
  phd: "دكتوراه",
  article: "مقالة",
  conference: "بحث مؤتمر",
  report: "تقرير",
};
export const RESEARCH_STATUSES: Record<string, string> = {
  new: "جديد",
  accepted: "مراجعة المتطلبات",
  searching_sources: "البحث عن المصادر",
  writing: "الكتابة",
  review: "المراجعة",
  formatting: "التنسيق",
  plagiarism_check: "فحص الاستلال",
  completed: "جاهز للتسليم",
  delivered: "مكتمل / تم التسليم",
  archived: "مؤرشف",
};
export const FINANCIAL_STATUSES: Record<string, string> = {
  unpaid: "غير مدفوع",
  partial: "مدفوع جزئياً",
  paid: "مسدد",
  overdue: "متأخر الدفع",
};
export const dateText = (date: any) => (date ? String(date).slice(0, 10) : "—");
export const numberText = (value: any) =>
  value === undefined || value === null
    ? "—"
    : Number(value).toLocaleString("en-US");

export function ResearchFailure({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>تعذر تحميل البيانات</AlertTitle>
      <AlertDescription>
        <span>{apiErrorMessage(error)}</span>
        {retry && (
          <Button variant="outline" size="sm" onClick={retry}>
            <RefreshCw data-icon="inline-start" />
            إعادة المحاولة
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
export function ResearchEmpty({
  title = "لا توجد نتائج مطابقة",
  description = "غيّر عوامل التصفية أو أضف طلب بحث جديداً.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
export function ResearchLoading() {
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
      aria-label="جارٍ تحميل بيانات الأبحاث"
    >
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
  );
}
export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 max-w-full">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {action}
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
export function ResearchMetric({
  label,
  value,
  icon: Icon = BookOpen,
  hint,
}: {
  label: string;
  value: ReactNode;
  icon?: any;
  hint?: string;
}) {
  return (
    <Card data-research-metric={label}>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-3 text-xl font-bold tabular-nums tracking-tight">
            <bdi>{value}</bdi>
          </p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <span className="rounded-lg bg-primary/5 p-2 text-primary">
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  );
}
export function ResearchMetrics({
  summary,
  financial,
}: {
  summary: ResearchRecord;
  financial: boolean;
}) {
  const metrics = [
    ["total", "إجمالي الأبحاث", BookOpen],
    ["newOrders", "أبحاث جديدة", Hourglass],
    ["inProgress", "قيد التنفيذ", Clock3],
    ["awaitingReview", "بانتظار المراجعة", FileCheck2],
    ["ready", "جاهزة للتسليم", CheckCircle2],
    ["completed", "مكتملة / مسلمة", CheckCircle2],
  ] as const;
  const money = [
    ["totalValue", "قيمة الأبحاث", Wallet],
    ["collected", "المبالغ المقبوضة", CircleDollarSign],
    ["remaining", "الذمم المتبقية", Receipt],
    ["overdueDebt", "الديون المتأخرة", CalendarClock],
  ] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      {metrics.map(([key, label, icon]) => (
        <ResearchMetric
          key={key}
          label={label}
          value={numberText(summary[key])}
          icon={icon}
        />
      ))}
      {financial &&
        money.map(([key, label, icon]) => (
          <ResearchMetric
            key={key}
            label={label}
            value={
              summary[key] === undefined ? "—" : formatCurrency(summary[key])
            }
            icon={icon}
          />
        ))}
    </div>
  );
}
export function ResearchStatus({ status }: { status: string }) {
  return (
    <Badge
      variant={
        status === "delivered"
          ? "default"
          : status === "archived"
            ? "outline"
            : "secondary"
      }
    >
      {RESEARCH_STATUSES[status] || status}
    </Badge>
  );
}
export function Choice({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Record<string, string>;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value || "none"}
      onValueChange={(next) => onChange(next === "none" ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="research-dialog">
        <SelectGroup>
          {Object.entries(options).map(([key, name]) => (
            <SelectItem key={key || "none"} value={key || "none"}>
              {name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
export function ResearchField({
  label,
  name,
  error,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      {children}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}
export function ResearchFiltersBar({
  filters,
  onChange,
  financial = false,
  dates = false,
}: {
  filters: ResearchFilters;
  onChange: (patch: Partial<ResearchFilters>) => void;
  financial?: boolean;
  dates?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Input
          aria-label="البحث في الأبحاث"
          placeholder="ابحث بالعنوان، الرقم، الطالب أو الهاتف..."
          value={filters.q || ""}
          onChange={(event) => onChange({ q: event.target.value })}
        />
        <Choice
          label="تصنيف البحث"
          value={filters.category || "all"}
          onChange={(category) => onChange({ category })}
          options={{ all: "كل التصنيفات", ...RESEARCH_CATEGORIES }}
        />
        <Choice
          label="مرحلة العمل"
          value={filters.stage || "all"}
          onChange={(stage) => onChange({ stage })}
          options={{
            all: "كل المراحل",
            ...Object.fromEntries(
              RESEARCH_WORKFLOW_STAGES.map((stage) => [stage.key, stage.label]),
            ),
          }}
        />
        {financial && (
          <Choice
            label="حالة الدفع"
            value={filters.financialStatus || "all"}
            onChange={(financialStatus) => onChange({ financialStatus })}
            options={{ all: "كل حالات الدفع", ...FINANCIAL_STATUSES }}
          />
        )}
      </div>
      {dates && (
        <div className="flex flex-wrap items-end gap-3">
          <ResearchField label="من تاريخ" name="research-from">
            <Input
              id="research-from"
              type="date"
              value={filters.from || ""}
              onChange={(event) => onChange({ from: event.target.value })}
            />
          </ResearchField>
          <ResearchField label="إلى تاريخ" name="research-to">
            <Input
              id="research-to"
              type="date"
              value={filters.to || ""}
              onChange={(event) => onChange({ to: event.target.value })}
            />
          </ResearchField>
        </div>
      )}
    </div>
  );
}
export function ResearchPagination({
  pagination,
  page,
  onPage,
}: {
  pagination: ResearchRecord | undefined;
  page: number;
  onPage: (page: number) => void;
}) {
  if (!pagination) return null;
  const pages =
    Number(
      pagination.totalPages ??
        Math.ceil(
          Number(pagination.total || 0) / Number(pagination.pageSize || 20),
        ),
    ) || 1;
  return (
    <nav
      aria-label="صفحات الأبحاث"
      className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm"
    >
      <span>
        صفحة {page} من {pages} · {numberText(pagination.total)} نتيجة
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          السابق
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          التالي
        </Button>
      </div>
    </nav>
  );
}
