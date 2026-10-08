import type { GraduationAdminUser } from "@/server/graduation";

export type RepresentativeScope =
  | { kind: "admin" }
  | { kind: "group"; groupId: number }
  | { kind: "denied"; reason: "inactive" | "permission" | "missing" | "ambiguous" };

export function classifyRepresentativeScope(
  user: Pick<GraduationAdminUser, "role" | "isActive" | "permissions">,
  activeGroupIds: number[],
): RepresentativeScope {
  if (!user.isActive) return { kind: "denied", reason: "inactive" };
  if (user.role === "admin") return { kind: "admin" };
  if (!user.permissions.includes("representative.portal.access"))
    return { kind: "denied", reason: "permission" };
  if (activeGroupIds.length === 0) return { kind: "denied", reason: "missing" };
  if (activeGroupIds.length !== 1)
    return { kind: "denied", reason: "ambiguous" };
  return { kind: "group", groupId: activeGroupIds[0] };
}

export function canAccessRepresentativeGroup(
  scope: RepresentativeScope,
  groupId: number,
): boolean {
  return scope.kind === "admin" ||
    (scope.kind === "group" && scope.groupId === groupId);
}
