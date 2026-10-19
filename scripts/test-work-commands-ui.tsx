import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
// Match the CJS module instances used by tsx-transpiled view dependencies.
const { QueryClient, QueryClientProvider } = createRequire(import.meta.url)(
  "@tanstack/react-query",
) as typeof import("@tanstack/react-query");
const { Router } = createRequire(import.meta.url)("wouter") as typeof import("wouter");
(globalThis as any).React = React;

// A wide screen with a conversation and an order open, as after a notification tap.
(globalThis as any).window = {
  location: { search: "?channel=1&order=40", href: "http://localhost/admin/work-commands?channel=1&order=40", pathname: "/admin/work-commands" },
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  history: { replaceState() {} },
};

const center = await import("../src/components/work-commands/command-center");
const WorkCommandCenter = ((center as any).WorkCommandCenter ?? (center as any).default?.WorkCommandCenter) as React.ComponentType<{ mode?: "admin" | "staff" }>;

const now = new Date();
const order = {
  id: 40, orderNo: "TSK-000040", title: "مونتاج حفلة أحمد", description: "النسخة الطويلة مع الأغنية", taskStatus: "new", status: "new", statusLabel: "جديد",
  priority: "high", department: "editing", departmentLabel: "المونتاج", dueAt: new Date(now.getTime() + 3 * 3_600_000).toISOString(), overdue: false, dueSoon: false,
  assignedStaffIds: [7], assigneeNames: "علي حسن", createdBy: 1, createdByName: "المدير", createdAt: now.toISOString(), completedAt: null, approvedAt: null, returnReason: null,
  booking: { type: "kosha_booking", id: 120 }, channelId: 1, parentId: null, mandatory: true, templateKey: "editing", templateLabel: "أمر مونتاج", requiresApproval: true, evidenceRequired: true,
  customer: { id: null, name: "أحمد" }, product: null, source: null, pendingExtension: null,
};
const channel = {
  id: 1, title: "المونتاج", department: "editing", departmentLabel: "المونتاج", entityType: "work_department", isDepartment: true, participantStaffIds: [],
  unread: 2, pendingOrders: 1, activeEmployees: 3, lastMessage: { body: "تم رفع الملفات", type: "text", sender: "زينب", at: now.toISOString() }, updatedAt: now.toISOString(),
};
const message = (id: number, extra: Record<string, unknown>) => ({
  id, channelId: 1, senderId: 1, senderName: "المدير", body: null, type: "text", voiceUrl: null, voiceDuration: null, attachments: [], replyTo: null, taskId: null, readBy: 0, createdAt: now.toISOString(), ...extra,
});
const thread = {
  hasOlder: false,
  orders: [order],
  messages: [
    message(1, { senderId: 8, senderName: "زينب", body: "تم رفع الملفات على الدرايف" }),
    message(2, { type: "work_order", body: order.title, taskId: 40 }),
    message(3, { type: "voice", voiceUrl: "https://cdn.example.com/v.webm", voiceDuration: 12, senderId: 7, senderName: "علي حسن", readBy: 2, replyTo: { id: 1, senderName: "زينب", body: "تم رفع الملفات على الدرايف" } }),
    message(4, { type: "system", body: "استلم علي حسن الأمر TSK-000039", taskId: 39 }),
  ],
};
const details = {
  order, actions: ["acknowledge", "help", "request_extension"], subtasks: [], progress: { total: 0, completed: 0, percent: 100, blocking: 0 }, parent: null,
  history: [{ type: "work_order_created", title: "تم إصدار أمر العمل", body: order.title, actor: "المدير", at: now.toISOString() }],
  attachments: [], comments: [], checklist: [{ id: 1, title: "استلام الملفات", done: true }, { id: 2, title: "المونتاج", done: false }],
};

function render(me: unknown, actions: string[] = details.actions) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchInterval: false } } });
  client.setQueryData(["work-commands", "me"], me);
  client.setQueryData(["work-commands", "channels"], [channel]);
  client.setQueryData(["work-commands", "messages", 1], thread);
  client.setQueryData(["work-commands", "order", 40], { ...details, actions });
  client.setQueryData(["work-commands", "team"], {
    canGrant: true,
    staffDepartments: [{ value: "editing", department: "editing" }, { value: "تصوير", department: "photography" }],
    members: [
      { id: 7, name: "علي حسن", role: "employee", jobTitle: "مونتير", staffDepartment: "editing", departmentLabel: "المونتاج", canIssue: false, explicit: false, lockedBy: null },
      { id: 8, name: "زينب كريم", role: "employee", jobTitle: null, staffDepartment: "تصوير", departmentLabel: "التصوير", canIssue: true, explicit: false, lockedBy: "task_create" },
    ],
  });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Router, { ssrPath: "/admin/work-commands" }, createElement(WorkCommandCenter, { mode: "admin" }))));
}
const access = (manager: boolean) => ({ manager, canCreate: manager, canApprove: manager, canCreateChannel: manager, canManageCatalog: manager, canGrant: manager, department: "editing" });

// Employee assigned to the order.
{
  const html = render({ ready: true, user: { id: 7, name: "علي حسن", department: "editing" }, access: access(false) });
  for (const text of ["المحادثات", "أوامري", "المونتاج", "تم رفع الملفات على الدرايف", "مونتاج حفلة أحمد", "TSK-000040", "جديد", "استلام الأمر", "أوامر مفتوحة", "سجل الأمر", "تم إصدار أمر العمل", "قائمة التحقق", "يتطلب اعتماد", "رسالة صوتية", "استلم علي حسن الأمر"])
    assert.ok(html.includes(text), `employee view shows «${text}»`);
  assert.doesNotMatch(html, /لوحة <\/span>المتابعة/, "the follow-up board is for managers");
  assert.ok(!html.includes(">إصدار أمر عمل<") && !html.includes("aria-label=\"إصدار أمر عمل\""), "employees without permission cannot issue orders");
  assert.ok(!html.includes("اعتماد الإنجاز"), "approval is not offered to the assignee");
  assert.ok(!html.includes(">الإعدادات<") && !html.includes("تعديل المحادثة") && !html.includes("تعديل الأمر"), "settings and edits are for managers");
  assert.match(html, /href="\/admin\/bookings\/kosha\/120"/, "order links to its booking");
  assert.match(html, /<audio[^>]+src="https:\/\/cdn\.example\.com\/v\.webm"/);
  assert.match(html, /aria-label="2 غير مقروءة"/);
}

// Manager.
{
  const html = render({ ready: true, user: { id: 1, name: "المدير", department: "general" }, access: access(true) }, ["reassign", "cancel"]);
  assert.match(html, /لوحة <\/span>المتابعة/, "manager sees the follow-up board tab");
  for (const text of ["إصدار أمر عمل", "قناة", "تحويل إلى أمر عمل", "تغيير المسؤول", "إلغاء الأمر", "الإعدادات", "تعديل المحادثة", "تعديل الأمر", "نوع الأمر", "أمر مونتاج"]) assert.ok(html.includes(text), `manager view shows «${text}»`);
  assert.ok(!html.includes(">استلام الأمر<"), "only the assignee acknowledges");
}

// Settings: editable order types, departments (with their staff departments) and the issue permission.
{
  (globalThis as any).window.location.search = "?view=settings";
  const html = render({
    ready: true,
    user: { id: 1, name: "المدير", department: "general" },
    access: access(true),
    catalog: {
      departments: [
        { key: "general", label: "الإدارة العامة", aliases: [], active: true, builtIn: true },
        { key: "editing", label: "المونتاج", aliases: [], active: true, builtIn: true },
        { key: "photography", label: "التصوير", aliases: [], active: false, builtIn: true },
        { key: "dept_9", label: "الصوتيات", aliases: ["تصوير"], active: true, builtIn: false },
      ],
      orderTypes: [
        { key: "editing", label: "أمر مونتاج", department: "editing", title: "مونتاج فيديو", priority: "high", estimatedMinutes: 480, checklist: [], evidenceRequired: true, evidenceHint: "", requiresApproval: true, needsBooking: true, active: true, builtIn: true },
        { key: "type_10", label: "تصميم دعوة", department: "dept_9", title: "تصميم دعوة", priority: "medium", estimatedMinutes: 60, checklist: [], evidenceRequired: false, evidenceHint: "", requiresApproval: false, needsBooking: false, active: false, builtIn: false },
      ],
    },
  });
  for (const text of ["أنواع الأوامر", "نوع جديد", "أمر مونتاج", "تصميم دعوة", "الأقسام", "قسم جديد", "الصوتيات", "من يستطيع إصدار الأوامر", "علي حسن", "زينب كريم", "مفعّلة عبر صلاحية «إنشاء مهام الموظفين»"])
    assert.ok(html.includes(text), `settings show «${text}»`);
  assert.match(html, /aria-label="صلاحية إصدار الأوامر لـ علي حسن"/, "a switch grants the issue permission");
  assert.ok(html.includes("متوقف"), "switched-off entries stay listed");
  (globalThis as any).window.location.search = "?channel=1&order=40";
}

// Before migration 0126: an explicit state, not an empty inbox.
{
  const html = render({ ready: false, user: { id: 1, name: "المدير", department: "general" }, access: access(true) });
  assert.ok(html.includes("0126_work_command_center") && html.includes("غير مفعّل"));
  assert.ok(!html.includes("لا توجد محادثات"), "never presented as 'no data'");
}

console.log("PASS  work command center UI: employee/manager views, order card, details, voice, unread, settings, pre-migration state");
