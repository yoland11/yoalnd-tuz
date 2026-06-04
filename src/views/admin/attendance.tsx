import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, LogIn, LogOut, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type Staff = { id: number; username: string; fullName: string };
type Attendance = {
  id: number;
  staffId: number;
  staffName: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: string;
  notes: string;
  hours: number;
};

const STATUS_LABELS: Record<string, string> = {
  present: "حاضر",
  out: "منصرف",
  late: "متأخر",
  absent: "غائب",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ar-IQ", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AttendancePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filters, setFilters] = useState({ staffId: "", from: todayIso(), to: todayIso() });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.staffId) params.set("staffId", filters.staffId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    return params.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<{ data: Attendance[]; staff: Staff[] }>({
    queryKey: ["admin", "attendance", queryString],
    queryFn: () => adminFetch(`/admin/attendance?${queryString}`),
    staleTime: 20_000,
  });

  const checkIn = useMutation({
    mutationFn: () => adminFetch("/admin/attendance/check-in", { method: "POST" }),
    onSuccess: () => {
      toast({ title: "تم تسجيل الحضور" });
      qc.invalidateQueries({ queryKey: ["admin", "attendance"] });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    },
    onError: (err: any) => toast({ title: "تعذر تسجيل الحضور", description: err?.message, variant: "destructive" }),
  });

  const checkOut = useMutation({
    mutationFn: () => adminFetch("/admin/attendance/check-out", { method: "POST" }),
    onSuccess: () => {
      toast({ title: "تم تسجيل الانصراف" });
      qc.invalidateQueries({ queryKey: ["admin", "attendance"] });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    },
    onError: (err: any) => toast({ title: "تعذر تسجيل الانصراف", description: err?.message, variant: "destructive" }),
  });

  const totalHours = (data?.data ?? []).reduce((sum, row) => sum + row.hours, 0);
  const presentNow = (data?.data ?? []).filter((row) => !row.checkOutAt && row.status === "present").length;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">الحضور والانصراف</h1>
          <p className="text-sm text-muted-foreground mt-1">تسجيل حضور الموظفين واحتساب الساعات اليومية والشهرية.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" onClick={() => checkIn.mutate()} disabled={checkIn.isPending} className="gap-2">
            <LogIn className="w-4 h-4" /> حضور
          </Button>
          <Button type="button" variant="outline" onClick={() => checkOut.mutate()} disabled={checkOut.isPending} className="gap-2">
            <LogOut className="w-4 h-4" /> انصراف
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="bg-card rounded-xl border border-border/30 p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-2"><UserCheck className="w-4 h-4 text-primary" /> الحاضرون الآن</p>
          <p className="text-2xl font-bold text-foreground mt-2">{presentNow.toLocaleString("ar-IQ")}</p>
        </div>
        <div className="bg-card rounded-xl border border-border/30 p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-2"><Clock3 className="w-4 h-4 text-primary" /> مجموع الساعات</p>
          <p className="text-2xl font-bold text-foreground mt-2">{totalHours.toLocaleString("ar-IQ", { maximumFractionDigits: 1 })}</p>
        </div>
        <div className="bg-card rounded-xl border border-border/30 p-4">
          <p className="text-xs text-muted-foreground">عدد السجلات</p>
          <p className="text-2xl font-bold text-foreground mt-2">{(data?.data.length ?? 0).toLocaleString("ar-IQ")}</p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border/30 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <select value={filters.staffId} onChange={(e) => setFilters({ ...filters, staffId: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
            <option value="">كل الموظفين</option>
            {(data?.staff ?? []).map((staff) => <option key={staff.id} value={staff.id}>{staff.fullName || staff.username}</option>)}
          </select>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
          <Button type="button" variant="outline" onClick={() => setFilters({ staffId: "", from: todayIso(), to: todayIso() })}>اليوم</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-16 rounded-xl" />)}</div>
      ) : !data?.data.length ? (
        <EmptyState message="لا توجد سجلات حضور" />
      ) : (
        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-right p-3 font-medium">الموظف</th>
                  <th className="text-right p-3 font-medium">الحضور</th>
                  <th className="text-right p-3 font-medium">الانصراف</th>
                  <th className="text-right p-3 font-medium">الحالة</th>
                  <th className="text-right p-3 font-medium">الساعات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {data.data.map((row) => (
                  <tr key={row.id} className="hover:bg-background/30">
                    <td className="p-3 font-medium text-foreground">{row.staffName || `موظف #${row.staffId}`}</td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">{formatDate(row.checkInAt)}</td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">{formatDate(row.checkOutAt)}</td>
                    <td className="p-3"><span className="rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs">{STATUS_LABELS[row.status] ?? row.status}</span></td>
                    <td className="p-3 text-foreground">{row.hours.toLocaleString("ar-IQ", { maximumFractionDigits: 1 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
