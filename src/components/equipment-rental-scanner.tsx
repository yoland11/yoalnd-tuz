import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Camera, Loader2, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EquipmentRentalAssetLine } from "@/lib/equipment-rentals";
import { resolveRentalScan } from "@/lib/equipment-rental-scan";

const LiveScanner = lazy(() => import("@/views/staff/live-scanner").then(module => ({ default: module.LiveScanner })));

export function EquipmentRentalScanner({ assets, action, busy, onSelect }: {
  assets: EquipmentRentalAssetLine[];
  action: "dispatch" | "return";
  busy: boolean;
  onSelect: (productId: number) => void;
}) {
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const active = useRef(false);
  const cameraActive = useRef(false);
  const cameraGeneration = useRef(0);
  const cameraSession = cameraGeneration.current;
  active.current = !busy;
  cameraActive.current = camera && !busy;
  useEffect(() => () => { active.current = false; cameraActive.current = false; cameraGeneration.current++; }, []);
  useEffect(() => { if (busy) { cameraGeneration.current++; setCamera(false); } }, [busy]);

  function detect(value: string) {
    // LiveScanner can finish an asynchronous read after unmount. Never act on it.
    if (!active.current) return;
    const match = resolveRentalScan(value, assets, action);
    if ("error" in match) { setError(match.error); setMessage(""); return; }
    setCode(""); setError("");
    const asset = assets.find(line => line.productId === match.productId)!;
    setMessage(`تم تحديد ${asset.name}. أدخل الكمية يدوياً أو تابع مسح المعدات.`);
    onSelect(match.productId);
  }

  return <section className="flex flex-col gap-3 rounded-xl border border-primary/15 p-3" aria-label="تحديد معدات الإيجار بالباركود">
    <p className="text-xs text-muted-foreground">وجّه الكاميرا إلى الرمز، أو استخدم قارئ الباركود في الحقل. حدّد كمية كل معدة قبل الحفظ.</p>
    {!busy ? <div className="flex flex-col gap-3">
      {!camera && <label className="flex flex-col gap-1.5 text-xs">باركود المعدة أو رمز الأصل
        <Input autoFocus dir="ltr" value={code} onChange={event => setCode(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); detect(code); } }} placeholder="AJN-A000001" />
      </label>}
      <div className="flex flex-wrap gap-2">
        {!camera && <Button type="button" size="sm" disabled={!code.trim()} onClick={() => detect(code)}><ScanLine />تحديد المعدة</Button>}
        <Button type="button" variant="outline" size="sm" aria-pressed={camera} onClick={() => { cameraActive.current = false; cameraGeneration.current++; setCamera(!camera); }}><Camera />{camera ? "إيقاف الكاميرا" : "تشغيل الكاميرا"}</Button>
      </div>
      {camera ? <Suspense fallback={<p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />جارٍ تحميل الماسح…</p>}><LiveScanner key={cameraSession} active={!busy} stopOnDetect={false} onDetect={value => { if (cameraActive.current && cameraSession === cameraGeneration.current) detect(value); }} /></Suspense> : null}
    </div> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-primary">{message}</p> : null}
  </section>;
}
