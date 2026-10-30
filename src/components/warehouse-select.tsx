import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Warehouse as WarehouseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";

export type WarehouseOption = { id: number; name: string; code: string | null; isActive: boolean; isMain: boolean };

export function useWarehouseOptions(enabled = true) {
  return useQuery<{ data: WarehouseOption[] }>({
    queryKey: ["admin", "warehouses", "list"],
    queryFn: () => adminFetch("/admin/warehouses/list"),
    staleTime: 60_000,
    enabled,
  });
}

/** The one warehouse picker. `value` is "" for «كل المخازن» when `allowAll` is on. */
export function WarehouseSelect({
  value,
  onChange,
  allowAll = false,
  includeInactive = false,
  label = "المخزن",
  placeholder = "اختر المخزن",
  shares,
  disabled,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  allowAll?: boolean;
  includeInactive?: boolean;
  label?: string;
  placeholder?: string;
  /** Quantity beside each name, so the choice shows what that warehouse actually has. */
  shares?: Record<number, number>;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const options = useWarehouseOptions();
  if (options.isError)
    return (
      <p role="alert" className="text-xs text-destructive">
        تعذّر تحميل المخازن: {apiErrorMessage(options.error)}{" "}
        <Button type="button" variant="link" size="sm" className="h-auto p-0 align-baseline" onClick={() => void options.refetch()}>إعادة المحاولة</Button>
      </p>
    );
  const rows = (options.data?.data ?? []).filter((row) => includeInactive || row.isActive || String(row.id) === value);
  return (
    <label htmlFor={id} className={`flex min-w-0 items-center gap-2 text-sm font-semibold ${className}`}>
      <WarehouseIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      <span className="shrink-0">{label}:</span>
      <select
        id={id}
        value={value}
        disabled={disabled || options.isPending}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
      >
        {allowAll ? <option value="">كل المخازن</option> : <option value="" disabled>{options.isPending ? "جارٍ التحميل…" : placeholder}</option>}
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}{row.isActive ? "" : " (غير نشط)"}{shares ? ` · ${shares[row.id] ?? 0}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
