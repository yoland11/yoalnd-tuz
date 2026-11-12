/** Isolated interactive preview of real production components. No database or provider imports. */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  MESSAGE_TEMPLATES,
  renderEventMessage,
  uniqueRecipients,
  messageValues,
  type MessageRecipient,
} from "../src/lib/event-messaging";
const require = createRequire(import.meta.url);
const esbuild = createRequire(
  realpathSync(resolve("lib/db/node_modules/tsx/package.json")),
)("esbuild");
const postcss = require("postcss"),
  tailwind = require("@tailwindcss/postcss");
export async function startEventPreview(port = 0) {
  const css = (
    await postcss([tailwind()]).process(
      await readFile("src/index.css", "utf8"),
      { from: resolve("src/index.css") },
    )
  ).css;
  const bundle = (
    await esbuild.build({
      stdin: {
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import CustomerFollowupsPage from './src/views/admin/customer-followups';import {Toaster} from './src/components/ui/toaster';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><CustomerFollowupsPage/><Toaster/></QueryClientProvider>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      loader: { ".css": "empty" },
      define: { "process.env.NODE_ENV": '"development"' },
    })
  ).outputFiles[0].text;
  const now = new Date();
  const date = new Date(now.getTime() + 86400000).toISOString(),
    employee = { id: 7, fullName: "زينب كريم", department: "خدمة العملاء" };
  const initial = [
    {
      id: 17,
      customer: { id: 9, name: "أحمد علي — مثال", phone: "07700000001" },
      serviceKey: "henna",
      occasionKey: "henna",
      contactStage: "new",
      expectedEventDate: date.slice(0, 10),
      followupAt: date,
      status: "waiting",
      employee,
      note: "يرغب بمعرفة باقة الحنة",
      completedAt: null,
      version: 1,
      contactBlocked: false,
      booking: null,
      sourceBooking: {
        source: "service",
        id: 45,
        number: "AJN-0045",
        href: "/admin/bookings/service/45",
      },
      createdAt: now.toISOString(),
    },
    {
      id: 18,
      customer: { id: 10, name: "سارة محمد — مثال", phone: "07700000002" },
      serviceKey: "wedding",
      occasionKey: "wedding",
      contactStage: "quotation",
      expectedEventDate: "2026-12-15",
      followupAt: new Date(now.getTime() - 86400000).toISOString(),
      status: "interested",
      employee,
      note: "أرسلنا عرضاً، بانتظار تحديد الموعد",
      completedAt: null,
      version: 1,
      contactBlocked: false,
      booking: null,
      createdAt: now.toISOString(),
    },
    {
      id: 19,
      customer: { id: 11, name: "علي حسن — مثال", phone: "07700000003" },
      serviceKey: "graduation",
      occasionKey: "graduation",
      contactStage: "interested",
      expectedEventDate: "2026-12-20",
      followupAt: now.toISOString(),
      status: "converted",
      employee,
      note: "تم تأكيد جلسة التصوير",
      completedAt: null,
      version: 1,
      contactBlocked: false,
      booking: {
        source: "service",
        id: 46,
        number: "AJN-0046",
        href: "/admin/bookings/service/46",
      },
      createdAt: now.toISOString(),
    },
  ];
  let followups: any[] = structuredClone(initial),
    campaigns: any[] = [],
    counter = 0;
  const history: any[] = [];
  const customers: MessageRecipient[] = initial.map((f) => ({
    key: `customer:${f.customer.id}`,
    kind: "customer",
    id: f.customer.id,
    name: f.customer.name,
    phone: f.customer.phone,
    category:
      f.serviceKey === "henna"
        ? "حنة"
        : f.serviceKey === "wedding"
          ? "زفاف"
          : "تخرج",
    details: {
      reference: `AJN-00${f.id}`,
      date: f.expectedEventDate,
      status: "مؤكد",
      services: "التصوير والكوشة",
      remaining: "15000",
      paymentStatus: "مدفوع جزئياً",
    },
    consent: true,
    blocked: false,
  }));
  const groups: MessageRecipient[] = [
    {
      key: "group:8",
      kind: "group",
      id: 8,
      name: "حسين كريم — ممثل تجريبي",
      phone: "07700000004",
      category: "تخرج",
      details: {
        group: "دفعة الهندسة 2027 — مثال",
        university: "جامعة بغداد",
        department: "هندسة الحاسوب",
        students: "40",
        date: "2026-12-20",
        services: "تصوير فيديو، روب، وشاح ملكي، قبعة وطباعة",
        reference: "GRAD-G008",
        remaining: "480000",
        paymentStatus: "غير مدفوع",
        status: "قيد التجهيز",
      },
      consent: true,
      blocked: false,
    },
  ];
  const orders: MessageRecipient[] = [
    {
      key: "graduation:2",
      kind: "graduation",
      id: 2,
      name: "نور أحمد — مثال",
      phone: "07700000005",
      category: "تخرج",
      details: {
        reference: "GRAD-0002",
        date: "2026-12-20",
        services: "روب، وشاح أمريكي وقبعة",
        university: "جامعة بغداد",
        department: "هندسة الحاسوب",
        remaining: "23000",
        paymentStatus: "غير مدفوع",
        status: "بانتظار التجهيز",
      },
      consent: true,
      blocked: false,
    },
  ];
  const all = [...customers, ...groups, ...orders];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const base = "/api/admin/customer-followups";
    function send(data: any, status = 200) {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    }
    if (url.pathname === "/preview.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(bundle);
      return;
    }
    if (url.pathname === "/preview.css") {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(css);
      return;
    }
    if (url.pathname.startsWith(base)) {
      let body: any = {};
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      }
      const parts = url.pathname.slice(base.length).split("/").filter(Boolean);
      if (parts[0] === "messaging") {
        const action = parts[1],
          cid = Number(action),
          c = campaigns.find((c) => c.id === cid);
        if (action === "recipients") {
          const source =
            url.searchParams.get("kind") === "group"
              ? groups
              : url.searchParams.get("kind") === "graduation"
                ? orders
                : customers;
          return send({
            recipients: source.filter((r) =>
              (r.name + " " + r.phone + " " + r.details.group).includes(
                url.searchParams.get("q") || "",
              ),
            ),
            invalid: [],
            hasMore: false,
          });
        }
        if (action === "templates")
          return send({
            templates: MESSAGE_TEMPLATES,
            providerTemplates: [
              {
                name: "ajn_preview",
                language: "ar",
                status: "APPROVED",
                components: [
                  { type: "BODY", text: "مرحباً {{1}}، موعدكم {{2}}" },
                ],
              },
            ],
          });
        if (action === "consent") {
          const r = all.find((r) => r.key === body.recipientKey);
          if (r) {
            r.consent = body.optedIn;
            r.blocked = body.blocked;
          }
          return send({ ok: true });
        }
        if (action === "preview")
          return send({
            recipients: uniqueRecipients(
              all.filter((r) => body.recipientKeys.includes(r.key)),
            ).map((recipient) => ({
              recipient,
              message: renderEventMessage(body.templateKey, recipient),
            })),
            duplicatesRemoved: 0,
            previewHash: "synthetic-preview",
          });
        if (!action && req.method === "POST") {
          counter++;
          const rows = uniqueRecipients(
            all.filter((r) => body.recipientKeys.includes(r.key)),
          ).map((r, i) => ({
            id: i + 1,
            snapshot: r,
            phone: r.phone,
            message: renderEventMessage(body.templateKey, r),
            status: "pending",
          }));
          campaigns.unshift({
            id: counter,
            title: body.title,
            channel: body.channel,
            status: "pending",
            created_by: 1,
            scheduled_at: body.scheduledAt || now.toISOString(),
            created_at: now.toISOString(),
            recipients: rows,
            history: [
              { action: "created", actor_id: 1, created_at: now.toISOString() },
            ],
          });
          return send({ campaignId: counter }, 201);
        }
        if (!action)
          return send({
            campaigns: campaigns.map((c) => ({
              ...c,
              recipients: c.recipients.length,
              accepted: 0,
              issues: 0,
            })),
            canApprove: true,
            canGraduation: true,
          });
        if (c && req.method === "POST") {
          const a = parts[2];
          if (a === "approve") c.status = "approved";
          if (a === "reject") c.status = "rejected";
          if (a === "manual-open") {
            const r = c.recipients.find((r: any) => r.id === body.recipientId);
            r.status = "manual_opened";
            c.history.unshift({
              action: "manual_opened (preview only)",
              actor_id: 1,
              created_at: new Date().toISOString(),
            });
            return send({ href: "about:blank", status: "manual_opened" });
          }
          c.history.unshift({
            action: a,
            actor_id: 1,
            created_at: new Date().toISOString(),
          });
          return send({ ok: true, processed: 0 });
        }
        if (c)
          return send({
            campaign: c,
            recipients: c.recipients,
            history: c.history,
          });
        return send({ message: "الحملة غير موجودة في المعاينة" }, 404);
      }
      if (parts[0] === "employees") return send({ employees: [employee] });
      if (parts[0] === "options")
        return send({
          customers: initial.map((f) => f.customer),
          employees: [employee],
        });
      const row = followups.find((f) => f.id === Number(parts[0]));
      if (row && parts[1] === "history")
        return send({
          customer: row.customer,
          followup: row,
          related: followups.filter((f) => f.customer.id === row.customer.id),
          bookings: [
            {
              source: "service",
              id: 45,
              number: "AJN-0045",
              event_date: "2026-11-01",
              status: "مؤكد",
            },
          ],
          history: [
            ...history,
            {
              action: "auto_created",
              employee: "زينب كريم",
              created_at: now.toISOString(),
              result: {},
            },
          ],
        });
      if (row && parts[1] === "actions") {
        if (body.action === "event_details") {
          row.contactStage = body.contactStage;
          row.expectedEventDate = body.expectedEventDate;
          row.note = body.note;
        }
        if (body.action === "complete")
          row.completedAt = new Date().toISOString();
        if (body.action === "postpone") row.followupAt = body.followupAt;
        if (body.action === "status") row.status = body.status;
        row.version++;
        history.unshift({
          action: body.action,
          employee: "زينب كريم",
          created_at: new Date().toISOString(),
          result: { followup: { ...row } },
        });
        return send({ followup: row });
      }
      if (req.method === "POST" && !parts.length) {
        const customer =
          initial.find((f) => f.customer.id === body.customerId)?.customer ||
          initial[0].customer;
        const f = {
          ...initial[0],
          id: 20 + followups.length,
          customer,
          ...body,
          employee,
          createdAt: new Date().toISOString(),
          completedAt: null,
          status: "interested",
          version: 1,
        };
        followups.push(f);
        return send({ followup: f }, 201);
      }
      return send({
        rows: followups.filter((f) =>
          f.customer.name.includes(url.searchParams.get("q") || ""),
        ),
        summary: {
          today: 1,
          overdue: 1,
          upcoming: 1,
          converted: 1,
          total: followups.length,
          completed: 0,
          henna: 1,
          wedding: 1,
        },
        suggestions: [],
        page: 1,
        pageSize: 25,
        total: followups.length,
        capabilities: {
          canManage: true,
          canCreate: true,
          canBook: true,
          canMessage: true,
          canCreateCustomer: false,
          canOpenCustomer: true,
        },
      });
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    const booking = url.pathname === "/admin/bookings";
    res.end(
      `<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>معاينة AJN — متابعة المناسبات</title><link rel="stylesheet" href="/preview.css"></head><body><aside style="background:#fff1f5;color:#820033;padding:12px;text-align:center;border-bottom:1px solid #edcbd9;font-size:14px">معاينة تفاعلية — بيانات تجريبية فقط، لا إرسال حقيقي ولا حفظ في الإنتاج</aside>${booking ? '<main style="padding:32px"><h1>إنشاء حجز جديد من المتابعة</h1><p>يفتح الإجراء مركز الحجوزات بالعميل والمناسبة من المتابعة الأصلية. هذه معاينة، لم يُنشأ حجز حقيقي.</p><a href="/admin/customer-followups">الرجوع للمتابعة</a></main>' : '<main id="root" style="max-width:1540px;margin:auto;padding:24px;min-width:0"></main><script src="/preview.js"></script>'}<script>document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&(/wa.me|^tel:/.test(a.href))){e.preventDefault();alert('معاينة فقط — لا يتم التواصل مع الأرقام التجريبية');}})</script></body></html>`,
    );
  });
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  return {
    server,
    origin: `http://127.0.0.1:${(server.address() as any).port}`,
  };
}
if (process.argv.includes("--serve")) {
  const preview = await startEventPreview(
    Number(process.env.AJN_PREVIEW_PORT) || 3027,
  );
  console.log(
    "Interactive synthetic preview: " +
      preview.origin +
      "/admin/customer-followups",
  );
}
