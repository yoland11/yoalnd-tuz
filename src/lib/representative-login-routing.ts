type PortalUser = {
  role: string;
  isActive: boolean;
  permissions: string[];
};

export function canEnterRepresentativePortal(user: PortalUser): boolean {
  return user.isActive && (user.role === "admin" ||
    user.permissions.includes("representative.portal.access"));
}

export function adminLoginDestination(user: PortalUser, firstNavHref?: string): string {
  if (firstNavHref) return firstNavHref;
  return canEnterRepresentativePortal(user) ? "/representative" : "/admin/dashboard";
}
