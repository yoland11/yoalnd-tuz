import { useEffect, useRef, useState } from "react";
import { Zap, ZapOff, Loader2, Keyboard } from "lucide-react";

// All 1D + 2D symbologies requested for the asset gate.
const WANTED_FORMATS = [
  "qr_code",
  "code_128",
  "code_39",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "itf",
  "codabar",
];

/**
 * Continuous live camera scanner (reads QR + 1D barcodes) with torch, high-res,
 * continuous auto-focus, any-orientation detection, and a keyboard-wedge input
 * that also captures Bluetooth / USB barcode scanners. Falls back to manual
 * entry when the camera or BarcodeDetector is unavailable.
 */
export function LiveScanner({
  onDetect,
  active = true,
}: {
  onDetect: (code: string) => void;
  active?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  const [error, setError] = useState("");
  const [torch, setTorch] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState("");

  function emit(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    // Debounce identical reads so continuous scanning doesn't fire repeatedly.
    if (code === lastRef.current.code && now - lastRef.current.at < 1600) return;
    lastRef.current = { code, at: now };
    try { navigator.vibrate?.(50); } catch { /* ignore */ }
    onDetectRef.current(code);
  }

  useEffect(() => {
    if (!active) return;
    let alive = true;
    let detector: any = null;

    async function start() {
      const Detector = (window as any).BarcodeDetector;
      try {
        if (Detector) {
          const supported: string[] = (await Detector.getSupportedFormats?.()) ?? [];
          const formats = supported.length ? WANTED_FORMATS.filter((f) => supported.includes(f)) : WANTED_FORMATS;
          detector = new Detector({ formats });
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("الكاميرا غير مدعومة في هذا المتصفح");
          return;
        }
        // Non-standard but widely-honoured constraints (focus/exposure) — typed as any.
        const videoConstraints: any = {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          focusMode: "continuous",
          advanced: [{ focusMode: "continuous" }, { exposureMode: "continuous" }],
        };
        const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const caps: any = track?.getCapabilities?.() ?? {};
        setTorchAvailable(Boolean(caps.torch));
        // Auto-zoom a little for small labels when supported.
        if (caps.zoom && typeof caps.zoom.max === "number") {
          const z = Math.min(caps.zoom.max, (caps.zoom.min ?? 1) + (caps.zoom.max - (caps.zoom.min ?? 1)) * 0.25);
          try { await track.applyConstraints({ advanced: [{ zoom: z } as any] }); } catch { /* ignore */ }
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
        tick();
      } catch (e: any) {
        setError(e?.message || "تعذّر فتح الكاميرا");
      }
    }

    async function tick() {
      if (!alive) return;
      const v = videoRef.current;
      if (v && detector && v.readyState >= 2) {
        try {
          const codes = await detector.detect(v);
          if (codes?.length) emit(String(codes[0].rawValue ?? ""));
        } catch { /* frame not decodable yet */ }
      }
      timerRef.current = setTimeout(tick, 110); // ~9 fps — fast continuous scanning
    }

    start();
    return () => {
      alive = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as any] });
      setTorch((t) => !t);
    } catch { /* torch unsupported */ }
  }

  return (
    <div className="space-y-2" dir="rtl">
      <div className="relative aspect-[3/4] max-h-[58vh] overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {/* Scan frame */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[38%] w-[82%] rounded-lg border-2 border-primary/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.32)]" />
        </div>
        {torchAvailable && (
          <button type="button" onClick={toggleTorch} className="absolute bottom-3 left-3 rounded-full bg-white/25 p-2.5 text-white backdrop-blur">
            {torch ? <ZapOff className="h-5 w-5" /> : <Zap className="h-5 w-5" />}
          </button>
        )}
        {!ready && !error && (
          <div className="absolute inset-0 grid place-items-center text-white">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        )}
      </div>
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error} — استخدم الإدخال اليدوي أو ماسح Bluetooth/USB بالأسفل.
        </div>
      )}
      {/* Manual entry — also captures keyboard-wedge Bluetooth / USB scanners */}
      <form
        onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { emit(manual); setManual(""); } }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Keyboard className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="إدخال يدوي / ماسح Bluetooth أو USB"
            className="w-full rounded-lg border border-border bg-background pr-9 pl-3 py-2 text-sm"
          />
        </div>
        <button type="submit" disabled={!manual.trim()} className="rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
          إدخال
        </button>
      </form>
    </div>
  );
}
