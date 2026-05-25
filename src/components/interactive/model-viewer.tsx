import { createElement, useEffect, useState } from "react";
import { Box } from "lucide-react";

let modelViewerScriptLoading: Promise<void> | null = null;

function loadModelViewer(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (customElements.get("model-viewer")) return Promise.resolve();
  if (!modelViewerScriptLoading) {
    modelViewerScriptLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.type = "module";
      script.src = "https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("model viewer failed"));
      document.head.appendChild(script);
    });
  }
  return modelViewerScriptLoading;
}

export function ModelViewerCard({ modelUrl, title = "معاينة ثلاثية الأبعاد" }: { modelUrl?: string | null; title?: string }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!modelUrl) return undefined;
    let mounted = true;
    loadModelViewer()
      .then(() => mounted && setReady(true))
      .catch(() => mounted && setReady(false));
    return () => {
      mounted = false;
    };
  }, [modelUrl]);

  if (!modelUrl) return null;

  return (
    <section className="rounded-2xl border border-border/30 bg-card p-5">
      <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-foreground">
        <Box className="h-5 w-5 text-primary" />
        {title}
      </h2>
      <div className="aspect-[16/10] overflow-hidden rounded-xl border border-border/25 bg-background">
        {ready ? (
          createElement("model-viewer", {
            src: modelUrl,
            alt: title,
            "camera-controls": true,
            "touch-action": "pan-y",
            ar: true,
            loading: "lazy",
            reveal: "auto",
            className: "h-full w-full",
          })
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            جاري تجهيز المعاينة...
          </div>
        )}
      </div>
    </section>
  );
}
