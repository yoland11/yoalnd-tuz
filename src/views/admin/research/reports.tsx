import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Printer, Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmployeeSelect } from "@/components/employee-select";
import { formatCurrency } from "@/lib/money";
import type { ReportColumn } from "@/lib/pdf-report";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "../_lib";
import { exportResearchTable, researchOrderColumns } from "../research-print";
import { researchFilterParams, type ResearchFilters } from "./ui-model";
import {
  dateText,
  Panel,
  researchFetch,
  ResearchEmpty,
  ResearchFailure,
  ResearchFiltersBar,
  ResearchLoading,
  ResearchMetric,
  ResearchMetrics,
  ResearchPagination,
  type ResearchRecord,
} from "./shared";
import { ApprovalBadge } from "./finance";
import { ResearchOrderTable } from "./overview";

const reportLabels: Record<string, string> = {
  orders: "تقرير الأبحاث",
  daily: "الطلبات اليومية",
  monthly: "المقبوضات الشهرية",
  workload: "أداء الموظفين",
  expenses: "مصاريف الأبحاث",
};
const columnsByReport: Record<string, ReportColumn<ResearchRecord>[]> = {
  orders: researchOrderColumns,
  daily: [
    { key: "day", header: "اليوم", width: 20 },
    { key: "orders", header: "الطلبات", width: 15, kind: "number" },
    { key: "totalValue", header: "القيمة", width: 22, kind: "money" },
    { key: "collected", header: "المقبوض", width: 22, kind: "money" },
    { key: "remaining", header: "المتبقي", width: 21, kind: "money" },
  ],
  monthly: [
    { key: "month", header: "الشهر", width: 40 },
    {
      key: "collected",
      header: "صافي المقبوض المعتمد",
      width: 60,
      kind: "money",
    },
  ],
  workload: [
    { key: "name", header: "الموظف", width: 40 },
    { key: "assigned", header: "المكلف بها", width: 20, kind: "number" },
    { key: "completed", header: "المكتملة", width: 20, kind: "number" },
    { key: "overdue", header: "المتأخرة بالتسليم", width: 20, kind: "number" },
  ],
  expenses: [
    { key: "researchNo", header: "البحث", width: 15 },
    { key: "date", header: "التاريخ", width: 15 },
    { key: "name", header: "المصروف", width: 30 },
    { key: "amount", header: "القيمة المسجلة", width: 20, kind: "money" },
    {
      key: "approvedAmount",
      header: "المصروف المعتمد",
      width: 20,
      kind: "money",
    },
  ],
};
export function ResearchReports({ onOpen }: { onOpen: (id: number) => void }) {
  const { toast } = useToast();
  const [filters, setFilters] = useState<ResearchFilters>({
    page: 1,
    pageSize: 20,
  });
  const [report, setReport] = useState("orders");
  const [busy, setBusy] = useState(false);
  const query = useQuery<ResearchRecord>({
    queryKey: ["research", "reports", filters],
    queryFn: () => researchFetch(`/reports?${researchFilterParams(filters)}`),
  });
  const catalog = useQuery<ResearchRecord>({
    queryKey: ["research", "catalog"],
    queryFn: () => researchFetch("/catalog"),
  });
  async function exportData(mode: "print" | "download" | "excel") {
    if (!query.data) return;
    setBusy(true);
    try {
      let records: ResearchRecord[] = query.data[report] || [];
      let scope = "جميع النتائج المطابقة للتصفية";
      if (report === "orders") {
        const total = Number(query.data.pagination.total);
        if (total > 10000)
          throw new Error(
            "نتائج كثيرة للتصدير دفعة واحدة. حدّد فترة أو تصنيفاً ليصبح العدد أقل من 10,000 بحث.",
          );
        records = [];
        for (
          let page = 1;
          page <= Math.max(1, Math.ceil(total / 100));
          page++
        ) {
          const result = await researchFetch<ResearchRecord>(
            `/orders?${researchFilterParams({ ...filters, page, pageSize: 100 })}`,
          );
          records.push(...result.items);
        }
      }
      if (
        report === "expenses" &&
        Number(query.data.scope.expenseCount) > records.length
      )
        scope = `تفاصيل أول ${records.length} مصروف من ${query.data.scope.expenseCount} مصروف مطابق. الإجماليات الكاملة متاحة في الشاشة.`;
      if (report === "daily")
        scope += " · حسب تاريخ إنشاء الطلب؛ حد أقصى 366 يوماً له نتائج";
      if (report === "monthly")
        scope += " · حسب تاريخ تنفيذ الحركة المالية للأبحاث المطابقة للتصفية";
      await exportResearchTable({
        title: reportLabels[report],
        rows: records,
        mode,
        financial: true,
        from: filters.from,
        to: filters.to,
        columns: columnsByReport[report],
        subtitle: scope,
      });
    } catch (error) {
      toast({
        title: "تعذر تصدير التقرير",
        description: apiErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <ResearchFiltersBar
        filters={filters}
        financial
        dates
        onChange={(patch) => setFilters({ ...filters, ...patch, page: 1 })}
      />
      <div className="max-w-sm">
        {catalog.isError ? (
          <ResearchFailure
            error={catalog.error}
            retry={() => void catalog.refetch()}
          />
        ) : (
          <EmployeeSelect
            employees={catalog.data?.writers || []}
            value={filters.staffId || ""}
            disabled={catalog.isPending}
            emptyLabel="كل الموظفين"
            placeholder="تصفية حسب الموظف"
            onValueChange={(staffId) =>
              setFilters({ ...filters, staffId, page: 1 })
            }
          />
        )}
      </div>
      {query.isPending ? (
        <ResearchLoading />
      ) : query.isError ? (
        <ResearchFailure
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : (
        <>
          <ResearchMetrics summary={query.data.summary} financial />
          <div className="grid gap-3 sm:grid-cols-3">
            <ResearchMetric
              label="المصاريف المعتمدة"
              value={formatCurrency(query.data.summary.approvedExpenses)}
            />
            <ResearchMetric
              label="المساهمة التقديرية"
              value={formatCurrency(query.data.summary.estimatedContribution)}
              hint="قيمة العقود ناقص المصاريف والمشتريات"
            />
            <ResearchMetric
              label="مساهمة البحوث المسلمة"
              value={
                query.data.summary.actualContribution === undefined
                  ? "—"
                  : formatCurrency(query.data.summary.actualContribution)
              }
              hint="قبل المصاريف العامة"
            />
          </div>
          <Alert>
            <AlertTitle>نطاق التقرير</AlertTitle>
            <AlertDescription>
              الطلبات والقيم حسب تاريخ إنشاء البحث. المقبوضات الشهرية حسب تاريخ
              تنفيذ الحركة المالية. المساهمة قبل المصاريف العامة ولا تمثل صافي
              الربح المحاسبي النهائي. لا تشمل الطلبات المالية المعلقة.
            </AlertDescription>
          </Alert>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="المقبوضات الشهرية المعتمدة">
              <div className="h-64" dir="ltr">
                {query.data.monthly.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[...query.data.monthly].reverse()}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={70} />
                      <Tooltip
                        formatter={(value: any) => formatCurrency(value)}
                      />
                      <Bar
                        dataKey="collected"
                        name="المقبوض المعتمد"
                        fill="var(--research-navy)"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ResearchEmpty
                    title="لا توجد مقبوضات في الفترة"
                    description="تظهر الدفعات بعد اعتمادها وتنفيذها."
                  />
                )}
              </div>
            </Panel>
            <Panel title="توزيع تكليفات الموظفين">
              <div className="flex flex-col gap-4">
                {query.data.workload.slice(0, 6).map((writer: any) => (
                  <div key={writer.id}>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <strong>{writer.name}</strong>
                      <span>
                        {writer.completed} مكتمل / {writer.assigned} تكليف
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{
                          width: `${Number(writer.assigned) ? Math.min(100, (Number(writer.completed) / Number(writer.assigned)) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
                {!query.data.workload.length && (
                  <ResearchEmpty
                    title="لا توجد تكليفات مطابقة"
                    description="اختر موظفاً أو غيّر الفترة."
                  />
                )}
              </div>
            </Panel>
          </div>
          <Panel
            title="تفاصيل التقرير"
            action={
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void exportData("print")}
                >
                  <Printer data-icon="inline-start" />
                  طباعة A4
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void exportData("download")}
                >
                  <FileDown data-icon="inline-start" />
                  PDF
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void exportData("excel")}
                >
                  <Download data-icon="inline-start" />
                  Excel
                </Button>
              </div>
            }
          >
            <Tabs value={report} onValueChange={setReport} dir="rtl">
              <TabsList className="mb-4 h-auto flex-wrap">
                {Object.entries(reportLabels).map(([key, label]) => (
                  <TabsTrigger key={key} value={key}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="orders">
                <ResearchOrderTable
                  items={query.data.items}
                  financial
                  onOpen={onOpen}
                />
                <ResearchPagination
                  pagination={query.data.pagination}
                  page={filters.page || 1}
                  onPage={(page) => setFilters({ ...filters, page })}
                />
              </TabsContent>
              {["daily", "monthly", "workload", "expenses"].map((mode) => (
                <TabsContent key={mode} value={mode}>
                  {mode === "expenses" &&
                    query.data.scope.expenseCount >
                      query.data.expenses.length && (
                      <Alert className="mb-3">
                        <AlertTitle>تفاصيل محدودة</AlertTitle>
                        <AlertDescription>
                          تظهر أول {query.data.expenses.length} من{" "}
                          {query.data.scope.expenseCount} مصروف. إجمالي المصاريف
                          أعلاه يشمل كل النتائج. ضيّق التصفية لتصدير تفاصيل أقل.
                        </AlertDescription>
                      </Alert>
                    )}
                  <ReportTable
                    columns={columnsByReport[mode]}
                    rows={query.data[mode]}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </Panel>
        </>
      )}
    </div>
  );
}
function ReportTable({
  columns,
  rows,
}: {
  columns: ReportColumn<ResearchRecord>[];
  rows: ResearchRecord[];
}) {
  if (!rows.length) return <ResearchEmpty />;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key}>{column.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.id || row.day || row.month || index}>
              {columns.map((column) => (
                <TableCell key={column.key}>
                  {column.kind === "money" ? (
                    <bdi>{formatCurrency(row[column.key])}</bdi>
                  ) : (
                    (row[column.key] ?? "—")
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
