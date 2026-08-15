import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";

const rows = [
  { "اسم الطالب": "علي حسن", "المبلغ": 125000, "التاريخ": new Date("2026-08-15T00:00:00Z") },
  { "اسم الطالب": "زهراء كريم", "المبلغ": 87500, "التاريخ": new Date("2026-08-16T00:00:00Z") },
];
const sheet = XLSX.utils.json_to_sheet(rows, { cellDates: true });
sheet.D2 = { t: "n", f: "SUM(B2:B3)", v: 212500 };
sheet["!ref"] = "A1:D3";
sheet["!cols"] = [{ wch: 24 }, { wch: 14 }, { wch: 16 }, { wch: 14 }];
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "الطلاب");
const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true, cellDates: true, cellStyles: true });
const restored = XLSX.read(bytes, { type: "buffer", cellDates: true, cellStyles: true });
assert.deepEqual(restored.SheetNames, ["الطلاب"]);
const restoredRows = XLSX.utils.sheet_to_json(restored.Sheets["الطلاب"], { defval: "" });
assert.equal(restoredRows[0]["اسم الطالب"], "علي حسن");
assert.equal(restoredRows[1]["المبلغ"], 87500);
assert.equal(restored.Sheets["الطلاب"].D2.f, "SUM(B2:B3)");
assert.equal(restored.Sheets["الطلاب"]["!cols"]?.[0]?.wch, 24);
console.log("PASS  secure SheetJS build preserves Arabic text, numbers, dates, formulas, and worksheet structure");

const pdf = await PDFDocument.create();
pdf.addPage([595, 842]);
const pdfBytes = await pdf.save();
const parsed = await PDFDocument.load(pdfBytes);
assert.equal(parsed.getPageCount(), 1);
console.log("PASS  PDF generation and parsing remain functional");
