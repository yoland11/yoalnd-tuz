import ts from "typescript";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
const compile = path => ts.transpileModule(readFileSync(path,"utf8"), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const library = url(compile("src/lib/kosha-manager.ts"));
await import(url(compile("scripts/test-kosha-manager.ts").replace('"../src/lib/kosha-manager"', JSON.stringify(library))));
const server=readFileSync("src/server/kosha-manager.ts","utf8");
if(!server.includes("if(!execution)" )||!server.includes("bookingDetails:{}")||!server.includes("venueImages:[]"))throw new Error("Execution details must be redacted server-side");
if(!server.includes("redactExecutionBooking")||!server.includes("primaryEmployeeId:null")||!server.includes("assignedEmployees:[]"))throw new Error("Execution assignments must be redacted from list and detail payloads");
if(!server.includes("paid_amount")||!server.includes('paid>0&&remaining>0?"partial"'))throw new Error("Legacy payment state must distinguish partial from unpaid");
if(server.includes('["open","pending_approval"].includes(found.status)'))throw new Error("Pending-approval problems cannot bypass approval during resolution");
if(server.includes("archived_at is null or status='cancelled'"))throw new Error("Archived cancelled bookings must stay outside the active manager list");

const source = readFileSync("src/server/kosha-manager.ts","utf8");
const moduleValue = { exports: {} };
const bookingRow = {
  id: 4,
  koshaId: null,
  transportationVehicleId: null,
  transportationDriverId: null,
  updatedAt: new Date("2026-09-06T08:00:00.000Z"),
  createdAt: new Date("2026-09-01T08:00:00.000Z"),
  archivedAt: null,
  executionStage: "preparing",
  bookingDetails: {},
  venueImages: [],
  assignedEmployees: ["Crew"],
};
const fakeDb = {
  query: {
    koshaBookingsTable: { findMany: async () => [bookingRow] },
    serviceOrdersTable: { findMany: async () => [] },
    koshasTable: { findMany: async () => [] },
    fleetVehiclesTable: { findMany: async () => [] },
    staffTable: { findMany: async () => [] },
    servicesTable: { findMany: async () => [] },
  },
  execute: async () => ({ rows: [] }),
};
const fakeTable = new Proxy({}, { get: (_, property) => property });
const fakeRequire = specifier => {
  if (specifier === "@workspace/db") {
    return {
      db: fakeDb,
      koshaBookingsTable: fakeTable,
      serviceOrdersTable: fakeTable,
      servicesTable: fakeTable,
      koshasTable: fakeTable,
      fleetVehiclesTable: fakeTable,
      staffTable: fakeTable,
      adminActivityLogsTable: fakeTable,
    };
  }
  if (specifier === "drizzle-orm") {
    const sql = () => ({});
    return { eq: () => ({}), inArray: () => ({}), sql };
  }
  if (specifier === "@/lib/booking-photos") {
    return { bookingPhotosFromFields: () => [], bookingPhotoPreview: value => value };
  }
  if (specifier === "@/lib/kosha-manager") {
    return {
      bookingIdentity: booking => `${booking.source || "kosha"}:${booking.id}`,
      bookingNumber: booking => booking.number || `K-${booking.id}`,
      executionLabels: {},
      filterManagerHeaders: () => [],
      managerStats: () => ({ total: 0, completed: 0, inProgress: 0, upcoming: 0, cancelled: 0 }),
    };
  }
  if (specifier === "@/lib/kosha-manager-contract") return {};
  if (specifier === "./kosha-instructions") {
    const instructionModule = { exports: {} };
    const instructionCode = ts.transpileModule(readFileSync("src/server/kosha-instructions.ts","utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(instructionCode, { module: instructionModule, exports: instructionModule.exports, require: fakeRequire, Date, Set, Map, Error, URL }, { filename: "src/server/kosha-instructions.ts" });
    return instructionModule.exports;
  }
  return {};
};
const commonJs = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(commonJs, { module: moduleValue, exports: moduleValue.exports, require: fakeRequire, Date, Map, Set, Number, String, Boolean, JSON, console }, { filename: "src/server/kosha-manager.ts" });
const api = moduleValue.exports;
const adapters = {
  native: async row => ({
    id: row.id,
    source: "kosha",
    number: `K-${row.id}`,
    koshaId: null,
    koshaName: "",
    bookingDetails: {},
    venueImages: [],
    assignedEmployees: ["Crew"],
    archivedAt: null,
    executionStage: "preparing",
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-06T08:00:00.000Z",
  }),
  service: async () => null,
  routed: () => true,
};
const managerDetail = await api.koshaManagerDetail(4, "kosha", { id: 1, role: "manager", username: "manager", permissions: [] }, adapters);
assert.equal(managerDetail.permissions.execution, true);
assert.equal(managerDetail.permissions.resolveProblems, true);
assert.equal(managerDetail.permissions.manageInstructions, true, "Manager detail exposes authoritative instruction management permission for managers");
const viewerDetail = await api.koshaManagerDetail(4, "kosha", { id: 2, role: "employee", username: "crew", permissions: ["koshas"] }, adapters);
assert.equal(viewerDetail.permissions.execution, true);
assert.equal(viewerDetail.permissions.resolveProblems, false);
assert.equal(viewerDetail.permissions.manageInstructions, false, "Manager detail keeps instruction mutation permission false for view-only execution readers");
