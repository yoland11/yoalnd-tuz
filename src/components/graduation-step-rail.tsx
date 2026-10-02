import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CircleDollarSign,
  ClipboardCheck,
  FileImage,
  Gift,
  GraduationCap,
  Layers3,
  PackageCheck,
  Palette,
  Ruler,
  Scissors,
} from "lucide-react";

export const GRADUATION_STEPS = [
  { label: "النوع", icon: GraduationCap },
  { label: "القياسات", icon: Ruler },
  { label: "الألوان", icon: Palette },
  { label: "القماش", icon: Layers3 },
  { label: "الطباعة / التطريز", icon: Scissors },
  { label: "التخصيص", icon: FileImage },
  { label: "الإكسسوارات", icon: PackageCheck },
  { label: "خدمات إضافية", icon: Gift },
  { label: "ملخص السعر", icon: CircleDollarSign },
  { label: "التأكيد", icon: ClipboardCheck },
] as const;

export const GRADUATION_THEME_STYLE = {
  "--primary": "334 100% 23%",
  "--primary-foreground": "0 0% 100%",
  "--ring": "334 100% 23%",
} as CSSProperties;

export function GraduationStepRail({
  current,
  onStepChange,
}: {
  current: number;
  onStepChange?: (step: number) => void;
}) {
  const visualCurrent = current >= 10 ? 9 : current >= 8 ? 8 : current;
  return (
    <div className="overflow-x-auto border-b border-[#f0e7e9] bg-white/95 px-3 py-4 backdrop-blur md:sticky md:top-0 md:z-30">
      <div
        className="mx-auto flex min-w-[920px] max-w-7xl items-start justify-between"
        dir="rtl"
      >
        {GRADUATION_STEPS.map((step, index) => {
          const Icon = step.icon;
          const active = index === visualCurrent;
          const done = index < visualCurrent;
          const content = (
            <>
              {index < GRADUATION_STEPS.length - 1 ? (
                <span
                  className={`absolute right-[58%] top-4 h-px w-[90%] transition-colors ${done ? "bg-primary" : "bg-border"}`}
                />
              ) : null}
              <motion.span
                animate={{ scale: active ? 1.08 : 1 }}
                transition={{ duration: 0.18 }}
                className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border text-xs font-bold transition-colors ${active ? "border-primary bg-primary text-primary-foreground shadow-[0_5px_16px_rgba(104,0,47,.2)]" : done ? "border-primary bg-white text-primary" : "border-[#e9dfe2] bg-white text-[#8a747c]"}`}
              >
                {done ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <span className="flex flex-col items-center gap-0.5"><Icon className="h-4 w-4" /><span className="text-[9px]">{index + 1}</span></span>
                )}
              </motion.span>
              <span
                className={`whitespace-nowrap text-[11px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`}
              >
                {step.label}
              </span>
            </>
          );
          const className =
            "relative flex w-[9.5%] flex-col items-center gap-1.5 text-center";
          return onStepChange ? (
            <button
              key={step.label}
              type="button"
              onClick={() => onStepChange(index)}
              className={`${className} cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`}
              aria-current={active ? "step" : undefined}
            >
              {content}
            </button>
          ) : (
            <div key={step.label} className={className}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
