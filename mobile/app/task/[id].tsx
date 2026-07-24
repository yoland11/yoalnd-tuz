import { useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { getDepartment } from "@/domain/department";
import type { DepartmentId } from "@/domain/entities";
import { useAdvanceStage, useTaskDetail } from "@/application/hooks";
import { mapsUrl, telUrl } from "@/shared/format";
import { Screen } from "@/presentation/components/Screen";
import { StageBadge } from "@/presentation/components/StageBadge";
import { StageStepper } from "@/presentation/components/StageStepper";
import {
  ErrorState,
  LoadingState,
  errorMessage,
} from "@/presentation/components/states";

function normalizeDepartment(value: string | undefined): DepartmentId {
  return value === "photography" ? "photography" : "koshat";
}

export default function TaskDetailScreen() {
  const params = useLocalSearchParams<{ id: string; department?: string }>();
  const id = String(params.id);
  const departmentId = normalizeDepartment(params.department);
  const department = getDepartment(departmentId);

  const detail = useTaskDetail(departmentId, id);
  const advance = useAdvanceStage(departmentId, id);
  const [note, setNote] = useState("");

  function confirmAdvance(toStageKey: string) {
    const label = department.workflow.stages.find((s) => s.key === toStageKey)?.label ?? toStageKey;
    Alert.alert("تأكيد", `الانتقال إلى مرحلة: ${label}؟`, [
      { text: "إلغاء", style: "cancel" },
      {
        text: "تأكيد",
        onPress: () =>
          advance.mutate(
            { toStage: toStageKey, note: note.trim() || undefined },
            {
              onSuccess: () => setNote(""),
              onError: (e) => Alert.alert("تعذّر تغيير المرحلة", errorMessage(e)),
            },
          ),
      },
    ]);
  }

  if (detail.isLoading) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Screen>
        <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
      </Screen>
    );
  }

  const task = detail.data;
  const maps = mapsUrl({ query: task.mapsQuery });
  const tel = telUrl(task.phone);

  return (
    <Screen>
      <ScrollView
        contentContainerClassName="pb-10 gap-5 pt-2"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={detail.isFetching} onRefresh={() => detail.refetch()} />
        }
      >
        <View className="gap-2">
          <Text className="text-2xl font-bold text-slate-900 dark:text-white">
            {task.title}
          </Text>
          <StageBadge workflow={department.workflow} stageKey={task.stageKey} />
        </View>

        {/* Quick actions */}
        <View className="flex-row gap-3">
          <Pressable
            disabled={!tel}
            onPress={() => tel && Linking.openURL(tel)}
            className="flex-1 rounded-xl border border-slate-200 bg-white py-3 dark:border-slate-700 dark:bg-slate-900"
            style={!tel ? { opacity: 0.5 } : undefined}
          >
            <Text className="text-center text-sm font-semibold text-slate-700 dark:text-slate-200">
              اتصال
            </Text>
          </Pressable>
          <Pressable
            disabled={!maps}
            onPress={() => maps && Linking.openURL(maps)}
            className="flex-1 rounded-xl border border-slate-200 bg-white py-3 dark:border-slate-700 dark:bg-slate-900"
            style={!maps ? { opacity: 0.5 } : undefined}
          >
            <Text className="text-center text-sm font-semibold text-slate-700 dark:text-slate-200">
              الخريطة
            </Text>
          </Pressable>
        </View>

        {/* Details */}
        <View className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <Text className="mb-3 text-sm font-bold text-slate-900 dark:text-white">
            التفاصيل
          </Text>
          <View className="gap-2.5">
            {task.fields.map((field) => (
              <View key={field.label} className="flex-row justify-between gap-4">
                <Text className="text-xs text-slate-500 dark:text-slate-400">
                  {field.label}
                </Text>
                <Text className="flex-1 text-left text-xs font-medium text-slate-800 dark:text-slate-200">
                  {field.value}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Status engine */}
        <View className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <Text className="mb-3 text-sm font-bold text-slate-900 dark:text-white">
            مراحل التنفيذ
          </Text>
          {department.capabilities.advanceStage ? (
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="ملاحظة على التغيير (اختياري)"
              placeholderTextColor="#94a3b8"
              className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          ) : null}
          <StageStepper
            department={department}
            currentStageKey={task.stageKey}
            advancing={advance.isPending}
            onAdvance={confirmAdvance}
          />
        </View>

        {/* Timeline */}
        {task.timeline.length ? (
          <View className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <Text className="mb-3 text-sm font-bold text-slate-900 dark:text-white">
              السجل
            </Text>
            <View className="gap-3">
              {task.timeline.slice(0, 30).map((event, index) => (
                <View key={String(event.id ?? index)} className="gap-0.5">
                  <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {event.toStage
                      ? `${event.staffName ?? ""} → ${event.toStage}`
                      : event.staffName || event.type || "حدث"}
                  </Text>
                  {event.note ? (
                    <Text className="text-xs text-slate-500 dark:text-slate-400">
                      {event.note}
                    </Text>
                  ) : null}
                  {event.createdAt ? (
                    <Text
                      className="text-[10px] text-slate-400 dark:text-slate-500"
                      style={{ writingDirection: "ltr" }}
                    >
                      {event.createdAt}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
