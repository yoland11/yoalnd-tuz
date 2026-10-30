"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  ARABIC_WEEKDAYS,
  CALENDAR_WEEK_STARTS_ON,
  baghdadDay,
  dayFromLocalDate,
  formatArabicDate,
  localDateFromDay,
} from "@/lib/arabic-date";

const pad = (value: number) => String(value).padStart(2, "0");
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const headerSelect = "cursor-pointer appearance-none rounded-md bg-transparent px-1 text-center text-base font-bold tabular-nums text-foreground hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const stepButton = "grid h-8 w-8 place-items-center rounded-lg border border-primary/15 bg-card text-primary transition-colors duration-150 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

function yearOptions(displayed: number, min: string, max: string) {
  const current = Number(baghdadDay().slice(0, 4));
  const first = Math.min(displayed, min ? Number(min.slice(0, 4)) : current - 100);
  const last = Math.max(displayed, max ? Number(max.slice(0, 4)) : current + 20);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function PanelActions({ todayLabel, todayDisabled, onToday, onClear, onDone }: { todayLabel: string; todayDisabled?: boolean; onToday: () => void; onClear: () => void; onDone: () => void }) {
  return (
    <div className="mt-2 flex items-center gap-2 border-t border-border/50 pt-3">
      <Button type="button" size="sm" className="flex-1 sm:flex-none sm:px-6" onClick={onDone}>تأكيد</Button>
      <Button type="button" size="sm" variant="outline" disabled={todayDisabled} onClick={onToday}>{todayLabel}</Button>
      <Button type="button" size="sm" variant="ghost" className="ms-auto bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary" onClick={onClear}>مسح</Button>
    </div>
  );
}

type PanelProps = { value: string; min: string; max: string; autoFocus?: boolean; onChange: (value: string) => void; onDone: () => void };

/** Day grid: Saturday first, Arabic weekday names, the header as year / month numbers. */
export function DatePanel({ value, min, max, autoFocus, onChange, onDone }: PanelProps) {
  const today = baghdadDay();
  const start = (value || today).slice(0, 7);
  const [shown, setShown] = React.useState(start);
  // Typing in the field moves the grid to the typed month.
  React.useEffect(() => { if (value) setShown(value.slice(0, 7)); }, [value]);
  const [year, month] = shown.split("-").map(Number);
  const firstOfMonth = `${shown}-01`;
  const lastOfMonth = dayFromLocalDate(new Date(year, month, 0));
  const step = (direction: 1 | -1) => {
    const next = new Date(year, month - 1 + direction, 1);
    setShown(`${next.getFullYear()}-${pad(next.getMonth() + 1)}`);
  };
  const disabled = [...(min ? [{ before: localDateFromDay(min) }] : []), ...(max ? [{ after: localDateFromDay(max) }] : [])];
  const todayAllowed = (!min || today >= min) && (!max || today <= max);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 rounded-xl bg-primary/5 p-1.5">
        <button type="button" className={stepButton} aria-label="الشهر السابق" disabled={Boolean(min) && firstOfMonth <= min} onClick={() => step(-1)}><ChevronRight className="h-4 w-4" aria-hidden /></button>
        <div dir="ltr" className="flex items-center gap-1">
          <select aria-label="السنة" className={headerSelect} value={year} onChange={(event) => setShown(`${event.target.value}-${pad(month)}`)}>
            {yearOptions(year, min, max).map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <span className="text-base font-bold text-muted-foreground" aria-hidden>/</span>
          <select aria-label="الشهر" className={headerSelect} value={month} onChange={(event) => setShown(`${year}-${pad(Number(event.target.value))}`)}>
            {MONTHS.map((option) => <option key={option} value={option}>{pad(option)}</option>)}
          </select>
        </div>
        <button type="button" className={stepButton} aria-label="الشهر التالي" disabled={Boolean(max) && lastOfMonth >= max} onClick={() => step(1)}><ChevronLeft className="h-4 w-4" aria-hidden /></button>
      </div>
      <Calendar
        mode="single"
        dir="rtl"
        fixedWeeks
        hideNavigation
        showOutsideDays
        autoFocus={autoFocus}
        weekStartsOn={CALENDAR_WEEK_STARTS_ON}
        month={localDateFromDay(firstOfMonth)}
        onMonthChange={(next) => setShown(dayFromLocalDate(next).slice(0, 7))}
        today={localDateFromDay(today)}
        selected={value ? localDateFromDay(value) : undefined}
        disabled={disabled}
        onDayClick={(day, modifiers, event) => {
          if (modifiers.disabled) return;
          onChange(dayFromLocalDate(day));
          if (event.detail >= 2) onDone();
        }}
        formatters={{
          formatCaption: (date) => `${date.getFullYear()} / ${pad(date.getMonth() + 1)}`,
          formatWeekdayName: (date) => ARABIC_WEEKDAYS[date.getDay()],
          formatDay: (date) => String(date.getDate()),
        }}
        labels={{
          labelDayButton: (date, modifiers) => `${formatArabicDate(dayFromLocalDate(date))}${modifiers.today ? "، اليوم" : ""}${modifiers.selected ? "، محدد" : ""}`,
          labelGrid: () => `تقويم ${shown.replace("-", " / ")}`,
          labelWeekday: (date) => ARABIC_WEEKDAYS[date.getDay()],
        }}
        className="w-full bg-transparent p-0 pt-2 [--cell-size:2.5rem]"
        classNames={{
          root: "w-full",
          months: "relative flex flex-col",
          month: "flex w-full flex-col",
          month_caption: "hidden",
          weekdays: "flex rounded-lg bg-muted/60 py-1.5",
          weekday: "flex-1 select-none px-0 text-center text-[11px] font-medium text-foreground sm:text-xs",
          week: "mt-0.5 flex w-full",
          day: "group/day relative aspect-auto h-9 w-full flex-1 select-none p-0 text-center [&_button]:aspect-auto [&_button]:h-9 [&_button]:min-w-0 [&_button]:rounded-lg [&_button]:font-medium [&_button]:tabular-nums",
          today: "rounded-lg bg-primary/10 font-bold text-primary",
          outside: "text-muted-foreground/60",
          disabled: "opacity-35",
        }}
      />
      <PanelActions
        todayLabel="اليوم"
        todayDisabled={!todayAllowed}
        onToday={() => { onChange(today); setShown(today.slice(0, 7)); }}
        onClear={() => { onChange(""); onDone(); }}
        onDone={onDone}
      />
    </div>
  );
}

/** Month picker: numbers only, never month names. */
export function MonthPanel({ value, min, max, autoFocus, onChange, onDone }: PanelProps) {
  const thisMonth = baghdadDay().slice(0, 7);
  const [year, setYear] = React.useState(Number((value || thisMonth).slice(0, 4)));
  React.useEffect(() => { if (value) setYear(Number(value.slice(0, 4))); }, [value]);
  const allowed = (month: string) => (!min || month >= min) && (!max || month <= max);
  const selectedRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => { if (autoFocus) selectedRef.current?.focus(); }, [autoFocus]);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 rounded-xl bg-primary/5 p-1.5">
        <button type="button" className={stepButton} aria-label="السنة السابقة" disabled={Boolean(min) && year <= Number(min.slice(0, 4))} onClick={() => setYear(year - 1)}><ChevronRight className="h-4 w-4" aria-hidden /></button>
        <select dir="ltr" aria-label="السنة" className={headerSelect} value={year} onChange={(event) => setYear(Number(event.target.value))}>
          {yearOptions(year, min, max).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <button type="button" className={stepButton} aria-label="السنة التالية" disabled={Boolean(max) && year >= Number(max.slice(0, 4))} onClick={() => setYear(year + 1)}><ChevronLeft className="h-4 w-4" aria-hidden /></button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-label={`أشهر سنة ${year}`}>
        {MONTHS.map((option) => {
          const month = `${year}-${pad(option)}`;
          const selected = month === value;
          return (
            <button
              key={option}
              ref={selected || (!value && month === thisMonth) ? selectedRef : undefined}
              type="button"
              aria-pressed={selected}
              aria-label={`${year} / ${pad(option)}`}
              disabled={!allowed(month)}
              onClick={(event) => { onChange(month); if (event.detail >= 2) onDone(); }}
              className={cn(
                "h-10 rounded-lg text-sm font-semibold tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35",
                selected ? "bg-primary text-primary-foreground" : month === thisMonth ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
              )}
            >
              {pad(option)}
            </button>
          );
        })}
      </div>
      <PanelActions
        todayLabel="هذا الشهر"
        todayDisabled={!allowed(thisMonth)}
        onToday={() => { onChange(thisMonth); setYear(Number(thisMonth.slice(0, 4))); }}
        onClear={() => { onChange(""); onDone(); }}
        onDone={onDone}
      />
    </div>
  );
}
