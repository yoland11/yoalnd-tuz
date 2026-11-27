/**
 * Album Management: stage vocabulary, permissions, money, timing, codes, the
 * isolated additive migration and the wiring into existing invoices, cash-box
 * approvals, stock engine, Work Commands, notifications, scanning and printing.
 * No database writes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALBUM_ACTIONS, ALBUM_PERMISSIONS, ALBUM_STAGE_BUCKETS, ALBUM_STAGES, albumAccess, albumActionsFor, albumBarcode, albumCents, albumCopyCode,
  albumFinance, albumNumber, albumQrPayload, isAlbumDelayed, isAlbumStage,
} from "../src/lib/albums";

const read = (path: string) => readFileSync(path, "utf8");

// ── The 11 production stages, in the requested order and wording ──
assert.deepEqual(ALBUM_STAGES.map((stage) => stage.label), [
  "تم استلام الطلب", "بانتظار اختيار الصور", "تم اختيار الصور", "قيد التصميم", "بانتظار موافقة الزبون", "تمت الموافقة",
  "قيد الطباعة", "قيد التجليد", "فحص الجودة", "جاهز للتسليم", "تم التسليم",
]);
assert.ok(isAlbumStage("ready") && !isAlbumStage("done") && !isAlbumStage(null));
// Every stage sits in exactly one dashboard card.
const bucketed = Object.values(ALBUM_STAGE_BUCKETS).flat();
assert.deepEqual([...bucketed].sort(), ALBUM_STAGES.map((stage) => stage.key).sort());
assert.equal(new Set(bucketed).size, bucketed.length);

// ── Quick actions after a scan ──
for (const label of ["استلام الألبوم", "بدء التصميم", "إكمال التصميم", "بدء الطباعة", "إكمال الطباعة", "إكمال التجليد", "فحص الجودة", "جاهز للتسليم", "تسليم للزبون", "تسجيل ملاحظة", "رفع صورة"])
  assert.ok(ALBUM_ACTIONS.some((action) => action.label === label), label);
assert.deepEqual(albumActionsFor("designing").map((action) => action.key), ["complete_design", "note", "photo"]);
assert.ok(albumActionsFor("ready").some((action) => action.key === "deliver"));
assert.deepEqual(albumActionsFor("delivered").map((action) => action.key), ["note", "photo"], "a delivered album only takes notes and photos");
assert.deepEqual(albumActionsFor("printing", "cancelled").map((action) => action.key), ["note", "photo"]);

// ── Permissions: new album keys, and existing photography holders keep working ──
assert.deepEqual([...ALBUM_PERMISSIONS], ["albums", "albums.manage", "albums.financials", "albums.deliver"]);
const none = albumAccess({ role: "staff", permissions: [] });
assert.ok(!none.view && !none.manage && !none.financials && !none.deliver);
assert.equal(albumAccess({ role: "admin", permissions: [], isActive: false }).view, false, "an inactive account sees nothing");
const admin = albumAccess({ role: "admin", permissions: [] });
assert.ok(admin.manage && admin.financials && admin.deliver && admin.viewAll);
const worker = albumAccess({ role: "staff", permissions: ["albums"] });
assert.ok(worker.viewAll && worker.work && !worker.manage && !worker.financials && !worker.deliver, "money stays hidden from album workers");
const portal = albumAccess({ role: "staff", permissions: ["photography.portal.view"] });
assert.ok(portal.work && !portal.viewAll, "portal-only employees see only albums assigned to them");
assert.ok(albumAccess({ role: "staff", permissions: ["photography.financials.view"] }).financials);
assert.ok(albumAccess({ role: "staff", permissions: ["photography.delivery.confirm"] }).deliver);
assert.ok(albumAccess({ role: "staff", permissions: ["photography.assignment.manage"] }).manage);

// ── Money: one definition, integer cents ──
assert.equal(albumCents("150,000"), 15_000_000);
assert.equal(albumCents("١٥٠٠"), 150_000);
const invoice = albumFinance({ salePrice: "150000", designCost: "20000", printingCost: "45000", coverCost: "15000", bindingCost: "5000", extraCosts: "2500", paidAmount: "100000", financeMode: "invoice" });
assert.deepEqual(invoice, { salePrice: "150000.00", totalCost: "87500.00", paidAmount: "100000.00", remainingAmount: "50000.00", netProfit: "62500.00" });
const pkg = albumFinance({ salePrice: "150000", designCost: "20000", printingCost: "0", coverCost: "0", bindingCost: "0", extraCosts: "0", financeMode: "package" });
assert.equal(pkg.salePrice, "0.00", "an album inside a package is never charged again");
assert.equal(pkg.remainingAmount, "0.00");
assert.equal(albumFinance({ salePrice: "100", designCost: 0, printingCost: 0, coverCost: 0, bindingCost: 0, extraCosts: 0, paidAmount: "500", financeMode: "invoice" }).remainingAmount, "0.00", "overpayment never shows a negative balance");

// ── Delays ──
assert.equal(isAlbumDelayed({ dueDate: "2026-11-20", stage: "printing" }, "2026-11-26"), true);
assert.equal(isAlbumDelayed({ dueDate: "2026-11-20", stage: "ready" }, "2026-11-26"), false);
assert.equal(isAlbumDelayed({ dueDate: "2026-11-26", stage: "designing" }, "2026-11-26"), false, "due today is not late yet");
assert.equal(isAlbumDelayed({ dueDate: null, stage: "designing" }, "2026-11-26"), false);
assert.equal(isAlbumDelayed({ dueDate: "2026-11-01", stage: "designing", status: "cancelled" }, "2026-11-26"), false);

// ── Identification: no customer data inside codes ──
assert.equal(albumNumber(1), "ALB-00001");
assert.equal(albumBarcode(315), "ALB00315");
assert.equal(albumCopyCode(315, 2), "ALB-00315-2");
const qr = albumQrPayload("http://192.168.1.10:3000", "tok_ABC-123");
assert.equal(qr, "http://192.168.1.10:3000/admin/albums?scan=tok_ABC-123", "the QR is a local-server link with an opaque token");

// ── Migration: isolated, additive, accepted by the production runner ──
const migration = read("lib/db/migrations/0141_album_management.sql");
const runner = read("scripts/apply-reviewed-schema-migration.ts");
const banned = runner.match(/if \((\/\\b\(\?:DROP[\s\S]*?\/i)\.test\(migrationSql\)\)/)?.[1];
assert.ok(banned, "found the runner's additive-only rule");
assert.equal(new Function(`return ${banned}`)().test(migration), false, "the runner accepts the migration");
assert.ok(!/\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\b(?!\s+(CASCADE|SET|RESTRICT))/i.test(migration.replace(/ON DELETE (CASCADE|SET NULL|RESTRICT)/g, "")), "no data changes in the migration");
for (const table of ["album_catalog_options", "album_orders", "album_order_events", "album_copies", "album_materials", "album_tasks"])
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`), table);
assert.match(migration, /album_order_events_one_delivery_idx ON album_order_events \(album_id\) WHERE type = 'delivered'/, "a second delivery record is refused by the database");
assert.match(migration, /album_orders_creation_key_idx ON album_orders \(creation_key\)/, "a retried save returns the same album");
assert.match(migration, /album_orders_invoice_idx ON album_orders \(invoice_id\)/, "one invoice belongs to one album");
assert.match(migration, /album_materials_request_key_idx ON album_materials \(request_key\)/, "a retried material line is applied once");
assert.match(migration, /finance_mode IN \('invoice', 'package', 'free'\)/);
const schemaIndex = read("lib/db/src/schema/index.ts");
assert.match(schemaIndex, /export \* from "\.\/albums";/);

// ── Server: reuse, not copies ──
const server = read("src/server/albums.ts");
assert.match(server, /createAndExecuteSourceFinancialTransaction\(tx, \{[\s\S]*?sourceType: "sales_invoice", sourceId: String\(invoice\.id\), sourceEvent: "payment", idempotencyKey,/, "payments are pending cash-box requests on the album's invoice");
assert.match(server, /`album-payment:\$\{id\}:\$\{key\}`/, "payment retries share one idempotency key");
assert.match(server, /await reconcilePaymentState\(tx, \{ sourceType: "sales_invoice", sourceId: invoice\.id \}\)/, "invoice state comes from the canonical reconciler");
assert.ok((server.match(/reconcilePaymentState\(/g) ?? []).length >= 4, "price change, payment and cancellation reconcile too");
assert.match(server, /bookingAlbumIncluded\(tx, data\.bookingId\)/);
assert.match(server, /لا يُحاسب الزبون عليه مرتين/, "an album already in the package is not charged twice");
assert.match(server, /idempotencyKey: `\$\{lineKey\}:out`/, "material deduction uses the stock engine's idempotency key");
assert.match(server, /idempotencyKey: `\$\{line\.request_key\}:return`/);
assert.match(server, /STOCK_INSUFFICIENT/);
assert.match(server, /outstanding > 0 && !\(raw\.allowOutstanding === true && access\.financials\)/, "delivery with money owed needs finance permission and explicit confirmation");
assert.match(server, /if \(!access\.financials\) return base;/, "financial fields are only serialized for finance users");
assert.match(server, /AND \$\{scopeCondition\(access, user\.id\)\}/, "portal-only employees are scoped to their albums");
assert.match(server, /source_type = 'sales_invoice'[\s\S]*approval_status = 'pending'/, "pending payments count against what can still be collected");
assert.match(server, /createApiErrorPayload\(\{ requestId, status, code, message, fieldErrors \}\)/, "structured AJN errors");
assert.ok(!/catch\s*\{\s*return\s*(\[\]|null)/.test(server), "no failure is turned into empty data");
assert.match(server, /وحدة الألبومات تحتاج تطبيق ترحيل قاعدة البيانات 0141_album_management/, "a missing table is reported, never shown as no data");

const api = read("src/server/api.ts");
assert.match(api, /import \{ albumDeadlineAlerts, handleAlbums \} from "\.\/albums";/);
assert.match(api, /if \(section === "albums"\) \{[\s\S]*?adjustStock: \(productId, delta, meta, tx\) => adjustProductStock\(productId, delta, meta, tx as any\)/, "the existing stock engine moves stock");
assert.match(api, /source: \{ type: "album_task", id: input\.sourceId \}/, "assignments become Work Commands orders");
assert.match(api, /for \(const alert of await albumDeadlineAlerts\(\)\)/, "late albums join the periodic notifications");
const work = read("src/server/work-commands.ts");
assert.match(work, /const SOURCE_TYPES = new Set\(\["photography_production_item", "album_task",/);
for (const key of ALBUM_PERMISSIONS) {
  assert.ok(api.includes(`"${key}",`), `server permission list has ${key}`);
  assert.ok(read("src/views/admin/_lib.ts").includes(`"${key}"`), `admin permission list has ${key}`);
}

// ── Navigation, employee portal, printing, scanning ──
const layout = read("src/views/admin/_layout.tsx");
assert.match(layout, /href: "\/admin\/albums",\n\s+label: "إدارة الألبومات"/);
assert.match(layout, /id: "photography",\n\s+label: "التصوير",[\s\S]*?navItem\("\/admin\/albums"\)/, "albums sit inside the photography section");
assert.match(read("src/views/admin/index.tsx"), /<Route path="\/admin\/albums">/);
assert.match(read("src/views/staff/photography/index.tsx"), /<Route path="\/staff\/photography\/albums"><StaffAlbumsPage staffId=\{me\.id\} \/><\/Route>/);
const print = read("src/lib/album-print.ts");
for (const title of ["وصل طلب ألبوم", "أمر تصنيع ألبوم", "وصل تسليم ألبوم"]) assert.ok(print.includes(title), title);
assert.match(print, /@page \{ size: \$\{width\}mm \$\{height\}mm; margin: 0; \}/, "labels print at the exact label size");
assert.match(print, /\$\{thermal \? "margin: 0;" : "size: A4; margin: 12mm;"\}/, "80mm uses a zero-margin page with fluid width");
assert.ok(!/customerName|phone/.test(print.match(/export async function albumQrDataUrl[\s\S]*?\n}/)?.[0] ?? "x"), "QR content never includes customer data");
assert.match(read("src/components/albums/album-scan.tsx"), /import \{ LiveScanner \} from "@\/views\/staff\/live-scanner";/, "the existing scanner is reused");
const panel = read("src/components/albums/album-panel.tsx");
assert.match(panel, /uploadImageWithVariants\(file, \{ folder: "uploads\/albums" \}\)/, "photos use the existing (local-server compatible) upload pipeline");
assert.ok(!/<input[^>]*type="date"/.test(read("src/components/albums/create-album-dialog.tsx") + panel + read("src/views/admin/albums.tsx")), "dates use the shared DateField");

console.log("PASS album management: 11 stages, scan actions, permissions (legacy photography kept), money in cents, delays, opaque codes, additive migration, invoice/cash-box/stock/work-commands reuse, scoped employees, printing and scanning wiring");
