import { useState } from "react";
import { ScanLine, PackageX, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { LiveScanner } from "../staff/live-scanner";
import { adminFetch, apiErrorMessage } from "./_lib";

/**
 * Reusable barcode / QR scan-to-invoice dialog.
 *
 * Reuses the shared, battle-tested `LiveScanner` (native BarcodeDetector + ZXing
 * fallback, camera switch, torch, zoom, sound, vibration, and a manual field that
 * also captures USB / Bluetooth keyboard-wedge scanners). This component adds the
 * invoice glue: resolve the scanned code to a product, hand it to the page to add
 * (or increment), and offer a quick "create product" flow for unknown codes.
 *
 * It never redesigns or owns the invoice — the page keeps its workflow and simply
 * receives `onAdd(product)` for each resolved scan.
 */

export type ScanProduct = {
  id: number;
  name?: string | null;
  nameAr?: string | null;
  barcode?: string | null;
  price?: string | number | null;
  costPrice?: string | number | null;
  stock?: string | number | null;
  sku?: string | null;
  code?: string | null;
  isAsset?: boolean | number | null;
};

type AssetInfo = {
  productId: number;
  name: string;
  assetCode: string;
  category?: string | null;
  status?: string | null;
  linkedProductId?: number | null;
};

type ScanLookupResponse = {
  found: boolean;
  entityType?: "product" | "asset" | "variant" | "inventory";
  normalizedCode: string;
  entity?: any;
  state?: string;
  message?: string;
};

/**
 * Normalize a scanned value to its bare code. Handles plain barcodes, full asset/
 * product URLs, URL-encoding, query strings, hashes, trailing slashes and spaces.
 * e.g. "https://host/assets/AJN-A000325" → "AJN-A000325".
 */
export function normalizeScannedCode(scannedValue: string): string {
  let v = String(scannedValue ?? "").trim();
  if (!v) return "";
  try {
    v = decodeURIComponent(v);
  } catch {
    /* keep raw when not valid percent-encoding */
  }
  v = v.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) || v.includes("/")) {
    const head = v.split(/[?#]/)[0];
    const segments = head.split("/").filter(Boolean);
    if (segments.length) v = segments[segments.length - 1];
  }
  return v.trim();
}

function isAssetProduct(p: ScanProduct): boolean {
  return p.isAsset === true || p.isAsset === 1;
}

/** Local fast path — search order: barcode, then internal code / SKU. */
function resolveProduct(products: ScanProduct[], normalizedCode: string): ScanProduct | null {
  const code = normalizedCode.trim().toLowerCase();
  if (!code) return null;
  const byBarcode = products.find(
    (p) => String(p.barcode ?? "").trim().toLowerCase() === code,
  );
  if (byBarcode) return byBarcode;
  const byInternal = products.find(
    (p) =>
      String(p.sku ?? "").trim().toLowerCase() === code ||
      String(p.code ?? "").trim().toLowerCase() === code,
  );
  return byInternal ?? null;
}

export function BarcodeScanDialog({
  open,
  onOpenChange,
  products,
  context,
  onAdd,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ScanProduct[];
  context: "sales" | "purchase";
  onAdd: (product: ScanProduct) => void;
  onCreated?: (product: ScanProduct) => void;
}) {
  const { toast } = useToast();
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [asset, setAsset] = useState<AssetInfo | null>(null);
  const [resolving, setResolving] = useState(false);
  const [lastAdded, setLastAdded] = useState("");
  const [continuous, setContinuous] = useState(true);

  // The camera pauses while any result / create panel is shown (or a lookup is in
  // flight) so a stray frame can't fire another scan behind the dialog.
  const scannerActive = open && !unknownCode && !creating && !asset && !resolving;

  function addProduct(product: ScanProduct) {
    onAdd(product);
    setLastAdded(product.nameAr || product.name || String(product.barcode ?? ""));
    if (!continuous) onOpenChange(false);
  }

  async function handleDetect(rawValue: string) {
    const code = normalizeScannedCode(rawValue);
    if (!code) return;

    // 1) Fast local path for sellable (non-asset) products already loaded.
    const local = resolveProduct(products, code);
    if (local && !isAssetProduct(local)) {
      addProduct(local);
      return;
    }

    // 2) Server resolves assets, variants, and products not in the loaded list.
    setResolving(true);
    try {
      const res = await adminFetch<ScanLookupResponse>(
        `/admin/scan-lookup?code=${encodeURIComponent(rawValue)}`,
      );
      if (res?.found && res.entityType === "asset") {
        // If the asset is explicitly linked to a sellable product, add that.
        if (res.entity?.linkedProductId) {
          addProduct({ ...(res.entity.linkedProduct ?? {}), id: res.entity.linkedProductId });
          return;
        }
        setAsset(res.entity as AssetInfo);
        return;
      }
      if (res?.found && res.entity) {
        addProduct(res.entity as ScanProduct);
        return;
      }
      setUnknownCode(code);
    } catch {
      // Network / permission fallback: use a local match if we have one.
      if (local) addProduct(local);
      else setUnknownCode(code);
    } finally {
      setResolving(false);
    }
  }

  function reset() {
    setUnknownCode(null);
    setCreating(false);
    setAsset(null);
  }

  function close() {
    reset();
    setLastAdded("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" /> مسح باركود
          </DialogTitle>
          <DialogDescription className="sr-only">
            امسح باركود أو QR لإضافة المنتج إلى الفاتورة
          </DialogDescription>
        </DialogHeader>

        {asset ? (
          <div className="space-y-4 py-2 text-center">
            <p className="text-sm font-semibold text-status-warning">هذا الرمز تابع إلى أصل وليس منتج مبيعات</p>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-right text-xs">
              <span>الأصل: {asset.name}</span>
              <span dir="ltr" className="font-mono">{asset.assetCode}</span>
              <span>القسم: {asset.category || "—"}</span>
              <span>الحالة: {asset.status || "—"}</span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <a href={`/admin/assets/new?edit=${asset.productId}`} target="_blank" rel="noreferrer" className="flex-1">
                  <Button variant="outline" className="w-full">فتح الأصل</Button>
                </a>
                <a href={`/admin/assets/sales?productId=${asset.productId}`} target="_blank" rel="noreferrer" className="flex-1">
                  <Button className="w-full">بيع الأصل</Button>
                </a>
              </div>
              <Button variant="ghost" onClick={reset}>إلغاء ومتابعة المسح</Button>
            </div>
          </div>
        ) : creating && unknownCode ? (
          <QuickCreateProduct
            barcode={unknownCode}
            context={context}
            busyState={[creating, setCreating]}
            onCancel={reset}
            onCreated={(product) => {
              onAdd(product);
              onCreated?.(product);
              setLastAdded(product.nameAr || product.name || unknownCode);
              reset();
            }}
          />
        ) : unknownCode ? (
          <div className="space-y-4 py-2 text-center">
            <PackageX className="mx-auto h-10 w-10 text-status-warning" />
            <div>
              <p className="font-semibold text-foreground">المنتج غير موجود</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">{unknownCode}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={() => setCreating(true)} className="gap-2">
                <Plus className="h-4 w-4" /> إنشاء منتج جديد
              </Button>
              <Button variant="outline" onClick={reset}>إلغاء ومتابعة المسح</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <LiveScanner onDetect={handleDetect} active={scannerActive} stopOnDetect={!continuous} />
            {resolving ? (
              <p className="flex items-center justify-center gap-2 rounded-lg border border-border/30 bg-background/50 px-3 py-2 text-center text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> جارٍ التحقق من الرمز…
              </p>
            ) : null}
            {lastAdded ? (
              <p className="rounded-lg border border-status-success/30 bg-status-success/10 px-3 py-2 text-center text-xs text-status-success">
                تمت إضافة: <span className="font-semibold">{lastAdded}</span>
              </p>
            ) : null}
            <label className="flex items-center justify-between rounded-lg border border-border/30 bg-background/50 px-3 py-2 text-xs text-foreground">
              <span>مسح متعدد (بقاء الماسح مفتوحاً)</span>
              <input type="checkbox" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} className="accent-primary" />
            </label>
            <Button variant="outline" onClick={close} className="w-full">إغلاق الماسح</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuickCreateProduct({
  barcode,
  context,
  busyState,
  onCancel,
  onCreated,
}: {
  barcode: string;
  context: "sales" | "purchase";
  busyState: [boolean, (v: boolean) => void];
  onCancel: () => void;
  onCreated: (product: ScanProduct) => void;
}) {
  const { toast } = useToast();
  const [, setCreating] = busyState;
  const [nameAr, setNameAr] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    if (!nameAr.trim()) {
      toast({ title: "اسم المنتج مطلوب", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const created = await adminFetch<ScanProduct>("/products", {
        method: "POST",
        body: JSON.stringify({
          name: nameAr.trim(),
          nameAr: nameAr.trim(),
          barcode: barcode.trim(),
          category: category.trim() || undefined,
          unit: unit.trim() || undefined,
          costPrice: Number.parseFloat(costPrice) || 0,
          price: Number.parseFloat(price) || 0,
          stock: Number.parseInt(stock, 10) || 0,
        }),
      });
      toast({ title: "تم إنشاء المنتج وإضافته", description: nameAr.trim() });
      onCreated(created);
    } catch (error) {
      toast({ title: "تعذّر إنشاء المنتج", description: apiErrorMessage(error), variant: "destructive" });
      setBusy(false);
      setCreating(true);
    }
  }

  const input = "w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm outline-none focus:border-primary/60";
  return (
    <div className="space-y-3 py-1">
      <div>
        <label className="text-xs text-muted-foreground">الباركود</label>
        <input value={barcode} readOnly dir="ltr" className={`${input} mt-1 font-mono opacity-80`} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">اسم المنتج *</label>
        <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus className={`${input} mt-1`} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">القسم</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)} className={`${input} mt-1`} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">الوحدة</label>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="قطعة" className={`${input} mt-1`} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">سعر الشراء</label>
          <input type="number" min="0" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} dir="ltr" className={`${input} mt-1`} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">سعر البيع</label>
          <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} dir="ltr" className={`${input} mt-1`} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">المخزون الأولي</label>
          <input type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} dir="ltr" className={`${input} mt-1`} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {context === "purchase" ? "سيُضاف الصنف إلى فاتورة الشراء بعد الحفظ." : "سيُضاف الصنف إلى فاتورة المبيعات بعد الحفظ."}
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" disabled={busy} onClick={onCancel}>رجوع</Button>
        <Button disabled={busy || !nameAr.trim()} onClick={save} className="gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} حفظ وإضافة
        </Button>
      </div>
    </div>
  );
}
