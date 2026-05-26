"use client";

type Html2PdfWorker = {
  set: (options: Record<string, unknown>) => Html2PdfWorker;
  from: (element: HTMLElement) => Html2PdfWorker;
  save: () => Promise<void>;
};

function preparePdfClone(doc: Document) {
  const style = doc.createElement("style");
  style.textContent = `
    * {
      color-scheme: light !important;
      box-shadow: none !important;
      text-shadow: none !important;
    }
    body,
    .bg-background,
    .bg-card,
    .bg-muted,
    .bg-muted\\/20,
    .bg-card\\/60 {
      background: #ffffff !important;
    }
    .text-foreground,
    .text-card-foreground,
    .text-primary {
      color: #111827 !important;
    }
    .text-muted-foreground {
      color: #4b5563 !important;
    }
    .border,
    .border-border,
    .border-border\\/30,
    .border-border\\/40,
    .border-neutral-300 {
      border-color: #d1d5db !important;
    }
  `;
  doc.head.appendChild(style);

  const win = doc.defaultView;
  if (!win?.getComputedStyle || !doc.body) return;

  const unsupportedColor = /(oklab|lab|oklch|lch|color)\(/i;
  const safeColor = (value: string, fallback: string) => {
    const color = value?.trim();
    if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return color || fallback;
    return unsupportedColor.test(color) ? fallback : color;
  };

  const all = [doc.body, ...Array.from(doc.body.querySelectorAll<HTMLElement>("*"))];
  for (const el of all) {
    const computed = win.getComputedStyle(el);
    el.style.color = safeColor(computed.color, "#111827");
    el.style.backgroundColor = safeColor(computed.backgroundColor, el === doc.body ? "#ffffff" : "transparent");
    el.style.borderTopColor = safeColor(computed.borderTopColor, "#d1d5db");
    el.style.borderRightColor = safeColor(computed.borderRightColor, "#d1d5db");
    el.style.borderBottomColor = safeColor(computed.borderBottomColor, "#d1d5db");
    el.style.borderLeftColor = safeColor(computed.borderLeftColor, "#d1d5db");
    el.style.outlineColor = safeColor(computed.outlineColor, "#d1d5db");
    el.style.setProperty("fill", safeColor(computed.fill, "#111827"));
    el.style.setProperty("stroke", safeColor(computed.stroke, "#111827"));
    el.style.boxShadow = "none";
    el.style.textShadow = "none";
  }
}

export async function downloadElementPdf(element: HTMLElement | null, filename: string) {
  if (!element || typeof window === "undefined") {
    throw new Error("العنصر غير جاهز للتصدير");
  }

  const mod = await import("html2pdf.js");
  const factory = ((mod as any).default ?? mod) as () => Html2PdfWorker;
  if (typeof factory !== "function") {
    throw new Error("مكتبة PDF غير جاهزة");
  }

  await factory()
    .set({
      margin: [8, 8, 8, 8],
      filename,
      image: { type: "jpeg", quality: 0.96 },
      html2canvas: {
        scale: Math.min(2, window.devicePixelRatio || 1.5),
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        imageTimeout: 15000,
        onclone: preparePdfClone,
      },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["avoid-all", "css", "legacy"] },
    })
    .from(element)
    .save();
}
