import { useCallback, useEffect, useRef, useState } from "react";
import { Zap, ZapOff, Loader2, Keyboard, SwitchCamera, CheckCircle2 } from "lucide-react";

/**
 * Continuous live camera scanner for QR + 1D/2D barcodes.
 *
 * Two decode engines, in priority order:
 *  1. The native `BarcodeDetector` API — hardware-accelerated, cheap on battery, but only
 *     shipped on Android Chrome, ChromeOS and macOS Chrome.
 *  2. ZXing (lazy-loaded, ~250 KB) — everywhere else, notably iOS Safari, Firefox and
 *     Chrome/Edge on Windows and Linux, none of which implement BarcodeDetector.
 *
 * The previous version had engine 1 only and, when it was missing, silently looped forever
 * over a live camera that could never detect anything — which is exactly why scanning
 * "only worked when typed manually".
 */

/** Native BarcodeDetector format names. */
const NATIVE_FORMATS = [
  "qr_code",
  "code_128",
  "code_39",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "itf",
  "codabar",
  "data_matrix",
  "pdf417",
  "aztec",
];

/** ZXing BarcodeFormat enum members, resolved at runtime from the loaded module. */
const ZXING_FORMAT_NAMES = [
  "QR_CODE",
  "CODE_128",
  "CODE_39",
  "EAN_13",
  "EAN_8",
  "UPC_A",
  "UPC_E",
  "ITF",
  "CODABAR",
  "DATA_MATRIX",
  "PDF_417",
  "AZTEC",
];

type Engine = "native" | "zxing" | "none";

/** Short confirmation beep. Uses WebAudio so no audio asset has to ship. */
function playSuccessBeep() {
  try {
    const Ctor: typeof AudioContext | undefined =
      (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
    oscillator.onended = () => context.close().catch(() => {});
  } catch {
    /* audio is a nicety, never a requirement */
  }
}

export function LiveScanner({
  onDetect,
  active = true,
  stopOnDetect = false,
}: {
  onDetect: (code: string) => void;
  active?: boolean;
  /**
   * Stop the camera after a successful read. Defaults to false because every current
   * call site scans a run of items in one session (warehouse out, vehicle load, install,
   * return); halting after the first code would break all of them.
   */
  stopOnDetect?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const haltedRef = useRef(false);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  const [error, setError] = useState("");
  const [torch, setTorch] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState("");
  const [engine, setEngine] = useState<Engine>("none");
  const [success, setSuccess] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [halted, setHalted] = useState(false);
  /** Bumping this re-runs the camera effect, which is how "scan another" resumes. */
  const [restartKey, setRestartKey] = useState(0);

  const stopStream = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    let nativeDetector: any = null;
    let zxingReader: any = null;

    /** Fires the callback once per distinct read, with sound + haptics + message. */
    function emit(raw: string) {
      const code = String(raw ?? "").trim();
      if (!code || haltedRef.current) return;
      const now = Date.now();
      // Debounce identical reads so a code held in frame doesn't fire repeatedly.
      if (code === lastRef.current.code && now - lastRef.current.at < 1600) return;
      lastRef.current = { code, at: now };

      playSuccessBeep();
      try { navigator.vibrate?.(60); } catch { /* unsupported on iOS */ }
      setSuccess("تم قراءة الباركود بنجاح");

      if (stopOnDetect) {
        haltedRef.current = true;
        stopStream();
        setHalted(true);
      } else {
        // Batch scanning: clear the confirmation so the next code reads cleanly.
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        successTimerRef.current = setTimeout(() => setSuccess(""), 1200);
      }
      onDetectRef.current(code);
    }

    /**
     * Loads ZXing on demand. Kept out of the main bundle because the majority of field
     * devices are Android and never need it.
     */
    async function loadZxing() {
      const [{ BrowserMultiFormatReader }, library] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      const { DecodeHintType, BarcodeFormat } = library as any;
      const hints = new Map();
      hints.set(
        DecodeHintType.POSSIBLE_FORMATS,
        ZXING_FORMAT_NAMES.map((name) => BarcodeFormat[name]).filter((value) => value !== undefined),
      );
      // TRY_HARDER trades a little CPU for markedly better reads on small,
      // distant, blurred or low-light codes.
      hints.set(DecodeHintType.TRY_HARDER, true);
      return new BrowserMultiFormatReader(hints);
    }

    async function openCamera(deviceId?: string) {
      // Non-standard focus/exposure constraints are widely honoured; typed as any.
      const videoConstraints: any = deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            focusMode: "continuous",
            advanced: [{ focusMode: "continuous" }, { exposureMode: "continuous" }],
          };
      return navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    }

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("الكاميرا غير مدعومة في هذا المتصفح");
          return;
        }

        // Engine selection happens before the camera opens, so a missing decoder is
        // reported instead of presenting a camera that can never detect anything.
        const Detector = (window as any).BarcodeDetector;
        if (Detector) {
          try {
            const supported: string[] = (await Detector.getSupportedFormats?.()) ?? [];
            const formats = supported.length
              ? NATIVE_FORMATS.filter((format) => supported.includes(format))
              : NATIVE_FORMATS;
            if (formats.length) {
              nativeDetector = new Detector({ formats });
              if (alive) setEngine("native");
            }
          } catch {
            nativeDetector = null;
          }
        }
        if (!nativeDetector) {
          try {
            zxingReader = await loadZxing();
            if (alive) setEngine("zxing");
          } catch {
            setError("تعذّر تحميل محرك قراءة الباركود");
            return;
          }
        }

        const stream = await openCamera(devices[deviceIndex]?.deviceId);
        if (!alive) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        const capabilities: any = track?.getCapabilities?.() ?? {};
        setTorchAvailable(Boolean(capabilities.torch));
        // A gentle zoom helps small labels without hurting large-code framing.
        if (capabilities.zoom && typeof capabilities.zoom.max === "number") {
          const min = capabilities.zoom.min ?? 1;
          const zoom = Math.min(capabilities.zoom.max, min + (capabilities.zoom.max - min) * 0.2);
          try { await track.applyConstraints({ advanced: [{ zoom } as any] }); } catch { /* ignore */ }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        // Populate the camera list only after permission is granted, otherwise
        // labels are blank and deviceIds are unusable.
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          const cameras = all.filter((device) => device.kind === "videoinput");
          if (alive && cameras.length) setDevices(cameras);
        } catch { /* enumeration is optional */ }

        if (alive) setReady(true);
        tick();
      } catch (err: any) {
        if (alive) setError(err?.message || "تعذّر فتح الكاميرا");
      }
    }

    /** Grabs the current frame into a canvas so ZXing can decode it. */
    function frameToCanvas(video: HTMLVideoElement): HTMLCanvasElement | null {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return null;
      let canvas = canvasRef.current;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvasRef.current = canvas;
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(video, 0, 0, width, height);
      return canvas;
    }

    async function tick() {
      if (!alive || haltedRef.current) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          if (nativeDetector) {
            const codes = await nativeDetector.detect(video);
            if (codes?.length) emit(codes[0].rawValue ?? "");
          } else if (zxingReader) {
            const canvas = frameToCanvas(video);
            if (canvas) {
              // Throws NotFoundException on every frame without a code — expected.
              const result = zxingReader.decodeFromCanvas(canvas);
              if (result) emit(result.getText());
            }
          }
        } catch {
          /* no code in this frame */
        }
      }
      if (!alive || haltedRef.current) return;
      // ZXing decoding is CPU-bound, so it gets a slower cadence than the native path.
      timerRef.current = setTimeout(tick, nativeDetector ? 110 : 220);
    }

    haltedRef.current = false;
    setHalted(false);
    setSuccess("");
    lastRef.current = { code: "", at: 0 };
    start();

    return () => {
      alive = false;
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, deviceIndex, restartKey, stopOnDetect, stopStream]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as any] });
      setTorch((current) => !current);
    } catch {
      /* torch unsupported on this camera */
    }
  }

  const engineLabel =
    engine === "native" ? "المحرك السريع" : engine === "zxing" ? "ZXing" : "";

  return (
    <div className="space-y-2" dir="rtl">
      <div className="relative aspect-[3/4] max-h-[58vh] overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[38%] w-[82%] rounded-lg border-2 border-primary/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.32)]" />
        </div>

        {torchAvailable ? (
          <button
            type="button"
            onClick={toggleTorch}
            aria-label={torch ? "إطفاء الفلاش" : "تشغيل الفلاش"}
            className="absolute bottom-3 left-3 rounded-full bg-white/25 p-2.5 text-white backdrop-blur"
          >
            {torch ? <ZapOff className="h-5 w-5" /> : <Zap className="h-5 w-5" />}
          </button>
        ) : null}

        {devices.length > 1 ? (
          <button
            type="button"
            onClick={() => setDeviceIndex((current) => (current + 1) % devices.length)}
            aria-label="تبديل الكاميرا"
            className="absolute bottom-3 right-3 rounded-full bg-white/25 p-2.5 text-white backdrop-blur"
          >
            <SwitchCamera className="h-5 w-5" />
          </button>
        ) : null}

        {engineLabel && ready && !success ? (
          <span className="absolute top-3 right-3 rounded-full bg-black/45 px-2 py-0.5 text-[11px] text-white backdrop-blur">
            {engineLabel}
          </span>
        ) : null}

        {success ? (
          <div className="absolute inset-0 grid place-items-center bg-status-success/25 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-white">
              <CheckCircle2 className="h-12 w-12" />
              <span className="text-sm font-bold">{success}</span>
              {halted ? (
                <button
                  type="button"
                  onClick={() => setRestartKey((key) => key + 1)}
                  className="mt-1 rounded-lg bg-white/25 px-3 py-1.5 text-xs font-bold backdrop-blur"
                >
                  مسح كود آخر
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {!ready && !error && !success ? (
          <div className="absolute inset-0 grid place-items-center text-white">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error} — استخدم الإدخال اليدوي أو ماسح Bluetooth/USB بالأسفل.
        </div>
      ) : null}

      {/* Manual entry — also captures keyboard-wedge Bluetooth / USB scanners */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const code = manual.trim();
          if (!code) return;
          playSuccessBeep();
          onDetectRef.current(code);
          setManual("");
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Keyboard className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="إدخال يدوي / ماسح Bluetooth أو USB"
            className="w-full rounded-lg border border-border bg-background py-2 pl-3 pr-9 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={!manual.trim()}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          إدخال
        </button>
      </form>
    </div>
  );
}
