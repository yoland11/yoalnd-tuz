/** Group sash names: the title never carries a person's name, never repeats, and duplicates are surfaced. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cleanStudentSashName,
  combineGroupSashName,
  effectiveGroupTitle,
  findDuplicateRegistrations,
  firstPersonalName,
  isLikelySameStudent,
  isTitleOnlyPrefix,
  leadingTitle,
  reviewGroupSashNames,
} from "../src/lib/graduation-sash-name";
import { combineSashName } from "../src/lib/graduation-student-flow";

// --- a title is a title, never a person's name
for (const title of ["المهندس", "المهندسة", "المهندس/ة", "المهندس / ة", "الدكتور", "د.", "Eng.", "المهندس المعماري", "الصيدلانية"])
  assert.equal(isTitleOnlyPrefix(title), true, title);
for (const value of ["", "المهندس احمد", "المهندس عمار البدري", "مجتبى عباس", "حامد جاسم", "المهندس  اسامة ضياء"])
  assert.equal(isTitleOnlyPrefix(value), false, value);
assert.equal(leadingTitle("المهندس احمد"), "المهندس");
assert.equal(effectiveGroupTitle("المهندس احمد"), "المهندس", "corrections use the title part only");
assert.equal(effectiveGroupTitle("المهندس"), "المهندس");
assert.equal(effectiveGroupTitle(""), "");

// --- the title is never printed twice
assert.equal(cleanStudentSashName("المهندس علاء ناصر", "المهندس"), "علاء ناصر");
assert.equal(cleanStudentSashName("المُهندس  علي", "المهندس"), "علي", "diacritics and spacing do not hide a repeated title");
assert.equal(cleanStudentSashName("المهندس", "المهندس"), "", "a title alone is not a name");
assert.equal(cleanStudentSashName("عَلَاء ناصر", "المهندس"), "عَلَاء ناصر", "the student's own spelling is kept");
assert.equal(cleanStudentSashName("المهندس علي", ""), "المهندس علي", "without a group title nothing is stripped");
assert.equal(combineGroupSashName("المهندس", "المهندس مصطفى خليل"), "المهندس مصطفى خليل");
assert.equal(combineGroupSashName("المهندس  ", "  علي   أحمد "), "المهندس علي أحمد");
assert.equal(combineGroupSashName("المهندس", "المهندسة ربى امين"), "المهندسة ربى امين", "a female student's own title replaces the group title");
assert.equal(combineGroupSashName("المهندس", "Eng. Haider Ali"), "Eng. Haider Ali", "a title the student typed is printed once");
assert.equal(combineSashName("المهندس", "علي أحمد"), "المهندس علي أحمد", "the wizard and server share the same rule");
assert.equal(combineSashName("", "علي أحمد"), "علي أحمد");
assert.equal(firstPersonalName("المهندس علاء ناصر السوداني"), "علاء");

// --- review of stored sashes (shapes taken from the reported group)
const orders = [
  { id: 48, customerName: "مهند رضا عبد علي", productionStage: "new", customText: { text: "المهندس مجتبى عباس مهند الأعرجي", sashNamePrefix: "المهندس مجتبى عباس" } },
  { id: 39, customerName: "عبدالرحمن محمد علاوي", productionStage: "new", customText: { text: "المهندس عمار البدري", sashNamePrefix: "المهندس عمار البدري" } },
  { id: 45, customerName: "المهندس علاء ناصر السوداني", productionStage: "new", customText: { text: "المهندس علاء ناصر السوداني المهندس عَلَاء ناصر السوداني", sashNamePrefix: "المهندس علاء ناصر السوداني" } },
  { id: 66, customerName: "برزان محمد عبدالله", productionStage: "new", customText: { text: "المهندس برزان المشهداني", sashNamePrefix: "المهندس" } },
  { id: 70, customerName: "مصطفى خليل عجمي", productionStage: "printing", customText: { text: "المهندس مهند عباس المهندس مُصْطَفَى خليل", sashNamePrefix: "المهندس مهند عباس" } },
  { id: 80, customerName: "طالب ملغي", status: "cancelled", productionStage: "new", customText: { text: "المهندس احمد", sashNamePrefix: "المهندس احمد" } },
  // The representative typed this student's own name as the title just before they registered.
  { id: 41, customerName: "عمار عصمت حسن", productionStage: "new", customText: { text: "المهندس عمار البدري", sashNamePrefix: "المهندس عمار البدري" } },
  // Typed «المهندس» himself while the title was empty: already prints correctly.
  { id: 65, customerName: "صهيب أحمد جبار", productionStage: "new", customText: { text: "المهندس صهيب أَحْمَد الطائي", sashNamePrefix: "" } },
  { id: 69, customerName: "مهند عباس مكيل", productionStage: "new", customText: { text: "المهندس مهند عباس مهند عَبَّاس مكيل", sashNamePrefix: "المهندس مهند عباس" } },
];
const findings = reviewGroupSashNames("المهندس احمد", orders);
const byId = new Map(findings.map((finding) => [finding.orderId, finding]));
assert.deepEqual([...byId.keys()].sort((a, b) => a - b), [39, 45, 48, 69, 70], "correct and cancelled sashes are not flagged");
assert.ok(!byId.has(41), "a title holding the student's own name already prints the right name");
assert.deepEqual(byId.get(69)!.issues, ["repeated_name"], "the student's own name printed twice");
assert.equal(byId.get(69)!.suggestion, "المهندس مهند عَبَّاس مكيل", "the student's own typing is kept once");
assert.ok(byId.get(48)!.issues.includes("foreign_name"));
assert.equal(byId.get(48)!.suggestion, "المهندس مهند الأعرجي", "another person's name is removed, the student's own part kept");
assert.deepEqual(byId.get(39)!.issues.sort(), ["foreign_name", "missing_name"]);
assert.equal(byId.get(39)!.suggestion, "", "a sash without the student's own name needs a person to type it");
assert.equal(byId.get(39)!.nameHint, "المهندس عبدالرحمن محمد");
assert.equal(byId.get(45)!.suggestion, "المهندس عَلَاء ناصر السوداني");
assert.ok(byId.get(45)!.issues.includes("repeated_title"));
assert.ok(!byId.get(45)!.issues.includes("foreign_name"), "his own name in the title is not another person's name");
assert.equal(byId.get(70)!.editable, false, "printed sashes are never rewritten");
assert.equal(byId.get(70)!.suggestion, "المهندس مُصْطَفَى خليل");

// --- duplicate registrations
const duplicates = findDuplicateRegistrations([
  { id: 43, customerName: "علاء ناصر محمد", phone: "07701119856", createdAt: "2026-10-06T19:35:00Z" },
  { id: 44, customerName: "المهندس علاء ناصر السوداني", phone: "07701119856", createdAt: "2026-10-06T19:42:00Z" },
  { id: 45, customerName: "المهندس علاء ناصر السوداني", phone: "07701119856", createdAt: "2026-10-06T19:51:00Z" },
  { id: 51, customerName: "ظاهر مطني مخلف", phone: "07702224433" },
  { id: 52, customerName: "ظاهر مطني مخلف", phone: "07702224433" },
  { id: 60, customerName: "علي حسين", phone: "07703335555" },
  { id: 61, customerName: "حسن حسين", phone: "07703335555" },
  { id: 62, customerName: "ظاهر مطني مخلف", phone: "07702224433", status: "cancelled" },
]);
assert.equal(duplicates.length, 2, "two students registered more than once");
const alaa = duplicates.find((cluster) => cluster.orders.some((order) => order.id === 43))!;
assert.deepEqual(alaa.orders.map((order) => order.id), [43, 44, 45], "name variants of the same student merge into one card");
assert.equal(alaa.reason, "same_phone_and_first_name");
assert.equal(alaa.orders[0].phoneTail, "9856");
assert.deepEqual(duplicates.find((cluster) => cluster.orders.some((order) => order.id === 51))!.orders.map((order) => order.id), [51, 52], "cancelled entries are ignored");
assert.ok(!duplicates.some((cluster) => cluster.orders.some((order) => order.id === 60)), "siblings sharing a phone with different first names are not duplicates");
assert.equal(isLikelySameStudent({ customerName: "المهندس ظاهر مطني", phone: "0770 222 4433" }, [{ id: 51, customerName: "ظاهر مطني مخلف", phone: "07702224433" }]), true);
assert.equal(isLikelySameStudent({ customerName: "حسن حسين", phone: "07703335555" }, [{ id: 60, customerName: "علي حسين", phone: "07703335555" }]), false);

// --- wiring: the public title is locked after registration and title-only; sashes need the student's name
const graduation = readFileSync("src/server/graduation.ts", "utf8");
assert.match(graduation, /الكنية مقفلة بعد بدء تسجيل الطلبة/, "the representative cannot change the title once students registered");
assert.match(graduation, /if \(prefix && !isTitleOnlyPrefix\(prefix\)\)/, "the public title must be a title only");
assert.match(graduation, /groupSashPrefix\.trim\(\) && !cleanStudentSashName\(/, "a group sash without the student's own name is refused");
assert.match(graduation, /isLikelySameStudent\(/, "the same student cannot register twice with a name variant");
assert.match(graduation, /sashPrefixLocked: registrationStarted/);
const operations = readFileSync("src/server/graduation-operations.ts", "utf8");
assert.match(operations, /action === "students" && parts\[3\] && method === "DELETE"[\s\S]{0,700}cancelAndArchiveGraduationOrder\(order, user/, "removing a group student cancels its invoice through the approved path");
assert.match(graduation, /export async function cancelAndArchiveGraduationOrder[\s\S]*updateOrder\(order, \{ status: "cancelled" \}, user\)[\s\S]*archivedAt: now/, "cancel first (invoice, inventory, payment target), then archive");
assert.match(operations, /action === "sash-names" && method === "POST"[\s\S]{0,120}requireOperationPermission\(user, "graduation\.edit"\)/, "corrections require the graduation edit permission");
assert.match(operations, /async function applySashNames[\s\S]*db\.transaction[\s\S]*\.for\("update"\)[\s\S]*sash_name_corrected/, "corrections are transactional and audited per order");
assert.match(operations, /isSashTextEditable\(order\.productionStage\)/, "printed sashes are refused");
assert.match(operations, /\.\.\.\(data\.rightText !== undefined \? \{ text: data\.rightText \} : \{\}\)/, "editing the right-side text updates the printed name");
const wizard = readFileSync("src/components/graduation-student-wizard.tsx", "utf8");
assert.match(wizard, /sashNamePrefix && !cleanStudentSashName\(form\.sashName, sashNamePrefix\)/, "the wizard requires the student's own name under a title");
const publicPage = readFileSync("src/views/graduation-groups.tsx", "utf8");
assert.ok(!/<details open className="rounded-xl border border-primary\/30/.test(publicPage), "the representative title form is no longer open for every student");
assert.match(publicPage, /الطالب لا يكتب اسمه هنا/);

console.log("graduation sash names: all checks passed");
