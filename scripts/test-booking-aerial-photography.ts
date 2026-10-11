import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aerialPhotographyCharge } from "../src/lib/booking-aerial-photography";

assert.equal(aerialPhotographyCharge(false, "50000"), 0, "an unselected option must not charge a stale price");
assert.equal(aerialPhotographyCharge(true, "50000"), 50000);
assert.equal(aerialPhotographyCharge(true, ""), null, "a selected option needs a price");
assert.equal(aerialPhotographyCharge(true, "0"), null);
assert.equal(aerialPhotographyCharge(true, "-10"), null);
assert.equal(aerialPhotographyCharge(true, "Infinity"), null);

const source = readFileSync("src/views/admin/booking-center.tsx", "utf8");
assert.match(source, /label: "تصوير جوي"/, "the booking form must offer an aerial photography choice");
assert.match(source, /booking-aerial-photography-price/, "the choice must expose its own price input");
assert.ok(source.includes("!photoSessionOn && !videoOn && !aerialOn"), "aerial photography alone must be a valid photography selection");
assert.equal((source.match(/aerialPhotographyCharge\([^\n]+, aerialPrice\)/g) ?? []).length, 2, "save and preview must use the same charge rule");
assert.match(source, /aerialPhotographyPrice: aerialCharge/, "save the price in the existing booking details");
assert.match(source, /baseTotal = [^;]*aerialCharge/, "charge once in the existing booking base amount");
assert.match(source, /photographyItems: \[\{ name: "تصوير جوي", quantity: 1 \}\]/, "the photography team must see the selected service");
console.log("PASS aerial photography choice, price validation, booking total and details");
