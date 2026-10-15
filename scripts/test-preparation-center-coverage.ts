import assert from "node:assert/strict";
import { mergeBookingCenterPreparationCards } from "../src/server/booking-preparation";

const empty = { total: 0, ready: 0, preparing: 0, shortage: 0, needsPurchase: 0, completed: 0, progress: 0 };
const sources = ["service", "kosha", "store", "graduation", "photography", "rental"] as const;
const bookings = sources.map((source, index) => ({
  source,
  id: index + 1,
  number: `${source}-${index + 1}`,
  customerName: `زبون ${index + 1}`,
  eventDate: "2026-10-20",
  hall: "القاعة",
  departments: [source],
  detailHref: `/admin/bookings/${source}/${index + 1}`,
  status: index === 5 ? "cancelled" : "booked",
}));

const cards = mergeBookingCenterPreparationCards(bookings, [{
  source: "kosha",
  id: 2,
  number: "kosha-2",
  customerName: "زبون 2",
  eventDate: "2026-10-20",
  location: "القاعة",
  departments: ["kosha"],
  rollup: { ...empty, total: 2, ready: 1, progress: 50 },
}]);

assert.deepEqual(cards.map((card) => card.source), sources, "all Booking Center sources must appear in preparation, including cancellations");
assert.equal(cards.length, bookings.length, "an existing preparation row must not duplicate its booking");
assert.equal(cards[0]?.rollup.total, 0, "a service booking without reservations must still appear");
assert.equal(cards[1]?.rollup.total, 2, "real stock preparation progress must be retained");
assert.equal(cards[1]?.rollup.progress, 50);
assert.equal(cards[2]?.supportsPreparation, false, "unsupported booking sources must not expose broken preparation actions");
assert.equal(cards[2]?.detailHref, bookings[2]?.detailHref, "the existing booking link must be preserved");
assert.equal(cards[5]?.bookingStatus, "cancelled");

console.log("Booking Center preparation coverage: passed");
