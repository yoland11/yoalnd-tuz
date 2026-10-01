import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layout = readFileSync("src/views/admin/_layout.tsx", "utf8");
const storeGroup = layout.match(/id: "store",\s*label: "إدارة المتجر",[\s\S]*?items: \[([\s\S]*?)\n    \],/);

assert.ok(storeGroup, "إدارة المتجر navigation group exists");
assert.match(
  storeGroup[1],
  /navItem\("\/admin\/koshas"\),\s*navItem\("\/admin\/kosha-finance"\),/,
  "Kosha finance follows the Kosha management entry in store navigation",
);
assert.equal(
  (layout.match(/navItem\("\/admin\/kosha-finance"\)/g) ?? []).length,
  1,
  "Kosha finance appears only once in navigation groups",
);

console.log("Kosha finance navigation placement verified.");
