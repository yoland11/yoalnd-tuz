import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import { Check, CircleDollarSign, ClipboardCheck, FileImage, Gift, GraduationCap, Layers3, PackageCheck, Palette, Ruler, ScanLine, Scissors } from "lucide-react";

export const GRADUATION_STEPS = [
  { label: "النوع", icon: GraduationCap }, { label: "القياسات", icon: Ruler },
  { label: "الألوان", icon: Palette }, { label: "القماش", icon: Layers3 },
  { label: "الطباعة / التطريز", icon: Scissors }, { label: "النصوص", icon: FileImage },
  { label: "الإكسسوارات", icon: PackageCheck }, { label: "خدمات إضافية", icon: Gift },
  { label: "المعاينة", icon: ScanLine }, { label: "ملخص السعر", icon: CircleDollarSign },
  { label: "التأكيد", icon: ClipboardCheck },
] as const;

export const GRADUATION_THEME_STYLE = {
  "--primary": "43 59% 59%", "--primary-foreground": "240 24% 6%", "--ring": "43 59% 59%",
} as CSSProperties;

export function GraduationStepRail({ current }: { current: number }) {
  return <div className="overflow-x-auto border-b border-border bg-card/95 px-3 py-3 backdrop-blur md:sticky md:top-0 md:z-30"><div className="mx-auto flex min-w-[840px] max-w-7xl items-start justify-between" dir="rtl">{GRADUATION_STEPS.map((step, index) => {
    const Icon = step.icon; const active = index === current; const done = index < current;
    return <div key={step.label} className="relative flex w-[9.5%] flex-col items-center gap-1.5 text-center">
      {index < GRADUATION_STEPS.length - 1 ? <span className={`absolute right-[58%] top-4 h-px w-[90%] transition-colors ${done ? "bg-primary" : "bg-border"}`} /> : null}
      <motion.span animate={{ scale: active ? 1.08 : 1 }} transition={{ duration: 0.18 }} className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full border text-xs font-bold transition-colors ${active ? "border-primary bg-primary text-primary-foreground shadow-[0_0_18px_hsl(var(--primary)/.22)]" : done ? "border-primary bg-background text-primary" : "border-border bg-card text-muted-foreground"}`}>
        {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </motion.span><span className={`whitespace-nowrap text-[11px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`}>{step.label}</span>
    </div>;
  })}</div></div>;
}
