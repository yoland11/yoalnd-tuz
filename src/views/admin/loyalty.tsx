import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Search, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";
import { formatIraqiPhone } from "@/lib/phone";

type LoyaltyResponse = {
  settings: { enabled: boolean; amountPerPoint: number; pointsPerUnit: number; redeemValue: number };
  customers: { id: number; name: string; phone: string; rewardPoints: number; rewardLevelLabel: string }[];
  history: { id: number; customerId: number; points: number; reason: string; note: string; createdAt: string }[];
};

export default function LoyaltyPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [pointsDelta, setPointsDelta] = useState("");
  const [note, setNote] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<LoyaltyResponse["settings"] | null>(null);

  const { data, isLoading } = useQuery<LoyaltyResponse>({
    queryKey: ["admin", "loyalty"],
    queryFn: () => adminFetch("/admin/loyalty"),
    staleTime: 60_000,
  });

  const settings = settingsDraft ?? data?.settings;
  const customers = data?.customers ?? [];

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((customer) =>
      customer.name.toLowerCase().includes(q) ||
      customer.phone.includes(q.replace(/\D/g, "")) ||
      formatIraqiPhone(customer.phone).includes(q.replace(/\D/g, ""))
    );
  }, [customers, search]);

  const saveSettings = useMutation({
    mutationFn: () => adminFetch("/admin/loyalty", { method: "PATCH", body: JSON.stringify(settings) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "loyalty"] });
      setSettingsDraft(null);
      toast({ title: "تم حفظ إعدادات الولاء" });
    },
    onError: (err: any) => toast({ title: "تعذر حفظ إعدادات الولاء", description: err?.message, variant: "destructive" }),
  });

  const adjustPoints = useMutation({
    mutationFn: () => adminFetch("/admin/loyalty/adjust", {
      method: "POST",
      body: JSON.stringify({
        customerId: Number(selectedCustomerId),
        pointsDelta: Number(pointsDelta),
        note: note || "تعديل من إدارة الولاء",
      }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "loyalty"] });
      setPointsDelta("");
      setNote("");
      toast({ title: "تم تعديل النقاط" });
    },
    onError: (err: any) => toast({ title: "تعذر تعديل النقاط", description: err?.message, variant: "destructive" }),
  });

  function updateSetting<K extends keyof LoyaltyResponse["settings"]>(key: K, value: LoyaltyResponse["settings"][K]) {
    setSettingsDraft((current) => ({ ...(current ?? data?.settings ?? { enabled: true, amountPerPoint: 10000, pointsPerUnit: 1, redeemValue: 1000 }), [key]: value }));
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">نقاط الولاء</h1>
        <p className="text-sm text-muted-foreground mt-1">إدارة نقاط الزبائن وطريقة احتسابها وصرفها.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" /> إعدادات النظام
            </h2>
            {!settings ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={settings.enabled} onChange={(e) => updateSetting("enabled", e.target.checked)} className="accent-primary" />
                  تفعيل نقاط الولاء
                </label>
                <SettingInput label="كل مبلغ يمنح نقطة" value={settings.amountPerPoint} onChange={(value) => updateSetting("amountPerPoint", value)} />
                <SettingInput label="عدد النقاط الممنوحة" value={settings.pointsPerUnit} onChange={(value) => updateSetting("pointsPerUnit", value)} />
                <SettingInput label="قيمة النقطة عند الصرف" value={settings.redeemValue} onChange={(value) => updateSetting("redeemValue", value)} />
                <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending} className="w-full gap-2">
                  <Save className="w-4 h-4" /> حفظ الإعدادات
                </Button>
              </>
            )}
          </div>

          <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">تعديل نقاط زبون</h2>
            <select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50">
              <option value="">اختر الزبون</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name} — {customer.rewardPoints} نقطة</option>
              ))}
            </select>
            <input value={pointsDelta} onChange={(e) => setPointsDelta(e.target.value.replace(/[^\d-]/g, ""))}
              placeholder="+50 أو -20" inputMode="numeric"
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="سبب التعديل"
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
            <Button onClick={() => adjustPoints.mutate()} disabled={adjustPoints.isPending || !selectedCustomerId || !Number(pointsDelta)} className="w-full">
              حفظ النقاط
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث عن زبون..."
              className="w-full bg-card border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
          </div>

          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-16 rounded-xl" />)}</div>
          ) : filteredCustomers.length === 0 ? (
            <EmptyState message="لا توجد بيانات ولاء" />
          ) : (
            <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-background/50">
                    <tr className="text-muted-foreground border-b border-border/30">
                      <th className="text-right p-3 font-medium">الزبون</th>
                      <th className="text-right p-3 font-medium">الهاتف</th>
                      <th className="text-right p-3 font-medium">المستوى</th>
                      <th className="text-right p-3 font-medium">النقاط</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {filteredCustomers.map((customer) => (
                      <tr key={customer.id} className="hover:bg-background/30">
                        <td className="p-3 font-medium text-foreground">{customer.name}</td>
                        <td className="p-3 text-muted-foreground" dir="ltr">{formatIraqiPhone(customer.phone)}</td>
                        <td className="p-3 text-primary">{customer.rewardLevelLabel}</td>
                        <td className="p-3 font-semibold">{customer.rewardPoints.toLocaleString("ar-IQ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-card rounded-xl border border-border/30 p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">آخر الحركات</h2>
            <div className="space-y-2">
              {data?.history.length ? data.history.slice(0, 8).map((entry) => (
                <div key={entry.id} className="flex items-center justify-between rounded-lg bg-background/50 border border-border/20 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{entry.note || entry.reason}</span>
                  <span className={entry.points >= 0 ? "text-primary font-semibold" : "text-red-400 font-semibold"}>
                    {entry.points > 0 ? "+" : ""}{entry.points.toLocaleString("ar-IQ")}
                  </span>
                </div>
              )) : <p className="text-sm text-muted-foreground">لا توجد حركات نقاط بعد.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <input type="number" min="1" value={value} onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
        className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" dir="ltr" />
    </label>
  );
}
