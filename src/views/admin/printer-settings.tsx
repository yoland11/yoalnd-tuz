import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "./_lib";

type PrinterSettings = {
  defaultPaperSize: "80mm" | "58mm" | "a4";
  autoPrint: boolean;
  copies: number;
  showLogo: boolean;
};

export default function PrinterSettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<PrinterSettings | null>(null);

  const { data, isLoading } = useQuery<PrinterSettings>({
    queryKey: ["admin", "printer-settings"],
    queryFn: () => adminFetch("/admin/settings/printer"),
  });

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const save = useMutation({
    mutationFn: () => adminFetch("/admin/settings/printer", { method: "PATCH", body: JSON.stringify(draft) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "printer-settings"] });
      toast({ title: "تم حفظ إعدادات الطابعة" });
    },
    onError: (err: any) => toast({ title: "تعذر حفظ الإعدادات", description: err?.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">إعدادات الطابعة</h1>
        <p className="text-sm text-muted-foreground mt-1">تحكم بطباعة الفواتير الحرارية 58mm و80mm وطباعة POS.</p>
      </div>

      {isLoading || !draft ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : (
        <div className="bg-card rounded-xl border border-border/30 p-5 space-y-5 max-w-2xl">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Printer className="w-4 h-4 text-primary" />
            إعدادات البيع والطباعة
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">
              نوع الورق الافتراضي
              <select
                value={draft.defaultPaperSize}
                onChange={(e) => setDraft((current) => current ? { ...current, defaultPaperSize: e.target.value as PrinterSettings["defaultPaperSize"] } : current)}
                className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              >
                <option value="80mm">Thermal 80mm</option>
                <option value="58mm">Thermal 58mm</option>
                <option value="a4">A4</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              عدد النسخ
              <input
                type="number"
                min={1}
                max={5}
                value={draft.copies}
                onChange={(e) => setDraft((current) => current ? { ...current, copies: Math.min(Math.max(Number(e.target.value) || 1, 1), 5) } : current)}
                className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                dir="ltr"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-xl bg-background/50 border border-border/25 p-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.autoPrint}
                onChange={(e) => setDraft((current) => current ? { ...current, autoPrint: e.target.checked } : current)}
                className="accent-primary"
              />
              طباعة تلقائية بعد إتمام البيع
            </label>
            <label className="flex items-center gap-2 rounded-xl bg-background/50 border border-border/25 p-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.showLogo}
                onChange={(e) => setDraft((current) => current ? { ...current, showLogo: e.target.checked } : current)}
                className="accent-primary"
              />
              إظهار الشعار في الفاتورة
            </label>
          </div>

          <div className="rounded-xl bg-background/50 border border-border/25 p-4 text-xs text-muted-foreground">
            الفواتير الحرارية تستخدم CSS مخصص للطباعة عبر <span dir="ltr">window.print()</span> مع RTL وهوامش ضيقة حتى لا يتم قص المحتوى.
          </div>

          <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-2">
            <Save className="w-4 h-4" />
            {save.isPending ? "جاري الحفظ..." : "حفظ الإعدادات"}
          </Button>
        </div>
      )}
    </div>
  );
}
