import * as React from "react"
import { cn } from "@/lib/utils"

const tones = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  danger: "bg-destructive/10 text-destructive",
} as const

export type IconFrameTone = keyof typeof tones

export interface IconFrameProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: IconFrameTone
  size?: "sm" | "default" | "lg"
}

const sizes = {
  sm: "h-9 w-9 rounded-lg [&_svg]:size-4",
  default: "h-11 w-11 rounded-xl [&_svg]:size-5",
  lg: "h-16 w-16 rounded-2xl [&_svg]:size-8",
} as const

export function IconFrame({
  tone = "neutral",
  size = "default",
  className,
  ...props
}: IconFrameProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center [&_svg]:shrink-0 [&_svg]:stroke-[1.8]",
        tones[tone],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}
