import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { getBookingPreparationSummary } from "../src/server/booking-preparation";
import { buildPreparationThermalHtml } from "../src/lib/preparation-thermal-print";

// Real preparation summary + real Drizzle SQL; only database IO is replaced.
const dialect = new PgDialect();
const queries: string[] = [];
const executor: any = {
  execute: async (query: any) => {
    const built = dialect.sqlToQuery(query);
    const q = built.sql.replace(/\s+/g, " ").trim();
    queries.push(q);
    if (q.startsWith("SELECT booking_details AS details FROM kosha_bookings"))
      return {
        rows: [
          {
            details: {
              bookingOperations: {
                assets: [
                  { productId: 220, quantity: 1, stage: "reserved" },
                  { productId: 215, quantity: 1, stage: "picked" },
                  { productId: 999, quantity: 1, stage: "linked" },
                ],
              },
            },
          },
        ],
      };
    if (q.includes("FROM stock_reservations r")) return { rows: [] };
    if (q.startsWith("SELECT id, coalesce(nullif(name_ar, ''), name) AS name FROM products WHERE id IN")) {
      assert.deepEqual(built.params, [220, 215, 999], "one lookup for every linked asset");
      return { rows: [{ id: 220, name: "عمود ملكي ذهبي" }, { id: 215, name: "كرسي عرسان" }] };
    }
    throw new Error(`Unexpected SQL in preparation asset-name test: ${q}`);
  },
};

const summary = await getBookingPreparationSummary("kosha", 7, executor);
assert.ok(summary);
const assets = summary.items.filter((item) => item.kind === "asset");
assert.deepEqual(
  assets.map((item) => [item.name, item.sku]),
  [
    ["عمود ملكي ذهبي", "AJN-A000220"],
    ["كرسي عرسان", "AJN-A000215"],
    ["أصل #999", "AJN-A000999"],
  ],
  "asset rows show the real name with the AJN asset code (fallback only when the product is gone)",
);
assert.equal(queries.filter((q) => q.includes("FROM products WHERE id IN")).length, 1, "no per-row queries");
assert.deepEqual(assets.map(item=>item.preparationState),[null,'ready',null],'reserved/linked equipment is not physically prepared; the original picked stage is evidence');

const html = buildPreparationThermalHtml({
  bookingNumber: "B-124-3977",
  customerName: "بلال ريبوار",
  eventDate: "2026-10-16",
  location: null,
  items: [{ department: "المعدات", name: "عمود ملكي ذهبي", code: "AJN-A000220", required: 1, available: 1, status: "جاهز", assigneeName: null, note: null }],
});
assert.match(html, /عمود ملكي ذهبي<\/b><\/div>\s*<div class="item-code code">AJN-A000220<\/div>/, "80mm print shows the code under the name");
console.log("PASS  preparation asset rows show real names with AJN codes on screen and in 80mm print");
