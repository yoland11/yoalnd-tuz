import type { KoshaBookingChannel, KoshaManagerInstruction, NewKoshaManagerInstruction } from "@workspace/db";

export type InstructionActor = { id: number; role: string; username: string; fullName?: string | null; permissions: string[] };
export type InstructionScope = { source: "kosha" | "service"; id: number; assignedStaff: Array<{ id: number; name: string }> };
type Instruction = KoshaManagerInstruction;
type Read = { staffId: number; viewedAt: Date; viewedVersion: number };
export type InstructionStore = {
  transaction<T>(work: (store: InstructionStore) => Promise<T>): Promise<T>;
  nextVersion(scope: InstructionScope): Promise<number>;
  currentVersion(scope: InstructionScope): Promise<number>;
  list(scope: InstructionScope): Promise<Instruction[]>;
  find(scope: InstructionScope, id: number): Promise<Instruction | undefined>;
  insert(value: NewKoshaManagerInstruction): Promise<Instruction>;
  update(scope: InstructionScope, id: number, values: Partial<Instruction>): Promise<Instruction>;
  recordEvent(scope: InstructionScope, actor: InstructionActor, action: string, instruction: Instruction, previous: Instruction | null): Promise<void>;
  notify(scope: InstructionScope, actor: InstructionActor, action: string, instruction: Instruction): Promise<void>;
  reads(scope: InstructionScope, channel: KoshaBookingChannel): Promise<Read[]>;
  markViewed(scope: InstructionScope, actor: InstructionActor, channel: KoshaBookingChannel, viewedAt: Date, viewedVersion: number): Promise<Read>;
  unreadCounts(bookings: InstructionScope[], staffId: number): Promise<Map<string, number>>;
};

export class KoshaInstructionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const instructionBookingHref = (scope: Pick<InstructionScope, "id" | "source">) => `/staff/koshas/booking/${scope.id}?source=${scope.source}`;
export const mayManageKoshaInstructions = (actor: InstructionActor) => ["admin", "manager"].includes(actor.role);
export const mayReadKoshaInstructions = (actor: InstructionActor) => mayManageKoshaInstructions(actor) || actor.permissions.includes("booking_operations_view") || actor.permissions.includes("koshas");
export function mayReadAssignedKoshaInstructions(scope: InstructionScope, actor: InstructionActor) {
  return mayReadKoshaInstructions(actor) && (mayManageKoshaInstructions(actor) || scope.assignedStaff.some(staff => staff.id === actor.id));
}
export function filterKoshaInstructionAuditTimeline<T extends { type?: unknown }>(
  scope: InstructionScope,
  actor: InstructionActor,
  timeline: T[],
) {
  return mayReadAssignedKoshaInstructions(scope, actor)
    ? timeline
    : timeline.filter((event) => !String(event.type ?? "").startsWith("instruction_"));
}
function authorize(scope: InstructionScope, actor: InstructionActor, audience: "staff" | "manager", mutation = false) {
  if (!Number.isSafeInteger(scope.id) || scope.id <= 0 || !["kosha", "service"].includes(scope.source)) throw new KoshaInstructionError(400, "حدد رقم الحجز ومصدره");
  const allowed = mutation ? mayManageKoshaInstructions(actor) : audience === "staff" ? mayReadAssignedKoshaInstructions(scope, actor) : mayReadKoshaInstructions(actor);
  if (!allowed) throw new KoshaInstructionError(403, "لا تملك صلاحية الوصول إلى تعليمات هذا الحجز");
}
function captionValue(value: unknown, required: boolean) {
  if (value != null && typeof value !== "string") throw new KoshaInstructionError(422, "نص التعليمات غير صالح");
  const caption = typeof value === "string" ? value.trim() : "";
  if ((required && !caption) || caption.length > 4000) throw new KoshaInstructionError(422, "أدخل نص التعليمات (حتى 4000 حرف)");
  return caption || null;
}
function imageValue(value: unknown) {
  if (typeof value !== "string") throw new KoshaInstructionError(422, "صورة التعليمات مطلوبة");
  const url = value.trim();
  // Existing uploads accept inline raster images or the already-uploaded storage URL.
  if (/^data:image\/(png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/=\r\n]+$/.test(url) || /^\/uploads\/[\w/.-]+$/.test(url)) return url;
  try { if (new URL(url).protocol === "https:") return url; } catch { /* Invalid URL is a validation failure below. */ }
  throw new KoshaInstructionError(422, "رابط صورة التعليمات غير صالح");
}
const latestTimestamp = (items: Instruction[]) => items.reduce<Date | null>((latest, row) => !latest || row.updatedAt > latest ? row.updatedAt : latest, null);
const latestVersion = (items: Instruction[]) => items.reduce((latest, row) => Math.max(latest, row.bookingVersion), 0);

export function createKoshaInstructionService(
  store: InstructionStore,
  persistImage: (value: unknown, folder: string) => Promise<string | null>,
  clock: () => Date = () => new Date(),
) {
  const write = async (scope: InstructionScope, actor: InstructionActor, action: "created" | "edited" | "archived", payload: Record<string, unknown>, id?: number) => {
    authorize(scope, actor, "manager", true);
    const kind = payload.kind;
    let mediaUrl: string | null = null;
    let caption: string | null = null;
    if (action === "created") {
      if (kind !== "note" && kind !== "image") throw new KoshaInstructionError(422, "نوع التعليمات غير صالح");
      caption = captionValue(payload.caption, kind === "note");
      if (kind === "image") {
        mediaUrl = await persistImage(imageValue(payload.mediaUrl), `koshas/instructions/${scope.source}/${scope.id}`);
        if (!mediaUrl) throw new Error("Instruction storage returned no URL");
      }
    }
    return store.transaction(async tx => {
      const found = action === "created" ? null : await tx.find(scope, Number(id));
      const previous = found ? { ...found } : null;
      if (action !== "created" && !previous) throw new KoshaInstructionError(404, "التعليمات غير موجودة في هذا الحجز");
      const bookingVersion = await tx.nextVersion(scope);
      const updatedAt = clock();
      const instruction = action === "created"
        ? await tx.insert({ bookingSource: scope.source, bookingId: scope.id, kind: kind as "note" | "image", mediaUrl, caption, uploadedByStaffId: actor.id, uploadedByName: actor.fullName || actor.username, revision: 1, bookingVersion, archivedAt: null, archivedByStaffId: null, createdAt: updatedAt, updatedAt })
        : await tx.update(scope, Number(id), action === "archived"
          ? { archivedAt: updatedAt, archivedByStaffId: actor.id, updatedAt, revision: previous!.revision + 1, bookingVersion }
          : { caption: captionValue(payload.caption, previous!.kind === "note"), revision: previous!.revision + 1, updatedAt, bookingVersion });
      await tx.recordEvent(scope, actor, action, instruction, previous ?? null);
      await tx.notify(scope, actor, action, instruction);
      return { instruction };
    });
  };
  return {
    create: (scope: InstructionScope, actor: InstructionActor, payload: Record<string, unknown>) => write(scope, actor, "created", payload),
    edit: (scope: InstructionScope, actor: InstructionActor, id: number, payload: Record<string, unknown>) => write(scope, actor, "edited", payload, id),
    archive: (scope: InstructionScope, actor: InstructionActor, id: number) => write(scope, actor, "archived", {}, id),
    async list(scope: InstructionScope, actor: InstructionActor, audience: "staff" | "manager") {
      authorize(scope, actor, audience);
      const [instructions, reads] = await Promise.all([store.list(scope), store.reads(scope, "manager_instruction")]);
      const read = reads.find(row => row.staffId === actor.id);
      const viewedAt = read?.viewedAt ?? null;
      const viewedVersion = read?.viewedVersion ?? 0;
      return { instructions, latestAt: latestTimestamp(instructions)?.toISOString() ?? null, latestVersion: latestVersion(instructions), viewedAt: viewedAt?.toISOString() ?? null, viewedVersion, unreadCount: instructions.filter(row => row.bookingVersion > viewedVersion).length };
    },
    async receipts(scope: InstructionScope, actor: InstructionActor) {
      authorize(scope, actor, "manager");
      const [instructions, reads] = await Promise.all([store.list(scope), store.reads(scope, "manager_instruction")]);
      const latest = latestTimestamp(instructions);
      const currentVersion = latestVersion(instructions);
      return { latestAt: latest?.toISOString() ?? null, latestVersion: currentVersion, staff: scope.assignedStaff.map(staff => {
        const read = reads.find(row => row.staffId === staff.id);
        const viewedAt = read?.viewedAt ?? null;
        const viewedVersion = read?.viewedVersion ?? 0;
        return { ...staff, viewedAt: viewedAt?.toISOString() ?? null, viewedVersion, hasViewedLatest: currentVersion === 0 || viewedVersion >= currentVersion };
      }) };
    },
    async markViewed(scope: InstructionScope, actor: InstructionActor, audience: "staff" | "manager", viewedThrough?: unknown, requestedVersion?: unknown) {
      authorize(scope, actor, audience);
      const now = clock();
      const viewedAt = new Date(typeof viewedThrough === "string" ? viewedThrough : NaN);
      if (!Number.isFinite(viewedAt.getTime()) || viewedAt > now) throw new KoshaInstructionError(422, "وقت عرض التعليمات غير صالح");
      const channel = audience === "staff" ? "manager_instruction" : "staff_execution";
      let viewedVersion = 0;
      if (channel === "manager_instruction") {
        viewedVersion = Number(requestedVersion);
        if (!Number.isSafeInteger(viewedVersion) || viewedVersion <= 0)
          throw new KoshaInstructionError(422, "نسخة عرض التعليمات غير صالحة");
        const currentVersion = await store.currentVersion(scope);
        if (viewedVersion > currentVersion)
          throw new KoshaInstructionError(422, "نسخة عرض التعليمات أحدث من الحجز");
      }
      const read = await store.markViewed(scope, actor, channel, viewedAt, viewedVersion);
      return { viewedAt: read.viewedAt.toISOString(), viewedVersion: read.viewedVersion };
    },
    async unread(scopes: InstructionScope[], actor: InstructionActor) {
      const allowed = scopes.filter(scope => mayReadAssignedKoshaInstructions(scope, actor));
      return allowed.length ? store.unreadCounts(allowed, actor.id) : new Map<string, number>();
    },
  };
}

export type KoshaInstructionService = ReturnType<typeof createKoshaInstructionService>;

export async function dispatchKoshaInstructionRequest(input: {
  service: KoshaInstructionService;
  surface: "manager" | "staff";
  method: string;
  tail: string[];
  scope: InstructionScope;
  actor: InstructionActor;
  payload?: Record<string, unknown>;
}) {
  const { service, surface, method, tail, scope, actor } = input;
  const payload = input.payload ?? {};

  if (surface === "staff") {
    if (method === "GET" && tail.length === 1 && tail[0] === "instructions")
      return service.list(scope, actor, "staff");
    if (method === "POST" && tail.length === 2 && tail[0] === "instructions" && tail[1] === "viewed")
      return service.markViewed(scope, actor, "staff", payload.viewedThrough, payload.viewedVersion);
    return null;
  }

  if (tail.length === 1 && tail[0] === "instructions") {
    if (method === "GET") return service.list(scope, actor, "manager");
    if (method === "POST") return service.create(scope, actor, payload);
    return null;
  }
  if (method === "GET" && tail.length === 1 && tail[0] === "instruction-reads")
    return service.receipts(scope, actor);
  if (method === "POST" && tail.length === 1 && tail[0] === "execution-viewed")
    return service.markViewed(scope, actor, "manager", payload.viewedThrough);
  if (tail[0] === "instructions" && tail.length >= 2) {
    const instructionId = Number(tail[1]);
    if (!Number.isSafeInteger(instructionId) || instructionId <= 0)
      throw new KoshaInstructionError(400, "معرف التعليمات غير صالح");
    if (method === "PATCH" && tail.length === 2)
      return service.edit(scope, actor, instructionId, payload);
    if (method === "POST" && tail.length === 3 && tail[2] === "archive")
      return service.archive(scope, actor, instructionId);
  }
  return null;
}
