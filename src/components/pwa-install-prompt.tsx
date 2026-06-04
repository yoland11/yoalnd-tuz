import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { applyPwaUpdate } from "@/lib/pwa";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [iosInstallHint, setIosInstallHint] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem("ajn-pwa-install-dismissed") === "1");
    const installHandler = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const updateHandler = () => setUpdateReady(true);
    window.addEventListener("beforeinstallprompt", installHandler);
    window.addEventListener("ajn-pwa-update-ready", updateHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", installHandler);
      window.removeEventListener("ajn-pwa-update-ready", updateHandler);
    };
  }, []);

  useEffect(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (dismissed || isStandalone || !isIos) return;
    const timer = window.setTimeout(() => setIosInstallHint(true), 1200);
    return () => window.clearTimeout(timer);
  }, [dismissed]);

  if (((!installEvent && !iosInstallHint) || dismissed) && !updateReady) return null;

  async function install() {
    if (iosInstallHint) return;
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice.catch(() => undefined);
    setInstallEvent(null);
  }

  function closePrompt() {
    localStorage.setItem("ajn-pwa-install-dismissed", "1");
    setDismissed(true);
    setUpdateReady(false);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-2rem)] rounded-xl border border-border/40 bg-card/95 p-3 shadow-xl backdrop-blur md:bottom-6" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{updateReady ? "تحديث جديد متاح" : "إضافة التطبيق إلى الشاشة الرئيسية"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {updateReady ? "حدّث التطبيق للحصول على آخر نسخة." : iosInstallHint ? "من زر المشاركة اختر إضافة إلى الشاشة الرئيسية." : "ثبّت AJN كتطبيق مستقل على جهازك."}
          </p>
        </div>
        <button
          type="button"
          onClick={updateReady ? applyPwaUpdate : install}
          disabled={iosInstallHint && !updateReady}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {updateReady ? <RefreshCw className="w-4 h-4" /> : <Download className="w-4 h-4" />}
          {updateReady ? "تحديث" : iosInstallHint ? "من المشاركة" : "إضافة"}
        </button>
        <button type="button" onClick={closePrompt} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
