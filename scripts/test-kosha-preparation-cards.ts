import assert from "node:assert/strict";
import { listPreparationCards } from "../src/server/booking-preparation";

type BookingRow = {
  id: number;
  number: string;
  customer_name: string;
  event_date: string;
  status: string;
  archived_at: Date | null;
};

function executorWithBookings(bookings: BookingRow[], reservations: Record<string, unknown>[] = []) {
  let calls = 0;
  return {
    execute: async () => ({ rows: ++calls === 1 ? reservations : bookings }),
  };
}

async function includesKoshaBookingWithoutStockReservation() {
  const executor = executorWithBookings([
    {
      id: 42,
      number: "AJN-KOSHA-0042",
      customer_name: "أحمد محمد",
      event_date: "2026-10-20",
      status: "booked",
      archived_at: null,
    },
  ]);

  const cards = await listPreparationCards(executor);
  assert.equal(cards.length, 1, "an active Kosha booking must appear without a stock reservation");
  assert.equal(cards[0]?.number, "AJN-KOSHA-0042");
  assert.equal(cards[0]?.rollup.total, 0);
  assert.deepEqual(cards[0]?.departments, ["kosha"]);
}

async function excludesCancelledAndArchivedKoshaBookings() {
  const cards = await listPreparationCards(executorWithBookings([
    { id: 42, number: "AJN-KOSHA-0042", customer_name: "أحمد", event_date: "2026-10-20", status: "booked", archived_at: null },
    { id: 43, number: "AJN-KOSHA-0043", customer_name: "علي", event_date: "2026-10-21", status: "cancelled", archived_at: null },
    { id: 44, number: "AJN-KOSHA-0044", customer_name: "سارة", event_date: "2026-10-22", status: "booked", archived_at: new Date("2026-10-09T00:00:00Z") },
  ], [
    { source_type: "kosha_booking", source_id: 43, product_id: 7, variant_id: null, quantity: "1", reservation_status: "reserved", name: "خلفية كوشة", category: "الكوشات", stock: "4" },
  ]));
  assert.deepEqual(cards.map((card) => card.id), [42], "cancelled and archived Kosha bookings must not appear");
}

async function keepsOneCardForAnAssignedKoshaBooking() {
  const cards = await listPreparationCards(executorWithBookings([
    { id: 45, number: "AJN-KOSHA-0045", customer_name: "هدى", event_date: "2026-10-23", status: "preparing", archived_at: null },
  ], [
    { source_type: "kosha_booking", source_id: 45, product_id: 8, variant_id: null, quantity: "2", reservation_status: "reserved", name: "خلفية كوشة", category: "الكوشات", stock: "4" },
  ]));
  assert.equal(cards.length, 1, "an assigned booking must not get a second card");
  assert.equal(cards[0]?.rollup.total, 1, "existing stock assignments remain counted");
}

await includesKoshaBookingWithoutStockReservation();
await excludesCancelledAndArchivedKoshaBookings();
await keepsOneCardForAnAssignedKoshaBooking();
console.log("Kosha preparation cards: passed");
