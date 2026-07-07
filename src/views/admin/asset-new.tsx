import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Boxes,
  Camera,
  CheckSquare,
  ClipboardList,
  Link2,
  Loader2,
  Plus,
  Printer,
  QrCode,
  Save,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./_layout";
import {
  adminFetch,
  apiErrorMessage,
  compressImageFile,
  formatCurrency,
} from "./_lib";
import {
  DEFAULT_TEMPLATES,
  DEFAULT_LABEL_SETTINGS,
  generateQrDataUrl,
  generateBarcodeSvg,
  openLabelPrintWindow,
  recordLabelPrint,
  type LabelData,
} from "./label-helpers";

// ── Reference data ─────────────────────────────────────────────────────────
const CATEGORIES: [string, string][] = [
  ["Camera", "كاميرا"],
  ["Lens", "عدسة"],
  ["Drone", "درون"],
  ["Lighting", "إضاءة"],
  ["Audio", "صوت"],
  ["Speaker", "سماعة"],
  ["Mixer", "مكسر صوت"],
  ["Screen", "شاشة"],
  ["Decoration", "ديكور"],
  ["Vehicle", "مركبة"],
  ["Furniture", "أثاث"],
  ["Other", "أخرى"],
];

const STATUSES: [string, string][] = [
  ["available", "متاح"],
  ["reserved", "محجوز"],
  ["checked_out", "بالعهدة"],
  ["maintenance", "صيانة"],
  ["lost", "مفقود"],
  ["retired", "مستبعد"],
];

// Map the form status → the server-side assetProfilesTable.status vocabulary.
const STATUS_TO_PROFILE: Record<string, string> = {
  available: "active",
  reserved: "reserved",
  checked_out: "checked_out",
  maintenance: "maintenance",
  lost: "lost",
  retired: "retired",
};

type Supplier = { id: number; name: string };
type WarehouseRow = { id: number; name: string };
type ProductRow = { id: number; name: string; nameAr: string; barcode?: string };

type SavedAsset = {
  productId: number;
  assetCode: string;
  barcode: string;
  qrDataUrl: string;
  scanUrl: string;
  name: string;
};

const EMPTY = {
  name: "",
  nameAr: "",
  category: "Camera",
  brand: "",
  model: "",
  serialNumber: "",
  invoiceNumber: "",
  supplierName: "",
  purchaseDate: "",
  purchaseCost: "",
  currentValue: "",
  warrantyUntil: "",
  insuranceUntil: "",
  warehouseId: "",
  room: "",
  shelf: "",
  position: "",
  status: "available",
  isRental: false,
  pricePerDay: "",
  depreciationEnabled: true,
  salvageValue: "",
  usefulLife: "50",
  notes: "",
};

function num(v: string): number {
  const n = Number.parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function assetCodePreview(id?: number) {
  return id ? `AJN-A${String(id).padStart(6, "0")}` : "AJN-A······";
}

export default function AssetNewPage() {
  const [, setLocation] = useLocation();
  const [form, setForm] = useState({ ...EMPTY });
  const [mainPhoto, setMainPhoto] = useState<string | null>(null);
  const [invoiceImage, setInvoiceImage] = useState<string | null>(null);
  const [additionalPhotos, setAdditionalPhotos] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<string[]>([]);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [accessories, setAccessories] = useState<number[]>([]);
  const [accessorySearch, setAccessorySearch] = useState("");

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [saved, setSaved] = useState<SavedAsset | null>(null);

  // Live QR + barcode preview (reuses the label engine; keyed off the serial).
  const [qrPreview, setQrPreview] = useState("");
  const [barcodePreview, setBarcodePreview] = useState("");
  const previewCode = form.serialNumber.trim() || form.model.trim() || "AJN-ASSET";

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["admin", "suppliers"],
    queryFn: () => adminFetch("/admin/purchases/suppliers"),
    staleTime: 5 * 60 * 1000,
  });
  const { data: warehouseData } = useQuery<{ warehouses: WarehouseRow[] }>({
    queryKey: ["admin", "warehouses-list"],
    queryFn: () => adminFetch("/admin/warehouse-transfers"),
    staleTime: 5 * 60 * 1000,
  });
  const warehouses = warehouseData?.warehouses ?? [];
  const { data: products = [] } = useQuery<ProductRow[]>({
    queryKey: ["admin", "asset-accessory-products"],
    queryFn: () => adminFetch("/admin/products?limit=1000"),
    staleTime: 3 * 60 * 1000,
  });

  useEffect(() => {
    let alive = true;
    generateQrDataUrl(previewCode, 240)
      .then((d) => alive && setQrPreview(d))
      .catch(() => alive && setQrPreview(""));
    generateBarcodeSvg(previewCode, "CODE128", { height: 48, displayValue: true })
      .then((s) => alive && setBarcodePreview(s))
      .catch(() => alive && setBarcodePreview(""));
    return () => {
      alive = false;
    };
  }, [previewCode]);

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function flash(kind: "ok" | "err", msg: string) {
    setNotice({ kind, msg });
    if (kind === "ok") window.setTimeout(() => setNotice(null), 5000);
  }

  async function pickImage(onDone: (dataUrl: string) => void, files: FileList | null) {
    if (!files || !files.length) return;
    try {
      const url = await compressImageFile(files[0], 1600, 0.82);
      onDone(url);
    } catch (err) {
      flash("err", apiErrorMessage(err, "تعذّر تحميل الصورة"));
    }
  }

  const accessoryProducts = useMemo(() => {
    const q = accessorySearch.trim().toLowerCase();
    const list = q
      ? products.filter(
          (p) => p.nameAr?.toLowerCase().includes(q) || p.name?.toLowerCase().includes(q),
        )
      : products;
    return list.slice(0, 40);
  }, [products, accessorySearch]);

  function validate(): string | null {
    if (!form.name.trim() && !form.nameAr.trim()) return "أدخل اسم الأصل (عربي أو إنجليزي)";
    if (!form.serialNumber.trim()) return "الرقم التسلسلي مطلوب ويجب أن يكون فريداً";
    return null;
  }

  /**
   * Save orchestration — reuses existing endpoints only:
   *  1) POST /products            → creates product (auto barcode + initial stock movement + audit)
   *  2) POST /admin/assets        → creates depreciation profile (+ audit + timeline)
   *  3) POST /admin/enterprise/assets → creates Asset Passport (+ QR token)
   *  4) GET  /admin/assets/qr     → ensures QR token row + returns scannable QR image
   */
  async function persist(): Promise<SavedAsset> {
    const categoryLabel =
      CATEGORIES.find(([v]) => v === form.category)?.[1] ?? form.category;

    // Build the product image list in a known order so we can map roles back to URLs.
    const imageInputs: string[] = [];
    let mainIdx = -1;
    let invoiceIdx = -1;
    if (mainPhoto) {
      mainIdx = imageInputs.length;
      imageInputs.push(mainPhoto);
    }
    if (invoiceImage) {
      invoiceIdx = imageInputs.length;
      imageInputs.push(invoiceImage);
    }
    const addStart = imageInputs.length;
    imageInputs.push(...additionalPhotos);

    // 1) Product
    const product = await adminFetch<any>("/products", {
      method: "POST",
      body: JSON.stringify({
        name: form.name.trim() || form.nameAr.trim(),
        nameAr: form.nameAr.trim() || form.name.trim(),
        description: form.notes.trim() || undefined,
        price: num(form.currentValue) || num(form.purchaseCost),
        costPrice: num(form.purchaseCost),
        stock: 1,
        minStock: 0,
        isRental: form.isRental,
        pricePerDay: num(form.pricePerDay),
        category: categoryLabel,
        images: imageInputs,
        isActive: true,
      }),
    });
    const productId: number = product.id;
    const persistedImages: string[] = Array.isArray(product.images) ? product.images : [];
    const mainUrl = mainIdx >= 0 ? persistedImages[mainIdx] ?? null : null;
    const invoiceUrl = invoiceIdx >= 0 ? persistedImages[invoiceIdx] ?? null : null;
    const additionalUrls = persistedImages.slice(addStart);
    const assetCode = assetCodePreview(productId);

    // 2) Depreciation profile
    await adminFetch("/admin/assets", {
      method: "POST",
      body: JSON.stringify({
        productId,
        purchasePrice: num(form.purchaseCost),
        purchaseDate: form.purchaseDate || undefined,
        expectedLifeUses: Math.max(1, Math.floor(num(form.usefulLife) || 50)),
        currentValue: num(form.currentValue) || num(form.purchaseCost),
        serialNumber: form.serialNumber.trim(),
        status: STATUS_TO_PROFILE[form.status] ?? "active",
        notes: form.notes.trim() || undefined,
        recalculate: false,
      }),
    });

    // 3) Asset Passport (+ QR token)
    await adminFetch("/admin/enterprise/assets", {
      method: "POST",
      body: JSON.stringify({
        productId,
        serialNumber: form.serialNumber.trim(),
        supplierName: form.supplierName.trim() || undefined,
        warrantyUntil: form.warrantyUntil || undefined,
        warehouseId: form.warehouseId ? Number(form.warehouseId) : undefined,
        shelfCode: [form.shelf, form.position].filter(Boolean).join("-") || undefined,
        imageUrl: mainUrl ?? undefined,
        lastLocation: "المخزن",
        metadata: {
          brand: form.brand.trim() || null,
          model: form.model.trim() || null,
          category: form.category,
          purchaseInvoiceNumber: form.invoiceNumber.trim() || null,
          insuranceUntil: form.insuranceUntil || null,
          room: form.room.trim() || null,
          shelf: form.shelf.trim() || null,
          position: form.position.trim() || null,
          checklist: checklist.map((text) => ({ text, done: false })),
          relatedProductIds: accessories,
          notes: form.notes.trim() || null,
          healthScore: 100,
          usageCount: 0,
          roi: 0,
          currentEmployee: null,
          currentLocation: "warehouse",
          depreciation: {
            enabled: form.depreciationEnabled,
            purchaseValue: num(form.purchaseCost),
            salvageValue: num(form.salvageValue),
            usefulLife: Math.max(1, Math.floor(num(form.usefulLife) || 50)),
            method: "straight_line",
          },
          mainImageUrl: mainUrl,
          invoiceImageUrl: invoiceUrl,
          additionalImages: additionalUrls,
          createdVia: "add-new-asset",
        },
      }),
    });

    // 4) Ensure/return scannable QR
    let qrDataUrl = "";
    let scanUrl = "";
    try {
      const qr = await adminFetch<any>(`/admin/assets/qr?productId=${productId}`);
      qrDataUrl = qr?.dataUrl ?? "";
      scanUrl = qr?.scanUrl ?? qr?.targetUrl ?? "";
    } catch {
      /* QR is best-effort; passport already holds a token */
    }

    return {
      productId,
      assetCode,
      barcode: product.barcode ?? "",
      qrDataUrl,
      scanUrl,
      name: form.nameAr.trim() || form.name.trim(),
    };
  }

  async function handleSave(mode: "save" | "print" | "passport") {
    const err = validate();
    if (err) return flash("err", err);
    setSaving(true);
    setNotice(null);
    try {
      const result = await persist();
      setSaved(result);
      flash("ok", `تم إنشاء الأصل ${result.assetCode} وتوليد الجواز الرقمي والباركود.`);

      if (mode === "print") {
        const label: LabelData = {
          id: String(result.productId),
          name: result.name,
          code: result.assetCode,
          barcodeValue: result.barcode || result.assetCode,
          qrValue: result.scanUrl,
          category: CATEGORIES.find(([v]) => v === form.category)?.[1] ?? form.category,
          status: STATUSES.find(([v]) => v === form.status)?.[1] ?? form.status,
        };
        try {
          await openLabelPrintWindow([label], DEFAULT_TEMPLATES.asset, DEFAULT_LABEL_SETTINGS, {
            title: `ملصق ${result.assetCode}`,
          });
          recordLabelPrint({
            who: "المسؤول",
            count: 1,
            template: "ملصق أصل",
            kind: "asset",
            printer: DEFAULT_LABEL_SETTINGS.printerName,
            status: "printed",
            note: result.assetCode,
          });
        } catch (e) {
          flash("err", apiErrorMessage(e, "تعذّرت طباعة الملصق"));
        }
      } else if (mode === "passport") {
        if (result.scanUrl) window.open(result.scanUrl, "_blank");
        else setLocation("/admin/assets");
      }
    } catch (e) {
      flash("err", apiErrorMessage(e, "تعذّر حفظ الأصل"));
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setForm({ ...EMPTY });
    setMainPhoto(null);
    setInvoiceImage(null);
    setAdditionalPhotos([]);
    setChecklist([]);
    setAccessories([]);
    setSaved(null);
    setNotice(null);
  }

  const inputCls =
    "mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <button
            type="button"
            onClick={() => setLocation("/admin/assets")}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1"
          >
            <ArrowRight className="w-3.5 h-3.5" /> رجوع إلى الأصول
          </button>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Boxes className="w-6 h-6 text-primary" /> إضافة أصل جديد
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            يُنشئ الجواز الرقمي و QR والباركود ويُسجّل الأصل في المخزون والمخزن تلقائياً.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => handleSave("print")} disabled={saving} className="gap-2">
            <Printer className="w-4 h-4" /> حفظ وطباعة QR
          </Button>
          <Button variant="outline" onClick={() => handleSave("passport")} disabled={saving} className="gap-2">
            <QrCode className="w-4 h-4" /> حفظ وفتح الجواز
          </Button>
          <Button onClick={() => handleSave("save")} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ
          </Button>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            notice.kind === "ok"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-red-500/40 bg-red-500/10 text-red-500"
          }`}
        >
          {notice.msg}
        </div>
      )}

      {saved && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <p className="font-semibold text-foreground">تم إنشاء الأصل: {saved.assetCode}</p>
            <p className="text-muted-foreground font-mono" dir="ltr">
              Barcode: {saved.barcode || "—"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saved.qrDataUrl && (
              <img src={saved.qrDataUrl} alt="QR" className="w-16 h-16 rounded bg-white p-1" />
            )}
            <Button size="sm" variant="outline" onClick={() => setLocation("/admin/assets")}>
              عرض الأصول
            </Button>
            <Button size="sm" onClick={resetForm} className="gap-1">
              <Plus className="w-4 h-4" /> أصل آخر
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        {/* ── Left: form ─────────────────────────────────────────── */}
        <div className="space-y-4">
          <Section title="المعلومات الأساسية">
            <Grid>
              <Field label="اسم الأصل (إنجليزي)">
                <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="الاسم بالعربية">
                <input className={inputCls} value={form.nameAr} onChange={(e) => set("nameAr", e.target.value)} dir="rtl" />
              </Field>
              <Field label="الفئة">
                <select className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)}>
                  {CATEGORIES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="الماركة">
                <input className={inputCls} value={form.brand} onChange={(e) => set("brand", e.target.value)} />
              </Field>
              <Field label="الموديل">
                <input className={inputCls} value={form.model} onChange={(e) => set("model", e.target.value)} />
              </Field>
              <Field label="الرقم التسلسلي (فريد) *">
                <input className={inputCls} value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} dir="ltr" />
              </Field>
            </Grid>
          </Section>

          <Section title="بيانات الشراء">
            <Grid>
              <Field label="رقم فاتورة الشراء">
                <input className={inputCls} value={form.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} />
              </Field>
              <Field label="المورّد">
                <input
                  className={inputCls}
                  list="asset-suppliers"
                  value={form.supplierName}
                  onChange={(e) => set("supplierName", e.target.value)}
                />
                <datalist id="asset-suppliers">
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
              </Field>
              <Field label="تاريخ الشراء">
                <input type="date" className={inputCls} value={form.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} />
              </Field>
              <Field label="تكلفة الشراء">
                <input type="number" className={inputCls} value={form.purchaseCost} onChange={(e) => set("purchaseCost", e.target.value)} />
              </Field>
              <Field label="القيمة الحالية">
                <input type="number" className={inputCls} value={form.currentValue} onChange={(e) => set("currentValue", e.target.value)} />
              </Field>
              <Field label="انتهاء الضمان">
                <input type="date" className={inputCls} value={form.warrantyUntil} onChange={(e) => set("warrantyUntil", e.target.value)} />
              </Field>
              <Field label="انتهاء التأمين">
                <input type="date" className={inputCls} value={form.insuranceUntil} onChange={(e) => set("insuranceUntil", e.target.value)} />
              </Field>
            </Grid>
          </Section>

          <Section title="المخزن والموقع" icon={<Warehouse className="w-4 h-4 text-primary" />}>
            <Grid>
              <Field label="المخزن">
                <select className={inputCls} value={form.warehouseId} onChange={(e) => set("warehouseId", e.target.value)}>
                  <option value="">— اختر المخزن —</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={String(w.id)}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="الغرفة">
                <input className={inputCls} value={form.room} onChange={(e) => set("room", e.target.value)} />
              </Field>
              <Field label="الرف">
                <input className={inputCls} value={form.shelf} onChange={(e) => set("shelf", e.target.value)} />
              </Field>
              <Field label="الموضع">
                <input className={inputCls} value={form.position} onChange={(e) => set("position", e.target.value)} />
              </Field>
              <Field label="الحالة">
                <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
                  {STATUSES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </Grid>
          </Section>

          <Section title="الصور" icon={<Camera className="w-4 h-4 text-primary" />}>
            <div className="grid gap-3 sm:grid-cols-3">
              <ImageSlot label="الصورة الرئيسية" value={mainPhoto} onPick={(f) => pickImage(setMainPhoto, f)} onClear={() => setMainPhoto(null)} />
              <ImageSlot label="صورة الفاتورة" value={invoiceImage} onPick={(f) => pickImage(setInvoiceImage, f)} onClear={() => setInvoiceImage(null)} />
              <div>
                <p className="text-xs text-muted-foreground mb-1">صور إضافية</p>
                <div className="flex flex-wrap gap-2">
                  {additionalPhotos.map((img, i) => (
                    <div key={i} className="relative">
                      <img src={img} alt="" className="w-16 h-16 rounded-lg object-cover border border-border/40" />
                      <button
                        type="button"
                        onClick={() => setAdditionalPhotos((a) => a.filter((_, idx) => idx !== i))}
                        className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <label className="w-16 h-16 rounded-lg border border-dashed border-border/50 grid place-items-center cursor-pointer hover:border-primary/50">
                    <Plus className="w-5 h-5 text-muted-foreground" />
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => pickImage((url) => setAdditionalPhotos((a) => [...a, url]), e.target.files)}
                    />
                  </label>
                </div>
              </div>
            </div>
          </Section>

          <Section title="الإيجار والإهلاك">
            <Grid>
              <Field label="متاح للإيجار">
                <label className="flex items-center gap-2 mt-2 text-sm">
                  <input type="checkbox" checked={form.isRental} onChange={(e) => set("isRental", e.target.checked)} className="accent-primary" />
                  تفعيل الإيجار اليومي
                </label>
              </Field>
              <Field label="سعر الإيجار اليومي">
                <input type="number" className={inputCls} value={form.pricePerDay} onChange={(e) => set("pricePerDay", e.target.value)} disabled={!form.isRental} />
              </Field>
              <Field label="تفعيل الإهلاك">
                <label className="flex items-center gap-2 mt-2 text-sm">
                  <input type="checkbox" checked={form.depreciationEnabled} onChange={(e) => set("depreciationEnabled", e.target.checked)} className="accent-primary" />
                  احتساب الإهلاك (القسط الثابت)
                </label>
              </Field>
              <Field label="القيمة التخريدية (Salvage)">
                <input type="number" className={inputCls} value={form.salvageValue} onChange={(e) => set("salvageValue", e.target.value)} disabled={!form.depreciationEnabled} />
              </Field>
              <Field label="العمر الإنتاجي (عدد الاستخدامات)">
                <input type="number" className={inputCls} value={form.usefulLife} onChange={(e) => set("usefulLife", e.target.value)} disabled={!form.depreciationEnabled} />
              </Field>
              <Field label="طريقة الإهلاك">
                <input className={inputCls} value="القسط الثابت (Straight Line)" readOnly dir="rtl" />
              </Field>
            </Grid>
          </Section>

          <Section title="قائمة الفحص (Checklist)" icon={<ClipboardList className="w-4 h-4 text-primary" />}>
            <div className="flex items-center gap-2 mb-2">
              <input
                className={inputCls.replace("mt-1 ", "")}
                placeholder="أضف عنصر فحص..."
                value={checklistDraft}
                onChange={(e) => setChecklistDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && checklistDraft.trim()) {
                    setChecklist((c) => [...c, checklistDraft.trim()]);
                    setChecklistDraft("");
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (checklistDraft.trim()) {
                    setChecklist((c) => [...c, checklistDraft.trim()]);
                    setChecklistDraft("");
                  }
                }}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {checklist.length === 0 ? (
              <p className="text-xs text-muted-foreground">لا توجد عناصر فحص.</p>
            ) : (
              <ul className="space-y-1">
                {checklist.map((item, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border/30 bg-background/50 px-3 py-1.5 text-sm">
                    <span className="flex items-center gap-2">
                      <CheckSquare className="w-4 h-4 text-primary" /> {item}
                    </span>
                    <button type="button" onClick={() => setChecklist((c) => c.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="الملحقات (معدات مرتبطة)" icon={<Link2 className="w-4 h-4 text-primary" />}>
            <input
              className={inputCls.replace("mt-1 ", "")}
              placeholder="بحث عن معدة لربطها..."
              value={accessorySearch}
              onChange={(e) => setAccessorySearch(e.target.value)}
            />
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {accessoryProducts.length === 0 ? (
                <EmptyState message="لا توجد معدات" />
              ) : (
                accessoryProducts.map((p) => {
                  const active = accessories.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setAccessories((a) => (active ? a.filter((x) => x !== p.id) : [...a, p.id]))}
                      className={`w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-right text-sm transition-colors ${
                        active ? "border-primary/60 bg-primary/10" : "border-border/30 bg-background/50 hover:border-primary/35"
                      }`}
                    >
                      <span className="truncate text-foreground">{p.nameAr || p.name}</span>
                      {active ? <CheckSquare className="w-4 h-4 text-primary shrink-0" /> : <Plus className="w-4 h-4 text-muted-foreground shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
            {accessories.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">{accessories.length} معدة مرتبطة</p>
            )}
          </Section>

          <Section title="ملاحظات داخلية">
            <textarea
              className={inputCls + " min-h-[80px]"}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="ملاحظات لا تظهر للعملاء..."
            />
          </Section>
        </div>

        {/* ── Right: live preview ────────────────────────────────── */}
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border/30 p-4 sticky top-4">
            <p className="font-semibold text-foreground flex items-center gap-2 mb-3">
              <QrCode className="w-4 h-4 text-primary" /> معاينة الهوية
            </p>
            <div className="space-y-3 text-center">
              <div>
                <p className="text-xs text-muted-foreground">رمز الأصل</p>
                <p className="font-mono font-bold text-foreground" dir="ltr">
                  {assetCodePreview(saved?.productId)}
                </p>
              </div>
              <div className="grid place-items-center">
                {(saved?.qrDataUrl || qrPreview) ? (
                  <img src={saved?.qrDataUrl || qrPreview} alt="QR" className="w-32 h-32 rounded bg-white p-2" />
                ) : (
                  <div className="w-32 h-32 rounded bg-muted grid place-items-center text-xs text-muted-foreground">QR</div>
                )}
              </div>
              <div className="bg-white rounded p-2">
                {barcodePreview ? (
                  <div dangerouslySetInnerHTML={{ __html: barcodePreview }} className="[&_svg]:w-full [&_svg]:h-12" />
                ) : (
                  <p className="text-xs text-muted-foreground">الباركود يُولّد تلقائياً</p>
                )}
                <p className="font-mono text-[11px] text-black mt-1" dir="ltr">
                  {saved?.barcode || previewCode}
                </p>
              </div>
              <div className="text-right text-xs text-muted-foreground space-y-1 pt-2 border-t border-border/30">
                <p>الحالة الصحية: <span className="text-emerald-500 font-semibold">100%</span></p>
                <p>عدّاد الاستخدام: 0</p>
                <p>العائد ROI: 0</p>
                <p>الموظف الحالي: لا أحد</p>
                <p>الموقع: المخزن</p>
                {num(form.purchaseCost) > 0 && (
                  <p>قيمة الشراء: {formatCurrency(num(form.purchaseCost))}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Small presentational helpers ─────────────────────────────────────────────
function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border/30 p-4">
      <p className="font-semibold text-foreground flex items-center gap-2 mb-3">
        {icon} {title}
      </p>
      {children}
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function ImageSlot({
  label,
  value,
  onPick,
  onClear,
}: {
  label: string;
  value: string | null;
  onPick: (files: FileList | null) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {value ? (
        <div className="relative w-full">
          <img src={value} alt={label} className="w-full h-28 rounded-lg object-cover border border-border/40" />
          <button type="button" onClick={onClear} className="absolute top-1.5 right-1.5 bg-red-500 text-white rounded-full p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <label className="w-full h-28 rounded-lg border border-dashed border-border/50 grid place-items-center cursor-pointer hover:border-primary/50">
          <Camera className="w-6 h-6 text-muted-foreground" />
          <input type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files)} />
        </label>
      )}
    </div>
  );
}
