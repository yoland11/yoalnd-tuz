import { Text, View } from "react-native";
import type { StageWorkflow } from "@/domain/status-engine";
import { stageDef } from "@/domain/status-engine";
import { stagePhaseColor } from "@/shared/theme";

/** A colored chip for a stage key, colored by the stage's workflow phase. */
export function StageBadge({
  workflow,
  stageKey,
}: {
  workflow: StageWorkflow;
  stageKey: string;
}) {
  const def = stageDef(workflow, stageKey);
  const color = def ? stagePhaseColor(def.phase) : "#64748b";
  return (
    <View
      className="flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1"
      style={{ backgroundColor: `${color}22` }}
    >
      <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <Text className="text-xs font-semibold" style={{ color }}>
        {def?.label ?? stageKey}
      </Text>
    </View>
  );
}
