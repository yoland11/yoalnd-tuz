import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, Download, FileText, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadElementPdf } from "@/lib/pdf";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";

const VOUCHER_METHODS: Array<[string, string]> = [
  ["cash", "نقداً"],
  ["transfer", "تحويل"],
  ["card", "بطاقة"],
];

/**
 * CustomerStatement — the shared كشف حساب العميل view. It renders the canonical
 * chronological ledger from GET /admin/customers/:id/statement (debit = a
 * receivable document, credit = an executed payment) with a running balance.
 * Read-only; every value comes from one server derivation.
 *
 * It also offers a "تحميل PDF" export of a clean, self-contained A4 statement
 * (built off a hidden print node so the file stays theme-independent and sharp).
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

const printedAt = () =>
  new Date().toLocaleString("ar-IQ-u-nu-latn", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function CustomerStatement({
  customerId,
  customerName,
  customerPhone,
  customerCode,
}: {
  customerId?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerCode?: string | null;
}) {
  const query = useQuery<{
    statement: { entries: StatementEntry[]; closingBalance: number };
  }>({
    queryKey: ["admin", "customer-statement", customerId],
    queryFn: () => adminFetch(`/admin/customers/${customerId}/statement`),
    enabled: Boolean(customerId),
    staleTime: 15_000,
  });

  const printRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const queryClient = useQueryClient();
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherType, setVoucherType] = useState<"receipt" | "payment">("receipt");
  const [voucherAmount, setVoucherAmount] = useState("");
  const [voucherMethod, setVoucherMethod] = useState("cash");
  const [voucherNote, setVoucherNote] = useState("");

  const submitVoucher = useMutation({
    mutationFn: () => {
      const amount = Number(voucherAmount) || 0;
      const date = new Date().toISOString().slice(0, 10);
      if (voucherType === "receipt") {
        // سند قبض — money received from the customer (credits their statement,
        // adds to the cash box). An unallocated receipt is saved as a customer credit.
        return adminFetch("/admin/receipt-vouchers", {
          method: "POST",
          body: JSON.stringify({
            date,
            amount,
            customerId,
            accountType: "customer",
            accountId: customerId,
            payerName: customerName || "",
            customerPhone: customerPhone || "",
            method: voucherMethod,
            saveRemainderAsCredit: true,
            notes: voucherNote || undefined,
          }),
        });
      }
      // سند صرف — money paid out to the customer.
      return adminFetch("/admin/payment-vouchers", {
        method: "POST",
        body: JSON.stringify({
          date,
          amount,
          customerId,
          payeeName: customerName || "",
          customerPhone: customerPhone || "",
          method: voucherMethod,
          notes: voucherNote || undefined,
        }),
      });
    },
    onSuccess: () => {
      toast.success(voucherType === "receipt" ? "تم تسجيل سند القبض" : "تم تسجيل سند الصرف");
      setVoucherOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "customer-statement", customerId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "customer-account"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "receipt-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "payment-vouchers"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "تعذّر حفظ السند")),
  });

  if (!customerId) return null;

  const entries = query.data?.statement.entries ?? [];
  const closing = query.data?.statement.closingBalance ?? 0;
  const totalDebit = entries.reduce((sum, entry) => sum + (Number(entry.debit) || 0), 0);
  const totalCredit = entries.reduce((sum, entry) => sum + (Number(entry.credit) || 0), 0);

  const openVoucher = (type: "receipt" | "payment" = "receipt") => {
    setVoucherType(type);
    setVoucherAmount(String(Math.max(0, Math.round(closing)) || ""));
    setVoucherMethod("cash");
    setVoucherNote("");
    setVoucherOpen(true);
  };

  const downloadPdf = async () => {
    if (!printRef.current || !entries.length) return;
    setExporting(true);
    try {
      const namePart = (customerName || customerCode || customerId).toString().replace(/[\\/:*?"<>|]/g, "").trim();
      await downloadElementPdf(printRef.current, `كشف-حساب-${namePart}.pdf`, {
        format: "a4",
        margin: [10, 10, 12, 10],
        pagebreakMode: ["css", "legacy"],
      });
      toast.success("تم حفظ كشف الحساب PDF");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "تعذر إنشاء ملف PDF");
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="rounded-xl border border-border/25 bg-background/40 p-4" dir="rtl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileText className="h-4 w-4 text-primary" /> كشف حساب العميل
        </h4>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => openVoucher("receipt")}>
            <Wallet className="h-3.5 w-3.5" /> قبض / صرف
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadPdf}
            disabled={exporting || !entries.length}
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            تحميل PDF
          </Button>
        </div>
      </div>
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
              <tr
                className="cursor-pointer border-t-2 border-border/40 font-bold transition hover:bg-primary/5"
                onClick={() => openVoucher("receipt")}
                title="اضغط لتسجيل سند قبض أو صرف"
              >
                <td className="p-2" colSpan={6}>
                  الرصيد الحالي في الذمة
                  <span className="mr-2 text-[11px] font-normal text-primary">(اضغط للقبض/الصرف)</span>
                </td>
                <td className="p-2 tabular-nums text-status-danger">{formatCurrency(closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">لا توجد حركات في كشف الحساب.</p>
      )}

      {/* Hidden, theme-independent A4 layout used only for the PDF export. */}
      {entries.length ? (
        <div style={{ position: "fixed", left: "-100000px", top: 0, pointerEvents: "none" }} aria-hidden>
          <div
            ref={printRef}
            dir="rtl"
            style={{
              width: "794px",
              background: "#ffffff",
              color: "#111827",
              padding: "24px",
              fontFamily: "Cairo, Tahoma, Arial, sans-serif",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", borderBottom: "2px solid #111827", paddingBottom: "10px", marginBottom: "12px" }}>
              <div>
                <div style={{ fontSize: "20px", fontWeight: 800 }}>AJN — مجموعة علي جان نهاد</div>
                <div style={{ fontSize: "12px", color: "#4b5563" }}>لتنظيم المناسبات</div>
                <div style={{ fontSize: "15px", fontWeight: 700, marginTop: "4px" }}>كشف حساب العميل</div>
              </div>
              <div style={{ fontSize: "12px", lineHeight: 1.9, textAlign: "left" }}>
                {customerName ? <div><b>العميل:</b> {customerName}</div> : null}
                {customerPhone ? <div dir="ltr" style={{ textAlign: "left" }}><b>الهاتف:</b> {customerPhone}</div> : null}
                {customerCode ? <div dir="ltr" style={{ textAlign: "left" }}><b>الكود:</b> {customerCode}</div> : null}
                <div><b>تاريخ الطباعة:</b> {printedAt()}</div>
              </div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr>
                  {["التاريخ", "النوع", "المرجع", "البيان", "مدين", "دائن", "الرصيد"].map((head) => (
                    <th key={head} style={{ border: "1px solid #111827", background: "#f3f4f6", padding: "6px", fontWeight: 800, textAlign: "right" }}>{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={index} style={{ breakInside: "avoid" }}>
                    <td style={{ border: "1px solid #d1d5db", padding: "5px 6px", whiteSpace: "nowrap" }}>{fmtDate(entry.date)}</td>
                    <td style={{ border: "1px solid #d1d5db", padding: "5px 6px", fontWeight: 700 }}>{entry.type}</td>
                    <td style={{ border: "1px solid #d1d5db", padding: "5px 6px", direction: "ltr", textAlign: "right" }}>{entry.reference}</td>
                    <td style={{ border: "1px solid #d1d5db", padding: "5px 6px" }}>{entry.description}</td>
                    <td style={{ border: "1px solid #d1d5db", padding: "5px 6px", direction: "ltr", textAlign: "left", whiteSpace: "nowrap" }}>{entry.debit ? formatCurrency(entry.debit) : "—"}</td>
                    <td style={{ border: "1px solid #d1d5db", padding: "5px 6px", direction: "ltr", textAlign: "left", whiteSpace: "nowrap" }}>{entry.credit ? formatCurrency(entry.credit) : "—"}</td>
                    <td style={{ border: "1px solid #d1d5db", padding: "5px 6px", direction: "ltr", textAlign: "left", whiteSpace: "nowrap", fontWeight: 800 }}>{formatCurrency(entry.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ border: "1px solid #111827", padding: "6px", fontWeight: 800, background: "#f3f4f6" }}>الإجماليات</td>
                  <td style={{ border: "1px solid #111827", padding: "6px", direction: "ltr", textAlign: "left", fontWeight: 800, background: "#f3f4f6", whiteSpace: "nowrap" }}>{formatCurrency(totalDebit)}</td>
                  <td style={{ border: "1px solid #111827", padding: "6px", direction: "ltr", textAlign: "left", fontWeight: 800, background: "#f3f4f6", whiteSpace: "nowrap" }}>{formatCurrency(totalCredit)}</td>
                  <td style={{ border: "1px solid #111827", padding: "6px", background: "#f3f4f6" }} />
                </tr>
              </tfoot>
            </table>

            <div style={{ marginTop: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "2px solid #111827", padding: "8px 12px", fontSize: "15px", fontWeight: 800 }}>
              <span>الرصيد الحالي في الذمة</span>
              <span style={{ direction: "ltr" }}>{formatCurrency(closing)}</span>
            </div>
            <div style={{ marginTop: "24px", fontSize: "11px", color: "#6b7280", textAlign: "center" }}>
              كشف للقراءة والطباعة فقط · لا ينشئ ولا يعدّل أي حركة مالية · صادر من نظام AJN.
            </div>
          </div>
        </div>
      ) : null}

      <Dialog open={voucherOpen} onOpenChange={(open) => !open && setVoucherOpen(false)}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{voucherType === "receipt" ? "سند قبض" : "سند صرف"}</DialogTitle>
            <DialogDescription>
              {voucherType === "receipt" ? "استلام مبلغ من العميل — يُضاف للصندوق ويقيَّد في كشف الحساب." : "صرف مبلغ للعميل — يخرج من الصندوق."}
              {customerName ? ` · ${customerName}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-1">
              <button
                type="button"
                onClick={() => setVoucherType("receipt")}
                className={`flex items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-semibold transition ${voucherType === "receipt" ? "bg-status-success text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ArrowDownCircle className="h-4 w-4" /> سند قبض
              </button>
              <button
                type="button"
                onClick={() => setVoucherType("payment")}
                className={`flex items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-semibold transition ${voucherType === "payment" ? "bg-status-danger text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ArrowUpCircle className="h-4 w-4" /> سند صرف
              </button>
            </div>
            <div className="rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
              الرصيد الحالي في الذمة: <b className="text-foreground tabular-nums" dir="ltr">{formatCurrency(closing)}</b>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">المبلغ (د.ع)</span>
              <input
                type="number"
                min={0}
                value={voucherAmount}
                onChange={(event) => setVoucherAmount(event.target.value)}
                className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-primary"
                dir="ltr"
                autoFocus
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">طريقة الدفع</span>
              <select
                value={voucherMethod}
                onChange={(event) => setVoucherMethod(event.target.value)}
                className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                {VOUCHER_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">ملاحظة (اختياري)</span>
              <input
                value={voucherNote}
                onChange={(event) => setVoucherNote(event.target.value)}
                className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                placeholder="بيان السند"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoucherOpen(false)}>إلغاء</Button>
            <Button
              disabled={submitVoucher.isPending || !(Number(voucherAmount) > 0)}
              onClick={() => submitVoucher.mutate()}
              className={voucherType === "receipt" ? "bg-status-success text-white hover:bg-status-success/90" : "bg-status-danger text-white hover:bg-status-danger/90"}
            >
              {submitVoucher.isPending ? "جارٍ الحفظ…" : voucherType === "receipt" ? "تسجيل القبض" : "تسجيل الصرف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
