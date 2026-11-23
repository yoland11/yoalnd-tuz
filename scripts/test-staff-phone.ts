import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { staffPhoneUpdateSchema } from "../src/server/staff-phone";

assert.deepEqual(staffPhoneUpdateSchema.parse({ fullName: "Legacy" }), {});
for (const phone of [null, "", "   "]) assert.deepEqual(staffPhoneUpdateSchema.parse({ phone }), { phone: null });
for (const phone of ["07701234567", "+964 770 123 4567", "009647701234567", "٠٧٧٠١٢٣٤٥٦٧", "۷۷۰۱۲۳۴۵۶۷"]) {
  assert.deepEqual(staffPhoneUpdateSchema.parse({ phone }), { phone: "9647701234567" });
}
for (const phone of [123, {}, [], "0770123", "077012345678", "abc07701234567", "+123456789", "<07701234567>"]) {
  assert.equal(staffPhoneUpdateSchema.safeParse({ phone }).success, false, `invalid phone accepted: ${String(phone)}`);
}
// Legacy partial edits must preserve the stored contact, while a deliberate blank clears it.
const existing = { fullName: "Employee", phone: "9647701234567" };
assert.equal({ ...existing, ...staffPhoneUpdateSchema.parse({ isActive: false }) }.phone, existing.phone);
assert.equal({ ...existing, ...staffPhoneUpdateSchema.parse({ phone: "" }) }.phone, null);

const api = readFileSync("src/server/api.ts", "utf8");
const formatter = api.slice(api.indexOf("function formatStaff(s:"), api.indexOf("function canViewStaffPay"));
const format = new Function(ts.transpile(`return (${formatter.trim()})`))();
assert.equal(format({ id: 8, phone: existing.phone }).phone, existing.phone);
assert.equal(format({ id: 9 }).phone, null);

// Execute the existing PATCH handler with controlled database I/O (no network).
const staffStart = api.indexOf('if (section === "staff")');
const patchStart = api.indexOf('      const b = await body(req);', api.indexOf('if (method === "DELETE")', api.indexOf('if (method === "POST")', api.indexOf('summaries.set(advance.employeeId', staffStart))));
const patchEnd = api.indexOf('\n    }\n  }\n\n  if (section === "crews")', patchStart);
assert.ok(patchStart > staffStart && patchEnd > patchStart);
const patchCode = ts.transpile(api.slice(patchStart, patchEnd), { target: ts.ScriptTarget.ES2022 });
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function patch(payload: unknown, editAllowed = true, failDatabase = false) {
  let written: Record<string, unknown> | undefined;
  const scope = {
    req: {}, auth: { role: "employee", permissions: [] }, existing: { role: "employee", phone: existing.phone }, id: 8,
    body: async () => payload, hasPermission: (_user: unknown, permission: string) => editAllowed && permission === "staff.edit",
    staffPhoneUpdateSchema, staffPhotoUpdateSchema: () => ({ safeParse: () => ({ success: true, data: {} }) }),
    STORAGE_URL: "", STORAGE_BUCKET: "", validationError: (_source: string, parsed: any) => ({ status: 400, fields: parsed.error.flatten().fieldErrors }),
    error: (message: string, status: number) => ({ status, message }), json: (data: unknown) => ({ status: 200, data }),
    canManageStaffPermissionSets: () => false, canAssignStaffRole: () => false,
    formatStaffForViewer: format, logAdminActivity() {}, logStaffApiFailure() {}, isUniqueViolation: () => false,
    eq: (...args: unknown[]) => args, staffTable: { id: "id" },
    db: { update() { return { set(value: Record<string, unknown>) { written = value; return { where() { return { returning: async () => { if (failDatabase) throw Error("controlled DB failure"); return [{ ...existing, ...value }]; } }; } }; } }; } },
  };
  const response = await new AsyncFunction(...Object.keys(scope), patchCode)(...Object.values(scope));
  return { response, written };
}
const saved = await patch({ phone: "٠٧٧٠١٢٣٤٥٦٧" });
assert.deepEqual(saved.written, { phone: existing.phone });
assert.equal(saved.response.data.phone, existing.phone);
assert.deepEqual((await patch({ fullName: "New name" })).written, { fullName: "New name" });
assert.deepEqual((await patch({ phone: "" })).written, { phone: null });
for (const value of ["123", "abc07701234567"]) {
  const rejected = await patch({ phone: value });
  assert.equal(rejected.response.status, 400); assert.equal(rejected.written, undefined);
}
const forbidden = await patch({ phone: "07701234567" }, false);
assert.equal(forbidden.response.status, 403); assert.equal(forbidden.written, undefined);
assert.equal((await patch({ phone: "07701234567" }, true, true)).response.status, 500);
console.log("PASS staff mobile: optional contact, safe normalization, legacy PATCH preservation and staff response");
