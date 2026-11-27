import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { ALBUM_STAGES, albumStageIndex, formatIqd, type AlbumAccess, type AlbumCatalogKind } from "@/lib/albums";
import type { AlbumPrintAlbum, AlbumPrintBrand } from "@/lib/album-print";
import { FALLBACK_LOGO_URL, usePublicSettings } from "@/lib/public-settings";
import { adminFetch } from "@/views/admin/_lib";

export type Attachment = { url: string; fileName?: string; mediaType?: string };
export type Album = AlbumPrintAlbum & {
  id: number; customerId: number | null; bookingId: number | null; designerStaffId: number | null; printerStaffId: number | null;
  binderStaffId: number | null; qualityStaffId: number | null; attachments: Attachment[]; stageLabel: string; stageChangedAt: string;
  status: string; delayed: boolean; hasOutstanding: boolean; deliveryPhotoUrl: string | null; deliverySignatureUrl: string | null;
  cancelReason: string | null; createdByName: string | null; createdAt: string;
  // Present only for users with album finance permission.
  invoiceId?: number | null; designCost?: string; printingCost?: string; coverCost?: string; bindingCost?: string; extraCosts?: string;
  totalCost?: string; netProfit?: string; paymentStatus?: string; pendingAmount?: string; bookingTotal?: string | null;
};
export type AlbumEvent = { id: number; type: string; fromStage: string | null; toStage: string | null; note: string | null; attachments: Attachment[]; staffName: string; createdAt: string };
export type AlbumCopy = { id: number; copyNo: number; code: string; qrToken: string };
export type AlbumMaterial = { id: number; productId: number; productName: string; quantity: number; unitCost?: string; returnedAt: string | null; createdByName: string | null; createdAt: string };
export type AlbumTask = { id: number; role: string; staffId: number; staffName: string; workTaskId: number | null; workOrderNo: string | null; workStatus: string | null; createdAt: string };
export type AlbumDetail = {
  album: Album; events: AlbumEvent[]; copies: AlbumCopy[]; materials: AlbumMaterial[]; materialsCost: string | null; tasks: AlbumTask[];
  actions: Array<{ key: string; label: string; to: string | null }>; scannedCopy?: number | null;
};
export type CatalogOption = { id: number; kind: AlbumCatalogKind; label: string; isActive: boolean; sortOrder: number; defaultPrice: string; manufacturingCost: string; productId: number | null; productName: string | null; productStock: number | null; materialQuantity: number };
export type StaffOption = { id: number; name: string; role: string; department: string | null };
export type AlbumMeta = { access: AlbumAccess; catalog: CatalogOption[]; staff: StaffOption[]; today: string };

export const albumKeys = {
  all: ["albums"] as const,
  meta: ["albums", "meta"] as const,
  list: (params: string) => ["albums", "list", params] as const,
  detail: (id: number) => ["albums", "detail", id] as const,
  settings: ["albums", "settings"] as const,
  reports: (params: string) => ["albums", "reports", params] as const,
};

export function useAlbumMeta() {
  return useQuery({ queryKey: albumKeys.meta, queryFn: () => adminFetch<AlbumMeta>("/admin/albums/meta"), staleTime: 60_000 });
}
export function useAlbumDetail(id: number | null) {
  return useQuery({ queryKey: albumKeys.detail(id ?? 0), queryFn: () => adminFetch<AlbumDetail>(`/admin/albums/${id}`), enabled: Boolean(id) });
}

/** Company identity for the printed documents, from the existing public settings. */
export function useAlbumBrand(): AlbumPrintBrand {
  const { data } = usePublicSettings();
  const brand = (data?.receipt_brand ?? {}) as { name?: string; address?: string; phones?: string[] | string };
  const phones = Array.isArray(brand.phones) ? brand.phones.join(" · ") : brand.phones;
  return { name: brand.name || data?.site_name || "AJN", logo: data?.logo_url || FALLBACK_LOGO_URL, phone: phones || data?.phone || "", address: brand.address || data?.address || "" };
}

export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const money = (value: unknown) => formatIqd(value);

const STAGE_TONE: Record<string, string> = {
  received: "bg-muted text-muted-foreground",
  awaiting_selection: "bg-muted text-foreground ring-1 ring-inset ring-border",
  selected: "bg-muted text-foreground ring-1 ring-inset ring-border",
  designing: "bg-primary/12 text-primary",
  awaiting_approval: "bg-status-warning/15 text-status-warning",
  approved: "bg-primary/12 text-primary",
  printing: "bg-foreground/[0.07] text-foreground",
  binding: "bg-foreground/[0.07] text-foreground",
  quality: "bg-status-warning/15 text-status-warning",
  ready: "bg-status-success/15 text-status-success",
  delivered: "bg-status-success/15 text-status-success",
};
export function StageBadge({ stage, label, delayed }: { stage: string; label?: string; delayed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STAGE_TONE[stage] ?? "bg-muted text-foreground"}`}>{label ?? ALBUM_STAGES.find((item) => item.key === stage)?.label ?? stage}</span>
      {delayed ? <span className="rounded-full bg-destructive/12 px-2 py-1 text-[11px] font-bold text-destructive">متأخر</span> : null}
    </span>
  );
}

/** The 11 production stages. Horizontal on wide screens, a vertical list on phones. */
export function StageStepper({ stage, events, onPick, disabled }: { stage: string; events?: AlbumEvent[]; onPick?: (stage: string) => void; disabled?: boolean }) {
  const current = albumStageIndex(stage);
  const reachedAt = (key: string) => [...(events ?? [])].reverse().find((event) => event.toStage === key)?.createdAt;
  return (
    <ol className="grid gap-2 sm:grid-cols-[repeat(11,minmax(0,1fr))] sm:gap-0" aria-label="مراحل تنفيذ الألبوم">
      {ALBUM_STAGES.map((item, index) => {
        const done = index < current;
        const active = index === current;
        const when = reachedAt(item.key);
        return (
          <li key={item.key} className="relative flex items-center gap-3 sm:flex-col sm:gap-1.5 sm:text-center">
            {index > 0 ? <span aria-hidden className={`absolute hidden h-0.5 sm:block sm:top-4 sm:right-1/2 sm:w-full ${index <= current ? "bg-primary" : "bg-border"}`} style={{ transform: "translateX(0)" }} /> : null}
            <button
              type="button"
              disabled={disabled || !onPick || active}
              onClick={() => onPick?.(item.key)}
              aria-current={active ? "step" : undefined}
              aria-label={`${item.label}${active ? " (الحالية)" : ""}`}
              className={`relative z-10 grid h-8 w-8 flex-none place-items-center rounded-full border-2 text-xs font-bold transition-[transform,background-color] duration-150 ease-out enabled:active:scale-[0.96] ${
                active ? "border-primary bg-primary text-primary-foreground" : done ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
              } ${onPick && !disabled && !active ? "cursor-pointer hover:border-primary/60" : ""}`}
            >
              {done ? <Check className="h-4 w-4" /> : index + 1}
            </button>
            <span className="min-w-0 sm:px-0.5">
              <span className={`block text-xs leading-tight ${active ? "font-bold text-foreground" : done ? "text-foreground" : "text-muted-foreground"}`}>{item.short}</span>
              {when ? <span className="block text-[11px] tabular-nums text-muted-foreground" dir="ltr">{new Date(when).toLocaleDateString("en-CA")}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Options come only from the administrator's settings; an empty list says where to add them. */
export function CatalogSelect({ kind, value, onChange, catalog, label, required, id }: { kind: AlbumCatalogKind; value: string; onChange: (value: string, option?: CatalogOption) => void; catalog: CatalogOption[]; label: string; required?: boolean; id: string }) {
  const options = catalog.filter((option) => option.kind === kind && option.isActive);
  const legacy = value && !options.some((option) => option.label === value);
  return (
    <Field label={label} htmlFor={id} required={required} hint={options.length ? undefined : "لا توجد خيارات بعد — أضفها من «إعدادات الألبومات»"}>
      <select id={id} value={value} required={required} onChange={(event) => onChange(event.target.value, options.find((option) => option.label === event.target.value))} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
        <option value="">{options.length ? "اختر…" : "—"}</option>
        {legacy ? <option value={value}>{value}</option> : null}
        {options.map((option) => <option key={option.id} value={option.label}>{option.label}</option>)}
      </select>
    </Field>
  );
}

export function StaffSelect({ value, onChange, staff, label, id }: { value: number | null; onChange: (value: number | null) => void; staff: StaffOption[]; label: string; id: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
        <option value="">بدون تحديد</option>
        {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select>
    </Field>
  );
}

export function Field({ label, htmlFor, required, hint, error, children, className = "" }: { label: string; htmlFor?: string; required?: boolean; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="block text-xs font-bold text-foreground">{label}{required ? <span className="text-destructive"> *</span> : null}</label>
      {children}
      {error ? <p className="text-xs font-bold text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function LoadingBlock({ label = "جارٍ التحميل…" }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>;
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <p className="font-bold text-destructive">{message}</p>
      {onRetry ? <button type="button" onClick={onRetry} className="mt-2 text-xs font-bold text-primary underline-offset-4 hover:underline">إعادة المحاولة</button> : null}
    </div>
  );
}

export function eventTitle(event: AlbumEvent) {
  const stage = (key: string | null) => ALBUM_STAGES.find((item) => item.key === key)?.label ?? key ?? "";
  switch (event.type) {
    case "created": return "إنشاء الطلب";
    case "stage": return `${stage(event.fromStage)} ← ${stage(event.toStage)}`;
    case "delivered": return "تسليم الألبوم";
    case "assigned": return "تكليف";
    case "payment_requested": return "طلب دفعة";
    case "material": return "مواد المخزون";
    case "note": return "ملاحظة";
    case "photo": return "صورة";
    case "cancelled": return "إلغاء";
    case "updated": return "تعديل";
    default: return event.type;
  }
}
