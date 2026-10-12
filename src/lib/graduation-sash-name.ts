/**
 * Group sash names: the representative's fixed title ("الكنية", e.g. «المهندس»)
 * plus each student's own name. Pure helpers shared by the public join page,
 * the server and the admin review tools.
 *
 * The title must be a title only. When it held a person's name (and changed
 * between registrations), that name was printed on other students' sashes.
 */

/** Common graduate titles (normalized, see normalizeNameForMatch). */
const TITLE_WORDS = new Set(
  [
    "المهندس", "المهندسه", "المهندس/ه", "م", "م.", "مهندس", "مهندسه",
    "الدكتور", "الدكتوره", "د", "د.", "دكتور", "دكتوره",
    "الطبيب", "الطبيبه", "طبيب", "طبيبه",
    "الصيدلاني", "الصيدلانيه", "الصيدلي", "صيدلاني", "صيدلانيه", "ص.",
    "المحامي", "المحاميه", "محامي", "محاميه",
    "الاستاذ", "الاستاذه", "استاذ", "استاذه", "ا.",
    "المدرس", "المدرسه", "المعلم", "المعلمه",
    "المحاسب", "المحاسبه", "المبرمج", "المبرمجه",
    "الممرض", "الممرضه", "الباحث", "الباحثه",
    "المعماري", "المعماريه", "المدني", "المدنيه",
    "التقني", "التقنيه", "الفني", "الفنيه",
    "الخريج", "الخريجه", "البيطري", "البيطريه",
    "القانوني", "القانونيه", "الاعلامي", "الاعلاميه",
    "eng", "eng.", "engr", "engr.", "dr", "dr.", "pharm", "pharm.",
  ],
);

/** Lower-case, no diacritics/tatweel, unified alef/yeh/teh-marbuta, single spaces. */
export function normalizeNameForMatch(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[ـً-ٰٟ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s*\/\s*/g, "/")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ar");
}

function words(value: string): string[] {
  return value.split(" ").filter(Boolean);
}

export function isTitleWord(word: string): boolean {
  const normalized = normalizeNameForMatch(word);
  return TITLE_WORDS.has(normalized) || TITLE_WORDS.has(normalized.replace(/\/.*$/, ""));
}

/** A group title must be one to three title words, never a person's name. */
export function isTitleOnlyPrefix(prefix: string): boolean {
  const list = words(normalizeNameForMatch(prefix));
  return list.length > 0 && list.length <= 3 && list.every(isTitleWord);
}

/** The leading title words of a prefix («المهندس احمد» → «المهندس»). */
export function leadingTitle(prefix: unknown): string {
  const list = tidySashPrefix(prefix).split(" ").filter(Boolean);
  const kept: string[] = [];
  for (const word of list) {
    if (!isTitleWord(word)) break;
    kept.push(word);
  }
  return kept.join(" ");
}

/** Collapses spaces in a title the way it is stored and printed. */
export function tidySashPrefix(prefix: unknown): string {
  return String(prefix ?? "").trim().replace(/\s+/g, " ");
}

/**
 * The student's own part of the sash name: drops a repeated copy of the
 * group title (and leading title words) the student typed themselves.
 */
export function cleanStudentSashName(name: unknown, prefix: unknown = ""): string {
  let rest = String(name ?? "").trim().replace(/\s+/g, " ");
  const title = tidySashPrefix(prefix);
  if (title) {
    const titleWords = words(normalizeNameForMatch(title));
    const restWords = rest.split(" ");
    const head = restWords.slice(0, titleWords.length).map(normalizeNameForMatch);
    if (titleWords.length && head.join(" ") === titleWords.join(" "))
      rest = restWords.slice(titleWords.length).join(" ");
  }
  // "المهندس علي" typed under the title «المهندس»: never print the title twice.
  if (title) {
    const restWords = rest.split(" ").filter(Boolean);
    while (restWords.length > 1 && isTitleWord(restWords[0])) restWords.shift();
    rest = restWords.join(" ");
  }
  return rest.trim();
}

/**
 * «title + student's name» with the title printed once. A title the student
 * typed themselves (e.g. the feminine «المهندسة») replaces the group title.
 */
export function combineGroupSashName(prefix: unknown, studentName: unknown): string {
  const title = tidySashPrefix(prefix);
  const raw = String(studentName ?? "").trim().replace(/\s+/g, " ");
  if (!title) return raw;
  const titleWords = words(normalizeNameForMatch(title));
  const rest = raw.split(" ").filter(Boolean);
  if (rest.slice(0, titleWords.length).map(normalizeNameForMatch).join(" ") === titleWords.join(" "))
    rest.splice(0, titleWords.length);
  const ownTitles: string[] = [];
  while (rest.length > 1 && isTitleWord(rest[0])) ownTitles.push(rest.shift()!);
  return [ownTitles.length ? ownTitles.join(" ") : title, rest.join(" ")].filter(Boolean).join(" ");
}

/** First personal name (titles skipped) — used to spot the same student twice. */
export function firstPersonalName(value: unknown): string {
  const list = words(normalizeNameForMatch(value));
  while (list.length > 1 && isTitleWord(list[0])) list.shift();
  return list[0] ?? "";
}

// ------------------------------------------------------------------ review

/** The title used for corrections: the stored one if it is a pure title, else its leading title words. */
export function effectiveGroupTitle(groupPrefix: unknown): string {
  const title = tidySashPrefix(groupPrefix);
  return isTitleOnlyPrefix(title) || !title ? title : leadingTitle(title);
}

/** A name with its leading title words removed («المهندس علي حسن» → «علي حسن»). */
function stripTitles(value: unknown): string {
  return personalWords(value).join(" ");
}

function personalWords(value: unknown): string[] {
  const list = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  while (list.length > 1 && isTitleWord(list[0])) list.shift();
  return list;
}

export type SashReviewOrder = {
  id: number;
  customerName: string;
  phone?: string | null;
  status?: string | null;
  productionStage?: string | null;
  createdAt?: string | Date | null;
  customText?: Record<string, unknown> | null;
};

export type SashIssue = "foreign_name" | "missing_name" | "repeated_name" | "repeated_title" | "outdated_title";

export type SashReviewFinding = {
  orderId: number;
  customerName: string;
  current: string;
  storedPrefix: string;
  studentPart: string;
  suggestion: string;
  nameHint: string;
  issues: SashIssue[];
  editable: boolean;
};

export const SASH_ISSUE_LABELS: Record<SashIssue, string> = {
  foreign_name: "يحتوي اسم شخص آخر",
  repeated_name: "الاسم مكرر",
  missing_name: "بدون اسم الطالب",
  repeated_title: "الكنية مكررة",
  outdated_title: "كنية قديمة",
};

/** Stages after which the sash text is already printed or embroidered. */
export const SASH_LOCKED_STAGES = [
  "printing", "embroidery", "ironing", "quality_check", "awaiting_packaging",
  "packaging", "ready", "delivered", "completed",
];

export function isSashTextEditable(stage: unknown): boolean {
  return !SASH_LOCKED_STAGES.includes(String(stage ?? ""));
}

/**
 * Compares every active student's stored sash text with the group's current
 * title and returns the ones that need a person to look at them, each with a
 * suggested correction (title + the student's own part).
 */
export function reviewGroupSashNames(groupPrefix: unknown, orders: readonly SashReviewOrder[]): SashReviewFinding[] {
  const title = effectiveGroupTitle(groupPrefix);
  const normalizedTitle = normalizeNameForMatch(title);
  const findings: SashReviewFinding[] = [];
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    const text = order.customText ?? {};
    const current = String(text.text ?? "").trim().replace(/\s+/g, " ");
    const storedPrefix = tidySashPrefix(text.sashNamePrefix);
    if (!current && !storedPrefix) continue;
    // The student's own part is what follows the title stored with the order.
    let studentPart = current;
    if (storedPrefix) {
      const prefixWords = words(normalizeNameForMatch(storedPrefix));
      const currentWords = current.split(" ");
      if (currentWords.slice(0, prefixWords.length).map(normalizeNameForMatch).join(" ") === prefixWords.join(" "))
        studentPart = currentWords.slice(prefixWords.length).join(" ");
    }
    // A title that held a name: it is the student's own name when the first
    // personal name matches, otherwise it is another person's name.
    const prefixNameClean = isTitleOnlyPrefix(storedPrefix) ? "" : stripTitles(storedPrefix);
    const studentFirst = firstPersonalName(order.customerName);
    const prefixIsOwn = Boolean(prefixNameClean) && firstPersonalName(prefixNameClean) === studentFirst;
    const cleaned = cleanStudentSashName(studentPart, title || storedPrefix);
    const issues: SashIssue[] = [];
    let own = cleaned ? studentPart : "";
    if (prefixNameClean && !prefixIsOwn) issues.push("foreign_name");
    if (prefixIsOwn) {
      if (!cleaned) own = prefixNameClean;
      else if (firstPersonalName(cleaned) === studentFirst) issues.push("repeated_name");
    }
    if (!own) issues.push("missing_name");
    if (cleaned && normalizeNameForMatch(cleaned) !== normalizeNameForMatch(studentPart)) issues.push("repeated_title");
    if (title && storedPrefix && isTitleOnlyPrefix(storedPrefix) && normalizeNameForMatch(storedPrefix) !== normalizedTitle)
      issues.push("outdated_title");
    if (!issues.length) continue;
    // Nothing to correct when the printed text already is «title + own name».
    const suggestion = own ? combineGroupSashName(title, own) : "";
    if (suggestion && normalizeNameForMatch(suggestion) === normalizeNameForMatch(current)) continue;
    findings.push({
      orderId: order.id,
      customerName: order.customerName,
      current,
      storedPrefix,
      studentPart: own,
      suggestion,
      nameHint: combineGroupSashName(title, personalWords(order.customerName).slice(0, 2).join(" ")),
      issues,
      editable: isSashTextEditable(order.productionStage),
    });
  }
  return findings;
}

export type DuplicateRegistration = {
  key: string;
  reason: "same_name" | "same_phone_and_first_name";
  orders: Array<{ id: number; customerName: string; phoneTail: string; createdAt: string | Date | null }>;
};

function time(value: string | Date | null | undefined): number {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

/** Active registrations that look like the same student entered more than once. */
export function findDuplicateRegistrations(orders: readonly SashReviewOrder[]): DuplicateRegistration[] {
  const active = orders.filter((order) => order.status !== "cancelled");
  const groups = new Map<string, { reason: DuplicateRegistration["reason"]; ids: Set<number> }>();
  const add = (key: string, reason: DuplicateRegistration["reason"], id: number) => {
    const entry = groups.get(key) ?? { reason, ids: new Set<number>() };
    entry.ids.add(id);
    groups.set(key, entry);
  };
  for (const order of active) {
    const name = normalizeNameForMatch(order.customerName);
    if (name) add(`name:${name}`, "same_name", order.id);
    const phone = String(order.phone ?? "").replace(/\D/g, "").slice(-10);
    const first = firstPersonalName(order.customerName);
    if (phone.length >= 10 && first) add(`phone:${phone}:${first}`, "same_phone_and_first_name", order.id);
  }
  // Merge overlapping clusters so one student appears in one card only.
  const clusters: Array<{ key: string; reason: DuplicateRegistration["reason"]; ids: Set<number> }> = [];
  for (const [key, entry] of groups) {
    if (entry.ids.size < 2) continue;
    const overlap = clusters.find((cluster) => [...entry.ids].some((id) => cluster.ids.has(id)));
    if (overlap) {
      entry.ids.forEach((id) => overlap.ids.add(id));
      if (entry.reason === "same_phone_and_first_name") overlap.reason = entry.reason;
    } else clusters.push({ key, reason: entry.reason, ids: new Set(entry.ids) });
  }
  const byId = new Map(active.map((order) => [order.id, order]));
  return clusters.map((cluster) => ({
    key: cluster.key,
    reason: cluster.reason,
    // Oldest registration first: it is the one normally kept.
    orders: [...cluster.ids]
      .map((id) => byId.get(id)!)
      .sort((a, b) => (time(a.createdAt) - time(b.createdAt)) || a.id - b.id)
      .map((order) => ({
        id: order.id,
        customerName: order.customerName,
        phoneTail: String(order.phone ?? "").replace(/\D/g, "").slice(-4),
        createdAt: order.createdAt ?? null,
      })),
  }));
}

/** True when an active student with the same phone and first name already exists. */
export function isLikelySameStudent(
  candidate: { customerName: string; phone: string },
  existing: readonly SashReviewOrder[],
): boolean {
  const phone = candidate.phone.replace(/\D/g, "").slice(-10);
  const first = firstPersonalName(candidate.customerName);
  if (phone.length < 10 || !first) return false;
  return existing.some((order) =>
    order.status !== "cancelled" &&
    String(order.phone ?? "").replace(/\D/g, "").slice(-10) === phone &&
    firstPersonalName(order.customerName) === first,
  );
}
