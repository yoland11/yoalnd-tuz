import { useId } from "react";
import { Cake, CalendarDays, Check, Gem, GraduationCap, Heart, MoonStar, Plus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BOOKING_EVENT_TYPES, bookingEventTypeLabel, normalizeBookingEventType, type BookingEventFilter, type BookingEventType } from "@/lib/booking-event-types";

const icons: Record<BookingEventType, LucideIcon> = { engagement: Gem, henna: MoonStar, wedding: Heart, birthday: Cake, graduation: GraduationCap, other: Plus };

export function BookingEventTypeSelector({ value, onChange, required = false, error, disabled, id }: {
  value: unknown;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  id?: string;
}) {
  const generated = useId();
  const groupId = id ?? `booking-occasion-${generated}`;
  const selected = normalizeBookingEventType(value);
  const legacy = !selected && typeof value === "string" && value.trim() ? value.trim() : null;
  return <fieldset id={groupId} disabled={disabled} dir="rtl" role="radiogroup" aria-labelledby={`${groupId}-label`} aria-required={required || undefined} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `${groupId}-error` : undefined} className="min-w-0 space-y-2">
    <legend id={`${groupId}-label`} className="mb-2 text-sm font-semibold">نوع المناسبة{required ? <span className="ms-1 text-destructive" aria-hidden="true">*</span> : null}</legend>
    <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {BOOKING_EVENT_TYPES.map(type => {
        const Icon = icons[type.key];
        return <label key={type.key} className="relative min-w-0 cursor-pointer has-disabled:cursor-not-allowed">
          <input type="radio" name={groupId} value={type.key} checked={selected === type.key} onChange={() => onChange(type.label)} required={required} disabled={disabled} className="peer sr-only" aria-label={type.label} />
          <span className="flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-background px-2 py-3 text-center text-sm font-medium text-foreground transition-colors peer-checked:border-[#760d3b] peer-checked:bg-[#760d3b] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-[#b77491] peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 dark:peer-checked:bg-[#922653]">
            <Icon aria-hidden="true" className="size-5 shrink-0" /><span className="break-words">{type.label}</span>
            {selected === type.key ? <Check aria-hidden="true" className="absolute start-2 top-2 size-3.5" /> : null}
          </span>
        </label>;
      })}
    </div>
    {legacy ? <p className="break-words text-xs text-muted-foreground">نوع المناسبة المحفوظ: {legacy}. يبقى محفوظاً إلى أن تختار نوعاً جديداً.</p> : null}
    {error ? <p id={`${groupId}-error`} role="alert" className="text-xs text-destructive">{error}</p> : null}
  </fieldset>;
}

export function BookingEventTypeBadge({ value, className }: { value: unknown; className?: string }) {
  const key = normalizeBookingEventType(value);
  const Icon = key ? icons[key] : typeof value === "string" && value.trim() ? Plus : CalendarDays;
  const label = bookingEventTypeLabel(value);
  return <span title={label} className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-[#edd5df] bg-[#fff5f8] px-2 py-1 text-xs font-medium text-[#760d3b] dark:border-[#684552] dark:bg-[#39232e] dark:text-[#f5d6e3]", className)}><Icon aria-hidden="true" className="size-3.5 shrink-0" /><span className="truncate">{label}</span></span>;
}

export function BookingEventTypeFilter({ value, onChange }: { value: BookingEventFilter; onChange: (value: BookingEventFilter) => void }) {
  return <div role="group" aria-label="تصفية حسب نوع المناسبة" dir="rtl" className="flex min-w-0 max-w-full gap-1.5 overflow-x-auto py-1">
    {[{ key: "all" as const, label: "الكل" }, ...BOOKING_EVENT_TYPES].map(type => {
      const Icon = type.key === "all" ? CalendarDays : icons[type.key];
      return <Button key={type.key} type="button" variant="outline" size="sm" aria-pressed={value === type.key} onClick={() => onChange(type.key)} className={cn("shrink-0 gap-1.5", value === type.key && "border-[#760d3b] bg-[#760d3b] text-white hover:bg-[#641035] hover:text-white")}><Icon aria-hidden="true" className="size-4" />{type.key === "other" ? "أخرى" : type.label}</Button>;
    })}
  </div>;
}
