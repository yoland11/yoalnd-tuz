// AJN fast save/API/legacy contract suite.
// This layer is intentionally read-only. The test:save-smoke wrapper runs it
// before the isolated TEST-database integration suites.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
// esbuild is transitive in this workspace, so pnpm does not create a root
// symlink. Resolve its installed virtual-store entry instead of pinning a
// specific version, which changes whenever the supported override moves.
const esbuildStoreEntry = readdirSync("node_modules/.pnpm")
  .find((entry) => entry.startsWith("esbuild@"));
if (!esbuildStoreEntry)
  throw new Error("esbuild is required for the save-smoke suite");
const { build } = require(
  `../node_modules/.pnpm/${esbuildStoreEntry}/node_modules/esbuild/lib/main.js`,
);
const bundle = await build({
  entryPoints: ["src/server/write-safety.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const output = join(mkdtempSync(join(tmpdir(), "ajn-save-smoke-")), "write-safety.mjs");
writeFileSync(output, bundle.outputFiles[0].text);
const { createApiErrorPayload, mapWriteError } = await import(pathToFileURL(output).href);
const paymentBundle = await build({
  entryPoints: ["src/lib/payment-settlement.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const paymentOutput = join(mkdtempSync(join(tmpdir(), "ajn-payment-smoke-")), "payment-settlement.mjs");
writeFileSync(paymentOutput, paymentBundle.outputFiles[0].text);
const { settlePaymentAmounts } = await import(pathToFileURL(paymentOutput).href);

let failures = 0;
function check(name, actual, expected = true) {
  const ok = typeof expected === "function" ? expected(actual) : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`✓ ${name}`);
  else { failures += 1; console.error(`✗ ${name}\n  actual: ${JSON.stringify(actual)}`); }
}

// Error-contract regression tests. These are pure and never connect to a DB.
const payload = createApiErrorPayload({ requestId: "REQ-save-smoke", status: 400, code: "VALIDATION_ERROR", fieldErrors: { customerId: "مطلوب" } });
check("structured validation response preserves legacy and new fields", {
  success: payload.success,
  code: payload.code,
  requestId: payload.requestId,
  hasMessage: Boolean(payload.message),
  hasLegacyError: Boolean(payload.error),
  field: payload.fieldErrors?.customerId,
}, { success: false, code: "VALIDATION_ERROR", requestId: "REQ-save-smoke", hasMessage: true, hasLegacyError: true, field: "مطلوب" });
check("unique violation maps to duplicate conflict", mapWriteError({ code: "23505" }), (v) => v.status === 409 && v.code === "DUPLICATE");
check("foreign-key violation maps safely", mapWriteError({ code: "23503" }), (v) => v.status === 409 && v.code === "FOREIGN_KEY_CONFLICT");
check("not-null violation maps to validation", mapWriteError({ code: "23502" }), (v) => v.status === 400 && v.code === "VALIDATION_ERROR");
check("serialization conflict is retryable", mapWriteError({ code: "40001" }), (v) => v.status === 409 && v.code === "STALE_DATA" && v.retryable);
check("database outage is not exposed as raw driver error", mapWriteError({ code: "08006" }), (v) => v.status === 500 && v.code === "DATABASE_ERROR" && v.retryable);
check("partial-index conflict maps to a safe actionable response", mapWriteError({ code: "42P10" }), (v) => v.status === 409 && v.code === "CONFLICT" && !v.retryable);

// Payment-state cases used by the sales invoice API. These run without a DB
// and keep full, partial and unpaid server-side calculations consistent.
check("full payment settles the full total", settlePaymentAmounts(5000, 5000, undefined, "transfer"), { paid: 5000, remaining: 0, status: "paid" });
check("partial payment keeps the outstanding balance", settlePaymentAmounts(5000, 1250, undefined, "transfer"), { paid: 1250, remaining: 3750, status: "partial" });
check("unpaid transfer invoice remains unpaid", settlePaymentAmounts(5000, 0, undefined, "transfer"), { paid: 0, remaining: 5000, status: "unpaid" });
check("payment cannot exceed the invoice total", settlePaymentAmounts(5000, 9000, undefined, "transfer"), { paid: 5000, remaining: 0, status: "paid" });

// Fast source assertions protect the high-risk save paths without running them
// against production. Runtime integration tests belong in a separately
// configured test database adapter, never in a developer's normal .env.
const api = readFileSync("src/server/api.ts", "utf8");
const masterCashBox = readFileSync("src/server/master-cash-box.ts", "utf8");
const sales = readFileSync("src/views/admin/sales.tsx", "utf8");
const deliverySection = readFileSync("src/views/admin/delivery-section.tsx", "utf8");
const deliveryServer = readFileSync("src/server/delivery-details.ts", "utf8");
const purchases = readFileSync("src/views/admin/purchases.tsx", "utf8");
const companyLoans = readFileSync("src/views/admin/loans.tsx", "utf8");
const apiRoute = readFileSync("app/api/[...path]/route.ts", "utf8");
const desktopIdempotency = readFileSync("src/server/desktop-idempotency.ts", "utf8");
const client = readFileSync("src/views/admin/_lib.ts", "utf8");
const bundleSchema = readFileSync("lib/db/src/schema/product-bundles.ts", "utf8");
const bundlePage = readFileSync("src/views/admin/product-bundles.tsx", "utf8");
const koshaSchema = readFileSync("lib/db/src/schema/kosha-staff.ts", "utf8");
const koshaMigration = readFileSync("lib/db/migrations/0100_kosha_field_collection_approval.sql", "utf8");
const schemaIndexRecovery = readFileSync("lib/db/migrations/0101_schema_index_recovery.sql", "utf8");
const koshaStaff = readFileSync("src/views/staff/booking-detail.tsx", "utf8");
const koshaCollections = readFileSync("src/views/admin/kosha-collections.tsx", "utf8");
const koshaAdmin = readFileSync("src/views/admin/koshas.tsx", "utf8");
const bookingCenter = readFileSync("src/views/admin/booking-center.tsx", "utf8");
const bookingEditor = readFileSync("src/views/admin/orders.tsx", "utf8");
const serviceDetails = readFileSync("src/lib/service-details.ts", "utf8");
const bookingPhotos = readFileSync("src/lib/booking-photos.ts", "utf8");
const imageUploadEditor = readFileSync("src/components/image-upload-editor.tsx", "utf8");
const taskSchema = readFileSync("lib/db/src/schema/admin-extensions.ts", "utf8");
const taskMigration = readFileSync("lib/db/migrations/0102_task_photo_workflow.sql", "utf8");
const taskAdmin = readFileSync("src/views/admin/tasks.tsx", "utf8");
const taskPortal = readFileSync("src/views/staff/unified-portal.tsx", "utf8");
const taskPhotos = readFileSync("src/components/task-photo-gallery.tsx", "utf8");
const taskUploads = readFileSync("src/lib/large-image-upload.ts", "utf8");
const taskPhotoParser = api.slice(api.indexOf("function taskPhotoInputs"), api.indexOf("function formatTaskPhoto"));
const relatedTaskProgress = api.slice(api.indexOf("async function taskProgressForRelated"), api.indexOf("function completedStepsForEntityStatus"));
const taskHandler = api.slice(api.indexOf('if (section === "tasks")'), api.indexOf('if (section === "calendar")'));
const staffWorkspaceHandler = api.slice(api.indexOf("async function handleUnifiedStaffPortal"), api.indexOf("async function handleStaffPortal"));
check("all uncaught API writes use central PostgreSQL mapping", api.includes("mapWriteError(err)") && api.includes("createApiErrorPayload"));
check("sales invoice save keeps a database transaction", api.includes("saved = await db.transaction(async (tx) =>"));
check("purchase invoice save keeps a database transaction", api.includes("const savedPurchase = await db.transaction(async (tx) =>"));
check("sales idempotency target matches its partial unique index", api.includes("where: sql`${salesInvoicesTable.idempotencyKey} IS NOT NULL`"));
check("purchase idempotency target matches its partial unique index", api.includes("where: sql`${purchaseInvoicesTable.idempotencyKey} IS NOT NULL`"));
check("sales invoice errors include a safe transaction step trace", api.includes("[SALES_INVOICE_SAVE_FAILED]") && api.includes("invoiceSaveStep"));
check("sales invoice supports decimal inventory quantities to three places", api.includes("الكمية تدعم حتى 3 منازل عشرية") && api.includes("stock::numeric >="));
check("sales invoice persists payments within the invoice transaction", api.includes("createAndExecuteSourceFinancialTransaction(") && api.includes('traceInvoiceSave("payment_and_cashbox")'));
const sourceFinancialGate = masterCashBox.slice(masterCashBox.indexOf("export async function createAndExecuteSourceFinancialTransaction"), masterCashBox.indexOf("export async function rejectFinancialTransaction"));
check("source financial collections enter approval pending without direct cash-box execution", sourceFinancialGate.includes('approvalStatus: "pending"') && !sourceFinancialGate.includes("return executePendingFinancialTransaction("));
check(
  "financial approval restricts cash-box execution to the principal administrator",
  masterCashBox.includes('return String(actor.role ?? "").toLowerCase() === "admin"') &&
    masterCashBox.includes("اعتماد المعاملات المالية متاح للمدير الرئيسي فقط"),
);
check("sales invoices keep pending collections out of official paid amount", api.includes('paidAmount: "0",') && api.includes('paymentStatus: paidAmount > 0 ? "pending_approval" : paymentStatus'));
check("sales invoice does not require optional tracking columns on insert", api.includes(".returning(salesInvoiceRecordColumns)") && !api.includes("createdByRole: auth.role"));
check("sales invoice client sends an idempotency key", sales.includes('"x-idempotency-key": submitKeyRef.current'));
check("purchase invoice client sends an idempotency key", purchases.includes('"x-idempotency-key": submitKeyRef.current'));
check("purchase cash invoices respect an explicitly supplied partial payment", api.includes("hasExplicitPaidAmount ? undefined : paymentMethod"));
check("purchase payments stay unofficial until financial approval", api.includes('paidAmount: "0",\n          remainingAmount: String(total)') && api.includes('sourceType: "purchase_invoice"'));
check("pending company loans update their linked approval in the same transaction", api.includes('company-loans.update') && api.includes('SELECT * FROM company_loans WHERE id = ${id} FOR UPDATE') && api.includes('لا يمكن تعديل القرض بعد اعتماده أو بدء السداد') && api.includes('action: "company_loan_updated"'));
check("company loan cancellation preserves records and rejects only pending approvals", api.includes('company-loans.cancel') && api.includes('status: "cancelled"') && api.includes('approvalStatus: "rejected"') && api.includes('action: "company_loan_cancelled"'));
check("company loans provide print, edit and safe cancellation actions", companyLoans.includes("function printLoan") && companyLoans.includes("طباعة") && companyLoans.includes("تعديل") && companyLoans.includes("إلغاء"));
check("approved supplier payments settle the linked invoice exactly once", masterCashBox.includes('transaction.sourceType === "purchase_invoice"') && masterCashBox.includes("UPDATE purchase_invoices") && masterCashBox.includes("payment_status = CASE"));
check("supplier payment requests protect the remaining balance from duplicate pending requests", api.includes("availableToRequest") && api.includes("supplier_payment_requested"));
check("all mutation routes retain the shared idempotency boundary", apiRoute.includes("withDesktopIdempotency(req, path") && desktopIdempotency.includes('request.headers.get("x-idempotency-key")') && desktopIdempotency.includes('status === "completed"'));
check("purchase register API retains data, total and summary fields", api.includes("data: rows.map(invoiceRegisterView)") && api.includes("total: countRow?.c ?? 0") && api.includes("summary,"));
check("legacy sales and purchase invoices without branch assignment remain visible in MAIN", api.includes("Sales invoices created before branch assignment") && api.includes("Purchase invoices created before branch assignment"));
check("nullable historical task and staff relations are queried explicitly", relatedTaskProgress.includes("columns: {") && staffWorkspaceHandler.includes("columns: {"));
check("shared client preserves error code and request id", client.includes("class AjNApiError") && client.includes("x-request-id"));
check("shared client coalesces duplicate in-flight writes", client.includes("inFlightWrites") && client.includes("if (pending) return pending"));
check("service booking creates or links the customer inside its booking transaction", api.includes("ensureCustomerForPhone(\n      values.phone") && api.includes("tx,\n    );") && api.includes("skipCustomerSync: true"));
check("service booking writes its status history in the same transaction", api.includes("await tx.insert(serviceOrderStatusHistoryTable).values"));
check("service booking errors classify schema, date, and database failures", api.includes('code === "42P01"') && api.includes('fieldErrors: { eventDate') && api.includes('code: "DATABASE_ERROR"'));
check("booking center keeps form values and focuses returned invalid fields", bookingCenter.includes("const [fieldErrors, setFieldErrors]") && bookingCenter.includes("focusField(Object.keys(returnedErrors)[0])") && bookingCenter.includes("aria-invalid={Boolean(fieldErrors.eventDate)}"));
check("booking form supports multiple stored photos and mobile camera without database binaries", bookingCenter.includes("multiple={replacePhotoIndex == null}") && bookingEditor.includes("showCameraAction") && imageUploadEditor.includes('capture="environment"') && bookingPhotos.includes("isStoredBookingPhoto"));
check("booking create and edit derive deposit, remaining and payment status from amounts", bookingCenter.includes("depositTooHigh") && bookingEditor.includes("const paidAmount = Math.min(totalAmount, enteredPaidAmount)") && api.includes("settleByAmount: true") && api.includes("لا يمكن أن يتجاوز العربون المبلغ الكلي للحجز"));
check("booking photo and financial edits stay on the same booking and enter the existing timeline", bookingEditor.includes('`/admin/service-orders/${order.id}`') && api.includes('type: "booking_photos_updated"') && api.includes('["remainingAmount", prev.remainingAmount, row.remainingAmount]'));
check("photography bookings expose video or photo-session details and retain session-specific fields only for sessions", serviceDetails.includes('label: "نوع التصوير"') && serviceDetails.includes('label: "تصوير فيديو"') && serviceDetails.includes('label: "جلسة تصوير"') && serviceDetails.includes('label: "مكان جلسة التصوير"') && serviceDetails.includes('label: "نوع التسليم"') && serviceDetails.includes('label: "عدد اللقطات"') && serviceDetails.includes('dependsOn: { key: "photographyServiceKind", value: "photo_session" }') && serviceDetails.includes('delete next.photoShotCount'));
check("bundle sale resolves components server-side", api.includes("resolveSalesInvoiceBundleLines") && api.includes("salesInvoiceBundleSnapshotsTable"));
check("bundle stock uses the same conditional invoice transaction", api.includes("sales_invoice_bundle_stock_deducted") && api.includes("stock::numeric >="));
check("bundle snapshot schema preserves original components", bundleSchema.includes("salesInvoiceBundleSnapshotsTable") && bundleSchema.includes("components"));
check("used bundles archive instead of deleting invoice history", api.includes('operation: "archived"') && api.includes("sales_invoice_bundle_snapshots"));
check("bundle management has live component search and duplicate protection", bundlePage.includes("componentSearch") && bundlePage.includes("selectedIds.has"));
check("bundle delivery fee is server-derived and kept separate from component stock", api.includes("offerDeliveryFee = bundleResolution.offerDeliveryFee") && api.includes("deliveryFeePerBundle") && bundleSchema.includes("deliveryFee"));
check("sales governorate delivery uses dependent searchable province areas", deliverySection.includes("SearchableDeliverySelect") && deliverySection.includes("province?.areas") && deliverySection.includes("disabled={!provinceId}"));
check("sales governorate delivery keeps advanced details collapsed", deliverySection.includes("بقية تفاصيل التوصيل") && deliverySection.includes("detailsOpen"));
check("sales invoice edit preserves and updates existing delivery atomically", sales.includes("initialValue={invoice.delivery}") && api.includes("await updateInvoiceDelivery({") && deliveryServer.includes("export async function updateInvoiceDelivery"));
check("sales invoice edit total preserves separate delivery charges", api.includes("offerDeliveryFee + deliveryFee + deliveryCodFee") && sales.includes("offerDeliveryFee + deliveryFee + deliveryCodFee"));
// Kosha field collection: the staff report is deliberately separate from the
// official booking payment. The atomic approval path is the only path allowed
// to execute cash, voucher allocation, booking totals, and accounting.
check("kosha field collection schema records method, receipt, balance snapshot and idempotency", koshaSchema.includes("paymentMethod") && koshaSchema.includes("receiptImage") && koshaSchema.includes("remainingBefore") && koshaSchema.includes("idempotencyKey"));
check("kosha field collection migration preserves history and prevents duplicate submits", koshaMigration.includes("ADD COLUMN IF NOT EXISTS") && koshaMigration.includes("kosha_payment_requests_idempotency_idx") && !/^\s*(?:UPDATE|DELETE\s+FROM|TRUNCATE|DROP)\b/im.test(koshaMigration));
check("production index recovery remains additive and tracks its applied revision", schemaIndexRecovery.includes("CREATE INDEX IF NOT EXISTS") && schemaIndexRecovery.includes("VALUES (101") && !/^\s*(?:UPDATE|DELETE\s+FROM|TRUNCATE|DROP)\b/im.test(schemaIndexRecovery));
check("kosha field collection starts pending manager approval without a financial movement", api.includes('status: "pending_manager_approval"') && api.includes("kosha_field_collection.submit") && api.includes("x-idempotency-key"));
check("kosha approval posts booking, receipt allocation, cash and journal in one transaction", api.includes('result = await db.transaction(async (tx) =>') && api.includes('sourceEvent: "kosha_field_collection"') && api.includes("createAndExecuteSourceFinancialTransaction(") && api.includes("receiptVoucherAllocationsTable"));
check("kosha rejection requires a recorded reason and never posts cash", api.includes("سبب رفض التحصيل مطلوب") && api.includes("rejection_reason") && api.includes("payment_rejected"));
check("kosha staff collection is embedded in booking details with method and receipt proof", koshaStaff.includes("CollectPanel") && koshaStaff.includes("طريقة الدفع") && koshaStaff.includes("صورة وصل الاستلام"));
check("kosha completion is server-gated until the customer's official remaining balance is settled", api.includes("officialRemainingBeforeCompletion") && api.includes("لا يمكن إتمام الحجز قبل تسجيل واعتماد تحصيل المبلغ المتبقي على العميل"));
check("kosha collection stays separate from field stages and explains the unified customer and cash-box flow", koshaStaff.includes("الحسابات والتحصيل") && koshaStaff.includes("قسم مالي مستقل عن مراحل التنفيذ") && koshaStaff.includes("سند قبض موحّد"));
check("main approval screen exposes booking, customer, receipt and required rejection reason", koshaCollections.includes("فتح الحجز") && koshaCollections.includes("حساب العميل") && koshaCollections.includes("فتح صورة الوصل") && koshaCollections.includes("سبب الرفض مطلوب"));
// Task photo workflow reuses the original task and attachment records. The
// source assertions are intentionally read-only and never touch storage or DB.
check("task photo migration is additive and preserves all existing task data", taskMigration.includes("ADD COLUMN IF NOT EXISTS") && taskMigration.includes("task_attachments_task_category_idx") && !/^\s*(?:UPDATE|DELETE\s+FROM|TRUNCATE|DROP)\b/im.test(taskMigration));
check("task manager and employee photos share the existing attachment table but remain categorized", taskSchema.includes('category: varchar("category"') && taskHandler.includes('"manager_photo"') && taskHandler.includes('"employee_photo"'));
check("task create and edit keep task identity and photo metadata transactional", api.includes("const saved = await db.transaction(async (tx) =>") && api.includes("requestedManagerPhotos") && api.includes("const row = await db.transaction(async (tx) =>"));
check("task completion accepts optional uploads and records employee and notes without requiring optional columns", taskHandler.includes('parts[3] === "complete"') && taskHandler.includes("completionNotes") && taskHandler.includes("completionUpdate.completedBy = auth.id") && taskHandler.includes("taskStorageShape"));
check("task image metadata rejects database-embedded data URLs", taskPhotoParser.includes("/api\\/media") && !taskPhotoParser.includes("data:"));
check("manager task editing exposes separated manager and employee galleries", taskAdmin.includes("صور وتوضيحات من المدير") && taskAdmin.includes("صور إنجاز الموظف") && taskAdmin.includes("TaskEditDialog"));
check("staff task completion keeps photos optional and uses the completion route", taskPortal.includes("صور إنجاز المهمة (اختياري)") && taskPortal.includes("تأكيد الإنجاز") && taskPortal.includes("/complete"));
check("task photo uploader uses optimized storage and retains each successful upload", taskPhotos.includes('folder: "uploads/tasks"') && taskPhotos.includes("onChange(next)") && taskPhotos.includes("failures.push"));
check("task employee selector loads active staff with search, multi-select and exact empty state", taskHandler.includes("eq(staffTable.isActive, true)") && taskAdmin.includes("تحديد الكل") && taskAdmin.includes("ابحث باسم الموظف") && taskAdmin.includes("لا يوجد موظفون نشطون."));
check("task employee selector tolerates legacy optional task and staff columns", taskHandler.includes('storageShape.taskColumns.has("task_no")') && taskHandler.includes('storageShape.staffColumns.has("job_title")') && taskHandler.includes('storageShape.tables.has("task_checklist_items")'));
check("task list load errors are structured and never silently become an empty staff list", taskHandler.includes("[INTERNAL_TASKS_LOAD_FAILED]") && taskHandler.includes('code: "DATABASE_ERROR"') && taskHandler.includes("تعذر تحميل المهام أو الموظفين النشطين.") && taskAdmin.includes("إعادة المحاولة"));
check("related task progress reads only legacy-safe status fields", relatedTaskProgress.includes("columns: {") && relatedTaskProgress.includes("status: true") && relatedTaskProgress.includes("archivedAt: true"));
check("task checklist and related-progress failures return a scoped request ID", taskHandler.includes("[INTERNAL_TASKS_AGGREGATION_FAILED]") && taskHandler.includes("تعذر تحميل تفاصيل المهام الداخلية."));
check("task workflow supports accept, start, manager review and reopen", taskHandler.includes('"accepted"') && taskHandler.includes('statusAction === "accept"') && taskHandler.includes('statusAction === "start"') && taskHandler.includes('"reopen"') && taskAdmin.includes("إعادة فتح المهمة"));
check("task assignment and manager decisions use staff notifications", taskHandler.includes('audienceType: "staff"') && taskHandler.includes('type: "task_assigned"') && taskHandler.includes('"task_approved"'));
check("task employee uploads support videos and documents with progress through existing resumable storage", taskUploads.includes("uploadTaskFile") && taskUploads.includes("MAX_TASK_FILE_UPLOAD_BYTES") && taskPhotos.includes("TaskFilePicker") && taskPhotos.includes("uploadProgressLabel"));
check("task execution files are categorized separately and one failed file keeps earlier successful uploads", taskHandler.includes('"employee_video"') && taskHandler.includes('"employee_document"') && taskPhotos.includes("onChange(next)") && taskPhotos.includes("failures.push"));
check("employees only receive their own uploaded task media", taskHandler.includes("canManageAll || Number(photo.uploadedBy) === auth.id") && taskHandler.includes("canManageAll || attachment.staffId === auth.id"));
check("staff workspace reads stable task columns instead of optional task wildcard fields", staffWorkspaceHandler.includes("columns: {\n            id: true") && !staffWorkspaceHandler.slice(staffWorkspaceHandler.indexOf('resource === "dashboard"'), staffWorkspaceHandler.indexOf('resource === "notifications"')).includes("location: true"));
check("staff workspace distinguishes missing mapping and missing portal permission", staffWorkspaceHandler.includes("حساب المستخدم غير مرتبط بموظف") && staffWorkspaceHandler.includes("لا توجد صلاحية للوصول إلى بوابة الموظفين"));
check("staff workspace failures include request IDs and safe server diagnostics", staffWorkspaceHandler.includes("[STAFF_PORTAL_WORKSPACE_LOAD_FAILED]") && staffWorkspaceHandler.includes('code: "DATABASE_ERROR"') && taskPortal.includes("Request ID:") && taskPortal.includes("إعادة المحاولة"));
check("staff task empty state appears only after a successful workspace response", taskPortal.includes('tab === "tasks" && dashboard.isSuccess') && taskPortal.includes("لا توجد مهام معينة لك الآن"));
check("kosha pricing edit preserves unchanged legacy booking fields", api.includes("preserveUnchangedLegacyValue") && api.includes("delete patch.koshaId") && koshaAdmin.includes("حالة قديمة — محفوظة كما هي") && koshaAdmin.includes("koshaId: Number(form.koshaId) > 0"));

if (failures) process.exitCode = 1;
else console.log("AJN read-only save/API/legacy contracts passed.");
