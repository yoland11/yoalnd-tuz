import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit2, Percent, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";

type CouponType = "percentage" | "fixed" | "free_shipping";
type Coupon = {
  id: number;
  code: string;
  title: string;
  type: CouponType;
  value: number;
  minOrderAmount: number;
  usageLimit: number | null;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
};

type CouponForm = {
  id?: number;
  code: string;
  title: string;
  type: CouponType;
  value: string;
  minOrderAmount: string;
  usageLimit: string;
  expiresAt: string;
  isActive: boolean;
};

const blank: CouponForm = {
  code: "",
  title: "",
  type: "fixed",
  value: "0",
  minOrderAmount: "0",
  usageLimit: "",
  expiresAt: "",
  isActive: true,
};

const TYPE_LABELS: Record<CouponType, string> = {
  percentage: "نسبة مئوية",
  fixed: "مبلغ ثابت",
  free_shipping: "شحن مجاني",
};

export default function CouponsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<CouponForm>(blank);

  const { data: coupons = [], isLoading } = useQuery<Coupon[]>({
    queryKey: ["admin", "coupons"],
    queryFn: () => adminFetch("/admin/coupons"),
    staleTime: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: (payload: CouponForm) => {
      const body = {
        code: payload.code,
        title: payload.title,
        type: payload.type,
        value: Number(payload.value) || 0,
        minOrderAmount: Number(payload.minOrderAmount) || 0,
        usageLimit: payload.usageLimit ? Number(payload.usageLimit) : null,
        expiresAt: payload.expiresAt || null,
        isActive: payload.isActive,
      };
      return payload.id
        ? adminFetch(`/admin/coupons/${payload.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : adminFetch("/admin/coupons", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "coupons"] });
      toast({ title: form.id ? "تم تحديث الكوبون" : "تم إضافة الكوبون" });
      setForm(blank);
    },
    onError: (err: any) => toast({ title: "تعذر حفظ الكوبون", description: err?.message, variant: "destructive" }),
  });

  const disableMutation = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/coupons/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "coupons"] });
      toast({ title: "تم تعطيل الكوبون" });
    },
    onError: (err: any) => toast({ title: "تعذر تعطيل الكوبون", description: err?.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return coupons;
    return coupons.filter((coupon) =>
      coupon.code.toLowerCase().includes(q) ||
      coupon.title.toLowerCase().includes(q)
    );
  }, [coupons, search]);

  function editCoupon(coupon: Coupon) {
    setForm({
      id: coupon.id,
      code: coupon.code,
      title: coupon.title,
      type: coupon.type,
      value: String(coupon.value),
      minOrderAmount: String(coupon.minOrderAmount),
      usageLimit: coupon.usageLimit ? String(coupon.usageLimit) : "",
      expiresAt: coupon.expiresAt ? coupon.expiresAt.slice(0, 10) : "",
      isActive: coupon.isActive,
    });
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">الكوبونات والخصومات</h1>
          <p className="text-sm text-muted-foreground mt-1">إدارة خصومات المتجر ونقطة البيع.</p>
        </div>
      </div>

      <form
        onSubmit={(event) => { event.preventDefault(); saveMutation.mutate(form); }}
        className="bg-card rounded-xl border border-border/30 p-4 space-y-3"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Percent className="w-4 h-4 text-primary" />
          {form.id ? "تعديل كوبون" : "إضافة كوبون"}
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="الكود">
            <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/\s+/g, "") }))}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" dir="ltr" placeholder="AJN10" />
          </Field>
          <Field label="العنوان">
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="خصم افتتاح" />
          </Field>
          <Field label="النوع">
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as CouponType }))}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label={form.type === "percentage" ? "النسبة %" : form.type === "free_shipping" ? "القيمة غير مطلوبة" : "قيمة الخصم"}>
            <input type="number" min="0" value={form.value} disabled={form.type === "free_shipping"}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60" dir="ltr" />
          </Field>
          <Field label="الحد الأدنى">
            <input type="number" min="0" value={form.minOrderAmount} onChange={(e) => setForm((f) => ({ ...f, minOrderAmount: e.target.value }))}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" dir="ltr" />
          </Field>
          <Field label="حد الاستخدام">
            <input type="number" min="0" value={form.usageLimit} onChange={(e) => setForm((f) => ({ ...f, usageLimit: e.target.value }))}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" dir="ltr" placeholder="بدون حد" />
          </Field>
          <Field label="تاريخ الانتهاء">
            <input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          </Field>
          <label className="flex items-center gap-2 text-sm pt-6">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="accent-primary" />
            فعال
          </label>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={saveMutation.isPending} className="gap-2">
            <Plus className="w-4 h-4" /> {saveMutation.isPending ? "جاري الحفظ..." : form.id ? "حفظ التعديل" : "إضافة كوبون"}
          </Button>
          {form.id && (
            <Button type="button" variant="outline" onClick={() => setForm(blank)}>إلغاء</Button>
          )}
        </div>
      </form>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث عن كوبون..."
          className="w-full bg-card border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-16 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState message="لا توجد كوبونات" />
      ) : (
        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-right p-3 font-medium">الكود</th>
                  <th className="text-right p-3 font-medium">النوع</th>
                  <th className="text-right p-3 font-medium">القيمة</th>
                  <th className="text-right p-3 font-medium">الاستخدام</th>
                  <th className="text-right p-3 font-medium">الحالة</th>
                  <th className="text-right p-3 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {filtered.map((coupon) => (
                  <tr key={coupon.id} className="hover:bg-background/30">
                    <td className="p-3">
                      <p className="font-mono font-bold text-foreground" dir="ltr">{coupon.code}</p>
                      {coupon.title && <p className="text-xs text-muted-foreground mt-0.5">{coupon.title}</p>}
                    </td>
                    <td className="p-3 text-muted-foreground">{TYPE_LABELS[coupon.type]}</td>
                    <td className="p-3 text-primary">
                      {coupon.type === "percentage" ? `${coupon.value}%` : coupon.type === "free_shipping" ? "الشحن" : formatCurrency(coupon.value)}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {coupon.usedCount.toLocaleString("ar-IQ")} / {coupon.usageLimit ? coupon.usageLimit.toLocaleString("ar-IQ") : "غير محدود"}
                    </td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${coupon.isActive ? "bg-status-success/10 text-status-success" : "bg-status-danger/10 text-status-danger"}`}>
                        {coupon.isActive ? "فعال" : "معطل"}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => editCoupon(coupon)} className="p-2 rounded-lg text-primary hover:bg-primary/10">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => confirm("تعطيل الكوبون؟") && disableMutation.mutate(coupon.id)} className="p-2 rounded-lg text-status-danger hover:bg-status-danger/10">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
