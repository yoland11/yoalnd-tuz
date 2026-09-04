import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/views/flower-designer.tsx", import.meta.url), "utf8");
const flowerCategories = source.match(/const FLOWER_GALLERY_CATEGORIES = new Set\(\[([^\]]+)\]\)/)?.[1] ?? "";
const bouquetCategories = source.match(/const BOUQUET_GALLERY_CATEGORIES = new Set\(\[([^\]]+)\]\)/)?.[1] ?? "";

for (const category of ["ورد"]) {
  assert.match(
    flowerCategories,
    new RegExp(`["]${category}["]`),
    `Expected /design gallery source to include the ${category} category.`,
  );
}

for (const category of ["باقات ورد", "مسكات ورد"]) {
  assert.match(
    bouquetCategories,
    new RegExp(`["]${category}["]`),
    `Expected /design bouquet gallery source to include the ${category} category.`,
  );
}

assert.match(
  source,
  /bouquet_gallery/,
  "Expected /design to keep a dedicated bouquets and hand bouquets gallery view.",
);

console.log("PASS  /design gallery accepts flower bouquets and hand bouquets from AJN Gallery");
