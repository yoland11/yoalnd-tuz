// Authorization is independent of a publicly known representative phone.
type PricingUser = { role: string; permissions: string[]; isActive?: boolean };

export function canManageGraduationGroupPricing(user: PricingUser): boolean {
  return user.isActive !== false && (user.role === "admin" ||
    user.permissions.includes("graduation.price.edit") || user.permissions.includes("graduation"));
}

export function canManageAssignedGroupPricing(user: PricingUser, assigned: boolean): boolean {
  return canManageGraduationGroupPricing(user) || (user.isActive !== false && assigned &&
    user.permissions.includes("representative.portal.access"));
}
