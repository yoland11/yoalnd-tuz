/**
 * The shared Arabic date picker: weekday and numeric formats, Saturday-first grid
 * with every date under its real weekday, typed input, stored values left as they
 * were, and that no screen still uses a raw browser date input. Touches no database.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  ARABIC_WEEKDAYS,
  CALENDAR_WEEK_STARTS_ON,
  arabicWeekday,
  baghdadDay,
  dayFromLocalDate,
  formatArabicDate,
  formatNumericDate,
  formatNumericMonth,
  joinDateTime,
  localDateFromDay,
  parseTypedDate,
  parseTypedMonth,
  splitDateTime,
} from "../src/lib/arabic-date";
import { DatePanel, MonthPanel } from "../src/components/ui/date-field-panel";
import { DateField } from "../src/components/ui/date-field";
import { Input } from "../src/components/ui/input";

Object.assign(globalThis, { React });
const noop = () => {};

// 1. Arabic weekday names, computed from the actual date.
assert.deepEqual([...ARABIC_WEEKDAYS], ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]);
assert.equal(CALENDAR_WEEK_STARTS_ON, 6, "Saturday");
assert.equal(formatArabicDate("2026-10-30"), "الجمعة، 2026/10/30", "30 October 2026 really is a Friday");
assert.equal(formatArabicDate("2026-10-31"), "السبت، 2026/10/31");
assert.equal(formatArabicDate("2026-11-01"), "الأحد، 2026/11/01");
assert.equal(formatArabicDate("2026-11-02"), "الاثنين، 2026/11/02");
assert.equal(arabicWeekday("2024-02-29"), "الخميس");
assert.equal(arabicWeekday("2000-01-01"), "السبت");

// 4. Always two digits; the header is numbers only.
assert.equal(formatNumericDate("2026-01-05"), "2026/01/05");
assert.equal(formatNumericMonth("2026-10"), "2026 / 10");
assert.equal(formatNumericMonth("2026-01"), "2026 / 01");

// Typed input: what people write, never an impossible date.
for (const [text, expected] of [
  ["2026/10/30", "2026-10-30"], ["2026-10-30", "2026-10-30"], ["2026.10.30", "2026-10-30"], ["2026/1/5", "2026-01-05"], ["20261030", "2026-10-30"],
  ["30/10/2026", "2026-10-30"], ["٢٠٢٦/١٠/٣٠", "2026-10-30"], ["۲۰۲۶/۱۰/۳۰", "2026-10-30"], [" 2026/10/30 ", "2026-10-30"], ["2028/02/29", "2028-02-29"],
  ["2026/02/29", null], ["2100/02/29", null], ["2026/13/01", null], ["2026/02/31", null], ["2026/10", null], ["غداً", null], ["", null],
] as const) assert.equal(parseTypedDate(text), expected, text);
assert.equal(parseTypedMonth("2026/10"), "2026-10");
assert.equal(parseTypedMonth("2026-1"), "2026-01");
assert.equal(parseTypedMonth("10/2026"), "2026-10");
assert.equal(parseTypedMonth("2026/13"), null);

// 9. Date-time parts split and join without passing through any timezone.
assert.deepEqual(splitDateTime("2026-10-30T19:30"), { date: "2026-10-30", time: "19:30" });
assert.deepEqual(splitDateTime("2026-10-30T19:30:15"), { date: "2026-10-30", time: "19:30:15" });
assert.deepEqual(splitDateTime(""), { date: "", time: "" });
assert.equal(joinDateTime("2026-10-30", "19:30"), "2026-10-30T19:30");
assert.equal(joinDateTime("2026-10-30", ""), "", "an incomplete date-time has no value, like the browser's control");

// No timezone shift, even where midnight does not exist on a DST day.
const originalTz = process.env.TZ;
for (const tz of ["Asia/Baghdad", "UTC", "America/Los_Angeles", "Pacific/Auckland", "America/Havana", "Asia/Beirut"]) {
  process.env.TZ = tz;
  for (const day of ["2026-10-30", "2026-03-08", "2026-03-29", "2026-11-01", "2028-02-29", "2026-12-31", "2027-01-01"]) assert.equal(dayFromLocalDate(localDateFromDay(day)), day, `${tz} ${day}`);
  assert.equal(baghdadDay(new Date("2026-10-29T21:30:00Z")), "2026-10-30", `${tz}: "today" is the Iraqi day`);
}
process.env.TZ = originalTz;

// 2, 3, 5, 7, 8. The rendered grid: Saturday first, each date under its real weekday.
const renderPanel = (value: string, extra: { min?: string; max?: string } = {}) => renderToStaticMarkup(<DatePanel value={value} min={extra.min ?? ""} max={extra.max ?? ""} onChange={noop} onDone={noop} />);
const MONTH_NAMES = /يناير|فبراير|مارس|أبريل|إبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر|كانون|شباط|آذار|نيسان|أيار|حزيران|تموز|آب|أيلول|تشرين|January|February|March|April|\bMay\b|June|July|August|September|October|November|December/;
function gridOf(html: string) {
  const headers = [...html.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((match) => match[1].trim());
  const rows = html.split("<tr").slice(1).map((row) => [...row.matchAll(/<td[^>]*data-day="(\d{4}-\d{2}-\d{2})"/g)].map((match) => match[1])).filter((row) => row.length);
  return { headers, rows };
}
const SATURDAY_FIRST = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
for (let year = 2024; year <= 2030; year += 1) {
  for (let month = 1; month <= 12; month += 1) {
    const value = `${year}-${String(month).padStart(2, "0")}-15`;
    const html = renderPanel(value);
    const { headers, rows } = gridOf(html);
    assert.deepEqual(headers, SATURDAY_FIRST, `${value}: Saturday first, all seven full names`);
    assert.ok(rows.length >= 4, value);
    for (const row of rows) {
      assert.equal(row.length, 7, `${value}: full weeks`);
      row.forEach((day, column) => assert.equal(arabicWeekday(day), headers[column], `${day} must sit under its weekday`));
    }
    assert.doesNotMatch(html, MONTH_NAMES, `${value}: no month names anywhere in the panel`);
    assert.match(html, new RegExp(`<option value="${year}" selected="">${year}</option>`), `${value}: the year is in the header`);
    assert.match(html, new RegExp(`selected="">${String(month).padStart(2, "0")}</option>`), `${value}: the month is a number in the header`);
    assert.ok(rows.flat().includes(`${year}-${String(month).padStart(2, "0")}-01`), `${value}: the month starts in the grid`);
  }
}
const days = (value: string) => gridOf(renderPanel(value)).rows.flat();
assert.ok(days("2028-02-10").includes("2028-02-29"), "2028 is a leap year");
assert.ok(days("2024-02-10").includes("2024-02-29"), "2024 is a leap year");
assert.ok(days("2000-02-10").includes("2000-02-29"), "2000 is a leap year");
assert.ok(!days("2026-02-10").includes("2026-02-29"), "2026 is not");
assert.ok(!days("2100-02-10").includes("2100-02-29"), "2100 is not");
const decemberGrid = days("2026-12-15");
assert.ok(decemberGrid.includes("2027-01-01"), "the year transition shows the next year's days");

// 6. Month steps and the three actions exist, with the right RTL arrows.
const october = renderPanel("2026-10-30");
for (const label of ["اليوم", "مسح", "تأكيد"]) assert.match(october, new RegExp(`>${label}</button>`), label);
const previous = october.indexOf('aria-label="الشهر السابق"');
const next = october.indexOf('aria-label="الشهر التالي"');
assert.ok(previous >= 0 && next > previous, "in RTL, previous comes first (on the right)");
assert.match(october.slice(previous, october.indexOf("</button>", previous)), /lucide-chevron-right/, "previous points outward, to the right");
assert.match(october.slice(next, october.indexOf("</button>", next)), /lucide-chevron-left/, "next points outward, to the left");
assert.match(renderPanel("2026-10-30", { min: "2026-10-05" }), /aria-label="الشهر السابق" disabled/, "cannot step before the allowed range");
assert.match(renderPanel("2026-10-30", { max: "2026-10-31" }), /aria-label="الشهر التالي" disabled/, "cannot step after the allowed range");

// Month picker: twelve numbers, no names.
const months = renderToStaticMarkup(<MonthPanel value="2026-10" min="" max="" onChange={noop} onDone={noop} />);
assert.doesNotMatch(months, MONTH_NAMES);
assert.deepEqual([...months.matchAll(/aria-pressed="(?:true|false)"[^>]*>(\d{2})<\/button>/g)].map((match) => match[1]), ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]);

// 9. The real input stays in the form with the stored value, untouched.
const inputTag = (html: string, type: string) => {
  const tag = (html.match(/<input[^>]*>/g) ?? []).find((item) => item.includes(`type="${type}"`));
  assert.ok(tag, `an input of type ${type}`);
  return tag!;
};
const dateHtml = renderToStaticMarkup(<DateField type="date" name="eventDate" required min="2026-01-01" max="2026-12-31" value="2026-10-30" onChange={noop} aria-label="التاريخ" id="d1" />);
const nativeDate = inputTag(dateHtml, "date");
for (const attribute of ['name="eventDate"', 'required=""', 'min="2026-01-01"', 'max="2026-12-31"', 'value="2026-10-30"', 'tabindex="-1"', 'aria-hidden="true"']) assert.ok(nativeDate.includes(attribute), `the native control keeps ${attribute}`);
const visibleDate = inputTag(dateHtml, "text");
for (const attribute of ['id="d1"', 'aria-label="التاريخ"', 'value="الجمعة، 2026/10/30"']) assert.ok(visibleDate.includes(attribute), `the visible field has ${attribute}`);
assert.ok(!visibleDate.includes('name="'), "only the native control submits with the form");
const dateTimeHtml = renderToStaticMarkup(<DateField type="datetime-local" value="2026-10-30T19:30" onChange={noop} />);
assert.ok(inputTag(dateTimeHtml, "datetime-local").includes('value="2026-10-30T19:30"'));
assert.ok(inputTag(dateTimeHtml, "text").includes('value="الجمعة، 2026/10/30"'));
assert.ok(inputTag(dateTimeHtml, "time").includes('value="19:30"'));
const monthHtml = renderToStaticMarkup(<DateField type="month" value="2026-10" onChange={noop} />);
assert.ok(inputTag(monthHtml, "month").includes('value="2026-10"'));
assert.ok(inputTag(monthHtml, "text").includes('value="2026 / 10"'));
const uncontrolled = renderToStaticMarkup(<DateField type="date" name="d" defaultValue="2026-11-02" />);
assert.ok(inputTag(uncontrolled, "date").includes('value="2026-11-02"'), "uncontrolled forms keep working");
assert.ok(inputTag(uncontrolled, "text").includes('value="الاثنين، 2026/11/02"'));
assert.ok(inputTag(renderToStaticMarkup(<DateField type="date" value="" onChange={noop} />), "text").includes('placeholder="اختر التاريخ"'));
assert.match(renderToStaticMarkup(<DateField type="date" value="2026-10-30" disabled onChange={noop} />), /data-disabled/);

// Other types and non-Arabic customer pages stay plain inputs.
assert.equal(renderToStaticMarkup(<DateField type="text" value="x" onChange={noop} />), '<input type="text" value="x"/>');
assert.equal(renderToStaticMarkup(<DateField type="date" nativePicker value="2026-10-30" onChange={noop} />), '<input type="date" value="2026-10-30"/>');
assert.match(renderToStaticMarkup(<Input type="date" value="2026-10-30" onChange={noop} />), /الجمعة، 2026\/10\/30/, "the shared Input uses the same control");
assert.doesNotMatch(renderToStaticMarkup(<Input type="date" nativePicker value="2026-10-30" onChange={noop} />), /الجمعة/);
assert.doesNotMatch(renderToStaticMarkup(<Input type="text" value="نص" onChange={noop} />), /date/);

// 10. One implementation: no screen renders a raw browser date input any more.
const root = fileURLToPath(new URL("../src", import.meta.url));
const files: string[] = [];
const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (name.endsWith(".tsx")) files.push(path); } };
walk(root);
const rawInputs: string[] = [];
let converted = 0;
for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node)) {
      const attribute = node.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText() === "type") as ts.JsxAttribute | undefined;
      const type = attribute?.initializer?.getText().replace(/[{}"']/g, "") ?? "";
      if (/^(date|datetime-local|month)$/.test(type)) {
        const tag = node.tagName.getText();
        if (tag === "input") rawInputs.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        else converted += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
assert.deepEqual(rawInputs, [], "date fields must use DateField or the shared Input");
assert.ok(converted > 150, `expected the converted fields to be found, got ${converted}`);

// Contracts a static render cannot see.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const field = read("../src/components/ui/date-field.tsx");
const panel = read("../src/components/ui/date-field-panel.tsx");
const calendar = read("../src/components/ui/calendar.tsx");
assert.match(field, /React\.lazy\(\(\) => import\("\.\/date-field-panel"\)/, "the grid library loads only when a picker opens");
assert.match(field, /Object\.getOwnPropertyDescriptor\(HTMLInputElement\.prototype, "value"\)/, "every change goes through the real input, so callers get a normal change event");
assert.match(field, /tabIndex=\{-1\}\s+aria-hidden/, "the hidden control stays out of the tab order");
assert.match(panel, /weekStartsOn=\{CALENDAR_WEEK_STARTS_ON\}/, "the library computes the columns; nothing is shifted by hand");
assert.match(calendar, /Root: CalendarRoot/, "calendar parts have a stable identity, or a click during a re-render is lost");
assert.doesNotMatch(calendar, /Root: \(\{/, "no inline calendar components");

console.log(`PASS date field: Arabic weekdays, numeric months, Saturday-first grid correct for 84 months, leap years, typed input, no timezone shift, stored values unchanged, ${converted} fields on the one control`);
