import type { DepartmentId, TaskBucket } from "@/domain/entities";

/** Centralized query keys so invalidation stays consistent across hooks. */
export const queryKeys = {
  dashboard: (department: DepartmentId) => ["dashboard", department] as const,
  tasks: (department: DepartmentId, bucket: TaskBucket | "all", search: string) =>
    ["tasks", department, bucket, search] as const,
  task: (department: DepartmentId, id: string) => ["task", department, id] as const,
};
