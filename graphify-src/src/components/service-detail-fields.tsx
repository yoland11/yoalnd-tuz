import {
  type CrewOption,
  type ServiceDetailField,
  filesToStoredValues,
  getServiceDetailFields,
} from "@/lib/service-details";

type Props = {
  serviceType?: string | null;
  value: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  crews?: CrewOption[];
  errors?: Record<string, string>;
  grid?: boolean;
  density?: "admin" | "form";
};

const inputClass =
  "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors";

export function ServiceDetailFields({
  serviceType,
  value,
  onChange,
  crews = [],
  errors = {},
  grid = true,
  density = "admin",
}: Props) {
  const fields = getServiceDetailFields(serviceType).filter(
    (field) => !field.dependsOn || value[field.dependsOn.key] === field.dependsOn.value,
  );

  if (fields.length === 0) return null;

  return (
    <div className={grid ? "grid grid-cols-1 sm:grid-cols-2 gap-3" : "space-y-6"}>
      {fields.map((field) => (
        <ServiceDetailInput
          key={field.key}
          field={field}
          value={value[field.key]}
          crews={crews}
          error={errors[field.key]}
          density={density}
          onChange={(fieldValue) => onChange({ ...value, [field.key]: fieldValue })}
        />
      ))}
    </div>
  );
}

function ServiceDetailInput({
  field,
  value,
  crews,
  error,
  density,
  onChange,
}: {
  field: ServiceDetailField;
  value: any;
  crews: CrewOption[];
  error?: string;
  density: "admin" | "form";
  onChange: (value: any) => void;
}) {
  const label = field.label;
  const currentValue = value == null ? "" : String(value);
  const crewOptions = field.source === "crews" ? activeCrewOptions(crews, currentValue) : [];
  const selectedCrew = field.source === "crews" ? crewOptions.find((crew) => crew.name === currentValue) : undefined;
  const labelClass =
    density === "form"
      ? "block text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      : "block text-xs text-muted-foreground mb-1";
  const fieldClass = density === "form" ? "space-y-2" : "";
  const errorClass =
    density === "form"
      ? "text-[0.8rem] font-medium text-destructive"
      : "mt-1 text-xs text-destructive";

  return (
    <div className={fieldClass}>
      <label className={labelClass}>{label}</label>
      {field.type === "textarea" ? (
        <textarea
          value={currentValue}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} min-h-[100px] resize-none`}
        />
      ) : field.type === "select" ? (
        <>
          <select value={currentValue} onChange={(e) => onChange(e.target.value)} className={inputClass}>
            {field.source === "crews" && (
              <option value="">{crewOptions.length === 0 ? "لا يوجد كادر مفعّل" : "اختر الكادر"}</option>
            )}
            {field.source === "crews"
              ? crewOptions.map((crew) => (
                  <option key={`${crew.id}-${crew.name}`} value={crew.name}>
                    {crew.name}{crew.status && crew.status !== "available" ? ` - ${crewStatusLabel(crew.status)}` : ""}
                  </option>
                ))
              : field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
          </select>
          {selectedCrew && selectedCrew.status && !["available", "inactive"].includes(selectedCrew.status) && (
            <p className="mt-1 text-[11px] text-status-warning">
              تنبيه: حالة الكادر {crewStatusLabel(selectedCrew.status)}، يمكن إكمال الحجز عند الحاجة.
            </p>
          )}
        </>
      ) : field.type === "file" ? (
        <>
          <input
            type="file"
            accept={field.accept}
            multiple={field.multiple}
            onChange={async (e) => {
              const stored = await filesToStoredValues(e.currentTarget.files, field.multiple);
              onChange(stored);
            }}
            className={inputClass}
          />
          {value ? <p className="mt-1 text-[11px] text-muted-foreground">{fileSummary(value)}</p> : null}
        </>
      ) : (
        <input
          type={field.type}
          min={field.min}
          max={field.max}
          value={currentValue}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

function crewStatusLabel(status?: string) {
  if (status === "busy") return "مشغول";
  if (status === "vacation") return "إجازة";
  if (status === "inactive") return "غير مفعل";
  return "متاح";
}

function activeCrewOptions(crews: CrewOption[], currentValue: string) {
  const active = crews.filter((crew) => crew.isActive !== false && crew.status !== "inactive");
  if (currentValue && !active.some((crew) => crew.name === currentValue)) {
    return [{ id: -1, name: currentValue, isActive: true }, ...active];
  }
  return active;
}

function fileSummary(value: any): string {
  if (Array.isArray(value)) return `${value.length} ملف محفوظ`;
  if (value?.name) return `ملف محفوظ: ${value.name}`;
  return "ملف محفوظ";
}
