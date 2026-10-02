import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowUpRight, CalendarDays, FileText, Package, ShoppingBag, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch, formatCurrency } from "./_lib";

type Invoice = { id: number; invoiceNo: string; date: string; customerName: string; customerPhone?: string | null; total: number | string; paidAmount: number | string; remainingAmount: number | string; paymentStatus: string; status: string };
type Register = { data: Invoice[]; total: number; topProducts?: Array<{ productName: string; quantity: number; revenue: number }>; summary: { totalInvoices: number; totalSales: string; collectedTotal: string; remainingTotal: string } };

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;

export default function WholesalePage() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const params = new URLSearchParams({ saleType: "wholesale", from, to, status: "active", limit: "100" });
  const { data, isLoading, error } = useQuery<Register>({
    queryKey: ["admin", "wholesale-sales", from, to],
    queryFn: () => adminFetch(`/sales-invoices?${params.toString()}`),
  });
  const { data: customers, isLoading: customersLoading, error: customersError } = useQuery<any[]>({
    queryKey: ["admin", "wholesale-customers-dashboard"],
    queryFn: () => adminFetch("/customers?limit=500"),
  });
  const wholesaleCustomers = customers?.filter((customer) => customer.customerType === "wholesale") ?? [];
  const summary = data?.summary;
  const cards = [
    { label: "مبيعات الجملة", value: formatCurrency(Number(summary?.totalSales ?? 0)), icon: ShoppingBag },
    { label: "المبلغ المحصل", value: formatCurrency(Number(summary?.collectedTotal ?? 0)), icon: Wallet },
    { label: "ديون العملاء", value: formatCurrency(Number(summary?.remainingTotal ?? 0)), icon: FileText },
    { label: "فواتير الجملة", value: String(summary?.totalInvoices ?? 0), icon: FileText },
    { label: "عملاء الجملة", value: customersLoading ? "…" : customersError ? "تعذر التحميل" : String(wholesaleCustomers.length), icon: Users },
  ];

  return <div dir="rtl" className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-bold">مبيعات الجملة</h1><p className="mt-1 text-sm text-muted-foreground">نفس المنتجات والمخزون والفواتير والحسابات المعتمدة في نقطة البيع.</p></div>
      <div className="flex flex-wrap gap-2">
        <Button asChild><Link href="/admin/pos"><ShoppingBag className="ml-2 h-4 w-4" />بيع جديد</Link></Button>
        <Button variant="outline" asChild><Link href="/admin/customers">عملاء الجملة<ArrowUpRight className="mr-2 h-4 w-4" /></Link></Button>
        <Button variant="outline" asChild><Link href="/admin/products">أسعار المنتجات<Package className="mr-2 h-4 w-4" /></Link></Button>
      </div>
    </header>
    <aside className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-xs text-foreground">
      إرجاع بضاعة فاتورة كاملة يستخدم إلغاء الفاتورة الموحد، الذي يعكس الحركة المالية ويعيد المخزون حسب صلاحيات الإلغاء. الإرجاع الجزئي غير متاح حالياً.
    </aside>

    <section className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <label className="text-xs text-muted-foreground">من تاريخ<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block rounded-lg border bg-background px-3 py-2 text-sm text-foreground" /></label>
      <label className="text-xs text-muted-foreground">إلى تاريخ<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} className="mt-1 block rounded-lg border bg-background px-3 py-2 text-sm text-foreground" /></label>
      <span className="mr-auto inline-flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-4 w-4" />الأرقام التشغيلية للفترة المحددة</span>
    </section>

    {error ? <div role="alert" className="rounded-xl border border-status-danger/30 bg-status-danger/10 p-4 text-sm text-status-danger">تعذر تحميل تقارير الجملة. {error instanceof Error ? error.message : "تحقق من الصلاحية ثم أعد المحاولة."}</div> : null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl border bg-card p-4"><div className="flex items-center justify-between text-sm text-muted-foreground"><span>{label}</span><Icon className="h-4 w-4" /></div><p className="mt-3 text-xl font-bold text-foreground">{isLoading && label !== "عملاء الجملة" ? "…" : value}</p></div>)}
    </section>

    <section className="rounded-xl border bg-card">
      <div className="border-b p-4"><h2 className="font-semibold">أكثر المنتجات مبيعاً بالكمية</h2><p className="mt-1 text-xs text-muted-foreground">مرتبة من الفواتير المعروضة ضمن الفترة.</p></div>
      {data?.topProducts?.length ? <div className="divide-y">{data.topProducts.map((item) => <div key={item.productName} className="flex items-center justify-between gap-3 p-3 text-sm"><span>{item.productName}</span><span className="text-muted-foreground">{item.quantity} قطعة · {formatCurrency(item.revenue)}</span></div>)}</div> : <p className="p-4 text-sm text-muted-foreground">لا توجد أصناف في فواتير الجملة لهذه الفترة.</p>}
    </section>

    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">فواتير الجملة</h2><p className="mt-1 text-xs text-muted-foreground">تُعرض من سجل فواتير المبيعات الموحد.</p></div><Button size="sm" variant="outline" asChild><Link href="/admin/sales">كل الفواتير</Link></Button></div>
      {isLoading ? <p className="p-6 text-center text-sm text-muted-foreground">جارٍ التحميل…</p> : data?.data?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b bg-muted/30 text-right text-xs text-muted-foreground"><th className="p-3">رقم الفاتورة</th><th className="p-3">التاريخ</th><th className="p-3">المتجر / العميل</th><th className="p-3">الهاتف</th><th className="p-3">الإجمالي</th><th className="p-3">المحصل</th><th className="p-3">المتبقي</th><th className="p-3">الحالة</th></tr></thead><tbody>{data.data.map((invoice) => <tr key={invoice.id} className="border-b last:border-0"><td className="p-3 font-mono">{invoice.invoiceNo}</td><td className="p-3">{invoice.date}</td><td className="p-3">{invoice.customerName || "عميل نقدي"}</td><td className="p-3" dir="ltr">{invoice.customerPhone || "—"}</td><td className="p-3">{formatCurrency(Number(invoice.total))}</td><td className="p-3">{formatCurrency(Number(invoice.paidAmount))}</td><td className="p-3">{formatCurrency(Number(invoice.remainingAmount))}</td><td className="p-3">{invoice.paymentStatus === "paid" ? "مدفوعة" : invoice.paymentStatus === "partial" ? "جزئية" : invoice.paymentStatus === "pending_approval" ? "بانتظار الموافقة" : "آجلة"}</td></tr>)}</tbody></table></div> : <div className="p-10 text-center text-sm text-muted-foreground">لا توجد فواتير جملة خلال هذه الفترة.</div>}
      {Number(data?.total ?? 0) > 100 && <p className="border-t p-3 text-center text-xs text-muted-foreground">يعرض هذا الجدول أحدث 100 فاتورة من أصل {data?.total}. افتح سجل المبيعات للتصفح الكامل.</p>}
    </section>
  </div>;
}
