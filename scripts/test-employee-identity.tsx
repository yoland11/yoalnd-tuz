import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployeeAvatar } from "../src/components/employee-avatar";
import { EmployeeSelect } from "../src/components/employee-select";
import { employeeMatchesQuery, employeeInitials, employeePhotoUrlFromUpload } from "../src/lib/employee-identity";

// Existing UI primitives use the project's preserved JSX transform.
Object.assign(globalThis, { React });

assert.equal(employeeInitials("  محمد   علي  "), "مع");
assert.equal(employeeInitials("عَلِيّ حَسَن"), "عح");
assert.equal(employeeInitials("Élodie Smith"), "ÉS");
assert.equal(employeeInitials("𐐀da Smith"), "𐐀S");
assert.equal(employeeInitials("   "), "؟");

const employees = [
  { id: 11, fullName: "أحمد علي", username: "ahmed.camera", department: "photography", jobTitle: "مصور", photoUrl: "/media/one.webp" },
  { id: 27, fullName: "أحمد علي", username: "ahmed.accounts", department: "accounting", jobTitle: "محاسب", photoUrl: "/media/two.webp" },
];
assert.equal(employeeMatchesQuery(employees[0], "احمد"), true);
assert.equal(employeeMatchesQuery(employees[0], "مصور"), true);
assert.equal(employeeMatchesQuery(employees[0], "التصوير"), true);
assert.equal(employeeMatchesQuery(employees[0], "AHMED.CAMERA"), true);
assert.equal(employeeMatchesQuery(employees[1], "مصور"), false);

const fallback = renderToStaticMarkup(<EmployeeAvatar name="محمد علي" size={40} />);
assert.match(fallback, /مع/);
assert.doesNotMatch(fallback, /<img/);
const photo = renderToStaticMarkup(<EmployeeAvatar name="محمد علي" photoUrl="/media/staff.webp" size={120} />);
assert.match(photo, /src="\/media\/staff.webp"/);
assert.match(photo, /width="120"/);
assert.match(photo, /height="120"/);
assert.match(photo, /object-cover/);

const selected = renderToStaticMarkup(<EmployeeSelect employees={employees} value="27" onValueChange={() => {}} aria-label="الموظف المسؤول" />);
assert.match(selected, /role="combobox"/);
assert.match(selected, /aria-label="الموظف المسؤول"/);
assert.match(selected, /\/media\/two.webp/);
assert.doesNotMatch(selected, /\/media\/one.webp/);
assert.match(selected, /محاسب/);
const empty = renderToStaticMarkup(<EmployeeSelect employees={employees} value="" onValueChange={() => {}} emptyLabel="بدون موظف" disabled />);
assert.match(empty, /بدون موظف/);
assert.match(empty, /disabled/);

assert.equal(employeePhotoUrlFromUpload({ originalUrl: " /media/staff.webp ", largeUrl: "/media/large.webp" }), "/media/staff.webp");
assert.equal(employeePhotoUrlFromUpload({ largeUrl: "https://cdn.example.test/staff.webp" }), "https://cdn.example.test/staff.webp");
assert.throws(() => employeePhotoUrlFromUpload({}), /رابط/);
assert.throws(() => employeePhotoUrlFromUpload({ originalUrl: "data:image/webp;base64,abc" }), /رابط/);
assert.throws(() => employeePhotoUrlFromUpload({ originalUrl: "blob:test" }), /رابط/);
console.log("PASS: employee initials, Arabic search, original IDs, image rendering, and uploaded URL persistence");
