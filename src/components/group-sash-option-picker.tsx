import { Button } from "@/components/ui/button";
import { SASH_TYPES, validateGroupSashOptions } from "@/lib/graduation-student-flow";

export function toggleGroupSashOption(options: string[], sashType: string): string[] {
  if (!SASH_TYPES.some((type) => type.key === sashType)) return options;
  if (options.includes(sashType))
    return options.length > 1 ? options.filter((value) => value !== sashType) : options;
  return options.length < 2 ? [...options, sashType] : options;
}

export function GroupSashOptionPicker({
  options,
  onChange,
}: {
  options: string[];
  onChange: (options: string[]) => void;
}) {
  const selected = validateGroupSashOptions(options) || ["standard"];
  return (
    <div>
      <div role="group" aria-label="أنواع الوشاح المعتمدة" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SASH_TYPES.map((type) => {
          const checked = selected.includes(type.key);
          return (
            <Button
              key={type.key}
              type="button"
              variant={checked ? "selected" : "outline"}
              aria-pressed={checked}
              disabled={!checked && selected.length === 2}
              onClick={() => onChange(toggleGroupSashOption(selected, type.key))}
              className="min-h-11"
            >
              {type.label}
            </Button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
        {selected.length === 1
          ? "نوع واحد: يُطبّق على جميع طلبة المجموعة."
          : "نوعان: يختار الطالب واحداً منهما."}
      </p>
    </div>
  );
}
