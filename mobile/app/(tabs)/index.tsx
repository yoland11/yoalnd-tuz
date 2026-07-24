import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/application/auth-context";
import { useDepartment } from "@/application/department-context";
import { useDashboardCounts } from "@/application/hooks";
import { DEPARTMENT_LIST } from "@/domain/department";
import { TASK_BUCKETS } from "@/domain/entities";
import { BUCKET_META } from "@/shared/theme";
import { Screen } from "@/presentation/components/Screen";
import { StatCard } from "@/presentation/components/StatCard";
import { ErrorState, LoadingState } from "@/presentation/components/states";

export default function HomeScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { departmentId, department, setDepartmentId } = useDepartment();
  const counts = useDashboardCounts(departmentId);

  return (
    <Screen>
      <ScrollView
        contentContainerClassName="pb-8 gap-5"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={counts.isFetching}
            onRefresh={() => counts.refetch()}
          />
        }
      >
        {/* Header */}
        <View className="flex-row items-center justify-between pt-2">
          <View>
            <Text className="text-xs text-slate-500 dark:text-slate-400">أهلاً</Text>
            <Text className="text-xl font-bold text-slate-900 dark:text-white">
              {user?.fullName || user?.username || "الكادر"}
            </Text>
          </View>
          <Pressable
            onPress={() => logout()}
            className="rounded-lg border border-slate-200 px-3 py-1.5 dark:border-slate-700"
          >
            <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              خروج
            </Text>
          </Pressable>
        </View>

        {/* Department switch */}
        <View className="flex-row gap-2">
          {DEPARTMENT_LIST.map((dep) => {
            const active = dep.id === departmentId;
            return (
              <Pressable
                key={dep.id}
                onPress={() => setDepartmentId(dep.id)}
                className={
                  active
                    ? "flex-1 rounded-xl bg-brand px-4 py-2.5"
                    : "flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900"
                }
              >
                <Text
                  className={
                    active
                      ? "text-center text-sm font-bold text-white"
                      : "text-center text-sm font-semibold text-slate-600 dark:text-slate-300"
                  }
                >
                  {dep.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Dashboard widgets */}
        {counts.isLoading ? (
          <LoadingState />
        ) : counts.isError ? (
          <ErrorState error={counts.error} onRetry={() => counts.refetch()} />
        ) : (
          <View className="gap-3">
            <View className="flex-row gap-3">
              <StatCard
                label={BUCKET_META.today.label}
                value={counts.data?.today ?? 0}
                phase={BUCKET_META.today.phase}
                onPress={() =>
                  router.push({ pathname: "/tasks", params: { bucket: "today" } })
                }
              />
              <StatCard
                label={BUCKET_META.late.label}
                value={counts.data?.late ?? 0}
                phase={BUCKET_META.late.phase}
                onPress={() =>
                  router.push({ pathname: "/tasks", params: { bucket: "late" } })
                }
              />
            </View>
            <View className="flex-row gap-3">
              <StatCard
                label={BUCKET_META.tomorrow.label}
                value={counts.data?.tomorrow ?? 0}
                phase={BUCKET_META.tomorrow.phase}
                onPress={() =>
                  router.push({ pathname: "/tasks", params: { bucket: "tomorrow" } })
                }
              />
              <StatCard
                label={BUCKET_META.completed.label}
                value={counts.data?.completed ?? 0}
                phase={BUCKET_META.completed.phase}
                onPress={() =>
                  router.push({ pathname: "/tasks", params: { bucket: "completed" } })
                }
              />
            </View>
          </View>
        )}

        <Pressable
          onPress={() =>
            router.push({ pathname: "/tasks", params: { bucket: "all" } })
          }
          className="rounded-2xl bg-slate-900 px-4 py-3.5 dark:bg-white"
        >
          <Text className="text-center text-sm font-bold text-white dark:text-slate-900">
            كل مهام {department.label} ({TASK_BUCKETS.reduce(
              (sum, b) => sum + (counts.data?.[b] ?? 0),
              0,
            )})
          </Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
