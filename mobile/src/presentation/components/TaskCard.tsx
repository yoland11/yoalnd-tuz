import { Pressable, Text, View } from "react-native";
import type { TaskSummary } from "@/domain/entities";
import { getDepartment } from "@/domain/department";
import { formatEventDate, formatEventTime } from "@/shared/format";
import { StageBadge } from "./StageBadge";

/** A single task row in the list. */
export function TaskCard({
  task,
  onPress,
}: {
  task: TaskSummary;
  onPress: () => void;
}) {
  const workflow = getDepartment(task.department).workflow;
  const when = [formatEventDate(task.date), formatEventTime(task.time)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      onPress={onPress}
      className="rounded-2xl border border-slate-200 bg-white p-4 active:opacity-80 dark:border-slate-800 dark:bg-slate-900"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text
            numberOfLines={1}
            className="text-base font-bold text-slate-900 dark:text-white"
          >
            {task.title}
          </Text>
          {task.subtitle ? (
            <Text
              numberOfLines={1}
              className="mt-0.5 text-xs text-slate-500 dark:text-slate-400"
            >
              {task.subtitle}
            </Text>
          ) : null}
        </View>
        <StageBadge workflow={workflow} stageKey={task.stageKey} />
      </View>
      {when ? (
        <Text className="mt-3 text-xs text-slate-400 dark:text-slate-500">{when}</Text>
      ) : null}
    </Pressable>
  );
}
