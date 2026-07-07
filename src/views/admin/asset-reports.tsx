import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpFromLine,
  ArrowDownToLine,
  AlertTriangle,
  Wrench,
  Users,
  Download,
  Printer,
  FileBarChart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "./_layout";
import { adminFetch, formatCurrency } from "./_lib";

type AssetRow = {
  productId: number;
  name: string;
  currentValue: number;
  serialNumber?: string | null;
  category?: string | null;
  status: string;
  maintenanceDue: boolean;
};
type CustodyRow = {
  id: number;
  productId: number;
  staffId: number;
  quantity: number;
  status: string;
  issuedAt?: string | null;
  returnedAt?: string | null;
  notes?: string | null;
};
type StaffRow = { id: number; fullName?: string; username?: string };

type ReportId = "checkout" | "return" | "missing" | "damaged" | "employee";

const REPORTS: { id: ReportId; label: string; icon: any }[] = [
  { id: "checkout", label: "تقرير الإخراج", icon: ArrowUpFromLine },
  { id: "return", label: "تقرير الاستلام", icon: ArrowDownToLine },
  { id: "missing", label: "الأصول المفقودة", icon: AlertTriangle },
  { id: "damaged", label: "الأصول التالفة", icon: Wrench },
  { id: "employee", label: "مسؤولية الموظفين", icon: Users },
];

function assetCode(id: number) {
  return `AJN-A${String(id).padStart(6, "0")}`;
}
function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ar");
}
function bookingFromNotes(notes?: string | null) {
  const m = (notes ?? "").match(/#\s*([\w-]+)/);
  return m ? `#${m[1]}` : "—";
}

export default function AssetReportsPage() {
  const [tab, setTab] = useState<ReportId>("checkout");

  const { data: assetsResp, isLoading: la } = useQuery<{ data: AssetRow[] }>({
    queryKey: ["admin", "assets"],
    queryFn: () => adminFetch("/admin/assets"),
    staleTime: 60_000,
  });
  const { data: custodyResp, isLoading: lc } = useQuery<{ data: CustodyRow[] }>({
    queryKey: ["admin", "gate-custody-report"],
    queryFn: () => adminFetch("/admin/custody"),
    staleTime: 30_000,
  });
  const { data: staff = [] } = useQuery<StaffRow[]>({
    queryKey: ["admin", "gate-staff"],
    queryFn: () => adminFetch("/admin/staff"),
    staleTime: 5 * 60_000,
  });

  const assets = assetsResp?.data ?? [];
  const custody = custodyResp?.data ?? [];
  const loading = la || lc;

  const assetName = useMemo(() => {
    const m = new Map(assets.map((a) => [a.productId, a.name]));
    return (id: number) => m.get(id) ?? `#${id}`;
  }, [assets]);
  const staffName = useMemo(() => {
    const m = new Map(staff.map((s) => [s.id, s.fullName || s.username || `#${s.id}`]));
    return (id: number) => m.get(id) ?? `#${id}`;
  }, [staff]);

  // ── Build each report's rows (headers + cells) ──────────────────────────────
  const report = useMemo(() => {
    if (tab === "checkout") {
      const rows = [...custody].sort(
        (a, b) => new Date(b.issuedAt ?? 0).getTime() - new Date(a.issuedAt ?? 0).getTime(),
      );
      return {
        headers: ["الأصل", "الموظف", "الحجز", "وقت الإخراج", "الحالة"],
        rows: rows.map((c) => [
          assetName(c.productId),
          staffName(c.staffId),
          bookingFromNotes(c.notes),
          fmtDate(c.issuedAt),
          c.status === "returned" ? "أُرجع" : "بالعهدة",
        ]),
      };
    }
    if (tab === "return") {
      const rows = custody
        .filter((c) => c.status === "returned" || c.returnedAt)
        .sort((a, b) => new Date(b.returnedAt ?? 0).getTime() - new Date(a.returnedAt ?? 0).getTime());
      return {
        headers: ["الأصل", "الموظف", "وقت الإخراج", "وقت الاستلام"],
        rows: rows.map((c) => [assetName(c.productId), staffName(c.staffId), fmtDate(c.issuedAt), fmtDate(c.returnedAt)]),
      };
    }
    if (tab === "missing") {
      const rows = assets.filter((a) => a.status === "lost");
      return {
        headers: ["الأصل", "الرمز", "الرقم التسلسلي", "الفئة"],
        rows: rows.map((a) => [a.name, assetCode(a.productId), a.serialNumber ?? "—", a.category ?? "—"]),
      };
    }
    if (tab === "damaged") {
      const rows = assets.filter((a) => a.status === "maintenance" || a.maintenanceDue);
      return {
        headers: ["الأصل", "الرمز", "الحالة", "القيمة الحالية"],
        rows: rows.map((a) => [
          a.name,
          assetCode(a.productId),
          a.status === "maintenance" ? "صيانة" : a.maintenanceDue ? "تحتاج صيانة" : a.status,
          formatCurrency(a.currentValue),
        ]),
      };
    }
    // employee responsibility — active custody grouped by staff
    const grouped = new Map<number, CustodyRow[]>();
    for (const c of custody) {
      if (c.status !== "issued") continue;
      const list = grouped.get(c.staffId) ?? [];
      list.push(c);
      grouped.set(c.staffId, list);
    }
    return {
      headers: ["الموظف", "عدد الأصول", "الأصول بعهدته"],
      rows: [...grouped.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([staffId, list]) => [
          staffName(staffId),
          String(list.length),
          list.map((c) => assetName(c.productId)).join("، "),
        ]),
    };
  }, [tab, custody, assets, assetName, staffName]);

  function exportCsv() {
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [report.headers.map(esc).join(","), ...report.rows.map((r) => r.map(esc).join(","))];
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${tab}-report.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const activeLabel = REPORTS.find((r) => r.id === tab)?.label ?? "";

  return (
    <div className="space-y-4" dir="rtl">
      <div className="no-print flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileBarChart className="w-6 h-6 text-primary" /> تقارير حركة الأصول
          </h1>
          <p className="text-sm text-muted-foreground mt-1">تقارير الإخراج والاستلام والمفقود والتالف ومسؤولية الموظفين.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!report.rows.length} className="gap-2">
            <Download className="w-4 h-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!report.rows.length} className="gap-2">
            <Printer className="w-4 h-4" /> طباعة
          </Button>
        </div>
      </div>

      <div className="no-print flex items-center gap-2 flex-wrap">
        {REPORTS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === id ? "border-primary/60 bg-primary/10 text-primary" : "border-border/40 bg-background/50 text-muted-foreground hover:border-primary/35"
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <div className="bg-card rounded-xl border border-border/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-foreground">{activeLabel}</h2>
          <span className="text-sm text-muted-foreground">{report.rows.length} سجل</span>
        </div>
        {loading ? (
          <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
        ) : report.rows.length === 0 ? (
          <EmptyState message="لا توجد بيانات لهذا التقرير" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs border-b border-border/40">
                  {report.headers.map((h) => (
                    <th key={h} className="text-right py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/20">
                    {r.map((cell, j) => (
                      <td key={j} className="py-2 pl-3 text-foreground align-top">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } }`}</style>
    </div>
  );
}
