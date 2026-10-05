import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  groupPricingSashTypes,
  MAX_GROUP_SASH_PRICE,
  validateGroupSashPricing,
} from "@/lib/graduation-group-pricing";
import { adminFetch, apiErrorMessage, apiErrorStatus } from "@/views/admin/_lib";

type PricingGroup = { id: number; title?: string; defaultConfiguration: Record<string, any> };

export function GraduationGroupPricingEditor({
  configuration,
  endpoint,
  onSaved,
}: {
  configuration: Record<string, any>;
  endpoint: string;
  onSaved: (group: PricingGroup) => void;
}) {
  const id = useId();
  const sashTypes = groupPricingSashTypes(configuration);
  const [mode, setMode] = useState<"catalog" | "by_sash">(
    configuration.sashPricing?.mode === "by_sash" ? "by_sash" : "catalog",
  );
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(sashTypes.map(({ key }) => {
      const value = configuration.sashPricing?.prices?.[key];
      return [key, typeof value === "number" && Number.isFinite(value) ? String(value) : ""];
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setSaved(false);
    const result = validateGroupSashPricing(mode === "catalog" ? null : {
      mode: "by_sash",
      prices: Object.fromEntries(sashTypes.map(({ key }) => [
        key,
        prices[key]?.trim() ? Number(prices[key]) : undefined,
      ])),
    }, configuration);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setBusy(true);
    try {
      const response = await adminFetch<{ group: PricingGroup }>(endpoint, {
        method: "PUT",
        body: JSON.stringify({ sashPricing: result.pricing }),
      });
      if (!response.group?.id || !response.group.defaultConfiguration)
        throw new Error("لم يصل تأكيد حفظ الأسعار. أعد تحميل المجموعة للتحقق.");
      onSaved(response.group);
      setSaved(true);
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر حفظ أسعار المجموعة"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5" dir="rtl">
      <div>
        <h3 className="font-bold">أسعار تجهيز الطالب حسب الوشاح</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          حدد سعر تجهيز الطالب لكل نوع وشاح معتمد. الورود والمسكات الاختيارية تُحسب إضافياً.
          يسري الحفظ على الطلبات الجديدة؛ مبالغ الطلبات المحفوظة لا تتغير.
        </p>
      </div>
      <fieldset disabled={busy} className="space-y-4">
        <legend className="sr-only">طريقة تسعير المجموعة</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ["catalog", "أسعار الكتالوج"],
            ["by_sash", "سعر محدد لكل نوع وشاح"],
          ] as const).map(([value, label]) => (
            <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${mode === value ? "border-primary bg-primary/5" : "border-border"}`}>
              <input type="radio" name={`pricing-mode-${id}`} value={value} checked={mode === value} onChange={() => { setMode(value); setSaved(false); setError(""); }} className="h-4 w-4 accent-primary" />
              {label}
            </label>
          ))}
        </div>
        {mode === "by_sash" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {sashTypes.map((type) => (
              <div key={type.key}>
                <Label htmlFor={`${id}-${type.key}`}>سعر الطالب — {type.label}</Label>
                <div className="relative mt-2">
                  <Input id={`${id}-${type.key}`} name={`sash-price-${type.key}`} type="number" inputMode="decimal" min={0} max={MAX_GROUP_SASH_PRICE} step="any" required value={prices[type.key] ?? ""} onChange={(event) => { setPrices((current) => ({ ...current, [type.key]: event.target.value })); setSaved(false); setError(""); }} className="pl-14 text-right" />
                  <span className="pointer-events-none absolute left-3 top-3 text-xs text-muted-foreground">د.ع</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">سعر تجهيز طالب واحد، والصفر سعر صالح.</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">تُستخدم أسعار تجهيزات الكتالوج للطلبات الجديدة.</p>
        )}
        <Button type="submit" disabled={busy}>{busy ? "جاري حفظ الأسعار…" : "حفظ أسعار المجموعة"}</Button>
      </fieldset>
      {error ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      {saved ? <p role="status" className="text-sm text-emerald-700">تم حفظ أسعار المجموعة للطلبات الجديدة.</p> : null}
    </form>
  );
}

/** Pricing access is checked through the authenticated endpoint only after expansion. */
export function GraduationGroupPricingAccess({ token, onSaved }: {
  token: string;
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const endpoint = `/admin/representative/groups/${encodeURIComponent(token)}/sash-pricing`;
  const access = useQuery({
    queryKey: ["graduation", "group-pricing-access", token],
    queryFn: async () => {
      const result = await adminFetch<{ group: PricingGroup }>(endpoint);
      if (!result.group?.id || !result.group.defaultConfiguration)
        throw new Error("تعذر قراءة إعدادات أسعار المجموعة. أعد المحاولة.");
      return result;
    },
    enabled: expanded,
    retry: false,
  });
  const status = apiErrorStatus(access.error);
  return (
    <details className="rounded-xl border border-border bg-card p-4" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold">للإدارة وممثل الدفعة: إدارة أسعار الوشاح</summary>
      {expanded ? <div className="mt-4 space-y-3">
        {access.isPending ? <p role="status">جاري التحقق من صلاحية إدارة الأسعار…</p> : null}
        {access.isError ? (
          <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 p-3 text-sm">
            <p>{apiErrorMessage(access.error)}</p>
            {status === 401 || status === 403 ? <>
              <p>إدارة الأسعار متاحة للإدارة أو ممثل الدفعة المعيّن بعد تسجيل الدخول بالحساب المخوّل.</p>
              <div className="flex flex-wrap gap-3"><a href="/representative" className="text-primary underline">دخول ممثل الدفعة</a><a href="/admin/login" className="text-primary underline">دخول الإدارة</a></div>
            </> : null}
            <Button type="button" variant="outline" onClick={() => void access.refetch()}>إعادة التحقق</Button>
          </div>
        ) : null}
        {access.isSuccess && access.data ? <GraduationGroupPricingEditor
          key={JSON.stringify(access.data.group.defaultConfiguration)}
          configuration={access.data.group.defaultConfiguration}
          endpoint={endpoint}
          onSaved={() => { void access.refetch(); onSaved(); }}
        /> : null}
      </div> : null}
    </details>
  );
}
