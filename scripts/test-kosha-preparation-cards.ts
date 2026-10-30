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

function executorWithBookings(bookings: BookingRow[], reservations: Record<string, unknown>[] = [], serviceRows: Record<string, unknown>[] = []) {
  return {
    execute: async (query: unknown) => {
      const statement = JSON.stringify(query);
      return { rows: statement.includes("stock_reservations") ? reservations : statement.includes("service_orders") ? serviceRows : bookings };
    },
  };
}

async function includesManualOnlyServiceBooking() {
  const cards = await listPreparationCards(executorWithBookings([], [], [{
    id: 71, number: "SRV-71", customer_name: "هبة", event_date: "2026-11-02", event_location: "بغداد",
    status: "booked", archived_at: null,
    details: { bookingOperations: { manualPrepItems: [{ id: "m1", name: "قماش", department: "kosha", quantity: 1 }] } },
  }]));
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.source, "service");
  assert.equal(cards[0]?.rollup.total, 1);
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
await includesManualOnlyServiceBooking();
console.log("Kosha preparation cards: passed");
