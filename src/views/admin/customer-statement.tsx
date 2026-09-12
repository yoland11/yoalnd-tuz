import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { adminFetch, formatCurrency } from "./_lib";

/**
 * CustomerStatement — the shared كشف حساب العميل view. It renders the canonical
 * chronological ledger from GET /admin/customers/:id/statement (debit = a
 * receivable document, credit = an executed payment) with a running balance.
 * Read-only; every value comes from one server derivation.
 */

type StatementEntry = {
  date: string | null;
  type: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
};

const fmtDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("ar-IQ-u-nu-latn", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

export function CustomerStatement({ customerId }: { customerId?: number | null }) {
  const query = useQuery<{
    statement: { entries: StatementEntry[]; closingBalance: number };
  }>({
    queryKey: ["admin", "customer-statement", customerId],
    queryFn: () => adminFetch(`/admin/customers/${customerId}/statement`),
    enabled: Boolean(customerId),
    staleTime: 15_000,
  });

  if (!customerId) return null;

  const entries = query.data?.statement.entries ?? [];
  const closing = query.data?.statement.closingBalance ?? 0;

  return (
    <section className="rounded-xl border border-border/25 bg-background/40 p-4" dir="rtl">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <FileText className="h-4 w-4 text-primary" /> كشف حساب العميل
      </h4>
      {query.isLoading ? (
        <p className="text-xs text-muted-foreground">جارٍ تحميل كشف الحساب…</p>
      ) : query.isError ? (
        <p className="text-xs text-status-danger">تعذر تحميل كشف الحساب.</p>
      ) : entries.length ? (
        <div className="overflow-x-auto rounded-lg border border-border/30">
          <table className="w-full min-w-[720px] text-right text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {["التاريخ", "النوع", "المرجع", "البيان", "مدين", "دائن", "الرصيد"].map((head) => (
                  <th key={head} className="p-2 font-semibold">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={index} className="border-t border-border/20">
                  <td className="p-2 whitespace-nowrap">{fmtDate(entry.date)}</td>
                  <td className="p-2 font-semibold">{entry.type}</td>
                  <td className="p-2 tabular-nums" dir="ltr">{entry.reference}</td>
                  <td className="p-2">{entry.description}</td>
                  <td className="p-2 tabular-nums text-status-danger">{entry.debit ? formatCurrency(entry.debit) : "—"}</td>
                  <td className="p-2 tabular-nums text-status-success">{entry.credit ? formatCurrency(entry.credit) : "—"}</td>
                  <td className="p-2 tabular-nums font-bold">{formatCurrency(entry.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border/40 font-bold">
                <td className="p-2" colSpan={6}>الرصيد الحالي في الذمة</td>
                <td className="p-2 tabular-nums text-status-danger">{formatCurrency(closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">لا توجد حركات في كشف الحساب.</p>
      )}
    </section>
  );
}
