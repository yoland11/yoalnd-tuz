import * as React from "react"
import { Button, type ButtonProps } from "@/components/ui/button"

export type IconButtonProps = Omit<ButtonProps, "size" | "aria-label"> & {
  "aria-label": string
  size?: "compact" | "default"
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = "default", variant = "ghost", type, asChild = false, ...props }, ref) => (
    <Button
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      asChild={asChild}
      variant={variant}
      size={size === "compact" ? "iconSm" : "icon"}
      {...props}
    />
  ),
)

IconButton.displayName = "IconButton"

export { IconButton }
