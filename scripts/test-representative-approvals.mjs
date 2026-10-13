/** Administration approves representatives' payments from one queue, with the receipt photo and a notification. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync("src/server/representative.ts", "utf8");
const api = readFileSync("src/server/api.ts", "utf8");
const approvals = readFileSync("src/views/representative/approvals.tsx", "utf8");
const portal = readFileSync("src/views/representative/index.tsx", "utf8");

const queue = server.slice(server.indexOf('parts[1] === "pending"'), server.indexOf('parts[2] === "image"'));
assert.match(queue, /if \(user\.role !== "admin"\) return fail\("اعتماد الدفعات متاح للإدارة فقط", 403\)/, "the queue is administrator-only");
assert.match(queue, /WHERE p\.status IN \('pending', 'processing'\)/, "interrupted approvals stay visible in the queue");
assert.match(queue, /AS "staleProcessing"/);
assert.ok(!/p\.\*|SELECT p\.receipt_image/.test(queue), "the queue never ships receipt photos in bulk");
assert.match(queue, /has_receipt_image/);
const image = server.slice(server.indexOf('parts[2] === "image"'), server.indexOf('parts[2] === "image"') + 500);
assert.match(image, /user\.role !== "admin"/, "receipt photos are administrator-only");
assert.match(server, /deps\.notify\(\{\s*type: "representative_payment_request"/, "a new representative payment notifies the administration");
assert.match(server, /\.catch\(\(cause\) => console\.warn\("representative payment notification failed"/, "a failed notification is logged, not hidden");
assert.match(api, /handleRepresentativePortal\([\s\S]{0,80}\{ notify: \(input\) => createNotification\(input\) \}/, "the API passes the shared notification helper");
assert.match(approvals, /repApi\(`\/payments\/\$\{id\}\/\$\{action\}`/, "approval reuses the existing approve/reject routes");
assert.match(approvals, /onSettled: \(\) => void qc\.invalidateQueries/, "the queue refreshes after a failed decision too");
assert.match(approvals, /قد تكون مكررة/, "likely duplicate requests are flagged before approval");
assert.ok(!/partial/.test(portal.slice(portal.indexOf("function Payments()"), portal.indexOf("function Reports()"))), "a pending request is never labelled as a partial payment");
assert.match(portal, /<RequestStatusBadge value=\{item\.status\} \/>/);
assert.match(server, /if \(resource === "payments" && parts\.length === 1 && req\.method === "POST"\)/, "only POST /payments creates a request");
assert.match(server, /if \(resource === "custody" && parts\.length === 1 && req\.method === "POST"\)/, "only POST /custody creates a handover");
assert.match(portal, /me\.data\?\.role === "admin" \? <PendingApprovals \/> : null/, "the payments page shows the queue to administrators");
assert.match(portal, /usePendingRepPayments\(scope\.kind === "admin" && user\.role === "admin"\)/, "the pending count is only loaded for administrators");
assert.match(portal, /<PendingPaymentsBanner count=\{pendingCount\}/);
console.log("representative approvals: all checks passed");
