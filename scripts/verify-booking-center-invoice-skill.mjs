import { readFileSync } from "node:fs";

const root = ".agents/skills/ajn-booking-center-invoice";
const skill = readFileSync(`${root}/SKILL.md`, "utf8");
const architecture = readFileSync(`${root}/references/architecture.md`, "utf8");
const bookingData = readFileSync(`${root}/references/booking-data.md`, "utf8");
const payments = readFileSync(`${root}/references/payments.md`, "utf8");
const printing = readFileSync(`${root}/references/printing.md`, "utf8");
const protection = readFileSync(`${root}/references/a4-protection.md`, "utf8");
const testing = readFileSync(`${root}/references/testing.md`, "utf8");
const invoice = readFileSync("src/views/admin/invoice.tsx", "utf8");
const styles = readFileSync("src/views/admin/print-helpers.ts", "utf8");
const bookingCenter = readFileSync("src/views/admin/booking-center.tsx", "utf8");
const api = readFileSync("src/server/api.ts", "utf8");

const checks = [
  ["skill has a focused trigger", skill.includes("AJN Booking Center") && skill.includes("مركز الحجوزات")],
  ["skill protects the existing A4 visual output", skill.includes("current A4 output is protected")],
  ["skill explicitly excludes thermal formats", skill.includes("Do not add 58 mm or 80 mm support")],
  ["architecture documents the real booking route", architecture.includes("/admin/invoice/{serviceOrderId}?type=booking")],
  ["booking data documents service_orders", bookingData.includes("service_orders") && bookingData.includes("trackingCode")],
  ["payments prohibit a print-side payment engine", payments.includes("Do not derive approval or payment status")],
  ["printing documents browser print and PDF paths", printing.includes("printDocumentWhenImagesReady") && printing.includes("downloadElementPdf")],
  ["A4 contract protects visual anchors", protection.includes(".wedding-invoice-bleed") && protection.includes("Six-cell horizontal totals")],
  ["testing uses real package scripts", testing.includes("pnpm run typecheck") && testing.includes("pnpm run verify:critical")],
  ["runtime still exposes the Booking Center A4 link", bookingCenter.includes("type=${booking.source === \"kosha\" ? \"kosha\" : \"booking\"}")],
  ["runtime still selects booking explicitly", invoice.includes('requestedType === "booking" ? "booking" : "order"')],
  ["runtime A4 PDF format is unchanged", invoice.includes("format: [216, 303]")],
  ["runtime A4 print helper is unchanged", invoice.includes("printDocumentWhenImagesReady")],
  ["runtime A4 CSS paper size is unchanged", styles.includes("@page { size: 216mm 303mm; margin: 0; }")],
  ["server still has an isolated booking adapter", api.includes('if (type === "booking")') && api.includes("serviceOrdersTable.findFirst")],
];

let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failed = true;
}
if (failed) process.exitCode = 1;
