import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, Check, History, Loader2, Pencil, QrCode, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, fetchAdminMe, hasPerm, type AdminMe } from "./_lib";

type Page = {
  id: number;
  pageIndex: number;
  side: string;
  widthMm: number | null;
  heightMm: number | null;
  hasImage: boolean;
};

type Version = {
  id: number;
  version: number;
  changeSummary: string | null;
  createdByName: string;
  createdAt: string;
  snapshot: Record<string, unknown>;
};

type DocDetail = {
  id: number;
  documentType: string;
  ownerType: string | null;
  ownerId: number | null;
  ownerName: string | null;
  notes: string | null;
  title: string | null;
  documentNumber: string | null;
  fullName: string | null;
  nationalId: string | null;
  passportNumber: string | null;
  phone: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  daysLeft: number | null;
  tags: string[];
  version: number;
  pageCount: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string | null;
  hasFront: boolean;
  hasBack: boolean;
  pages: Page[];
  versions: Version[];
};

const FIELD =
  "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const EDITABLE: Array<{ key: keyof DocDetail; label: string; type?: string; ltr?: boolean }> = [
  { key: "title", label: "العنوان" },
  { key: "documentNumber", label: "رقم المستمسك", ltr: true },
  { key: "fullName", label: "الاسم الكامل" },
  { key: "nationalId", label: "الرقم الوطني", ltr: true },
  { key: "passportNumber", label: "رقم الجواز", ltr: true },
  { key: "phone", label: "رقم الهاتف", ltr: true },
  { key: "issueDate", label: "تاريخ الإصدار", type: "date" },
  { key: "expiryDate", label: "تاريخ الانتهاء", type: "date" },
];

export default function DocumentDetailPage({ documentId }: { documentId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [changeSummary, setChangeSummary] = useState("");
  const [showQr, setShowQr] = useState(false);

  const { data: me } = useQuery<AdminMe | null>({
    queryKey: ["admin", "me"],
    queryFn: () => fetchAdminMe(),
    staleTime: 5 * 60 * 1000,
  });
  const canEdit = hasPerm(me ?? null, "doc_scanner_edit");

  const key = ["admin", "document-detail", documentId] as const;
  const { data, isLoading, isError } = useQuery<DocDetail>({
    queryKey: key,
    queryFn: () => adminFetch(`/admin/document-scanner/${documentId}`),
  });

  const { data: qr } = useQuery<{ dataUrl: string; targetUrl: string }>({
    queryKey: [...key, "qr"],
    queryFn: () => adminFetch(`/admin/document-scanner/${documentId}/qr`),
    enabled: showQr,
  });

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch(`/admin/document-scanner/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      setEditing(false);
      setChangeSummary("");
      toast({ title: "تم حفظ التعديل", description: "أُنشئ إصدار جديد مع حفظ النسخة السابقة" });
    },
    onError: (e: any) =>
      toast({ title: "تعذر حفظ التعديل", description: e?.message, variant: "destructive" }),
  });

  function startEdit() {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const f of EDITABLE) next[f.key as string] = String(data[f.key] ?? "");
    next.tags = (data.tags ?? []).join("، ");
    next.notes = data.notes ?? "";
    setDraft(next);
    setEditing(true);
  }

  function submit() {
    save.mutate({
      ...Object.fromEntries(
        EDITABLE.map((f) => [f.key, draft[f.key as string] || null]),
      ),
      notes: draft.notes || null,
      tags: (draft.tags ?? "")
        .split(/[،,]/)
        .map((t) => t.trim())
        .filter(Boolean),
      changeSummary: changeSummary || "تعديل بيانات المستمسك",
    });
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-4 text-sm text-status-danger flex items-center gap-2" dir="rtl">
        <XCircle className="w-4 h-4" /> تعذّر تحميل المستمسك أو لا تملك صلاحية عرضه.
      </div>
    );
  }
  if (isLoading || !data) return <Skeleton className="h-96 rounded-xl" />;

  const expiredSoon = data.daysLeft !== null && data.daysLeft <= 30;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <a
            href="/admin/document-library"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-1"
          >
            <ArrowRight className="w-3.5 h-3.5" /> المستمسكات المحفوظة
          </a>
          <h1 className="text-2xl font-bold text-foreground">
            {data.title || data.documentType}
          </h1>
          <p className="text-xs text-muted-foreground">
            الإصدار {data.version} · {data.pageCount} صفحة · {data.createdByName} ·{" "}
            {new Date(data.createdAt).toLocaleString("ar-IQ")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowQr((v) => !v)}>
            <QrCode className="w-3.5 h-3.5" /> رمز QR
          </Button>
          {canEdit && !editing && (
            <Button size="sm" className="gap-1.5" onClick={startEdit}>
              <Pencil className="w-3.5 h-3.5" /> تعديل
            </Button>
          )}
        </div>
      </div>

      {expiredSoon && (
        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {data.daysLeft! < 0
            ? `انتهت صلاحية هذا المستمسك منذ ${Math.abs(data.daysLeft!)} يوم`
            : `تنتهي صلاحية هذا المستمسك خلال ${data.daysLeft} يوم`}
        </div>
      )}

      {showQr && qr && (
        <section className="bg-card rounded-xl border border-border/30 p-4 flex items-center gap-4 flex-wrap">
          <img src={qr.dataUrl} alt="QR" className="w-32 h-32 bg-white rounded" />
          <div className="text-xs text-muted-foreground">
            <p className="mb-1">مسح الرمز يفتح هذا المستمسك داخل النظام.</p>
            <p>الرابط محمي بالصلاحيات — ليس رابط مشاركة عاماً.</p>
          </div>
        </section>
      )}

      {/* Metadata */}
      <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
        <h2 className="font-semibold text-foreground text-sm">بيانات المستمسك</h2>
        {editing ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {EDITABLE.map((f) => (
                <label key={String(f.key)} className="block">
                  <span className="block text-[11px] text-muted-foreground mb-1">{f.label}</span>
                  <input
                    type={f.type ?? "text"}
                    dir={f.ltr ? "ltr" : undefined}
                    value={draft[f.key as string] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key as string]: e.target.value }))}
                    className={FIELD}
                  />
                </label>
              ))}
              <label className="block">
                <span className="block text-[11px] text-muted-foreground mb-1">وسوم (بفاصلة)</span>
                <input
                  value={draft.tags ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
                  className={FIELD}
                />
              </label>
            </div>
            <label className="block">
              <span className="block text-[11px] text-muted-foreground mb-1">ملاحظات</span>
              <textarea
                rows={2}
                value={draft.notes ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-muted-foreground mb-1">سبب التعديل (يظهر في السجل)</span>
              <input
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                placeholder="مثال: تصحيح تاريخ الانتهاء"
                className={FIELD}
              />
            </label>
            <div className="flex gap-2">
              <Button size="sm" className="gap-1.5" disabled={save.isPending} onClick={submit}>
                {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                حفظ
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>إلغاء</Button>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {EDITABLE.map((f) => (
              <Info key={String(f.key)} label={f.label} value={String(data[f.key] ?? "—")} />
            ))}
            <Info label="الوسوم" value={(data.tags ?? []).join("، ") || "—"} />
            <Info
              label="مرتبط بـ"
              value={data.ownerType ? `${data.ownerName ?? data.ownerType} ${data.ownerId ? `#${data.ownerId}` : ""}` : "غير مرتبط"}
            />
            {data.notes && <Info label="ملاحظات" value={data.notes} />}
          </div>
        )}
      </section>

      {/* Pages */}
      <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
        <h2 className="font-semibold text-foreground text-sm">الصفحات ({data.pages.length})</h2>
        {data.pages.length === 0 ? (
          <p className="text-xs text-muted-foreground">لا توجد صفحات مخزّنة.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {data.pages.map((page) => (
              <figure key={page.id} className="space-y-1">
                {/* Same-origin request; the session cookie authorises it. */}
                <img
                  src={`/api/admin/document-scanner/${documentId}/page/${page.id}`}
                  alt={`صفحة ${page.pageIndex + 1}`}
                  className="w-full rounded border border-border/30 bg-white"
                />
                <figcaption className="text-[11px] text-muted-foreground text-center">
                  صفحة {page.pageIndex + 1}
                  {page.widthMm ? ` · ${page.widthMm} × ${page.heightMm} ملم` : ""}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      {/* Version history */}
      <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
        <h2 className="font-semibold text-foreground text-sm flex items-center gap-2">
          <History className="w-4 h-4 text-primary" /> سجل الإصدارات ({data.versions.length})
        </h2>
        {data.versions.length === 0 ? (
          <p className="text-xs text-muted-foreground">لا يوجد سجل.</p>
        ) : (
          <ol className="space-y-2">
            {data.versions.map((v) => (
              <li key={v.id} className="rounded-lg border border-border/20 bg-background/40 p-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-semibold text-foreground">الإصدار {v.version}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {v.createdByName} · {new Date(v.createdAt).toLocaleString("ar-IQ")}
                  </span>
                </div>
                {v.changeSummary && (
                  <p className="text-[11px] text-muted-foreground mt-1">{v.changeSummary}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/20 bg-background/40 p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-xs text-foreground mt-0.5 break-words">{value}</p>
    </div>
  );
}
