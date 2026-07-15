import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarDays, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch } from "./_lib";

type PayrollRun = { id: number; run_no: string; period: string; status: string; totalNet: number; lines: unknown[] };
const money = new Intl.NumberFormat("ar-IQ", { style: "currency", currency: "IQD", maximumFractionDigits: 0 });

export default function PayrollHistoryPage() {
  const payroll = useQuery({ queryKey: ["hr", "payroll-history"], queryFn: () => adminFetch<PayrollRun[]>("/admin/hr/payroll") });
  return <main className="mx-auto max-w-5xl space-y-4 p-4" dir="rtl"><header className="flex flex-wrap items-center gap-3"><CalendarDays className="h-6 w-6 text-primary" /><div><h1 className="text-xl font-bold">سجل الرواتب</h1><p className="text-sm text-muted-foreground">كل أشهر الرواتب مرتبة من الأحدث إلى الأقدم.</p></div></header><section className="rounded-xl border bg-card"><div className="divide-y">{payroll.isLoading && <p className="p-6 text-sm text-muted-foreground">جارٍ تحميل سجل الرواتب…</p>}{payroll.data?.map((run) => <div key={run.id} className="flex flex-wrap items-center gap-3 p-4"><div className="min-w-36"><b>{new Date(`${run.period}-01T00:00:00`).toLocaleDateString("ar-IQ", { month: "long", year: "numeric" })}</b><p className="text-xs text-muted-foreground">{run.run_no} · {run.lines?.length ?? 0} موظف</p></div><span className="text-sm text-muted-foreground">{run.status}</span><b className="ms-auto">{money.format(run.totalNet || 0)}</b><Link href={`/admin/payroll/${run.id}`}><Button size="sm" variant="outline"><Eye className="ms-1 h-4 w-4" />فتح التفاصيل</Button></Link></div>)}{!payroll.isLoading && !payroll.data?.length && <p className="p-8 text-center text-sm text-muted-foreground">لا توجد دورات رواتب سابقة.</p>}</div></section></main>;
}
