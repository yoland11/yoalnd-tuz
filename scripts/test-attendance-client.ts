import assert from "node:assert/strict";
import { readAttendanceCode, attendanceReturnQuery, validateKioskDisplay, attendanceTimestamp } from "../src/lib/attendance-client";
import { attendancePunchSchema } from "../src/lib/attendance-submission";

assert.equal(attendanceTimestamp("2035-05-10T06:00:00.000Z"), "2035-05-10 09:00");
assert.equal(attendanceTimestamp("2035-05-10 06:00:00"), "2035-05-10 09:00");
assert.equal(attendanceTimestamp(null), "—");
const code = `AJN1.7.12345.${"a".repeat(32)}`;
assert.equal(readAttendanceCode(code), code);
assert.equal(readAttendanceCode(`https://ajn.example/staff?attendanceQr=${code}`), code);
assert.equal(readAttendanceCode(`bad-${code}`), null);
assert.equal(readAttendanceCode("x".repeat(500)), null);
assert.equal(attendanceReturnQuery(`?tab=account&attendanceQr=${code}&redirect=https://evil.test`), `?attendanceQr=${code}`, "attendance login goes to the original home card and keeps no arbitrary redirect");
assert.equal(attendanceReturnQuery("?tab=salary&redirect=https://evil.test"), "?tab=salary");
assert.equal(attendanceReturnQuery("?tab=unknown&attendanceQr=bad"), "");
const display = { name: "شاشة المحل", locationName: "المكتب الرئيسي", rotatesAt: 30000, serverTime: 20000, rotationSeconds: 30, qrDataUrl: "data:image/png;base64,aGVsbG8=" };
assert.deepEqual(validateKioskDisplay(display), display);
for (const patch of [{ serverTime: "20000" }, { rotatesAt: 19000 }, { rotatesAt: 90000 }, { rotationSeconds: 0 }, { qrDataUrl: "javascript:bad" }, { locationName: null }]) {
  assert.throws(() => validateKioskDisplay({ ...display, ...patch }), /بيانات شاشة الحضور/);
}
assert.ok(attendancePunchSchema.safeParse({ action: "check_in", qrCode: code, gps: { latitude: 34.8, longitude: 44.6, accuracy: 10 } }).success);
for (const value of [{}, { action: "checkin" }, { action: "check_out", gps: { latitude: 999, longitude: 44, accuracy: 10 } }, { action: "check_in", gps: { latitude: "34", longitude: 44, accuracy: 10 } }, { action: "check_in", qrCode: "x".repeat(501) }]) {
  assert.equal(attendancePunchSchema.safeParse(value).success, false, "malformed punch must never silently become check-in");
}
console.log("PASS attendance client: bounded QR/login handoff, kiosk payload validation and strict action/GPS input");
