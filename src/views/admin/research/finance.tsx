import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Printer,
  WalletCards,
  Send,
  FileDown,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldGroup } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/money";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, type AdminMe } from "../_lib";
import { exportResearchTable, printResearchThermal, printResearchStudentStatementThermal, researchStatementShareText } from "../research-print";
import { SmartCustomerSearch } from "../smart-customer-search";
import {
  researchAccess,
  researchFilterParams,
  researchPaymentPayload,
  reminderPreview,
  whatsappLink,
  type ResearchFilters,
} from "./ui-model";
import { ResearchPurchases } from "./purchases";
import {
  Choice,
  dateText,
  FINANCIAL_STATUSES,
  Panel,
  researchFetch,
  ResearchEmpty,
  ResearchFailure,
  ResearchField,
  ResearchFiltersBar,
  ResearchLoading,
  ResearchMetric,
  ResearchPagination,
  ResearchStatus,
  type ResearchRecord,
} from "./shared";

const methods = {
  cash: "نقداً",
  transfer: "تحويل مصرفي",
  card: "بطاقة",
  pos: "جهاز دفع",
  other: "أخرى",
};
export function ResearchFinancialPanel({
  order,
  me,
}: {
  order: ResearchRecord;
  me: AdminMe;
}) {
  const query = useQuery<ResearchRecord>({
    queryKey: ["research", "financials", order.id],
    queryFn: () => researchFetch(`/orders/${order.id}/financials`),
  });
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  if (query.isPending) return <ResearchLoading />;
  if (query.isError)
    return (
      <ResearchFailure error={query.error} retry={() => void query.refetch()} />
    );
  const data = query.data;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ResearchMetric
          label="القيمة المتفق عليها"
          value={formatCurrency(data.totalAmount)}
        />
        <ResearchMetric
          label="المقبوض المعتمد"
          value={formatCurrency(data.paidAmount)}
        />
        <ResearchMetric
          label="المتبقي"
          value={formatCurrency(data.remainingAmount)}
        />
        <ResearchMetric
          label="طلبات دفعات معلقة"
          value={formatCurrency(data.pendingAmount)}
          hint="لا تخفض الرصيد حتى الموافقة"
        />
      </div>
      <Panel
        title="الحساب المالي"
        description={`استحقاق الدفع: ${dateText(data.paymentDueDate)} · ${FINANCIAL_STATUSES[data.paymentStatus] || data.paymentStatus}`}
        action={
          <div className="flex flex-wrap gap-2">
            {researchAccess(me, "research.payment.receive") && (
              <Button
                size="sm"
                disabled={Number(data.availableToRequest) <= 0}
                onClick={() => setPaymentOpen(true)}
              >
                <WalletCards data-icon="inline-start" />
                طلب استلام دفعة
              </Button>
            )}
            {researchAccess(me, "research.financials.view") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setExpenseOpen(true)}
              >
                <Plus data-icon="inline-start" />
                تسجيل مصروف
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => printResearchThermal(order, data)}
            >
              <Printer data-icon="inline-start" />
              80mm
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">
          المتاح لطلب دفعة:{" "}
          <bdi className="font-bold text-foreground">
            {formatCurrency(data.availableToRequest)}
          </bdi>
          . الطلبات والمدفوعات تخضع للموافقة المالية المركزية.
        </p>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المرجع / التاريخ</TableHead>
                <TableHead>الحركة</TableHead>
                <TableHead>المبلغ</TableHead>
                <TableHead>الطريقة</TableHead>
                <TableHead>الموافقة</TableHead>
                <TableHead>الوصل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.history?.length ? (
                data.history.map((row: any) => (
                  <TableRow key={`${row.sourceType}-${row.id}`}>
                    <TableCell>
                      <bdi>{row.transactionNo || row.id}</bdi>
                      <p className="text-xs text-muted-foreground">
                        {dateText(row.date)}
                      </p>
                    </TableCell>
                    <TableCell>
                      {row.direction === "revenue"
                        ? "قبض"
                        : row.direction === "expense"
                          ? "صرف / عكس"
                          : row.direction}
                      <p className="max-w-56 text-xs text-muted-foreground">
                        {row.notes}
                      </p>
                    </TableCell>
                    <TableCell>
                      <bdi>{formatCurrency(row.amount)}</bdi>
                    </TableCell>
                    <TableCell>
                      {methods[row.paymentMethod as keyof typeof methods] ||
                        row.paymentMethod}
                    </TableCell>
                    <TableCell>
                      <ApprovalBadge status={row.approvalStatus} />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`طباعة وصل ${row.transactionNo || row.id}`}
                        onClick={() => printResearchThermal(order, data, row)}
                      >
                        <Printer />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6}>
                    <ResearchEmpty
                      title="لا توجد حركات مالية"
                      description="سجّل طلب دفعة ليظهر في سجل الموافقات."
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Panel>
      <Panel
        title="مصاريف البحث"
        description="المصاريف المعتمدة منفصلة عن دفعات الطالب"
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <ResearchMetric
            label="المصاريف المعتمدة"
            value={formatCurrency(data.approvedExpenseAmount)}
          />
          <ResearchMetric
            label="مصاريف بانتظار الموافقة"
            value={formatCurrency(data.pendingExpenseAmount)}
          />
          <ResearchMetric
            label="القيمة التقديرية بعد المصاريف"
            value={formatCurrency(data.estimatedProfit)}
            hint="بعد المصاريف والمشتريات؛ قبل المصاريف العامة"
          />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>التصنيف / الوصف</TableHead>
                <TableHead>القيمة</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.expenses?.map((row: any) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {dateText(row.date || row.expenseDate || row.createdAt)}
                  </TableCell>
                  <TableCell>
                    {row.categoryName || row.category}
                    <p className="text-xs text-muted-foreground">
                      {row.name || row.description}
                    </p>
                  </TableCell>
                  <TableCell>
                    <bdi>{formatCurrency(row.amount)}</bdi>
                  </TableCell>
                  <TableCell>
                    <ApprovalBadge status={row.approvalStatus || row.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {!data.expenses?.length && (
          <ResearchEmpty
            title="لا توجد مصاريف لهذا البحث"
            description="تسجيل المصروف يرسله إلى الموافقات المالية."
          />
        )}
      </Panel>
      <ResearchPurchases orderId={order.id} me={me} />
      <ResearchMoneyDialog
        key={`payment-${paymentOpen}`}
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        orderId={order.id}
        available={Number(data.availableToRequest)}
        kind="payment"
      />
      <ResearchMoneyDialog
        key={`expense-${expenseOpen}`}
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        orderId={order.id}
        kind="expense"
      />
    </div>
  );
}
export function ApprovalBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    approved: "موافق عليه / بانتظار التنفيذ",
    executed: "منفذ",
    pending: "بانتظار الموافقة",
    pending_approval: "بانتظار الموافقة",
    rejected: "مرفوض",
    reversed: "معكوس",
    cancelled: "ملغى",
  };
  return (
    <Badge
      variant={
        status === "executed"
          ? "default"
          : status === "rejected"
            ? "destructive"
            : "secondary"
      }
    >
      {labels[status] || status}
    </Badge>
  );
}

export function ResearchMoneyDialog({
  open,
  onClose,
  orderId,
  available = Infinity,
  kind,
}: {
  open: boolean;
  onClose: () => void;
  orderId: number;
  available?: number;
  kind: "payment" | "expense";
}) {
  const { toast } = useToast();
  const cache = useQueryClient();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({
    amount: 0,
    method: "cash",
    notes: "",
    category: "research",
    description: "",
    paymentDate: "",
  });
  const [locked, setLocked] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      setLocked(true);
      const payload =
        kind === "payment"
          ? researchPaymentPayload(
              {
                amount: Number(form.amount),
                method: form.method,
                notes: form.notes,
                ...(form.paymentDate ? { paymentDate: form.paymentDate } : {}),
              },
              available,
              key,
            )
          : {
              amount: Number(form.amount),
              category: form.category,
              description: form.description,
              notes: form.notes,
              paymentMethod: form.method,
              ...(form.paymentDate ? { paymentDate: form.paymentDate } : {}),
              idempotencyKey: key,
            };
      return researchFetch(
        `/orders/${orderId}/${kind === "payment" ? "payment" : "expenses"}`,
        { method: "POST", body: JSON.stringify(payload) },
      );
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["research"] });
      toast({
        title:
          kind === "payment"
            ? "تم إرسال طلب الدفعة للموافقة"
            : "تم إرسال المصروف للموافقة",
        description: "يتغير الرصيد بعد تنفيذ الموافقة المركزية.",
      });
      onClose();
    },
    onError: (error) =>
      toast({
        title: "تعذر حفظ الطلب",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !save.isPending && onClose()}
    >
      <DialogContent dir="rtl" className="research-dialog">
        <DialogHeader>
          <DialogTitle>
            {kind === "payment" ? "طلب استلام دفعة بحث" : "تسجيل مصروف بحث"}
          </DialogTitle>
          <DialogDescription>
            تُرسل الحركة للموافقة المالية. لا تتغير الأرصدة قبل اعتمادها.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <FieldGroup>
            <ResearchField label="المبلغ" name="research-money-amount">
              <Input
                id="research-money-amount"
                type="number"
                min="0.01"
                step="0.01"
                max={kind === "payment" ? available : undefined}
                required
                value={form.amount || ""}
                disabled={locked}
                onChange={(event) =>
                  setForm({ ...form, amount: Number(event.target.value) })
                }
              />
            </ResearchField>
            <ResearchField label="طريقة الدفع" name="research-money-method">
              <Choice
                value={form.method}
                label="طريقة الدفع"
                options={methods}
                disabled={locked}
                onChange={(method) => setForm({ ...form, method })}
              />
            </ResearchField>
            <ResearchField
              label="تاريخ الدفعة (اختياري)"
              name="research-money-date"
            >
              <Input
                id="research-money-date"
                type="date"
                value={form.paymentDate}
                disabled={locked}
                onChange={(event) =>
                  setForm({ ...form, paymentDate: event.target.value })
                }
              />
            </ResearchField>
            {kind === "expense" && (
              <>
                <ResearchField
                  label="تصنيف المصروف"
                  name="research-expense-category"
                >
                  <Choice
                    label="تصنيف المصروف"
                    value={form.category}
                    disabled={locked}
                    onChange={(category) => setForm({ ...form, category })}
                    options={{
                      research: "خدمات بحثية",
                      writer: "أتعاب كاتب",
                  researcher: "أتعاب باحث",
                  programmer: "أتعاب مبرمج",
                  hardware: "مكونات هاردوير",
                      materials: "مواد ومستلزمات",
                      software: "برمجيات وتراخيص",
                      printing: "طباعة وتجليد",
                      other: "أخرى",
                    }}
                  />
                </ResearchField>
                <ResearchField
                  label="وصف المصروف"
                  name="research-expense-description"
                >
                  <Input
                    id="research-expense-description"
                    value={form.description}
                    required
                    minLength={2}
                    disabled={locked}
                    onChange={(event) =>
                      setForm({ ...form, description: event.target.value })
                    }
                  />
                </ResearchField>
              </>
            )}
            <ResearchField label="ملاحظات" name="research-money-notes">
              <Textarea
                id="research-money-notes"
                value={form.notes}
                disabled={locked}
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
              />
            </ResearchField>
          </FieldGroup>
          {save.isError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {apiErrorMessage(save.error)}
              {locked && " — أعد المحاولة بنفس البيانات لتجنب تكرار الحركة."}
            </p>
          )}
          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              إلغاء
            </Button>
            {locked && save.isError && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setKey(crypto.randomUUID());
                  setLocked(false);
                  save.reset();
                }}
              >
                تعديل بيانات الطلب
              </Button>
            )}
            <Button
              type="submit"
              disabled={
                save.isPending ||
                form.amount <= 0 ||
                (kind === "payment" && form.amount > available)
              }
            >
              {save.isPending && (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              )}
              {save.isError && locked
                ? "إعادة محاولة الطلب نفسه"
                : "إرسال للموافقة"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ResearchReceivables({
  onOpen,
}: {
  onOpen: (id: number) => void;
}) {
  const [filters, setFilters] = useState<ResearchFilters>(() => ({
    page: 1,
    pageSize: 20,
    financialStatus:
      new URLSearchParams(window.location.search).get("financialStatus") ||
      "all",
  }));
  const [reminder, setReminder] = useState<ResearchRecord | null>(null);
  const query = useQuery<ResearchRecord>({
    queryKey: ["research", "receivables", filters],
    queryFn: () =>
      researchFetch(`/receivables?${researchFilterParams(filters)}`),
  });
  return (
    <div className="flex flex-col gap-5">
      <ResearchFiltersBar
        financial
        dates
        filters={filters}
        onChange={(patch) => setFilters({ ...filters, ...patch, page: 1 })}
      />
      {query.isPending ? (
        <ResearchLoading />
      ) : query.isError ? (
        <ResearchFailure
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <ResearchMetric
              label="الذمم المتبقية"
              value={formatCurrency(
                query.data.summary.remaining ??
                  query.data.summary.remainingAmount,
              )}
            />
            <ResearchMetric
              label="الديون المتأخرة"
              value={formatCurrency(query.data.summary.overdueDebt)}
            />
            <ResearchMetric
              label="طلبات دفعات معلقة"
              value={formatCurrency(
                query.data.summary.pendingAmount ??
                  query.data.summary.pendingPayments,
              )}
            />
          </div>
          <Panel
            title="ذمم الطلاب"
            description="التأخير المالي يعتمد على موعد استحقاق الدفع فقط."
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الطالب / البحث</TableHead>
                    <TableHead>المتبقي</TableHead>
                    <TableHead>دفعات معلقة</TableHead>
                    <TableHead>استحقاق الدفع</TableHead>
                    <TableHead>آخر دفعة</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((order: any) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <button
                          className="text-start hover:underline"
                          onClick={() => onOpen(order.id)}
                        >
                          <strong>{order.customerName}</strong>
                          <p className="max-w-64 truncate text-xs text-muted-foreground">
                            {order.researchNo} · {order.title}
                          </p>
                          <bdi className="text-xs">{order.customerPhone}</bdi>
                        </button>
                      </TableCell>
                      <TableCell>
                        <bdi>{formatCurrency(order.remainingAmount)}</bdi>
                      </TableCell>
                      <TableCell>
                        <bdi>{formatCurrency(order.pendingAmount)}</bdi>
                      </TableCell>
                      <TableCell>{dateText(order.paymentDueDate)}</TableCell>
                      <TableCell>{dateText(order.lastPaymentDate)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            order.financialStatus === "overdue"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {FINANCIAL_STATUSES[order.financialStatus] ||
                            order.financialStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" asChild>
                            <a
                              href={`/admin/research/accounts?student=${order.customerId}`}
                            >
                              كشف حساب
                            </a>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setReminder(order)}
                          >
                            <Send data-icon="inline-start" />
                            تذكير
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {!query.data.items.length && (
              <ResearchEmpty
                title="لا توجد ذمم مطابقة"
                description="غيّر التصفية لعرض بقية حسابات الأبحاث."
              />
            )}
            <ResearchPagination
              pagination={query.data.pagination}
              page={filters.page || 1}
              onPage={(page) => setFilters({ ...filters, page })}
            />
          </Panel>
        </>
      )}
      {reminder && (
        <ResearchReminder order={reminder} onClose={() => setReminder(null)} />
      )}
    </div>
  );
}
function ResearchReminder({
  order,
  onClose,
}: {
  order: ResearchRecord;
  onClose: () => void;
}) {
  const [message, setMessage] = useState(() => reminderPreview(order));
  const link = whatsappLink(order.customerPhone || "", message);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="research-dialog">
        <DialogHeader>
          <DialogTitle>مراجعة تذكير WhatsApp</DialogTitle>
          <DialogDescription>
            راجع النص قبل فتح WhatsApp. الإرسال يتم بواسطتك من التطبيق.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="نص التذكير"
          rows={8}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        {!link && (
          <p role="alert" className="text-sm text-destructive">
            رقم الهاتف غير صالح. صحح بيانات الطالب قبل المتابعة.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
          {link && (
            <Button asChild>
              <a href={link} target="_blank" rel="noreferrer">
                فتح WhatsApp لمراجعة الإرسال
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ResearchStudentStatement({
  onOpen,
}: {
  onOpen: (id: number) => void;
}) {
  const { toast } = useToast();
  const [shareText,setShareText]=useState<string|null>(null);
  const [customerId, setCustomerId] = useState(
    () =>
      Number(new URLSearchParams(window.location.search).get("student")) || 0,
  );
  const [dates, setDates] = useState({ from: "", to: "" });
  const [busy, setBusy] = useState(false);
  const query = useQuery<ResearchRecord>({
    queryKey: ["research", "statement", customerId, dates],
    queryFn: () =>
      researchFetch(
        `/students/${customerId}/statement?${researchFilterParams(dates)}`,
      ),
    enabled: customerId > 0,
  });
  const columns = [
    { key: "date", header: "التاريخ", width: 12 },
    { key: "reference", header: "المرجع", width: 16 },
    { key: "description", header: "التفاصيل", width: 30 },
    { key: "receivedByName", header: "الموظف المستلم", width: 18 },
    { key: "debit", header: "مدين", width: 14, kind: "money" as const },
    { key: "credit", header: "دائن", width: 14, kind: "money" as const },
    { key: "balance", header: "الرصيد", width: 14, kind: "money" as const },
  ];
  async function exportData(mode: "print" | "download" | "excel") {
    if (!query.data) return;
    setBusy(true);
    try {
      await exportResearchTable({
        mode,
        title: `كشف حساب أبحاث — ${query.data.customer.name}`,
        rows: query.data.entries,
        from: dates.from,
        to: dates.to,
        columns,
        financial: true,
        subtitle: `رصيد افتتاحي: ${formatCurrency(query.data.openingBalance)} · رصيد ختامي: ${formatCurrency(query.data.closingBalance)} · قسم البحوث العلمية فقط`,
      });
    } catch (error) {
      toast({
        title: "تعذر تصدير كشف الحساب",
        description: apiErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="كشف حساب الطالب"
        description="عرض حساب الأبحاث فقط، وفق الحركات المعتمدة."
      >
        <Dialog open={shareText!==null} onOpenChange={open=>!open&&setShareText(null)}><DialogContent dir="rtl" className="research-dialog"><DialogHeader><DialogTitle>مراجعة مشاركة كشف الحساب</DialogTitle><DialogDescription>راجع النص؛ الإرسال يتم يدوياً من WhatsApp.</DialogDescription></DialogHeader><Textarea aria-label="نص كشف الحساب للمشاركة" rows={9} value={shareText||''} onChange={event=>setShareText(event.target.value)}/><DialogFooter><Button variant="outline" onClick={()=>setShareText(null)}>إغلاق</Button>{whatsappLink(query.data?.customer.phone||'',shareText||'')&&<Button asChild><a href={whatsappLink(query.data?.customer.phone||'',shareText||'')!} target="_blank" rel="noreferrer">فتح WhatsApp للمراجعة</a></Button>}</DialogFooter></DialogContent></Dialog>
        <SmartCustomerSearch
          showFinancial={false}
          allowCreate={false}
          onSelect={(customer) => setCustomerId(customer.id)}
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ResearchField label="من تاريخ" name="statement-from">
            <Input
              id="statement-from"
              type="date"
              value={dates.from}
              onChange={(event) =>
                setDates({ ...dates, from: event.target.value })
              }
            />
          </ResearchField>
          <ResearchField label="إلى تاريخ" name="statement-to">
            <Input
              id="statement-to"
              type="date"
              value={dates.to}
              onChange={(event) =>
                setDates({ ...dates, to: event.target.value })
              }
            />
          </ResearchField>
        </div>
      </Panel>
      {!customerId ? (
        <ResearchEmpty
          title="اختر طالباً لعرض حسابه"
          description="ابحث بالاسم أو رقم الهاتف أو رمز العميل."
        />
      ) : query.isPending ? (
        <ResearchLoading />
      ) : query.isError ? (
        <ResearchFailure
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <ResearchMetric
              label="الرصيد الافتتاحي"
              value={formatCurrency(query.data.openingBalance)}
            />
            <ResearchMetric
              label="الرصيد الختامي"
              value={formatCurrency(query.data.closingBalance)}
            />
            <ResearchMetric
              label="ذمم أبحاث الطالب"
              value={formatCurrency(query.data.documentsRemaining)}
            />
          </div>
          <Panel
            title={query.data.customer.name}
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
                  Excel
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={()=>{try{printResearchStudentStatementThermal(query.data!)}catch(error){toast({title:'تعذرت الطباعة',description:apiErrorMessage(error),variant:'destructive'})}}}>80mm</Button>
                <Button size="sm" variant="outline" onClick={()=>setShareText(researchStatementShareText(query.data!))}><Send data-icon="inline-start"/>WhatsApp</Button>
              </div>
            }
          >
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
                  {query.data.entries.map((entry: any, index: number) => (
                    <TableRow key={entry.id || index}>
                      {columns.map((column) => (
                        <TableCell key={column.key}>
                          {column.kind === "money" ? (
                            <bdi>{formatCurrency(entry[column.key])}</bdi>
                          ) : column.key === "date" ? (
                            dateText(entry.date)
                          ) : (
                            entry[column.key] || "—"
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {!query.data.entries.length && (
              <ResearchEmpty
                title="لا توجد حركات ضمن الفترة"
                description="الرصيد الافتتاحي يحتفظ بالحركات السابقة للفترة."
              />
            )}
          </Panel>
          <Panel title="أبحاث الطالب">
            <div className="flex flex-col gap-2">
              {query.data.documents?.map((order: any) => (
                <button
                  key={order.sourceId || order.id}
                  onClick={() =>
                    order.researchOrderId
                      ? onOpen(order.researchOrderId)
                      : window.location.assign(
                          `/admin/sales?invoice=${order.sourceId}`,
                        )
                  }
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-start text-sm hover:bg-muted"
                >
                  <span>
                    {order.reference || order.researchNo} · {order.title}
                  </span>
                  <bdi>
                    {formatCurrency(order.remaining ?? order.remainingAmount)}
                  </bdi>
                </button>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
