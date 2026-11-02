/** Presentation regression coverage; renders real components with local query fixtures. */
import assert from "node:assert/strict";
import * as React from "react";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import type { TransportPlanResponse } from "../src/components/transport-receipt-dialog";

(globalThis as any).React = React;
const { QueryClient, QueryClientProvider } = createRequire(import.meta.url)("@tanstack/react-query") as typeof import("@tanstack/react-query");
const { BookingTransportPlanForm, BookingTransportPlanEditor } = await import("../src/components/booking-transport-plan-editor");

const data: TransportPlanResponse = {
  transportation: { mode: "ajn", fee: 50000 },
  transportPlan: {
    version: 1, revision: 4, feeMode: "overall", overallCharge: 50000, legacy: false,
    trips: [{
      id: "trip-7", sequence: 1, vehicleId: 5, driverId: 8,
      origin: "مخزن بغداد", destination: "قاعة النور", transportDate: "2026-11-04", departureTime: "08:30",
      transportType: "تجهيزات", expectedArrivalTime: "09:15", driverPhone: "07700000000", assignedWork: "إرجاع التجهيزات", notes: "ملاحظة الوصل",
      customerCharge: null, resourceOccupancy: { start: "2026-11-04T08:00:00+03:00", end: "2026-11-04T12:00:00+03:00" },
    }],
  },
  resourceOccupancy: { start: "2026-11-04T00:00:00+03:00", end: "2026-11-05T00:00:00+03:00" },
  capabilities: { canEdit: true, canPrintFinancial: true },
};
const vehicles = [{ id: 5, name: "مركبة النقل", isActive: true }];
const drivers = [{ id: 8, fullName: "السائق", isActive: true }];
const renderForm = (fixture = data, error?: unknown) => renderToStaticMarkup(<BookingTransportPlanForm data={fixture} vehicles={vehicles} drivers={drivers} onSave={async () => {}} busy={false} error={error}/>);

// A secondary field accidentally left in the daily form, or a default-open disclosure,
// breaks the compact workflow. Closed controls stay mounted with their saved values.
const html = renderForm();
const advanced = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/g) ?? [];
assert.equal(advanced.length, 1, "one advanced disclosure keeps secondary trip controls together");
assert.match(advanced[0], /<summary\b[^>]*>[\s\S]*?تفاصيل متقدمة/, "secondary trip controls have a clear advanced entry point");
assert.doesNotMatch(advanced[0].slice(0, advanced[0].indexOf(">")), /\bopen(?:=|\s|$)/, "advanced trip controls start collapsed");
const primary = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, "");
for (const label of ["المركبة", "السائق", "موقع الانطلاق", "موقع الوصول", "تاريخ النقل", "وقت الانطلاق", "أجرة النقل الكلية للحجز", "حفظ خطة النقل"]) {
  assert.ok(primary.includes(label), `${label} is available without opening advanced details`);
}
for (const label of ["نوع النقل", "الوصول المتوقع", "هاتف السائق", "أعمال النقل المكلّف بها", "ملاحظات النقل", "بداية انشغال المورد", "نهاية الانشغال والإرجاع"]) {
  assert.ok(advanced[0].includes(label), `${label} remains reachable in advanced details`);
  assert.ok(!primary.includes(label), `${label} does not crowd the daily controls`);
}
const summary = advanced[0].match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/)![1];
assert.match(summary, /فترة مخصصة/, "a stored resource interval is visible while advanced details are closed");
assert.match(summary, /بيانات إضافية/, "stored receipt and secondary trip values are indicated while closed");
for (const value of ["تجهيزات", "09:15", "07700000000", "إرجاع التجهيزات", "ملاحظة الوصل", "2026-11-04T08:00", "2026-11-04T12:00"]) {
  assert.ok(advanced[0].includes(value), `collapsed advanced controls retain ${value}`);
}

const plain = renderForm({ ...data, transportPlan: { ...data.transportPlan, trips: [{ ...data.transportPlan.trips[0], transportType: null, expectedArrivalTime: null, driverPhone: null, assignedWork: null, notes: null, resourceOccupancy: null }] } });
const plainSummary = plain.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/)![1];
assert.doesNotMatch(plainSummary, /فترة مخصصة|بيانات إضافية/, "an empty advanced section does not imply configured settings");

// Legacy plans must expose the same daily controls and print entry point immediately.
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
client.setQueryData(["admin", "booking-operations", "service", 7, "transportation"], { ...data, transportPlan: { ...data.transportPlan, legacy: true } });
client.setQueryData(["admin", "enterprise", "vehicles", "booking-editor"], { data: vehicles });
client.setQueryData(["admin", "staff", "booking-editor"], drivers);
const editor = renderToStaticMarkup(<QueryClientProvider client={client}><BookingTransportPlanEditor reference={{ source: "service", id: 7 }} onPrint={() => {}}/></QueryClientProvider>);
const editorPrimary = editor.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, "");
assert.match(editorPrimary, /حفظ خطة النقل/, "legacy primary editor is visible without expanding a multi-trip section");
assert.match(editorPrimary, /وصل رحلة 1/, "existing saved-trip print action stays visible");

const perTrip = renderForm({ ...data, transportPlan: { ...data.transportPlan, feeMode: "per_trip", overallCharge: null, trips: [
  { ...data.transportPlan.trips[0], customerCharge: 30000 },
  { ...data.transportPlan.trips[0], id: "trip-8", sequence: 2, vehicleId: 6, driverId: 9, customerCharge: 20000 },
] } });
const perTripPrimary = perTrip.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, "");
assert.equal((perTripPrimary.match(/أجرة هذه الرحلة — د.ع/g) ?? []).length, 2, "each trip keeps its independent fee visible");
assert.match(perTripPrimary, /50,000/, "independent fees retain the existing total");
assert.match(perTripPrimary, /إضافة رحلة نقل/, "multiple trips remain a primary action");

const failure = renderForm(data, new Error("تغيّر إصدار الحجز؛ حدّث الصفحة"));
const failurePrimary = failure.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, "");
assert.match(failurePrimary, /role="alert"[\s\S]*تغيّر إصدار الحجز/, "save failures remain visible outside collapsed controls");
const readonly = renderForm({ ...data, capabilities: { canEdit: false, canPrintFinancial: false } });
assert.doesNotMatch(readonly, /type="submit"/, "disclosure changes cannot grant save permission");
assert.match(readonly, /<fieldset\b[^>]*disabled=""/, "read-only secondary and primary trip controls stay disabled");

console.log("PASS simple transport UI: daily controls and legacy editor visible, advanced values/configuration retained, multiple trip fees, print/save actions, errors and read-only access");
