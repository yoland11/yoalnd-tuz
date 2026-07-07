import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ScanLine,
  Camera,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ArrowUpFromLine,
  ArrowDownToLine,
  Loader2,
  PackageCheck,
  AlertTriangle,
  Truck,
  User,
  X,
  Wrench,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "./_layout";
import { adminFetch, apiErrorMessage, compressImageFile } from "./_lib";

type GateMode = "checkout" | "return";

type Booking = {
  id: number;
  bookingNo?: string;
  customerName?: string;
  primaryEmployeeId?: number | null;
  primaryEmployeeName?: string | null;
  assistantEmployeeName?: string | null;
  status?: string;
  eventDate?: string;
  eventAt?: string;
  hallLocation?: string;
};
type RequiredAsset = { productId: number; quantity: number; name: string; status: string; stock: number };
type ScanResult = {
  productId: number;
  name: string;
  assetCode: string;
  barcode?: string | null;
  serialNumber?: string | null;
  status: string;
  location?: string | null;
};
type CustodyRow = { id: number; productId: number; staffId: number; status: string };
type StaffRow = { id: number; fullName?: string; username?: string };

const BLOCKED_CHECKOUT = new Set(["maintenance", "lost", "retired", "locked"]);

export default function AssetGatePage() {
  const [mode, setMode] = useState<GateMode>("checkout");
  const [bookingSearch, setBookingSearch] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);

  const [employeeId, setEmployeeId] = useState("");
  const [vehicle, setVehicle] = useState("");

  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ScanResult | null>(null);
  const [processed, setProcessed] = useState<Record<number, "checkout" | "return" | "lost">>({});
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  // Return problem panel: none | broken | lost
  const [problem, setProblem] = useState<"none" | "broken" | "lost">("none");
  const [repairCost, setRepairCost] = useState("");
  const [problemNote, setProblemNote] = useState(""); // damage description OR loss reason
  const [responsibleId, setResponsibleId] = useState("");
  const [managerApproval, setManagerApproval] = useState(false);
  const [problemPhoto, setProblemPhoto] = useState<string | null>(null);

  const { data: bookings = [], isLoading: bookingsLoading } = useQuery<Booking[]>({
    queryKey: ["admin", "gate-bookings"],
    queryFn: () => adminFetch("/admin/kosha-bookings"),
    staleTime: 60_000,
  });
  const { data: staff = [] } = useQuery<StaffRow[]>({
    queryKey: ["admin", "gate-staff"],
    queryFn: () => adminFetch("/admin/staff"),
    staleTime: 5 * 60_000,
  });

  // Required assets for the selected booking. Endpoint returns { assets, warnings, ... }.
  const { data: assetsData, isLoading: assetsLoading, refetch: refetchAssets } = useQuery<{
    assets: RequiredAsset[];
    warnings?: string[];
  }>({
    queryKey: ["admin", "gate-assets", booking?.id],
    queryFn: () => adminFetch(`/admin/kosha-bookings/${booking!.id}/assets`),
    enabled: Boolean(booking?.id),
    staleTime: 30_000,
  });
  const required = useMemo(() => assetsData?.assets ?? [], [assetsData]);

  // Active custody records (to detect already-checked-out + to return by asset).
  const { data: custodyResp, refetch: refetchCustody } = useQuery<{ data: CustodyRow[] }>({
    queryKey: ["admin", "gate-custody"],
    queryFn: () => adminFetch("/admin/custody"),
    enabled: Boolean(booking?.id),
    staleTime: 15_000,
  });
  const custody = custodyResp?.data ?? [];

  const requiredIds = useMemo(() => new Set(required.map((r) => r.productId)), [required]);
  const doneCount = useMemo(
    () => required.filter((r) => processed[r.productId]).length,
    [required, processed],
  );
  const allDone = required.length > 0 && doneCount >= required.length;
  const missing = required.filter((r) => !processed[r.productId]);

  const filteredBookings = useMemo(() => {
    const q = bookingSearch.trim().toLowerCase();
    const list = q
      ? bookings.filter(
          (b) =>
            (b.customerName ?? "").toLowerCase().includes(q) ||
            (b.bookingNo ?? "").toLowerCase().includes(q) ||
            String(b.id).includes(q),
        )
      : bookings;
    return list.slice(0, 40);
  }, [bookings, bookingSearch]);

  function selectBooking(b: Booking) {
    setBooking(b);
    setProcessed({});
    setPending(null);
    setFlash(null);
    // Carry the booking's Primary Employee into the checkout by default.
    if (b.primaryEmployeeId) setEmployeeId(String(b.primaryEmployeeId));
  }

  // Deep-link from a booking page: /admin/asset-gate?bookingId=..&mode=checkout|return
  const initialParams = useMemo(() => {
    if (typeof window === "undefined") return { bookingId: 0, mode: "" };
    const sp = new URLSearchParams(window.location.search);
    return { bookingId: Number(sp.get("bookingId")) || 0, mode: sp.get("mode") || "" };
  }, []);
  const appliedDeepLink = useRef(false);
  useEffect(() => {
    if (appliedDeepLink.current) return;
    if (initialParams.mode === "return" || initialParams.mode === "checkout") setMode(initialParams.mode);
    if (initialParams.bookingId) {
      const b = bookings.find((x) => x.id === initialParams.bookingId);
      if (b) {
        selectBooking(b);
        appliedDeepLink.current = true;
      }
    } else {
      appliedDeepLink.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings]);

  function switchMode(next: GateMode) {
    setMode(next);
    setProcessed({});
    setPending(null);
    setFlash(null);
  }

  function activeCustodyFor(productId: number): CustodyRow | undefined {
    return custody.find((c) => c.productId === productId && c.status === "issued");
  }

  function showFlash(kind: "ok" | "err", msg: string) {
    setFlash({ kind, msg });
    window.setTimeout(() => setFlash((f) => (f?.msg === msg ? null : f)), 2600);
  }

  // ── Scanning ──────────────────────────────────────────────────────────────
  async function handleCode(raw: string) {
    const code = raw.trim();
    if (!code || !booking) return;
    setManualCode("");
    setBusy(true);
    try {
      const res = await adminFetch<ScanResult>(`/admin/assets/scan?code=${encodeURIComponent(code)}`);
      // Membership
      if (!requiredIds.has(res.productId)) {
        showFlash("err", `${res.name}: هذا الأصل لا يخص هذا الحجز`);
        return;
      }
      // Duplicate within this session
      if (processed[res.productId]) {
        showFlash("err", `${res.name}: تم مسحه مسبقاً`);
        return;
      }
      if (mode === "checkout") {
        if (BLOCKED_CHECKOUT.has(res.status)) {
          showFlash("err", `${res.name}: الحالة (${res.status}) تمنع الإخراج`);
          return;
        }
        if (activeCustodyFor(res.productId)) {
          showFlash("err", `${res.name}: مُخرَج مسبقاً بعهدة`);
          return;
        }
      } else {
        if (!activeCustodyFor(res.productId)) {
          showFlash("err", `${res.name}: لا توجد عهدة نشطة لإرجاعها`);
          return;
        }
      }
      setProblem("none");
      setRepairCost("");
      setProblemNote("");
      setResponsibleId("");
      setManagerApproval(false);
      setProblemPhoto(null);
      setPending(res);
    } catch (e) {
      showFlash("err", apiErrorMessage(e, "تعذّر التعرف على الرمز"));
    } finally {
      setBusy(false);
    }
  }

  async function scanImageFile(file: File) {
    try {
      const Detector = (window as any).BarcodeDetector;
      if (!Detector) throw new Error("المتصفح لا يدعم قراءة QR — استخدم الإدخال اليدوي");
      const bitmap = await createImageBitmap(file);
      const detector = new Detector({ formats: ["qr_code", "code_128", "ean_13", "ean_8"] });
      const results = await detector.detect(bitmap);
      bitmap.close();
      const value = String(results?.[0]?.rawValue ?? "").trim();
      if (!value) throw new Error("لم يظهر رمز واضح في الصورة");
      await handleCode(value);
    } catch (e) {
      showFlash("err", apiErrorMessage(e, "تعذّر قراءة الرمز"));
    }
  }

  // ── Confirm actions ────────────────────────────────────────────────────────
  async function confirmCheckout() {
    if (!pending || !booking) return;
    if (!employeeId) {
      showFlash("err", "اختر الموظف المسؤول قبل الإخراج");
      return;
    }
    setBusy(true);
    try {
      const staffName = staff.find((s) => String(s.id) === employeeId);
      await adminFetch("/admin/custody", {
        method: "POST",
        body: JSON.stringify({
          productId: pending.productId,
          staffId: Number(employeeId),
          quantity: 1,
          checklistConfirmed: true,
          notes: `حجز #${booking.bookingNo ?? booking.id}${vehicle ? ` · مركبة: ${vehicle}` : ""}${
            staffName ? ` · ${staffName.fullName ?? staffName.username}` : ""
          }`,
        }),
      });
      setProcessed((p) => ({ ...p, [pending.productId]: "checkout" }));
      setPending(null);
      await refetchCustody();
      showFlash("ok", `تم إخراج ${pending.name} للحجز`);
    } catch (e) {
      showFlash("err", apiErrorMessage(e, "تعذّر إخراج الأصل"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmReturn() {
    if (!pending || !booking) return;
    // Required-field validation per problem type.
    if (problem === "broken") {
      if (!problemNote.trim()) return showFlash("err", "أدخل وصف الكسر");
      if (!responsibleId) return showFlash("err", "اختر الموظف المسؤول عن الكسر");
    }
    if (problem === "lost") {
      if (!problemNote.trim()) return showFlash("err", "أدخل سبب الفقدان");
      if (!responsibleId) return showFlash("err", "اختر الموظف المسؤول");
      if (!managerApproval) return showFlash("err", "مطلوب اعتماد المدير قبل تسجيل الفقدان");
    }
    setBusy(true);
    try {
      const resp = staff.find((s) => String(s.id) === responsibleId);
      const respTxt = resp ? ` · المسؤول: ${resp.fullName ?? resp.username}` : "";
      const tag = ` · حجز #${booking.bookingNo ?? booking.id}`;
      if (problem === "broken") {
        // Broken → Maintenance (status + timeline + audit + maintenance record).
        await adminFetch("/admin/assets/action", {
          method: "POST",
          body: JSON.stringify({
            productId: pending.productId,
            action: "maintenance",
            cost: Number(repairCost) || 0,
            notes: `كسر: ${problemNote}${respTxt}${tag}`,
            image: problemPhoto || undefined,
          }),
        });
        const c = activeCustodyFor(pending.productId);
        if (c) await adminFetch(`/admin/custody/${c.id}`, { method: "PATCH", body: JSON.stringify({}) });
        setProcessed((p) => ({ ...p, [pending.productId]: "return" }));
        showFlash("ok", `تم استلام ${pending.name} وإرساله للصيانة`);
      } else if (problem === "lost") {
        // Lost → status lost + manager notification (from the action handler).
        await adminFetch("/admin/assets/action", {
          method: "POST",
          body: JSON.stringify({
            productId: pending.productId,
            action: "lost",
            notes: `فقدان: ${problemNote}${respTxt}${tag} · باعتماد المدير`,
          }),
        });
        setProcessed((p) => ({ ...p, [pending.productId]: "lost" }));
        showFlash("ok", `تم تسجيل ${pending.name} كمفقود وإشعار المدير`);
      } else {
        // No problem → return to warehouse (status Available + passport reset).
        const c = activeCustodyFor(pending.productId);
        if (c) await adminFetch(`/admin/custody/${c.id}`, { method: "PATCH", body: JSON.stringify({}) });
        setProcessed((p) => ({ ...p, [pending.productId]: "return" }));
        showFlash("ok", `تم استلام ${pending.name}`);
      }
      setPending(null);
      await refetchCustody();
    } catch (e) {
      showFlash("err", apiErrorMessage(e, "تعذّر استلام الأصل"));
    } finally {
      setBusy(false);
    }
  }

  async function markLost(productId: number, name: string) {
    setBusy(true);
    try {
      await adminFetch("/admin/assets/action", {
        method: "POST",
        body: JSON.stringify({ productId, action: "lost", notes: `أصل غير مُستلَم — حجز #${booking?.bookingNo ?? booking?.id}` }),
      });
      setProcessed((p) => ({ ...p, [productId]: "lost" }));
      await refetchCustody();
      showFlash("ok", `تم تسجيل ${name} كمفقود`);
    } catch (e) {
      showFlash("err", apiErrorMessage(e, "تعذّر التسجيل"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (booking?.id) {
      refetchAssets();
      refetchCustody();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id]);

  const inputCls =
    "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-24 sm:pb-4" dir="rtl">
      {/* Flash animation overlay */}
      {flash && (
        <div
          className={`fixed inset-x-0 top-16 z-50 mx-auto max-w-md rounded-xl px-4 py-3 text-center text-sm font-semibold shadow-lg animate-in fade-in slide-in-from-top-2 ${
            flash.kind === "ok" ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
          }`}
        >
          <span className="inline-flex items-center gap-2">
            {flash.kind === "ok" ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
            {flash.msg}
          </span>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <ScanLine className="w-6 h-6 text-primary" /> بوابة مسح الأصول
        </h1>
        <p className="text-sm text-muted-foreground mt-1">مسح QR لإخراج واستلام أصول الحجز مع التحقق والتتبّع الكامل.</p>
      </div>

      {/* Mode toggle */}
      <div className="grid grid-cols-2 gap-2 max-w-md">
        <button
          type="button"
          onClick={() => switchMode("checkout")}
          className={`flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 font-bold transition-colors ${
            mode === "checkout" ? "border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400" : "border-border/40 text-muted-foreground"
          }`}
        >
          <ArrowUpFromLine className="h-5 w-5" /> خروج الكوشات
        </button>
        <button
          type="button"
          onClick={() => switchMode("return")}
          className={`flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 font-bold transition-colors ${
            mode === "return" ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-border/40 text-muted-foreground"
          }`}
        >
          <ArrowDownToLine className="h-5 w-5" /> استلام الكوشات
        </button>
      </div>

      {!booking ? (
        /* Booking picker */
        <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
          <p className="font-semibold text-foreground">اختر الحجز</p>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={bookingSearch}
              onChange={(e) => setBookingSearch(e.target.value)}
              placeholder="بحث بالاسم أو رقم الحجز..."
              className={`${inputCls} pr-10`}
            />
          </div>
          <div className="space-y-2 max-h-[460px] overflow-y-auto">
            {bookingsLoading ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)
            ) : filteredBookings.length === 0 ? (
              <EmptyState message="لا توجد حجوزات" />
            ) : (
              filteredBookings.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => selectBooking(b)}
                  className="w-full text-right rounded-lg border border-border/30 bg-background/50 px-4 py-3 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">حجز #{b.bookingNo ?? b.id}</span>
                    <span className="text-xs text-muted-foreground">{b.status ?? ""}</span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    {b.customerName ?? "—"}
                    {b.hallLocation ? ` · ${b.hallLocation}` : ""}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Booking header + progress */}
          <div className="bg-card rounded-xl border border-border/30 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-bold text-foreground">حجز #{booking.bookingNo ?? booking.id}</p>
                <p className="text-sm text-muted-foreground">{booking.customerName ?? "—"}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setBooking(null)} className="gap-1">
                <ArrowRight className="h-4 w-4" /> تغيير الحجز
              </Button>
            </div>
            <div className="mt-3">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="font-semibold text-foreground">
                  {mode === "checkout" ? "تم إخراج" : "تم استلام"} {doneCount} / {required.length}
                </span>
                {allDone && <span className="text-emerald-500 font-semibold">اكتمل ✓</span>}
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full transition-all ${mode === "checkout" ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${required.length ? (doneCount / required.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>

          {/* Checkout: employee + vehicle */}
          {mode === "checkout" && (
            <div className="bg-card rounded-xl border border-border/30 p-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">
                <span className="flex items-center gap-1 mb-1"><User className="h-3.5 w-3.5" /> الموظف المسؤول</span>
                <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputCls}>
                  <option value="">— اختر الموظف —</option>
                  {staff.map((s) => (
                    <option key={s.id} value={String(s.id)}>{s.fullName || s.username}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                <span className="flex items-center gap-1 mb-1"><Truck className="h-3.5 w-3.5" /> المركبة</span>
                <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="رقم/اسم المركبة" className={inputCls} />
              </label>
            </div>
          )}

          {/* Scan area */}
          <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
            <label className="block">
              <div className="w-full rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 py-8 grid place-items-center cursor-pointer hover:bg-primary/10 transition-colors">
                {busy ? <Loader2 className="h-10 w-10 text-primary animate-spin" /> : <Camera className="h-10 w-10 text-primary" />}
                <span className="mt-2 font-bold text-foreground">مسح رمز QR بالكاميرا</span>
                <span className="text-xs text-muted-foreground">اضغط لفتح الكاميرا ومسح الأصل</span>
              </div>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void scanImageFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (manualCode.trim()) void handleCode(manualCode);
              }}
              className="flex gap-2"
            >
              <input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="إدخال يدوي: QR / Barcode / AJN-A000001"
                className={inputCls}
              />
              <Button type="submit" size="icon" disabled={busy || !manualCode.trim()}>
                <ScanLine className="h-4 w-4" />
              </Button>
            </form>
          </div>

          {/* Required assets list */}
          <div className="bg-card rounded-xl border border-border/30 p-4">
            <p className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-primary" /> أصول الحجز
            </p>
            {assetsLoading ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
            ) : required.length === 0 ? (
              <EmptyState message="لا توجد أصول مرتبطة بهذا الحجز. اربط الأصول من صفحة الحجز أولاً." />
            ) : (
              <ul className="space-y-2">
                {required.map((a) => {
                  const state = processed[a.productId];
                  return (
                    <li
                      key={a.productId}
                      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                        state === "lost"
                          ? "border-red-500/40 bg-red-500/5"
                          : state
                            ? "border-emerald-500/40 bg-emerald-500/5"
                            : "border-border/30 bg-background/40"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{a.name}</p>
                        <p className="text-xs text-muted-foreground">الحالة: {a.status} · الكمية: {a.quantity}</p>
                      </div>
                      {state === "lost" ? (
                        <span className="text-xs font-semibold text-red-500 flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> مفقود</span>
                      ) : state ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                      ) : (
                        <span className="text-xs text-muted-foreground">بانتظار المسح</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Missing / finish */}
          {required.length > 0 && (
            <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
              {allDone ? (
                <div className="flex items-center gap-2 text-emerald-500 font-semibold">
                  <CheckCircle2 className="h-5 w-5" />
                  {mode === "checkout" ? "تم إخراج جميع أصول الحجز" : "تم استلام جميع أصول الحجز"}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-amber-500 font-semibold">
                    <AlertTriangle className="h-5 w-5" /> يوجد {missing.length} أصل غير {mode === "checkout" ? "مُخرَج" : "مُستلَم"}.
                  </div>
                  {mode === "return" && (
                    <div className="space-y-1.5">
                      {missing.map((a) => (
                        <div key={a.productId} className="flex items-center justify-between gap-2 text-sm rounded-lg border border-border/30 px-3 py-1.5">
                          <span className="text-foreground truncate">{a.name}</span>
                          <Button size="sm" variant="ghost" className="text-red-500 gap-1" disabled={busy} onClick={() => markLost(a.productId, a.name)}>
                            <AlertTriangle className="h-3.5 w-3.5" /> تسجيل كمفقود
                          </Button>
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground">لا يمكن إغلاق الحجز حتى يتم استلام كل الأصول أو تسجيلها كمفقودة (يتطلب اعتماد المدير).</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Confirmation overlay */}
      {pending && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => !busy && setPending(null)}>
          <div className="w-full max-w-md rounded-2xl bg-card border border-border/40 p-5 space-y-4" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-bold text-lg text-foreground">
                {mode === "checkout" ? "هل تريد إخراج هذا الأصل للحجز؟" : "هل تم استلام الأصل؟"}
              </p>
              <button type="button" onClick={() => !busy && setPending(null)} className="text-muted-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="rounded-xl border border-border/30 bg-background/50 p-3 space-y-1">
              <p className="font-semibold text-foreground">{pending.name}</p>
              <p className="text-xs font-mono text-muted-foreground" dir="ltr">{pending.assetCode}</p>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-1">
                <span>الحالة: <b className="text-foreground">{pending.status}</b></span>
                <span>الموقع: <b className="text-foreground">{pending.location ?? "المخزن"}</b></span>
                <span>الحجز: <b className="text-foreground">#{booking?.bookingNo ?? booking?.id}</b></span>
                <span>الصحة: <b className="text-emerald-500">{BLOCKED_CHECKOUT.has(pending.status) ? "—" : "جيدة"}</b></span>
              </div>
            </div>

            {mode === "return" && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">هل توجد مشكلة في هذا الأصل؟</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ["none", "لا يوجد", "emerald"],
                    ["broken", "يوجد كسر", "amber"],
                    ["lost", "يوجد فقدان", "red"],
                  ] as const).map(([v, l, c]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setProblem(v)}
                      className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                        problem === v
                          ? c === "emerald"
                            ? "border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : c === "amber"
                              ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                              : "border-red-500 bg-red-500/15 text-red-600 dark:text-red-400"
                          : "border-border/40 text-muted-foreground"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                {problem === "broken" && (
                  <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <textarea value={problemNote} onChange={(e) => setProblemNote(e.target.value)} placeholder="وصف الكسر *" className={`${inputCls} min-h-[56px]`} />
                    <input type="number" value={repairCost} onChange={(e) => setRepairCost(e.target.value)} placeholder="تكلفة الإصلاح التقديرية" className={inputCls} />
                    <select value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)} className={inputCls}>
                      <option value="">— الموظف المسؤول * —</option>
                      {staff.map((s) => (<option key={s.id} value={String(s.id)}>{s.fullName || s.username}</option>))}
                    </select>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <Camera className="h-4 w-4" /> {problemPhoto ? "تم إرفاق صورة ✓" : "إرفاق صورة (اختياري)"}
                      <input type="file" accept="image/*" capture="environment" className="hidden"
                        onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { setProblemPhoto(await compressImageFile(f, 1400, 0.8)); } catch {} } e.target.value = ""; }} />
                    </label>
                    <p className="text-xs text-muted-foreground">سيُرسَل الأصل للصيانة ويُنشأ سجل صيانة.</p>
                  </div>
                )}

                {problem === "lost" && (
                  <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                    <textarea value={problemNote} onChange={(e) => setProblemNote(e.target.value)} placeholder="سبب الفقدان *" className={`${inputCls} min-h-[56px]`} />
                    <select value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)} className={inputCls}>
                      <option value="">— الموظف المسؤول * —</option>
                      {staff.map((s) => (<option key={s.id} value={String(s.id)}>{s.fullName || s.username}</option>))}
                    </select>
                    <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                      <input type="checkbox" checked={managerApproval} onChange={(e) => setManagerApproval(e.target.checked)} className="accent-red-500" />
                      اعتماد المدير على تسجيل الفقدان *
                    </label>
                    <p className="text-xs text-muted-foreground">سيُخصَم من المخزون، ويُشعَر المدير.</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => !busy && setPending(null)} disabled={busy}>إلغاء</Button>
              <Button
                className="flex-1 gap-2"
                disabled={busy}
                onClick={() => (mode === "checkout" ? confirmCheckout() : confirmReturn())}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                تأكيد
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
