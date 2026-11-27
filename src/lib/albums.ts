/**
 * Album Management (إدارة الألبومات) — shared vocabulary for the server, the
 * admin page, the employee portal and printing. Pure: no database, no DOM.
 */

export const ALBUM_STAGES = [
  { key: "received", label: "تم استلام الطلب", short: "تم الاستلام" },
  { key: "awaiting_selection", label: "بانتظار اختيار الصور", short: "اختيار الصور" },
  { key: "selected", label: "تم اختيار الصور", short: "تم الاختيار" },
  { key: "designing", label: "قيد التصميم", short: "التصميم" },
  { key: "awaiting_approval", label: "بانتظار موافقة الزبون", short: "موافقة الزبون" },
  { key: "approved", label: "تمت الموافقة", short: "تمت الموافقة" },
  { key: "printing", label: "قيد الطباعة", short: "الطباعة" },
  { key: "binding", label: "قيد التجليد", short: "التجليد" },
  { key: "quality", label: "فحص الجودة", short: "فحص الجودة" },
  { key: "ready", label: "جاهز للتسليم", short: "جاهز للتسليم" },
  { key: "delivered", label: "تم التسليم", short: "تم التسليم" },
] as const;
export type AlbumStage = (typeof ALBUM_STAGES)[number]["key"];
export const ALBUM_STAGE_KEYS = ALBUM_STAGES.map((stage) => stage.key) as AlbumStage[];

export function isAlbumStage(value: unknown): value is AlbumStage {
  return typeof value === "string" && (ALBUM_STAGE_KEYS as string[]).includes(value);
}
export function albumStageLabel(stage: string | null | undefined) {
  return ALBUM_STAGES.find((item) => item.key === stage)?.label ?? "—";
}
export function albumStageIndex(stage: string | null | undefined) {
  return Math.max(0, ALBUM_STAGE_KEYS.indexOf(stage as AlbumStage));
}

/** The dashboard cards: every stage belongs to exactly one bucket. */
export const ALBUM_STAGE_BUCKETS = {
  waitingSelection: ["received", "awaiting_selection"],
  designing: ["selected", "designing", "awaiting_approval", "approved"],
  production: ["printing", "binding", "quality"],
  ready: ["ready"],
  delivered: ["delivered"],
} as const satisfies Record<string, readonly AlbumStage[]>;
export type AlbumBucket = keyof typeof ALBUM_STAGE_BUCKETS;

/** Who works each production stage, and which task role is assigned for it. */
export const ALBUM_ROLES = [
  { key: "design", label: "التصميم", staffField: "designerStaffId", stages: ["selected", "designing", "awaiting_approval", "approved"] },
  { key: "printing", label: "الطباعة", staffField: "printerStaffId", stages: ["printing"] },
  { key: "binding", label: "التجليد", staffField: "binderStaffId", stages: ["binding"] },
  { key: "quality", label: "فحص الجودة", staffField: "qualityStaffId", stages: ["quality"] },
] as const;
export type AlbumRole = (typeof ALBUM_ROLES)[number]["key"];

/**
 * Quick actions offered after scanning (and on the album panel). Each moves the
 * album to one stage, or only records a note/photo. `from` lists the stages the
 * action makes sense from; a manager can still set any stage from the stepper.
 */
export const ALBUM_ACTIONS = [
  { key: "receive", label: "استلام الألبوم", to: "received", from: ["received", "awaiting_selection"] },
  { key: "start_design", label: "بدء التصميم", to: "designing", from: ["received", "awaiting_selection", "selected"] },
  { key: "complete_design", label: "إكمال التصميم", to: "awaiting_approval", from: ["designing"] },
  { key: "customer_approved", label: "موافقة الزبون", to: "approved", from: ["awaiting_approval"] },
  { key: "start_printing", label: "بدء الطباعة", to: "printing", from: ["approved", "awaiting_approval"] },
  { key: "complete_printing", label: "إكمال الطباعة", to: "binding", from: ["printing"] },
  { key: "complete_binding", label: "إكمال التجليد", to: "quality", from: ["binding"] },
  { key: "quality_check", label: "فحص الجودة", to: "ready", from: ["quality"] },
  { key: "mark_ready", label: "جاهز للتسليم", to: "ready", from: ["quality", "binding", "printing"] },
  { key: "deliver", label: "تسليم للزبون", to: "delivered", from: ["ready"] },
  { key: "note", label: "تسجيل ملاحظة", to: null, from: ALBUM_STAGE_KEYS },
  { key: "photo", label: "رفع صورة", to: null, from: ALBUM_STAGE_KEYS },
] as const satisfies ReadonlyArray<{ key: string; label: string; to: AlbumStage | null; from: readonly AlbumStage[] }>;
export type AlbumActionKey = (typeof ALBUM_ACTIONS)[number]["key"];

export function albumActionsFor(stage: string, status = "active") {
  if (status !== "active" || stage === "delivered") return ALBUM_ACTIONS.filter((action) => action.to === null);
  return ALBUM_ACTIONS.filter((action) => (action.from as readonly string[]).includes(stage));
}

export const ALBUM_CATALOG_KINDS = [
  { key: "type", label: "أنواع الألبومات" },
  { key: "size", label: "قياسات الألبوم" },
  { key: "cover_type", label: "أنواع الأغلفة" },
  { key: "cover_color", label: "ألوان الأغلفة" },
  { key: "paper", label: "أنواع ورق الطباعة" },
  { key: "page_count", label: "عدد الصفحات" },
  { key: "box", label: "علب الألبوم" },
] as const;
export type AlbumCatalogKind = (typeof ALBUM_CATALOG_KINDS)[number]["key"];

/**
 * Starting points an administrator may add with one click from the settings
 * screen. Nothing reads these at run time: the form only offers what is saved
 * in album_catalog_options, so every specification stays editable.
 */
export const ALBUM_SUGGESTED_OPTIONS: Array<{ kind: AlbumCatalogKind; label: string }> = [
  { kind: "type", label: "عادي" }, { kind: "type", label: "فاخر" }, { kind: "type", label: "كريستال" }, { kind: "type", label: "جلد" },
  { kind: "size", label: "20 × 30" }, { kind: "size", label: "25 × 25" }, { kind: "size", label: "30 × 30" }, { kind: "size", label: "30 × 40" },
  { kind: "cover_type", label: "جلد" }, { kind: "cover_type", label: "كريستال" }, { kind: "cover_type", label: "قماش" },
  { kind: "cover_color", label: "أسود" }, { kind: "cover_color", label: "أبيض" }, { kind: "cover_color", label: "كحلي" }, { kind: "cover_color", label: "عنابي" },
  { kind: "paper", label: "مطفي" }, { kind: "paper", label: "لامع" }, { kind: "paper", label: "حريري" },
  { kind: "page_count", label: "20" }, { kind: "page_count", label: "30" }, { kind: "page_count", label: "40" },
  { kind: "box", label: "علبة خشب" }, { kind: "box", label: "علبة جلد" },
];

export const ALBUM_FINANCE_MODES = [
  { key: "invoice", label: "فاتورة مستقلة" },
  { key: "package", label: "مشمول بباقة الحجز" },
  { key: "free", label: "بدون مبلغ" },
] as const;
export type AlbumFinanceMode = (typeof ALBUM_FINANCE_MODES)[number]["key"];

export const ALBUM_LABEL_SIZES = [
  { key: "50x30", label: "50 × 30 ملم", width: 50, height: 30 },
  { key: "60x40", label: "60 × 40 ملم", width: 60, height: 40 },
  { key: "70x50", label: "70 × 50 ملم", width: 70, height: 50 },
] as const;

/** Album number shown everywhere and printed on labels: ALB-00001. */
export function albumNumber(id: number) {
  return `ALB-${String(id).padStart(5, "0")}`;
}
/** Code128-safe barcode value for the album (no dash, no customer data). */
export function albumBarcode(id: number) {
  return `ALB${String(id).padStart(5, "0")}`;
}
/** Each physical copy: ALB-00001-2. */
export function albumCopyCode(id: number, copyNo: number) {
  return `${albumNumber(id)}-${copyNo}`;
}
/** What the QR code carries: an app link with an opaque token only. */
export function albumQrPayload(origin: string, token: string) {
  return `${origin.replace(/\/$/, "")}/admin/albums?scan=${encodeURIComponent(token)}`;
}

// ----------------------------------------------------------------- permissions

export const ALBUM_PERMISSIONS = ["albums", "albums.manage", "albums.financials", "albums.deliver"] as const;
export const ALBUM_PERMISSION_LABELS: Record<(typeof ALBUM_PERMISSIONS)[number], string> = {
  albums: "الألبومات: العرض وتحديث المراحل",
  "albums.manage": "الألبومات: الإنشاء والتعديل والتكليف والإعدادات",
  "albums.financials": "الألبومات: عرض المالية وتسجيل الدفعات",
  "albums.deliver": "الألبومات: تسليم الألبوم للزبون",
};

const SUPERVISOR_ROLES = new Set(["admin", "manager", "main_admin", "super_admin", "main_manager"]);

/**
 * Existing photography permissions keep working: photography staff see and
 * update albums, the photography assignment managers manage them, and the
 * photography finance/delivery permissions carry over.
 */
export function albumAccess(user: { role?: string | null; permissions?: string[] | null; isActive?: boolean | null } | null | undefined) {
  if (!user || user.isActive === false) return { view: false, work: false, manage: false, financials: false, deliver: false, viewAll: false };
  const permissions = new Set(user.permissions ?? []);
  const supervisor = SUPERVISOR_ROLES.has(String(user.role ?? "").toLowerCase());
  const manage = supervisor || permissions.has("albums.manage") || permissions.has("photography.assignment.manage");
  const financials = supervisor || permissions.has("albums.financials") || permissions.has("photography.financials.view");
  const deliver = manage || permissions.has("albums.deliver") || permissions.has("photography.delivery.confirm");
  const viewAll = manage || financials || permissions.has("albums") || permissions.has("photography") || permissions.has("photography.reports.view");
  const work = viewAll || deliver || ["photography.portal.view", "photography.status.update"].some((key) => permissions.has(key));
  return { view: work, work, manage, financials, deliver, viewAll };
}
export type AlbumAccess = ReturnType<typeof albumAccess>;

// ----------------------------------------------------------------------- money

/** Integer fils/cents so totals never drift. Accepts "1,500", "١٥٠٠", 1500. */
export function albumCents(value: unknown) {
  const text = String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[,٬\s]/g, "");
  const number = Number(text);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}
export const centsToAmount = (cents: number) => (cents / 100).toFixed(2);

export type AlbumMoneyInput = {
  salePrice: unknown; designCost: unknown; printingCost: unknown; coverCost: unknown; bindingCost: unknown; extraCosts: unknown;
  paidAmount?: unknown; financeMode?: string | null;
};
/** One definition of the album's totals, used by the panel, reports and print. */
export function albumFinance(input: AlbumMoneyInput) {
  const sale = input.financeMode === "invoice" ? albumCents(input.salePrice) : 0;
  const cost = [input.designCost, input.printingCost, input.coverCost, input.bindingCost, input.extraCosts].reduce<number>((sum, value) => sum + albumCents(value), 0);
  const paid = Math.min(albumCents(input.paidAmount), sale);
  return {
    salePrice: centsToAmount(sale),
    totalCost: centsToAmount(cost),
    paidAmount: centsToAmount(paid),
    remainingAmount: centsToAmount(Math.max(0, sale - paid)),
    netProfit: centsToAmount(sale - cost),
  };
}

// --------------------------------------------------------------------- timing

export function baghdadToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
/** Late = past its delivery date and not yet ready or handed over. */
export function isAlbumDelayed(album: { dueDate?: string | null; stage: string; status?: string | null }, today = baghdadToday()) {
  if (album.status && album.status !== "active") return false;
  if (!album.dueDate || album.stage === "ready" || album.stage === "delivered") return false;
  return album.dueDate < today;
}

export function formatIqd(value: unknown) {
  const cents = albumCents(value);
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(cents / 100)} د.ع`;
}
