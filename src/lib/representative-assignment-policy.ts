export type AssignmentInput = {
  currentActiveGroupIds: number[];
  targetGroupId: number;
  hasPaymentRequests: boolean;
  hasCustodyHandovers: boolean;
  resolveAmbiguous: boolean;
  historicalGroupIds?: number[];
  paymentGroupIds?: number[];
};

export type AssignmentDecision =
  | "same"
  | "assign"
  | "replace"
  | "ambiguous"
  | "financiallyLocked";

export function representativeStaffIsEligible(staff: {
  isActive: boolean;
  role: string;
  permissions: string[];
}): boolean {
  return staff.isActive && staff.role !== "admin" &&
    staff.permissions.includes("representative.portal.access");
}

export function assignmentDecision(input: AssignmentInput): AssignmentDecision {
  const { currentActiveGroupIds, targetGroupId, hasPaymentRequests,
    hasCustodyHandovers, resolveAmbiguous, historicalGroupIds = [], paymentGroupIds = [] } = input;
  const financiallyBound = hasPaymentRequests || hasCustodyHandovers;
  if (currentActiveGroupIds.length > 1)
    return financiallyBound ? "financiallyLocked" :
      resolveAmbiguous ? "replace" : "ambiguous";
  if (currentActiveGroupIds.length === 1 && currentActiveGroupIds[0] === targetGroupId)
    return "same";
  if (financiallyBound && currentActiveGroupIds.length === 0 &&
    historicalGroupIds.length === 1 && historicalGroupIds[0] === targetGroupId &&
    paymentGroupIds.every((groupId) => groupId === targetGroupId))
    return "assign";
  if (financiallyBound) return "financiallyLocked";
  return currentActiveGroupIds.length === 0 ? "assign" : "replace";
}
