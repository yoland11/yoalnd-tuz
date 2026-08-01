import { AlertCircle, CheckCircle2, Clock, Gauge, ReceiptText, WalletCards } from "lucide-react";
import { formatCurrency } from "./_lib";
import {
  INVOICE_PAYMENT_STATUS_LABELS,
  type InvoicePaymentStatus,
} from "@/lib/invoice-payment-status";

export type InvoiceRegisterSummary = {
  totalInvoices: number;
  unpaidTotal: string;
  partialTotal: string;
  paidTotal: string;
  overpaidTotal: string;
  remainingTotal: string;
};

const PAYMENT_STATUS_BADGES: Record<
  InvoicePaymentStatus,
  { icon: typeof AlertCircle; className: string }
> = {
  unpaid: {
    icon: AlertCircle,
    className: "bg-status-danger/12 text-status-danger ring-status-danger/20",
  },
  partial: {
    icon: Clock,
    className: "bg-status-warning/15 text-status-warning ring-status-warning/25",
  },
  paid: {
    icon: CheckCircle2,
    className: "bg-status-success/12 text-status-success ring-status-success/20",
  },
  overpaid: {
    icon: Gauge,
    className: "bg-purple-500/15 text-purple-500 ring-purple-500/25",
  },
};

export function InvoicePaymentStatusBadge({ status }: { status: string }) {
  const normalized = status as InvoicePaymentStatus;
  const config = PAYMENT_STATUS_BADGES[normalized];
  if (!config) {
    return (
      <span className="inline-flex rounded-full bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
        {status || "—"}
      </span>
    );
  }
  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center justify-center gap-1 rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${config.className}`}
    >
      <Icon className="h-3 w-3" />
      {INVOICE_PAYMENT_STATUS_LABELS[normalized]}
    </span>
  );
}

export function InvoiceRegisterSummaryCards({
  summary,
}: {
  summary?: InvoiceRegisterSummary;
}) {
  const cards = [
    {
      label: "إجمالي الفواتير",
      value: String(summary?.totalInvoices ?? 0),
      icon: ReceiptText,
      className: "text-primary bg-primary/10",
    },
    {
      label: "إجمالي غير المدفوع",
      value: formatCurrency(summary?.unpaidTotal ?? 0),
      icon: AlertCircle,
      className: "text-status-danger bg-status-danger/10",
    },
    {
      label: "إجمالي المدفوع جزئياً",
      value: formatCurrency(summary?.partialTotal ?? 0),
      icon: Clock,
      className: "text-status-warning bg-status-warning/10",
    },
    {
      label: "إجمالي المدفوع بالكامل",
      value: formatCurrency(summary?.paidTotal ?? 0),
      icon: CheckCircle2,
      className: "text-status-success bg-status-success/10",
    },
    {
      label: "إجمالي المبالغ المتبقية",
      value: formatCurrency(summary?.remainingTotal ?? 0),
      icon: WalletCards,
      className: "text-purple-500 bg-purple-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.label}
          className="flex items-center gap-3 rounded-xl border border-border/40 bg-card p-3"
        >
          <span className={`rounded-lg p-2 ${card.className}`}>
            <card.icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">{card.label}</span>
            <span className="block truncate text-sm font-bold text-foreground">{card.value}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

