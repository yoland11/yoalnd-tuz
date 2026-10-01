export type EmployeeIdentity = {
  id: number;
  fullName?: string | null;
  name?: string | null;
  username?: string | null;
  photoUrl?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  role?: string | null;
};

const DEPARTMENTS: Record<string, string> = {
  general: "عام", management: "الإدارة", sales: "المبيعات", accounting: "المحاسبة",
  hr: "الموارد البشرية", warehouse: "المستودع", inventory: "المخزون", delivery: "التوصيل",
  photography: "التصوير", kosha: "الكوشات", design: "التصميم", production: "الإنتاج",
  graduation: "التخرج", sound: "الصوتيات", catering: "الضيافة", tailoring: "الخياطة",
};

const ROLES: Record<string, string> = {
  admin: "مدير رئيسي", manager: "مدير", booking_staff: "موظف حجوزات",
  photographer: "موظف تصوير", accountant: "محاسب", employee: "موظف", staff: "موظف",
};

export function employeeDisplayName(employee: EmployeeIdentity): string {
  return employee.fullName?.trim() || employee.name?.trim() || employee.username?.trim() || `موظف #${employee.id}`;
}

export function employeeSecondaryLabel(employee: EmployeeIdentity): string {
  const department = employee.department?.trim();
  const title = employee.jobTitle?.trim();
  const details = [title, department ? DEPARTMENTS[department] || department : null].filter(Boolean);
  return [...new Set(details)].join(" · ") || ROLES[employee.role ?? ""] || employee.role || "";
}

export function employeeInitials(name?: string | null): string {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!words.length) return "؟";
  // Removing combining marks keeps Arabic diacritics out of the initials and
  // Array.from preserves letters outside the basic multilingual plane.
  const first = (word: string) => Array.from(word.replace(/\p{M}/gu, ""))[0] ?? "";
  return (first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : "")).toLocaleUpperCase();
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ى/g, "ي").toLocaleLowerCase().trim();
}

export function employeeMatchesQuery(employee: EmployeeIdentity, query: string): boolean {
  const haystack = normalizeSearch([
    employeeDisplayName(employee), employee.username, employee.department,
    employee.jobTitle, employee.role, employeeSecondaryLabel(employee),
  ].filter(Boolean).join(" "));
  return normalizeSearch(query).split(/\s+/).every((part) => haystack.includes(part));
}

export const employeeMatchesSearch = employeeMatchesQuery;

export function employeePhotoUrlFromUpload(metadata: { originalUrl?: string; largeUrl?: string }): string {
  const url = metadata.originalUrl?.trim() || metadata.largeUrl?.trim();
  if (!url || !/^(https?:\/\/|\/(?!\/))/.test(url)) {
    throw new Error("لم يكتمل رفع الصورة: رابط الصورة المحفوظة غير متوفر.");
  }
  return url;
}
