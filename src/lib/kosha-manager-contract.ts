import type { KoshaBooking } from "@/views/admin/koshas";

export type KoshaManagerSource = "kosha" | "service";
export type KoshaManagerActivity = {
  photos: number;
  notes: number;
  problems: number;
  openProblems: number;
  latestAt: string | null;
  latestBy: string | null;
  latestLabel: string | null;
};
export type KoshaManagerBooking = KoshaBooking & {
  source: KoshaManagerSource;
  number: string;
  koshaImage: string | null;
  updatedAt: string;
  archivedAt: string | null;
  assignedEmployees: string[];
  activity: KoshaManagerActivity;
};
export type KoshaManagerList = {
  items: KoshaManagerBooking[];
  total: number;
  page: number;
  pageSize: 10 | 25 | 50;
  /** Counts use the entire eligible dataset, before active list filters. */
  stats: { total: number; completed: number; inProgress: number; upcoming: number; cancelled: number };
  koshas: Array<{ id: number; name: string }>;
};
export type KoshaManagerMedia = {
  id: string;
  url: string;
  kind: "image" | "video";
  purpose: string;
  stage: string | null;
  staffName: string | null;
  createdAt: string | null;
};
export type KoshaManagerTimeline = {
  id: string;
  type: string;
  title: string;
  note: string | null;
  staffName: string | null;
  createdAt: string | null;
  fromStage: string | null;
  toStage: string | null;
};
export type KoshaManagerProblem = {
  id: number;
  kind: "damage";
  description: string;
  status: string;
  priority: string;
  photoUrl: string | null;
  staffName: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  canResolve: boolean;
};
export type KoshaManagerDetail = {
  booking: KoshaManagerBooking;
  media: KoshaManagerMedia[];
  timeline: KoshaManagerTimeline[];
  damages: KoshaManagerProblem[];
  referencePhotos: string[];
  assignedStaff: Array<{ id: number | null; name: string; role: string }>;
  delivery: { hasLoss: boolean; hasBreakage: boolean; note: string | null; staffName: string | null; createdAt: string | null; signatureUrl: string | null } | null;
  workOrder: { id: number; number: string; status: string; leaderName: string | null; requiredArrivalAt: string | null; completedAt: string | null } | null;
  permissions: { execution: boolean; resolveProblems: boolean };
};
