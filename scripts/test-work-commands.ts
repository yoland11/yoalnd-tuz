import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  allowedActions,
  extractWorkOrderFields,
  isDueSoon,
  isOverdue,
  subtaskProgress,
  transitionProblem,
  workDepartment,
  workOrderStatus,
} from "../src/lib/work-commands";

// ── 1. Pure rules ────────────────────────────────────────────────────────────
{
  assert.equal(workDepartment("المونتاج"), "editing");
  assert.equal(workDepartment("kosha"), "koshas");
  assert.equal(workDepartment("sales"), "general", "unknown departments fall back to general");

  assert.equal(workOrderStatus({ status: "new" }), "new");
  assert.equal(workOrderStatus({ status: "in_progress", rejectionReason: "اللون خطأ" }), "needs_rework");
  assert.equal(workOrderStatus({ status: "completed", approvedBy: 1 }), "approved");
  assert.equal(workOrderStatus({ status: "completed", approvedBy: null }), "done");

  const assignee = { isAssignee: true, canManage: false, hasPendingExtension: false };
  assert.deepEqual(allowedActions({ ...assignee, status: "new" }), ["acknowledge", "help", "request_extension"]);
  assert.deepEqual(allowedActions({ ...assignee, status: "accepted" }), ["start", "complete", "help", "request_extension"]);
  assert.match(String(transitionProblem("start", { ...assignee, status: "new" })), /استلم الأمر أولاً/);
  assert.match(String(transitionProblem("approve", { ...assignee, status: "review" })), /للإدارة فقط/);
  assert.match(String(transitionProblem("acknowledge", { status: "new", isAssignee: false, canManage: true, hasPendingExtension: false })), /للموظف المسؤول/);
  assert.equal(transitionProblem("approve", { status: "review", isAssignee: false, canManage: true, hasPendingExtension: false }), null);
  assert.ok(!allowedActions({ status: "completed", isAssignee: true, canManage: true, hasPendingExtension: false }).includes("complete"), "a completed order cannot complete twice");
  assert.ok(allowedActions({ status: "in_progress", isAssignee: false, canManage: true, hasPendingExtension: true }).includes("decide_extension"));
  assert.ok(!allowedActions({ status: "in_progress", isAssignee: true, canManage: false, hasPendingExtension: true }).includes("request_extension"), "one pending extension at a time");

  assert.deepEqual(subtaskProgress([{ status: "completed", mandatory: true }, { status: "in_progress", mandatory: true }, { status: "new", mandatory: false }, { status: "cancelled", mandatory: true }]), { total: 2, completed: 1, percent: 50, blocking: 1 });
  assert.equal(subtaskProgress([]).blocking, 0);

  const now = new Date("2026-10-18T09:00:00Z");
  assert.equal(isOverdue({ status: "in_progress", dueAt: "2026-10-18T08:00:00Z" }, now), true);
  assert.equal(isOverdue({ status: "review", dueAt: "2026-10-18T08:00:00Z" }, now), false, "submitted work is no longer late");
  assert.equal(isDueSoon({ status: "accepted", dueAt: "2026-10-18T10:30:00Z" }, now), true);

  const staff = [{ id: 7, name: "علي حسن" }, { id: 8, name: "زينب كريم" }];
  const local = new Date(2026, 9, 18, 9, 0, 0);
  const spoken = extractWorkOrderFields("أريد علي يخلص مونتاج حجز 120 باچر الساعة 5", staff, local);
  assert.deepEqual(spoken.assigneeIds, [7]);
  assert.equal(spoken.bookingId, 120);
  assert.equal(spoken.templateKey, "editing");
  assert.equal(spoken.title, "مونتاج حجز 120", "the employee's name is never the title");
  const due = new Date(spoken.dueAt!);
  assert.deepEqual([due.getDate(), due.getHours()], [19, 17], "«باچر الساعة 5» → tomorrow 17:00");
  const unknown = extractWorkOrderFields("نحتاج طباعة دعوات", staff, local);
  assert.deepEqual(unknown.assigneeIds, []);
  assert.ok(unknown.notes.some((note) => note.includes("اختره يدوياً")), "an unknown employee is flagged, never guessed");
  assert.equal(unknown.templateKey, "printing");
  console.log("PASS  work order rules: departments, statuses, transitions, subtasks, deadlines, text extraction");
}

// ── 2. Server module against a SQL-level mock ───────────────────────────────
const dialect = new PgDialect();
type Order = {
  id: number; title: string; status: string; assigned: number[]; createdBy: number; dueAt: Date | null; rejection: string | null; approvedBy: number | null;
  channelId: number | null; parentId: number | null; mandatory: boolean; requiresApproval: boolean; evidenceRequired: boolean; pendingDueAt: Date | null;
};
type Statement = { sql: string; params: unknown[] };

const FORBIDDEN = /\b(stock_movements|warehouse_stock|financial_transactions|cash_box\w*|payments|sales_invoices|purchase_invoices|inventory\w*|journal\w*|ledger\w*|stock_reservations)\b/i;

function harness(options: { ready?: boolean; orders?: Order[]; idempotent?: number | null; sourceActive?: number | null; evidence?: number; notified?: boolean; lockedStatus?: string } = {}) {
  const statements: Statement[] = [];
  const orders = new Map((options.orders ?? []).map((order) => [order.id, { ...order }]));
  let nextId = 500;
  const channels: Record<number, any> = {
    1: { id: 1, title: "المونتاج", department: "editing", entity_type: "work_department", entity_id: null, participant_staff_ids: [], created_by: 1 },
    2: { id: 2, title: "التصوير", department: "photography", entity_type: "work_department", entity_id: null, participant_staff_ids: [], created_by: 1 },
    3: { id: 3, title: "فريق الحفل", department: "koshas", entity_type: "work_channel", entity_id: null, participant_staff_ids: [9], created_by: 1 },
  };
  const orderRow = (order: Order) => ({
    id: order.id, task_no: `TSK-${String(order.id).padStart(6, "0")}`, title: order.title, description: null, status: order.status, priority: "high", department: "editing",
    task_type: "editing", due_at: order.dueAt, assigned_staff_ids: order.assigned, related_type: "kosha_booking", related_id: 120, notes: null, created_by: order.createdBy,
    created_at: new Date(), updated_at: new Date(), completed_at: null, approved_by: order.approvedBy, approved_at: null, rejection_reason: order.rejection, submitted_at: null,
    channel_id: order.channelId, parent_task_id: order.parentId, mandatory: order.mandatory, template_key: "editing", requires_approval: order.requiresApproval, evidence_required: order.evidenceRequired,
    customer_id: null, customer_name: "أحمد", product_id: null, source_type: null, source_id: null,
    pending_due_at: order.pendingDueAt, pending_due_reason: order.pendingDueAt ? "ضغط عمل" : null, pending_due_by: order.pendingDueAt ? 7 : null, pending_due_requested_at: null,
    assignee_names: "علي حسن", created_by_name: "المدير", product_name: null,
  });
  const execute = async (query: any) => {
    const built = dialect.sqlToQuery(query);
    const q = built.sql.replace(/\s+/g, " ").trim();
    const params = built.params;
    statements.push({ sql: q, params });
    const rows = (value: any[]) => ({ rows: value });
    if (q.includes("information_schema.tables")) return rows([{ ready: options.ready !== false }]);
    if (q.startsWith("SELECT * FROM internal_channels WHERE id =")) return rows(channels[Number(params[0])] ? [channels[Number(params[0])]] : []);
    if (q.startsWith("SELECT id, COALESCE(NULLIF(full_name, ''), username) AS name FROM staff WHERE id IN"))
      return rows(params.filter((id) => Number(id) !== 404).map((id) => ({ id, name: `موظف ${id}` })));
    if (q.startsWith("SELECT task_id FROM work_orders WHERE idempotency_key")) return rows(options.idempotent ? [{ task_id: options.idempotent }] : []);
    if (q.startsWith("SELECT w.task_id FROM work_orders w JOIN tasks t ON t.id = w.task_id WHERE w.source_type")) return rows(options.sourceActive ? [{ task_id: options.sourceActive }] : []);
    if (q.startsWith("INSERT INTO tasks")) {
      const id = ++nextId;
      orders.set(id, { id, title: String(params[0]), status: "new", assigned: JSON.parse(String(params.find((value) => typeof value === "string" && value.startsWith("[")) ?? "[]")), createdBy: 1, dueAt: null, rejection: null, approvedBy: null, channelId: 1, parentId: null, mandatory: true, requiresApproval: false, evidenceRequired: false, pendingDueAt: null });
      return rows([{ id }]);
    }
    if (q.startsWith("INSERT INTO work_orders")) {
      const taskId = Number(params[0]);
      const order = orders.get(taskId)!;
      if (q.includes("parent_task_id, mandatory")) {
        order.parentId = Number(params[2]);
        order.mandatory = params[3] === true;
      } else {
        order.requiresApproval = params[3] === true;
        order.evidenceRequired = params[4] === true;
      }
      return rows([]);
    }
    if (q.includes(" FROM tasks t JOIN work_orders w ON w.task_id = t.id")) {
      if (q.includes("WHERE t.id = $1 AND t.archived_at IS NULL")) return rows(orders.has(Number(params[0])) ? [orderRow(orders.get(Number(params[0]))!)] : []);
      if (q.includes("WHERE t.id IN (")) return rows(params.map((id) => orders.get(Number(id))).filter(Boolean).map((order) => orderRow(order!)));
      if (q.includes("WHERE w.parent_task_id = $1")) return rows([...orders.values()].filter((order) => order.parentId === Number(params[0])).map(orderRow));
      if (q.includes("t.due_at < now() + interval '2 hours'")) return rows([...orders.values()].filter((order) => ["new", "accepted", "in_progress"].includes(order.status)).map(orderRow));
      return rows([]);
    }
    if (q.startsWith("SELECT status FROM tasks WHERE id = $1 FOR UPDATE")) return rows([{ status: options.lockedStatus ?? orders.get(Number(params[0]))?.status }]);
    if (q.startsWith("SELECT requires_approval, evidence_required FROM work_orders WHERE task_id")) {
      const order = orders.get(Number(params[0]));
      return rows(order ? [{ requires_approval: order.requiresApproval, evidence_required: order.evidenceRequired }] : []);
    }
    if (q.startsWith("SELECT t.status, w.mandatory FROM work_orders w JOIN tasks t"))
      return rows([...orders.values()].filter((order) => order.parentId === Number(params[0])).map((order) => ({ status: order.status, mandatory: order.mandatory })));
    if (q.startsWith("SELECT COUNT(*)::int AS count FROM task_attachments")) return rows([{ count: options.evidence ?? 0 }]);
    if (q.startsWith("UPDATE tasks SET status =")) {
      const order = orders.get(Number(params[params.length - 1]))!;
      order.status = /^UPDATE tasks SET status = '(\w+)'/.exec(q)?.[1] ?? String(params[0]);
      if (q.includes("rejection_reason = $1")) order.rejection = String(params[0]);
      if (q.includes("rejection_reason = NULL")) order.rejection = null;
      if (q.includes("approved_by = $1")) order.approvedBy = Number(params[0]);
      return rows([]);
    }
    if (q.startsWith("SELECT assigned_staff_ids, created_by, title FROM tasks WHERE id")) {
      const order = orders.get(Number(params[0]))!;
      return rows([{ assigned_staff_ids: order.assigned, created_by: order.createdBy, title: order.title }]);
    }
    if (q.startsWith("SELECT 1 FROM notifications")) return rows(options.notified ? [{ "?column?": 1 }] : []);
    if (q.startsWith("SELECT * FROM internal_messages WHERE channel_id = $1 AND client_key")) return rows([{ id: 77, channel_id: 1, sender_id: 7, sender_name: "علي", body: "سابق", message_type: "text", attachments: [], created_at: new Date() }]);
    if (q.startsWith("INSERT INTO internal_messages") && q.includes("RETURNING *")) return rows([{ id: 78, channel_id: params[0], sender_id: params[1], sender_name: params[2], body: params[3], message_type: params[6], attachments: [], created_at: new Date() }]);
    if (/^(INSERT INTO (internal_messages|entity_timeline|task_checklist_items|task_comments|internal_channel_reads)|UPDATE (tasks|internal_channels|work_orders) SET)/.test(q)) return rows([]);
    throw new Error(`Unexpected SQL in work commands test: ${q}`);
  };
  const db = { execute, transaction: async <T,>(work: (tx: any) => Promise<T>) => work({ execute }) };
  return { db, statements, orders };
}

const manager = { id: 1, name: "المدير", role: "admin", department: "general", permissions: [] as string[] };
const editor = { id: 7, name: "علي حسن", role: "employee", department: "editing", permissions: ["tasks"] };
const photographer = { id: 8, name: "زينب", role: "employee", department: "photography", permissions: ["tasks"] };
const baseOrder = (overrides: Partial<Order> = {}): Order => ({
  id: 40, title: "مونتاج حفلة", status: "accepted", assigned: [7], createdBy: 1, dueAt: new Date(Date.now() + 3_600_000), rejection: null, approvedBy: null,
  channelId: 1, parentId: null, mandatory: true, requiresApproval: false, evidenceRequired: false, pendingDueAt: null, ...overrides,
});
const helpers = () => {
  const notices: any[] = [];
  const media: Array<{ taskId: number; category: string; count: number }> = [];
  return {
    notices,
    media,
    notify: async (notice: any) => { notices.push(notice); },
    insertMedia: async (_tx: any, taskId: number, items: unknown[], category: string) => { media.push({ taskId, category, count: items.length }); },
  };
};
async function rejects(promise: Promise<unknown>, status: number, pattern: RegExp) {
  await assert.rejects(promise, (error: any) => {
    assert.equal(error?.name, "WorkCommandError");
    assert.equal(error.status, status, error.message);
    assert.match(error.message, pattern);
    return true;
  });
}

async function run() {
  // Readiness is checked before anything else (module caches only a positive result).
  const server = await import("../src/server/work-commands");
  await rejects(server.listChannels(harness({ ready: false }).db as any, manager), 503, /0126_work_command_center/);
  assert.deepEqual(await server.workOrderCompletionPolicy(harness({ ready: false }).db as any, 40, 0), { isWorkOrder: false }, "existing task routes are untouched before the migration");

  // Channel access: department, general and membership.
  const channel = (department: string, entityType = "work_department", participants: number[] = []) => ({ id: 1, title: "x", department, entityType, entityId: null, participantStaffIds: participants, createdBy: 1 });
  assert.equal(server.canAccessChannel(channel("editing"), editor), true);
  assert.equal(server.canAccessChannel(channel("photography"), editor), false, "another department's channel is private");
  assert.equal(server.canAccessChannel(channel("general"), editor), true);
  assert.equal(server.canAccessChannel(channel("koshas", "work_channel", [7]), editor), true, "members see their channels");
  assert.equal(server.canAccessChannel(channel("photography"), manager), true);

  // Creating an order: one task row per order/subtask, settings row, card, timeline; no financial/inventory writes.
  {
    const h = harness();
    const tools = helpers();
    const created = await server.createWorkOrder(h.db as any, manager, {
      channelId: 1, title: "مونتاج حفلة أحمد", templateKey: "editing", assigneeIds: [7], participantIds: [8], dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      booking: { type: "kosha_booking", id: 120 }, customerName: "أحمد", idempotencyKey: "key-1",
      attachments: [{ url: "https://cdn.example.com/brief.jpg", mediaType: "image/jpeg" }],
      subtasks: [{ title: "تلوين", assigneeId: 8, mandatory: true }],
    }, tools);
    assert.equal(created.existing, false);
    assert.equal(created.subtasks.length, 1);
    assert.equal(created.subtasks[0].parentId, created.order.id);
    const inserts = h.statements.filter((statement) => statement.sql.startsWith("INSERT INTO tasks"));
    assert.equal(inserts.length, 2, "parent + one subtask, both in the existing tasks table");
    assert.ok(inserts.every((statement) => statement.params.includes("editing")), "task_type stays in the existing vocabulary");
    assert.ok(h.statements.some((statement) => statement.sql.startsWith("INSERT INTO internal_messages") && statement.sql.includes("'work_order'")), "order card posted to the channel");
    assert.equal(h.statements.filter((statement) => statement.sql.startsWith("INSERT INTO task_checklist_items")).length, 4, "editing template checklist");
    assert.ok(h.statements.some((statement) => statement.sql.startsWith("INSERT INTO entity_timeline")));
    assert.deepEqual(tools.media, [{ taskId: created.order.id, category: "manager_photo", count: 1 }]);
    assert.deepEqual(tools.notices.map((notice) => [notice.staffId, notice.type]), [[7, "work_task_assigned"], [8, "work_task_assigned"], [8, "work_task_participant"]]);
    assert.ok(tools.notices.every((notice) => notice.href.startsWith("/staff?tab=work&order=")));
    for (const statement of h.statements) assert.doesNotMatch(statement.sql, FORBIDDEN, `work orders never touch finance or stock: ${statement.sql.slice(0, 90)}`);
  }
  // Retries and duplicates return the original order without writing.
  {
    const h = harness({ idempotent: 40, orders: [baseOrder()] });
    const replay = await server.createWorkOrder(h.db as any, manager, { channelId: 1, title: "مونتاج حفلة", assigneeIds: [7], idempotencyKey: "key-1" }, helpers());
    assert.equal(replay.existing, true);
    assert.ok(!h.statements.some((statement) => /^(INSERT|UPDATE)/.test(statement.sql)), "a retried create writes nothing");
    const linked = harness({ sourceActive: 40, orders: [baseOrder()] });
    const again = await server.createWorkOrder(linked.db as any, manager, { channelId: 1, title: "طباعة", assigneeIds: [7], source: { type: "print_job", id: 3 } }, helpers());
    assert.equal(again.order.id, 40, "a print job keeps one active order");
  }
  await rejects(server.createWorkOrder(harness().db as any, editor, { channelId: 1, title: "أمر", assigneeIds: [8] }, helpers()), 403, /صلاحية/);
  await rejects(server.createWorkOrder(harness().db as any, manager, { channelId: 1, title: "أمر", assigneeIds: [404] }, helpers()), 422, /غير نشط/);
  await rejects(server.createWorkOrder(harness().db as any, manager, { channelId: 1, title: "أمر", assigneeIds: [] }, helpers()), 422, /الموظف المسؤول/);
  await rejects(server.createWorkOrder(harness().db as any, manager, { channelId: 1, title: "أمر", assigneeIds: [7], attachments: [{ url: "data:image/png;base64,AAAA", mediaType: "image/png" }] }, helpers()), 422, /ملفاً مرفوعاً/);

  // Transitions.
  {
    const h = harness({ orders: [baseOrder({ status: "new" })] });
    const tools = helpers();
    const result = await server.workOrderAction(h.db as any, editor, 40, { action: "acknowledge" }, tools);
    assert.equal(result.order.taskStatus, "accepted");
    assert.ok(h.statements.some((statement) => statement.sql.includes("'system'")), "status note in the conversation");
    assert.deepEqual(tools.notices.map((notice) => notice.type), ["work_task_acknowledged"]);
  }
  await rejects(server.workOrderAction(harness({ orders: [baseOrder({ status: "new" })] }).db as any, editor, 40, { action: "start" }, helpers()), 409, /استلم الأمر أولاً/);
  await rejects(server.workOrderAction(harness({ orders: [baseOrder({ status: "review" })] }).db as any, editor, 40, { action: "approve" }, helpers()), 409, /للإدارة فقط/);
  await rejects(server.workOrderAction(harness({ orders: [baseOrder({ assigned: [7] })] }).db as any, photographer, 40, { action: "complete" }, helpers()), 403, /صلاحية/);
  await rejects(server.workOrderAction(harness({ orders: [baseOrder()], lockedStatus: "completed" }).db as any, editor, 40, { action: "complete" }, helpers()), 409, /تغيرت حالة الأمر/);
  {
    // Mandatory subtasks block the parent.
    const h = harness({ orders: [baseOrder(), baseOrder({ id: 41, title: "تلوين", status: "in_progress", parentId: 40, assigned: [8] })] });
    await rejects(server.workOrderAction(h.db as any, editor, 40, { action: "complete" }, helpers()), 422, /المهام الفرعية الإلزامية \(1 متبقية\)/);
  }
  await rejects(server.workOrderAction(harness({ orders: [baseOrder({ evidenceRequired: true })] }).db as any, editor, 40, { action: "complete" }, helpers()), 422, /دليل إنجاز/);
  {
    const h = harness({ orders: [baseOrder({ evidenceRequired: true, requiresApproval: false })] });
    const tools = helpers();
    const done = await server.workOrderAction(h.db as any, editor, 40, { action: "complete", notes: "تم التصدير", evidence: [{ url: "https://drive.example.com/final", mediaType: "link" }] }, tools);
    assert.equal(done.order.taskStatus, "completed", "no approval needed → completed directly");
    assert.deepEqual(tools.media, [{ taskId: 40, category: "employee_document", count: 1 }]);
    for (const statement of h.statements) assert.doesNotMatch(statement.sql, FORBIDDEN, "completion never deducts stock or posts money");
  }
  {
    const h = harness({ orders: [baseOrder({ requiresApproval: true })], evidence: 2 });
    const tools = helpers();
    const sent = await server.workOrderAction(h.db as any, editor, 40, { action: "complete" }, tools);
    assert.equal(sent.order.taskStatus, "review", "approval orders wait for the manager");
    assert.ok(tools.notices.some((notice) => notice.audienceType === "admin" && notice.type === "work_task_review"));
  }
  {
    // Subtask completion notifies the parent when the last mandatory one is done.
    const h = harness({ orders: [baseOrder({ status: "in_progress" }), baseOrder({ id: 41, title: "تلوين", status: "in_progress", parentId: 40, assigned: [8] })] });
    const tools = helpers();
    await server.workOrderAction(h.db as any, photographer, 41, { action: "complete" }, tools);
    assert.ok(tools.notices.some((notice) => notice.type === "work_task_subtasks_done" && notice.entityId === 40));
  }
  await rejects(server.workOrderAction(harness({ orders: [baseOrder({ status: "review" })] }).db as any, manager, 40, { action: "return", reason: "" }, helpers()), 422, /سبب الإرجاع/);
  {
    const h = harness({ orders: [baseOrder({ status: "review" })] });
    const tools = helpers();
    const returned = await server.workOrderAction(h.db as any, manager, 40, { action: "return", reason: "الصوت منخفض" }, tools);
    assert.equal(returned.order.status, "needs_rework");
    assert.ok(h.statements.some((statement) => statement.sql.startsWith("UPDATE tasks SET status = 'in_progress', rejection_reason =") && statement.params.includes("الصوت منخفض")));
    assert.deepEqual(tools.notices.map((notice) => [notice.staffId, notice.type]), [[7, "work_task_returned"]]);
  }
  {
    // Extension: requested by the employee, decided by the manager.
    const h = harness({ orders: [baseOrder()] });
    await rejects(server.workOrderAction(h.db as any, editor, 40, { action: "request_extension", dueAt: new Date(Date.now() - 1000).toISOString(), reason: "ضغط عمل" }, helpers()), 422, /المستقبل/);
    await server.workOrderAction(h.db as any, editor, 40, { action: "request_extension", dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), reason: "ضغط عمل" }, helpers());
    assert.ok(h.statements.some((statement) => statement.sql.startsWith("UPDATE work_orders SET pending_due_at =")));
    assert.ok(!h.statements.some((statement) => statement.sql.startsWith("UPDATE tasks SET due_at")), "the deadline does not move until approved");
    const decided = harness({ orders: [baseOrder({ pendingDueAt: new Date(Date.now() + 2 * 86_400_000) })] });
    const tools = helpers();
    await server.workOrderAction(decided.db as any, manager, 40, { action: "decide_extension", approve: true }, tools);
    assert.ok(decided.statements.some((statement) => statement.sql.startsWith("UPDATE tasks SET due_at =")));
    assert.deepEqual(tools.notices.map((notice) => [notice.staffId, notice.type]), [[7, "work_task_extension_decided"]]);
  }

  // Messages: storage URLs only, client-key replays, department privacy.
  await rejects(server.sendMessage(harness().db as any, editor, { channelId: 1, body: "صورة", attachments: [{ url: "data:image/png;base64,AAAA", mediaType: "image/png" }] }), 422, /ملفاً مرفوعاً/);
  await rejects(server.sendMessage(harness().db as any, editor, { channelId: 2, body: "مرحبا" }), 403, /صلاحية/);
  await rejects(server.sendMessage(harness().db as any, editor, { channelId: 1, body: "  " }), 422, /اكتب رسالة/);
  await rejects(server.sendMessage(harness().db as any, editor, { channelId: 1, voiceUrl: "data:audio/webm;base64,AAAA" }), 503, /الرسالة الصوتية/);
  {
    const replay = await server.sendMessage(harness().db as any, editor, { channelId: 1, body: "مرحبا", clientKey: "c-1" });
    assert.equal(replay.replayed, true);
    assert.equal(replay.message.id, 77);
    const h = harness();
    const sent = await server.sendMessage({ ...h.db, execute: async (query: any) => {
      const q = dialect.sqlToQuery(query).sql.replace(/\s+/g, " ");
      if (q.includes("client_key = $2 LIMIT 1")) return { rows: [] };
      return h.db.execute(query);
    } } as any, editor, { channelId: 1, body: "تم التصدير", clientKey: "c-2" });
    assert.equal(sent.replayed, false);
    assert.ok(h.statements.some((statement) => statement.sql.startsWith("INSERT INTO internal_channel_reads")), "the sender's own message counts as read");
  }

  // Deadline sweep: once per order and recipient; overdue also alerts the managers.
  {
    const h = harness({ orders: [baseOrder({ dueAt: new Date(Date.now() - 600_000) })] });
    const tools = helpers();
    const result = await server.sweepDeadlines(h.db as any, tools.notify, { force: true });
    assert.equal(result.sent, 2);
    assert.deepEqual(tools.notices.map((notice) => [notice.audienceType, notice.type]), [["staff", "work_task_overdue"], ["admin", "work_task_overdue"]]);
    const repeat = helpers();
    const again = await server.sweepDeadlines(harness({ orders: [baseOrder({ dueAt: new Date(Date.now() - 600_000) })], notified: true }).db as any, repeat.notify, { force: true });
    assert.equal(again.sent, 0, "no repeated alerts for the same order");
    const throttled = await server.sweepDeadlines(h.db as any, tools.notify);
    assert.equal(throttled.skipped, true, "request-driven sweeps are throttled");
  }

  // Transcription boundary: nothing is configured, nothing is sent anywhere.
  assert.equal(server.transcriptionProvider(), null);
  assert.equal(server.TRANSCRIPTION_UNAVAILABLE.available, false);
  console.log("PASS  work command server: readiness, access, create, idempotency, transitions, evidence, subtasks, extensions, messages, deadlines");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
