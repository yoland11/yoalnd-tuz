import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, FileText, KeyRound, Save, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "./_lib";

type EventKey = "storeOrder" | "koshaBooking" | "serviceBooking" | "salesInvoice" | "adminLogin" | "paymentReceived" | "managerApproval" | "dailyCashClosed" | "dailyReport";
type TelegramSettings = { enabled: boolean; events: Record<EventKey, boolean> };
type TelegramSettingsResponse = {
  settings: TelegramSettings;
  environment: { botTokenConfigured: boolean; chatIdConfigured: boolean };
};

const EVENT_LABELS: Array<{ key: EventKey; title: string; description: string }> = [
  { key: "storeOrder", title: "طلبات المتجر", description: "عند وصول طلب متجر جديد" },
  { key: "koshaBooking", title: "حجوزات الكوشات", description: "عند إرسال حجز كوشة جديد" },
  { key: "serviceBooking", title: "حجوزات الخدمات", description: "التصوير والصوتيات وبقية الخدمات" },
  { key: "salesInvoice", title: "فواتير المبيعات", description: "رسالة مفصلة مع ملف PDF للفاتورة" },
  { key: "adminLogin", title: "تسجيل دخول النظام", description: "اسم الموظف ووقت تسجيل الدخول فقط" },
  { key: "paymentReceived", title: "الدفعات المستلمة", description: "عند إضافة دفعة جديدة أو سند قبض" },
  { key: "managerApproval", title: "اعتماد المدير", description: "عند اعتماد مبلغ إيراد في الصندوق الرئيسي" },
  { key: "dailyCashClosed", title: "إغلاق الصندوق اليومي", description: "ملخص الإغلاق مع ملف PDF" },
  { key: "dailyReport", title: "التقرير المالي اليومي", description: "ملخص التقرير مع ملف PDF" },
];

export default function TelegramSettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<TelegramSettings | null>(null);
  const query = useQuery<TelegramSettingsResponse>({
    queryKey: ["admin", "telegram", "settings"],
    queryFn: () => adminFetch("/admin/telegram/settings"),
  });

  useEffect(() => {
    if (query.data?.settings) setForm(query.data.settings);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (settings: TelegramSettings) => adminFetch<TelegramSettingsResponse>("/admin/telegram/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
    onSuccess: (data) => {
      setForm(data.settings);
      queryClient.setQueryData(["admin", "telegram", "settings"], data);
      toast({ title: "تم حفظ إعدادات Telegram" });
    },
    onError: (error: Error) => toast({ title: "تعذر حفظ الإعدادات", description: error.message, variant: "destructive" }),
  });

  const testMessage = useMutation({
    mutationFn: () => adminFetch("/admin/telegram/test-message", { method: "POST" }),
    onSuccess: () => toast({ title: "تم إرسال رسالة الاختبار" }),
    onError: (error: Error) => toast({ title: "فشل اختبار الرسالة", description: error.message, variant: "destructive" }),
  });

  const testPdf = useMutation({
    mutationFn: () => adminFetch("/admin/telegram/test-pdf", { method: "POST" }),
    onSuccess: () => toast({ title: "تم إرسال ملف PDF الاختباري" }),
    onError: (error: Error) => toast({ title: "فشل اختبار PDF", description: error.message, variant: "destructive" }),
  });

  if (query.isLoading || !form || !query.data) {
    return <div className="space-y-4"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-56 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>;
  }

  const environmentReady = query.data.environment.botTokenConfigured && query.data.environment.chatIdConfigured;
  const testing = testMessage.isPending || testPdf.isPending;

  return (
    <div className="mx-auto max-w-4xl space-y-5" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">إعدادات Telegram</h1>
          <p className="mt-1 text-sm text-muted-foreground">تقارير فورية ومرفقات PDF للمجموعة أو القناة المحددة في بيئة التشغيل.</p>
        </div>
        <Button onClick={() => save.mutate(form)} disabled={save.isPending} className="gap-2">
          <Save className="h-4 w-4" /> {save.isPending ? "جاري الحفظ..." : "حفظ التغييرات"}
        </Button>
      </div>

      <section className="overflow-hidden rounded-xl border border-border/30 bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Bot className="h-5 w-5" /></span>
            <div className="min-w-0"><h2 className="font-semibold text-foreground">الإرسال التلقائي</h2><p className="text-xs text-muted-foreground">إيقافه لا يؤثر على الطلبات أو الفواتير.</p></div>
          </div>
          <Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} aria-label="تفعيل إشعارات Telegram" />
        </div>
        <div className="border-t border-border/20 bg-background/35 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <EnvironmentStatus label="Bot Token" ready={query.data.environment.botTokenConfigured} />
            <EnvironmentStatus label="Chat ID" ready={query.data.environment.chatIdConfigured} />
          </div>
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><KeyRound className="h-3.5 w-3.5" /> القيم السرية محفوظة في Environment Variables ولا تظهر داخل لوحة الإدارة.</p>
        </div>
      </section>

      <section className="rounded-xl border border-border/30 bg-card p-4">
        <div className="mb-3"><h2 className="font-semibold text-foreground">أنواع الإشعارات</h2><p className="mt-1 text-xs text-muted-foreground">اختر العمليات التي تصل إلى Telegram.</p></div>
        <div className="divide-y divide-border/20">
          {EVENT_LABELS.map((event) => (
            <label key={event.key} className="flex min-h-16 cursor-pointer items-center justify-between gap-4 py-3">
              <span className="min-w-0"><span className="block text-sm font-medium text-foreground">{event.title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{event.description}</span></span>
              <Switch checked={form.events[event.key] !== false} onCheckedChange={(checked) => setForm({ ...form, events: { ...form.events, [event.key]: checked } })} aria-label={`تفعيل ${event.title}`} />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border/30 bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold text-foreground">اختبار الاتصال</h2><p className="mt-1 text-xs text-muted-foreground">أرسل رسالة أو ملف PDF حقيقي إلى القناة قبل تفعيل الأتمتة.</p></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => testMessage.mutate()} disabled={testing || !environmentReady} className="gap-2"><Send className="h-4 w-4" /> اختبار رسالة</Button>
            <Button variant="outline" onClick={() => testPdf.mutate()} disabled={testing || !environmentReady} className="gap-2"><FileText className="h-4 w-4" /> اختبار PDF</Button>
          </div>
        </div>
        {!environmentReady && <p className="mt-3 text-xs text-destructive">أضف TELEGRAM_BOT_TOKEN وTELEGRAM_CHAT_ID إلى Environment Variables أولاً.</p>}
      </section>
    </div>
  );
}

function EnvironmentStatus({ label, ready }: { label: string; ready: boolean }) {
  return <span className={`inline-flex items-center gap-1.5 text-xs ${ready ? "text-status-success" : "text-muted-foreground"}`}>{ready ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{label}: {ready ? "مهيأ" : "غير مهيأ"}</span>;
}
