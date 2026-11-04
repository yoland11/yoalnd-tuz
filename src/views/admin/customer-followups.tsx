import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { DateField } from "@/components/ui/date-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { EmployeeSelect } from "@/components/employee-select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatIraqiPhone } from "@/lib/phone";
import {
  FOLLOWUP_SERVICES,
  FOLLOWUP_STATUS_LABELS,
  FOLLOWUP_STATUS_OPTIONS,
  followupDateBucket,
  followupDateTimeToIso,
  followupPhoneHref,
  followupWhatsAppHref,
  formatFollowupDate,
  toFollowupDateTimeInput,
  type FollowupBooking,
  type FollowupCustomer,
  type FollowupEmployee,
  type FollowupList,
  type FollowupRow,
  type FollowupServiceKey,
  type FollowupStatus,
  type FollowupSuggestion,
} from "@/lib/customer-followups";
import { adminFetch, apiErrorMessage } from "./_lib";
import { CustomerQuickAddDialog } from "./customer-quick-add";

type Mode = "admin" | "staff";
type Options = { customers: FollowupCustomer[]; employees: FollowupEmployee[] };
type ActionDialog = {
  row: FollowupRow;
  kind:
    | "complete"
    | "postpone"
    | "stop_contact"
    | "resume_contact"
    | "link_booking";
};
type MutationBody = Record<string, unknown>;
type Attempt = { path: string; body: MutationBody };
const BASE = "/admin/customer-followups";
const serviceLabel = (key: string) =>
  FOLLOWUP_SERVICES.find((service) => service.key === key)?.label ?? key;
const employeeOptions = (employees: FollowupEmployee[]) =>
  employees.map((employee) => ({ ...employee, photoUrl: employee.avatarUrl }));
const dateInputClass =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const statusTone: Record<FollowupStatus, string> = {
  interested: "bg-primary/10 text-primary",
  waiting: "bg-muted text-foreground",
  converted: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  uninterested: "bg-muted text-muted-foreground",
};
const buckets = [
  { key: "today", label: "اليوم", icon: CalendarDays },
  { key: "overdue", label: "المتأخرة", icon: CircleAlert },
  { key: "upcoming", label: "القادمة", icon: CalendarClock },
  { key: "converted", label: "تحولت إلى حجز", icon: Check },
] as const;

function ErrorMessage({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const details = error as {
    requestId?: string;
    data?: { existingBooking?: FollowupBooking };
  };
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <p>{apiErrorMessage(error)}</p>
      {details?.requestId ? (
        <p className="mt-1 text-xs">
          رقم الطلب: <bdi>{details.requestId}</bdi>
        </p>
      ) : null}
      {details?.data?.existingBooking ? (
        <a
          href={details.data.existingBooking.href}
          className="mt-2 inline-block font-medium underline"
        >
          فتح الحجز الموجود {details.data.existingBooking.number}
        </a>
      ) : null}
      {onRetry ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={onRetry}
        >
          إعادة المحاولة
        </Button>
      ) : null}
    </div>
  );
}

function DateState({ row }: { row: FollowupRow }) {
  if (row.contactBlocked)
    return <span className="text-xs text-muted-foreground">التواصل متوقف</span>;
  if (row.completedAt)
    return (
      <span className="text-xs text-emerald-700 dark:text-emerald-300">
        مكتملة
      </span>
    );
  if (row.status === "converted" || row.status === "uninterested") return null;
  const bucket = followupDateBucket(row.followupAt);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        bucket === "overdue" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <Clock3 className="size-3" aria-hidden="true" />
      {bucket === "today" ? "اليوم" : bucket === "overdue" ? "متأخرة" : "قادمة"}
    </span>
  );
}

/** The same scoped screen is mounted in the original admin and staff portals. */
export default function CustomerFollowupsPage({
  mode = "admin",
}: {
  mode?: Mode;
}) {
  const client = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [service, setService] = useState("");
  const [status, setStatus] = useState("");
  const [employee, setEmployee] = useState("");
  const [bucket, setBucket] = useState("");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<FollowupSuggestion | null>(null);
  const [actionDialog, setActionDialog] = useState<ActionDialog | null>(null);
  const [assigning, setAssigning] = useState<FollowupRow | null>(null);
  const [preview, setPreview] = useState<FollowupRow | null>(null);
  const attempts = useRef(new Map<string, Attempt>());
  const scope = mode === "staff" ? "?scope=mine" : "";
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (mode === "staff") params.set("scope", "mine");
  if (query) params.set("q", query);
  if (service) params.set("serviceKey", service);
  if (status) params.set("status", status);
  if (employee && mode === "admin") params.set("employeeId", employee);
  if (bucket) params.set("bucket", bucket);
  const list = useQuery({
    queryKey: ["customer-followups", mode, params.toString()],
    queryFn: () => adminFetch<FollowupList>(`${BASE}?${params}`),
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
  const capabilities = list.data?.capabilities;
  const roster = useQuery({
    queryKey: ["customer-followups-employees", mode],
    queryFn: () =>
      adminFetch<{ employees: FollowupEmployee[] }>(`${BASE}/employees`),
    enabled: mode === "admin" && capabilities?.canManage === true,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (attempt: Attempt) =>
      adminFetch<{ followup: FollowupRow }>(attempt.path, {
        method: "POST",
        body: JSON.stringify(attempt.body),
      }),
    onSuccess: (_data, attempt) => {
      for (const [key, pending] of attempts.current)
        if (pending === attempt) attempts.current.delete(key);
      setAddOpen(false);
      setSuggestion(null);
      setActionDialog(null);
      setAssigning(null);
      void client.invalidateQueries({ queryKey: ["customer-followups"] });
      void client.invalidateQueries({
        queryKey: ["customer-followups-employees"],
      });
      toast({ title: "تم حفظ المتابعة" });
    },
  });
  function submit(path: string, body: MutationBody) {
    if (mutation.isPending || list.isError) return;
    // Retain the exact payload/key after a lost response. Editing a form starts a new attempt.
    const signature = JSON.stringify([path, body]);
    let attempt = attempts.current.get(signature);
    if (!attempt) {
      attempt = {
        path,
        body: { ...body, idempotencyKey: crypto.randomUUID() },
      };
      attempts.current.set(signature, attempt);
    }
    mutation.mutate(attempt);
  }
  function act(row: FollowupRow, action: string, fields: MutationBody = {}) {
    submit(`${BASE}/${row.id}/actions${scope}`, {
      action,
      expectedVersion: row.version,
      ...fields,
    });
  }
  function openAction(row: FollowupRow, kind: ActionDialog["kind"]) {
    mutation.reset();
    setActionDialog({ row, kind });
  }
  function openAdd(selected: FollowupSuggestion | null = null) {
    mutation.reset();
    setSuggestion(selected);
    setAddOpen(true);
  }
  function filter(setter: (value: string) => void, value: string) {
    setter(value === "all" ? "" : value);
    setPage(1);
  }
  const busy = mutation.isPending || list.isFetching;
  const canManage = mode === "admin" && capabilities?.canManage === true;

  function rowActions(row: FollowupRow) {
    const isOpen =
      !row.completedAt &&
      row.status !== "converted" &&
      row.status !== "uninterested" &&
      !row.contactBlocked;
    const phone = followupPhoneHref(row.customer.phone);
    const whatsapp = followupWhatsAppHref(
      row.customer.phone,
      `مرحباً ${row.customer.name}، معك فريق AJN. نتابع معك بخصوص ${serviceLabel(row.serviceKey)}. هل يناسبك التواصل الآن؟`,
    );
    return (
      <div
        className="flex flex-wrap items-center gap-1"
        aria-label={`إجراءات متابعة ${row.customer.name}`}
      >
        {isOpen ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-10 gap-1.5"
            disabled={busy}
            onClick={() => act(row, "complete")}
          >
            <Check className="size-3.5" aria-hidden="true" />
            إكمال
          </Button>
        ) : null}
        {!row.contactBlocked && whatsapp ? (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-10 text-emerald-700 dark:text-emerald-300"
          >
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`واتساب ${row.customer.name}`}
            >
              <MessageCircle className="size-4" />
            </a>
          </Button>
        ) : null}
        {!row.contactBlocked && phone ? (
          <Button asChild variant="ghost" size="icon" className="size-10">
            <a href={phone} aria-label={`اتصال بـ ${row.customer.name}`}>
              <Phone className="size-4" />
            </a>
          </Button>
        ) : null}
        {row.booking ? (
          <a
            className="px-1 text-xs font-medium text-primary underline underline-offset-4"
            href={row.booking.href}
          >
            الحجز {row.booking.number}
          </a>
        ) : isOpen && capabilities?.canBook ? (
          <a
            className="px-1 text-xs font-medium text-primary underline underline-offset-4"
            href={`/admin/bookings?followup=${row.id}`}
          >
            إنشاء حجز
          </a>
        ) : null}
        <DropdownMenu dir="rtl">
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10"
              disabled={busy}
              aria-label={`المزيد لمتابعة ${row.customer.name}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {isOpen ? (
              <>
                <DropdownMenuItem onSelect={() => openAction(row, "postpone")}>
                  تأجيل
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openAction(row, "complete")}>
                  إكمال مع ملاحظة أو موعد تالٍ
                </DropdownMenuItem>
              </>
            ) : null}
            {capabilities?.canOpenCustomer ? (
              <DropdownMenuItem onSelect={() => setPreview(row)}>
                عرض العميل
              </DropdownMenuItem>
            ) : null}
            {canManage ? (
              <DropdownMenuItem
                onSelect={() => {
                  mutation.reset();
                  setAssigning(row);
                }}
              >
                تعيين موظف
              </DropdownMenuItem>
            ) : null}
            {!row.booking && isOpen && capabilities?.canBook ? (
              <DropdownMenuItem
                onSelect={() => openAction(row, "link_booking")}
              >
                ربط حجز موجود
              </DropdownMenuItem>
            ) : null}
            {!row.booking && !row.completedAt && !row.contactBlocked ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                  حالة الاستفسار عن هذه الخدمة
                </DropdownMenuLabel>
                {FOLLOWUP_STATUS_OPTIONS.filter(
                  (option) => option.key !== "converted",
                ).map((option) => (
                  <DropdownMenuItem
                    key={option.key}
                    disabled={row.status === option.key}
                    onSelect={() => act(row, "status", { status: option.key })}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            <DropdownMenuSeparator />
            {row.contactBlocked ? (
              canManage ? (
                <DropdownMenuItem
                  onSelect={() => openAction(row, "resume_contact")}
                >
                  استئناف التواصل مع العميل
                </DropdownMenuItem>
              ) : null
            ) : (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => openAction(row, "stop_contact")}
              >
                إيقاف التواصل مع العميل
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }
  function customerIdentity(row: FollowupRow) {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <EmployeeAvatar
          name={row.customer.name}
          photoUrl={row.customer.avatarUrl}
          size={32}
        />
        <span className="min-w-0">
          <span className="block break-words font-semibold">
            {row.customer.name}
          </span>
          {row.note ? (
            <span
              className="mt-0.5 block max-w-64 truncate text-xs text-muted-foreground"
              title={row.note}
            >
              {row.note}
            </span>
          ) : null}
        </span>
      </div>
    );
  }
  function employeeIdentity(row: FollowupRow) {
    return (
      <span className="flex items-center gap-2">
        <EmployeeAvatar
          name={row.employee.fullName}
          photoUrl={row.employee.avatarUrl}
          size={32}
        />
        <span className="break-words text-xs">{row.employee.fullName}</span>
      </span>
    );
  }
  function inquiryStatus(row: FollowupRow) {
    return (
      <span
        className={cn(
          "inline-flex rounded-md px-2 py-1 text-xs font-medium",
          statusTone[row.status],
        )}
      >
        {FOLLOWUP_STATUS_LABELS[row.status]}
      </span>
    );
  }

  return (
    <div dir="rtl" className="min-w-0 space-y-5" data-followup-mode={mode}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground md:text-2xl">
            متابعة العملاء
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "staff"
              ? "متابعاتك المسندة، ومواعيد التواصل القادمة."
              : "كل استفسار في موعده، من أول تواصل إلى الحجز."}
          </p>
        </div>
        {capabilities?.canCreate && !list.isError ? (
          <Button className="min-h-11 gap-2" onClick={() => openAdd()}>
            <Plus className="size-4" aria-hidden="true" />
            إضافة متابعة
          </Button>
        ) : null}
      </header>
      {list.isLoading ? (
        <div
          aria-busy="true"
          aria-label="جارٍ تحميل المتابعات"
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {buckets.map(({ key }) => (
              <Skeleton key={key} className="h-20 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : list.isError ? (
        <ErrorMessage
          error={list.error}
          onRetry={() => {
            void list.refetch();
          }}
        />
      ) : list.data ? (
        <>
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:gap-3"
            aria-label="مواعيد المتابعة"
          >
            {buckets.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                data-followup-kpi={key}
                aria-pressed={bucket === key}
                onClick={() => {
                  setBucket(bucket === key ? "" : key);
                  setPage(1);
                }}
                className={cn(
                  "flex min-h-20 items-center gap-3 rounded-lg border bg-card p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:px-4",
                  bucket === key
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/40",
                )}
              >
                <Icon
                  className={cn(
                    "size-5 shrink-0",
                    key === "overdue" && list.data.summary.overdue > 0
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                  aria-hidden="true"
                />
                <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-1">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-xl font-semibold tabular-nums">
                    {list.data.summary[key]}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <section
            className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"
            aria-label="قائمة المتابعات"
            aria-busy={list.isFetching}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3 md:p-4">
              <div className="relative min-w-0 basis-full sm:min-w-52 sm:flex-1 sm:basis-auto">
                <Search
                  className="pointer-events-none absolute start-3 top-3.5 size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  aria-label="البحث عن عميل أو رقم هاتف"
                  placeholder="ابحث باسم العميل أو رقم الهاتف..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="min-h-11 ps-9"
                />
              </div>
              <div className="min-w-0 flex-1 sm:max-w-44">
                <Select
                  value={service || "all"}
                  onValueChange={(value) => filter(setService, value)}
                >
                  <SelectTrigger
                    className="min-h-11"
                    aria-label="تصفية حسب الخدمة"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الخدمات</SelectItem>
                    {FOLLOWUP_SERVICES.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 flex-1 sm:max-w-44">
                <Select
                  value={status || "all"}
                  onValueChange={(value) => filter(setStatus, value)}
                >
                  <SelectTrigger
                    className="min-h-11"
                    aria-label="تصفية حسب حالة الاستفسار"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الحالات</SelectItem>
                    {FOLLOWUP_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {canManage ? (
                <div className="w-full sm:w-48">
                  <EmployeeSelect
                    employees={employeeOptions(roster.data?.employees ?? [])}
                    value={employee}
                    onValueChange={(value) => filter(setEmployee, value)}
                    disabled={roster.isLoading || roster.isError}
                    emptyLabel="كل الموظفين"
                    aria-label="تصفية حسب الموظف"
                  />
                </div>
              ) : null}
              {bucket ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-xs"
                  onClick={() => {
                    setBucket("");
                    setPage(1);
                  }}
                >
                  إلغاء تصفية الموعد
                </Button>
              ) : null}
            </div>
            {roster.isError ? (
              <div className="p-3">
                <ErrorMessage
                  error={roster.error}
                  onRetry={() => {
                    void roster.refetch();
                  }}
                />
              </div>
            ) : null}
            {mutation.isError && !actionDialog && !addOpen && !assigning ? (
              <div className="p-3">
                <ErrorMessage
                  error={mutation.error}
                  onRetry={() => {
                    if (mutation.variables) mutation.mutate(mutation.variables);
                  }}
                />
              </div>
            ) : null}
            {list.data.rows.length ? (
              <>
                <div
                  className="hidden overflow-x-auto xl:block"
                  data-followup-layout="table"
                >
                  <table className="w-full text-start text-sm">
                    <caption className="sr-only">
                      متابعات العملاء، مواعيدها وحالة الاستفسار والموظف المسؤول
                    </caption>
                    <thead className="bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        {[
                          "العميل",
                          "رقم الهاتف",
                          "الخدمة",
                          "موعد المتابعة",
                          "حالة الاستفسار",
                          "الموظف المسؤول",
                          "الإجراءات",
                        ].map((heading) => (
                          <th
                            key={heading}
                            scope="col"
                            className="whitespace-nowrap px-4 py-3 text-start font-medium"
                          >
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {list.data.rows.map((row) => (
                        <tr key={row.id} className="hover:bg-muted/20">
                          <td className="px-4 py-3">{customerIdentity(row)}</td>
                          <td className="px-4 py-3">
                            <bdi
                              dir="ltr"
                              className="whitespace-nowrap text-xs"
                            >
                              {formatIraqiPhone(row.customer.phone)}
                            </bdi>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {serviceLabel(row.serviceKey)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="block whitespace-nowrap text-xs">
                              {formatFollowupDate(row.followupAt)}
                            </span>
                            <DateState row={row} />
                          </td>
                          <td className="px-4 py-3">{inquiryStatus(row)}</td>
                          <td className="px-4 py-3">{employeeIdentity(row)}</td>
                          <td className="px-3 py-3">{rowActions(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div
                  className="divide-y divide-border xl:hidden"
                  data-followup-layout="cards"
                >
                  {list.data.rows.map((row) => (
                    <article
                      key={row.id}
                      className="space-y-3 p-4"
                      aria-label={`متابعة ${row.customer.name}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        {customerIdentity(row)}
                        {inquiryStatus(row)}
                      </div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
                        <div>
                          <dt className="text-muted-foreground">رقم الهاتف</dt>
                          <dd className="mt-1">
                            <bdi dir="ltr">
                              {formatIraqiPhone(row.customer.phone)}
                            </bdi>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">الخدمة</dt>
                          <dd className="mt-1">
                            {serviceLabel(row.serviceKey)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">
                            موعد المتابعة
                          </dt>
                          <dd className="mt-1 space-y-1">
                            <span className="block">
                              {formatFollowupDate(row.followupAt)}
                            </span>
                            <DateState row={row} />
                          </dd>
                        </div>
                        <div>
                          <dt className="mb-1 text-muted-foreground">
                            الموظف المسؤول
                          </dt>
                          <dd>{employeeIdentity(row)}</dd>
                        </div>
                      </dl>
                      {rowActions(row)}
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="px-4 py-12 text-center">
                <UserRound
                  className="mx-auto mb-3 size-7 text-muted-foreground"
                  aria-hidden="true"
                />
                <h2 className="font-semibold">
                  لا توجد متابعات{" "}
                  {query || service || status || bucket || employee
                    ? "مطابقة للبحث"
                    : "حالياً"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {capabilities?.canCreate
                    ? "أضف استفسار العميل وحدد موعد التواصل والمسؤول عنه."
                    : "ستظهر هنا المتابعات المسندة إليك عند إضافتها."}
                </p>
                {query || service || status || employee || bucket ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => {
                      setSearch("");
                      setQuery("");
                      setService("");
                      setStatus("");
                      setEmployee("");
                      setBucket("");
                      setPage(1);
                    }}
                  >
                    مسح التصفية
                  </Button>
                ) : null}
              </div>
            )}
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <span>
                {list.data.total} متابعة · صفحة {list.data.page} من{" "}
                {Math.max(1, Math.ceil(list.data.total / list.data.pageSize))}
              </span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9"
                  aria-label="الصفحة السابقة"
                  disabled={busy || page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronRight className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9"
                  aria-label="الصفحة التالية"
                  disabled={
                    busy || page * list.data.pageSize >= list.data.total
                  }
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronLeft className="size-4" />
                </Button>
              </div>
            </footer>
          </section>
          {capabilities?.canCreate && list.data.suggestions.length ? (
            <section aria-label="متابعات مقترحة" className="space-y-2">
              <h2 className="text-sm font-semibold">فرص متابعة مقترحة</h2>
              <div className="divide-y divide-border rounded-lg border border-border bg-card">
                {list.data.suggestions.map((item) => (
                  <div
                    key={item.key}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {item.customer.name}{" "}
                        <span className="font-normal text-muted-foreground">
                          · {serviceLabel(item.serviceKey)}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.reason}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openAdd(item)}
                    >
                      إضافة متابعة
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <details className="rounded-lg border border-border bg-card px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              ملخص المتابعة
            </summary>
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  إجمالي الاستفسارات
                </dt>
                <dd className="mt-1 font-semibold">
                  {list.data.summary.total}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  متابعات مكتملة
                </dt>
                <dd className="mt-1 font-semibold">
                  {list.data.summary.completed}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  حجوزات ناتجة عن المتابعة
                </dt>
                <dd className="mt-1 font-semibold">
                  {list.data.summary.converted}
                </dd>
              </div>
            </dl>
          </details>
        </>
      ) : null}
      {addOpen && capabilities?.canCreate ? (
        <AddFollowupDialog
          mode={mode}
          suggestion={suggestion}
          canManage={canManage}
          canCreateCustomer={capabilities.canCreateCustomer}
          busy={mutation.isPending}
          error={mutation.isError ? mutation.error : null}
          onClose={() => {
            if (!mutation.isPending) setAddOpen(false);
          }}
          onSave={(body) => submit(`${BASE}${scope}`, body)}
        />
      ) : null}
      {actionDialog ? (
        <FollowupActionDialog
          key={`${actionDialog.kind}:${actionDialog.row.id}`}
          item={actionDialog}
          busy={mutation.isPending}
          error={mutation.isError ? mutation.error : null}
          onClose={() => {
            if (!mutation.isPending) setActionDialog(null);
          }}
          onSave={(fields) => act(actionDialog.row, actionDialog.kind, fields)}
        />
      ) : null}
      {preview ? (
        <CustomerPreview
          row={preview}
          scope={scope}
          onClose={() => setPreview(null)}
        />
      ) : null}
      {assigning && canManage ? (
        <FollowupAssignmentDialog
          row={assigning}
          busy={mutation.isPending}
          error={mutation.isError ? mutation.error : null}
          onClose={() => {
            if (!mutation.isPending) setAssigning(null);
          }}
          onSave={(assignedStaffId) =>
            act(assigning, "assign", { assignedStaffId })
          }
        />
      ) : null}
    </div>
  );
}

function AddFollowupDialog({
  mode,
  suggestion,
  canManage,
  canCreateCustomer,
  busy,
  error,
  onClose,
  onSave,
}: {
  mode: Mode;
  suggestion: FollowupSuggestion | null;
  canManage: boolean;
  canCreateCustomer: boolean;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (body: MutationBody) => void;
}) {
  const [customer, setCustomer] = useState<FollowupCustomer | null>(
    suggestion?.customer ?? null,
  );
  const [service, setService] = useState<FollowupServiceKey>(
    suggestion?.serviceKey ?? "photography",
  );
  const [date, setDate] = useState("");
  const [employee, setEmployee] = useState("");
  const [note, setNote] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(customerSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [customerSearch]);
  const params = new URLSearchParams();
  if (mode === "staff") params.set("scope", "mine");
  if (query) params.set("q", query);
  const options = useQuery({
    queryKey: ["customer-followups-options", mode, query],
    queryFn: () => adminFetch<Options>(`${BASE}/options?${params}`),
    retry: false,
  });
  useEffect(() => {
    if (!employee && options.data?.employees.length === 1)
      setEmployee(String(options.data.employees[0].id));
  }, [employee, options.data]);
  function save(event: FormEvent) {
    event.preventDefault();
    if (!customer || !date || !employee || options.isError || busy) return;
    onSave({
      customerId: customer.id,
      serviceKey: service,
      followupAt: followupDateTimeToIso(date),
      assignedStaffId: Number(employee),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(suggestion
        ? {
            suggestionKey: suggestion.key,
            sourceBooking: suggestion.sourceBooking,
          }
        : {}),
    });
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy && !quickAddOpen) onClose();
        }}
      >
        <DialogContent
          dir="rtl"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>إضافة متابعة</DialogTitle>
            <DialogDescription>
              اختر العميل والخدمة وموعد التواصل. الوقت بتوقيت بغداد.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            {suggestion ? (
              <p className="rounded-md bg-muted px-3 py-2 text-xs">
                {suggestion.reason}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="followup-customer">العميل</Label>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    id="followup-customer"
                    role="combobox"
                    aria-expanded={pickerOpen}
                    className="min-h-11 w-full justify-start font-normal"
                    variant="outline"
                    disabled={busy}
                  >
                    {customer
                      ? `${customer.name} · ${formatIraqiPhone(customer.phone)}`
                      : "ابحث عن عميل موجود"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  dir="rtl"
                  align="start"
                  className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
                >
                  <Command shouldFilter={false}>
                    <CommandInput
                      aria-label="البحث عن عميل موجود"
                      value={customerSearch}
                      onValueChange={setCustomerSearch}
                      placeholder="اسم العميل أو رقم الهاتف"
                    />
                    <CommandList>
                      {options.isLoading ? (
                        <p className="p-3 text-sm" role="status">
                          جارٍ البحث…
                        </p>
                      ) : options.isError ? (
                        <div className="p-2">
                          <ErrorMessage
                            error={options.error}
                            onRetry={() => {
                              void options.refetch();
                            }}
                          />
                        </div>
                      ) : !options.data?.customers.length ? (
                        <p className="p-3 text-sm text-muted-foreground">
                          لا يوجد عملاء مطابقون.
                        </p>
                      ) : (
                        <CommandGroup>
                          {options.data.customers.map((item) => (
                            <CommandItem
                              key={item.id}
                              value={String(item.id)}
                              onSelect={() => {
                                setCustomer(item);
                                setPickerOpen(false);
                              }}
                              className="gap-2 py-2"
                            >
                              <EmployeeAvatar
                                name={item.name}
                                photoUrl={item.avatarUrl}
                                size={32}
                              />
                              <span className="min-w-0">
                                <span className="block break-words">
                                  {item.name}
                                </span>
                                <bdi
                                  dir="ltr"
                                  className="text-xs text-muted-foreground"
                                >
                                  {formatIraqiPhone(item.phone)}
                                </bdi>
                              </span>
                              {customer?.id === item.id ? (
                                <Check className="ms-auto size-4" />
                              ) : null}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {canCreateCustomer ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0 py-1"
                  onClick={() => {
                    setPickerOpen(false);
                    setQuickAddOpen(true);
                  }}
                  disabled={busy}
                >
                  <Plus className="me-1 size-3.5" />
                  عميل جديد
                </Button>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="followup-service">الخدمة محل الاهتمام</Label>
              <Select
                value={service}
                onValueChange={(value) =>
                  setService(value as FollowupServiceKey)
                }
                disabled={busy}
              >
                <SelectTrigger id="followup-service" className="min-h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FOLLOWUP_SERVICES.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="followup-date">موعد المتابعة</Label>
              <DateField
                id="followup-date"
                type="datetime-local"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
                disabled={busy}
                className={dateInputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="followup-employee">الموظف المسؤول</Label>
              <EmployeeSelect
                id="followup-employee"
                aria-label="الموظف المسؤول"
                employees={employeeOptions(options.data?.employees ?? [])}
                value={employee}
                onValueChange={setEmployee}
                disabled={
                  busy ||
                  options.isLoading ||
                  options.isError ||
                  (!canManage && options.data?.employees.length === 1)
                }
                placeholder={
                  options.isLoading ? "جارٍ تحميل الموظفين…" : "اختر الموظف"
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="followup-note">
                ملاحظة{" "}
                <span className="font-normal text-muted-foreground">
                  (اختياري)
                </span>
              </Label>
              <Textarea
                id="followup-note"
                rows={2}
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={busy}
              />
            </div>
            {options.isError ? (
              <ErrorMessage
                error={options.error}
                onRetry={() => {
                  void options.refetch();
                }}
              />
            ) : null}
            {error ? <ErrorMessage error={error} /> : null}
            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  busy || !customer || !date || !employee || options.isError
                }
              >
                {busy ? "جارٍ الحفظ…" : "حفظ المتابعة"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={busy}
              >
                إلغاء
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {canCreateCustomer ? (
        <CustomerQuickAddDialog
          open={quickAddOpen}
          onOpenChange={setQuickAddOpen}
          defaultPhone={customerSearch}
          onCreated={(created) => {
            setCustomer(created);
            setQuickAddOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function FollowupActionDialog({
  item,
  busy,
  error,
  onClose,
  onSave,
}: {
  item: ActionDialog;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (fields: MutationBody) => void;
}) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState(
    item.kind === "postpone"
      ? toFollowupDateTimeInput(item.row.followupAt)
      : "",
  );
  const [bookingId, setBookingId] = useState("");
  const [bookingSource, setBookingSource] = useState<"service" | "kosha">(
    "service",
  );
  const title = {
    complete: "إكمال مع خيارات",
    postpone: "تأجيل المتابعة",
    stop_contact: "إيقاف التواصل مع العميل",
    resume_contact: "استئناف التواصل مع العميل",
    link_booking: "ربط حجز موجود",
  }[item.kind];
  function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (item.kind === "postpone") {
      if (!date) return;
      onSave({
        followupAt: followupDateTimeToIso(date),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    } else if (item.kind === "complete")
      onSave({
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(date ? { nextFollowupAt: followupDateTimeToIso(date) } : {}),
      });
    else if (item.kind === "resume_contact") onSave({ confirmResume: true });
    else if (item.kind === "link_booking") {
      if (!/^[1-9]\d*$/.test(bookingId)) return;
      onSave({ booking: { source: bookingSource, id: Number(bookingId) } });
    } else onSave({});
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        dir="rtl"
        className="max-w-md"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {item.row.customer.name} · {serviceLabel(item.row.serviceKey)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          {item.kind === "stop_contact" ? (
            <p className="text-sm leading-7">
              سيُوقف التواصل مع هذا العميل لكل الخدمات، وتختفي روابط الاتصال
              وواتساب والاقتراحات. إذا كان غير مهتم بهذه الخدمة فقط، اختر «غير
              مهتم» من حالة الاستفسار.
            </p>
          ) : item.kind === "resume_contact" ? (
            <p className="text-sm leading-7">
              أؤكد السماح باستئناف التواصل مع هذا العميل لكل الخدمات. استخدم هذا
              الإجراء بعد تأكيد موافقة العميل.
            </p>
          ) : item.kind === "link_booking" ? (
            <>
              <p className="text-sm text-muted-foreground">
                اربط الحجز الأصلي لهذا العميل. يتحقق النظام من هوية العميل
                وتاريخ الحجز قبل الربط.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="followup-booking-source">نوع الحجز</Label>
                <Select
                  value={bookingSource}
                  onValueChange={(value) =>
                    setBookingSource(value as "service" | "kosha")
                  }
                  disabled={busy}
                >
                  <SelectTrigger id="followup-booking-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="service">حجز مركز الحجوزات</SelectItem>
                    <SelectItem value="kosha">حجز كوشة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="followup-booking-id">معرّف الحجز الأصلي</Label>
                <Input
                  id="followup-booking-id"
                  inputMode="numeric"
                  dir="ltr"
                  required
                  value={bookingId}
                  onChange={(event) => setBookingId(event.target.value)}
                  disabled={busy}
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="followup-action-note">
                  ملاحظة{" "}
                  <span className="font-normal text-muted-foreground">
                    (اختياري)
                  </span>
                </Label>
                <Textarea
                  id="followup-action-note"
                  rows={2}
                  maxLength={2000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="followup-action-date">
                  {item.kind === "postpone"
                    ? "الموعد الجديد"
                    : "موعد متابعة تالٍ (اختياري)"}
                </Label>
                <DateField
                  id="followup-action-date"
                  type="datetime-local"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  required={item.kind === "postpone"}
                  disabled={busy}
                  className={dateInputClass}
                />
                <p className="text-xs text-muted-foreground">
                  {item.kind === "complete"
                    ? "الموعد التالي ينشئ متابعة مرتبطة ويحفظ المتابعة الحالية مكتملة. "
                    : ""}
                  الوقت بتوقيت بغداد.
                </p>
              </div>
            </>
          )}
          {error ? <ErrorMessage error={error} /> : null}
          <DialogFooter>
            <Button
              type="submit"
              variant={item.kind === "stop_contact" ? "destructive" : "default"}
              disabled={
                busy ||
                (item.kind === "postpone" && !date) ||
                (item.kind === "link_booking" && !/^[1-9]\d*$/.test(bookingId))
              }
            >
              {busy
                ? "جارٍ الحفظ…"
                : item.kind === "stop_contact"
                  ? "تأكيد إيقاف التواصل لكل الخدمات"
                  : item.kind === "resume_contact"
                    ? "تأكيد استئناف التواصل"
                    : "حفظ"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FollowupAssignmentDialog({
  row,
  busy,
  error,
  onClose,
  onSave,
}: {
  row: FollowupRow;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (assignedStaffId: number) => void;
}) {
  const [employee, setEmployee] = useState(String(row.employee.id));
  const assignees = useQuery({
    queryKey: ["customer-followups-assignees", row.id],
    queryFn: () =>
      adminFetch<{ employees: FollowupEmployee[] }>(
        `${BASE}/${row.id}/assignees`,
      ),
    retry: false,
  });
  const valid =
    assignees.isSuccess &&
    assignees.data.employees.some((item) => String(item.id) === employee) &&
    employee !== String(row.employee.id);
  function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !valid) return;
    onSave(Number(employee));
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        dir="rtl"
        className="max-w-md"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>تعيين موظف</DialogTitle>
          <DialogDescription>
            {row.customer.name} · {serviceLabel(row.serviceKey)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            الموظف الحالي: {row.employee.fullName}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="followup-assignment-employee">
              الموظف المسؤول الجديد
            </Label>
            {assignees.isLoading ? (
              <Skeleton
                className="h-11"
                aria-busy="true"
                aria-label="جارٍ تحميل الموظفين المتاحين"
              />
            ) : (
              <EmployeeSelect
                id="followup-assignment-employee"
                aria-label="الموظف المسؤول الجديد"
                employees={employeeOptions(assignees.data?.employees ?? [])}
                value={employee}
                onValueChange={setEmployee}
                disabled={
                  busy || assignees.isError || !assignees.data?.employees.length
                }
              />
            )}
          </div>
          {assignees.isError ? (
            <ErrorMessage
              error={assignees.error}
              onRetry={() => {
                void assignees.refetch();
              }}
            />
          ) : assignees.isSuccess && !assignees.data.employees.length ? (
            <p className="text-sm text-muted-foreground">
              لا يوجد موظفون نشطون متاحون للتعيين.
            </p>
          ) : null}
          {error ? <ErrorMessage error={error} /> : null}
          <DialogFooter>
            <Button type="submit" disabled={busy || !valid}>
              {busy ? "جارٍ الحفظ…" : "حفظ التعيين"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomerPreview({
  row,
  scope,
  onClose,
}: {
  row: FollowupRow;
  scope: string;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["customer-followup-customer", row.id, scope],
    queryFn: () =>
      adminFetch<{ customer: FollowupCustomer }>(
        `${BASE}/${row.id}/customer${scope}`,
      ),
    retry: false,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>عرض العميل</DialogTitle>
          <DialogDescription>
            بيانات التواصل المرتبطة بهذه المتابعة.
          </DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <Skeleton className="h-20" aria-busy="true" />
        ) : query.isError ? (
          <ErrorMessage
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : query.data ? (
          <div className="flex items-center gap-3">
            <EmployeeAvatar
              name={query.data.customer.name}
              photoUrl={query.data.customer.avatarUrl}
              size={40}
            />
            <div className="min-w-0">
              <p className="break-words font-semibold">
                {query.data.customer.name}
              </p>
              <bdi
                dir="ltr"
                className="mt-1 block text-sm text-muted-foreground"
              >
                {formatIraqiPhone(query.data.customer.phone)}
              </bdi>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
