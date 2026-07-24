import { Pressable, Text, View } from "react-native";
import type { StagePhase } from "@/domain/status-engine";
import { stagePhaseColor } from "@/shared/theme";

/** Dashboard metric tile — tap to jump to that bucket in the task list. */
export function StatCard({
  label,
  value,
  phase,
  onPress,
}: {
  label: string;
  value: number;
  phase: StagePhase;
  onPress?: () => void;
}) {
  const color = stagePhaseColor(phase);
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <View className="h-1.5 w-8 rounded-full" style={{ backgroundColor: color }} />
      <Text className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{value}</Text>
      <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{label}</Text>
    </Pressable>
  );
}
