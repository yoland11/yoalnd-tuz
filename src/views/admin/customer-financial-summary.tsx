import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, WalletCards } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { adminFetch, formatCurrency } from "./_lib";

/**
 * CustomerFinancialSummary — the ONE shared view of a customer's whole account,
 * fed exclusively by the canonical server derivation (GET
 * /admin/customers/:id/account). Every module that shows "حساب العميل" reuses
 * this so the numbers can never drift between pages.
 *
 * IMPORTANT: this is the CUSTOMER-WIDE balance (all bookings/orders/invoices),
 * which is deliberately distinct from any single booking's balance.
 */

export type CustomerAccountSummaryPayload = {
  customerId: number;
  totalReceivable: number;
  totalPaid: number;
  currentBalance: number;
  documentCount: number;
  unlinkedByPhoneCount: number;
  sources: Array<{
    sourceType: string;
    sourceId: number;
    reference: string;
    date: string | null;
    total: number;
    paid: number;
    remaining: number;
    paymentStatus: string;
    linkedById: boolean;
  }>;
};

export function CustomerFinancialSummary({
  customerId,
  compact = false,
}: {
  customerId?: number | null;
  compact?: boolean;
}) {
  const account = useQuery<{ account: CustomerAccountSummaryPayload }>({
    queryKey: ["admin", "customer-account", customerId],
    queryFn: () => adminFetch(`/admin/customers/${customerId}/account`),
    enabled: Boolean(customerId),
    staleTime: 15_000,
  });

  if (!customerId) return null;

  const summary = account.data?.account;
  const balanceTone =
    (summary?.currentBalance ?? 0) > 0 ? "text-status-danger" : "text-status-success";

  return (
    <section
      className={`rounded-xl border border-primary/20 bg-primary/5 ${compact ? "p-3" : "p-4"}`}
      dir="rtl"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <WalletCards className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">حساب العميل</h3>
          <span className="text-[11px] font-semibold text-muted-foreground">
            (كل الحجوزات والفواتير)
          </span>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/admin/customers?customer=${customerId}`}>
            <ExternalLink className="h-3.5 w-3.5" /> كشف الحساب
          </Link>
        </Button>
      </div>

      {account.isLoading ? (
        <p className="text-xs text-muted-foreground">جارٍ حساب رصيد العميل…</p>
      ) : account.isError ? (
        <p className="text-xs text-status-danger">تعذر تحميل حساب العميل.</p>
      ) : summary ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <SummaryCell label="إجمالي المستحق" value={formatCurrency(summary.totalReceivable)} />
            <SummaryCell
              label="إجمالي المقبوض"
              value={formatCurrency(summary.totalPaid)}
              tone="text-status-success"
            />
            <SummaryCell
              label="المتبقي في الذمة"
              value={formatCurrency(summary.currentBalance)}
              tone={balanceTone}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            محسوب من {summary.documentCount} مستنداً عبر كل خدمات AJN.
          </p>
          {summary.unlinkedByPhoneCount > 0 ? (
            <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-status-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              {summary.unlinkedByPhoneCount} مستند مرتبط بالهاتف فقط ويحتاج ربطاً نهائياً بالعميل.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function SummaryCell({
  label,
  value,
  tone = "text-foreground",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-background/50 p-2 text-center">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${tone}`}>{value}</div>
    </div>
  );
}
