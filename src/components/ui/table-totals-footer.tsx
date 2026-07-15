import * as React from "react";

import { cn } from "@/lib/utils";

export type TableTotalCell<T> = {
  /** A stable key is also used when totals are exported. */
  key: string;
  /** Short Arabic label that explains the calculated value. */
  label?: string;
  /** Omit value for a deliberately empty, non-numeric column. */
  value?: (row: T) => number | null | undefined;
  format?: (value: number, rows: readonly T[]) => React.ReactNode;
  className?: string;
};

export type TableTotals<T> = Record<string, number>;

/**
 * Keeps the calculation used by table footers and export rows in one place.
 * A column has to opt in with a value accessor: amounts that look numeric in
 * the UI can mean different things (e.g. paid vs. remaining) and must not be
 * guessed from rendered cells.
 */
export function calculateTableTotals<T>(rows: readonly T[], cells: readonly TableTotalCell<T>[]): TableTotals<T> {
  return cells.reduce<TableTotals<T>>((result, cell) => {
    if (!cell.value) return result;
    result[cell.key] = rows.reduce((total, row) => {
      const value = Number(cell.value?.(row) ?? 0);
      return total + (Number.isFinite(value) ? value : 0);
    }, 0);
    return result;
  }, {});
}

/** Reusable export row so CSV/Excel/PDF producers can include the same totals. */
export function tableTotalsExportRow<T>(rows: readonly T[], cells: readonly TableTotalCell<T>[]) {
  const totals = calculateTableTotals(rows, cells);
  return {
    "الإجمالي": rows.length,
    ...Object.fromEntries(cells.filter((cell) => cell.value).map((cell) => [cell.label ?? cell.key, totals[cell.key] ?? 0])),
  };
}

type Props<T> = {
  rows: readonly T[];
  /** Optional unpaginated filtered data for the “all results” mode. */
  allRows?: readonly T[];
  cells: readonly TableTotalCell<T>[];
  /** Number of leading columns occupied by the total label. */
  labelColSpan?: number;
  label?: React.ReactNode;
  className?: string;
};

/**
 * A sticky, RTL-safe footer for existing HTML tables.  It intentionally does
 * not own filtering, sorting, or pagination: pass the exact displayed rows so
 * totals always follow the page's current query state.
 */
export function TableTotalsFooter<T>({ rows, allRows, cells, labelColSpan = 1, label = "الإجمالي", className }: Props<T>) {
  const [scope, setScope] = React.useState<"page" | "all">("page");
  const displayedRows = scope === "all" && allRows ? allRows : rows;
  const totals = React.useMemo(() => calculateTableTotals(displayedRows, cells), [displayedRows, cells]);

  return (
    <tfoot className={cn("sticky bottom-0 z-10 border-t border-primary/30 bg-primary/10 text-sm font-bold text-foreground shadow-[0_-4px_12px_rgba(0,0,0,0.06)] dark:bg-primary/15", className)}>
      <tr>
        <td colSpan={labelColSpan} className="whitespace-nowrap px-3 py-3 text-primary">
          {label}
          <span className="mr-2 text-xs font-medium text-muted-foreground">({displayedRows.length.toLocaleString("ar-IQ")})</span>
          {allRows && (
            <span className="mr-3 inline-flex rounded-md border border-primary/20 bg-background/70 p-0.5 text-[11px] font-medium text-muted-foreground print:hidden">
              <button type="button" onClick={() => setScope("page")} className={cn("rounded px-1.5 py-0.5", scope === "page" && "bg-primary/10 text-primary")} aria-pressed={scope === "page"}>هذه الصفحة</button>
              <button type="button" onClick={() => setScope("all")} className={cn("rounded px-1.5 py-0.5", scope === "all" && "bg-primary/10 text-primary")} aria-pressed={scope === "all"}>كل النتائج</button>
            </span>
          )}
        </td>
        {cells.map((cell) => {
          const total = totals[cell.key] ?? 0;
          return (
            <td key={cell.key} className={cn("whitespace-nowrap px-3 py-3", cell.className)}>
              {cell.value ? <span title={cell.label}>{cell.format ? cell.format(total, rows) : total.toLocaleString("ar-IQ")}</span> : null}
            </td>
          );
        })}
      </tr>
    </tfoot>
  );
}
