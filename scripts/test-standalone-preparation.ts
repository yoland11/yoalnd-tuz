import assert from "node:assert/strict";
import {
  createPreparationRequest,
  mapStandalonePreparationRows,
  mapPreparationAvailabilityRows,
  parseStandaloneItemPatch,
  parseCreatePreparationRequest,
  type PreparationRequestRepository,
} from "../src/server/preparation-requests";

const token = "a7b2d5c1-4a60-4b79-8a9b-81d26940c610";
const baseInput = {
  requestToken: token,
  customerId: 9,
  occasionName: "زفاف",
  eventDate: "2026-11-05",
  items: [
    { source: "product" as const, productId: 3, name: "اسم قديم", department: "flowers", quantity: 2 },
    { source: "custom" as const, name: "قماش خاص", department: "kosha", quantity: 1 },
  ],
};

type SavedRequest = { id: number; number: string; requestToken: string; payloadHash: string; customerName: string };
type SavedItem = { requestId: number; source: string; productId: number | null; name: string; quantity: number };

function fakeRepository(options: {
  customer?: { id: number; name: string; fullName?: string | null; status: string } | null;
  products?: Array<{ id: number; name: string; nameAr: string; barcode: string | null; isAsset: boolean; isActive: boolean; archivedAt: Date | null }>;
  failItems?: boolean;
} = {}) {
  let requests: SavedRequest[] = [];
  let items: SavedItem[] = [];
  let nextId = 1;
  const customer = options.customer === undefined ? { id: 9, name: "علي حسن", status: "active" } : options.customer;
  const products = options.products ?? [{ id: 3, name: "ورد أحمر", nameAr: "ورد أحمر", barcode: "P-3", isAsset: false, isActive: true, archivedAt: null }];
  const repository: PreparationRequestRepository = {
    transaction: async (fn) => {
      const draftRequests = structuredClone(requests);
      const draftItems = structuredClone(items);
      let draftNextId = nextId;
      const result = await fn({
        findByToken: async (value) => draftRequests.find((row) => row.requestToken === value) ?? null,
        customerById: async (id) => customer?.id === id ? customer : null,
        productsByIds: async (ids) => products.filter((row) => ids.includes(row.id)),
        insertRequest: async (row) => {
          if (draftRequests.some((saved) => saved.requestToken === row.requestToken)) return null;
          const id = draftNextId++;
          draftRequests.push({ id, number: "", requestToken: row.requestToken, payloadHash: row.payloadHash, customerName: row.customerName });
          return { id };
        },
        setNumber: async (id, number) => { draftRequests.find((row) => row.id === id)!.number = number; },
        insertItems: async (requestId, rows) => {
          if (options.failItems) throw new Error("item write failed");
          draftItems.push(...rows.map((row) => ({ requestId, source: row.source, productId: row.productId, name: row.name, quantity: row.quantity })));
        },
      });
      requests = draftRequests;
      items = draftItems;
      nextId = draftNextId;
      return result;
    },
  };
  return { repository, get requests() { return requests; }, get items() { return items; } };
}

function rejectsInvalidDraft() {
  assert.throws(() => parseCreatePreparationRequest({ ...baseInput, items: [] }), /عنصر|item/i);
  assert.throws(() => parseCreatePreparationRequest({ ...baseInput, items: [{ ...baseInput.items[0], quantity: 0 }] }), /كمية|quantity/i);
  assert.throws(() => parseCreatePreparationRequest({ ...baseInput, items: [{ ...baseInput.items[0], quantity: 1.5 }] }), /كمية|quantity/i);
  assert.throws(() => parseCreatePreparationRequest({ ...baseInput, eventDate: "2026-02-31" }), /تاريخ/);
}

async function savesCanonicalCatalogSnapshotAndDeduplicatesRetry() {
  const fake = fakeRepository();
  const first = await createPreparationRequest(baseInput, 12, fake.repository);
  assert.equal(first.number, "AJN-PREP-000001");
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.items.length, 2);
  assert.equal(fake.items[0]?.name, "ورد أحمر", "catalog name must come from the database, not the browser");
  assert.equal(fake.items[0]?.productId, 3);
  const replay = await createPreparationRequest(baseInput, 12, fake.repository);
  assert.deepEqual(replay, first);
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.items.length, 2);
  await assert.rejects(() => createPreparationRequest({ ...baseInput, occasionName: "تخرج" }, 12, fake.repository), /مختلف|conflict/i);
}

async function rejectsDeletedCustomerAndStaleCatalog() {
  await assert.rejects(() => createPreparationRequest(baseInput, 12, fakeRepository({ customer: null }).repository), /عميل|customer/i);
  await assert.rejects(() => createPreparationRequest(baseInput, 12, fakeRepository({ customer: { id: 9, name: "علي", status: "deleted" } }).repository), /عميل|customer/i);
  await assert.rejects(() => createPreparationRequest(baseInput, 12, fakeRepository({ products: [] }).repository), /منتج|product/i);
  await assert.rejects(() => createPreparationRequest(baseInput, 12, fakeRepository({ products: [{ id: 3, name: "ورد", nameAr: "ورد", barcode: null, isAsset: false, isActive: false, archivedAt: null }] }).repository), /منتج|product/i);
  await assert.rejects(() => createPreparationRequest({ ...baseInput, items: [{ ...baseInput.items[0], source: "asset" }] }, 12, fakeRepository().repository), /أصل|asset/i);
}

async function rollsBackParentWhenItemWriteFails() {
  const fake = fakeRepository({ failItems: true });
  await assert.rejects(() => createPreparationRequest(baseInput, 12, fake.repository), /item write failed/);
  assert.equal(fake.requests.length, 0);
  assert.equal(fake.items.length, 0);
}

async function snapshotsLegacyCustomerFullName() {
  const fake = fakeRepository({ customer: { id: 9, name: "", fullName: "ليلى محمد", status: "active" } });
  await createPreparationRequest(baseInput, 12, fake.repository);
  assert.equal(fake.requests[0]?.customerName, "ليلى محمد");
}

function mapsStandaloneCardsWithoutCountingNotes() {
  const [card] = mapStandalonePreparationRows(
    [{ id: 8, requestNo: "AJN-PREP-000008", customerName: "ليلى", occasionName: "تخرج", eventDate: "2026-11-05", status: "active" }],
    [{ id: 51, requestId: 8, source: "custom", productId: null, name: "ورد", sku: null, department: "flowers", quantity: 2, infoOnly: false, status: "ready", assigneeId: null, assigneeName: null, note: null },
     { id: 52, requestId: 8, source: "custom", productId: null, name: "اتصال", sku: null, department: "other", quantity: 1, infoOnly: true, status: "preparing", assigneeId: null, assigneeName: null, note: null }],
  );
  assert.equal(card.source, "request");
  assert.equal(card.number, "AJN-PREP-000008");
  assert.equal(card.rollup.total, 1);
  assert.equal(card.rollup.ready, 1);
  assert.equal(card.rollup.progress, 100);
  assert.deepEqual(card.departments, ["flowers", "other"]);
}

function validatesItemPatch() {
  assert.deepEqual(parseStandaloneItemPatch({ status: "ready", assigneeId: 4 }), { status: "ready", assigneeId: 4 });
  assert.throws(() => parseStandaloneItemPatch({ status: "unknown" }), /حالة/);
  assert.throws(() => parseStandaloneItemPatch({ assigneeId: -1 }), /موظف/);
}

function mapsInformationalStockWithoutAllocatingIt() {
  const availability = mapPreparationAvailabilityRows([{ id: 3, stock: "10.5", reserved: "2.25" }]);
  assert.deepEqual(availability.get(3), { totalStock: 10.5, reservedByOthers: 2.25, available: 8.25 });
  assert.equal(availability.has(4), false, "a missing catalog row must not become zero availability");
}

rejectsInvalidDraft();
await savesCanonicalCatalogSnapshotAndDeduplicatesRetry();
await rejectsDeletedCustomerAndStaleCatalog();
await rollsBackParentWhenItemWriteFails();
await snapshotsLegacyCustomerFullName();
mapsStandaloneCardsWithoutCountingNotes();
validatesItemPatch();
mapsInformationalStockWithoutAllocatingIt();
console.log("Standalone preparation validation and atomic save: passed");
