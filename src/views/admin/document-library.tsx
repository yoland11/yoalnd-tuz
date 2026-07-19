import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Eye, EyeOff, FileText, Loader2, RefreshCw, ScanLine,
  ShieldCheck, Trash2, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, fetchAdminMe, hasPerm, type AdminMe } from "./_lib";
import { EmptyState } from "./_layout";
import { DOCUMENT_TYPES } from "./document-scanner";

type SavedDoc = {
  id: number;
  documentType: string;
  ownerType: string | null;
  ownerId: number | null;
  ownerName: string | null;
  notes: string | null;
  widthMm: number | null;
  heightMm: number | null;
  createdByName: string;
  createdAt: string;
  hasFront: boolean;
  hasBack: boolean;
  title?: string | null;
  documentNumber?: string | null;
  fullName?: string | null;
  expiryDate?: string | null;
  daysLeft?: number | null;
  tags?: string[];
  version?: number;
  pageCount?: number;
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="bg-card rounded-lg border border-border/30 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold tabular-nums mt-0.5 ${tone === "warn" ? "text-status-warning" : "text-foreground"}`}>
        {value ?? 0}
      </p>
    </div>
  );
}

/** Colour-codes how close a document is to expiry. */
function ExpiryBadge({ date, daysLeft }: { date?: string | null; daysLeft?: number | null }) {
  if (!date) return null;
  const d = daysLeft ?? null;
  const tone =
    d === null ? "text-muted-foreground border-border/30"
    : d < 0 ? "bg-status-danger/10 text-status-danger border-status-danger/30"
    : d <= 7 ? "bg-status-danger/10 text-status-danger border-status-danger/30"
    : d <= 30 ? "bg-status-warning/10 text-status-warning border-status-warning/30"
    : d <= 90 ? "bg-status-warning/10 text-status-warning border-status-warning/30"
    : "bg-status-success/10 text-status-success border-status-success/30";
  const text =
    d === null ? date
    : d < 0 ? `منتهية منذ ${Math.abs(d)} يوم`
    : d === 0 ? "تنتهي اليوم"
    : `تنتهي خلال ${d} يوم`;
  return <span className={`text-[11px] px-2 py-0.5 rounded-full border ${tone}`}>{text}</span>;
}

const OWNER_LABELS: Record<string, string> = {
  customer: "عميل",
  staff: "موظف",
  order: "طلب",
  booking: "حجز",
  graduation_order: "طلب تخرج",
  printing_job: "عمل طباعة",
};

const FIELD =
  "bg-background border border-border/40 rounded-lg px-2.5 py-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const libraryKey = ["admin", "document-library"] as const;

export default function DocumentLibraryPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [docType, setDocType] = useState("");
  const [ownerType, setOwnerType] = useState("");
  const [search, setSearch] = useState("");
  const [expiry, setExpiry] = useState("");
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<SavedDoc | null>(null);
  const [reason, setReason] = useState("");

  const { data: me } = useQuery<AdminMe | null>({
    queryKey: ["admin", "me"],
    queryFn: () => fetchAdminMe(),
    staleTime: 5 * 60 * 1000,
  });
  const user = me ?? null;
  const canDelete = hasPerm(user, "doc_scanner_delete");

  const params = new URLSearchParams();
  if (docType) params.set("documentType", docType);
  if (ownerType) params.set("ownerType", ownerType);
  if (search.trim()) params.set("search", search.trim());
  if (expiry) params.set("expiry", expiry);

  const { data, isLoading, isError, isFetching, refetch } = useQuery<{ data: SavedDoc[] }>({
    queryKey: [...libraryKey, docType, ownerType, search, expiry],
    queryFn: () => adminFetch(`/admin/document-scanner?${params.toString()}`),
  });

  const { data: stats } = useQuery<Record<string, number>>({
    queryKey: [...libraryKey, "stats"],
    queryFn: () => adminFetch("/admin/document-scanner/stats"),
    staleTime: 60_000,
  });

  const remove = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      adminFetch(`/admin/document-scanner/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKey });
      setDeleteTarget(null);
      setReason("");
      toast({ title: "تم حذف المستمسك" });
    },
    onError: (e: any) => toast({ title: "تعذر الحذف", description: e?.message, variant: "destructive" }),
  });

  const typeLabel = useMemo(() => {
    const map = new Map(DOCUMENT_TYPES.map((t) => [t.value, t.label]));
    return (v: string) => map.get(v) ?? v;
  }, []);

  const rows = data?.data ?? [];

  function confirmDelete() {
    if (!deleteTarget) return;
    if (reason.trim().length < 3) {
      toast({ title: "أدخل سبب الحذف", description: "٣ أحرف على الأقل", variant: "destructive" });
      return;
    }
    if (!window.confirm("سيتم حذف المستمسك. هذا الإجراء يُسجَّل في سجل التدقيق. متابعة؟")) return;
    remove.mutate({ id: deleteTarget.id, reason: reason.trim() });
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" /> المستمسكات المحفوظة
        </h1>
        <div className="flex gap-2">
          <a
            href="/admin/document-scanner"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border/40 hover:bg-muted"
          >
            <ScanLine className="w-3.5 h-3.5" /> مسح جديد
          </a>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> تحديث
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-foreground flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <span>
          الصور مخزّنة بمسار محمي بلا رابط عام. لا تُعرض إلا عند الضغط على «إظهار»، ويُسجَّل كل اطّلاع في سجل التدقيق.
        </span>
      </div>

      {/* Dashboard counters */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          <Stat label="اليوم" value={stats.today} />
          <Stat label="هذا الشهر" value={stats.thisMonth} />
          <Stat label="العملاء" value={stats.customers} />
          <Stat label="الموظفون" value={stats.employees} />
          <Stat label="الأصول والمركبات" value={stats.assets} />
          <Stat label="العقود" value={stats.contracts} />
          <Stat
            label="تنتهي قريباً"
            value={stats.expiringSoon}
            tone={stats.expiringSoon > 0 ? "warn" : undefined}
          />
        </div>
      )}
      {Boolean(stats?.expired) && (
        <button
          type="button"
          onClick={() => setExpiry(expiry === "expired" ? "" : "expired")}
          className="w-full text-right rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-xs text-status-danger flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {stats!.expired} مستمسك منتهي الصلاحية — اضغط للعرض
        </button>
      )}

      {/* Search + filters */}
      <div className="space-y-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث: الاسم، رقم المستمسك، الرقم الوطني، الجواز، الهاتف، الوسوم، نص المستمسك…"
          className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap gap-2">
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={FIELD}>
            <option value="">كل الأنواع</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <select value={ownerType} onChange={(e) => setOwnerType(e.target.value)} className={FIELD}>
            <option value="">كل الجهات</option>
            {Object.entries(OWNER_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className={FIELD}>
            <option value="">كل الصلاحيات</option>
            <option value="expiring">تنتهي خلال 90 يوماً</option>
            <option value="expired">منتهية</option>
          </select>
        </div>
      </div>

      {isError ? (
        <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-4 text-sm text-status-danger flex items-center gap-2">
          <XCircle className="w-4 h-4" /> تعذّر تحميل المستمسكات المحفوظة.
        </div>
      ) : isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : rows.length === 0 ? (
        <EmptyState message="لا توجد مستمسكات محفوظة" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map((doc) => {
            const isOpen = Boolean(revealed[doc.id]);
            return (
              <div key={doc.id} className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">
                        {doc.title || typeLabel(doc.documentType)}
                      </p>
                      <ExpiryBadge date={doc.expiryDate} daysLeft={doc.daysLeft} />
                      {(doc.version ?? 1) > 1 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full border border-border/30 text-muted-foreground">
                          نسخة {doc.version}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {typeLabel(doc.documentType)}
                      {doc.documentNumber ? ` · ${doc.documentNumber}` : ""}
                      {doc.fullName ? ` · ${doc.fullName}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {doc.ownerType
                        ? `${OWNER_LABELS[doc.ownerType] ?? doc.ownerType}${doc.ownerName ? `: ${doc.ownerName}` : ""}${doc.ownerId ? ` (#${doc.ownerId})` : ""}`
                        : "غير مرتبط"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {doc.createdByName} · {new Date(doc.createdAt).toLocaleString("ar-IQ")}
                      {doc.pageCount ? ` · ${doc.pageCount} صفحة` : ""}
                    </p>
                    {(doc.tags?.length ?? 0) > 0 && (
                      <div className="flex gap-1 flex-wrap mt-1">
                        {doc.tags!.map((t) => (
                          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <a
                      href={`/admin/document-library/${doc.id}`}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/40 hover:bg-muted"
                    >
                      <FileText className="w-3.5 h-3.5" /> التفاصيل
                    </a>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => setRevealed((r) => ({ ...r, [doc.id]: !isOpen }))}
                    >
                      {isOpen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {isOpen ? "إخفاء" : "إظهار"}
                    </Button>
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => { setDeleteTarget(doc); setReason(""); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" /> حذف
                      </Button>
                    )}
                  </div>
                </div>

                {doc.notes && <p className="text-xs text-muted-foreground">{doc.notes}</p>}

                {isOpen ? (
                  <div className="grid grid-cols-2 gap-2">
                    {doc.hasFront && (
                      <figure className="space-y-1">
                        {/* Same-origin request: the session cookie authorises it. */}
                        <img
                          src={`/api/admin/document-scanner/${doc.id}/image/front`}
                          alt="الوجه الأمامي"
                          className="w-full rounded border border-border/30 bg-white"
                        />
                        <figcaption className="text-[11px] text-muted-foreground text-center">الوجه الأمامي</figcaption>
                      </figure>
                    )}
                    {doc.hasBack && (
                      <figure className="space-y-1">
                        <img
                          src={`/api/admin/document-scanner/${doc.id}/image/back`}
                          alt="الوجه الخلفي"
                          className="w-full rounded border border-border/30 bg-white"
                        />
                        <figcaption className="text-[11px] text-muted-foreground text-center">الوجه الخلفي</figcaption>
                      </figure>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {[doc.hasFront && "أمامي", doc.hasBack && "خلفي"].filter(Boolean).join(" + ") || "لا توجد صور"} — مخفي
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {deleteTarget && (
        <div className="rounded-xl border border-status-danger/30 bg-status-danger/5 p-4 space-y-3">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-status-danger" />
            حذف: {typeLabel(deleteTarget.documentType)}
            {deleteTarget.ownerName ? ` — ${deleteTarget.ownerName}` : ""}
          </p>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="سبب الحذف (إلزامي)"
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              disabled={remove.isPending || reason.trim().length < 3}
              onClick={confirmDelete}
            >
              {remove.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              تأكيد الحذف
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
          </div>
        </div>
      )}
    </div>
  );
}
