import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { DepartmentStrategy } from "@/domain/department";
import { nextStage, stageIndex } from "@/domain/status-engine";
import { stagePhaseColor } from "@/shared/theme";

/**
 * Vertical status engine: renders every workflow stage, marks completed /
 * current, and (when the department supports it and a next step exists) offers a
 * one-tap forward transition. Advancing is always a single forward step — the
 * server enforces the same rule, and rejects (e.g. media-required) surface as an
 * error the caller shows.
 */
export function StageStepper({
  department,
  currentStageKey,
  onAdvance,
  advancing,
}: {
  department: DepartmentStrategy;
  currentStageKey: string;
  onAdvance: (toStageKey: string) => void;
  advancing: boolean;
}) {
  const workflow = department.workflow;
  const currentIndex = stageIndex(workflow, currentStageKey);
  const next = nextStage(workflow, currentStageKey);
  const canAdvance = department.capabilities.advanceStage && next != null;

  return (
    <View className="gap-0">
      {workflow.stages.map((stage, index) => {
        const isDone = currentIndex >= 0 && index < currentIndex;
        const isCurrent = index === currentIndex;
        const color = stagePhaseColor(stage.phase);
        const isLast = index === workflow.stages.length - 1;
        return (
          <View key={stage.key} className="flex-row items-stretch gap-3">
            <View className="items-center">
              <View
                className="h-4 w-4 rounded-full border-2"
                style={{
                  backgroundColor: isDone || isCurrent ? color : "transparent",
                  borderColor: color,
                }}
              />
              {!isLast ? (
                <View
                  className="w-0.5 flex-1"
                  style={{ backgroundColor: isDone ? color : "#e2e8f0", minHeight: 22 }}
                />
              ) : null}
            </View>
            <Text
              className={
                isCurrent
                  ? "pb-4 text-sm font-bold text-slate-900 dark:text-white"
                  : "pb-4 text-sm text-slate-500 dark:text-slate-400"
              }
            >
              {stage.label}
            </Text>
          </View>
        );
      })}

      {canAdvance && next ? (
        <Pressable
          disabled={advancing}
          onPress={() => onAdvance(next.key)}
          className="mt-2 flex-row items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 active:opacity-80"
          style={advancing ? { opacity: 0.6 } : undefined}
        >
          {advancing ? <ActivityIndicator color="#fff" size="small" /> : null}
          <Text className="text-sm font-bold text-white">
            الانتقال إلى: {next.label}
          </Text>
        </Pressable>
      ) : !department.capabilities.advanceStage ? (
        <Text className="mt-2 text-center text-xs text-slate-400 dark:text-slate-500">
          عرض فقط — تغيير المراحل غير مُفعّل لهذا القسم بعد
        </Text>
      ) : (
        <Text className="mt-2 text-center text-xs text-slate-400 dark:text-slate-500">
          المرحلة الأخيرة القابلة للتحديث — التسليم يتم من نموذج مخصص
        </Text>
      )}
    </View>
  );
}
