export const STAFF_PERMISSION_CODES = [
  "staff.view",
  "staff.create",
  "staff.edit",
  "staff.delete",
] as const;

export type StaffPermission = (typeof STAFF_PERMISSION_CODES)[number];

/** The legacy `staff` grant keeps its existing full-access behavior. */
export function hasStaffPermission(
  permissions: readonly string[] | null | undefined,
  permission: StaffPermission,
): boolean {
  return Boolean(permissions?.includes(permission) || permissions?.includes("staff"));
}
