import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Clock3,
  RefreshCw,
  LayoutGrid,
  List,
  Plus,
  CalendarDays,
  UserRound,
  ArrowLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RESEARCH_CATEGORIES,
  researchWorkflowStage,
} from "@/lib/research-contract";
import { formatCurrency } from "@/lib/money";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "../_lib";
import { researchFilterParams, type ResearchFilters } from "./ui-model";
import {
  Choice,
  dateText,
  Panel,
  researchFetch,
  ResearchEmpty,
  ResearchFailure,
  ResearchFiltersBar,
  ResearchLoading,
  ResearchMetrics,
  ResearchPagination,
  ResearchStatus,
  RESEARCH_STATUSES,
  type ResearchRecord,
} from "./shared";

export function ResearchDashboard({
  financial,
  onOpen,
  editable,
}: {
  financial: boolean;
  onOpen: (id: number) => void;
  editable: boolean;
}) {
  const query = useQuery<ResearchRecord>({
    queryKey: ["research", "dashboard"],
    queryFn: () => researchFetch("/dashboard"),
    refetchInterval: 60_000,
  });
  if (query.isPending) return <ResearchLoading />;
  if (query.isError)
    return (
      <ResearchFailure error={query.error} retry={() => void query.refetch()} />
    );
  const data = query.data;
  return (
    <div className="flex flex-col gap-6">
      <div className="research-welcome flex flex-wrap items-center justify-between gap-4 rounded-2xl p-6">
        <div>
          <p className="text-sm opacity-75">مجموعة علي جان نهاد</p>
          <h2 className="mt-2 text-2xl font-bold">كل بحث… خطوة نحو الإنجاز</h2>
          <p className="mt-2 text-sm opacity-80">
            تابع مراحل العمل، مواعيد التسليم وذمم الطلاب من مكان واحد.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw data-icon="inline-start" />
          تحديث البيانات
        </Button>
      </div>
      <ResearchMetrics summary={data.summary} financial={financial} />
      {data.alerts?.length > 0 && (
        <Panel
          title="تنبيهات تحتاج المتابعة"
          description="مستمدة من مواعيد الطلبات والدفعات الحالية"
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.alerts.map((alert: any, index: number) => (
              <button
                key={alert.id || `${alert.type}-${index}`}
                type="button"
                onClick={() =>
                  alert.orderId
                    ? onOpen(alert.orderId)
                    : alert.href && window.location.assign(alert.href)
                }
                className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-start text-sm hover:bg-accent/10"
              >
                <span className="font-semibold">
                  {alert.title || alert.message}
                </span>
                {(alert.description || alert.body) && (
                  <p className="mt-1 text-muted-foreground">
                    {alert.description || alert.body}
                  </p>
                )}
              </button>
            ))}
          </div>
        </Panel>
      )}
      <ResearchOrders
        financial={financial}
        editable={editable}
        onOpen={onOpen}
        compact
      />
      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Panel
          title="أحدث طلبات الأبحاث"
          action={
            <Button asChild variant="ghost" size="sm">
              <a href="/admin/research/orders">
                عرض كل الطلبات
                <ArrowLeft data-icon="inline-end" />
              </a>
            </Button>
          }
        >
          <ResearchOrderTable
            items={data.recent}
            financial={financial}
            onOpen={onOpen}
          />
        </Panel>
        <Panel
          title="توزيع العمل على الفريق"
          description="الموظفون الحاليون وسجل إنجازهم"
        >
          <div className="flex flex-col gap-4">
            {data.writers?.length ? (
              data.writers.map((writer: any) => (
                <div
                  key={writer.id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-primary/5 font-semibold text-primary">
                      {(writer.name || writer.username || "؟").slice(0, 1)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {writer.name || writer.username}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {writer.active ?? writer.assigned ?? 0} قيد العمل ·{" "}
                        {Math.round(Number(writer.minutes || 0) / 60)} ساعة
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">{writer.completed} مكتمل</Badge>
                </div>
              ))
            ) : (
              <ResearchEmpty
                title="لا توجد تكليفات للفريق"
                description="يمكن تعيين مسؤول لكل بحث من مساحة العمل."
              />
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function ResearchOrderTable({
  items,
  financial,
  onOpen,
}: {
  items: ResearchRecord[];
  financial: boolean;
  onOpen: (id: number) => void;
}) {
  if (!items?.length) return <ResearchEmpty />;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>البحث / الطالب</TableHead>
            <TableHead>التصنيف</TableHead>
            <TableHead>المسؤول</TableHead>
            <TableHead>التسليم</TableHead>
            <TableHead>الحالة</TableHead>
            <TableHead>الإنجاز</TableHead>
            {financial && <TableHead>المتبقي</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((order) => (
            <TableRow key={order.id}>
              <TableCell>
                <button
                  type="button"
                  onClick={() => onOpen(order.id)}
                  className="max-w-72 text-start hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="block text-xs font-medium text-primary">
                    <bdi>{order.researchNo}</bdi>
                  </span>
                  <span className="line-clamp-2 font-semibold">
                    {order.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {order.customerName || "طالب غير مسجل"}
                  </span>
                </button>
              </TableCell>
              <TableCell>
                {RESEARCH_CATEGORIES[order.researchCategory] || "غير مصنف"}
              </TableCell>
              <TableCell>{order.assignedEmployeeName || "غير معين"}</TableCell>
              <TableCell>
                <bdi>{dateText(order.deadline)}</bdi>
              </TableCell>
              <TableCell>
                <ResearchStatus status={order.status} />
              </TableCell>
              <TableCell>
                <div className="flex min-w-24 items-center gap-2">
                  <Progress value={Number(order.progress || 0)} />
                  <span className="text-xs">
                    <bdi>{order.progress || 0}%</bdi>
                  </span>
                </div>
              </TableCell>
              {financial && (
                <TableCell>
                  <bdi>
                    {order.remainingAmount === undefined
                      ? "—"
                      : formatCurrency(order.remainingAmount)}
                  </bdi>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ResearchOrders({
  library = false,
  compact = false,
  financial,
  editable,
  onOpen,
}: {
  library?: boolean;
  compact?: boolean;
  financial: boolean;
  editable: boolean;
  onOpen: (id: number) => void;
}) {
  const [filters, setFilters] = useState<ResearchFilters>({
    page: 1,
    pageSize: compact ? 12 : 20,
    ...(library ? { status: "completed" } : {}),
  });
  const [view, setView] = useState(compact ? "board" : "list");
  const query = useQuery<ResearchRecord>({
    queryKey: ["research", view, filters],
    queryFn: () =>
      researchFetch(
        `/${view === "board" ? "board" : "orders"}?${researchFilterParams(filters)}`,
      ),
  });
  const update = (patch: Partial<ResearchFilters>) =>
    setFilters((current) => ({ ...current, ...patch, page: 1 }));
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">
            {library
              ? "مكتبة الأبحاث"
              : compact
                ? "مسار الأبحاث"
                : "طلبات الأبحاث"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            من استلام المتطلبات إلى التسليم النهائي.
          </p>
        </div>
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(next) => next && setView(next)}
          aria-label="طريقة عرض الأبحاث"
        >
          <ToggleGroupItem value="board" aria-label="عرض لوحة المراحل">
            <LayoutGrid className="size-4" />
            لوحة المراحل
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="عرض القائمة">
            <List className="size-4" />
            قائمة
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <ResearchFiltersBar
        filters={filters}
        onChange={update}
        financial={financial}
      />
      {!compact && (
        <div className="max-w-56">
          <Choice
            label="الحالة الأصلية"
            value={filters.status || "all"}
            onChange={(status) => {
              if (status === "archived") setView("list");
              update({ status, stage: "all" });
            }}
            options={{ all: "كل الحالات الأصلية", ...RESEARCH_STATUSES }}
          />
        </div>
      )}
      {query.isPending ? (
        <ResearchLoading />
      ) : query.isError ? (
        <ResearchFailure
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : view === "board" ? (
        <ResearchBoard
          onStage={(stage) => update({ stage })}
          columns={query.data.columns}
          financial={financial}
          editable={editable}
          onOpen={onOpen}
        />
      ) : (
        <Panel title="سجل الطلبات">
          <ResearchOrderTable
            items={query.data.items}
            financial={financial}
            onOpen={onOpen}
          />
        </Panel>
      )}
      {query.isSuccess && (
        <ResearchPagination
          pagination={
            query.data.pagination ||
            (view === "board" && query.data.columns?.length === 1
              ? query.data.columns[0].pagination
              : undefined)
          }
          page={filters.page || 1}
          onPage={(page) => setFilters((current) => ({ ...current, page }))}
        />
      )}
    </section>
  );
}

function ResearchBoard({
  columns,
  financial,
  editable,
  onOpen,
  onStage,
}: {
  columns: ResearchRecord[];
  financial: boolean;
  editable: boolean;
  onOpen: (id: number) => void;
  onStage: (stage: string) => void;
}) {
  const { toast } = useToast();
  const cache = useQueryClient();
  const move = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      researchFetch(`/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => void cache.invalidateQueries({ queryKey: ["research"] }),
    onError: (error) =>
      toast({
        title: "تعذر نقل البحث",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  return (
    <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {columns?.map((column) => (
        <section
          key={column.key}
          aria-label={column.label}
          className="flex min-w-0 flex-col gap-3 rounded-xl border bg-muted/35 p-3"
        >
          <header className="flex items-center justify-between gap-2 border-b border-accent/30 pb-3">
            <h3 className="text-sm font-bold">{column.label}</h3>
            <Badge variant="outline">{column.total}</Badge>
          </header>
          {column.items?.length ? (
            column.items.map((order: any) => (
              <article
                key={order.id}
                className="research-order-card flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => onOpen(order.id)}
                  className="flex flex-col gap-2 text-start hover:underline"
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-semibold text-primary">
                      <bdi>{order.researchNo}</bdi>
                    </span>
                    <Badge
                      variant="secondary"
                      className="max-w-24 truncate text-[10px]"
                    >
                      {RESEARCH_CATEGORIES[order.researchCategory] ||
                        "غير مصنف"}
                    </Badge>
                  </span>
                  <h4 className="line-clamp-2 text-sm font-bold leading-6">
                    {order.title}
                  </h4>
                  <span className="text-xs text-muted-foreground">
                    {order.customerName || "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">{order.universityName || '—'} · {order.department || '—'}</span>
                </button>
                <div className="flex flex-col gap-2 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <UserRound className="size-3.5" />
                    {order.assignedEmployeeName || "بدون مسؤول"}
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarDays className="size-3.5" />
                    التسليم: <bdi>{dateText(order.deadline)}</bdi>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Progress value={Number(order.progress || 0)} />
                  <span className="text-[11px]">
                    <bdi>{order.progress || 0}%</bdi>
                  </span>
                </div>
                {financial && (
                  <dl className="grid gap-1 border-t pt-2 text-xs">{[['totalAmount','الإجمالي'],['paidAmount','المقبوض'],['remainingAmount','المتبقي']].map(([key,label])=><div key={key} className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">{label}</dt><dd><bdi className="font-bold">{order[key]===undefined?'—':formatCurrency(order[key])}</bdi></dd></div>)}</dl>
                )}
                {editable && (
                  <Choice
                    label={`نقل ${order.researchNo} إلى مرحلة`}
                    value={order.status}
                    disabled={move.isPending}
                    options={Object.fromEntries(
                      Object.entries(RESEARCH_STATUSES).filter(
                        ([key]) => key !== "archived",
                      ),
                    )}
                    onChange={(status) => move.mutate({ id: order.id, status })}
                  />
                )}
              </article>
            ))
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">
              لا توجد أبحاث في هذه المرحلة
            </p>
          )}
          {column.total > column.items?.length && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStage(column.key)}
            >
              عرض المرحلة كاملة ({column.total})
            </Button>
          )}
        </section>
      ))}
    </div>
  );
}
