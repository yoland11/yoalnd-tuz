import { z } from "zod/v4";
import {
  SalesReturnError,
  acceptSalesReturnInventory,
  applyCustomerCredit,
  approveSalesReturn,
  cancelSalesReturn,
  listSalesReturns,
  readCustomerPurchases,
  readCustomerReturnsSummary,
  readSalesReturn,
  readSalesReturnOptions,
  readSalesReturnReports,
  receiveSalesReturn,
  rejectSalesReturn,
  resolveInspection,
  reverseSalesReturn,
  reverseSettlement,
  saveSalesReturn,
  settleSalesReturn,
  submitSalesReturn,
  type SalesReturnActor,
  type SalesReturnDatabase,
} from "./sales-returns";

export type SalesReturnRequest = { method: string; parts: readonly string[]; query: URLSearchParams; readBody: () => Promise<unknown> };

const id = (value: string | undefined) => {
  if (!value || !/^[1-9]\d{0,9}$/.test(value)) throw new SalesReturnError("المعرّف غير صالح", 400, "VALIDATION_ERROR");
  return Number(value);
};
const key = z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9_-]+$/, "مفتاح منع التكرار غير صالح");
const quantity = z.coerce.number().finite().positive().max(1_000_000);
const amount = z.coerce.number().finite().min(0).max(1_000_000_000);
const condition = z.enum(["good", "inspection", "damaged", "unsellable"]);
const note = z.string().trim().max(2000).nullish();
const reason = z.string().trim().min(3, "اكتب السبب").max(2000);

const saveSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  warehouseId: z.coerce.number().int().positive().nullish(),
  reasonCode: z.string().trim().min(1).max(40),
  notes: note,
  attachmentUrl: z.string().trim().max(1000).nullish(),
  employeeId: z.coerce.number().int().positive().nullish(),
  settlementPlan: z.record(z.string(), z.unknown()).optional(),
  submit: z.boolean().default(false),
  expectedVersion: z.coerce.number().int().positive().nullish(),
  idempotencyKey: key,
  items: z.array(z.object({
    productKey: z.string().trim().min(3).max(200),
    quantity,
    condition,
    allocations: z.array(z.object({ invoiceItemId: z.coerce.number().int().positive(), quantity: z.coerce.number().finite().min(0).max(1_000_000) })).max(500).nullish(),
  })).min(1).max(200),
});
const settleSchema = z.object({
  invoiceCredit: amount.default(0),
  customerCredit: amount.default(0),
  refund: amount.default(0),
  refundMethod: z.enum(["cash", "transfer", "card"]).nullish(),
  exchange: z.boolean().default(false),
  note,
  idempotencyKey: key,
});

async function body<T>(request: SalesReturnRequest, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await request.readBody();
  } catch (cause) {
    if (cause instanceof SyntaxError) throw new SalesReturnError("صيغة الطلب غير صالحة", 400, "VALIDATION_ERROR");
    throw cause;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new SalesReturnError(first?.message && /[؀-ۿ]/.test(first.message) ? first.message : "بيانات المرتجع غير مكتملة أو غير صالحة", 422, "VALIDATION_ERROR");
  }
  return parsed.data;
}
const methodNotAllowed = () => new SalesReturnError("الطريقة غير مدعومة لهذا المسار", 405, "VALIDATION_ERROR");

/** /admin/sales-returns/... — every write is permission-checked inside its service. */
export async function handleSalesReturnsRequest(db: SalesReturnDatabase, actor: SalesReturnActor, request: SalesReturnRequest) {
  const [first, second, third, fourth] = request.parts;
  const { method } = request;
  if (!first) {
    if (method === "GET") {
      const q = request.query;
      return {
        status: 200,
        data: await listSalesReturns(db, actor, {
          customerId: Number(q.get("customerId")) || null,
          q: q.get("q"),
          invoiceNo: q.get("invoiceNo"),
          product: q.get("product"),
          from: q.get("from"),
          to: q.get("to"),
          status: q.get("status"),
          settlement: q.get("settlement"),
          employeeId: Number(q.get("employeeId")) || null,
          page: Number(q.get("page")) || 1,
        }),
      };
    }
    if (method === "POST") {
      const input = await body(request, saveSchema);
      const result = await saveSalesReturn(db, actor, input, null);
      return { status: result.replayed ? 200 : 201, data: result };
    }
    throw methodNotAllowed();
  }
  if (first === "options" && !second) {
    if (method !== "GET") throw methodNotAllowed();
    return { status: 200, data: await readSalesReturnOptions(db, actor) };
  }
  if (first === "reports" && !second) {
    if (method !== "GET") throw methodNotAllowed();
    return { status: 200, data: await readSalesReturnReports(db, actor, { from: request.query.get("from"), to: request.query.get("to") }) };
  }
  if (first === "customers" && second && !fourth) {
    if (method !== "GET") throw methodNotAllowed();
    const customerId = id(second);
    if (third === "purchases") return { status: 200, data: await readCustomerPurchases(db, actor, customerId, Number(request.query.get("excludeReturnId")) || null) };
    if (third === "summary") return { status: 200, data: await readCustomerReturnsSummary(db, actor, customerId) };
    throw new SalesReturnError("المسار غير موجود", 404, "NOT_FOUND");
  }
  if (first === "credits" && second === "apply" && !third) {
    if (method !== "POST") throw methodNotAllowed();
    const input = await body(request, z.object({ customerId: z.coerce.number().int().positive(), invoiceId: z.coerce.number().int().positive(), amount: z.coerce.number().finite().positive().max(1_000_000_000), idempotencyKey: key }));
    return { status: 200, data: await applyCustomerCredit(db, actor, input) };
  }
  if (first === "settlements" && second && third === "reverse" && !fourth) {
    if (method !== "POST") throw methodNotAllowed();
    const input = await body(request, z.object({ reason }));
    return { status: 200, data: await reverseSettlement(db, actor, id(second), input.reason) };
  }
  const returnId = id(first);
  if (!second) {
    if (method === "GET") return { status: 200, data: await readSalesReturn(db, actor, returnId) };
    if (method === "PUT") {
      const input = await body(request, saveSchema);
      return { status: 200, data: await saveSalesReturn(db, actor, input, returnId) };
    }
    throw methodNotAllowed();
  }
  if (method !== "POST" || third) throw methodNotAllowed();
  switch (second) {
    case "submit":
      return { status: 200, data: await submitSalesReturn(db, actor, returnId) };
    case "receive": {
      const input = await body(request, z.object({ note }));
      return { status: 200, data: await receiveSalesReturn(db, actor, returnId, input.note ?? null) };
    }
    case "approve": {
      const input = await body(request, z.object({ note }));
      return { status: 200, data: await approveSalesReturn(db, actor, returnId, input.note ?? null) };
    }
    case "reject": {
      const input = await body(request, z.object({ reason }));
      return { status: 200, data: await rejectSalesReturn(db, actor, returnId, input.reason) };
    }
    case "cancel": {
      const input = await body(request, z.object({ reason }));
      return { status: 200, data: await cancelSalesReturn(db, actor, returnId, input.reason) };
    }
    case "inventory": {
      const input = await body(request, z.object({ items: z.array(z.object({ itemId: z.coerce.number().int().positive(), condition })).max(500).default([]) }));
      return { status: 200, data: await acceptSalesReturnInventory(db, actor, returnId, input.items) };
    }
    case "inspection": {
      const input = await body(request, z.object({ itemId: z.coerce.number().int().positive(), decision: z.enum(["restock", "damaged"]), note }));
      return { status: 200, data: await resolveInspection(db, actor, returnId, input.itemId, input.decision, input.note ?? null) };
    }
    case "settle": {
      const input = await body(request, settleSchema);
      return { status: 200, data: await settleSalesReturn(db, actor, returnId, input) };
    }
    case "reverse": {
      const input = await body(request, z.object({ reason }));
      return { status: 200, data: await reverseSalesReturn(db, actor, returnId, input.reason) };
    }
    default:
      throw new SalesReturnError("المسار غير موجود", 404, "NOT_FOUND");
  }
}
