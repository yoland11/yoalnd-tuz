import type { ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { cn } from "@/shared/cn";

/** Standard screen frame: safe-area top inset + page padding + themed bg. */
export function Screen({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950" edges={["top"]}>
      <View className={cn("flex-1", padded && "px-4", className)}>{children}</View>
    </SafeAreaView>
  );
}
