/**
 * File-format ingest and export for the document scanner.
 *
 * Every conversion runs in the browser: a PDF or HEIC the user picks is
 * rasterised locally and never uploaded for processing. All heavy libraries are
 * imported lazily so they stay out of the initial bundle.
 */

export const ACCEPTED_INPUT_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf",
];

/** Browser accept attribute, including extensions for HEIC which many OSes mislabel. */
export const ACCEPT_ATTRIBUTE = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/*,application/pdf";

export type IngestedPage = {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  /** Where this page came from, for the UI to explain what happened. */
  source: "image" | "pdf" | "heic";
  pageNumber?: number;
};

function isHeic(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("تعذر قراءة الملف"));
    reader.readAsDataURL(blob);
  });
}

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("تعذر قراءة الصورة"));
    img.src = dataUrl;
  });
}

/**
 * Converts any accepted file into one or more page images.
 *
 * A PDF yields one page per sheet, rendered at `pdfScale` (2.0 ≈ 144 DPI for a
 * standard A4 page, enough for legible re-scanning without exhausting memory on
 * a phone). HEIC is transcoded to JPEG because no browser but Safari decodes it.
 */
export async function ingestFile(
  file: File,
  options: { pdfScale?: number; maxPdfPages?: number } = {},
): Promise<IngestedPage[]> {
  const pdfScale = options.pdfScale ?? 2.0;
  const maxPdfPages = options.maxPdfPages ?? 30;

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return ingestPdf(file, pdfScale, maxPdfPages);
  }

  if (isHeic(file)) {
    const heic2any = (await import("heic2any")).default as any;
    const converted = (await heic2any({ blob: file, toType: "image/jpeg", quality: 0.95 })) as Blob | Blob[];
    const blob = Array.isArray(converted) ? converted[0] : converted;
    const dataUrl = await readAsDataUrl(blob);
    const { w, h } = await imageSize(dataUrl);
    return [{ dataUrl, widthPx: w, heightPx: h, source: "heic" }];
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("صيغة غير مدعومة — استخدم JPG أو PNG أو WEBP أو HEIC أو PDF");
  }

  const dataUrl = await readAsDataUrl(file);
  const { w, h } = await imageSize(dataUrl);
  return [{ dataUrl, widthPx: w, heightPx: h, source: "image" }];
}

/** Rasterises each PDF page to a JPEG data URL. */
async function ingestPdf(file: File, scale: number, maxPages: number): Promise<IngestedPage[]> {
  const pdfjs: any = await import("pdfjs-dist");
  // pdf.js needs its worker; point it at the bundled copy rather than a CDN so
  // the module keeps working offline.
  if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url" as any).catch(() => null);
    if (worker?.default) pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const total = Math.min(doc.numPages, maxPages);
  const pages: IngestedPage[] = [];

  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("تعذر تجهيز مساحة الرسم");
    // PDFs may be transparent; a white base keeps scans looking like paper.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    pages.push({
      dataUrl: canvas.toDataURL("image/jpeg", 0.92),
      widthPx: canvas.width,
      heightPx: canvas.height,
      source: "pdf",
      pageNumber: n,
    });
  }
  await doc.destroy?.();
  return pages;
}

// ─── Export ─────────────────────────────────────────────────────────────────

/**
 * Builds a multi-page PDF at true physical size. Each page is sized in points
 * from its millimetre dimensions, so printing at 100% reproduces the original.
 */
export async function buildPdf(
  pages: Array<{ dataUrl: string; widthMm?: number | null; heightMm?: number | null }>,
  title = "document",
): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);

  const MM_TO_PT = 72 / 25.4;
  for (const page of pages) {
    const bytes = dataUrlToBytes(page.dataUrl);
    if (!bytes) continue;
    const isPng = page.dataUrl.startsWith("data:image/png");
    const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    // Fall back to the image's own aspect at A4 width when mm are unknown.
    const wPt = page.widthMm ? page.widthMm * MM_TO_PT : 210 * MM_TO_PT;
    const hPt = page.heightMm
      ? page.heightMm * MM_TO_PT
      : (image.height / image.width) * wPt;
    const sheet = pdf.addPage([wPt, hPt]);
    sheet.drawImage(image, { x: 0, y: 0, width: wPt, height: hPt });
  }
  const out = await pdf.save();
  return new Blob([out as unknown as BlobPart], { type: "application/pdf" });
}

/** Splits a PDF into one single-page PDF per sheet. */
export async function splitPdf(file: File): Promise<Array<{ name: string; blob: Blob }>> {
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(await file.arrayBuffer());
  const base = file.name.replace(/\.pdf$/i, "");
  const out: Array<{ name: string; blob: Blob }> = [];
  for (let i = 0; i < source.getPageCount(); i++) {
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(source, [i]);
    single.addPage(copied);
    const bytes = await single.save();
    out.push({
      name: `${base}-${i + 1}.pdf`,
      blob: new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
    });
  }
  return out;
}

/** Merges several PDFs into one, preserving page order. */
export async function mergePdfs(files: File[]): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
  for (const file of files) {
    const doc = await PDFDocument.load(await file.arrayBuffer());
    const copied = await merged.copyPages(doc, doc.getPageIndices());
    copied.forEach((page) => merged.addPage(page));
  }
  const bytes = await merged.save();
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}

/** Bundles files into a ZIP archive. */
export async function buildZip(
  entries: Array<{ name: string; blob: Blob }>,
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const entry of entries) zip.file(entry.name, entry.blob);
  return zip.generateAsync({ type: "blob" });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const match = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
