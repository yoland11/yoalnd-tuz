import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDepartment } from "@/application/department-context";
import { useTasks } from "@/application/hooks";
import { TASK_BUCKETS, type TaskBucket } from "@/domain/entities";
import { BUCKET_META } from "@/shared/theme";
import { Screen } from "@/presentation/components/Screen";
import { TaskCard } from "@/presentation/components/TaskCard";
import { EmptyState, ErrorState, LoadingState } from "@/presentation/components/states";

type Filter = TaskBucket | "all";
const FILTERS: Filter[] = ["all", ...TASK_BUCKETS];

export default function TasksScreen() {
  const router = useRouter();
  const { departmentId } = useDepartment();
  const params = useLocalSearchParams<{ bucket?: string }>();

  const initialBucket = useMemo<Filter>(() => {
    const b = params.bucket;
    return b && (FILTERS as string[]).includes(b) ? (b as Filter) : "all";
  }, [params.bucket]);

  const [filter, setFilter] = useState<Filter>(initialBucket);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => setFilter(initialBucket), [initialBucket]);

  // Debounce the search box so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 350);
    return () => clearTimeout(t);
  }, [searchText]);

  const tasks = useTasks(departmentId, filter, search);

  return (
    <Screen>
      <View className="gap-3 pt-2">
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="بحث بالاسم أو الهاتف أو الموقع"
          placeholderTextColor="#94a3b8"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item}
          contentContainerClassName="gap-2"
          renderItem={({ item }) => {
            const active = item === filter;
            const label = item === "all" ? "الكل" : BUCKET_META[item]?.label ?? item;
            return (
              <Pressable
                onPress={() => setFilter(item)}
                className={
                  active
                    ? "rounded-full bg-brand px-3.5 py-1.5"
                    : "rounded-full border border-slate-200 bg-white px-3.5 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                }
              >
                <Text
                  className={
                    active
                      ? "text-xs font-bold text-white"
                      : "text-xs font-semibold text-slate-600 dark:text-slate-300"
                  }
                >
                  {label}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {tasks.isLoading ? (
        <LoadingState />
      ) : tasks.isError ? (
        <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
      ) : (
        <FlatList
          data={tasks.data ?? []}
          keyExtractor={(item) => item.id}
          className="mt-3"
          contentContainerClassName="gap-3 pb-8"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={tasks.isFetching} onRefresh={() => tasks.refetch()} />
          }
          ListEmptyComponent={<EmptyState label="لا توجد مهام في هذا التصنيف" />}
          renderItem={({ item }) => (
            <TaskCard
              task={item}
              onPress={() =>
                router.push({
                  pathname: "/task/[id]",
                  params: { id: item.id, department: item.department },
                })
              }
            />
          )}
        />
      )}
    </Screen>
  );
}
