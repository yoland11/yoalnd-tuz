import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Boxes, ClipboardCheck, FileText, History, Loader2, Pencil, Plus, Printer, Search, Warehouse as WarehouseIcon, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmployeeSelect } from "@/components/employee-select";
import { WarehouseSelect } from "@/components/warehouse-select";
import { useToast } from "@/hooks/use-toast";
import type { EmployeeIdentity } from "@/lib/employee-identity";
import { quantityMovementLabel } from "@/lib/quantity-assets";
import { WAREHOUSE_MOVEMENT_LABELS } from "@/lib/warehouse-stock";
import { adminFetch, apiErrorMessage } from "./_lib";
import { printWarehouseReport, type WarehousePrintReport } from "./warehouse-print";

type WarehouseRow = {
  id: number; name: string; code: string | null; location: string | null; managerId: number | null; managerName: string | null; phone: string | null; notes: string | null;
  isActive: boolean; isMain: boolean; assets: number; items: number; shelf: number; checkedOut: number; damaged: number; maintenance: number; missing: number; reserved: number;
};
type Totals = {
  mainId: number;
  warehouses: WarehouseRow[];
  company: { assets: number; shelf: number; checkedOut: number; damaged: number; maintenance: number; missing: number; reserved: number; overdrawnItems: number };
  capabilities: { canManage: boolean; canAdjust: boolean; canTransfer: boolean; canApprove: boolean; canReport: boolean };
};
type StockRow = {
  productId: number; name: string; assetCode: string | null; barcode: string | null; isAsset: boolean; unit: string; inWarehouse: number; checkedOut: number; damaged: number; maintenance: number; missing: number;
  reserved: number; available: number; companyShelf: number; overdrawn: number; shares: Array<{ warehouseId: number; name: string; inWarehouse: number; total: number }>;
};
type Page<T> = { data: T[]; total: number; page: number; pageSize: number; totalPages: number };
type MovementRow = { id: number; productName: string; quantity: number; reason: string; relatedType: string | null; relatedId: number | null; warehouseName: string | null; toWarehouseName: string | null; notes: string | null; actorName: string; createdAt: string };
type TransferRow = { id: number; transferNo: string; productName: string; quantity: number; status: string; fromWarehouseName: string | null; toWarehouseName: string | null; responsibleName: string | null; transferDate: string | null; notes: string; createdAt: string | null };
type CountSummary = { id: number; countNo: string | null; warehouseName: string; status: string; requestedByName: string; reviewedByName: string; createdAt: string | null; lineCount: number; differenceCount: number };
type CountDetail = { id: number; countNo: string | null; warehouseName: string; status: string; lines: Array<{ productId: number; productName: string; expected: number; counted: number; difference: number }> };
type Discrepancies = {
  overdrawn: Array<{ productId: number; name: string; company: number; held: number; gap: number }>;
  counts: Array<{ countNo: string | null; status: string; warehouseName: string; productName: string; expected: number; counted: number; difference: number; requestedByName: string }>;
};

const number = (value: number) => Number(value ?? 0).toLocaleString("ar-IQ-u-nu-latn", { maximumFractionDigits: 3 });
const when = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ar-IQ-u-nu-latn", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const movementLabel = (reason: string) => quantityMovementLabel(reason) ?? WAREHOUSE_MOVEMENT_LABELS[reason] ?? reason;
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "بانتظار الاعتماد", cls: "bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  approved: { label: "منفّذ", cls: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" },
  rejected: { label: "مرفوض", cls: "bg-destructive/10 text-destructive" },
  matched: { label: "مطابق", cls: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" },
};
const newToken = () => crypto.randomUUID();

function StatusPill({ value }: { value: string }) {
  const meta = STATUS[value] ?? { label: value, cls: "bg-muted text-muted-foreground" };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${meta.cls}`}>{meta.label}</span>;
}

function Failed({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      {apiErrorMessage(error, "تعذّر تحميل البيانات")}
      <Button type="button" variant="outline" size="sm" className="ms-3" onClick={retry}>إعادة المحاولة</Button>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</p>;
}

function Stat({ label, value, note, icon: Icon }: { label: string; value: string; note?: string; icon: typeof Boxes }) {
  return (
    <div className="min-w-0 rounded-2xl border border-[#f4d6da] bg-card p-3.5 dark:border-border">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /><span className="truncate">{label}</span></div>
      <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{value}</p>
      {note ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function TableShell({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border border-[#f4d6da] bg-card dark:border-border"><table className="w-full min-w-[720px] text-right text-sm">{children}</table></div>;
}
const th = "whitespace-nowrap border-b border-border/60 bg-muted/40 p-2.5 text-xs font-semibold text-muted-foreground";
const td = "border-b border-border/30 p-2.5 align-middle";

function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 text-sm">
      <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>السابق</Button>
      <span className="tabular-nums text-muted-foreground">{page} / {totalPages}</span>
      <Button type="button" size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>التالي</Button>
    </div>
  );
}

const BLANK = { name: "", code: "", location: "", managerId: "", phone: "", notes: "", isActive: true };

function WarehouseDialog({ target, onClose }: { target: WarehouseRow | "new" | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const editing = target && target !== "new" ? target : null;
  const [form, setForm] = useState(BLANK);
  const [opened, setOpened] = useState<unknown>(null);
  if (target !== opened) {
    setOpened(target);
    setForm(editing ? { name: editing.name, code: editing.code ?? "", location: editing.location ?? "", managerId: editing.managerId ? String(editing.managerId) : "", phone: editing.phone ?? "", notes: editing.notes ?? "", isActive: editing.isActive } : BLANK);
  }
  const staff = useQuery<EmployeeIdentity[]>({ queryKey: ["admin", "staff", "warehouses"], queryFn: () => adminFetch("/admin/staff"), enabled: Boolean(target), staleTime: 60_000 });
  const save = useMutation({
    mutationFn: () => adminFetch(editing ? `/admin/warehouses/${editing.id}` : "/admin/warehouses", { method: editing ? "PATCH" : "POST", body: JSON.stringify({ ...form, managerId: form.managerId ? Number(form.managerId) : null }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "warehouses"] });
      toast({ title: editing ? "تم حفظ المخزن" : "تمت إضافة المخزن" });
      onClose();
    },
  });
  const set = (patch: Partial<typeof BLANK>) => setForm((current) => ({ ...current, ...patch }));
  return (
    <Dialog open={Boolean(target)} onOpenChange={(next) => { if (!next && !save.isPending) onClose(); }}>
      <DialogContent dir="rtl" className="max-h-[90dvh] w-[min(calc(100%-2rem),34rem)] overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle>{editing ? `تعديل ${editing.name}` : "إضافة مخزن"}</DialogTitle>
          <DialogDescription>{editing?.isMain ? "المخزن الرئيسي يضم كل الأرصدة الحالية ولا يمكن إيقافه." : "يبدأ المخزن الجديد برصيد صفر، وتصله الكميات بالتحويل."}</DialogDescription>
        </DialogHeader>
        <form id="warehouse-form" className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <label className="text-sm font-medium">اسم المخزن<Input required maxLength={120} className="mt-1" value={form.name} onChange={(event) => set({ name: event.target.value })} placeholder="المخزن الثاني" /></label>
          <label className="text-sm font-medium">رمز المخزن<Input dir="ltr" maxLength={30} className="mt-1" value={form.code} onChange={(event) => set({ code: event.target.value })} placeholder="WH-02" /></label>
          <label className="text-sm font-medium sm:col-span-2">الموقع<Input maxLength={500} className="mt-1" value={form.location} onChange={(event) => set({ location: event.target.value })} /></label>
          <div className="text-sm font-medium">المسؤول
            <div className="mt-1">{staff.isError ? <Failed error={staff.error} retry={() => void staff.refetch()} /> : <EmployeeSelect employees={staff.data ?? []} value={form.managerId} onValueChange={(value) => set({ managerId: value })} emptyLabel="بدون مسؤول" placeholder="اختر الموظف" />}</div>
          </div>
          <label className="text-sm font-medium">رقم الهاتف<Input dir="ltr" inputMode="tel" maxLength={40} className="mt-1" value={form.phone} onChange={(event) => set({ phone: event.target.value })} /></label>
          <label className="text-sm font-medium sm:col-span-2">ملاحظات<Input maxLength={2000} className="mt-1" value={form.notes} onChange={(event) => set({ notes: event.target.value })} /></label>
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium sm:col-span-2">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.isActive} disabled={editing?.isMain} onChange={(event) => set({ isActive: event.target.checked })} />
            مخزن نشط
          </label>
        </form>
        {save.isError ? <p role="alert" className="text-sm text-destructive">{apiErrorMessage(save.error)}</p> : null}
        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="submit" form="warehouse-form" disabled={save.isPending || !form.name.trim()}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} حفظ</Button>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StockTab({ warehouseId, warehouseName }: { warehouseId: string; warehouseName: string }) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (warehouseId) params.set("warehouseId", warehouseId);
  if (search.trim()) params.set("search", search.trim());
  if (kind) params.set("kind", kind);
  const stock = useQuery<Page<StockRow>>({ queryKey: ["admin", "warehouses", "stock", warehouseId, search.trim(), kind, page], queryFn: () => adminFetch(`/admin/warehouses/stock?${params}`) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56"><Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden /><Input aria-label="ابحث بالاسم أو الباركود" placeholder="ابحث بالاسم أو الباركود" className="pr-9" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
        <select aria-label="نوع المادة" className="h-10 rounded-lg border border-border bg-background px-2 text-sm" value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }}>
          <option value="">الكل</option><option value="assets">الأصول</option><option value="store">مواد المتجر</option>
        </select>
      </div>
      {stock.isError ? <Failed error={stock.error} retry={() => void stock.refetch()} /> : stock.isPending ? <Skeleton className="h-48 w-full" /> : !stock.data.data.length ? <Empty>لا توجد أرصدة في {warehouseName}{search ? " تطابق البحث" : ""}.</Empty> : (
        <>
          <TableShell>
            <thead><tr>{["المادة", warehouseId ? "كمية المخزن" : "الموجود", "محجوز", "المتاح", "خارج", "تالف", "صيانة", "مفقود", "إجمالي الشركة", "التوزيع"].map((label) => <th key={label} className={th}>{label}</th>)}</tr></thead>
            <tbody>{stock.data.data.map((row) => (
              <tr key={row.productId}>
                <td className={td}><span className="font-medium">{row.name}</span>{row.assetCode ? <span dir="ltr" className="block text-[11px] text-muted-foreground">{row.assetCode}</span> : null}{row.overdrawn > 0 ? <span className="block text-[11px] text-destructive">يتجاوز رصيد الشركة بـ {number(row.overdrawn)}</span> : null}</td>
                <td className={`${td} font-semibold tabular-nums`}>{number(row.inWarehouse)}</td>
                <td className={`${td} tabular-nums`}>{number(row.reserved)}</td>
                <td className={`${td} tabular-nums`}>{number(row.available)}</td>
                <td className={`${td} tabular-nums`}>{number(row.checkedOut)}</td>
                <td className={`${td} tabular-nums`}>{number(row.damaged)}</td>
                <td className={`${td} tabular-nums`}>{number(row.maintenance)}</td>
                <td className={`${td} tabular-nums`}>{number(row.missing)}</td>
                <td className={`${td} tabular-nums text-muted-foreground`}>{number(row.companyShelf)}</td>
                <td className={`${td} text-xs text-muted-foreground`}>{row.shares.filter((share) => share.inWarehouse > 0).map((share) => `${share.name} ${number(share.inWarehouse)}`).join(" · ") || "—"}</td>
              </tr>
            ))}</tbody>
          </TableShell>
          <Pager page={stock.data.page} totalPages={stock.data.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function MovementsTab({ warehouseId, warehouseName }: { warehouseId: string; warehouseName: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (warehouseId) params.set("warehouseId", warehouseId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const rows = useQuery<Page<MovementRow>>({ queryKey: ["admin", "warehouses", "movements", warehouseId, from, to, page], queryFn: () => adminFetch(`/admin/warehouses/movements?${params}`) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium">من تاريخ<Input type="date" className="mt-1 w-40" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
        <label className="text-xs font-medium">إلى تاريخ<Input type="date" className="mt-1 w-40" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
      </div>
      {rows.isError ? <Failed error={rows.error} retry={() => void rows.refetch()} /> : rows.isPending ? <Skeleton className="h-48 w-full" /> : !rows.data.data.length ? <Empty>لا توجد حركات في {warehouseName} ضمن هذه الفترة.</Empty> : (
        <>
          <TableShell>
            <thead><tr>{["التاريخ", "المادة", "الكمية", "نوع الحركة", "من مخزن", "إلى مخزن", "الموظف", "الحجز", "ملاحظات"].map((label) => <th key={label} className={th}>{label}</th>)}</tr></thead>
            <tbody>{rows.data.data.map((row) => (
              <tr key={row.id}>
                <td className={`${td} whitespace-nowrap text-xs text-muted-foreground tabular-nums`}>{when(row.createdAt)}</td>
                <td className={`${td} font-medium`}>{row.productName || "—"}</td>
                <td dir="ltr" className={`${td} text-right tabular-nums`}>{row.quantity > 0 && row.reason !== "warehouse_transfer_executed" ? "+" : ""}{number(row.quantity)}</td>
                <td className={td}>{movementLabel(row.reason)}</td>
                <td className={td}>{row.warehouseName ?? "—"}</td>
                <td className={td}>{row.toWarehouseName ?? "—"}</td>
                <td className={td}>{row.actorName || "النظام"}</td>
                <td className={`${td} text-xs`}>{(row.relatedType === "kosha_booking" || row.relatedType === "service_order") && row.relatedId ? <Link className="text-primary underline underline-offset-2" href={`/admin/bookings/${row.relatedType === "kosha_booking" ? "kosha" : "service"}/${row.relatedId}`}>#{row.relatedId}</Link> : "—"}</td>
                <td className={`${td} max-w-56 truncate text-xs text-muted-foreground`} title={row.notes ?? ""}>{row.notes ?? "—"}</td>
              </tr>
            ))}</tbody>
          </TableShell>
          <Pager page={rows.data.page} totalPages={rows.data.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function TransfersTab({ warehouseId, canTransfer }: { warehouseId: string; canTransfer: boolean }) {
  const params = warehouseId ? `?warehouseId=${warehouseId}` : "";
  const rows = useQuery<{ data: TransferRow[] }>({ queryKey: ["admin", "warehouses", "transfers", warehouseId], queryFn: () => adminFetch(`/admin/warehouses/transfers${params}`) });
  return (
    <div className="space-y-3">
      {canTransfer ? <Button type="button" asChild variant="outline"><Link href="/admin/warehouse-transfers"><ArrowLeftRight className="h-4 w-4" />تحويل جديد</Link></Button> : null}
      {rows.isError ? <Failed error={rows.error} retry={() => void rows.refetch()} /> : rows.isPending ? <Skeleton className="h-40 w-full" /> : !rows.data.data.length ? <Empty>لا توجد تحويلات بعد.</Empty> : (
        <TableShell>
          <thead><tr>{["الرقم", "المادة", "الكمية", "من", "إلى", "المسؤول", "التاريخ", "الحالة"].map((label) => <th key={label} className={th}>{label}</th>)}</tr></thead>
          <tbody>{rows.data.data.slice(0, 50).map((row) => (
            <tr key={row.id}>
              <td dir="ltr" className={`${td} text-right text-xs`}>{row.transferNo}</td>
              <td className={`${td} font-medium`}>{row.productName}</td>
              <td className={`${td} tabular-nums`}>{number(row.quantity)}</td>
              <td className={td}>{row.fromWarehouseName ?? "—"}</td>
              <td className={td}>{row.toWarehouseName ?? "—"}</td>
              <td className={td}>{row.responsibleName ?? "—"}</td>
              <td className={`${td} whitespace-nowrap text-xs tabular-nums text-muted-foreground`}>{row.transferDate ?? when(row.createdAt)}</td>
              <td className={td}><StatusPill value={row.status} /></td>
            </tr>
          ))}</tbody>
        </TableShell>
      )}
    </div>
  );
}

function CountTab({ warehouseId, warehouseName, canAdjust, canApprove }: { warehouseId: string; warehouseName: string; canAdjust: boolean; canApprove: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [counted, setCounted] = useState<Record<number, string>>({});
  const [search, setSearch] = useState("");
  const [token, setToken] = useState(newToken);
  const [viewing, setViewing] = useState<number | null>(null);
  const params = new URLSearchParams({ warehouseId, pageSize: "200" });
  if (search.trim()) params.set("search", search.trim());
  const stock = useQuery<Page<StockRow>>({ queryKey: ["admin", "warehouses", "stock", "count", warehouseId, search.trim()], queryFn: () => adminFetch(`/admin/warehouses/stock?${params}`), enabled: Boolean(warehouseId) });
  const counts = useQuery<{ data: CountSummary[] }>({ queryKey: ["admin", "warehouses", "counts", warehouseId], queryFn: () => adminFetch(`/admin/warehouses/counts${warehouseId ? `?warehouseId=${warehouseId}` : ""}`) });
  const detail = useQuery<CountDetail>({ queryKey: ["admin", "warehouses", "count", viewing], queryFn: () => adminFetch(`/admin/warehouses/counts/${viewing}`), enabled: viewing !== null });
  const lines = useMemo(() => (stock.data?.data ?? []).filter((row) => counted[row.productId] !== undefined && counted[row.productId] !== "").map((row) => ({ productId: row.productId, countedQuantity: Number(counted[row.productId]) })), [counted, stock.data]);
  const save = useMutation({
    mutationFn: () => adminFetch<{ status: string; countNo: string | null }>("/admin/warehouses/counts", { method: "POST", body: JSON.stringify({ warehouseId: Number(warehouseId), lines, requestToken: token }) }),
    onSuccess: (result) => {
      setCounted({});
      setToken(newToken());
      void queryClient.invalidateQueries({ queryKey: ["admin", "warehouses"] });
      toast({ title: result.status === "matched" ? "الجرد مطابق؛ لا يوجد فرق" : "أُرسل الجرد للاعتماد", description: result.status === "matched" ? undefined : "لا يتغيّر الرصيد قبل الاعتماد." });
    },
    onError: (error) => toast({ title: "تعذّر حفظ الجرد", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const review = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => adminFetch(`/admin/warehouses/counts/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: (_, { status }) => { void queryClient.invalidateQueries({ queryKey: ["admin", "warehouses"] }); toast({ title: status === "approved" ? "تم اعتماد الجرد وتسوية الرصيد" : "تم رفض الجرد" }); },
    onError: (error) => toast({ title: "تعذّر تنفيذ الجرد", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return (
    <div className="space-y-4">
      {!warehouseId ? <Empty>اختر مخزناً من الأعلى لبدء جرده؛ كل مخزن يُجرد لوحده.</Empty> : !canAdjust ? <Empty>تسجيل الجرد يحتاج صلاحية إدارة كميات المخازن.</Empty> : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">جرد {warehouseName}</h3>
            <Button type="button" disabled={!lines.length || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}حفظ الجرد ({lines.length})</Button>
          </div>
          <div className="relative"><Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden /><Input aria-label="ابحث عن مادة للجرد" placeholder="ابحث عن مادة للجرد" className="pr-9" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          {stock.isError ? <Failed error={stock.error} retry={() => void stock.refetch()} /> : stock.isPending ? <Skeleton className="h-40 w-full" /> : !stock.data.data.length ? <Empty>لا توجد مواد في هذا المخزن.</Empty> : (
            <TableShell>
              <thead><tr>{["المادة", "المتوقع", "المعدود فعلياً", "الفرق"].map((label) => <th key={label} className={th}>{label}</th>)}</tr></thead>
              <tbody>{stock.data.data.map((row) => {
                const value = counted[row.productId] ?? "";
                const difference = value === "" ? null : Number(value) - row.inWarehouse;
                return (
                  <tr key={row.productId}>
                    <td className={`${td} font-medium`}>{row.name}</td>
                    <td className={`${td} tabular-nums`}>{number(row.inWarehouse)} {row.unit}</td>
                    <td className={td}><Input aria-label={`المعدود من ${row.name}`} type="number" min={0} inputMode="decimal" className="h-9 w-28" value={value} onChange={(event) => setCounted((current) => ({ ...current, [row.productId]: event.target.value }))} /></td>
                    <td dir="ltr" className={`${td} text-right font-semibold tabular-nums ${difference ? "text-destructive" : "text-muted-foreground"}`}>{difference === null ? "—" : `${difference > 0 ? "+" : ""}${number(difference)}`}</td>
                  </tr>
                );
              })}</tbody>
            </TableShell>
          )}
        </section>
      )}
      <section className="space-y-2">
        <h3 className="font-bold">سجل الجرد</h3>
        {counts.isError ? <Failed error={counts.error} retry={() => void counts.refetch()} /> : counts.isPending ? <Skeleton className="h-24 w-full" /> : !counts.data.data.length ? <Empty>لا يوجد جرد مسجّل.</Empty> : (
          <TableShell>
            <thead><tr>{["الرقم", "المخزن", "المواد", "فيها فرق", "سجّله", "التاريخ", "الحالة", ""].map((label, index) => <th key={index} className={th}>{label}</th>)}</tr></thead>
            <tbody>{counts.data.data.map((row) => (
              <tr key={row.id}>
                <td dir="ltr" className={`${td} text-right text-xs`}>{row.countNo}</td>
                <td className={td}>{row.warehouseName}</td>
                <td className={`${td} tabular-nums`}>{row.lineCount}</td>
                <td className={`${td} tabular-nums`}>{row.differenceCount}</td>
                <td className={td}>{row.requestedByName || "—"}</td>
                <td className={`${td} whitespace-nowrap text-xs tabular-nums text-muted-foreground`}>{when(row.createdAt)}</td>
                <td className={td}><StatusPill value={row.status} /></td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setViewing(row.id)}>تفاصيل</Button>
                    {row.status === "pending" && canApprove ? <>
                      <Button type="button" size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: row.id, status: "approved" })}>اعتماد</Button>
                      <Button type="button" size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate({ id: row.id, status: "rejected" })}>رفض</Button>
                    </> : null}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </TableShell>
        )}
      </section>
      <Dialog open={viewing !== null} onOpenChange={(next) => { if (!next) setViewing(null); }}>
        <DialogContent dir="rtl" className="max-h-[85dvh] w-[min(calc(100%-2rem),36rem)] overflow-y-auto">
          <DialogHeader className="text-start"><DialogTitle>جرد {detail.data?.countNo ?? ""}</DialogTitle><DialogDescription>{detail.data?.warehouseName ?? ""}</DialogDescription></DialogHeader>
          {detail.isError ? <Failed error={detail.error} retry={() => void detail.refetch()} /> : detail.isPending ? <Skeleton className="h-24 w-full" /> : (
            <ul className="divide-y divide-border/40 text-sm">{detail.data.lines.map((line) => (
              <li key={line.productId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium">{line.productName}</span>
                <span className="text-xs tabular-nums text-muted-foreground">المتوقع {number(line.expected)} · المعدود {number(line.counted)} · <b dir="ltr" className={line.difference ? "text-destructive" : ""}>{line.difference > 0 ? "+" : ""}{number(line.difference)}</b></span>
              </li>
            ))}</ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportsTab({ warehouseId, warehouseName }: { warehouseId: string; warehouseName: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState("");
  const scope = warehouseId ? `warehouseId=${warehouseId}&` : "";
  const subtitle = warehouseName;
  const stockColumns = (label: string): WarehousePrintReport<StockRow>["columns"] => [
    { key: "name", header: "المادة", width: 26, value: (row) => row.name },
    { key: "shelf", header: label, number: true, value: (row) => number(row.inWarehouse) },
    { key: "reserved", header: "محجوز", number: true, value: (row) => number(row.reserved) },
    { key: "available", header: "المتاح", number: true, value: (row) => number(row.available) },
    { key: "damaged", header: "تالف", number: true, value: (row) => number(row.damaged) },
    { key: "maintenance", header: "صيانة", number: true, thermal: false, value: (row) => number(row.maintenance) },
    { key: "missing", header: "مفقود", number: true, value: (row) => number(row.missing) },
  ];
  const stockFetch = (extra = "") => adminFetch<Page<StockRow>>(`/admin/warehouses/stock?${scope}pageSize=2000${extra}`).then((page) => page.data);
  const reports: Array<{ id: string; label: string; icon: typeof Boxes; build: () => Promise<WarehousePrintReport<any>> }> = [
    { id: "stock", label: "رصيد المخزن", icon: Boxes, build: async () => ({ title: "رصيد المخزن", subtitle, columns: stockColumns("الموجود"), rows: await stockFetch(), filename: "warehouse-stock.pdf" }) },
    {
      id: "company", label: "رصيد الشركة", icon: WarehouseIcon, build: async () => {
        const rows = await adminFetch<Page<StockRow>>("/admin/warehouses/stock?pageSize=2000").then((page) => page.data);
        return {
          title: "رصيد الشركة حسب المخازن", subtitle: "كل المخازن", filename: "company-stock.pdf", rows,
          columns: [
            { key: "name", header: "المادة", width: 26, value: (row: StockRow) => row.name },
            { key: "company", header: "إجمالي الشركة", number: true, value: (row: StockRow) => number(row.companyShelf) },
            { key: "shares", header: "التوزيع", width: 34, value: (row: StockRow) => row.shares.map((share) => `${share.name}: ${number(share.inWarehouse)}`).join(" · ") || "—" },
          ],
        };
      },
    },
    {
      id: "transfers", label: "التحويلات", icon: ArrowLeftRight, build: async () => {
        const rows = await adminFetch<{ data: TransferRow[] }>(`/admin/warehouses/transfers?${scope}`).then((result) => result.data);
        return {
          title: "تحويلات المخازن", subtitle, filename: "warehouse-transfers.pdf", rows,
          columns: [
            { key: "name", header: "المادة", width: 22, value: (row: TransferRow) => `${row.transferNo} · ${row.productName}` },
            { key: "quantity", header: "الكمية", number: true, value: (row: TransferRow) => number(row.quantity) },
            { key: "from", header: "من", value: (row: TransferRow) => row.fromWarehouseName ?? "—" },
            { key: "to", header: "إلى", value: (row: TransferRow) => row.toWarehouseName ?? "—" },
            { key: "date", header: "التاريخ", value: (row: TransferRow) => row.transferDate ?? when(row.createdAt) },
            { key: "status", header: "الحالة", value: (row: TransferRow) => STATUS[row.status]?.label ?? row.status },
          ],
        };
      },
    },
    {
      id: "movements", label: "حركة الأصول", icon: History, build: async () => {
        const rows = await adminFetch<Page<MovementRow>>(`/admin/warehouses/movements?${scope}pageSize=2000`).then((page) => page.data);
        return {
          title: "حركة الأصول والمخزن", subtitle, filename: "warehouse-movements.pdf", rows,
          columns: [
            { key: "name", header: "المادة", width: 22, value: (row: MovementRow) => row.productName || "—" },
            { key: "date", header: "التاريخ", value: (row: MovementRow) => when(row.createdAt) },
            { key: "quantity", header: "الكمية", number: true, value: (row: MovementRow) => number(row.quantity) },
            { key: "type", header: "الحركة", width: 16, value: (row: MovementRow) => movementLabel(row.reason) },
            { key: "from", header: "من", value: (row: MovementRow) => row.warehouseName ?? "—" },
            { key: "to", header: "إلى", value: (row: MovementRow) => row.toWarehouseName ?? "—" },
            { key: "actor", header: "الموظف", value: (row: MovementRow) => row.actorName || "النظام" },
          ],
        };
      },
    },
    { id: "reserved", label: "الكميات المحجوزة", icon: ClipboardCheck, build: async () => ({ title: "الكميات المحجوزة", subtitle, columns: stockColumns("الموجود"), rows: (await stockFetch()).filter((row) => row.reserved > 0), filename: "warehouse-reserved.pdf" }) },
    { id: "damaged", label: "التالف والمفقود", icon: Wrench, build: async () => ({ title: "التالف والمفقود والصيانة", subtitle, columns: stockColumns("الموجود"), rows: await stockFetch("&focus=damaged"), filename: "warehouse-damaged.pdf" }) },
    {
      id: "discrepancies", label: "فروقات الجرد", icon: FileText, build: async () => {
        const data = await adminFetch<Discrepancies>(`/admin/warehouses/discrepancies${warehouseId ? `?warehouseId=${warehouseId}` : ""}`);
        const rows = [
          ...data.overdrawn.map((row) => ({ name: row.name, place: "كل المخازن", expected: row.company, counted: row.held, difference: row.gap, note: "رصيد المخازن يتجاوز الشركة" })),
          ...data.counts.map((row) => ({ name: row.productName, place: row.warehouseName, expected: row.expected, counted: row.counted, difference: row.difference, note: `${row.countNo ?? ""} · ${STATUS[row.status]?.label ?? row.status}` })),
        ];
        type Row = (typeof rows)[number];
        return {
          title: "فروقات الجرد", subtitle, filename: "warehouse-discrepancies.pdf", rows,
          columns: [
            { key: "name", header: "المادة", width: 22, value: (row: Row) => row.name },
            { key: "place", header: "المخزن", value: (row: Row) => row.place },
            { key: "expected", header: "المتوقع", number: true, value: (row: Row) => number(row.expected) },
            { key: "counted", header: "المعدود", number: true, value: (row: Row) => number(row.counted) },
            { key: "difference", header: "الفرق", number: true, value: (row: Row) => number(row.difference) },
            { key: "note", header: "ملاحظة", width: 20, value: (row: Row) => row.note },
          ],
        };
      },
    },
  ];
  const run = async (id: string, format: "a4" | "80mm") => {
    const report = reports.find((entry) => entry.id === id);
    if (!report) return;
    setBusy(`${id}:${format}`);
    try {
      await printWarehouseReport(await report.build(), format);
    } catch (error) {
      toast({ title: "تعذّرت الطباعة", description: apiErrorMessage(error), variant: "destructive" });
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {reports.map(({ id, label, icon: Icon }) => (
        <div key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#f4d6da] bg-card p-3.5 dark:border-border">
          <span className="flex min-w-0 items-center gap-2 font-semibold"><Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />{label}</span>
          <span className="flex gap-1.5">
            {(["a4", "80mm"] as const).map((format) => (
              <Button key={format} type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run(id, format)}>
                {busy === `${id}:${format}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}{format === "a4" ? "A4" : "80mm"}
              </Button>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function WarehousesPage() {
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState("warehouses");
  const [editing, setEditing] = useState<WarehouseRow | "new" | null>(null);
  const totals = useQuery<Totals>({ queryKey: ["admin", "warehouses", "totals"], queryFn: () => adminFetch("/admin/warehouses") });
  const recent = useQuery<{ data: TransferRow[] }>({ queryKey: ["admin", "warehouses", "transfers", selected], queryFn: () => adminFetch(`/admin/warehouses/transfers${selected ? `?warehouseId=${selected}` : ""}`) });
  const current = totals.data?.warehouses.find((row) => String(row.id) === selected) ?? null;
  const name = current?.name ?? "كل المخازن";
  const figures = current ?? totals.data?.company;
  const caps = totals.data?.capabilities;
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><WarehouseIcon className="h-5 w-5 text-primary" aria-hidden />إدارة المخازن</h1>
          <p className="mt-1 text-sm text-muted-foreground">رصيد كل مخزن لوحده، وإجمالي الشركة يبقى واحد مهما تحرّكت الكميات.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {caps?.canTransfer ? <Button type="button" asChild variant="outline"><Link href="/admin/warehouse-transfers"><ArrowLeftRight className="h-4 w-4" />تحويل</Link></Button> : null}
          {caps?.canManage ? <Button type="button" onClick={() => setEditing("new")}><Plus className="h-4 w-4" />إضافة مخزن</Button> : null}
        </div>
      </div>
      <WarehouseSelect allowAll value={selected} onChange={setSelected} className="max-w-sm" includeInactive />
      {totals.isError ? <Failed error={totals.error} retry={() => void totals.refetch()} /> : totals.isPending || !figures ? <div className="grid gap-3 [grid-template-columns:repeat(2,minmax(0,1fr))] lg:[grid-template-columns:repeat(6,minmax(0,1fr))]">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-24" />)}</div> : (
        <div className="grid gap-3 [grid-template-columns:repeat(2,minmax(0,1fr))] lg:[grid-template-columns:repeat(6,minmax(0,1fr))]">
          <Stat icon={WarehouseIcon} label="عدد المخازن" value={number(totals.data.warehouses.length)} note={`${totals.data.warehouses.filter((row) => row.isActive).length} نشط`} />
          <Stat icon={Boxes} label={current ? "أصول المخزن" : "أصول الشركة"} value={number(figures.assets)} />
          <Stat icon={Boxes} label={current ? "كمية المخزن" : "إجمالي الشركة"} value={number(figures.shelf)} note={current ? `إجمالي الشركة ${number(totals.data.company.shelf)}` : "الموجود على الرفوف"} />
          <Stat icon={ClipboardCheck} label="محجوز" value={number(figures.reserved)} />
          <Stat icon={Wrench} label="تحت الصيانة" value={number(figures.maintenance)} note={`تالف ${number(figures.damaged)} · مفقود ${number(figures.missing)}`} />
          <Stat icon={ArrowLeftRight} label="التحويلات" value={recent.isError ? "—" : number(recent.data?.data.length ?? 0)} note={recent.isError ? "تعذّر التحميل" : `بانتظار الاعتماد ${number((recent.data?.data ?? []).filter((row) => row.status === "pending").length)}`} />
        </div>
      )}
      {totals.data && totals.data.company.overdrawnItems > 0 ? (
        <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">{number(totals.data.company.overdrawnItems)} مادة رصيد مخازنها يتجاوز إجمالي الشركة. راجعها من تقرير «فروقات الجرد».</p>
      ) : null}
      <Tabs dir="rtl" value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="warehouses">المخازن</TabsTrigger>
          <TabsTrigger value="stock">الأرصدة</TabsTrigger>
          <TabsTrigger value="movements">الحركات</TabsTrigger>
          <TabsTrigger value="transfers">التحويلات</TabsTrigger>
          <TabsTrigger value="count">الجرد</TabsTrigger>
          {caps?.canReport ? <TabsTrigger value="reports">التقارير</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="warehouses" className="mt-3">
          {totals.isError ? null : totals.isPending ? <Skeleton className="h-40 w-full" /> : (
            <TableShell>
              <thead><tr>{["المخزن", "الرمز", "الموقع", "المسؤول", "الهاتف", "الأصول", "الكمية", "الحالة", ""].map((label, index) => <th key={index} className={th}>{label}</th>)}</tr></thead>
              <tbody>{totals.data.warehouses.map((row) => (
                <tr key={row.id}>
                  <td className={`${td} font-semibold`}>{row.name}{row.isMain ? <span className="ms-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">الرئيسي</span> : null}</td>
                  <td dir="ltr" className={`${td} text-right text-xs`}>{row.code ?? "—"}</td>
                  <td className={`${td} max-w-48 truncate`} title={row.location ?? ""}>{row.location ?? "—"}</td>
                  <td className={td}>{row.managerName ?? "—"}</td>
                  <td dir="ltr" className={`${td} text-right text-xs`}>{row.phone ?? "—"}</td>
                  <td className={`${td} tabular-nums`}>{number(row.assets)}</td>
                  <td className={`${td} font-semibold tabular-nums`}>{number(row.shelf)}</td>
                  <td className={td}><span className={`inline-flex rounded-full px-2.5 py-1 text-xs ${row.isActive ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{row.isActive ? "نشط" : "غير نشط"}</span></td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => { setSelected(String(row.id)); setTab("stock"); }}>التفاصيل</Button>
                      {caps?.canManage ? <Button type="button" size="sm" variant="ghost" aria-label={`تعديل ${row.name}`} onClick={() => setEditing(row)}><Pencil className="h-3.5 w-3.5" /></Button> : null}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </TableShell>
          )}
        </TabsContent>
        <TabsContent value="stock" className="mt-3"><StockTab warehouseId={selected} warehouseName={name} /></TabsContent>
        <TabsContent value="movements" className="mt-3"><MovementsTab warehouseId={selected} warehouseName={name} /></TabsContent>
        <TabsContent value="transfers" className="mt-3"><TransfersTab warehouseId={selected} canTransfer={Boolean(caps?.canTransfer)} /></TabsContent>
        <TabsContent value="count" className="mt-3"><CountTab warehouseId={selected} warehouseName={name} canAdjust={Boolean(caps?.canAdjust)} canApprove={Boolean(caps?.canApprove)} /></TabsContent>
        {caps?.canReport ? <TabsContent value="reports" className="mt-3"><ReportsTab warehouseId={selected} warehouseName={name} /></TabsContent> : null}
      </Tabs>
      <WarehouseDialog target={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
