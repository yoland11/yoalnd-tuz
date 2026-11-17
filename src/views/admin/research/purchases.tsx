import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { apiErrorMessage, hasPerm, type AdminMe } from "../_lib";
import {
  dateText,
  Panel,
  researchFetch,
  ResearchEmpty,
  ResearchFailure,
  ResearchLoading,
  ResearchMetric,
  type ResearchRecord,
} from "./shared";

export function ResearchPurchases({
  orderId,
  me,
}: {
  orderId: number;
  me: AdminMe;
}) {
  const { toast } = useToast();
  const cache = useQueryClient();
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const query = useQuery<ResearchRecord>({
    queryKey: ["research", "purchases", orderId, submitted],
    queryFn: () =>
      researchFetch(
        `/orders/${orderId}/purchases${submitted ? `?search=${encodeURIComponent(submitted)}` : ""}`,
      ),
  });
  const link = useMutation({
    mutationFn: (purchaseInvoiceId: number) =>
      researchFetch(`/orders/${orderId}/purchases`, {
        method: "POST",
        body: JSON.stringify({ purchaseInvoiceId }),
      }),
    onSuccess: () => {
      setSubmitted("");
      setSearch("");
      void cache.invalidateQueries({ queryKey: ["research"] });
      toast({
        title: "تم ربط فاتورة الشراء بالبحث",
        description: "تحتسب تكلفة الفاتورة مرة واحدة ضمن تكلفة البحث.",
      });
    },
    onError: (error) =>
      toast({
        title: "تعذر ربط فاتورة الشراء",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  return (
    <Panel
      title="مشتريات ومواد البحث"
      description="ربط فواتير الشراء الحالية يحدد تكلفة مواد البحث ويحتفظ بحساب المورد والمخزون الأصلي."
    >
      {query.isPending ? (
        <ResearchLoading />
      ) : query.isError ? (
        <ResearchFailure
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <ResearchMetric
              label="تكلفة المشتريات"
              value={formatCurrency(query.data.costSummary.purchaseCost)}
            />
            <ResearchMetric
              label="المدفوع للموردين"
              value={formatCurrency(query.data.costSummary.paidToSuppliers)}
            />
            <ResearchMetric
              label="المتبقي للموردين"
              value={formatCurrency(query.data.costSummary.supplierRemaining)}
            />
          </div>
          <PurchaseTable items={query.data.items} />
          {hasPerm(me, "accounting") && (
            <>
              <Alert>
                <AlertTitle>ربط فاتورة شراء موجودة</AlertTitle>
                <AlertDescription>
                  تُربط الفاتورة كاملة بهذا البحث وتُحتسب تكلفتها مرة واحدة.
                  استخدم فاتورة مشتريات خاصة بمواد هذا البحث.
                </AlertDescription>
              </Alert>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSubmitted(search.trim());
                }}
              >
                <Input
                  className="min-w-0 flex-1"
                  aria-label="البحث عن فاتورة شراء"
                  placeholder="رقم فاتورة الشراء أو اسم المورد"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={search.trim().length < 2}
                >
                  <Search data-icon="inline-start" />
                  بحث
                </Button>
              </form>
              {submitted &&
                (query.data.candidates?.length ? (
                  <PurchaseTable
                    items={query.data.candidates}
                    onLink={(id) => link.mutate(id)}
                    busy={link.isPending}
                  />
                ) : (
                  <ResearchEmpty
                    title="لا توجد فواتير شراء متاحة مطابقة"
                    description="يستبعد البحث الفواتير المرتبطة ببحث أو مركز تكلفة آخر."
                  />
                ))}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
function PurchaseTable({
  items,
  onLink,
  busy,
}: {
  items: ResearchRecord[];
  onLink?: (id: number) => void;
  busy?: boolean;
}) {
  if (!items.length)
    return (
      <ResearchEmpty
        title="لا توجد مشتريات مرتبطة"
        description="يمكن ربط فواتير المواد من سجل المشتريات الحالي."
      />
    );
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>الفاتورة</TableHead>
            <TableHead>المورد</TableHead>
            <TableHead>التاريخ</TableHead>
            <TableHead>القيمة</TableHead>
            <TableHead>المدفوع</TableHead>
            <TableHead>المتبقي</TableHead>
            {onLink && <TableHead>الربط</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((invoice) => (
            <TableRow key={invoice.id}>
              <TableCell>
                <bdi>{invoice.invoiceNo}</bdi>
              </TableCell>
              <TableCell>{invoice.supplierName}</TableCell>
              <TableCell>{dateText(invoice.date)}</TableCell>
              <TableCell>
                <bdi>{formatCurrency(invoice.total)}</bdi>
              </TableCell>
              <TableCell>
                <bdi>{formatCurrency(invoice.paidAmount)}</bdi>
              </TableCell>
              <TableCell>
                <bdi>{formatCurrency(invoice.remainingAmount)}</bdi>
              </TableCell>
              {onLink && (
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onLink(invoice.id)}
                  >
                    <Link2 data-icon="inline-start" />
                    ربط بالبحث
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
