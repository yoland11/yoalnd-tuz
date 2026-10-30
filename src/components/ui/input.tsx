import * as React from "react"

import { DateField, type DateFieldProps } from "@/components/ui/date-field"
import { isDateInputKind } from "@/lib/arabic-date"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, DateFieldProps>(
  ({ className, type, nativePicker, ...props }, ref) => {
    if (isDateInputKind(type) && !nativePicker) {
      return <DateField ref={ref} type={type} className={cn("h-10 w-full font-medium", className)} {...props} />
    }
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-[border-color,box-shadow,background-color] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-50 max-md:h-11 max-md:min-w-0 max-md:text-base",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
