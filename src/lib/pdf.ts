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

function safeCssColor(value: string, fallback: string) {
  const color = value?.trim();
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return color || fallback;
  return /(oklab|lab|oklch|lch|color)\(/i.test(color) ? fallback : color;
}

function createPdfSnapshot(element: HTMLElement) {
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.top = "0";
  wrapper.style.left = "-100000px";
  wrapper.style.width = `${Math.max(element.scrollWidth, element.offsetWidth, 1)}px`;
  wrapper.style.backgroundColor = "#ffffff";
  wrapper.style.pointerEvents = "none";
  wrapper.style.zIndex = "-1";

  const clone = element.cloneNode(true) as HTMLElement;
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  const sourceNodes = [element, ...Array.from(element.querySelectorAll<HTMLElement>("*"))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))];
  for (let index = 0; index < cloneNodes.length; index++) {
    const source = sourceNodes[index];
    const target = cloneNodes[index];
    if (!source || !target) continue;
    const computed = window.getComputedStyle(source);
    target.style.color = safeCssColor(computed.color, "#111827");
    target.style.backgroundColor = safeCssColor(computed.backgroundColor, "transparent");
    target.style.borderTopColor = safeCssColor(computed.borderTopColor, "#d1d5db");
    target.style.borderRightColor = safeCssColor(computed.borderRightColor, "#d1d5db");
    target.style.borderBottomColor = safeCssColor(computed.borderBottomColor, "#d1d5db");
    target.style.borderLeftColor = safeCssColor(computed.borderLeftColor, "#d1d5db");
    target.style.outlineColor = safeCssColor(computed.outlineColor, "#d1d5db");
    target.style.setProperty("fill", safeCssColor(computed.fill, "#111827"));
    target.style.setProperty("stroke", safeCssColor(computed.stroke, "#111827"));
    target.style.boxShadow = "none";
    target.style.textShadow = "none";
  }

  return { snapshot: clone, cleanup: () => wrapper.remove() };
}

export type PdfExportOptions = {
  /** jsPDF page format — "a4" (default) or a custom [widthMm, heightMm] for thermal receipts. */
  format?: string | number[];
  /** page margin in mm (number or [top,right,bottom,left]). Default 8. */
  margin?: number | number[];
  /** html2canvas sampling scale. Use 3.125 for roughly 300 DPI from CSS's 96 DPI baseline. */
  scale?: number;
  /** html2pdf page-break modes. Use ["css", "legacy"] for tables that may continue to another page. */
  pagebreakMode?: string[];
};

export async function downloadElementPdf(
  element: HTMLElement | null,
  filename: string,
  options?: PdfExportOptions,
) {
  if (!element || typeof window === "undefined") {
    throw new Error("العنصر غير جاهز للتصدير");
  }

  const mod = await import("html2pdf.js");
  const factory = ((mod as any).default ?? mod) as () => Html2PdfWorker;
  if (typeof factory !== "function") {
    throw new Error("مكتبة PDF غير جاهزة");
  }

  const { snapshot, cleanup } = createPdfSnapshot(element);
  try {
    await factory()
      .set({
        margin: options?.margin ?? [8, 8, 8, 8],
        filename,
        image: { type: "jpeg", quality: 0.96 },
        html2canvas: {
          scale: options?.scale ?? Math.min(2, window.devicePixelRatio || 1.5),
          useCORS: true,
          allowTaint: true,
          backgroundColor: "#ffffff",
          imageTimeout: 15000,
          onclone: preparePdfClone,
        },
        jsPDF: { unit: "mm", format: options?.format ?? "a4", orientation: "portrait" },
        pagebreak: { mode: options?.pagebreakMode ?? ["avoid-all", "css", "legacy"] },
      })
      .from(snapshot)
      .save();
  } finally {
    cleanup();
  }
}
