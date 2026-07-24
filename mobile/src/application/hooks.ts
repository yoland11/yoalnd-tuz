import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDepartment } from "@/domain/department";
import type { DepartmentId, TaskBucket } from "@/domain/entities";
import { http } from "./container";
import { queryKeys } from "./query-keys";

/** Home dashboard counts for a department. */
export function useDashboardCounts(departmentId: DepartmentId) {
  return useQuery({
    queryKey: queryKeys.dashboard(departmentId),
    queryFn: () => getDepartment(departmentId).fetchDashboardCounts(http),
  });
}

/** Assignment-filtered task list, optionally scoped to a bucket / search. */
export function useTasks(
  departmentId: DepartmentId,
  bucket: TaskBucket | "all",
  search: string,
) {
  return useQuery({
    queryKey: queryKeys.tasks(departmentId, bucket, search),
    queryFn: () => getDepartment(departmentId).fetchTasks(http, { bucket, search }),
  });
}

/** Full task detail (customer, venue, timeline, current stage). */
export function useTaskDetail(departmentId: DepartmentId, id: string) {
  return useQuery({
    queryKey: queryKeys.task(departmentId, id),
    queryFn: () => getDepartment(departmentId).fetchTaskDetail(http, id),
    enabled: Boolean(id),
  });
}

/**
 * Advance a task to the next stage. On success we invalidate the task detail,
 * every task list, and the dashboard so the whole app reflects the new stage
 * immediately (the same guarantee the web portal gives).
 */
export function useAdvanceStage(departmentId: DepartmentId, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { toStage: string; note?: string }) =>
      getDepartment(departmentId).advanceStage(http, id, input.toStage, input.note),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(departmentId, id) });
      void queryClient.invalidateQueries({ queryKey: ["tasks", departmentId] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(departmentId) });
    },
  });
}
