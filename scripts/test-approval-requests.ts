/** The generic approval queue: an approval with nothing behind it must not exist, and the center must reach every request. No database needed. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ApprovalRequestError,
  OPEN_APPROVAL_STATUSES,
  approvalDecisionNotice,
  approvalExecutionRefusal,
  approvalTypeCategory,
  approvalTypeNeedsMainManager,
  runApprovalDecision,
  type ApprovalExecutionPlan,
} from "../src/server/approval-requests";
import { warehouseApprovalDocument } from "../src/server/warehouse-approvals";
import { approvalRecordHref } from "../src/lib/approval-records";

// Every category offered on the staff delegation panel, or the delegate never sees the request.
const staffPanel = readFileSync("src/views/admin/staff.tsx", "utf8");
const panelCategories = staffPanel.match(/const APPROVAL_CATEGORIES = \[(.*?)\];/)?.[1] ?? "";
for (const type of ["cancel_kosha_booking", "cancel_service_order", "cancel_order", "cancel_receipt_voucher", "cancel_payment_voucher", "delete_product", "delete_document", "general"]) {
  const category = approvalTypeCategory(type);
  assert.ok(category && panelCategories.includes(`"${category}"`), `${type} maps to a category the manager can tick`);
}
assert.equal(approvalTypeCategory("warehouse_transfer"), null, "a delegation must not reach the transfer screen's permission");
assert.equal(approvalTypeCategory("warehouse_count"), null, "a delegation must not reach the count screen's permission");
assert.equal(approvalTypeCategory("constructor"), null, "a free-form type is not an object key");
assert.ok(approvalTypeNeedsMainManager("cancel_receipt_voucher") && approvalTypeNeedsMainManager("cancel_payment_voucher"), "reversing cash stays with the main manager");
assert.ok(!approvalTypeNeedsMainManager("cancel_kosha_booking"), "a booking only opens a pending reversal, which the main manager approves");

// Which outcomes may close a request.
assert.equal(approvalExecutionRefusal({ executed: true }), null);
for (const reason of ["already_cancelled", "already_archived", "no_executor"]) assert.equal(approvalExecutionRefusal({ executed: false, reason }), null, `${reason} leaves the decision true`);
for (const reason of ["missing_document", "document_not_found", "missing_product", "product_not_found", "missing_voucher", "voucher_not_found", "missing_booking", "booking_not_found", "missing_service_order", "service_order_not_found", "missing_order", "order_not_found", "something_new"])
  assert.match(String(approvalExecutionRefusal({ executed: false, reason })), /لم يتغير شيء/, `${reason} keeps the request open`);

// What the employee reads.
assert.deepEqual(approvalDecisionNotice("إلغاء حجز", "rejected", "الزبون أكد"), { title: "تم رفض طلبك", body: "السبب: الزبون أكد · إلغاء حجز" }, "the reason survives the inbox's two-line clamp");
assert.deepEqual(approvalDecisionNotice("إلغاء حجز", "rejected"), { title: "تم رفض طلبك", body: "إلغاء حجز" }, "a screen rejection has no reason to show");
assert.deepEqual(approvalDecisionNotice("إلغاء حجز", "approved"), { title: "تم اعتماد طلبك", body: "إلغاء حجز" });
assert.deepEqual(approvalDecisionNotice("إلغاء حجز", "approved", "تم", "no_executor"), { title: "تم اعتماد طلبك", body: "ملاحظة المراجع: تم · إلغاء حجز" });
assert.deepEqual(approvalDecisionNotice("إلغاء حجز", "approved", null, "already_cancelled"), { title: "أُغلق طلبك", body: "كان منفذاً مسبقاً · إلغاء حجز" }, "an approval that changed nothing does not claim it did");
assert.equal(approvalDecisionNotice("إلغاء حجز", "returned_for_edit", "عدّل")?.title, "أعيد طلبك للتعديل");
for (const status of ["pending_main_manager", "under_review", "pending"]) assert.equal(approvalDecisionNotice("إلغاء حجز", status), null, `${status} is not an answer yet`);

// The decision's order, with a transaction that throws its work away on failure.
const harness = (plan: { execute?: () => Promise<ApprovalExecutionPlan>; lock?: () => Promise<void>; prepare?: () => Promise<void>; undo?: () => Promise<void> }) => {
  const log: string[] = [];
  const run = () =>
    runApprovalDecision<string, string>({
      prepare: async () => {
        log.push("prepare");
        await plan.prepare?.();
        return async () => {
          log.push("undo");
          await plan.undo?.();
        };
      },
      transaction: async (work) => {
        log.push("begin");
        try {
          const result = await work("tx");
          log.push("commit");
          return result;
        } catch (cause) {
          log.push("rollback");
          throw cause;
        }
      },
      lock: async () => {
        log.push("lock");
        await plan.lock?.();
      },
      execute: async () => {
        log.push("execute");
        return plan.execute ? plan.execute() : { executed: true };
      },
      close: async () => {
        log.push("close");
        return "row";
      },
      onUndoFailed: () => log.push("undo-logged"),
      onFollowUpFailed: () => log.push("follow-up-logged"),
    });
  return { log, run };
};

{
  const { log, run } = harness({ execute: async () => ({ executed: true, bookingId: 7, followUps: [async () => log.push("follow-up")] }) });
  const result = await run();
  assert.deepEqual(log, ["prepare", "begin", "lock", "execute", "close", "commit", "follow-up"], "follow-ups wait for the commit");
  assert.deepEqual(result, { row: "row", execution: { executed: true, bookingId: 7 } }, "a follow-up is never sent to the client");
}
{
  const { log, run } = harness({ execute: async () => ({ executed: false, reason: "booking_not_found", followUps: [async () => log.push("follow-up")] }) });
  await assert.rejects(run(), (cause: unknown) => cause instanceof ApprovalRequestError && cause.status === 409 && /الحجز المرتبط/.test(cause.message));
  assert.deepEqual(log, ["prepare", "begin", "lock", "execute", "rollback", "undo"], "a refused approval never closes the request");
}
{
  const boom = new Error("cash box refused");
  const { log, run } = harness({ execute: async () => { throw boom; }, undo: async () => { throw new Error("undo failed too"); } });
  await assert.rejects(run(), (cause) => cause === boom, "the manager hears the first failure, not the undo's");
  assert.deepEqual(log, ["prepare", "begin", "lock", "execute", "rollback", "undo", "undo-logged"], "a failed undo is logged");
}
{
  const { log, run } = harness({ execute: async () => ({ executed: false, reason: "already_cancelled" }) });
  assert.deepEqual((await run()).execution, { executed: false, reason: "already_cancelled" }, "the manager's own earlier cancel closes the request");
  assert.ok(log.includes("close") && !log.includes("undo"));
}
{
  const taken = new ApprovalRequestError("تمت مراجعة هذا الطلب مسبقاً");
  const { log, run } = harness({ lock: async () => { throw taken; } });
  await assert.rejects(run(), (cause) => cause === taken);
  assert.ok(!log.includes("execute"), "a request decided meanwhile runs nothing");
}
{
  const { log, run } = harness({ prepare: async () => { throw new Error("stock failed"); } });
  await assert.rejects(run(), /stock failed/);
  assert.deepEqual(log, ["prepare"], "nothing opens after the stock step fails");
}
{
  const { log, run } = harness({ execute: async () => ({ executed: true, followUps: [async () => { throw new Error("tasks"); }, async () => log.push("second")] }) });
  const result = await run();
  assert.deepEqual(result.execution, { executed: true, followUpFailed: true }, "a follow-up reports but cannot undo a committed decision");
  assert.deepEqual(log.slice(-2), ["follow-up-logged", "second"], "one failed follow-up does not stop the next");
}

// A file hanging on a transfer is not that transfer.
assert.equal(warehouseApprovalDocument({ type: "delete_document", entityType: "warehouse_transfer" }), null);
assert.equal(warehouseApprovalDocument({ type: "warehouse_transfer", entityType: "warehouse_transfer" }), "warehouse_transfer");
assert.equal(warehouseApprovalDocument({ type: "general", entityType: "warehouse_count" }), "warehouse_count");
assert.deepEqual(OPEN_APPROVAL_STATUSES, ["pending", "under_review", "pending_main_manager", "approved_by_delegate"]);

// The route and the executor.
const api = readFileSync("src/server/api.ts", "utf8");
const between = (from: string, to: string) => {
  const start = api.indexOf(from);
  assert.ok(start > 0, `${from} exists`);
  return api.slice(start, api.indexOf(to, start + from.length));
};
const executor = between("async function executeApprovedApprovalRequest(", "\nasync function syncCancelledBookingToPhotography(");
const withoutFollowUps = executor.replace(/followUps:[\s\S]*?\n {4}\};/g, "};");
assert.ok(!/\bdb\.|\(db\b|await addEntityTimeline|await createNotification/.test(withoutFollowUps), "on one connection a global db call inside the transaction would wait forever");
assert.ok(!/role: "manager"/.test(executor), "the old fake manager role could never reverse an executed voucher");
assert.equal(executor.match(/financialActor\(auth\),\s+"إلغاء سند (قبض|صرف) بعد موافقة المدير",\s+undefined,\s+tx,/g)?.length, 2, "both vouchers reverse as the real reviewer, inside the transaction");
assert.equal(executor.match(/financialActor\(auth\),\s+"إلغاء سند (قبض|صرف) بعد موافقة المدير",\s+tx,/g)?.length, 2, "both vouchers cancel a pending movement inside the transaction");
for (const sync of ["syncKoshaFinancialPayment", "syncServiceOrderFinancialPayment", "syncOrderFinancialPayment"])
  assert.match(executor, new RegExp(`${sync}\\(\\s+\\{ \\.\\.\\.existing, status: "cancelled" \\},\\s+financeActorValue,\\s+tx,`), `${sync} joins the transaction`);
assert.match(executor, /syncRentalRowFromStoreOrder\(archived, tx\)/, "a cancelled rental order frees its rental row, as the manager's direct cancel does");
assert.match(executor, /cancelStoreSoundBooking\(\s+archived,[^)]*tx,\s+\)/, "a cancelled store order frees its sound booking");
assert.match(executor, /syncCancelledBookingToPhotography\(id, archived\.trackingCode/, "a cancelled service booking reaches photography");
assert.match(executor, /notifyAssignedBookingStaffSafely\(/, "a cancelled kosha booking tells its team");

const created = [...api.matchAll(/createApprovalRequest\(\{\s+type: "([a-z_]+)"/g)].map((match) => match[1]);
assert.ok(created.length >= 9, "finds the request creators");
for (const type of created)
  assert.ok(type.startsWith("warehouse_") ? warehouseApprovalDocument({ type, entityType: null }) : executor.includes(`row.type === "${type}"`), `${type} has something that runs on approval`);
for (const type of ["cancel_kosha_booking", "cancel_service_order", "cancel_order", "cancel_receipt_voucher", "cancel_payment_voucher"])
  assert.match(api, new RegExp(`type: "${type}",[\\s\\S]{0,200}amount: `), `${type} carries the money at stake, so a delegate's limit applies`);

const route = between('if (section === "approvals") {', 'if (section === "smart-notifications")');
assert.match(route, /approveGeneralApprovalRequest\(\{/, "a non-warehouse approval goes through the unit");
assert.ok(!/delegatedExecution = await executeApprovedApprovalRequest/.test(route), "nothing runs after the request was already marked approved");
assert.match(route, /inArray\(approvalRequestsTable\.status, OPEN_APPROVAL_STATUSES\),\s+\),\s+\)\s+\.returning\(\);\s+if \(!delegatedRow\) return error\("تمت مراجعة هذا الطلب مسبقاً", 409\)/, "two reviewers cannot both decide");
assert.match(route, /err instanceof FinancialApprovalError/, "a cash box refusal reaches the manager with its reason");
assert.match(route, /params\.get\("excludeWarehouse"\) === "1"/, "the center can leave transfers and counts to their screens");
assert.match(route, /status === "open"/, "the center can ask for every open status at once");
assert.match(route, /decisions: \{/, "each row says what this reviewer may do");
assert.match(route, /delegatedRequest\.status === "pending_main_manager"\)\s+return error/, "a forwarded request belongs to the main manager");
assert.match(api, /delegateApprovalReach[\s\S]{0,700}scope\.requiresMain \|\|\s+overLimit/, "limits and main-manager-only requests forward instead of executing");
assert.match(api, /href: input\.href \?\? "\/admin\/approvals\?tab=requests"/, "the notification opens the tab that can decide it");
const noticeHelper = between("async function notifyApprovalRequesters(", "\nasync function addApprovalAction(");
assert.match(noticeHelper, /audienceType: "admin",\s+staffId: requester\.id,/, "the notice is addressed to the employee alone");
assert.match(noticeHelper, /href: approvalRecordHref\(request\)/, "the notice opens the record, a screen the employee can reach");
const adminInbox = between('if (section === "notifications") {', '// 🍽 Catering Center');
assert.match(adminInbox, /const visibleInbox = hasPermission\(auth, "dashboard"\)\s+\? or\([\s\S]{0,120}\)\s+: eq\(notificationsTable\.staffId, auth\.id\);/, "without a dashboard an employee reads only what is addressed to them");
assert.equal(adminInbox.match(/visibleInbox,/g)?.length, 5, "reading, counting, marking and deleting all use the same limit");
assert.ok(!/staffId\} is null`,\s+eq\(notificationsTable\.staffId, auth\.id\),\s+\),\s+\),/.test(adminInbox.slice(adminInbox.indexOf("visibleInbox,"))), "no action reaches past that limit");
assert.match(api, /const portalNotices = and\(\s+eq\(notificationsTable\.staffId, auth\.id\),\s+or\(\s+eq\(notificationsTable\.audienceType, "staff"\),\s+eq\(notificationsTable\.type, "approval_decision"\),/, "the staff portal shows the same notice");
assert.match(noticeHelper, /request\.requestedBy === reviewerId/, "nobody is told about their own decision");
assert.match(noticeHelper, /catch \(err\)/, "a failed notice cannot read as a failed decision");
assert.match(route, /await addApprovalAction\(approvalAudit\);\s+await notifyApprovalRequesters\(\s+\[delegatedRow\]/, "the queue tells the employee only after the decision is saved");
assert.equal(api.match(/await notifyApprovalRequesters\((closed|result\.closed), \{ status: "(approved|rejected)" \}/g)?.length, 4, "both warehouse screens tell the employee after their transaction");

// A request's record.
assert.equal(approvalRecordHref({ type: "cancel_kosha_booking", entityType: "kosha_booking", entityId: 7 }), "/admin/kosha-bookings?booking=7");
assert.equal(approvalRecordHref({ type: "delete_document", entityType: "kosha_booking", entityId: 7 }), "/admin/documents", "a document's entity is the record it hangs on");
assert.equal(approvalRecordHref({ type: "warehouse_transfer", entityType: "warehouse_transfer", entityId: 3 }), "/admin/warehouse-transfers");
assert.equal(approvalRecordHref({ type: "general", entityType: null, entityId: null }), null);

// The center.
const page = readFileSync("src/views/admin/operations.tsx", "utf8");
const panel = page.slice(page.indexOf("const approvalRequestsQuery"), page.indexOf("function FinancialApprovalsPanel"));
assert.match(panel, /excludeWarehouse: "1"/, "transfers and counts stay on their own screens");
assert.match(panel, /`\/admin\/approvals\/\$\{row\.id\}`, \{ method: "PATCH"/, "decides through the existing route");
assert.match(panel, /row\.decisions\.approve/, "approve follows the server's answer");
assert.match(panel, /row\.decisions\.reject/, "reject follows the server's answer");
assert.match(panel, /list\.error \? <QueryFailure/, "a failed list is an error, not an empty queue");
assert.ok(!/window\.(prompt|confirm)/.test(panel), "no browser dialogs on a consequential decision");
assert.match(page, /error \? <QueryFailure error=\{error\} onRetry=\{\(\) => refetch\(\)\} \/> : isLoading/, "a refused financial list says so instead of showing no documents");
const routes = readFileSync("src/views/admin/index.tsx", "utf8");
assert.match(routes, /path="\/admin\/approvals">\s+\{\(\) => \(\s+<Guard me=\{me\} anyPerm=\{\["tasks", "approvals\.view"\]\}>/, "a delegate can open the page");
assert.match(routes, /<Guard me=\{me\}>\s+<NotificationsPage \/>/, "an employee without a dashboard can read their notices in full");
const shell = readFileSync("src/views/admin/_layout.tsx", "utf8");
const headerRow = shell.slice(shell.indexOf("admin-mobile-header md:hidden"), shell.indexOf('aria-label="فتح القائمة"'));
assert.ok(!/justify-between[^"]*overflow-hidden/.test(headerRow), "the phone header row must not clip the bell's panel");
assert.match(headerRow, /flex min-w-0 items-center gap-3 overflow-hidden/, "the title side still clips a long site name");

console.log("PASS approval requests: refused approvals stay open, follow-ups wait for the commit, vouchers reverse as the real reviewer, delegates follow their categories and limits, the center decides through the existing route");
