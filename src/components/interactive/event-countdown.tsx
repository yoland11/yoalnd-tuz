import { useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

type Remaining = {
  days: number;
  hours: number;
  minutes: number;
  expired: boolean;
};

function parseTarget(value?: string | null): Date | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function remainingUntil(target: Date | null): Remaining {
  if (!target) return { days: 0, hours: 0, minutes: 0, expired: true };
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, expired: true };
  const totalMinutes = Math.floor(diff / 60000);
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
    expired: false,
  };
}

export function EventCountdown({
  targetDate,
  title = "متبقي على الموعد",
  compact = false,
  className,
}: {
  targetDate?: string | null;
  title?: string;
  compact?: boolean;
  className?: string;
}) {
  const target = useMemo(() => parseTarget(targetDate), [targetDate]);
  const [remaining, setRemaining] = useState(() => remainingUntil(target));

  useEffect(() => {
    setRemaining(remainingUntil(target));
    if (!target) return undefined;
    const timer = window.setInterval(() => setRemaining(remainingUntil(target)), 30000);
    return () => window.clearInterval(timer);
  }, [target]);

  if (!target || remaining.expired) return null;

  const units = [
    { label: "يوم", value: remaining.days },
    { label: "ساعة", value: remaining.hours },
    { label: "دقيقة", value: remaining.minutes },
  ];

  return (
    <div
      className={cn(
        "rounded-xl border border-primary/25 bg-primary/5 text-foreground",
        compact ? "p-3" : "p-4",
        className,
      )}
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
        <CalendarClock className="h-4 w-4" />
        <span>{title}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {units.map((unit) => (
          <div key={unit.label} className="rounded-lg border border-border/25 bg-background/60 px-2 py-2 text-center">
            <p className={cn("font-bold text-foreground tabular-nums", compact ? "text-base" : "text-xl")}>
              {unit.value.toLocaleString("ar-IQ")}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{unit.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
