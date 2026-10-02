export const STAFF_PERMISSION_CODES = [
  "staff.view",
  "staff.create",
  "staff.edit",
  "staff.delete",
  "staff.role",
] as const;

export type StaffPermission = (typeof STAFF_PERMISSION_CODES)[number];

/** The legacy `staff` grant keeps its existing full-access behavior. */
export function hasStaffPermission(
  permissions: readonly string[] | null | undefined,
  permission: StaffPermission,
): boolean {
  return Boolean(permissions?.includes(permission) || permissions?.includes("staff"));
}

const LIMITED_STAFF_ROLES = new Set(["employee", "booking_staff", "photographer"]);

export function canAssignStaffRole(
  viewerRole: string | null | undefined,
  permissions: readonly string[] | null | undefined,
): boolean {
  return viewerRole === "admin" || hasStaffPermission(permissions, "staff.role");
}

export function canManageStaffPermissionSets(
  viewerRole: string | null | undefined,
  permissions: readonly string[] | null | undefined,
): boolean {
  return viewerRole === "admin" || Boolean(permissions?.includes("staff"));
}

export function isLimitedStaffRoleAssignable(role: string): boolean {
  return LIMITED_STAFF_ROLES.has(role);
}

export function canAssignStaffRoleTo(
  viewerRole: string | null | undefined,
  permissions: readonly string[] | null | undefined,
  targetRole: string,
): boolean {
  if (!canAssignStaffRole(viewerRole, permissions)) return false;
  return (
    canManageStaffPermissionSets(viewerRole, permissions) ||
    isLimitedStaffRoleAssignable(targetRole)
  );
}
