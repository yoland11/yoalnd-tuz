type GroupStudentNameRecord = {
  id: number;
  customerName: string;
  status: string;
  archivedAt: Date | null;
};

export function normalizeGroupStudentName(value: string): string {
  return value.normalize("NFKC")
    .replace(/[\u0640\u064B-\u065F\u0670]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ar");
}

export function hasDuplicateGroupStudentName(
  name: string,
  students: readonly GroupStudentNameRecord[],
  excludeOrderId?: number,
): boolean {
  const normalized = normalizeGroupStudentName(name);
  return Boolean(normalized) && students.some((student) =>
    student.id !== excludeOrderId &&
    !student.archivedAt &&
    student.status !== "cancelled" &&
    normalizeGroupStudentName(student.customerName) === normalized,
  );
}
