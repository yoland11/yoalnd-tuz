"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  dayBound,
  formatArabicDate,
  formatNumericDate,
  formatNumericMonth,
  isCalendarDay,
  isCalendarMonth,
  isDateInputKind,
  joinDateTime,
  parseTypedDate,
  parseTypedMonth,
  splitDateTime,
  type DateInputKind,
} from "@/lib/arabic-date";

// The grid and its library load only when someone opens a picker.
const DatePanel = React.lazy(() => import("./date-field-panel").then((module) => ({ default: module.DatePanel })));
const MonthPanel = React.lazy(() => import("./date-field-panel").then((module) => ({ default: module.MonthPanel })));

export type DateFieldProps = React.ComponentProps<"input"> & {
  /** Keep the browser's own picker, for customer pages not shown in Arabic. */
  nativePicker?: boolean;
};

/** As room runs out: the weekday goes first, then the time moves under the date, then the icon. */
const WEEKDAY_WIDTH: Record<DateInputKind, number> = { date: 190, "datetime-local": 320, month: 0 };
const STACK_WIDTH = 250;
const NARROW_WIDTH = 125;

/**
 * The one date control of AJN. The real browser input stays in the form, hidden:
 * it keeps `value`, `onChange`, `required`, `min`, `max`, `name` and refs working
 * exactly as before and is what every change goes through, so callers cannot
 * tell the difference and stored formats do not change. Any other `type` renders
 * a plain input, which lets generic field wrappers use this for every type.
 */
export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(function DateField({ nativePicker, ...props }, ref) {
  if (nativePicker || !isDateInputKind(props.type)) return <input ref={ref} {...props} />;
  return <ArabicDateField ref={ref} {...props} kind={props.type} />;
});

function setNativeValue(input: HTMLInputElement, next: string) {
  // Through the prototype setter, so React sees a real change and calls onChange.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const ArabicDateField = React.forwardRef<HTMLInputElement, Omit<DateFieldProps, "nativePicker"> & { kind: DateInputKind }>(function ArabicDateField(
  { kind, className, style, value, defaultValue, onChange, onBlur, onFocus, placeholder, id, disabled, readOnly, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid, ...nativeProps },
  forwardedRef,
) {
  const nativeRef = React.useRef<HTMLInputElement | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const textRef = React.useRef<HTMLInputElement | null>(null);
  const controlled = value !== undefined;
  const [uncontrolled, setUncontrolled] = React.useState(() => String(defaultValue ?? ""));
  const current = controlled ? String(value ?? "") : uncontrolled;

  // A date-time only has a value once both parts exist; until then the half
  // that was entered waits here, exactly as it does in the browser's control.
  const [draft, setDraft] = React.useState(() => (kind === "datetime-local" ? splitDateTime(current) : { date: "", time: "" }));
  const lastEmitted = React.useRef(current);
  React.useEffect(() => {
    if (kind !== "datetime-local" || current === lastEmitted.current) return;
    lastEmitted.current = current;
    setDraft(splitDateTime(current));
  }, [current, kind]);

  const dateValue = kind === "datetime-local" ? draft.date : kind === "date" && isCalendarDay(current) ? current : "";
  const monthValue = kind === "month" && isCalendarMonth(current) ? current : "";

  const [editing, setEditing] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [focusGrid, setFocusGrid] = React.useState(false);
  const [width, setWidth] = React.useState<number | null>(null);
  const showWeekday = width === null || width >= WEEKDAY_WIDTH[kind];
  const stacked = kind === "datetime-local" && width !== null && width < STACK_WIDTH;
  const narrow = width !== null && width < NARROW_WIDTH;
  const [coarsePointer, setCoarsePointer] = React.useState(false);
  const valueWhenOpened = React.useRef("");
  const blocked = Boolean(disabled || readOnly);

  React.useEffect(() => {
    setCoarsePointer(window.matchMedia("(pointer: coarse)").matches);
    const element = wrapperRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [kind]);

  const emit = (next: string) => {
    if (kind === "datetime-local") lastEmitted.current = next;
    setUncontrolled(next);
    if (nativeRef.current) setNativeValue(nativeRef.current, next);
  };

  const changeDate = (date: string) => {
    if (kind !== "datetime-local") return emit(date);
    setDraft({ ...draft, date });
    emit(joinDateTime(date, draft.time));
  };

  const changeTime = (time: string) => {
    const next = { ...draft, time };
    setDraft(next);
    emit(joinDateTime(next.date, next.time));
  };

  const openPicker = (viaKeyboard: boolean) => {
    if (blocked) return;
    valueWhenOpened.current = current;
    setFocusGrid(viaKeyboard);
    setOpen(true);
  };
  const closePicker = () => setOpen(false);

  const display = kind === "month"
    ? (monthValue ? formatNumericMonth(monthValue) : "")
    : dateValue ? (showWeekday ? formatArabicDate(dateValue) : formatNumericDate(dateValue)) : "";
  const editText = kind === "month" ? monthValue.replace("-", "/") : dateValue ? formatNumericDate(dateValue) : "";

  const parseTyped = (text: string) => (kind === "month" ? parseTypedMonth(text) : parseTypedDate(text));
  const applyTyped = (next: string) => (kind === "month" ? emit(next) : changeDate(next));
  const onTyped = (text: string) => {
    setEditing(text);
    if (!text.trim()) return applyTyped("");
    // "2026/02/3" may still become "2026/02/31": a one-digit ending waits for the
    // next key or for leaving the field, so a half-typed date never slips through.
    const parsed = parseTyped(text);
    if (parsed && /[\d٠-٩۰-۹]{2}\s*$/.test(text)) applyTyped(parsed);
  };
  const finishTyping = () => {
    const parsed = editing === null ? null : parseTyped(editing);
    if (parsed && parsed !== (kind === "month" ? monthValue : dateValue)) applyTyped(parsed);
    setEditing(null);
  };

  const compact = /\b(text-xs|h-8)\b/.test(className ?? "");
  return (
    <Popover open={open} onOpenChange={(next) => { if (!next) closePicker(); }}>
      <PopoverAnchor asChild>
        <div
          ref={wrapperRef}
          dir="rtl"
          style={style}
          data-disabled={disabled ? "" : undefined}
          className={cn(
            "relative inline-flex min-w-0 items-stretch overflow-hidden rounded-lg border border-border bg-card align-middle text-sm text-foreground transition-[border-color,box-shadow] duration-150",
            className,
            "p-0",
            stacked && "h-auto flex-wrap",
            open && "border-primary ring-2 ring-primary/20",
            "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60",
          )}
        >
          <button
            type="button"
            tabIndex={-1}
            disabled={blocked}
            aria-label={kind === "month" ? "فتح اختيار الشهر" : "فتح التقويم"}
            onClick={() => { if (open) closePicker(); else { openPicker(false); textRef.current?.focus({ preventScroll: true }); } }}
            className={cn("flex shrink-0 items-center justify-center border-e border-primary/15 bg-primary/5 px-2.5 text-primary transition-colors duration-150 hover:bg-primary/10 disabled:cursor-not-allowed", narrow && "hidden")}
          >
            <CalendarDays className="h-4 w-4" aria-hidden />
          </button>
          <input
            ref={textRef}
            id={id}
            type="text"
            autoComplete="off"
            disabled={disabled}
            readOnly={readOnly}
            inputMode={coarsePointer ? "none" : undefined}
            placeholder={placeholder || (kind === "month" ? "2026 / 10" : narrow ? "التاريخ" : "اختر التاريخ")}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            aria-haspopup="dialog"
            aria-expanded={open}
            value={editing ?? display}
            onChange={(event) => onTyped(event.target.value)}
            onClick={() => { if (!open) openPicker(false); }}
            onFocus={(event) => { setEditing(editText); onFocus?.(event); }}
            onBlur={(event) => { finishTyping(); onBlur?.(event); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && !open) { event.preventDefault(); openPicker(true); }
              else if (event.key === "Enter") {
                const parsed = editing === null ? null : parseTyped(editing);
                if (parsed) applyTyped(parsed);
                if (open) { event.preventDefault(); closePicker(); }
              }
            }}
            className={cn("w-full min-w-0 flex-1 bg-transparent px-2.5 text-start outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed", compact ? "min-h-7 py-0.5" : "min-h-9 py-1.5", narrow && "px-1.5 text-xs")}
          />
          {kind === "datetime-local" ? (
            <input
              type="time"
              dir="ltr"
              step={nativeProps.step}
              disabled={disabled}
              readOnly={readOnly}
              aria-label="الوقت"
              value={draft.time}
              onChange={(event) => changeTime(event.target.value)}
              onBlur={onBlur}
              className={cn("shrink-0 border-border/50 bg-transparent px-2 text-center tabular-nums outline-none disabled:cursor-not-allowed", stacked ? "min-h-9 w-full border-t" : "w-[6.75rem] border-s")}
            />
          ) : null}
          <input
            ref={(element) => {
              nativeRef.current = element;
              if (typeof forwardedRef === "function") forwardedRef(element);
              else if (forwardedRef) forwardedRef.current = element;
            }}
            {...nativeProps}
            type={kind}
            value={controlled ? value : undefined}
            defaultValue={controlled ? undefined : defaultValue}
            onChange={(event) => { setUncontrolled(event.target.value); onChange?.(event); }}
            disabled={disabled}
            readOnly={readOnly}
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        dir="rtl"
        align="start"
        collisionPadding={8}
        className="z-[200] w-[21.5rem] max-w-[calc(100vw-1rem)] rounded-2xl border-primary/15 p-3 shadow-lg"
        onClick={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => { if (!focusGrid) event.preventDefault(); }}
        onCloseAutoFocus={(event) => { event.preventDefault(); if (focusGrid) textRef.current?.focus({ preventScroll: true }); }}
        onEscapeKeyDown={() => { if (current !== valueWhenOpened.current) kind === "datetime-local" ? (setDraft(splitDateTime(valueWhenOpened.current)), emit(valueWhenOpened.current)) : emit(valueWhenOpened.current); }}
        onInteractOutside={(event) => { if (wrapperRef.current?.contains(event.target as Node)) event.preventDefault(); }}
      >
        <React.Suspense fallback={<div className="h-[21rem] animate-pulse rounded-xl bg-muted/40" aria-busy />}>
          {kind === "month" ? (
            <MonthPanel value={monthValue} min={String(nativeProps.min ?? "")} max={String(nativeProps.max ?? "")} autoFocus={focusGrid} onChange={emit} onDone={closePicker} />
          ) : (
            <DatePanel value={dateValue} min={dayBound(nativeProps.min)} max={dayBound(nativeProps.max)} autoFocus={focusGrid} onChange={changeDate} onDone={closePicker} />
          )}
        </React.Suspense>
      </PopoverContent>
    </Popover>
  );
});
