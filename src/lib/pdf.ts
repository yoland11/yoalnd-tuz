"use client";

type Html2PdfWorker = {
  set: (options: Record<string, unknown>) => Html2PdfWorker;
  from: (element: HTMLElement) => Html2PdfWorker;
  save: () => Promise<void>;
};

async function waitForPdfAssets(element: HTMLElement) {
  const images = Array.from(element.querySelectorAll<HTMLImageElement>("img"));
  const waitForImage = (image: HTMLImageElement) => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => resolve();
      image.addEventListener("load", done, { once: true });
      image.addEventListener("error", done, { once: true });
    });
  };

  const fontsReady = document.fonts?.ready?.catch(() => undefined) ?? Promise.resolve();
  const assetsReady = Promise.all([fontsReady, ...images.map(waitForImage)]).then(() => undefined);
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 20_000));
  await Promise.race([assetsReady, timeout]);

  // Let the final font/image layout settle before cloning the A4 surface.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/**
 * html2canvas (bundled in html2pdf) cannot parse modern CSS color functions —
 * `oklch()`, `oklab()`, `lab()`, `lch()`, `hwb()`, `color()`, `color-mix()` and
 * relative colors (`hsl(from …)`). When one reaches it the whole export throws
 * ("Attempting to parse an unsupported color function") and no PDF is produced.
 * Detect any value that carries one of these so it can be replaced with a safe
 * fallback before rendering.
 */
const UNSUPPORTED_COLOR = /(?:oklab|oklch|lab|lch|hwb|color-mix|color)\(|\(\s*from[\s)]/i;

/**
 * The AJN theme defines its `*-border` tokens with relative-color syntax
 * (`hsl(from hsl(var(--x)) …)`), which resolves to `color(...)` at runtime and
 * crashes html2canvas. These variables also feed pseudo-elements and gradients
 * that inline-style sanitisation cannot reach, so the export must redefine them
 * to plain, parseable colours at the source (in the cloned document). Values are
 * visually near-identical (the base colour instead of a slightly lighter shade).
 */
const PDF_SAFE_VARIABLE_OVERRIDES = `
  :root, .dark, [data-theme] {
    --primary-border: hsl(var(--primary)) !important;
    --secondary-border: hsl(var(--secondary)) !important;
    --muted-border: hsl(var(--muted)) !important;
    --accent-border: hsl(var(--accent)) !important;
    --destructive-border: hsl(var(--destructive)) !important;
    --sidebar-primary-border: hsl(var(--sidebar-primary)) !important;
    --sidebar-accent-border: hsl(var(--sidebar-accent)) !important;
  }
`;

function preparePdfClone(doc: Document) {
  const style = doc.createElement("style");
  style.textContent = `
    ${PDF_SAFE_VARIABLE_OVERRIDES}
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

  const safeColor = (value: string, fallback: string) => {
    const color = value?.trim();
    if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return color || fallback;
    return UNSUPPORTED_COLOR.test(color) ? fallback : color;
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
    // A gradient carrying an unsupported colour function crashes html2canvas the
    // same way a solid one does; drop only those, keeping safe hex/rgb gradients.
    if (computed.backgroundImage && computed.backgroundImage !== "none" && UNSUPPORTED_COLOR.test(computed.backgroundImage)) {
      el.style.backgroundImage = "none";
    }
    el.style.boxShadow = "none";
    el.style.textShadow = "none";
  }
}

function safeCssColor(value: string, fallback: string) {
  const color = value?.trim();
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return color || fallback;
  return UNSUPPORTED_COLOR.test(color) ? fallback : color;
}

function createPdfSnapshot(element: HTMLElement) {
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.top = "0";
  wrapper.style.left = "-100000px";
  wrapper.style.width = `${Math.max(element.offsetWidth, 1)}px`;
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
    if (computed.backgroundImage && computed.backgroundImage !== "none" && UNSUPPORTED_COLOR.test(computed.backgroundImage)) {
      target.style.backgroundImage = "none";
    }
    target.style.boxShadow = "none";
    target.style.textShadow = "none";
  }

  return { snapshot: clone, cleanup: () => wrapper.remove() };
}

export type PdfExportOptions = {
  /** jsPDF page format — "a4" (default) or a custom [widthMm, heightMm] for thermal receipts. */
  format?: string | number[];
  /** Page orientation. Defaults to portrait to preserve existing document exports. */
  orientation?: "portrait" | "landscape";
  /** page margin in mm (number or [top,right,bottom,left]). Default 8. */
  margin?: number | number[];
  /** html2canvas sampling scale. Use 3.125 for roughly 300 DPI from CSS's 96 DPI baseline. */
  scale?: number;
  /** html2pdf page-break modes. Use ["css", "legacy"] for tables that may continue to another page. */
  pagebreakMode?: string[];
};

/** Mobile / touch-only browsers where html2canvas rasterisation yields a blank page. */
function isMobilePdf(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  if (iPadOS || /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  try {
    if (window.matchMedia?.("(pointer: coarse)")?.matches && !window.matchMedia?.("(any-pointer: fine)")?.matches) return true;
  } catch {
    /* matchMedia may be unavailable */
  }
  return false;
}

/**
 * Mobile-safe path: instead of rasterising the node (which comes out blank on
 * mobile Safari), open a print window that carries the element AND the page's
 * stylesheets, then let the browser print real, vector-sharp content that the
 * user saves as PDF. The page's own CSS renders it exactly as on screen (and the
 * print engine handles modern colours that html2canvas cannot).
 */
function openElementPrintWindow(element: HTMLElement, options?: PdfExportOptions) {
  const popup = window.open("", "_blank", "width=1024,height=800");
  if (!popup) throw new Error("تعذّر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى.");
  const orientation = options?.orientation ?? "portrait";
  const size = Array.isArray(options?.format) ? `${options.format[0]}mm ${options.format[1]}mm` : `A4 ${orientation}`;
  const margin = Array.isArray(options?.margin) ? `${options.margin.join("mm ")}mm` : `${options?.margin ?? 8}mm`;
  const headStyles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map((node) => node.outerHTML).join("");
  const dir = element.getAttribute("dir") || document.documentElement.getAttribute("dir") || "rtl";
  // Neutralise any off-screen positioning the source node carried, so the printed
  // document is on the page (not blank), and centre it.
  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.position = "static";
  clone.style.left = "auto";
  clone.style.right = "auto";
  clone.style.top = "auto";
  clone.style.transform = "none";
  clone.style.margin = "0 auto";
  clone.style.pointerEvents = "auto";
  clone.style.zIndex = "auto";
  const autoPrint = `<script>(function(){function go(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},150);}var imgs=document.images;if(!imgs.length){window.onload=go;return;}var left=imgs.length;function one(){if(--left<=0)go();}window.onload=function(){for(var i=0;i<imgs.length;i++){var im=imgs[i];if(im.complete)one();else{im.onload=one;im.onerror=one;}}};})();<\/script>`;
  popup.document.open();
  popup.document.write(`<!doctype html><html dir="${dir}" lang="ar"><head><meta charset="utf-8"><meta name="color-scheme" content="light">${headStyles}<style>@page{size:${size};margin:${margin};}html,body{margin:0;padding:0;background:#fff;color-scheme:light;}:root{color-scheme:light !important;}</style></head><body>${clone.outerHTML}${autoPrint}</body></html>`);
  popup.document.close();
}

export async function downloadElementPdf(
  element: HTMLElement | null,
  filename: string,
  options?: PdfExportOptions,
) {
  if (!element || typeof window === "undefined") {
    throw new Error("العنصر غير جاهز للتصدير");
  }

  // On mobile the html2canvas rasteriser returns a blank canvas; use the native
  // print-to-PDF path instead so the saved file always contains the document.
  if (isMobilePdf()) {
    openElementPrintWindow(element, options);
    return;
  }

  await waitForPdfAssets(element);

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
        // PNG is lossless: JPEG's DCT/chroma subsampling softens Arabic text and
        // thin table rules, making the exported PDF look blurry. PNG keeps edges
        // crisp; documents are line-art + text, so it also compresses well.
        image: { type: "png" },
        html2canvas: {
          // Render at a higher pixel density so rasterised text stays sharp when
          // the bitmap is placed on the PDF page. Callers may still pass a lower
          // scale for very long reports to stay within canvas/memory limits.
          scale: options?.scale ?? Math.min(3, Math.max(2.5, window.devicePixelRatio || 1.5)),
          useCORS: true,
          // A tainted canvas cannot be saved as a PDF. Cross-origin images are
          // loaded only when they expose CORS headers, preserving the rest of
          // the invoice instead of making the whole download fail.
          allowTaint: false,
          backgroundColor: "#ffffff",
          imageTimeout: 20_000,
          onclone: preparePdfClone,
        },
        jsPDF: { unit: "mm", format: options?.format ?? "a4", orientation: options?.orientation ?? "portrait" },
        pagebreak: { mode: options?.pagebreakMode ?? ["avoid-all", "css", "legacy"] },
      })
      .from(snapshot)
      .save();
  } finally {
    cleanup();
  }
}
