/**
 * «صورة واتساب»: turns a branded A5 receipt (src/lib/branded-receipt.ts) into a
 * PNG the staff can send to the customer. Read-only — it renders the same HTML
 * the print preview shows and changes nothing.
 */

const RECEIPT_FONT = "AJN Cairo";

async function ensureReceiptFont() {
  if (typeof document === "undefined" || !document.fonts) return;
  const loaded = Array.from(document.fonts as unknown as Iterable<FontFace>).some(
    (face) => face.family.replace(/["']/g, "") === RECEIPT_FONT && face.status === "loaded",
  );
  if (loaded) return;
  const face = new FontFace(RECEIPT_FONT, 'url("/fonts/Cairo-Variable.ttf") format("truetype")', { weight: "200 1000" });
  document.fonts.add(face);
  try {
    await face.load();
  } catch {
    throw new Error("تعذر تحميل خط الوصل؛ تأكد من الاتصال وأعد المحاولة");
  }
}

async function waitForImages(root: HTMLElement) {
  await Promise.all(
    Array.from(root.querySelectorAll("img")).map((image) =>
      image.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const done = () => resolve();
            image.addEventListener("load", done, { once: true });
            image.addEventListener("error", done, { once: true });
            setTimeout(done, 6000);
          }),
    ),
  );
}

/** Renders the receipt root of a branded document into a PNG at ~240 dpi. */
export async function receiptHtmlToPng(html: string): Promise<Blob> {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const source = parsed.querySelector<HTMLElement>(".ajn-r--a5");
  if (!source) throw new Error("هذا المستند لا يدعم الحفظ كصورة");
  await ensureReceiptFont();
  const element = document.importNode(source, true) as HTMLElement;

  // Let the logo and pictures load before the capture.
  const staging = document.createElement("div");
  staging.setAttribute("aria-hidden", "true");
  staging.style.cssText = "position:fixed;left:-10000px;top:0;width:148mm;opacity:0;pointer-events:none";
  staging.appendChild(element.cloneNode(true));
  document.body.appendChild(staging);
  try {
    await waitForImages(staging);
  } finally {
    staging.remove();
  }

  const mod: any = await import("html2pdf.js");
  const factory = (mod?.default ?? mod) as () => any;
  if (typeof factory !== "function") throw new Error("مكتبة الصور غير جاهزة");
  const canvas: HTMLCanvasElement = await factory()
    .set({
      margin: 0,
      jsPDF: { unit: "mm", format: [148, 210], orientation: "portrait" },
      html2canvas: { scale: 2.5, useCORS: true, backgroundColor: "#ffffff", logging: false },
    })
    .from(element)
    .toCanvas()
    .get("canvas");
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("تعذر إنشاء صورة الوصل"))), "image/png");
    } catch {
      reject(new Error("تعذر إنشاء صورة الوصل بسبب صورة خارجية؛ أعد المحاولة بدون الشعار أو راجع الشعار"));
    }
  });
}

const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 90) || "وصل";

/**
 * Phones share the PNG straight to WhatsApp (system share sheet); computers
 * download it. Returns what happened so the dialog can say so.
 */
export async function shareReceiptImage(html: string, name: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await receiptHtmlToPng(html);
  const fileName = `${safeFileName(name)}.png`;
  const file = new File([blob], fileName, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  if (coarse && nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return "shared";
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return "cancelled";
      // NotAllowedError (the tap expired while rendering) falls through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}
