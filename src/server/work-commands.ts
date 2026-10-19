import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  ACTIVE_TASK_STATUSES,
  DEFAULT_WORK_CATALOG,
  WORK_ORDER_ACTION_LABELS,
  WORK_ORDER_STATUS_LABELS,
  allowedActions,
  catalogDepartment,
  catalogDepartmentLabel,
  catalogOrderType,
  catalogProblems,
  isDueSoon,
  isOverdue,
  normalizeCatalog,
  subtaskProgress,
  transitionProblem,
  workOrderStatus,
  type WorkCatalog,
  type WorkOrderAction,
} from "@/lib/work-commands";
import { shortBookingNumber } from "@/lib/booking-number";

/**
 * مركز أوامر العمل on top of existing records:
 * - a work order IS a task row (status, assignees, deadline, evidence, approval);
 *   work_orders only stores order settings for that task;
 * - conversations reuse internal_channels / internal_messages;
 * - history goes to entity_timeline, notifications through the caller's notifier.
 * Nothing here writes financial, inventory, booking or print records.
 */

type Executor = Pick<typeof db, "execute">;
type Database = Executor & { transaction: <T>(work: (tx: any) => Promise<T>) => Promise<T> };

export class WorkCommandError extends Error {
  constructor(message: string, public status = 400, public extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "WorkCommandError";
  }
}

export type WorkUser = {
  id: number;
  name: string;
  role: string;
  department: string | null;
  permissions: string[];
};
export type Notice = {
  audienceType?: "admin" | "staff";
  staffId?: number | null;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: number;
  href?: string;
  metadata?: Record<string, unknown>;
};
export type Notifier = (notice: Notice) => Promise<unknown>;
export type MediaInput = { url: string; thumbnailUrl?: string | null; fileName?: string | null; mediaType: string; caption?: string | null };
export type MediaWriter = (tx: any, taskId: number, media: MediaInput[], category: string) => Promise<unknown>;

const rowsOf = (result: any): any[] => result?.rows ?? result ?? [];
const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value == null ? null : String(value));
const idList = (values: number[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);
const MANAGER_ROLES = ["admin", "manager", "main_admin", "super_admin", "main_manager"];

/** Permission granted from the command center to let an employee issue orders. */
export const ISSUE_PERMISSION = "work_orders.issue";

export function workAccess(user: WorkUser, catalog: WorkCatalog = workCatalog()) {
  const role = String(user.role ?? "").toLowerCase();
  const manager = MANAGER_ROLES.includes(role) || user.permissions.includes("staff");
  const has = (permission: string) => user.permissions.includes(permission);
  return {
    manager,
    canCreate: manager || has("task_create") || has("booking_tasks_manage") || has(ISSUE_PERMISSION),
    canApprove: manager || has("task_approve"),
    canCreateChannel: manager,
    canManageCatalog: manager,
    // Same rule as the staff screen's permission editor.
    canGrant: role === "admin" || has("staff"),
    department: catalogDepartment(catalog, user.department),
  };
}

// ─── Catalog: editable order types and departments (settings table) ────────

const CATALOG_SETTING = "workCommandsConfig";
let catalogCache: { value: WorkCatalog; at: number } | null = null;

/** Current catalog; request entry points refresh it first (30-second cache). */
export function workCatalog(): WorkCatalog {
  return catalogCache?.value ?? DEFAULT_WORK_CATALOG;
}

export async function loadWorkCatalog(executor: Executor, options: { fresh?: boolean } = {}) {
  if (!options.fresh && catalogCache && Date.now() - catalogCache.at < 30_000) return catalogCache.value;
  const row = rowsOf(await executor.execute(sql`SELECT value FROM settings WHERE key = ${CATALOG_SETTING}`))[0];
  const value = normalizeCatalog(row?.value);
  catalogCache = { value, at: Date.now() };
  return value;
}

export async function saveWorkCatalog(database: Database, user: WorkUser, input: { departments?: unknown; orderTypes?: unknown }) {
  await requireReady(database);
  if (!workAccess(user).canManageCatalog) throw new WorkCommandError("تعديل الأقسام وأنواع الأوامر للإدارة فقط", 403);
  const problems = catalogProblems(input);
  if (problems.length) throw new WorkCommandError(problems.slice(0, 3).join("، "), 422, { problems });
  const value = normalizeCatalog(input);
  await database.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO settings (key, value, updated_at) VALUES (${CATALOG_SETTING}, ${JSON.stringify(value)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `);
    // A department channel carries its department's name.
    for (const department of value.departments)
      await tx.execute(sql`
        UPDATE internal_channels SET title = ${department.label}
        WHERE entity_type = 'work_department' AND department = ${department.key} AND archived_at IS NULL AND title <> ${department.label}
      `);
  });
  catalogCache = { value, at: Date.now() };
  departmentsSeeded = "";
  return value;
}

let schemaReady = false;
export async function workCommandsReady(executor: Executor = db) {
  if (schemaReady) return true;
  const result = await executor.execute(
    sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'work_orders') AS ready`,
  );
  schemaReady = rowsOf(result)[0]?.ready === true;
  return schemaReady;
}

async function requireReady(executor: Executor) {
  if (!(await workCommandsReady(executor)))
    throw new WorkCommandError("يلزم تطبيق ترقية قاعدة البيانات 0126_work_command_center قبل استخدام مركز أوامر العمل", 503);
  return loadWorkCatalog(executor);
}

// ─── Channels ───────────────────────────────────────────────────────────────

type ChannelRow = { id: number; title: string; department: string; entityType: string | null; entityId: number | null; participantStaffIds: number[]; createdBy: number | null };

function channelFromRow(row: any): ChannelRow {
  return {
    id: Number(row.id),
    title: String(row.title),
    department: String(row.department ?? "general"),
    entityType: row.entity_type ?? null,
    entityId: row.entity_id == null ? null : Number(row.entity_id),
    participantStaffIds: Array.isArray(row.participant_staff_ids) ? row.participant_staff_ids.map(Number) : [],
    createdBy: row.created_by == null ? null : Number(row.created_by),
  };
}

/** Managers see every channel; employees see their department, general, and channels they belong to. */
export function canAccessChannel(channel: ChannelRow, user: WorkUser, catalog: WorkCatalog = workCatalog()) {
  const access = workAccess(user, catalog);
  if (access.manager) return true;
  if (channel.participantStaffIds.includes(user.id) || channel.createdBy === user.id) return true;
  const department = catalogDepartment(catalog, channel.department);
  return department === "general" || department === access.department;
}

/** Active department keys the channels were last seeded for ("" = not yet). */
let departmentsSeeded = "";

/** One channel per active department; created on demand by a manager, never duplicated. */
export async function ensureDepartmentChannels(executor: Executor, user: WorkUser, catalog: WorkCatalog = workCatalog()) {
  const active = catalog.departments.filter((department) => department.active);
  const signature = active.map((department) => department.key).join(",");
  if (departmentsSeeded === signature || !workAccess(user, catalog).manager) return;
  for (const department of active)
    await executor.execute(sql`
      INSERT INTO internal_channels (title, department, entity_type, participant_staff_ids, created_by)
      VALUES (${department.label}, ${department.key}, 'work_department', '[]'::jsonb, ${user.id})
      ON CONFLICT (department) WHERE entity_type = 'work_department' AND archived_at IS NULL DO NOTHING
    `);
  departmentsSeeded = signature;
}

async function loadChannel(executor: Executor, channelId: number) {
  const row = rowsOf(
    await executor.execute(sql`SELECT * FROM internal_channels WHERE id = ${channelId} AND archived_at IS NULL`),
  )[0];
  if (!row) throw new WorkCommandError("المحادثة غير موجودة", 404);
  return channelFromRow(row);
}

export async function requireChannel(executor: Executor, channelId: number, user: WorkUser) {
  const channel = await loadChannel(executor, channelId);
  if (!canAccessChannel(channel, user)) throw new WorkCommandError("لا تملك صلاحية هذه المحادثة", 403);
  return channel;
}

export async function listChannels(executor: Executor, user: WorkUser) {
  const catalog = await requireReady(executor);
  await ensureDepartmentChannels(executor, user, catalog);
  const inactive = new Set(catalog.departments.filter((department) => !department.active).map((department) => department.key));
  const rows = rowsOf(
    await executor.execute(sql`
      SELECT c.*,
        (SELECT COUNT(*) FROM internal_messages m
          WHERE m.channel_id = c.id AND m.id > COALESCE(r.last_read_message_id, 0)
            AND COALESCE(m.sender_id, 0) <> ${user.id})::int AS unread,
        (SELECT COUNT(*) FROM work_orders w JOIN tasks t ON t.id = w.task_id
          WHERE w.channel_id = c.id AND t.archived_at IS NULL AND t.status IN ('new', 'accepted', 'in_progress', 'review'))::int AS pending_orders,
        (SELECT COUNT(DISTINCT m.sender_id) FROM internal_messages m
          WHERE m.channel_id = c.id AND m.created_at > now() - interval '24 hours')::int AS active_employees,
        (SELECT json_build_object('body', m.body, 'type', m.message_type, 'sender', m.sender_name, 'at', m.created_at)
          FROM internal_messages m WHERE m.channel_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message
      FROM internal_channels c
      LEFT JOIN internal_channel_reads r ON r.channel_id = c.id AND r.staff_id = ${user.id}
      WHERE c.archived_at IS NULL
      ORDER BY (c.entity_type = 'work_department') DESC, c.updated_at DESC
      LIMIT 200
    `),
  );
  return rows
    .map((row) => ({ channel: channelFromRow(row), row }))
    // A deactivated department's channel leaves the list; its history stays.
    .filter(({ channel }) => !(channel.entityType === "work_department" && inactive.has(channel.department)))
    .filter(({ channel }) => canAccessChannel(channel, user, catalog))
    .map(({ channel, row }) => ({
      ...channel,
      title: channel.entityType === "work_department" ? catalogDepartmentLabel(catalog, channel.department) : channel.title,
      isDepartment: channel.entityType === "work_department",
      departmentLabel: catalogDepartmentLabel(catalog, channel.department),
      unread: num(row.unread),
      pendingOrders: num(row.pending_orders),
      activeEmployees: num(row.active_employees),
      lastMessage: row.last_message ?? null,
      updatedAt: iso(row.updated_at),
    }));
}

function activeDepartment(catalog: WorkCatalog, value: unknown) {
  const key = String(value ?? "").trim();
  const department = catalog.departments.find((item) => item.key === key);
  if (!department) throw new WorkCommandError("القسم غير موجود", 422);
  if (!department.active) throw new WorkCommandError(`قسم «${department.label}» غير مفعّل`, 422);
  return department.key;
}

export async function createChannel(executor: Executor, user: WorkUser, input: { title: string; department: string; participantStaffIds: number[] }) {
  const catalog = await requireReady(executor);
  if (!workAccess(user, catalog).canCreateChannel) throw new WorkCommandError("إنشاء القنوات متاح للإدارة فقط", 403);
  const title = input.title.trim().slice(0, 180);
  if (title.length < 2) throw new WorkCommandError("اكتب اسم القناة", 422);
  const department = activeDepartment(catalog, input.department || "general");
  const members = [...new Set(input.participantStaffIds)];
  if ((await activeStaff(executor, members)).length !== members.length) throw new WorkCommandError("يتضمن الأعضاء موظفاً غير نشط أو غير موجود", 422);
  const row = rowsOf(
    await executor.execute(sql`
      INSERT INTO internal_channels (title, department, entity_type, participant_staff_ids, created_by)
      VALUES (${title}, ${department}, 'work_channel', ${JSON.stringify(members)}::jsonb, ${user.id})
      RETURNING *
    `),
  )[0];
  return channelFromRow(row);
}

/**
 * Edit a channel. A department channel's name and the staff departments that
 * belong to it live in the catalog; extra members are stored on the channel.
 */
export async function updateChannel(
  database: Database,
  user: WorkUser,
  channelId: number,
  input: { title?: string | null; department?: string | null; participantStaffIds?: number[] | null; aliases?: string[] | null },
) {
  const catalog = await requireReady(database);
  if (!workAccess(user, catalog).canCreateChannel) throw new WorkCommandError("تعديل القنوات متاح للإدارة فقط", 403);
  const channel = await loadChannel(database, channelId);
  const title = input.title == null ? channel.title : String(input.title).trim().slice(0, 180);
  if (title.length < 2) throw new WorkCommandError("اكتب اسم القناة", 422);
  const members = input.participantStaffIds ? [...new Set(input.participantStaffIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))] : channel.participantStaffIds;
  if ((await activeStaff(database, members)).length !== members.length) throw new WorkCommandError("يتضمن الأعضاء موظفاً غير نشط أو غير موجود", 422);
  const isDepartment = channel.entityType === "work_department";
  const department = isDepartment ? channel.department : input.department ? activeDepartment(catalog, input.department) : channel.department;
  if (isDepartment) {
    const next = {
      departments: catalog.departments.map((item) =>
        item.key === channel.department
          ? { ...item, label: title, aliases: input.aliases ? [...new Set(input.aliases.map((alias) => String(alias).trim().slice(0, 60)).filter(Boolean))] : item.aliases }
          : item,
      ),
      orderTypes: catalog.orderTypes,
    };
    if (!catalog.departments.some((item) => item.key === channel.department)) throw new WorkCommandError("قسم هذه القناة غير موجود في الإعدادات", 422);
    await saveWorkCatalog(database, user, next);
  }
  await database.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE internal_channels SET title = ${title}, department = ${department}, participant_staff_ids = ${JSON.stringify(members)}::jsonb, updated_at = now()
      WHERE id = ${channel.id}
    `);
    await systemMessage(tx, channel.id, user, `عدّل ${user.name} إعدادات المحادثة`, null);
  });
  return { ...channel, title, department, participantStaffIds: members };
}

/** Archive a custom channel; messages stay. Department channels follow their department. */
export async function archiveChannel(executor: Executor, user: WorkUser, channelId: number) {
  const catalog = await requireReady(executor);
  if (!workAccess(user, catalog).canCreateChannel) throw new WorkCommandError("أرشفة القنوات متاحة للإدارة فقط", 403);
  const channel = await loadChannel(executor, channelId);
  if (channel.entityType === "work_department")
    throw new WorkCommandError("قناة القسم لا تُؤرشف؛ أوقف القسم من إعدادات الأقسام", 422);
  const open = num(
    rowsOf(
      await executor.execute(sql`
        SELECT COUNT(*)::int AS count FROM work_orders w JOIN tasks t ON t.id = w.task_id
        WHERE w.channel_id = ${channel.id} AND t.archived_at IS NULL AND t.status IN ('new', 'accepted', 'in_progress', 'review')
      `),
    )[0]?.count,
  );
  if (open) throw new WorkCommandError(`لا يمكن أرشفة قناة فيها أوامر مفتوحة (${open})`, 409);
  await executor.execute(sql`UPDATE internal_channels SET archived_at = now(), updated_at = now() WHERE id = ${channel.id} AND archived_at IS NULL`);
  return { id: channel.id, archived: true };
}

// ─── Messages ───────────────────────────────────────────────────────────────

const ATTACHMENT_TYPES = /^(image(\/[a-z0-9.+-]+)?|video\/(mp4|webm|quicktime)|audio\/(webm|ogg|mpeg|mp4|aac|wav)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|vnd\.ms-excel)|text\/plain|link)$/;

/** Stored files only: storage/media URLs (never inline data) or an https link. */
export function cleanAttachments(value: unknown): MediaInput[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 10) throw new WorkCommandError("الحد الأقصى 10 مرفقات في الرسالة", 422);
  return value.map((item) => {
    const source = (item ?? {}) as Record<string, unknown>;
    const url = String(source.url ?? "").trim();
    const mediaType = String(source.mediaType ?? "").trim().toLowerCase();
    if (!/^(https:\/\/|\/api\/media\/)/i.test(url) || url.length > 4_000)
      throw new WorkCommandError("المرفق يجب أن يكون ملفاً مرفوعاً أو رابطاً آمناً", 422);
    if (!ATTACHMENT_TYPES.test(mediaType)) throw new WorkCommandError("نوع المرفق غير مسموح", 422);
    const thumbnail = String(source.thumbnailUrl ?? "").trim();
    return {
      url,
      mediaType,
      thumbnailUrl: /^(https:\/\/|\/api\/media\/)/i.test(thumbnail) ? thumbnail : null,
      fileName: source.fileName ? String(source.fileName).slice(0, 300) : null,
      caption: source.caption ? String(source.caption).slice(0, 500) : null,
    };
  });
}

function messageFromRow(row: any) {
  return {
    id: Number(row.id),
    channelId: Number(row.channel_id),
    senderId: row.sender_id == null ? null : Number(row.sender_id),
    senderName: String(row.sender_name ?? ""),
    senderPhotoUrl: row.sender_photo ?? null,
    body: row.body ?? null,
    type: String(row.message_type ?? "text"),
    voiceUrl: row.voice_url ?? null,
    voiceDuration: row.voice_duration == null ? null : Number(row.voice_duration),
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    replyTo: row.reply_id ? { id: Number(row.reply_id), senderName: String(row.reply_sender ?? ""), body: row.reply_body ?? null } : null,
    taskId: row.task_id == null ? null : Number(row.task_id),
    readBy: num(row.read_by),
    createdAt: iso(row.created_at),
  };
}

export async function listMessages(executor: Executor, user: WorkUser, channelId: number, options: { after?: number; before?: number; limit?: number }) {
  await requireReady(executor);
  await requireChannel(executor, channelId, user);
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 60)));
  const after = Math.max(0, Math.floor(options.after ?? 0));
  const before = Math.max(0, Math.floor(options.before ?? 0));
  const rows = rowsOf(
    await executor.execute(sql`
      SELECT * FROM (
        SELECT m.*, rp.id AS reply_id, rp.sender_name AS reply_sender, rp.body AS reply_body, sp.photo_url AS sender_photo,
          (SELECT COUNT(*) FROM internal_channel_reads r
            WHERE r.channel_id = m.channel_id AND r.last_read_message_id >= m.id AND r.staff_id <> COALESCE(m.sender_id, 0))::int AS read_by
        FROM internal_messages m LEFT JOIN internal_messages rp ON rp.id = m.reply_to_id LEFT JOIN staff sp ON sp.id = m.sender_id
        WHERE m.channel_id = ${channelId}
          AND (${after} = 0 OR m.id > ${after})
          AND (${before} = 0 OR m.id < ${before})
        ORDER BY m.id ${after ? sql`ASC` : sql`DESC`}
        LIMIT ${limit}
      ) page ORDER BY id ASC
    `),
  );
  const messages = rows.map(messageFromRow);
  const taskIds = [...new Set(messages.map((message) => message.taskId).filter((id): id is number => Boolean(id)))];
  const cards = taskIds.length ? await orderSummaries(executor, taskIds) : [];
  return { messages, orders: cards };
}

export async function sendMessage(
  executor: Executor,
  user: WorkUser,
  input: { channelId: number; body?: string | null; attachments?: unknown; replyToId?: number | null; voiceUrl?: string | null; voiceDuration?: number | null; clientKey?: string | null },
) {
  await requireReady(executor);
  const channel = await requireChannel(executor, input.channelId, user);
  const body = String(input.body ?? "").trim().slice(0, 4_000) || null;
  const attachments = cleanAttachments(input.attachments);
  const voiceUrl = input.voiceUrl ? String(input.voiceUrl) : null;
  if (voiceUrl && !/^(https:\/\/|\/api\/media\/)/i.test(voiceUrl))
    throw new WorkCommandError("تعذر حفظ الرسالة الصوتية في التخزين", 503);
  if (!body && !attachments.length && !voiceUrl) throw new WorkCommandError("اكتب رسالة أو أرفق ملفاً أو سجّل صوتاً", 422);
  const clientKey = input.clientKey ? String(input.clientKey).slice(0, 80) : null;
  if (clientKey) {
    const existing = rowsOf(
      await executor.execute(sql`SELECT * FROM internal_messages WHERE channel_id = ${channel.id} AND client_key = ${clientKey} LIMIT 1`),
    )[0];
    if (existing) return { message: messageFromRow(existing), replayed: true };
  }
  if (input.replyToId) {
    const parent = rowsOf(
      await executor.execute(sql`SELECT id FROM internal_messages WHERE id = ${input.replyToId} AND channel_id = ${channel.id}`),
    )[0];
    if (!parent) throw new WorkCommandError("الرسالة المردود عليها غير موجودة في هذه المحادثة", 422);
  }
  const type = voiceUrl ? "voice" : attachments.length && !body ? "attachment" : "text";
  const row = rowsOf(
    await executor.execute(sql`
      INSERT INTO internal_messages (channel_id, sender_id, sender_name, body, voice_url, voice_duration, message_type, attachments, reply_to_id, client_key)
      VALUES (${channel.id}, ${user.id}, ${user.name}, ${body}, ${voiceUrl}, ${input.voiceDuration == null ? null : Math.max(0, Math.round(input.voiceDuration))},
              ${type}, ${JSON.stringify(attachments)}::jsonb, ${input.replyToId ?? null}, ${clientKey})
      ON CONFLICT (channel_id, client_key) WHERE client_key IS NOT NULL DO NOTHING
      RETURNING *
    `),
  )[0];
  if (!row) {
    const existing = rowsOf(
      await executor.execute(sql`SELECT * FROM internal_messages WHERE channel_id = ${channel.id} AND client_key = ${clientKey} LIMIT 1`),
    )[0];
    return { message: messageFromRow(existing), replayed: true };
  }
  await executor.execute(sql`UPDATE internal_channels SET updated_at = now() WHERE id = ${channel.id}`);
  await markRead(executor, user, channel.id, Number(row.id));
  return { message: messageFromRow(row), replayed: false };
}

export async function markRead(executor: Executor, user: WorkUser, channelId: number, lastMessageId: number) {
  await executor.execute(sql`
    INSERT INTO internal_channel_reads (channel_id, staff_id, last_read_message_id, updated_at)
    VALUES (${channelId}, ${user.id}, ${Math.max(0, Math.floor(lastMessageId))}, now())
    ON CONFLICT (channel_id, staff_id) DO UPDATE
    SET last_read_message_id = GREATEST(internal_channel_reads.last_read_message_id, EXCLUDED.last_read_message_id), updated_at = now()
  `);
}

async function systemMessage(executor: Executor, channelId: number | null, user: WorkUser, body: string, taskId: number | null) {
  if (!channelId) return;
  await executor.execute(sql`
    INSERT INTO internal_messages (channel_id, sender_id, sender_name, body, message_type, task_id)
    VALUES (${channelId}, ${user.id}, ${user.name}, ${body}, 'system', ${taskId})
  `);
  await executor.execute(sql`UPDATE internal_channels SET updated_at = now() WHERE id = ${channelId}`);
}

// ─── Work orders ────────────────────────────────────────────────────────────

const ORDER_SELECT = sql`
  SELECT t.id, t.task_no, t.title, t.description, t.status, t.priority, t.department, t.task_type, t.due_at,
         t.assigned_staff_ids, t.related_type, t.related_id, t.notes, t.created_by, t.created_at, t.updated_at,
         t.completed_at, t.approved_by, t.approved_at, t.rejection_reason, t.submitted_at,
         w.channel_id, w.parent_task_id, w.mandatory, w.template_key, w.requires_approval, w.evidence_required,
         w.customer_id, w.customer_name, w.product_id, w.source_type, w.source_id,
         w.pending_due_at, w.pending_due_reason, w.pending_due_by, w.pending_due_requested_at,
         (SELECT string_agg(COALESCE(NULLIF(s.full_name, ''), s.username), '، ' ORDER BY s.id) FROM staff s
           WHERE s.id IN (SELECT jsonb_array_elements_text(t.assigned_staff_ids)::int)) AS assignee_names,
         (SELECT COALESCE(NULLIF(s.full_name, ''), s.username) FROM staff s WHERE s.id = t.created_by) AS created_by_name,
         (SELECT COALESCE(p.name_ar, p.name) FROM products p WHERE p.id = w.product_id) AS product_name
  FROM tasks t JOIN work_orders w ON w.task_id = t.id
`;

function orderFromRow(row: any) {
  const assignedStaffIds: number[] = Array.isArray(row.assigned_staff_ids) ? row.assigned_staff_ids.map(Number) : [];
  const task = { status: String(row.status), rejectionReason: row.rejection_reason ?? null, approvedBy: row.approved_by == null ? null : Number(row.approved_by), dueAt: iso(row.due_at) };
  const status = workOrderStatus(task);
  return {
    id: Number(row.id),
    orderNo: row.task_no ?? `TSK-${String(row.id).padStart(6, "0")}`,
    title: String(row.title),
    description: row.description ?? null,
    taskStatus: task.status,
    status,
    statusLabel: WORK_ORDER_STATUS_LABELS[status],
    priority: String(row.priority ?? "medium"),
    department: catalogDepartment(workCatalog(), row.department),
    departmentLabel: catalogDepartmentLabel(workCatalog(), row.department),
    templateLabel: catalogOrderType(workCatalog(), row.template_key)?.label ?? null,
    dueAt: task.dueAt,
    overdue: isOverdue(task),
    dueSoon: isDueSoon(task),
    assignedStaffIds,
    assigneeNames: row.assignee_names ?? null,
    createdBy: row.created_by == null ? null : Number(row.created_by),
    createdByName: row.created_by_name ?? null,
    createdAt: iso(row.created_at),
    completedAt: iso(row.completed_at),
    approvedAt: iso(row.approved_at),
    returnReason: row.rejection_reason ?? null,
    booking: row.related_type && row.related_id ? { type: String(row.related_type), id: Number(row.related_id) } : null,
    channelId: row.channel_id == null ? null : Number(row.channel_id),
    parentId: row.parent_task_id == null ? null : Number(row.parent_task_id),
    mandatory: row.mandatory !== false,
    templateKey: row.template_key ?? null,
    requiresApproval: row.requires_approval === true,
    evidenceRequired: row.evidence_required === true,
    customer: row.customer_id || row.customer_name ? { id: row.customer_id == null ? null : Number(row.customer_id), name: row.customer_name ?? null } : null,
    product: row.product_id ? { id: Number(row.product_id), name: row.product_name ?? null } : null,
    source: row.source_type && row.source_id ? { type: String(row.source_type), id: Number(row.source_id) } : null,
    pendingExtension: row.pending_due_at
      ? { dueAt: iso(row.pending_due_at), reason: row.pending_due_reason ?? null, requestedBy: row.pending_due_by == null ? null : Number(row.pending_due_by), requestedAt: iso(row.pending_due_requested_at) }
      : null,
  };
}
export type WorkOrder = ReturnType<typeof orderFromRow>;

export async function orderSummaries(executor: Executor, taskIds: number[]) {
  if (!taskIds.length) return [];
  return rowsOf(await executor.execute(sql`${ORDER_SELECT} WHERE t.id IN (${idList(taskIds)})`)).map(orderFromRow);
}

async function loadOrder(executor: Executor, taskId: number) {
  const row = rowsOf(await executor.execute(sql`${ORDER_SELECT} WHERE t.id = ${taskId} AND t.archived_at IS NULL`))[0];
  if (!row) throw new WorkCommandError("أمر العمل غير موجود", 404);
  return orderFromRow(row);
}

/** Employees reach an order they are assigned to, created, or whose channel they can open. */
async function canAccessOrder(executor: Executor, order: WorkOrder, user: WorkUser) {
  if (workAccess(user).manager) return true;
  if (order.assignedStaffIds.includes(user.id) || order.createdBy === user.id) return true;
  if (order.channelId) {
    const channel = await loadChannel(executor, order.channelId).catch(() => null);
    if (channel && canAccessChannel(channel, user)) return true;
  }
  return false;
}

function actionContext(order: WorkOrder, user: WorkUser) {
  return {
    status: order.taskStatus,
    isAssignee: order.assignedStaffIds.includes(user.id),
    canManage: workAccess(user).canApprove || order.createdBy === user.id,
    hasPendingExtension: Boolean(order.pendingExtension),
  };
}

async function timeline(executor: Executor, taskId: number, user: WorkUser, type: string, title: string, body: string | null, metadata: Record<string, unknown> = {}) {
  await executor.execute(sql`
    INSERT INTO entity_timeline (entity_type, entity_id, type, title, body, actor_id, actor_name, metadata)
    VALUES ('task', ${taskId}, ${type}, ${title}, ${body}, ${user.id}, ${user.name}, ${JSON.stringify(metadata)}::jsonb)
  `);
}

async function activeStaff(executor: Executor, ids: number[]) {
  if (!ids.length) return [];
  return rowsOf(
    await executor.execute(sql`SELECT id, COALESCE(NULLIF(full_name, ''), username) AS name FROM staff WHERE id IN (${idList(ids)}) AND is_active = true`),
  ).map((row) => ({ id: Number(row.id), name: String(row.name) }));
}

export type CreateOrderInput = {
  channelId: number | null;
  title: string;
  description?: string | null;
  department?: string | null;
  templateKey?: string | null;
  assigneeIds: number[];
  participantIds?: number[];
  priority?: string | null;
  dueAt?: string | null;
  estimatedMinutes?: number | null;
  attachments?: unknown;
  booking?: { type: "kosha_booking" | "service_order"; id: number } | null;
  customerId?: number | null;
  customerName?: string | null;
  productId?: number | null;
  source?: { type: string; id: number } | null;
  notes?: string | null;
  requiresApproval?: boolean;
  evidenceRequired?: boolean;
  checklist?: string[];
  subtasks?: Array<{ title: string; assigneeId: number; dueAt?: string | null; mandatory?: boolean }>;
  idempotencyKey?: string | null;
  voiceMessageId?: number | null;
};

/** tasks.task_type keeps the existing task vocabulary (see taskType() in api.ts). */
const TEMPLATE_TASK_TYPES: Record<string, string> = {
  editing: "editing", photo_retouch: "photography", printing: "printing", album_design: "design",
  kosha_setup: "koshas", vehicle_loading: "warehouse", delivery: "delivery",
};
const DEPARTMENT_TASK_TYPES: Record<string, string> = {
  editing: "editing", photography: "photography", printing: "printing", koshas: "koshas", warehouse: "warehouse", delivery: "delivery",
};
export function workOrderTaskType(templateKey: string | null | undefined, department: string) {
  // Custom order types and departments fall back to the department's type, then "other".
  return (templateKey && TEMPLATE_TASK_TYPES[templateKey]) || DEPARTMENT_TASK_TYPES[department] || "other";
}

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "").slice(-10);

/**
 * The booking's own customer wins: an order linked to a booking always carries
 * that booking's customer. A chosen customer must own the booking.
 */
export async function resolveOrderCustomer(
  executor: Executor,
  input: { booking?: { type: string; id: number } | null; customerId?: number | null },
) {
  let customer: { id: number; name: string; phone: string } | null = null;
  if (input.customerId) {
    const row = rowsOf(
      await executor.execute(sql`
        SELECT id, COALESCE(NULLIF(full_name, ''), NULLIF(name, ''), phone) AS name, phone FROM customers WHERE id = ${input.customerId}
      `),
    )[0];
    if (!row) throw new WorkCommandError("الزبون غير موجود", 422);
    customer = { id: Number(row.id), name: String(row.name), phone: String(row.phone ?? "") };
  }
  if (!input.booking) return { customerId: customer?.id ?? null, customerName: customer?.name ?? null };
  const booking = rowsOf(
    await executor.execute(
      input.booking.type === "service_order"
        ? sql`SELECT id, customer_id, customer_name, phone FROM service_orders WHERE id = ${input.booking.id} AND archived_at IS NULL`
        : sql`SELECT id, customer_id, customer_name, phone FROM kosha_bookings WHERE id = ${input.booking.id} AND archived_at IS NULL`,
    ),
  )[0];
  if (!booking) throw new WorkCommandError("الحجز غير موجود أو مؤرشف", 422);
  const bookingCustomer = booking.customer_id == null ? null : Number(booking.customer_id);
  if (customer && bookingCustomer && bookingCustomer !== customer.id) throw new WorkCommandError("الحجز المختار لا يخص هذا الزبون", 422);
  if (customer && !bookingCustomer && digits(booking.phone) !== digits(customer.phone)) throw new WorkCommandError("الحجز المختار لا يخص هذا الزبون", 422);
  return { customerId: bookingCustomer ?? customer?.id ?? null, customerName: String(booking.customer_name ?? customer?.name ?? "") || null };
}

const SOURCE_TYPES = new Set(["photography_production_item", "print_job", "graduation_order", "graduation_group", "kosha_booking", "service_order", "product", "asset", "vehicle", "warehouse_transfer"]);
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

function cleanDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function createWorkOrder(
  database: Database,
  user: WorkUser,
  input: CreateOrderInput,
  helpers: { notify: Notifier; insertMedia: MediaWriter },
) {
  const catalog = await requireReady(database);
  const access = workAccess(user, catalog);
  if (!access.canCreate) throw new WorkCommandError("ليس لديك صلاحية إصدار أوامر العمل", 403);
  const title = String(input.title ?? "").trim().slice(0, 500);
  if (title.length < 2) throw new WorkCommandError("اكتب عنوان الأمر", 422);
  const assigneeIds = [...new Set((input.assigneeIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!assigneeIds.length) throw new WorkCommandError("اختر الموظف المسؤول", 422);
  const participantIds = [...new Set((input.participantIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0 && !assigneeIds.includes(id)))];
  const subtasks = (input.subtasks ?? []).filter((item) => String(item?.title ?? "").trim());
  const staffIds = [...new Set([...assigneeIds, ...participantIds, ...subtasks.map((item) => Number(item.assigneeId))])];
  const staff = await activeStaff(database, staffIds);
  if (staff.length !== staffIds.length) throw new WorkCommandError("يتضمن الأمر موظفاً غير نشط أو غير موجود", 422);
  const template = input.templateKey ? catalogOrderType(catalog, input.templateKey) : null;
  if (input.templateKey && !template) throw new WorkCommandError("نوع الأمر غير موجود", 422);
  if (template && !template.active) throw new WorkCommandError(`نوع الأمر «${template.label}» غير مفعّل`, 422);
  const department = activeDepartment(catalog, input.department || template?.department || "general");
  const priority = PRIORITIES.has(String(input.priority)) ? String(input.priority) : template?.priority ?? "medium";
  const dueAt = cleanDate(input.dueAt);
  if (input.dueAt && !dueAt) throw new WorkCommandError("موعد الإنجاز غير صالح", 422);
  const attachments = cleanAttachments(input.attachments);
  const source = input.source && SOURCE_TYPES.has(input.source.type) && Number.isInteger(input.source.id) && input.source.id > 0 ? input.source : null;
  const idempotencyKey = input.idempotencyKey ? String(input.idempotencyKey).slice(0, 120) : null;
  if (input.channelId) await requireChannel(database, input.channelId, user);
  const linkedCustomer = await resolveOrderCustomer(database, { booking: input.booking ?? null, customerId: input.customerId ?? null });

  // A retry or a second click returns the original order.
  if (idempotencyKey) {
    const existing = rowsOf(await database.execute(sql`SELECT task_id FROM work_orders WHERE idempotency_key = ${idempotencyKey}`))[0];
    if (existing) return { order: await loadOrder(database, Number(existing.task_id)), subtasks: [] as WorkOrder[], existing: true };
  }
  // An existing task/production item/print job keeps one active order.
  if (source) {
    const linked = rowsOf(
      await database.execute(sql`
        SELECT w.task_id FROM work_orders w JOIN tasks t ON t.id = w.task_id
        WHERE w.source_type = ${source.type} AND w.source_id = ${source.id} AND w.parent_task_id IS NULL
          AND t.archived_at IS NULL AND t.status NOT IN ('completed', 'cancelled')
        LIMIT 1
      `),
    )[0];
    if (linked) return { order: await loadOrder(database, Number(linked.task_id)), subtasks: [] as WorkOrder[], existing: true };
  }

  const checklist = (input.checklist ?? template?.checklist ?? []).map((item) => String(item).trim()).filter(Boolean).slice(0, 30);
  const requiresApproval = input.requiresApproval ?? template?.requiresApproval ?? false;
  const evidenceRequired = input.evidenceRequired ?? template?.evidenceRequired ?? false;
  const estimated = input.estimatedMinutes ?? template?.estimatedMinutes ?? null;
  const description = [String(input.description ?? "").trim(), participantIds.length ? `المشاركون: ${staff.filter((member) => participantIds.includes(member.id)).map((member) => member.name).join("، ")}` : ""]
    .filter(Boolean)
    .join("\n") || null;

  const created = await database.transaction(async (tx) => {
    const insertTask = async (values: { title: string; description: string | null; assignees: number[]; dueAt: Date | null; notes: string | null }) => {
      const row = rowsOf(
        await tx.execute(sql`
          INSERT INTO tasks (title, description, status, priority, department, task_type, start_at, due_at, estimated_minutes,
                             assigned_staff_ids, related_type, related_id, notes, attachments, created_by)
          VALUES (${values.title}, ${values.description}, 'new', ${priority}, ${department}, ${workOrderTaskType(template?.key, department)}, now(), ${values.dueAt},
                  ${estimated && estimated > 0 ? Math.min(Math.round(estimated), 100_000) : null},
                  ${JSON.stringify(values.assignees)}::jsonb, ${input.booking?.type ?? null}, ${input.booking?.id ?? null},
                  ${values.notes}, '[]'::jsonb, ${user.id})
          RETURNING id
        `),
      )[0];
      const id = Number(row.id);
      await tx.execute(sql`UPDATE tasks SET task_no = ${`TSK-${String(id).padStart(6, "0")}`} WHERE id = ${id}`);
      return id;
    };
    const parentId = await insertTask({ title, description, assignees: assigneeIds, dueAt, notes: input.notes ? String(input.notes).slice(0, 4_000) : null });
    await tx.execute(sql`
      INSERT INTO work_orders (task_id, channel_id, template_key, requires_approval, evidence_required, customer_id, customer_name,
                               product_id, source_type, source_id, idempotency_key, created_by)
      VALUES (${parentId}, ${input.channelId}, ${template?.key ?? null}, ${requiresApproval}, ${evidenceRequired},
              ${linkedCustomer.customerId}, ${linkedCustomer.customerName ? linkedCustomer.customerName.slice(0, 200) : null},
              ${input.productId ?? null}, ${source?.type ?? null}, ${source?.id ?? null}, ${idempotencyKey}, ${user.id})
    `);
    for (const [index, item] of checklist.entries())
      await tx.execute(sql`
        INSERT INTO task_checklist_items (task_id, title, required_quantity, completed_quantity, sort_order)
        VALUES (${parentId}, ${item.slice(0, 300)}, '1', '0', ${index})
      `);
    if (attachments.length) await helpers.insertMedia(tx, parentId, attachments, "manager_photo");
    const childIds: number[] = [];
    for (const item of subtasks) {
      const childId = await insertTask({
        title: String(item.title).trim().slice(0, 500),
        description: `جزء من: ${title}`,
        assignees: [Number(item.assigneeId)],
        dueAt: cleanDate(item.dueAt) ?? dueAt,
        notes: null,
      });
      await tx.execute(sql`
        INSERT INTO work_orders (task_id, channel_id, parent_task_id, mandatory, requires_approval, evidence_required, customer_id, customer_name, product_id, created_by)
        VALUES (${childId}, ${input.channelId}, ${parentId}, ${item.mandatory !== false}, false, false,
                ${linkedCustomer.customerId}, ${linkedCustomer.customerName ? linkedCustomer.customerName.slice(0, 200) : null}, ${input.productId ?? null}, ${user.id})
      `);
      childIds.push(childId);
    }
    for (const id of [parentId, ...childIds])
      await timeline(tx, id, user, "work_order_created", id === parentId ? "تم إصدار أمر العمل" : "تم إسناد مهمة فرعية", title, {
        assigneeIds: id === parentId ? assigneeIds : undefined,
        parentId: id === parentId ? null : parentId,
        source,
        booking: input.booking ?? null,
        voiceMessageId: input.voiceMessageId ?? null,
      });
    if (input.channelId) {
      await tx.execute(sql`
        INSERT INTO internal_messages (channel_id, sender_id, sender_name, body, message_type, task_id)
        VALUES (${input.channelId}, ${user.id}, ${user.name}, ${title}, 'work_order', ${parentId})
      `);
      await tx.execute(sql`UPDATE internal_channels SET updated_at = now() WHERE id = ${input.channelId}`);
    }
    return { parentId, childIds };
  });

  const order = await loadOrder(database, created.parentId);
  const subtaskOrders = await orderSummaries(database, created.childIds);
  for (const staffId of assigneeIds)
    await helpers.notify({ audienceType: "staff", staffId, type: "work_task_assigned", title: "أمر عمل جديد", body: `${order.orderNo} · ${title}`, entityType: "task", entityId: order.id, href: `/staff?tab=work&order=${order.id}` });
  for (const child of subtaskOrders)
    for (const staffId of child.assignedStaffIds)
      await helpers.notify({ audienceType: "staff", staffId, type: "work_task_assigned", title: "مهمة فرعية جديدة", body: `${child.title} · ${title}`, entityType: "task", entityId: child.id, href: `/staff?tab=work&order=${child.id}` });
  for (const staffId of participantIds)
    await helpers.notify({ audienceType: "staff", staffId, type: "work_task_participant", title: "أُضفت كمشارك في أمر عمل", body: `${order.orderNo} · ${title}`, entityType: "task", entityId: order.id, href: `/staff?tab=work&order=${order.id}` });
  return { order, subtasks: subtaskOrders, existing: false };
}

async function employeeEvidenceCount(executor: Executor, taskId: number) {
  return num(
    rowsOf(
      await executor.execute(sql`
        SELECT COUNT(*)::int AS count FROM task_attachments
        WHERE task_id = ${taskId} AND (to_jsonb(task_attachments)->>'category') IN ('employee_photo', 'employee_video', 'employee_document')
      `),
    )[0]?.count,
  );
}

async function openMandatorySubtasks(executor: Executor, taskId: number) {
  const rows = rowsOf(
    await executor.execute(sql`
      SELECT t.status, w.mandatory FROM work_orders w JOIN tasks t ON t.id = w.task_id
      WHERE w.parent_task_id = ${taskId} AND t.archived_at IS NULL
    `),
  );
  return subtaskProgress(rows.map((row) => ({ status: String(row.status), mandatory: row.mandatory !== false }))).blocking;
}

/**
 * Completion policy for any task that is a work order. Used by the command
 * center and by the existing task completion routes so both paths agree.
 */
export async function workOrderCompletionPolicy(executor: Executor, taskId: number, newEvidence: number) {
  if (!(await workCommandsReady(executor))) return { isWorkOrder: false as const };
  const row = rowsOf(
    await executor.execute(sql`SELECT requires_approval, evidence_required FROM work_orders WHERE task_id = ${taskId}`),
  )[0];
  if (!row) return { isWorkOrder: false as const };
  const blocking = await openMandatorySubtasks(executor, taskId);
  if (blocking > 0)
    return { isWorkOrder: true as const, problem: `لا يمكن إنجاز الأمر قبل إكمال المهام الفرعية الإلزامية (${blocking} متبقية)` };
  if (row.evidence_required === true && newEvidence + (await employeeEvidenceCount(executor, taskId)) === 0)
    return { isWorkOrder: true as const, problem: "هذا الأمر يتطلب إرفاق دليل إنجاز (صورة أو ملف أو رابط)" };
  return { isWorkOrder: true as const, problem: null, nextStatus: row.requires_approval === true ? ("review" as const) : ("completed" as const) };
}

/** Status note in the order's conversation for changes made outside the command center. */
export async function workOrderChannelNote(executor: Executor, taskId: number, user: WorkUser, body: string) {
  if (!(await workCommandsReady(executor))) return;
  const row = rowsOf(await executor.execute(sql`SELECT channel_id FROM work_orders WHERE task_id = ${taskId}`))[0];
  if (row?.channel_id) await systemMessage(executor, Number(row.channel_id), user, body, taskId);
}

export async function workOrderDetails(executor: Executor, user: WorkUser, taskId: number) {
  await requireReady(executor);
  const order = await loadOrder(executor, taskId);
  if (!(await canAccessOrder(executor, order, user))) throw new WorkCommandError("لا تملك صلاحية هذا الأمر", 403);
  const [subtaskRows, history, media, comments, checklist, parent] = await Promise.all([
    executor.execute(sql`${ORDER_SELECT} WHERE w.parent_task_id = ${taskId} AND t.archived_at IS NULL ORDER BY t.id`),
    executor.execute(sql`
      SELECT type, title, body, actor_name, metadata, created_at FROM entity_timeline
      WHERE entity_type = 'task' AND entity_id = ${taskId} ORDER BY created_at ASC, id ASC LIMIT 200
    `),
    executor.execute(sql`SELECT to_jsonb(a) AS item FROM task_attachments a WHERE a.task_id = ${taskId} ORDER BY a.id`),
    executor.execute(sql`
      SELECT c.body, c.created_at, COALESCE(NULLIF(s.full_name, ''), s.username) AS name FROM task_comments c
      LEFT JOIN staff s ON s.id = c.staff_id WHERE c.task_id = ${taskId} ORDER BY c.created_at
    `),
    executor.execute(sql`SELECT id, title, required_quantity, completed_quantity FROM task_checklist_items WHERE task_id = ${taskId} ORDER BY sort_order, id`),
    order.parentId ? orderSummaries(executor, [order.parentId]) : Promise.resolve([]),
  ]);
  const subtasks = rowsOf(subtaskRows).map(orderFromRow);
  return {
    order,
    actions: allowedActions(actionContext(order, user)),
    subtasks,
    progress: subtaskProgress(subtasks.map((item) => ({ status: item.taskStatus, mandatory: item.mandatory }))),
    parent: parent[0] ?? null,
    history: rowsOf(history).map((row) => ({ type: String(row.type), title: String(row.title), body: row.body ?? null, actor: row.actor_name ?? null, at: iso(row.created_at), metadata: row.metadata ?? {} })),
    attachments: rowsOf(media).map((row) => {
      const item = row.item ?? {};
      return { url: item.file_url, thumbnailUrl: item.thumbnail_url ?? null, fileName: item.file_name ?? null, mediaType: item.media_type ?? "image", category: item.category ?? "attachment", uploadedBy: item.uploaded_by_name ?? null };
    }),
    comments: rowsOf(comments).map((row) => ({ body: String(row.body), at: iso(row.created_at), name: row.name ?? null })),
    checklist: rowsOf(checklist).map((row) => ({ id: Number(row.id), title: String(row.title), done: num(row.completed_quantity) >= num(row.required_quantity) })),
  };
}

export type ActionInput = {
  action: WorkOrderAction;
  notes?: string | null;
  reason?: string | null;
  evidence?: unknown;
  dueAt?: string | null;
  approve?: boolean;
  assigneeIds?: number[];
};

export async function workOrderAction(
  database: Database,
  user: WorkUser,
  taskId: number,
  input: ActionInput,
  helpers: { notify: Notifier; insertMedia: MediaWriter },
) {
  await requireReady(database);
  const before = await loadOrder(database, taskId);
  if (!(await canAccessOrder(database, before, user))) throw new WorkCommandError("لا تملك صلاحية هذا الأمر", 403);
  const problem = transitionProblem(input.action, actionContext(before, user));
  if (problem) throw new WorkCommandError(problem, 409);
  const reason = String(input.reason ?? "").trim().slice(0, 1_000);
  const notes = String(input.notes ?? "").trim().slice(0, 4_000);
  const notices: Notice[] = [];
  const managerNotice = (type: string, title: string): Notice => ({ audienceType: "admin", type, title, body: `${before.orderNo} · ${before.title}`, entityType: "task", entityId: taskId, href: `/admin/work-commands?order=${taskId}` });
  const toAssignees = (type: string, title: string, body?: string) =>
    before.assignedStaffIds.map((staffId): Notice => ({ audienceType: "staff", staffId, type, title, body: body ?? `${before.orderNo} · ${before.title}`, entityType: "task", entityId: taskId, href: `/staff?tab=work&order=${taskId}` }));
  const toCreator = (type: string, title: string): Notice[] =>
    before.createdBy ? [{ audienceType: "staff", staffId: before.createdBy, type, title, body: `${before.orderNo} · ${before.title}`, entityType: "task", entityId: taskId, href: `/admin/work-commands?order=${taskId}` }] : [];

  await database.transaction(async (tx) => {
    // Lock the task row so two clicks cannot both move the same order.
    const locked = rowsOf(await tx.execute(sql`SELECT status FROM tasks WHERE id = ${taskId} FOR UPDATE`))[0];
    if (!locked || String(locked.status) !== before.taskStatus) throw new WorkCommandError("تغيرت حالة الأمر؛ أعد تحميله", 409);
    switch (input.action) {
      case "acknowledge":
        await tx.execute(sql`UPDATE tasks SET status = 'accepted', updated_at = now() WHERE id = ${taskId}`);
        await timeline(tx, taskId, user, "task_accepted", "تم استلام الأمر", null, { staffId: user.id, acknowledgedAt: new Date().toISOString() });
        await systemMessage(tx, before.channelId, user, `استلم ${user.name} الأمر ${before.orderNo}`, taskId);
        notices.push(...toCreator("work_task_acknowledged", "تم استلام أمر العمل"));
        break;
      case "start":
        await tx.execute(sql`UPDATE tasks SET status = 'in_progress', updated_at = now() WHERE id = ${taskId}`);
        await timeline(tx, taskId, user, "task_work_started", "بدأ العمل", null, { staffId: user.id });
        notices.push(...toCreator("work_task_started", "بدأ العمل على أمر"));
        break;
      case "complete": {
        const evidence = cleanAttachments(input.evidence);
        const policy = await workOrderCompletionPolicy(tx, taskId, evidence.length);
        if (policy.isWorkOrder && policy.problem) throw new WorkCommandError(policy.problem, 422);
        const nextStatus = policy.isWorkOrder ? policy.nextStatus : "review";
        if (evidence.length) {
          const photos = evidence.filter((item) => item.mediaType.startsWith("image"));
          const videos = evidence.filter((item) => item.mediaType.startsWith("video/"));
          const others = evidence.filter((item) => !item.mediaType.startsWith("image") && !item.mediaType.startsWith("video/"));
          if (photos.length) await helpers.insertMedia(tx, taskId, photos, "employee_photo");
          if (videos.length) await helpers.insertMedia(tx, taskId, videos, "employee_video");
          if (others.length) await helpers.insertMedia(tx, taskId, others, "employee_document");
        }
        if (notes) await tx.execute(sql`INSERT INTO task_comments (task_id, staff_id, body) VALUES (${taskId}, ${user.id}, ${`ملاحظات الإنجاز: ${notes}`})`);
        await tx.execute(sql`
          UPDATE tasks SET status = ${nextStatus}, submitted_at = now(), rejection_reason = NULL, updated_at = now(),
            completed_at = ${nextStatus === "completed" ? sql`now()` : sql`completed_at`}
          WHERE id = ${taskId}
        `);
        await timeline(tx, taskId, user, nextStatus === "completed" ? "work_order_completed" : "task_completion_submitted",
          nextStatus === "completed" ? "تم الإنجاز" : "تم الإنجاز — بانتظار الاعتماد", notes || null, { evidenceCount: evidence.length, status: nextStatus });
        await systemMessage(tx, before.channelId, user, `${nextStatus === "completed" ? "أنجز" : "أنهى وأرسل للاعتماد"} ${user.name} الأمر ${before.orderNo}`, taskId);
        if (nextStatus === "review") notices.push(managerNotice("work_task_review", "أمر عمل بانتظار الاعتماد"));
        notices.push(...toCreator("work_task_completed", nextStatus === "completed" ? "تم إنجاز أمر العمل" : "أمر عمل بانتظار اعتمادك"));
        if (before.parentId) {
          const remaining = await openMandatorySubtasks(tx, before.parentId);
          if (remaining === 0 && nextStatus === "completed") {
            const parent = rowsOf(await tx.execute(sql`SELECT assigned_staff_ids, created_by, title FROM tasks WHERE id = ${before.parentId}`))[0];
            for (const staffId of new Set<number>([...(parent?.assigned_staff_ids ?? []).map(Number), Number(parent?.created_by ?? 0)].filter(Boolean)))
              notices.push({ audienceType: "staff", staffId, type: "work_task_subtasks_done", title: "اكتملت كل المهام الفرعية", body: String(parent?.title ?? ""), entityType: "task", entityId: before.parentId, href: `/staff?tab=work&order=${before.parentId}` });
          }
        }
        break;
      }
      case "approve":
        await tx.execute(sql`UPDATE tasks SET status = 'completed', completed_at = now(), approved_by = ${user.id}, approved_at = now(), rejection_reason = NULL, updated_at = now() WHERE id = ${taskId}`);
        await timeline(tx, taskId, user, "task_approved", "تم اعتماد الإنجاز", null, {});
        await systemMessage(tx, before.channelId, user, `اعتمد ${user.name} إنجاز الأمر ${before.orderNo}`, taskId);
        notices.push(...toAssignees("work_task_approved", "تم اعتماد إنجازك"));
        break;
      case "return":
        if (reason.length < 3) throw new WorkCommandError("اكتب سبب الإرجاع للتعديل", 422);
        await tx.execute(sql`UPDATE tasks SET status = 'in_progress', rejection_reason = ${reason}, approved_by = NULL, approved_at = NULL, updated_at = now() WHERE id = ${taskId}`);
        await timeline(tx, taskId, user, "task_returned", "أُرجع الأمر للتعديل", reason, { reason });
        await systemMessage(tx, before.channelId, user, `أرجع ${user.name} الأمر ${before.orderNo} للتعديل: ${reason}`, taskId);
        notices.push(...toAssignees("work_task_returned", "أمر عمل يحتاج تعديل", `${before.orderNo} · ${reason}`));
        break;
      case "cancel":
        if (reason.length < 3) throw new WorkCommandError("اكتب سبب الإلغاء", 422);
        await tx.execute(sql`UPDATE tasks SET status = 'cancelled', rejection_reason = ${reason}, updated_at = now() WHERE id = ${taskId}`);
        await timeline(tx, taskId, user, "task_cancelled", "تم إلغاء الأمر", reason, { reason });
        await systemMessage(tx, before.channelId, user, `ألغى ${user.name} الأمر ${before.orderNo}`, taskId);
        notices.push(...toAssignees("work_task_cancelled", "أُلغي أمر عمل"));
        break;
      case "help":
        if (reason.length < 3) throw new WorkCommandError("اكتب نوع المساعدة المطلوبة", 422);
        await timeline(tx, taskId, user, "work_order_help", "طلب مساعدة", reason, { staffId: user.id });
        await systemMessage(tx, before.channelId, user, `طلب ${user.name} مساعدة في ${before.orderNo}: ${reason}`, taskId);
        notices.push(managerNotice("work_task_help", "طلب مساعدة في أمر عمل"), ...toCreator("work_task_help", "طلب مساعدة في أمر عمل"));
        break;
      case "request_extension": {
        const requested = cleanDate(input.dueAt);
        if (!requested || requested.getTime() <= Date.now()) throw new WorkCommandError("اختر موعداً جديداً في المستقبل", 422);
        if (before.dueAt && requested.getTime() <= new Date(before.dueAt).getTime()) throw new WorkCommandError("الموعد الجديد يجب أن يكون بعد الموعد الحالي", 422);
        if (reason.length < 3) throw new WorkCommandError("اكتب سبب طلب الوقت الإضافي", 422);
        await tx.execute(sql`
          UPDATE work_orders SET pending_due_at = ${requested}, pending_due_reason = ${reason}, pending_due_by = ${user.id}, pending_due_requested_at = now(), updated_at = now()
          WHERE task_id = ${taskId}
        `);
        await timeline(tx, taskId, user, "deadline_extension_requested", "طلب وقت إضافي", reason, { from: before.dueAt, requested: requested.toISOString() });
        notices.push(managerNotice("work_task_extension", "طلب تمديد موعد أمر عمل"), ...toCreator("work_task_extension", "طلب تمديد موعد أمر عمل"));
        break;
      }
      case "decide_extension": {
        const pending = before.pendingExtension!;
        if (input.approve) await tx.execute(sql`UPDATE tasks SET due_at = ${new Date(pending.dueAt!)}, updated_at = now() WHERE id = ${taskId}`);
        await tx.execute(sql`UPDATE work_orders SET pending_due_at = NULL, pending_due_reason = NULL, pending_due_by = NULL, pending_due_requested_at = NULL, updated_at = now() WHERE task_id = ${taskId}`);
        await timeline(tx, taskId, user, input.approve ? "deadline_extension_approved" : "deadline_extension_rejected",
          input.approve ? "تمت الموافقة على التمديد" : "رُفض طلب التمديد", reason || null, { from: before.dueAt, requested: pending.dueAt, approved: Boolean(input.approve) });
        if (pending.requestedBy)
          notices.push({ audienceType: "staff", staffId: pending.requestedBy, type: "work_task_extension_decided", title: input.approve ? "تمت الموافقة على التمديد" : "رُفض طلب التمديد", body: before.orderNo, entityType: "task", entityId: taskId, href: `/staff?tab=work&order=${taskId}` });
        break;
      }
      case "reassign": {
        const ids = [...new Set((input.assigneeIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
        if (!ids.length) throw new WorkCommandError("اختر الموظف المسؤول", 422);
        const staff = await activeStaff(tx, ids);
        if (staff.length !== ids.length) throw new WorkCommandError("يتضمن الإسناد موظفاً غير نشط أو غير موجود", 422);
        await tx.execute(sql`UPDATE tasks SET assigned_staff_ids = ${JSON.stringify(ids)}::jsonb, updated_at = now() WHERE id = ${taskId}`);
        await timeline(tx, taskId, user, "task_reassigned", "تغيير المسؤول", reason || null, { from: before.assignedStaffIds, to: ids });
        for (const staffId of ids.filter((id) => !before.assignedStaffIds.includes(id)))
          notices.push({ audienceType: "staff", staffId, type: "work_task_assigned", title: "أُسند إليك أمر عمل", body: `${before.orderNo} · ${before.title}`, entityType: "task", entityId: taskId, href: `/staff?tab=work&order=${taskId}` });
        break;
      }
    }
  });
  for (const notice of notices) await helpers.notify(notice);
  return { order: await loadOrder(database, taskId), action: input.action, label: WORK_ORDER_ACTION_LABELS[input.action] };
}

// ─── Inbox, dashboard, search ───────────────────────────────────────────────

export async function myOrders(executor: Executor, user: WorkUser) {
  await requireReady(executor);
  const rows = rowsOf(
    await executor.execute(sql`
      ${ORDER_SELECT}
      WHERE t.archived_at IS NULL AND t.assigned_staff_ids @> ${JSON.stringify([user.id])}::jsonb
        AND (t.status <> 'completed' OR t.completed_at > now() - interval '7 days')
        AND t.status <> 'cancelled'
      ORDER BY CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at ASC, t.id DESC
      LIMIT 200
    `),
  );
  const orders = rows.map(orderFromRow);
  return {
    orders: orders.map((order) => ({ ...order, actions: allowedActions(actionContext(order, user)) })),
    counts: {
      new: orders.filter((order) => order.status === "new").length,
      awaitingAcknowledgment: orders.filter((order) => order.taskStatus === "new").length,
      inProgress: orders.filter((order) => ["accepted", "in_progress"].includes(order.status)).length,
      review: orders.filter((order) => order.status === "review").length,
      needsRework: orders.filter((order) => order.status === "needs_rework").length,
      completed: orders.filter((order) => ["done", "approved"].includes(order.status)).length,
      overdue: orders.filter((order) => order.overdue).length,
    },
  };
}

export type DashboardFilters = {
  department?: string | null;
  staffId?: number | null;
  priority?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  bookingId?: number | null;
  customer?: string | null;
  page?: number;
};

export async function dashboard(executor: Executor, user: WorkUser, filters: DashboardFilters) {
  await requireReady(executor);
  if (!workAccess(user).manager && !workAccess(user).canApprove) throw new WorkCommandError("لوحة المتابعة للإدارة فقط", 403);
  const day = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const conditions = [sql`t.archived_at IS NULL`, sql`w.parent_task_id IS NULL`];
  if (filters.department) conditions.push(sql`t.department = ${catalogDepartment(workCatalog(), filters.department)}`);
  if (filters.staffId) conditions.push(sql`t.assigned_staff_ids @> ${JSON.stringify([filters.staffId])}::jsonb`);
  if (filters.priority && PRIORITIES.has(filters.priority)) conditions.push(sql`t.priority = ${filters.priority}`);
  if (day(filters.from)) conditions.push(sql`t.created_at >= ${day(filters.from)}::date`);
  if (day(filters.to)) conditions.push(sql`t.created_at < ${day(filters.to)}::date + 1`);
  if (filters.bookingId) conditions.push(sql`t.related_id = ${filters.bookingId}`);
  if (filters.customer) conditions.push(sql`w.customer_name ILIKE ${`%${filters.customer.replace(/[\\%_]/g, "\\$&")}%`}`);
  const where = sql.join(conditions, sql` AND `);
  const rows = rowsOf(await executor.execute(sql`${ORDER_SELECT} WHERE ${where} ORDER BY t.id DESC LIMIT 1000`));
  let orders = rows.map(orderFromRow);
  const stats = {
    new: orders.filter((order) => order.status === "new").length,
    acknowledged: orders.filter((order) => order.status === "accepted").length,
    inProgress: orders.filter((order) => ["in_progress", "needs_rework"].includes(order.status)).length,
    review: orders.filter((order) => order.status === "review").length,
    completed: orders.filter((order) => ["done", "approved"].includes(order.status)).length,
    overdue: orders.filter((order) => order.overdue).length,
    total: orders.length,
  };
  if (filters.status === "overdue") orders = orders.filter((order) => order.overdue);
  else if (filters.status) orders = orders.filter((order) => order.status === filters.status);
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = 30;
  const now = Date.now();
  return {
    stats,
    total: orders.length,
    page,
    totalPages: Math.max(1, Math.ceil(orders.length / pageSize)),
    orders: orders.slice((page - 1) * pageSize, page * pageSize).map((order) => ({
      ...order,
      delayMinutes:
        order.dueAt && (order.overdue || (order.completedAt && new Date(order.completedAt).getTime() > new Date(order.dueAt).getTime()))
          ? Math.round(((order.completedAt ? new Date(order.completedAt).getTime() : now) - new Date(order.dueAt).getTime()) / 60_000)
          : 0,
    })),
  };
}

export async function search(executor: Executor, user: WorkUser, query: string, page = 1) {
  await requireReady(executor);
  const text = query.trim().slice(0, 120);
  if (text.length < 2) return { messages: [], orders: [] };
  const like = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
  const number = /^\#?(\d{1,9})$/.exec(text.replace(/^TSK-?0*/i, ""))?.[1];
  const offset = (Math.max(1, Math.floor(page)) - 1) * 30;
  const channels = await listChannels(executor, user);
  const channelIds = channels.map((channel) => channel.id);
  const [messageRows, orderRows] = await Promise.all([
    channelIds.length
      ? executor.execute(sql`
          SELECT m.id, m.channel_id, m.sender_name, m.body, m.created_at, m.task_id FROM internal_messages m
          WHERE m.channel_id IN (${idList(channelIds)}) AND (m.body ILIKE ${like} OR m.sender_name ILIKE ${like})
          ORDER BY m.id DESC LIMIT 30 OFFSET ${offset}
        `)
      : Promise.resolve({ rows: [] }),
    executor.execute(sql`
      ${ORDER_SELECT}
      WHERE t.archived_at IS NULL AND (
        t.title ILIKE ${like} OR t.description ILIKE ${like} OR w.customer_name ILIKE ${like} OR t.task_no ILIKE ${like}
        OR EXISTS (SELECT 1 FROM staff s WHERE s.id IN (SELECT jsonb_array_elements_text(t.assigned_staff_ids)::int) AND COALESCE(NULLIF(s.full_name, ''), s.username) ILIKE ${like})
        ${number ? sql`OR t.id = ${Number(number)} OR t.related_id = ${Number(number)}` : sql``}
      )
      ORDER BY t.id DESC LIMIT 30 OFFSET ${offset}
    `),
  ]);
  const channelTitles = new Map(channels.map((channel) => [channel.id, channel.title]));
  const orders = [];
  for (const order of rowsOf(orderRows).map(orderFromRow)) if (await canAccessOrder(executor, order, user)) orders.push(order);
  return {
    messages: rowsOf(messageRows).map((row) => ({
      id: Number(row.id),
      channelId: Number(row.channel_id),
      channelTitle: channelTitles.get(Number(row.channel_id)) ?? "",
      senderName: String(row.sender_name ?? ""),
      body: row.body ?? null,
      taskId: row.task_id == null ? null : Number(row.task_id),
      createdAt: iso(row.created_at),
    })),
    orders,
  };
}

// ─── Team: who may issue orders ─────────────────────────────────────────────

export async function workTeam(executor: Executor, user: WorkUser) {
  const catalog = await requireReady(executor);
  const access = workAccess(user, catalog);
  if (!access.manager && !access.canGrant) throw new WorkCommandError("إدارة الفريق متاحة للإدارة فقط", 403);
  const rows = rowsOf(
    await executor.execute(sql`
      SELECT id, COALESCE(NULLIF(full_name, ''), username) AS name, role, department, job_title, permissions
      FROM staff WHERE is_active = true ORDER BY COALESCE(NULLIF(full_name, ''), username)
    `),
  );
  const members = rows.map((row) => {
    const permissions: string[] = Array.isArray(row.permissions) ? row.permissions.map(String) : [];
    const member = { id: Number(row.id), name: String(row.name), role: String(row.role ?? "employee"), department: row.department ?? null, permissions };
    const memberAccess = workAccess(member, catalog);
    const explicit = permissions.includes(ISSUE_PERMISSION);
    const via = memberAccess.manager
      ? "manager"
      : permissions.includes("task_create")
        ? "task_create"
        : permissions.includes("booking_tasks_manage")
          ? "booking_tasks_manage"
          : explicit
            ? "issue"
            : null;
    return {
      id: member.id,
      name: member.name,
      role: member.role,
      jobTitle: row.job_title ?? null,
      staffDepartment: row.department ?? null,
      department: memberAccess.department,
      departmentLabel: catalogDepartmentLabel(catalog, row.department),
      canIssue: memberAccess.canCreate,
      explicit,
      // Issuing that comes from a role or another permission is changed on the staff screen.
      lockedBy: via && via !== "issue" ? via : null,
    };
  });
  const staffDepartments = [...new Set(rows.map((row) => String(row.department ?? "").trim()).filter(Boolean))].map((value) => ({
    value,
    department: catalogDepartment(catalog, value),
  }));
  return { members, staffDepartments, canGrant: access.canGrant };
}

export async function setIssuePermission(executor: Executor, user: WorkUser, staffId: number, allowed: boolean) {
  const catalog = await requireReady(executor);
  if (!workAccess(user, catalog).canGrant) throw new WorkCommandError("منح الصلاحيات متاح لمن يملك إدارة الموظفين", 403);
  const target = rowsOf(
    await executor.execute(sql`SELECT id, role, is_active, COALESCE(NULLIF(full_name, ''), username) AS name FROM staff WHERE id = ${staffId}`),
  )[0];
  if (!target || target.is_active !== true) throw new WorkCommandError("الموظف غير موجود أو غير نشط", 404);
  if (String(target.role) === "admin") throw new WorkCommandError("حساب المدير العام يملك كل الصلاحيات", 422);
  if (allowed)
    await executor.execute(sql`
      UPDATE staff SET permissions = COALESCE(permissions, '[]'::jsonb) || ${JSON.stringify([ISSUE_PERMISSION])}::jsonb
      WHERE id = ${staffId} AND NOT (COALESCE(permissions, '[]'::jsonb) ? ${ISSUE_PERMISSION})
    `);
  else
    await executor.execute(sql`UPDATE staff SET permissions = COALESCE(permissions, '[]'::jsonb) - ${ISSUE_PERMISSION} WHERE id = ${staffId}`);
  return { staffId, name: String(target.name), allowed };
}

// ─── Customers and their bookings (read-only lookups) ───────────────────────

export async function searchCustomers(executor: Executor, user: WorkUser, query: string) {
  const catalog = await requireReady(executor);
  if (!workAccess(user, catalog).canCreate) throw new WorkCommandError("ليس لديك صلاحية إصدار أوامر العمل", 403);
  const text = query.trim().slice(0, 80);
  if (text.length < 2) return [];
  const like = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
  const phone = text.replace(/\D/g, "");
  const rows = rowsOf(
    await executor.execute(sql`
      SELECT c.id, COALESCE(NULLIF(c.full_name, ''), NULLIF(c.name, ''), c.phone) AS name, c.phone,
        (SELECT COUNT(*) FROM kosha_bookings k WHERE k.archived_at IS NULL AND (k.customer_id = c.id OR (k.customer_id IS NULL AND k.phone = c.phone)))::int
        + (SELECT COUNT(*) FROM service_orders s WHERE s.archived_at IS NULL AND (s.customer_id = c.id OR (s.customer_id IS NULL AND s.phone = c.phone)))::int AS bookings
      FROM customers c
      WHERE c.full_name ILIKE ${like} OR c.name ILIKE ${like} ${phone.length >= 3 ? sql`OR c.phone LIKE ${`%${phone}%`}` : sql``}
      ORDER BY bookings DESC, c.id DESC
      LIMIT 20
    `),
  );
  // Employees see only the last digits of a phone, enough to tell customers apart.
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name), phoneTail: String(row.phone ?? "").slice(-4), bookings: num(row.bookings) }));
}

export async function customerBookings(executor: Executor, user: WorkUser, customerId: number) {
  const catalog = await requireReady(executor);
  if (!workAccess(user, catalog).canCreate) throw new WorkCommandError("ليس لديك صلاحية إصدار أوامر العمل", 403);
  const customer = rowsOf(await executor.execute(sql`SELECT id FROM customers WHERE id = ${customerId}`))[0];
  if (!customer) throw new WorkCommandError("الزبون غير موجود", 404);
  const rows = rowsOf(
    await executor.execute(sql`
      SELECT * FROM (
        SELECT 'kosha_booking' AS type, k.id, k.tracking_code, k.event_date, k.status, COALESCE(NULLIF(k.package_name, ''), 'حجز كوشة') AS title
        FROM kosha_bookings k JOIN customers c ON c.id = ${customerId}
        WHERE k.archived_at IS NULL AND (k.customer_id = c.id OR (k.customer_id IS NULL AND k.phone = c.phone))
        UNION ALL
        SELECT 'service_order' AS type, s.id, s.tracking_code, s.event_date, s.status, COALESCE(sv.name_ar, 'طلب خدمة') AS title
        FROM service_orders s JOIN customers c ON c.id = ${customerId} LEFT JOIN services sv ON sv.id = s.service_id
        WHERE s.archived_at IS NULL AND (s.customer_id = c.id OR (s.customer_id IS NULL AND s.phone = c.phone))
      ) bookings
      ORDER BY event_date DESC NULLS LAST, id DESC
      LIMIT 40
    `),
  );
  return rows.map((row) => {
    const type = String(row.type) as "kosha_booking" | "service_order";
    return {
      type,
      id: Number(row.id),
      number: shortBookingNumber(type === "service_order" ? "service" : "kosha", Number(row.id), row.tracking_code ?? null) || `#${row.id}`,
      title: String(row.title),
      eventDate: row.event_date ?? null,
      status: String(row.status ?? ""),
    };
  });
}

// ─── Editing an order ───────────────────────────────────────────────────────

export type EditOrderInput = {
  title?: string | null;
  description?: string | null;
  templateKey?: string | null;
  department?: string | null;
  priority?: string | null;
  dueAt?: string | null;
};

export async function editWorkOrder(database: Database, user: WorkUser, taskId: number, input: EditOrderInput, helpers: { notify: Notifier }) {
  const catalog = await requireReady(database);
  const before = await loadOrder(database, taskId);
  if (!(await canAccessOrder(database, before, user))) throw new WorkCommandError("لا تملك صلاحية هذا الأمر", 403);
  if (!(workAccess(user, catalog).canApprove || before.createdBy === user.id)) throw new WorkCommandError("تعديل الأمر للإدارة أو لمن أصدره فقط", 403);
  if (["completed", "cancelled"].includes(before.taskStatus)) throw new WorkCommandError("لا يمكن تعديل أمر منجز أو ملغى", 409);
  const title = input.title == null ? before.title : String(input.title).trim().slice(0, 500);
  if (title.length < 2) throw new WorkCommandError("اكتب عنوان الأمر", 422);
  const description = input.description === undefined ? before.description : String(input.description ?? "").trim().slice(0, 4_000) || null;
  let templateKey = before.templateKey;
  if (input.templateKey !== undefined) {
    if (input.templateKey) {
      const template = catalogOrderType(catalog, input.templateKey);
      if (!template) throw new WorkCommandError("نوع الأمر غير موجود", 422);
      if (!template.active && template.key !== before.templateKey) throw new WorkCommandError(`نوع الأمر «${template.label}» غير مفعّل`, 422);
      templateKey = template.key;
    } else templateKey = null;
  }
  const department = input.department && input.department !== before.department ? activeDepartment(catalog, input.department) : before.department;
  const priority = input.priority == null ? before.priority : PRIORITIES.has(String(input.priority)) ? String(input.priority) : null;
  if (!priority) throw new WorkCommandError("الأولوية غير صالحة", 422);
  let dueAt = before.dueAt ? new Date(before.dueAt) : null;
  if (input.dueAt !== undefined) {
    dueAt = input.dueAt ? cleanDate(input.dueAt) : null;
    if (input.dueAt && !dueAt) throw new WorkCommandError("موعد الإنجاز غير صالح", 422);
  }
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const track = (field: string, from: unknown, to: unknown) => {
    if ((from ?? null) !== (to ?? null)) changes[field] = { from: from ?? null, to: to ?? null };
  };
  track("title", before.title, title);
  track("description", before.description, description);
  track("templateKey", before.templateKey, templateKey);
  track("department", before.department, department);
  track("priority", before.priority, priority);
  track("dueAt", before.dueAt, dueAt ? dueAt.toISOString() : null);
  if (!Object.keys(changes).length) return { order: before, changed: [] as string[] };

  await database.transaction(async (tx) => {
    const locked = rowsOf(await tx.execute(sql`SELECT status FROM tasks WHERE id = ${taskId} FOR UPDATE`))[0];
    if (!locked || String(locked.status) !== before.taskStatus) throw new WorkCommandError("تغيرت حالة الأمر؛ أعد تحميله", 409);
    await tx.execute(sql`
      UPDATE tasks SET title = ${title}, description = ${description}, department = ${department},
        task_type = ${workOrderTaskType(templateKey, department)}, priority = ${priority}, due_at = ${dueAt}, updated_at = now()
      WHERE id = ${taskId}
    `);
    await tx.execute(sql`UPDATE work_orders SET template_key = ${templateKey}, updated_at = now() WHERE task_id = ${taskId}`);
    const labels: Record<string, string> = { title: "العنوان", description: "التفاصيل", templateKey: "نوع الأمر", department: "القسم", priority: "الأولوية", dueAt: "موعد الإنجاز" };
    const summary = Object.keys(changes).map((field) => labels[field]).join("، ");
    await timeline(tx, taskId, user, "work_order_edited", "تعديل الأمر", summary, { changes });
    await systemMessage(tx, before.channelId, user, `عدّل ${user.name} الأمر ${before.orderNo}: ${summary}`, taskId);
  });
  const order = await loadOrder(database, taskId);
  if (changes.dueAt || changes.title || changes.description)
    for (const staffId of before.assignedStaffIds)
      await helpers.notify({
        audienceType: "staff",
        staffId,
        type: "work_task_edited",
        title: changes.dueAt ? "تغيّر موعد أمر عمل" : "تم تعديل أمر عمل",
        body: `${order.orderNo} · ${order.title}`,
        entityType: "task",
        entityId: taskId,
        href: `/staff?tab=work&order=${taskId}`,
      });
  return { order, changed: Object.keys(changes) };
}


// ─── Deadlines ──────────────────────────────────────────────────────────────

let lastSweep = 0;

/**
 * Due-soon and overdue alerts, once per order and recipient (checked against
 * existing notifications). Throttled; also called from the daily sweep.
 */
export async function sweepDeadlines(executor: Executor, notify: Notifier, options: { force?: boolean } = {}) {
  if (!options.force && Date.now() - lastSweep < 5 * 60_000) return { skipped: true, sent: 0 };
  lastSweep = Date.now();
  if (!(await workCommandsReady(executor))) return { skipped: true, sent: 0 };
  const rows = rowsOf(
    await executor.execute(sql`
      ${ORDER_SELECT}
      WHERE t.archived_at IS NULL AND t.status IN ('new', 'accepted', 'in_progress') AND t.due_at IS NOT NULL
        AND t.due_at < now() + interval '2 hours'
      LIMIT 500
    `),
  );
  let sent = 0;
  for (const order of rows.map(orderFromRow)) {
    // "task" in the type keeps these under the tasks push toggle.
    const type = order.overdue ? "work_task_overdue" : "work_task_due_soon";
    const title = order.overdue ? "الطلب متأخر" : "موعد الإنجاز قريب";
    const recipients: Array<{ audienceType: "staff" | "admin"; staffId: number | null }> = [
      ...order.assignedStaffIds.map((staffId) => ({ audienceType: "staff" as const, staffId })),
      ...(order.overdue ? [{ audienceType: "admin" as const, staffId: null }] : []),
    ];
    for (const recipient of recipients) {
      const exists = rowsOf(
        await executor.execute(sql`
          SELECT 1 FROM notifications
          WHERE type = ${type} AND entity_type = 'task' AND entity_id = ${order.id}
            AND audience_type = ${recipient.audienceType} AND staff_id IS NOT DISTINCT FROM ${recipient.staffId}
          LIMIT 1
        `),
      ).length;
      if (exists) continue;
      await notify({ audienceType: recipient.audienceType, staffId: recipient.staffId, type, title, body: `${order.orderNo} · ${order.title}`, entityType: "task", entityId: order.id, href: recipient.audienceType === "admin" ? `/admin/work-commands?order=${order.id}` : `/staff?tab=work&order=${order.id}` });
      sent++;
    }
  }
  return { skipped: false, sent };
}

export const TRANSCRIPTION_UNAVAILABLE = {
  available: false,
  message: "التفريغ الصوتي الآلي غير مفعّل في النظام. اكتب نص الرسالة وسيستخرج النظام الحقول لتؤكدها.",
};

/** Provider boundary: no speech service is configured, so nothing is sent anywhere. */
export function transcriptionProvider(): null | { transcribe: (audioUrl: string) => Promise<string> } {
  return null;
}

export { ACTIVE_TASK_STATUSES };
