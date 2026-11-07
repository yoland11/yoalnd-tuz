import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Boxes, CalendarDays, Camera, Check, Clock, FileText, Keyboard, Loader2, MoreHorizontal, PackageCheck, Plus, Printer, RefreshCw, ScanLine, Search, Settings, Trash2, Truck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { usePublicSettings } from "@/lib/public-settings";
import { printStandaloneDocument } from "@/lib/pdf";
import { calculateEquipmentRental, equipmentRentalCapabilities, EQUIPMENT_RENTAL_STATUS_LABELS, EQUIPMENT_RENTAL_STATUSES, type EquipmentRentalDetail, type EquipmentRentalAssetLine, type EquipmentRentalList, type EquipmentRentalOptions, type EquipmentRentalReturn, type EquipmentRentalDispatch } from "@/lib/equipment-rentals";
import { canDispatchEquipment, canReturnEquipment, hasOpenRentalLoss, rentalDispatchLimit, rentalDispatchSources, rentalReturnCounts } from "@/lib/equipment-rental-returns";
import { matchesRentalEquipment, rentalAssetCode, resolveRentalScan } from "@/lib/equipment-rental-scan";
import { consumeOutstanding, lineAllocations } from "@/lib/warehouse-stock";
import { adminFetch, AjNApiError, apiErrorMessage, formatCurrency, type AdminMe } from "./_lib";
import { equipmentRentalDispatchPrintHtml, equipmentRentalPrintHtml, equipmentRentalReturnPrintHtml } from "./equipment-rental-print";
import { RentalAssetSettings } from "@/components/equipment-rental-panels";
import { EquipmentRentalImage } from "@/components/equipment-rental-image";
import { EquipmentRentalScanner } from "@/components/equipment-rental-scanner";

const api = "/admin/rental-orders/equipment";
const base = "/admin/bookings/rentals";
const freshId = () => crypto.randomUUID();
const LiveScanner = lazy(() => import("@/views/staff/live-scanner").then(module => ({ default: module.LiveScanner })));
const selectClass = "h-10 min-w-0 w-full rounded-lg border border-border bg-card px-3 text-sm";
const cardClass = "rounded-2xl border border-primary/10 bg-card p-4 sm:p-5";
const statusLabel = (value: string) => EQUIPMENT_RENTAL_STATUS_LABELS[value] || value;
const actionLabels: Record<string, string> = { create: "إنشاء الإيجار", edit: "تعديل العقد", submit: "إرسال للاعتماد", confirm: "اعتماد وحجز المعدات", cancel: "إلغاء الإيجار", dispatch: "تسليم المعدات", return: "استرجاع معدات", inspection: "فحص المرتجع", complete: "إكمال الإيجار", "resolve-loss": "إغلاق عهدة الفقدان المعتمد", finance: "طلب حركة مالية", attachments: "إضافة مرفق", "cost-link": "ربط مصروف" };
const financeLabels: Record<string, string> = { er_rent_payment: "دفعة إيجار", er_rent_refund: "استرداد دفعة إيجار", er_deposit_collect: "استلام تأمين", er_deposit_refund: "إعادة تأمين", er_deposit_apply: "تسوية من التأمين", er_charge: "رسوم إضافية" };
const approvalLabels: Record<string, string> = { pending: "بانتظار الموافقة", approved: "معتمد", executed: "منفذ", rejected: "مرفوض", cancelled: "ملغي", reversed: "معكوس" };
const financeLabel = (value: string) => value.endsWith("_reversal") ? `عكس ${financeLabels[value.replace(/_reversal$/, "")] || value}` : financeLabels[value] || value;
const numeric = (value: unknown) => Number(value || 0);
function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) { return <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm"><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> تعذر إكمال الطلب</p><p className="mt-1 break-words">{apiErrorMessage(error)}</p>{retry ? <Button variant="outline" className="mt-3" onClick={retry}>إعادة المحاولة</Button> : null}</div>; }
function Loading() { return <p role="status" className="flex items-center justify-center gap-2 p-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> جارٍ التحميل…</p>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block min-w-0 space-y-1.5"><span className="text-xs font-semibold text-muted-foreground">{label}</span>{children}</label>; }
function Status({ row }: { row: EquipmentRentalDetail }) { return <span className="inline-flex flex-wrap gap-1"><span className="rounded-full bg-primary/8 px-2 py-1 text-xs font-semibold text-primary">{statusLabel(row.status)}</span>{row.overdue ? <span className="rounded-full bg-destructive/10 px-2 py-1 text-xs text-destructive">متأخر</span> : null}</span>; }
function RentalQuickActions({ row }: { row: EquipmentRentalDetail }) {
  const items = row.capabilities.finance ? [["finance", "تسجيل دفعة"]] : [];
  if (!items.length) return null;
  return <DropdownMenu dir="rtl"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`إجراءات ${row.orderNo}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{items.map(([action, label]) => <DropdownMenuItem key={action} asChild><Link href={`${base}/${row.id}?action=${action}`}>{label}</Link></DropdownMenuItem>)}<DropdownMenuItem asChild><Link href={`${base}/${row.id}?print=1`}>طباعة العقد</Link></DropdownMenuItem><DropdownMenuItem asChild><a href={whatsapp(row)} target="_blank" rel="noreferrer">رسالة واتساب للمراجعة</a></DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
}
/** Dispatch and receive stay visible on every rental: they are the jobs people come here for. */
function RentalRowActions({ row, mode }: { row: EquipmentRentalDetail; mode: string }) {
  const returning = canReturnEquipment(row);
  return <div className="flex flex-wrap items-center gap-2">
    {returning && <Button size="sm" className="whitespace-nowrap" asChild>
      <Link href={`${base}/${row.id}?action=return`}><PackageCheck /> استلام معدات</Link>
    </Button>}
    {canDispatchEquipment(row) && <Button size="sm" variant={returning ? "outline" : "default"} className="whitespace-nowrap" asChild>
      <Link href={`${base}/${row.id}?action=dispatch`}><Truck /> تسليم معدات</Link>
    </Button>}
    <Button variant="outline" size="sm" asChild><Link href={`${base}/${row.id}${mode === "returns" ? "?tab=movements" : ""}`}>فتح</Link></Button>
    <RentalQuickActions row={row} />
  </div>;
}

/** Below the wide-table width the rentals become cards, so the actions never sit off screen. */
function RentalCards({ rows, mode }: { rows: EquipmentRentalDetail[]; mode: string }) {
  return <ul className="divide-y xl:hidden" aria-label="الإيجارات">{rows.map(row => <li key={row.id} className="py-4 first:pt-0">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Link href={`${base}/${row.id}`} className="font-semibold text-primary">{row.orderNo}</Link>
        <p className="mt-1 break-words">{row.customerName} <bdi dir="ltr" className="text-xs text-muted-foreground">{row.phone}</bdi></p>
      </div>
      <Status row={row} />
    </div>
    <p className="mt-2 break-words text-sm text-muted-foreground">{row.details.assets.map(line => `${line.name} × ${line.quantity}`).join("، ")}</p>
    <dl className="mt-2 grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2 text-xs">
      {[["التسليم", row.startDate], ["الإرجاع المتوقع", row.endDate], ["المتبقي", formatCurrency(row.remaining)]].map(([label, value]) => <div key={label} className="min-w-0">
        <dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 font-semibold tabular-nums"><bdi>{value}</bdi></dd>
      </div>)}
    </dl>
    <div className="mt-3"><RentalRowActions row={row} mode={mode} /></div>
  </li>)}</ul>;
}

type RentalScanMatch = { id: number; orderNo: string; customerName: string; phone: string; endDate: string; status: string; lines: Array<{ productId: number; name: string; remaining: number }> };

/** Scan first, find the rental after: a label or rental number opens that contract on the right form, with the item counted. */
function RentalScanDesk({ capabilities }: { capabilities: EquipmentRentalDetail["capabilities"] }) {
  const [, navigate] = useLocation();
  const [action, setAction] = useState<"return" | "dispatch">(capabilities.return ? "return" : "dispatch");
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // A barcode reader types into the focused field; a phone keyboard should not pop up on arrival.
  useEffect(() => { if (window.matchMedia?.("(pointer: fine)").matches) input.current?.focus(); }, []);
  const open = (id: number, scanned: string) => navigate(`${base}/${id}?${new URLSearchParams({ action, scan: scanned })}`);
  const lookup = useMutation({
    mutationFn: (value: string) => adminFetch<{ code: string; data: RentalScanMatch[] }>(`${api}/scan?${new URLSearchParams({ code: value, action })}`),
    onSuccess: result => { if (result.data.length === 1) open(result.data[0].id, result.code); },
  });
  const find = (value: string) => { const scanned = value.trim(); if (!scanned || lookup.isPending) return; setCode(""); lookup.mutate(scanned); };
  const choose = (next: "return" | "dispatch") => { setAction(next); lookup.reset(); input.current?.focus(); };
  if (!capabilities.return && !capabilities.dispatch) return null;
  const receiving = action === "return";
  const result = lookup.data;
  return <section className={cardClass} aria-labelledby="rental-scan-desk">
    <h2 id="rental-scan-desk" className="flex items-center gap-2 text-lg font-bold"><ScanLine className="size-5 text-primary" /> استلام وتسليم بالباركود</h2>
    <p className="mt-1 text-sm text-muted-foreground">امسح باركود المعدة أو اكتب رقم الإيجار، فيفتح الإيجار على نموذج {receiving ? "الاستلام" : "التسليم"} والقطعة محسوبة.</p>
    {capabilities.return && capabilities.dispatch ? <div className="mt-4 grid max-w-md grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5 rounded-xl bg-primary/5 p-1.5" role="group" aria-label="نوع العملية">
      <Button type="button" variant={receiving ? "default" : "ghost"} aria-pressed={receiving} onClick={() => choose("return")}><PackageCheck /> استلام من الزبون</Button>
      <Button type="button" variant={receiving ? "ghost" : "default"} aria-pressed={!receiving} onClick={() => choose("dispatch")}><Truck /> تسليم للزبون</Button>
    </div> : null}
    <form className="mt-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); find(code); }}>
      <Input ref={input} className="min-w-0 flex-1 basis-56" dir="ltr" value={code} onChange={event => setCode(event.target.value)} placeholder="AJN-A000001" aria-label="باركود المعدة أو رقم الإيجار" enterKeyHint="search" autoComplete="off" />
      <Button type="submit" disabled={!code.trim() || lookup.isPending}>{lookup.isPending ? <Loader2 className="animate-spin" /> : <Search />} بحث</Button>
      <Button type="button" variant="outline" aria-pressed={camera} onClick={() => setCamera(!camera)}><Camera /> {camera ? "إيقاف الكاميرا" : "الكاميرا"}</Button>
    </form>
    {camera ? <div className="mt-3 max-w-md"><Suspense fallback={<Loading />}><LiveScanner active={!lookup.isPending} stopOnDetect={false} onDetect={find} /></Suspense></div> : null}
    {lookup.error ? <div className="mt-3"><ErrorBox error={lookup.error} /></div> : null}
    {result && !result.data.length ? <p role="status" className="mt-3 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">لا يوجد إيجار ينتظر {receiving ? "الاستلام" : "التسليم"} لهذا الرمز <bdi dir="ltr">{result.code}</bdi>. تأكد من نوع العملية، أو ابحث في القائمة أدناه.</p> : null}
    {result && result.data.length > 1 ? <div className="mt-3"><p role="status" className="mb-2 text-sm font-semibold">الرمز موجود في أكثر من إيجار، اختر واحداً:</p>
      <ul className="divide-y rounded-xl border" aria-label="الإيجارات المطابقة">{result.data.map(match => <li key={match.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="break-words font-semibold"><bdi>{match.orderNo}</bdi> · {match.customerName}</p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{match.lines.map(line => `${line.name}: ${receiving ? "لدى العميل" : "للتسليم"} ${line.remaining}`).join("، ")} · الإرجاع <bdi>{match.endDate}</bdi></p>
        </div>
        <Button size="sm" onClick={() => open(match.id, result.code)}>{receiving ? <PackageCheck /> : <Truck />} {receiving ? "استلام" : "تسليم"}</Button>
      </li>)}</ul>
    </div> : null}
  </section>;
}

function whatsapp(row: EquipmentRentalDetail) { const phone = row.phone.replace(/\D/g, "").replace(/^0/, "964"); const message = `مرحباً ${row.customerName}، بخصوص إيجار المعدات ${row.orderNo}: موعد الإرجاع ${row.endDate} ${row.details.endTime}. المبلغ المتبقي ${formatCurrency(row.remaining)}. يرجى التواصل معنا لتنسيق الإرجاع. شكراً.`; return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`; }

export default function EquipmentRentalsPage({ me }: { me: AdminMe }) {
  const [location] = useLocation();
  const segment = location.split("/").filter(Boolean)[3] || "";
  const id = /^\d+$/.test(segment) ? Number(segment) : null;
  const capabilities = equipmentRentalCapabilities(me);
  const detail = useQuery<EquipmentRentalDetail>({ queryKey: ["equipment-rentals", "detail", id], queryFn: () => adminFetch(`${api}/${id}`), enabled: !!id, refetchOnWindowFocus: "always" });
  return <main dir="rtl" style={{ "--primary": "337 95% 23%", "--ring": "337 95% 23%" } as React.CSSProperties} className="min-w-0 space-y-5 pb-10">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><Link href="/admin/bookings" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground"><ArrowRight className="h-3.5 w-3.5" /> مركز الحجوزات</Link><h1 className="text-2xl font-bold">{segment === "new" ? "إيجار معدات جديد" : id ? detail.data?.orderNo || "مساحة الإيجار" : segment === "returns" ? "التسليم والاستلام" : segment === "overdue" ? "الإيجارات المتأخرة" : "إيجارات المعدات"}</h1><p className="mt-1 text-sm text-muted-foreground">إدارة إيجارات المعدات والتسليم والإرجاع والحسابات</p></div><div className="flex flex-wrap gap-2">{segment ? <Button variant="outline" asChild><Link href={base}>جميع الإيجارات</Link></Button> : null}{capabilities.reports ? <Button variant="outline" asChild><Link href={`${base}/reports`}><FileText className="h-4 w-4" /> التقارير</Link></Button> : null}{segment !== "new" && capabilities.create ? <Button asChild><Link href={`${base}/new`}><Plus className="h-4 w-4" /> إيجار معدات</Link></Button> : null}</div></header>
    <nav className="flex flex-wrap gap-2" aria-label="نوع العملية"><Button variant="outline" size="sm" asChild><Link href="/admin/bookings?new=1"><CalendarDays className="h-4 w-4" /> حجز مناسبة</Link></Button><Button variant="outline" size="sm" asChild><Link href={base}><Boxes className="h-4 w-4" /> إيجار معدات</Link></Button><Button variant={segment === "returns" ? "selected" : "ghost"} size="sm" asChild><Link href={`${base}/returns`} aria-current={segment === "returns" ? "page" : undefined}><ScanLine className="h-4 w-4" /> التسليم والاستلام</Link></Button><Button variant={segment === "overdue" ? "selected" : "ghost"} size="sm" asChild><Link href={`${base}/overdue`} aria-current={segment === "overdue" ? "page" : undefined}>الإيجارات المتأخرة</Link></Button></nav>
    {segment === "new" ? <RentalForm capabilities={capabilities} /> : id ? detail.isLoading ? <Loading /> : detail.error ? <ErrorBox error={detail.error} retry={() => void detail.refetch()} /> : detail.data ? <RentalWorkspace key={detail.data.id} rental={detail.data} /> : null : segment === "reports" ? <RentalReports /> : <RentalDashboard mode={segment} capabilities={capabilities} />}
  </main>;
}

function RentalDashboard({ mode, capabilities }: { mode: string; capabilities: EquipmentRentalDetail["capabilities"] }) {
  const [search, setSearch] = useState(""); const [query, setQuery] = useState(""); const [status, setStatus] = useState(""); const [page, setPage] = useState(1);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  const params = new URLSearchParams({ q: query, status, page: String(page), mode });
  const list = useQuery<EquipmentRentalList>({ queryKey: ["equipment-rentals", "list", params.toString()], queryFn: () => adminFetch(`${api}?${params}`) });
  const summary = list.data?.summary;
  return <>{mode === "returns" ? <RentalScanDesk capabilities={capabilities} /> : null}<section className="grid grid-cols-2 gap-2 lg:grid-cols-5" aria-label="ملخص الإيجارات">{[["الإيجارات النشطة", summary?.active, Boxes], ["بانتظار التسليم", summary?.awaitingDispatch, Truck], ["الإرجاعات اليوم", summary?.dueToday, CalendarDays], ["الإيجارات المتأخرة", summary?.overdue, Clock], ["المبالغ المتبقية", summary?.outstanding == null ? undefined : formatCurrency(summary.outstanding), Wallet]].map(([label, value, Icon]: any) => <div key={label} className={`${cardClass} flex items-center gap-3`}><Icon className="h-5 w-5 shrink-0 text-primary" /><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold tabular-nums">{list.error ? "—" : value ?? "…"}</p></div></div>)}</section>
    <section className={cardClass}><div className="mb-4 flex flex-wrap gap-3"><div className="min-w-48 flex-1"><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="رقم الإيجار، اسم العميل، الهاتف أو المعدات" aria-label="البحث في الإيجارات" /></div><select className={`${selectClass} sm:w-44`} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} aria-label="حالة الإيجار"><option value="">كل الحالات</option>{EQUIPMENT_RENTAL_STATUSES.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select><Button variant="outline" size="icon" aria-label="تحديث" onClick={() => void list.refetch()}><RefreshCw className="h-4 w-4" /></Button></div>
      {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} retry={() => void list.refetch()} /> : <><RentalCards rows={list.data?.data ?? []} mode={mode} /><div className="hidden overflow-x-auto xl:block"><table className="w-full min-w-[850px] text-right text-sm"><thead className="border-b bg-muted/30 text-xs text-muted-foreground"><tr>{["رقم الإيجار", "العميل", "المعدات", "التسليم", "الإرجاع المتوقع", "الإجمالي", "المسدد", "المتبقي", "الحالة", "الإجراءات"].map(label => <th key={label} className="px-2 py-3">{label}</th>)}</tr></thead><tbody>{list.data?.data.map(row => <tr key={row.id} className="border-b last:border-0"><td className="px-2 py-3 font-semibold"><Link href={`${base}/${row.id}`} className="text-primary">{row.orderNo}</Link>{row.rentalKind === "product" ? <small className="block text-muted-foreground">إيجار سابق</small> : null}</td><td className="px-2 py-3">{row.customerName}<small className="block" dir="ltr">{row.phone}</small></td><td className="max-w-56 px-2 py-3"><div className="flex flex-col gap-2">{row.details.assets.map(line => <div key={line.productId} className="flex items-center gap-2"><EquipmentRentalImage image={line.image} name={line.name} className="size-12" /><span className="min-w-0 break-words">{line.name} × {line.quantity}</span></div>)}</div></td><td className="px-2 py-3"><bdi>{row.startDate}<br />{row.details.startTime}</bdi></td><td className="px-2 py-3"><bdi>{row.endDate}<br />{row.details.endTime}</bdi></td><td className="px-2 py-3">{formatCurrency(row.total)}</td><td className="px-2 py-3">{formatCurrency(row.paid)}</td><td className="px-2 py-3 font-semibold text-primary">{formatCurrency(row.remaining)}</td><td className="px-2 py-3"><Status row={row} /></td><td className="px-2 py-3"><RentalRowActions row={row} mode={mode} /></td></tr>)}</tbody></table></div>{!list.data?.data.length ? <p className="p-10 text-center text-muted-foreground">لا توجد إيجارات مطابقة للبحث.</p> : null}<div className="mt-4 flex items-center justify-between gap-2 text-sm"><span>{list.data?.total ?? 0} إيجار</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Button><Button variant="outline" size="sm" disabled={!list.data || page * list.data.pageSize >= list.data.total} onClick={() => setPage(page + 1)}>التالي</Button></div></div></>}
    </section></>;
}

function RentalForm({ rental, onSaved, capabilities = rental?.capabilities }: { rental?: EquipmentRentalDetail; onSaved?: () => void; capabilities?: EquipmentRentalDetail["capabilities"] }) {
  const [, navigate] = useLocation(); const { toast } = useToast(); const client = useQueryClient();
  const [requestId] = useState(freshId); const seed = rental?.details;
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const [form, setForm] = useState<any>(() => ({ customerId: rental?.customerId ?? null, customerName: rental?.customerName ?? "", phone: rental?.phone ?? "", address: seed?.address ?? "", startDate: rental?.startDate ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" }), endDate: rental?.endDate ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" }), startTime: seed?.startTime ?? "10:00", endTime: seed?.endTime ?? "22:00", assets: seed?.assets ?? [], deliveryCharge: seed?.deliveryCharge ?? 0, installationCharge: seed?.installationCharge ?? 0, discount: seed?.discount ?? 0, depositRequired: seed?.depositRequired ?? 0, terms: seed?.terms ?? "", linkedBooking: seed?.linkedBooking ?? (params.get("bookingSource") && params.get("bookingId") ? { source: params.get("bookingSource"), id: Number(params.get("bookingId")) } : null), attachments: seed?.attachments ?? [], notes: String(seed?.notes ?? "") }));
  const [assetSearch, setAssetSearch] = useState(""); const [deferred, setDeferred] = useState(""); const [customerSearch, setCustomerSearch] = useState(""); const [customerQuery, setCustomerQuery] = useState(""); const [bookingSearch, setBookingSearch] = useState("");
  useEffect(() => { const t = setTimeout(() => setDeferred(assetSearch.trim()), 300); return () => clearTimeout(t); }, [assetSearch]);
  useEffect(() => { const t = setTimeout(() => setCustomerQuery(customerSearch.trim()), 300); return () => clearTimeout(t); }, [customerSearch]);
  const options = useQuery<EquipmentRentalOptions>({ queryKey: ["equipment-rentals", "options", deferred], queryFn: () => adminFetch(`${api}/options?q=${encodeURIComponent(deferred)}`) });
  const customers = useQuery<EquipmentRentalOptions>({ queryKey: ["equipment-rentals", "customers", customerQuery], queryFn: () => adminFetch(`${api}/options?q=${encodeURIComponent(customerQuery)}`), enabled: customerQuery.length >= 2 });
  const [bookingQuery, setBookingQuery] = useState(""); useEffect(() => { const t = setTimeout(() => setBookingQuery(bookingSearch.trim()), 300); return () => clearTimeout(t); }, [bookingSearch]);
  const bookings = useQuery<any>({ queryKey: ["equipment-rentals", "booking-search", bookingQuery], queryFn: () => adminFetch(`${api}/booking-search?q=${encodeURIComponent(bookingQuery)}`), enabled: bookingQuery.length >= 2 });
  const patch = (key: string, value: unknown) => setForm((old: any) => ({ ...old, [key]: value }));
  const updateLine = (id: number, key: string, value: unknown) => setForm((old: any) => ({ ...old, assets: old.assets.map((line: EquipmentRentalAssetLine) => { if (line.productId !== id) return line; const settings = options.data?.assets.find(asset => asset.id === id)?.settings; return { ...line, [key]: value, ...(key === "pricingType" && settings ? { unitPrice: value === "fixed" ? settings.fixedPrice : value === "hourly" ? settings.hourlyPrice : value === "daily" ? settings.dailyPrice : line.unitPrice } : {}) }; }) }));
  const totals = useMemo(() => { try { return { value: calculateEquipmentRental(form), error: null }; } catch (error) { return { value: null, error: error as Error }; } }, [form]);
  const availabilityHash = JSON.stringify({ rentalId: rental?.id, startDate: form.startDate, startTime: form.startTime, endDate: form.endDate, endTime: form.endTime, assets: form.assets.map((line: EquipmentRentalAssetLine) => ({ productId: line.productId, quantity: line.quantity, warehouseId: line.warehouseId, pricingType: "fixed", unitPrice: 0 })) });
  const [availabilityPayload, setAvailabilityPayload] = useState<any>(null);
  useEffect(() => { setAvailabilityPayload(null); const timer = setTimeout(() => { if (totals.value) setAvailabilityPayload(JSON.parse(availabilityHash)); }, 400); return () => clearTimeout(timer); }, [availabilityHash, !!totals.value]);
  const availability = useQuery<{ assets: Array<{ productId: number; available: number; status: string }> }>({ queryKey: ["equipment-rentals", "availability", availabilityPayload], queryFn: () => adminFetch(`${api}/availability`, { method: "POST", body: JSON.stringify(availabilityPayload) }), enabled: !!availabilityPayload });
  const save = useMutation({ mutationFn: async (mode: "draft" | "confirm" | "print") => { const row = await adminFetch<EquipmentRentalDetail>(rental ? `${api}/${rental.id}` : api, { method: rental ? "PUT" : "POST", body: JSON.stringify({ ...form, requestId }) }); if (mode === "confirm") { try { await adminFetch(`${api}/${row.id}/confirm`, { method: "POST", body: JSON.stringify({ requestId: `${requestId}-confirm` }) }); } catch (error) { toast({ title: "المسودة محفوظة وتعذر التأكيد", description: apiErrorMessage(error), variant: "destructive" }); navigate(`${base}/${row.id}`); throw error; } } return { row, mode }; }, onSuccess: ({ row, mode }) => { void client.invalidateQueries({ queryKey: ["equipment-rentals"] }); if (mode === "print") navigate(`${base}/${row.id}?print=1`); else navigate(`${base}/${row.id}`); onSaved?.(); toast({ title: "تم حفظ الإيجار", description: mode === "draft" ? "المسودة محفوظة؛ لم تُحجز معدات ولم تُسجل دفعة." : undefined }); } });
  return <form onSubmit={e => { e.preventDefault(); save.mutate("draft"); }} className="space-y-4">
    <section className={cardClass}><h2 className="mb-4 font-bold">العميل والفترة</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="البحث عن عميل موجود"><Input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder="الاسم أو الهاتف" /></Field><Field label="اسم العميل"><Input required value={form.customerName} onChange={e => patch("customerName", e.target.value)} /></Field><Field label="رقم الهاتف"><Input required dir="ltr" inputMode="tel" value={form.phone} onChange={e => { patch("phone", e.target.value); patch("customerId", null); }} /></Field><Field label="العنوان"><Input value={form.address} onChange={e => patch("address", e.target.value)} /></Field>{[["startDate", "تاريخ التسليم", "date"], ["startTime", "وقت التسليم", "time"], ["endDate", "تاريخ الإرجاع", "date"], ["endTime", "وقت الإرجاع", "time"]].map(([key, label, type]) => <Field key={key} label={label}><Input required type={type} value={form[key]} onChange={e => patch(key, e.target.value)} /></Field>)}</div>
      {customers.error ? <ErrorBox error={customers.error} /> : customers.data?.customers?.length && customerQuery ? <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto">{customers.data.customers.slice(0, 10).map(customer => <Button key={customer.id} type="button" size="sm" variant="outline" onClick={() => { setForm((old: any) => ({ ...old, customerId: customer.id, customerName: customer.name, phone: customer.phone })); setCustomerSearch(""); }}>{customer.name} · {customer.phone}</Button>)}</div> : null}
      <p className="mt-3 text-xs text-muted-foreground">عند إدخال عميل جديد، يطابق النظام رقم الهاتف مع العملاء الموجودين قبل إنشاء حساب.</p>
    </section>
    <section className={cardClass}><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">المعدات والمخزن</h2><Input className="sm:w-72" value={assetSearch} onChange={e => setAssetSearch(e.target.value)} placeholder="البحث بالاسم أو رمز / باركود الأصل" aria-label="البحث عن أصل" /></div>{options.error ? <ErrorBox error={options.error} retry={() => void options.refetch()} /> : options.isLoading ? <Loading /> : <div className="mb-4 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{options.data?.assets.filter(asset => !form.assets.some((line: EquipmentRentalAssetLine) => line.productId === asset.id)).slice(0, 30).map(asset => <Button key={asset.id} type="button" variant="outline" className="h-auto justify-start gap-3 p-3 text-right" onClick={() => { const settings = asset.settings; if (!form.terms && settings.terms) patch("terms", settings.terms); patch("assets", [...form.assets, { productId: asset.id, name: asset.name, image: asset.image, code: asset.code, quantity: 1, warehouseId: options.data?.warehouses[0]?.id, trackingMode: asset.trackingMode, pricingType: settings.pricingType, unitPrice: settings.pricingType === "fixed" ? settings.fixedPrice : settings.pricingType === "hourly" ? settings.hourlyPrice : settings.dailyPrice, duration: 1, discount: 0, lineTotal: 0 }]); }}>{asset.image ? <img src={asset.image} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-lg object-contain" /> : <Boxes className="h-7 w-7 shrink-0 text-primary" />}<span className="min-w-0"><b className="block whitespace-normal">{asset.name}</b><small className="block font-normal text-muted-foreground">{asset.code} · {asset.trackingMode === "quantity" ? "متعدد الكمية" : "فردي"}</small></span><Plus className="ms-auto h-4 w-4 shrink-0" /></Button>)}</div>}
      <div className="space-y-3">{form.assets.map((line: EquipmentRentalAssetLine) => <article key={line.productId} className="rounded-xl border border-border p-3"><div className="mb-3 flex items-center gap-2"><EquipmentRentalImage image={line.image} name={line.name} className="size-16" /><b className="min-w-0 flex-1 break-words">{line.name} <small className="text-muted-foreground">{line.code}</small></b><Button type="button" variant="ghost" size="icon" aria-label={`إزالة ${line.name}`} onClick={() => patch("assets", form.assets.filter((item: EquipmentRentalAssetLine) => item.productId !== line.productId))}><Trash2 className="h-4 w-4" /></Button></div><div className="grid grid-cols-2 gap-3 md:grid-cols-6"><Field label="المخزن المصدر"><select className={selectClass} value={line.warehouseId ?? ""} onChange={e => updateLine(line.productId, "warehouseId", Number(e.target.value))}><option value="" disabled>اختر المخزن</option>{options.data?.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field><Field label="الكمية"><Input type="number" min="1" max={line.trackingMode === "individual" ? 1 : undefined} value={line.quantity} onChange={e => updateLine(line.productId, "quantity", Number(e.target.value))} /></Field><Field label="نوع التسعير"><select className={selectClass} value={line.pricingType} onChange={e => updateLine(line.productId, "pricingType", e.target.value)}><option value="fixed">ثابت</option><option value="daily">يومي</option><option value="hourly">بالساعة</option><option value="custom" disabled={!options.data?.assets.find(asset => asset.id === line.productId)?.settings.allowCustomPrice}>مدة وسعر مخصصان</option></select></Field><Field label="سعر الوحدة"><Input type="number" min="0" step="0.01" disabled={line.pricingType !== "custom"} value={line.unitPrice} onChange={e => updateLine(line.productId, "unitPrice", Number(e.target.value))} /></Field><Field label={line.pricingType === "custom" ? "المدة المخصصة" : "المدة المحسوبة"}><Input type="number" min="1" disabled={line.pricingType !== "custom"} value={totals.value?.assets.find(item => item.productId === line.productId)?.duration ?? line.duration} onChange={e => updateLine(line.productId, "duration", Number(e.target.value))} /></Field><Field label="خصم السطر"><Input type="number" min="0" value={line.discount} onChange={e => updateLine(line.productId, "discount", Number(e.target.value))} /></Field></div><p className="mt-2 text-xs text-muted-foreground">المتاح للفترة: {availability.error ? "تعذر الفحص" : availability.isFetching || !availabilityPayload ? "جارٍ التحقق…" : availability.data?.assets.find(item => item.productId === line.productId)?.available ?? "غير محدد"}</p><p className="mt-3 text-left font-bold text-primary">{formatCurrency(totals.value?.assets.find(item => item.productId === line.productId)?.lineTotal ?? 0)}</p></article>)}</div>{!form.assets.length ? <p className="py-5 text-center text-muted-foreground">اختر المعدات من الأصول أعلاه.</p> : null}<p className="mt-3 text-xs text-muted-foreground">يتحقق النظام من التوفر في المخزن والفترة المحددين عند التأكيد، بما يشمل حجوزات المناسبات والإيجارات.</p></section>
    <section className={`${cardClass} grid gap-4 md:grid-cols-2`}><div className="space-y-3"><h2 className="font-bold">الربط والشروط</h2>{form.linkedBooking ? <div className="rounded-xl border border-primary/15 p-3 text-sm"><Link href={`/admin/bookings/${form.linkedBooking.source}/${form.linkedBooking.id}`} className="text-primary">الحجز المرتبط #{form.linkedBooking.id}</Link><Button type="button" variant="ghost" size="sm" onClick={() => patch("linkedBooking", null)}>إلغاء الربط</Button></div> : <><Field label="البحث عن حجز مناسبة لربطه (اختياري)"><Input value={bookingSearch} onChange={e => setBookingSearch(e.target.value)} placeholder="رقم الحجز، الاسم أو الهاتف" /></Field>{bookings.error ? <ErrorBox error={bookings.error} /> : <div className="max-h-32 overflow-y-auto">{(Array.isArray(bookings.data) ? bookings.data : bookings.data?.data ?? bookings.data?.bookings ?? []).slice(0, 10).map((booking: any) => <Button key={`${booking.source}:${booking.id}`} type="button" variant="ghost" className="h-auto w-full justify-start" onClick={() => { patch("linkedBooking", { source: booking.source, id: booking.id }); setBookingSearch(""); }}>{booking.number || booking.id} · {booking.customerName}</Button>)}</div>}</>}<Field label="شروط العقد والتأخير والتلف"><Textarea rows={4} value={form.terms} onChange={e => patch("terms", e.target.value)} /></Field><Field label="ملاحظات"><Textarea value={form.notes} onChange={e => patch("notes", e.target.value)} /></Field></div><div className="space-y-3"><h2 className="font-bold">ملخص الحساب</h2><div className="grid grid-cols-2 gap-3">{[["deliveryCharge", "أجور التوصيل"], ["installationCharge", "أجور التركيب"], ["discount", "خصم العقد"], ["depositRequired", "التأمين المسترد المطلوب"]].map(([key, label]) => <Field key={key} label={label}><Input type="number" min="0" value={form[key]} onChange={e => patch(key, Number(e.target.value))} /></Field>)}</div><p className="flex justify-between border-t pt-4 text-lg font-bold"><span>إجمالي الإيجار</span><span className="text-primary">{formatCurrency(totals.value?.total ?? 0)}</span></p><p className="text-sm text-muted-foreground">التأمين المسترد مستقل عن قيمة الإيجار. تُسجل الدفعات من حساب العقد بعد حفظه وتدخل مسار الموافقات.</p>{totals.error && form.assets.length ? <p role="alert" className="text-sm text-destructive">{totals.error.message}</p> : null}</div></section>
    {availability.error ? <ErrorBox error={availability.error} retry={() => void availability.refetch()} /> : null}{save.error ? <ErrorBox error={save.error} /> : null}<footer className="sticky bottom-0 z-10 flex flex-wrap justify-end gap-2 rounded-xl border border-border bg-card/95 p-3 shadow-sm"><Button type="submit" variant="outline" disabled={save.isPending || !totals.value}>حفظ كمسودة</Button><Button type="button" variant="outline" disabled={save.isPending || !totals.value} onClick={() => save.mutate("print")}><Printer className="h-4 w-4" /> حفظ وطباعة العقد</Button>{capabilities?.confirm ? <Button type="button" disabled={save.isPending || !totals.value || availability.isFetching || !!availability.error || !availabilityPayload} onClick={() => save.mutate("confirm")}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} تأكيد الإيجار</Button> : null}</footer>
  </form>;
}

function RentalWorkspace({ rental }: { rental: EquipmentRentalDetail }) {
  const [tab, setTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") === "movements" || ["return", "dispatch"].includes(params.get("action") ?? "") ? "movements" : "details";
  });
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<string | null>(() => {
    const value = new URLSearchParams(window.location.search).get("action");
    if (value === "return" && canReturnEquipment(rental)) return value;
    if (value === "dispatch" && canDispatchEquipment(rental)) return value;
    if (value === "finance" && rental.capabilities.finance) return value;
    return null;
  });
  const movementAction = action === "dispatch" || action === "return";
  const [initialScan] = useState(() => new URLSearchParams(window.location.search).get("scan"));
  useEffect(() => { const url = new URL(window.location.href); if (url.searchParams.has("action") || url.searchParams.has("scan")) { url.searchParams.delete("action"); url.searchParams.delete("scan"); window.history.replaceState(window.history.state, "", url); } }, []);
  const client = useQueryClient(); const { toast } = useToast(); const { data: company } = usePublicSettings(); const [attachment, setAttachment] = useState({ name: "", url: "" });
  const refresh = () => client.invalidateQueries({ queryKey: ["equipment-rentals"] });
  const print = (size: "A4" | "80mm", kind: "contract" | "receipt") => { try { printStandaloneDocument(equipmentRentalPrintHtml(rental, company || {}, size, kind)); } catch (error) { toast({ title: "تعذرت الطباعة", description: apiErrorMessage(error), variant: "destructive" }); } };
  const printReturn = (record: EquipmentRentalReturn) => {
    try { printStandaloneDocument(equipmentRentalReturnPrintHtml(rental, record, company || {})); }
    catch (error) { toast({ title: "تعذرت الطباعة", description: apiErrorMessage(error), variant: "destructive" }); }
  };
  const printDispatch = (record: EquipmentRentalDispatch) => {
    try { printStandaloneDocument(equipmentRentalDispatchPrintHtml(rental, record, company || {})); }
    catch (error) { toast({ title: "تعذرت الطباعة", description: apiErrorMessage(error), variant: "destructive" }); }
  };
  const printed = useRef(false); useEffect(() => { if (!printed.current && new URLSearchParams(window.location.search).get("print") === "1" && company) { printed.current = true; print("A4", "contract"); } }, [company]);
  const mutate = useMutation({
    mutationFn: ({ kind, value }: { kind: string; value: unknown }) => adminFetch<EquipmentRentalDetail>(`${api}/${rental.id}/${kind}`, { method: "POST", body: JSON.stringify(value) }),
    onSuccess: (saved, { kind }) => {
      client.setQueryData(["equipment-rentals", "detail", rental.id], saved);
      void refresh();
      setAction(null);
      if (["dispatch", "return", "inspection", "resolve-loss"].includes(kind)) setTab("movements");
      toast({ title: kind === "return" ? "تم تسجيل استرجاع المعدات" : "تم تسجيل الإجراء" });
    },
    onError: (error, { kind }) => {
      if (["dispatch", "return", "inspection"].includes(kind) && error instanceof AjNApiError && error.status === 409) void refresh();
    },
  });
  const openAction = (kind: string) => {
    mutate.reset();
    if (kind === "dispatch" || kind === "return") setTab("movements");
    setAction(kind);
  };
  const actionEditor = action && <RentalActionEditor key={`${rental.id}:${action}`} rental={rental} action={action} initialScan={movementAction ? initialScan : null}
    onClose={() => { if (movementAction) void refresh(); mutate.reset(); setAction(null); }}
    onSave={(kind, value) => mutate.mutate({ kind, value })} busy={mutate.isPending} error={mutate.error} />;
  const attachments = useMutation({ mutationFn: () => adminFetch(`${api}/${rental.id}/attachments`, { method: "POST", body: JSON.stringify({ requestId: freshId(), name: attachment.name, url: attachment.url }) }), onSuccess: () => { void refresh(); setAttachment({ name: "", url: "" }); } });
  const confirm = (kind: string) => {
    const prompt = kind === "resolve-loss" ? "إغلاق عهدة المعدات المفقودة المسجلة سابقاً؟"
      : kind === "complete" ? "إكمال الإيجار بعد إرجاع المعدات وتسوية الرصيد والتأمين؟"
      : kind === "cancel" ? "إلغاء هذا الإيجار وتحرير المعدات غير المسلمة؟" : "اعتماد الإيجار وحجز المعدات للفترة المحددة؟";
    if (window.confirm(prompt)) mutate.mutate({ kind, value: { requestId: freshId() } });
  };
  if (editing) return <RentalForm rental={rental} onSaved={() => setEditing(false)} />;
  return <><section className={cardClass}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{rental.customerName}</h2><p className="my-2 text-sm text-muted-foreground"><bdi>{rental.phone}</bdi> · {rental.startDate} {rental.details.startTime} ← {rental.endDate} {rental.details.endTime}</p><Status row={rental} /></div><div className="flex flex-wrap gap-2">{rental.capabilities.finance ? <Button size="sm" disabled={!!action || mutate.isPending} onClick={() => openAction("finance")}><Wallet className="h-4 w-4" /> تسجيل دفعة</Button> : null}{tab !== "movements" && canDispatchEquipment(rental) ? <Button size="sm" variant="outline" onClick={() => openAction("dispatch")}><Truck className="h-4 w-4" /> تسليم معدات</Button> : null}{tab !== "movements" && canReturnEquipment(rental) && <Button size="sm" disabled={mutate.isPending} onClick={() => openAction("return")}><PackageCheck data-icon="inline-start" /> استلام معدات</Button>}{rental.capabilities.inspect && rental.details.assets.some(line => numeric(line.pendingInspectionQty) > 0) ? <Button size="sm" variant="outline" disabled={!!action || mutate.isPending} onClick={() => openAction("inspection")}>إكمال الفحص</Button> : null}<Button size="sm" variant="outline" onClick={() => print("A4", "contract")}><Printer className="h-4 w-4" /> العقد A4</Button><Button size="sm" variant="outline" onClick={() => print("80mm", "receipt")}>وصل 80mm</Button><Button size="sm" variant="outline" asChild><a href={whatsapp(rental)} target="_blank" rel="noreferrer">واتساب</a></Button></div></div><div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">{[["إجمالي الإيجار", rental.total], ["المسدد المعتمد", rental.paid], ["المتبقي", rental.remaining], ["التأمين المحتفظ به", rental.finance.depositHeld]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-muted/35 p-3"><p className="text-xs text-muted-foreground">{label}</p><b className="mt-1 block text-lg">{formatCurrency(numeric(value))}</b></div>)}</div>{rental.rentalKind === "product" ? <p className="mt-4 text-sm text-muted-foreground">سجل إيجار سابق محفوظ بهويته الأصلية. إدارته المالية والمخزنية تبقى عبر مساره السابق.</p> : null}</section>
    {!action && mutate.error ? <ErrorBox error={mutate.error} /> : null}
    <Tabs dir="rtl" value={tab} onValueChange={setTab}><div className="max-w-full overflow-x-auto"><TabsList className="h-auto min-w-max justify-start">{[["details", "التفاصيل"], ["equipment", "المعدات"], ["movements", "التسليم والاستلام"], ["finance", "الحسابات"], ["attachments", "المرفقات"], ["history", "السجل"]].map(([key, label]) => <TabsTrigger key={key} value={key} disabled={movementAction && key !== "movements"}>{label}</TabsTrigger>)}</TabsList></div>
      <TabsContent value="details" className={cardClass}><div className="grid gap-5 md:grid-cols-2"><div><h3 className="mb-2 font-bold">بيانات العقد</h3><p className="whitespace-pre-wrap text-sm leading-7">العنوان: {rental.details.address || "—"}<br />التأمين المطلوب: {formatCurrency(rental.details.depositRequired)}<br />التوصيل: {formatCurrency(rental.details.deliveryCharge)}<br />التركيب: {formatCurrency(rental.details.installationCharge)}<br />الخصم: {formatCurrency(rental.details.discount)}</p>{rental.details.linkedBooking ? <Button className="mt-3" variant="outline" asChild><Link href={`/admin/bookings/${rental.details.linkedBooking.source}/${rental.details.linkedBooking.id}`}>فتح الحجز المرتبط #{rental.details.linkedBooking.id}</Link></Button> : null}</div><div><h3 className="mb-2 font-bold">شروط العقد</h3><p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{rental.details.terms || "لم تُضف شروط خاصة."}</p></div></div><div className="mt-5 flex flex-wrap gap-2">{rental.capabilities.edit && rental.status === "draft" ? <Button variant="outline" onClick={() => setEditing(true)}>تعديل المسودة</Button> : null}{rental.capabilities.confirm && ["draft", "pending_approval"].includes(rental.status) ? <Button disabled={mutate.isPending} onClick={() => confirm("confirm")}>اعتماد وحجز المعدات</Button> : null}{rental.capabilities.create && rental.status === "draft" && !rental.capabilities.confirm ? <Button disabled={mutate.isPending} onClick={() => mutate.mutate({ kind: "submit", value: { requestId: freshId() } })}>إرسال للاعتماد</Button> : null}{rental.capabilities.cancel && !["returned", "completed", "cancelled"].includes(rental.status) ? <Button variant="outline" disabled={mutate.isPending} onClick={() => confirm("cancel")}>إلغاء الإيجار</Button> : null}{rental.capabilities.confirm && rental.rentalKind === "equipment" && rental.status === "returned" && (
  <Button disabled={mutate.isPending} onClick={() => confirm("complete")}><Check data-icon="inline-start" /> إكمال الإيجار</Button>
)}{rental.customerId ? <Button variant="ghost" asChild><Link href={`/admin/customers?customer=${rental.customerId}`}>حساب العميل</Link></Button> : null}</div></TabsContent>
      <TabsContent value="equipment" className="space-y-3">{rental.details.assets.map(line => <article key={line.productId} className={`${cardClass} flex flex-wrap items-center gap-4`}><EquipmentRentalImage image={line.image} name={line.name} /><div className="min-w-40 flex-1"><b>{line.name}</b><p className="mt-1 text-sm text-muted-foreground">{line.code} · المخزن #{line.warehouseId} · {line.quantity} وحدة</p><p className="mt-2 text-sm">{line.duration} × {formatCurrency(line.unitPrice)} · الخصم {formatCurrency(line.discount)}</p></div><div className="flex flex-col items-start gap-2"><b className="text-primary">{formatCurrency(line.lineTotal)}</b>{rental.capabilities.settings ? <Button type="button" size="sm" variant="ghost" asChild><a href={`/admin/assets/new?edit=${line.productId}`} target="_blank" rel="noreferrer">إضافة / تعديل صورة الأصل</a></Button> : null}</div></article>)}</TabsContent>
      <TabsContent value="movements" className={cardClass}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-bold"><Truck className="size-5 text-primary" /> تسليم واستلام المعدات</h3>
            <p className="mt-1 text-xs text-muted-foreground">اختر العملية ثم استخدم الباركود أو الإدخال اليدوي.</p>
          </div>
          {rental.rentalKind === "equipment" && <div className="flex flex-wrap gap-2">
            <Button disabled={!!action || mutate.isPending || !canDispatchEquipment(rental)} onClick={() => openAction("dispatch")}><Truck /> تسليم معدات</Button>
            <Button variant="outline" disabled={!!action || mutate.isPending || !canReturnEquipment(rental)} onClick={() => openAction("return")}><PackageCheck /> استلام معدات</Button>
          </div>}
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-primary/10 bg-primary/5 p-3 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">العميل</p><b>{rental.customerName}</b></div>
          <div><p className="text-xs text-muted-foreground">رقم الإيجار</p><bdi className="font-bold text-primary">{rental.orderNo}</bdi></div>
          <div><p className="text-xs text-muted-foreground">مدة الإيجار</p><bdi>{rental.startDate} – {rental.endDate}</bdi></div>
          <div><p className="mb-1 text-xs text-muted-foreground">حالة الإيجار</p><Status row={rental} /></div>
        </div>
        {movementAction ? actionEditor : <>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-right text-sm">
            <thead className="border-b bg-primary/5 text-muted-foreground"><tr>
              {["المعدات", "المؤجر", "المُسلّم", "المرتجع", "سليم", "تالف", "مفقود", "بانتظار الفحص", "المتبقي لدى العميل"].map(label =>
                <th key={label} scope="col" className="p-2">{label}</th>)}
            </tr></thead>
            <tbody>{rental.details.assets.map(line => {
              const count = rentalReturnCounts(line);
              return <tr key={line.productId} className="border-b">
                <th scope="row" className="p-2 font-medium"><span className="flex items-center gap-2"><EquipmentRentalImage image={line.image} name={line.name} className="size-12" />{line.name}</span></th>
                {[line.quantity, count.dispatched, count.previouslyReturned, count.good, count.damaged, count.missing, count.pending, count.outstanding].map((quantity, index) =>
                  <td key={index} className="p-2 tabular-nums">{quantity}</td>)}
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "أصناف المعدات", value: rental.details.assets.length, color: "bg-muted/50" },
            { label: "المُسلّم", value: rental.details.assets.reduce((sum, line) => sum + rentalReturnCounts(line).dispatched, 0), color: "bg-blue-500/10" },
            { label: "المستلم", value: rental.details.assets.reduce((sum, line) => sum + rentalReturnCounts(line).previouslyReturned, 0), color: "bg-emerald-500/10" },
            { label: "المتبقي لدى العميل", value: rental.details.assets.reduce((sum, line) => sum + rentalReturnCounts(line).outstanding, 0), color: "bg-primary/10" },
          ].map(item => <div key={item.label} className={`rounded-xl p-3 text-sm ${item.color}`}><p className="text-xs">{item.label}</p><b className="mt-1 block text-lg tabular-nums">{item.value}</b></div>)}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">تعود الكميات السليمة المقبولة فقط إلى المخزون المتاح. يُكمل العقد بعد الإرجاع والفحص وتسوية الحساب.</p>
        {rental.rentalKind === "equipment" && rental.details.assets.some(hasOpenRentalLoss) && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
          <span>يوجد فقدان مسجّل سابقاً بعهدة مفتوحة. يتطلب إغلاق العهدة صلاحية اعتماد الفقدان.</span>
          {rental.capabilities.resolveLoss && <Button size="sm" variant="outline" disabled={mutate.isPending} onClick={() => confirm("resolve-loss")}>إغلاق عهدة الفقدان</Button>}
        </div>}
        {rental.status === "returned" && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span>تم إرجاع المعدات. راجع الرصيد والتأمين قبل إكمال الإيجار.</span>
          <Button size="sm" variant="outline" onClick={() => setTab("finance")}>مراجعة الحسابات</Button>
          {rental.capabilities.confirm && <Button size="sm" disabled={mutate.isPending} onClick={() => confirm("complete")}>إكمال الإيجار</Button>}
        </div>}
        {rental.rentalKind === "equipment" && <>
          <RentalDispatchHistory records={rental.details.dispatches ?? []} onPrint={printDispatch} />
          <RentalReturnHistory records={rental.details.returns ?? []} onPrint={printReturn} />
        </>}
        </>}
      </TabsContent>
      <TabsContent value="finance" className={cardClass}><div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">{[["التأمين المستلم", rental.finance.depositCollected], ["التأمين المعاد", rental.finance.depositRefunded], ["المطبق على الإيجار", rental.finance.depositApplied], ["التأمين المتبقي", rental.finance.depositHeld]].map(([label, amount]) => <div key={String(label)} className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">{label}</p><b className="mt-1 block">{formatCurrency(numeric(amount))}</b></div>)}</div>{rental.capabilities.reports ? <div className="mb-4 rounded-xl border p-3 text-sm">التكاليف المباشرة المعتمدة: {formatCurrency(numeric(rental.finance.directCosts))} · المساهمة المباشرة: {formatCurrency(numeric(rental.finance.directContribution))}<p className="mt-1 text-xs text-muted-foreground">مساهمة مباشرة قبل التكاليف العامة والإهلاك، وليست صافي الربح المحاسبي.</p></div> : null}<p className="mb-4 text-sm text-muted-foreground">طلبات الدفعات والتأمين والرسوم تمر عبر صندوق AJN والموافقة المالية. لا يدخل المعلق في المسدد المعتمد.</p>{rental.capabilities.finance ? <Button onClick={() => openAction("finance")}>طلب دفعة / تأمين / تسوية أو رسوم</Button> : null}{rental.capabilities.costs ? <Button variant="outline" className="ms-2" onClick={() => openAction("cost-link")}>ربط مصروف موجود</Button> : null}<Button variant="outline" className="ms-2" onClick={() => print("A4", "receipt")}>طباعة كشف الحساب</Button><div className="mt-4 space-y-2">{([...(rental.finance.payments as any[] || []), ...(rental.finance.charges as any[] || [])].sort((a, b) => numeric(b.id) - numeric(a.id))).map((entry: any, i) => <div key={entry.id ?? i} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm"><span>{financeLabel(entry.transactionType || entry.transaction_type || entry.kind || "حركة مالية")}<small className="block text-xs text-muted-foreground">{entry.transactionNo || entry.transaction_no}</small></span><b>{formatCurrency(numeric(entry.amount))}</b><span>{approvalLabels[entry.approvalStatus || entry.approval_status || entry.status] || entry.approvalStatus || entry.approval_status || entry.status}</span></div>)}</div></TabsContent>
      <TabsContent value="attachments" className={cardClass}><h3 className="mb-3 font-bold">مرفقات العقد</h3><div className="grid gap-3 sm:grid-cols-2">{rental.details.attachments.map(file => <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="rounded-xl border p-4 text-sm text-primary">{file.name}</a>)}</div>{rental.capabilities.edit ? <div className="mt-4 flex flex-wrap gap-2"><Input className="sm:w-52" placeholder="اسم المرفق" aria-label="اسم المرفق" value={attachment.name} onChange={e => setAttachment({ ...attachment, name: e.target.value })} /><Input className="min-w-52 flex-1" dir="ltr" placeholder="رابط الملف من مركز المستندات" aria-label="رابط المرفق المحمي" value={attachment.url} onChange={e => setAttachment({ ...attachment, url: e.target.value })} /><Button disabled={attachments.isPending || !attachment.name || !attachment.url} onClick={() => attachments.mutate()}>ربط المرفق</Button><Button variant="outline" asChild><Link href="/admin/documents">مركز المستندات والرفع</Link></Button></div> : null}{attachments.error ? <ErrorBox error={attachments.error} /> : null}</TabsContent>
      <TabsContent value="history" className={cardClass}><ol className="space-y-3">{rental.history.map((entry, index) => <li key={`${entry.requestId}:${index}`} className="border-s-2 border-primary/20 ps-4"><p className="text-sm font-semibold">{actionLabels[entry.action] || entry.action} · {entry.actorName}</p><time className="text-xs text-muted-foreground">{new Date(entry.at).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad" })}</time>{entry.note ? <p className="text-sm">{entry.note}</p> : null}</li>)}</ol></TabsContent>
    </Tabs>
    {!movementAction && actionEditor}
  </>;
}

function RentalDispatchHistory({ records, onPrint }: { records: EquipmentRentalDispatch[]; onPrint: (record: EquipmentRentalDispatch) => void }) {
  return <section className="mt-5 flex flex-col gap-3 border-t pt-4">
    <h3 className="font-bold">سجل التسليم</h3>
    {!records.length && <p className="text-sm text-muted-foreground">تظهر سندات التسليم الجديدة هنا. العمليات السابقة موجودة في تبويب السجل.</p>}
    {[...records].reverse().map(record => <article key={record.requestId} className="rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><time dateTime={record.dispatchedAt} className="text-sm font-semibold">{new Date(record.dispatchedAt).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad" })}</time>
          <p className="text-xs text-muted-foreground">سجّله {record.actorName}</p></div>
        <Button size="sm" variant="outline" onClick={() => onPrint(record)}><Printer /> طباعة سند التسليم</Button>
      </div>
      <ul className="mt-3 divide-y text-sm">{record.lines.map(line => <li key={line.productId} className="py-2">
        <b className="break-words">{line.name} × {line.quantity}</b>
        <p className="text-muted-foreground">{line.employeeName} · {line.warehouses.map(source => `${source.name} × ${source.quantity}`).join("، ")}</p>
      </li>)}</ul>
      {record.note && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{record.note}</p>}
    </article>)}
  </section>;
}

function RentalReturnHistory({ records, onPrint }: { records: EquipmentRentalReturn[]; onPrint: (record: EquipmentRentalReturn) => void }) {
  return <section className="mt-5 flex flex-col gap-3 border-t pt-4">
    <h3 className="font-bold">سجل الاسترجاع</h3>
    {!records.length && <p className="text-sm text-muted-foreground">تظهر هنا سندات الاسترجاع بعد تسجيلها. راجع تبويب السجل للعمليات السابقة.</p>}
    {[...records].reverse().map(record => <article key={record.requestId} className="rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <time dateTime={record.returnedAt} className="text-sm font-semibold">{new Date(record.returnedAt).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad" })}</time>
          <p className="text-xs text-muted-foreground">سجّله {record.actorName}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => onPrint(record)}><Printer data-icon="inline-start" /> طباعة سند الاسترجاع</Button>
      </div>
      <ul className="mt-3 divide-y text-sm">
        {record.lines.map(line => <li key={line.productId} className="flex flex-col gap-1 py-2">
          <b className="break-words">{line.name}</b>
          <p className="text-muted-foreground">المستلم {line.receivingEmployeeName}{line.warehouseName && <> · <span>{line.warehouseName}</span></>}</p>
          <p>سليم {line.good} · تالف {line.damaged} · مفقود {line.missing}{line.lossApproved && " (معتمد)"} · بانتظار الفحص {line.pending}</p>
          <p className="font-medium">المتبقي لدى العميل بعد العملية <bdi>{line.outstandingAfter}</bdi></p>
          {line.note && line.note !== record.note && <p className="whitespace-pre-wrap break-words text-muted-foreground">{line.note}</p>}
        </li>)}
      </ul>
      {record.note && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{record.note}</p>}
    </article>)}
  </section>;
}

type RentalQuantityDraft = {
  productId: number; warehouseId: number | null; quantity: number;
  good: number; damaged: number; missing: number; inspection: number;
};
type RentalQuantityField = "quantity" | "good" | "damaged" | "missing" | "inspection";
const baghdadInputTime = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 16);

function RentalActionEditor({ rental, action, onClose, onSave, busy, error, initialScan = null }: {
  rental: EquipmentRentalDetail; action: string; onClose: () => void;
  onSave: (kind: string, value: unknown) => void; busy: boolean; error: unknown; initialScan?: string | null;
}) {
  const [requestId] = useState(freshId);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState("rent_payment");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [chargeType, setChargeType] = useState("damage");
  const [employeeId, setEmployeeId] = useState("");
  const [proof, setProof] = useState("");
  const [approveLoss, setApproveLoss] = useState(false);
  const [movementDate, setMovementDate] = useState(baghdadInputTime);
  const [submitted, setSubmitted] = useState<object | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [entryMethod, setEntryMethod] = useState<"manual" | "scan">("scan");
  const [scanNotice, setScanNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [search, setSearch] = useState("");
  const [scanned, setScanned] = useState<number[]>([]);
  const returning = action === "return";
  const dispatching = action === "dispatch";
  const inspecting = action === "inspection";
  const movementAction = returning || dispatching;
  const inventoryAction = movementAction || inspecting;
  const dateLabel = dispatching ? "تاريخ ووقت التسليم" : "تاريخ ووقت الاسترجاع";
  const [lines, setLines] = useState<RentalQuantityDraft[]>(() => rental.details.assets.map(line => ({
    productId: line.productId,
    warehouseId: null,
    quantity: 0,
    good: 0, damaged: 0, missing: 0, inspection: 0,
  })));
  const options = useQuery<EquipmentRentalOptions>({
    queryKey: ["equipment-rentals", "options", ""],
    queryFn: () => adminFetch(api + "/options"), enabled: inventoryAction,
  });
  const costOptions = useQuery<{ data: Array<{ id: number; name: string; amount: number }> }>({
    queryKey: ["equipment-rentals", "cost-options"],
    queryFn: () => adminFetch(api + "/cost-options"), enabled: action === "cost-link",
  });
  const update = (id: number, key: keyof Omit<RentalQuantityDraft, "productId">, value: number | null) =>
    setLines(old => old.map(line => line.productId === id ? { ...line, [key]: value } : line));
  const fields: Array<[RentalQuantityField, string]> = dispatching ? [["quantity", "الكمية المسلمة"]]
    : inspecting ? [["good", "سليم"], ["damaged", "تالف"]]
    : [["good", "سليم"], ["damaged", "تالف"], ["missing", "مفقود"], ["inspection", "بانتظار الفحص"]];
  const home = options.data?.mainWarehouseId ?? options.data?.warehouses[0]?.id ?? 0;
  const warehouseName = (id: number) => options.data?.warehouses.find(w => Number(w.id) === id)?.name ?? `مخزن #${id}`;
  const inventoryLines = lines.flatMap(line => {
    const asset = rental.details.assets.find(item => item.productId === line.productId);
    if (!asset) return [];
    const count = rentalReturnCounts(asset);
    const sources = dispatching ? rentalDispatchSources(asset, home) : [];
    const reserved = sources.reduce((sum, source) => sum + (!line.warehouseId || line.warehouseId === source.warehouseId ? source.available : 0), 0);
    const limit = dispatching ? Math.min(rentalDispatchLimit(asset), reserved) : inspecting ? count.pending : count.outstanding;
    const entered = fields.reduce((sum, [key]) => sum + line[key], 0);
    const invalid = fields.some(([key]) => !Number.isSafeInteger(line[key]) || line[key] < 0) || entered > limit;
    return [{ line, asset, count, limit, entered, invalid, sources }];
  });
  // Each scan counts one unit. A return lands as «سليم» and stays editable before saving.
  const scanField: RentalQuantityField = dispatching ? "quantity" : "good";
  const addScanned = (productId: number) => {
    const item = inventoryLines.find(entry => entry.line.productId === productId);
    if (!item) return { ok: false, message: "هذه المعدة غير موجودة في الإيجار الحالي." };
    if (dispatching && !options.data) return { ok: false, message: "انتظر تحميل المخازن ثم امسح مرة ثانية." };
    setScanned(previous => previous.includes(productId) ? previous : [...previous, productId]);
    if (item.entered >= item.limit) return { ok: false, message: `${item.asset.name}: اكتملت الكمية (${item.limit}).` };
    update(productId, scanField, item.line[scanField] + 1);
    return { ok: true, message: `${item.asset.name}: ${item.entered + 1} من ${item.limit}${returning ? "، سُجّلت «سليم» ويمكن تغيير حالتها." : "."}` };
  };
  const initialApplied = useRef(false);
  useEffect(() => {
    if (!initialScan || initialApplied.current || !movementAction || (dispatching && !options.data)) return;
    initialApplied.current = true;
    const match = resolveRentalScan(initialScan, rental.details.assets, dispatching ? "dispatch" : "return");
    setScanNotice("error" in match ? { ok: false, message: match.error } : addScanned(match.productId));
  }, [options.data]);
  const selected = inventoryLines.filter(item => item.entered > 0);
  const hasMissing = selected.some(({ line }) => line.missing > 0);
  const needsNote = selected.some(({ line }) => line.missing > 0 || line.damaged > 0);
  const movementAt = movementDate ? Date.parse(movementDate + ":00+03:00") : NaN;
  const earliest = Math.floor(Date.parse(rental.createdAt ?? "") / 60000) * 60000;
  const uncertain = movementAction && submitted != null && !!error &&
    (!(error instanceof AjNApiError) || error.status === 0 || error.status >= 500);
  const invalidInventory = !employeeId || !options.data || !!options.error || !selected.length ||
    inventoryLines.some(item => item.invalid) || (needsNote && !note.trim()) || (hasMissing && !approveLoss) ||
    (movementAction && (!Number.isFinite(movementAt) || movementAt > Date.now() || movementAt < earliest));
  const canSave = !!action && !busy && (uncertain || (inventoryAction ? !invalidInventory : numeric(amount) > 0));
  const save = () => {
    if (!action || !canSave) return;
    if (uncertain) { onSave(action, submitted); return; }
    if (action === "cost-link") { onSave(action, { requestId, expenseId: numeric(amount), note }); return; }
    if (action === "finance") { onSave(action, { requestId, kind, amount: numeric(amount), method, note, chargeType, attachments: proof ? [proof] : [] }); return; }
    const payload = {
      requestId, note, employeeId: Number(employeeId), staffId: Number(employeeId),
      ...(movementAction ? { [returning ? "returnedAt" : "dispatchedAt"]: new Date(movementAt).toISOString() } : {}),
      lines: selected.map(({ line }) => ({
        productId: line.productId, warehouseId: inspecting ? undefined : line.warehouseId,
        quantity: line.quantity, goodQuantity: line.good, damagedQuantity: line.damaged,
        missingQuantity: line.missing, pendingInspectionQuantity: line.inspection,
        managerApproval: approveLoss, photoUrls: proof ? [proof] : [],
        staffId: Number(employeeId), note, description: note,
      })),
    };
    if (movementAction) setSubmitted(payload);
    onSave(action, payload);
  };

  const title = action === "cost-link" ? "ربط مصروف بالإيجار" : action === "finance" ? "طلب حركة مالية للإيجار"
    : dispatching ? "تسليم معدات" : inspecting ? "فحص المعدات المرتجعة" : "استلام معدات";
  const visibleLines = inventoryLines.filter(({ line, asset, limit, entered }) => entered > 0 || (limit > 0 &&
    (!movementAction || (entryMethod === "scan" ? scanned.includes(line.productId) : matchesRentalEquipment(search, asset)))));
  const warehouseReview = ({ line, asset, sources }: (typeof selected)[number]) => {
    if (dispatching) {
      let left = line.quantity;
      return sources.filter(source => !line.warehouseId || source.warehouseId === line.warehouseId).flatMap(source => {
        const quantity = Math.min(left, source.available);
        left -= quantity;
        return quantity ? [`${warehouseName(source.warehouseId)} × ${quantity}`] : [];
      }).join("، ");
    }
    const physical = line.good + line.damaged + line.inspection;
    if (!physical) return "فقدان · لا يوجد استلام مخزني";
    if (line.warehouseId) return warehouseName(line.warehouseId);
    if (asset.trackingMode !== "quantity") return warehouseName(asset.warehouseId || home);
    return consumeOutstanding(lineAllocations(asset, home), physical)
      .map(source => `${warehouseName(source.warehouseId)} × ${source.quantity}`).join("، ");
  };
  const content = <>
      {!movementAction && <p className="text-sm text-muted-foreground"><bdi>{rental.orderNo}</bdi> · {rental.customerName}</p>}
      {reviewing ? <section className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4" aria-label="مراجعة العملية">
        <h4 className="font-bold">مراجعة {dispatching ? "التسليم" : "الاستلام"}</h4>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">الموظف</dt><dd className="font-medium">{options.data?.employees.find(employee => String(employee.id) === employeeId)?.name}</dd></div>
          <div><dt className="text-muted-foreground">{dateLabel} · بغداد</dt><dd className="font-medium"><bdi>{movementDate.replace("T", " ")}</bdi></dd></div>
        </dl>
        <ul className="divide-y rounded-xl border bg-card px-3">
          {selected.map(item => <li key={item.asset.productId} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
            <div><b>{item.asset.name}</b><p className="mt-1 text-xs text-muted-foreground">{warehouseReview(item)}</p></div>
            <div className="font-semibold text-primary">
              {item.entered} وحدة
              {returning && <p className="text-xs">{fields.filter(([key]) => item.line[key] > 0).map(([key, label]) => `${label} ${item.line[key]}`).join(" · ")}</p>}
            </div>
          </li>)}
        </ul>
        {note && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{note}</p>}
        {!uncertain && invalidInventory && <p role="alert" className="text-sm text-destructive">راجع الكميات والبيانات المحدثة قبل الحفظ.</p>}
      </section> : <fieldset disabled={busy || uncertain} className="flex min-w-0 flex-col gap-4">
        {action === "cost-link" ? <div className="space-y-3"><p className="text-sm text-muted-foreground">اربط رقم مصروف من إدارة المصاريف. التحليل يقرأ نفس الحركة المعتمدة، ولا ينشئ مصروفاً أو حركة مالية أخرى.</p><Field label="اختر مصروفاً موجوداً"><select className={selectClass} value={amount} onChange={e => setAmount(e.target.value)}><option value="">اختر من آخر المصاريف</option>{costOptions.data?.data.map(expense => <option key={expense.id} value={expense.id}>#{expense.id} · {expense.name} · {formatCurrency(expense.amount)}</option>)}</select></Field>{costOptions.error ? <ErrorBox error={costOptions.error} /> : null}<Field label="أو أدخل رقم المصروف"><Input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} /></Field><Button variant="outline" asChild><a href="/admin/expenses" target="_blank" rel="noreferrer">إدارة المصاريف</a></Button></div> : action === "finance" ? <div className="grid gap-4 sm:grid-cols-2"><Field label="نوع الحركة"><select className={selectClass} value={kind} onChange={e => setKind(e.target.value)}>{[["rent_payment", "دفعة من قيمة الإيجار"], ["rent_refund", "استرجاع دفعة إيجار"], ["deposit_collect", "استلام تأمين مسترد"], ["deposit_refund", "إعادة تأمين"], ["deposit_apply", "تطبيق تأمين على الرصيد (بدون حركة نقدية)"], ["charge", "رسوم تحتاج اعتماد"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="المبلغ"><Input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></Field>{kind === "charge" ? <Field label="نوع الرسوم"><select className={selectClass} value={chargeType} onChange={e => setChargeType(e.target.value)}><option value="damage">تلف / صيانة</option><option value="missing">فقدان</option><option value="late">تأخير</option><option value="other">تنظيف أو رسوم أخرى</option></select></Field> : <Field label="طريقة الدفع"><select className={selectClass} disabled={kind === "deposit_apply"} value={method} onChange={e => setMethod(e.target.value)}><option value="cash">نقداً</option><option value="transfer">تحويل</option><option value="card">بطاقة</option></select></Field>}<p className="text-xs text-muted-foreground">تُرسل للموافقة المالية. لا تُفرض الرسوم ولا تتحرك أموال الصندوق قبل الاعتماد والتنفيذ.</p></div> : <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={returning ? "الموظف المستلم" : "الموظف المسؤول"}>
              <select className={selectClass} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
                <option value="">اختر الموظف</option>
                {options.data?.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
              </select>
            </Field>
            {movementAction && <Field label={dateLabel}>
              <Input type="datetime-local" aria-label={dateLabel} value={movementDate} max={baghdadInputTime()} onChange={e => setMovementDate(e.target.value)} />
            </Field>}
          </div>
          {options.isLoading && <Loading />}
          {options.error && <ErrorBox error={options.error} retry={() => void options.refetch()} />}
          {returning && <p className="text-xs text-muted-foreground">الوقت بتوقيت بغداد. سجّل المعدات المفحوصة والمقبولة «سليم»، وبقية المعدات غير المفحوصة «بانتظار الفحص».</p>}
          <div className={movementAction ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" : ""}>
          {movementAction && <section className="min-w-0 space-y-3 lg:order-2" aria-label="طريقة إدخال المعدات">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-primary/5 p-2">
              <Button type="button" size="sm" variant={entryMethod === "scan" ? "default" : "outline"} aria-pressed={entryMethod === "scan"} onClick={() => setEntryMethod("scan")}><ScanLine /> مسح باركود / QR</Button>
              <Button type="button" size="sm" variant={entryMethod === "manual" ? "default" : "outline"} aria-pressed={entryMethod === "manual"} onClick={() => setEntryMethod("manual")}><Keyboard /> إدخال يدوي</Button>
            </div>
            {entryMethod === "scan"
              ? <EquipmentRentalScanner assets={rental.details.assets} action={dispatching ? "dispatch" : "return"} busy={busy || uncertain}
                  notice={scanNotice} onSelect={id => { const result = addScanned(id); setScanNotice(null); return result; }} />
              : <Field label="ابحث عن معدة بالاسم أو الرمز">
                  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="اسم المعدة أو رمزها" />
                </Field>}
            {selected.length > 0 && <p className="rounded-xl border border-primary/10 bg-primary/5 p-3 text-sm">الكميات المحددة للمراجعة: <bdi className="font-bold">{selected.reduce((sum, item) => sum + item.entered, 0)}</bdi></p>}
          </section>}
          <div className="flex min-w-0 flex-col gap-3">
            {visibleLines.map(({ line, asset, count, limit, entered, invalid, sources }) =>
              <article key={line.productId} data-rental-product-id={line.productId}
                className={"rounded-xl border p-3 " + (entryMethod === "scan" && scanned.includes(line.productId) ? "border-primary/40 bg-primary/5" : "")}>
                <div className="mb-3 flex items-center gap-3">
                  <EquipmentRentalImage image={asset.image} name={asset.name} className="size-16" />
                  <div className="min-w-0">
                    <b className="break-words">{asset.name}</b>
                    <p className="break-all text-xs text-muted-foreground" dir="ltr">{asset.code || rentalAssetCode(asset.productId)}</p>
                  </div>
                </div>
                <dl className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-2 text-xs sm:grid-cols-4">
                  {[
                    ["المؤجر", asset.quantity], ["المُسلّم", count.dispatched],
                    ["المرتجع سابقاً", count.previouslyReturned],
                    inspecting ? ["بانتظار الفحص", count.pending] : ["المتبقي لدى العميل", count.outstanding],
                  ].map(([label, value]) => <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{value}</dd>
                  </div>)}
                </dl>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {dispatching && <Field label="المخزن المصدر">
                    <select aria-label="المخزن المصدر" className={selectClass} value={line.warehouseId ?? ""}
                      onChange={e => update(line.productId, "warehouseId", e.target.value ? Number(e.target.value) : null)}>
                      <option value="">{sources.length === 1 ? warehouseName(sources[0].warehouseId) : "حسب حجز كل مخزن"}</option>
                      {sources.length > 1 && sources.map(source => <option key={source.warehouseId} value={source.warehouseId}>{warehouseName(source.warehouseId)} · {source.available}</option>)}
                    </select>
                  </Field>}
                  {returning && <Field label="المخزن المستلم">
                    <select aria-label={dispatching ? "المخزن المصدر" : "المخزن المستلم"} className={selectClass} value={line.warehouseId ?? ""}
                      onChange={e => update(line.productId, "warehouseId", e.target.value ? Number(e.target.value) : null)}>
                      <option value="">العودة إلى مخزن التسليم</option>
                      {options.data?.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </Field>}
                  {fields.map(([key, label]) => <Field key={key} label={label}>
                    <Input type="number" min="0" max={limit} step="1" aria-invalid={invalid || undefined}
                      disabled={returning && ((key === "good" && !rental.capabilities.inspect) || (key === "missing" && !rental.capabilities.resolveLoss))}
                      value={line[key]} onChange={e => update(line.productId, key, Number(e.target.value))} />
                  </Field>)}
                </div>
                {dispatching && <p className="mt-2 text-xs text-muted-foreground">المتاح للتسليم من الحجز: <bdi>{limit}</bdi></p>}
                {invalid ? <p role="alert" className="mt-2 text-sm text-destructive">{entered > limit ? "الكمية تتجاوز المتبقي (" + limit + ")." : "أدخل كميات صحيحة غير سالبة."}</p>
                  : returning && entered > 0 && <p className="mt-2 text-sm font-medium text-primary">المتبقي لدى العميل بعد الحفظ <bdi>{limit - entered}</bdi></p>}
              </article>)}
            {!inventoryLines.some(({ limit }) => limit > 0) && <p className="text-sm text-muted-foreground">لا توجد كميات متبقية لهذا الإجراء.</p>}
            {inventoryLines.some(({ limit }) => limit > 0) && !visibleLines.length && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              {entryMethod === "scan" ? "امسح رمز معدة لإظهار صورتها وكمياتها هنا." : "لا توجد معدات مطابقة للبحث."}
            </p>}
          </div>
          </div>
        </>}
        <Field label="صورة / مستند من مركز المستندات (اختياري)"><Input dir="ltr" value={proof} onChange={e => setProof(e.target.value)} placeholder="https://… أو رابط /api/…" /></Field>
        <Button variant="ghost" size="sm" className="self-start" asChild><a href="/admin/documents" target="_blank" rel="noreferrer">فتح مركز المستندات والرفع</a></Button>
        {hasMissing && <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={approveLoss} onChange={e => setApproveLoss(e.target.checked)} /> تأكيد اعتماد الفقدان وفق صلاحية المدير
        </label>}
        <Field label={needsNote ? "وصف التلف أو الفقدان (مطلوب)" : "ملاحظات"}>
          <Textarea value={note} onChange={e => setNote(e.target.value)} maxLength={3000} />
        </Field>
      </fieldset>}
      {error ? <ErrorBox error={error} /> : null}
      {uncertain && <p className="text-sm text-muted-foreground">أعد إرسال نفس العملية للتحقق من تسجيلها ومواصلة العمل.</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button variant="outline" disabled={busy} onClick={onClose}>{uncertain ? "إغلاق ومراجعة السجل" : "إلغاء"}</Button>
        {reviewing && !uncertain && <Button variant="outline" disabled={busy} onClick={() => setReviewing(false)}>تعديل الكميات</Button>}
        <Button disabled={!canSave} onClick={() => movementAction && !reviewing ? setReviewing(true) : save()}>
          {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Check data-icon="inline-start" />}
          {uncertain ? "إعادة المحاولة" : movementAction ? reviewing ? dispatching ? "تأكيد التسليم" : "تأكيد الاستلام" : "مراجعة العملية" : "تأكيد"}
        </Button>
      </div>
  </>;
  if (movementAction) return <section aria-label={title} className="space-y-4">
    <h4 className="font-bold text-primary">{title}</h4>
    {content}
  </section>;
  return <Dialog open onOpenChange={value => !value && !busy && onClose()}>
    <DialogContent dir="rtl" style={{ "--primary": "337 95% 23%", "--ring": "337 95% 23%" } as React.CSSProperties} className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      {content}
    </DialogContent>
  </Dialog>;
}

function RentalReports() {
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const query = useQuery<any>({ queryKey: ["equipment-rentals", "reports", from, to], queryFn: () => adminFetch(`${api}/reports?from=${from}&to=${to}`) });
  const [assetId, setAssetId] = useState("");
  return <div className="space-y-4"><section className={cardClass}><div className="flex flex-wrap items-end gap-3"><Field label="من تاريخ"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label="إلى تاريخ"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field><Button variant="ghost" onClick={() => { setFrom(""); setTo(""); }}>كل الفترات</Button><Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" /> طباعة التقرير</Button></div>{query.isLoading ? <Loading /> : query.error ? <ErrorBox error={query.error} retry={() => void query.refetch()} /> : <><div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{Object.entries(query.data?.summary ?? {}).filter(([, value]) => typeof value === "number").map(([key, value]) => <div key={key} className="rounded-xl bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{({ active: "النشطة", awaitingDispatch: "بانتظار التسليم", dueToday: "إرجاعات اليوم", overdue: "المتأخرة", outstanding: "المبالغ المتبقية", depositHeld: "التأمين المحتفظ به", revenue: "إيراد الإيجارات", collected: "التحصيل المعتمد", billed: "إيراد عقود الإيجار", paid: "المسدد المعتمد", remaining: "المبالغ المتبقية", contracts: "عدد العقود", cashCollected: "التحصيل النقدي المعتمد", directCosts: "التكاليف المباشرة المعتمدة", directContribution: "المساهمة المباشرة", total: "عدد الإيجارات", completed: "المكتملة" } as Record<string, string>)[key] || key}</p><b className="mt-2 block">{Number(value).toLocaleString("en-US")}</b></div>)}</div><div className="mt-5 space-y-2">{(query.data?.byAsset ?? query.data?.assets ?? []).map((asset: any, index: number) => <div key={asset.productId || index} className="flex flex-wrap justify-between gap-3 border-b py-3 text-sm"><span>{asset.name || `أصل #${asset.productId}`}</span><span>مرات الإيجار: {asset.rentals || asset.count || asset.contracts || 0}</span><span>الكمية: {asset.quantity || 0}</span><span>لدى العملاء: {asset.outstanding || 0}</span></div>)}</div><div className="mt-5 space-y-2"><h3 className="font-bold">حسب المخزن المصدر</h3>{(query.data?.byWarehouse ?? []).map((warehouse: any) => <div key={warehouse.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm"><span>{warehouse.name}</span><span>الكمية المؤجرة: {warehouse.quantity}</span><span>لدى العملاء: {warehouse.outstanding}</span></div>)}</div><p className="mt-4 text-xs text-muted-foreground">الإيراد، والتحصيل النقدي، والتأمين مقاييس مستقلة. أي مساهمة مباشرة تستند إلى تكاليف مرتبطة فعلية ولا تمثل صافي الربح المحاسبي النهائي.</p></>}</section><section className={cardClass}><h2 className="mb-3 flex items-center gap-2 font-bold"><Settings className="h-4 w-4" /> إعدادات إيجار أصل</h2><Field label="معرف الأصل"><Input inputMode="numeric" value={assetId} onChange={e => setAssetId(e.target.value)} /></Field>{Number(assetId) > 0 ? <RentalAssetSettings productId={Number(assetId)} /> : null}</section></div>;
}
