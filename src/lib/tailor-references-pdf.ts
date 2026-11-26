/**
 * «صور وملاحظات الطلبة للتجهيز» — one PDF for a whole graduation group (or the
 * selected students): each student's name, the name printed on the sash, the
 * sash type/font/colours, and every photo + note the student sent for the cap
 * and sash.
 *
 * The document is built as plain HTML blocks (pure, testable). In the browser
 * each block is rasterised on its own — small canvases that phones can handle —
 * and the blocks are laid out on A4 pages with pdf-lib, so a real PDF file is
 * downloaded. If the browser returns blank rasters (a known html2canvas failure
 * on some phones) the same blocks go to the print dialog instead.
 */
import { STUDENT_REFERENCE_PLACEMENTS } from "@/lib/graduation-student-flow";

export type PrepReference = { placement: string; note: string; imageUrl?: string };
export type PrepSash = { name: string; type: string; font: string; color: string; embroideryColor: string };
/**
 * The tailor's measurements, in the portal's order, with short labels so the
 * whole set fits on one line of the student card. Lengths in cm, weight in kg.
 */
export const PREP_MEASUREMENTS = [
  { key: "robeLength", label: "روب" },
  { key: "sashLength", label: "وشاح" },
  { key: "sleeveLength", label: "ردن" },
  { key: "americanSashBack", label: "خلف أمريكي" },
  { key: "shoulder", label: "كتف" },
  { key: "capSize", label: "قبعة" },
  { key: "height", label: "الطول" },
  { key: "weight", label: "الوزن", unit: "كغم" },
] as const;
export type PrepMeasurementKey = (typeof PREP_MEASUREMENTS)[number]["key"];
export type PrepStudent = {
  name: string;
  studentCode: string;
  phones: string[];
  size: string;
  /** Saved values only; a missing measurement is left out of the strip. */
  measurements: Partial<Record<PrepMeasurementKey, string>>;
  sash: PrepSash;
  references: PrepReference[];
};
export type PrepDocument = {
  /** Group (or list) title, e.g. «هندسة مدني 2026». */
  title: string;
  /** University · college · department · group number. */
  details: string;
  logo?: string;
  students: PrepStudent[];
  generatedAt?: Date;
  fontFamily?: string;
};

/** Content width of an A4 page with 10 mm margins (190 mm at 96 dpi). */
export const PREP_BLOCK_WIDTH_PX = 718;
const NAMES_PER_BLOCK = 22;
const ACCENT = "#7b1e3a";
const INK = "#1d1a1b";
const MUTED = "#5f5a5c";
const LINE = "#ddd6d8";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const safeImageUrl = (value: unknown) => (typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : "");
const placementLabel = (key: string) => STUDENT_REFERENCE_PLACEMENTS.find((item) => item.key === key)?.label ?? "موضع آخر";
const dateFormat = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });

function colorValue(value: string) {
  if (!value) return "";
  const hex = /^#[0-9a-f]{3,8}$/i.test(value);
  const chip = hex
    ? `<span style="display:inline-block;width:11px;height:11px;border:1px solid #9a9a9a;border-radius:3px;background:${value};vertical-align:middle;margin-inline-end:4px"></span>`
    : "";
  return `${chip}<bdi dir="ltr">${escapeHtml(value)}</bdi>`;
}

function shell(fontFamily: string, inner: string) {
  return `<div dir="rtl" style="box-sizing:border-box;width:100%;background:#fff;color:${INK};font-family:${escapeHtml(fontFamily)};line-height:1.6">${inner}</div>`;
}

function headerBlock(doc: PrepDocument, font: string) {
  const withRefs = doc.students.filter((student) => student.references.length).length;
  const logo = safeImageUrl(doc.logo) || (doc.logo?.startsWith("/") ? doc.logo : "");
  return shell(
    font,
    `<div style="display:flex;align-items:center;gap:12px;border-bottom:2px solid ${ACCENT};padding-bottom:10px">
      ${logo ? `<img data-prep-logo src="${escapeHtml(logo)}" alt="" crossorigin="anonymous" style="height:46px;width:auto;max-width:120px" />` : ""}
      <div style="flex:1;min-width:0">
        <div style="font-size:20px;font-weight:800">صور وملاحظات الطلبة للتجهيز</div>
        <div style="font-size:13px;font-weight:700;margin-top:2px">${escapeHtml(doc.title)}</div>
        ${doc.details ? `<div style="font-size:11px;color:${MUTED}">${escapeHtml(doc.details)}</div>` : ""}
      </div>
      <div style="font-size:11px;color:${MUTED};text-align:left;white-space:nowrap">
        ${escapeHtml(dateFormat.format(doc.generatedAt ?? new Date()))}<br />
        ${doc.students.length} طالب · ${withRefs} أرسلوا صوراً أو ملاحظات
      </div>
    </div>`,
  );
}

/** The student's saved numbers, each kept left-to-right; empty when none is saved. */
const phoneLines = (phones: string[], separator: string) =>
  phones.length ? phones.map((phone) => `<bdi dir="ltr">${escapeHtml(phone)}</bdi>`).join(separator) : "";

/** «الاسم على الوشاح» for every student, in chunks that fit a page. */
function nameBlocks(doc: PrepDocument, font: string) {
  const blocks: string[] = [];
  for (let start = 0; start < doc.students.length; start += NAMES_PER_BLOCK) {
    const rows = doc.students.slice(start, start + NAMES_PER_BLOCK).map((student, offset) => {
      const index = start + offset + 1;
      return `<tr>
        <td style="border:1px solid ${LINE};padding:4px 6px;text-align:center;color:${MUTED}">${index}</td>
        <td style="border:1px solid ${LINE};padding:4px 6px;font-weight:700">${escapeHtml(student.name)}</td>
        <td style="border:1px solid ${LINE};padding:4px 6px;text-align:center;color:${MUTED}"><bdi dir="ltr">${escapeHtml(student.studentCode)}</bdi></td>
        <td style="border:1px solid ${LINE};padding:4px 6px;text-align:center;white-space:nowrap">${phoneLines(student.phones, "<br>") || "—"}</td>
        <td style="border:1px solid ${LINE};padding:4px 6px;font-weight:800;color:${ACCENT}">${student.sash.name ? escapeHtml(student.sash.name) : `<span style="color:#b00020;font-weight:700">غير محدد</span>`}</td>
        <td style="border:1px solid ${LINE};padding:4px 6px;text-align:center">${escapeHtml(student.size || "—")}</td>
        <td style="border:1px solid ${LINE};padding:4px 6px;text-align:center">${student.references.length || "—"}</td>
      </tr>`;
    });
    blocks.push(
      shell(
        font,
        `${start === 0 ? `<div style="font-size:14px;font-weight:800;margin:2px 0 6px">قائمة الأسماء على الوشاح</div>` : ""}
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f6eff1">
            <th style="border:1px solid ${LINE};padding:5px 6px;width:34px">#</th>
            <th style="border:1px solid ${LINE};padding:5px 6px;text-align:right">الطالب</th>
            <th style="border:1px solid ${LINE};padding:5px 6px;width:84px">رمز الطالب</th>
            <th style="border:1px solid ${LINE};padding:5px 6px;width:98px;white-space:nowrap">رقم الموبايل</th>
            <th style="border:1px solid ${LINE};padding:5px 6px;text-align:right">الاسم على الوشاح</th>
            <th style="border:1px solid ${LINE};padding:5px 6px;width:54px">المقاس</th>
            <th style="border:1px solid ${LINE};padding:5px 6px;width:88px;white-space:nowrap">صور/ملاحظات</th>
          </tr></thead>
          <tbody>${rows.join("")}</tbody>
        </table>`,
      ),
    );
  }
  return blocks;
}

function referenceCell(reference: PrepReference) {
  const imageUrl = safeImageUrl(reference.imageUrl);
  return `<div style="box-sizing:border-box;width:calc(50% - 5px);border:1px solid ${LINE};border-radius:8px;padding:8px">
    <div style="font-size:13px;font-weight:800;color:${ACCENT}">${escapeHtml(placementLabel(reference.placement))}</div>
    ${imageUrl
      ? `<div data-prep-frame style="margin-top:6px;text-align:center;background:#f5f3f4;border-radius:6px;padding:4px"><img data-prep-image src="${escapeHtml(imageUrl)}" alt="${escapeHtml(placementLabel(reference.placement))}" crossorigin="anonymous" style="display:inline-block;max-width:100%;max-height:230px;width:auto;height:auto;border-radius:4px" /></div>`
      : ""}
    ${reference.note
      ? `<div style="margin-top:6px;font-size:13px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(reference.note)}</div>`
      : imageUrl ? "" : `<div style="margin-top:6px;font-size:12px;color:${MUTED}">بدون صورة أو ملاحظة</div>`}
  </div>`;
}

/** One compact row of cells: «القياسات (سم)» then each saved measurement. */
function measurementStrip(student: PrepStudent) {
  // Hugs its content on one line; only an unusually long value wraps inside its own cell.
  const cell = `border:1px solid ${LINE};padding:3px 6px`;
  const cells = PREP_MEASUREMENTS.flatMap((item) => {
    const value = String(student.measurements?.[item.key] ?? "").trim();
    if (!value) return [];
    const unit = "unit" in item ? ` <span style="color:${MUTED};white-space:nowrap">${item.unit}</span>` : "";
    return [`<td style="${cell}"><span style="color:${MUTED};white-space:nowrap">${item.label}</span> <b style="white-space:nowrap"><bdi dir="ltr">${escapeHtml(value)}</bdi></b>${unit}</td>`];
  });
  const head = `<th style="${cell};white-space:nowrap;background:#f6eff1;color:${ACCENT};font-weight:800">القياسات (سم)</th>`;
  const body = cells.length ? cells.join("") : `<td style="${cell};color:${MUTED}">لم تُسجل بعد</td>`;
  return `<table data-prep-measurements style="margin-top:6px;max-width:100%;border-collapse:collapse;font-size:11.5px;font-variant-numeric:tabular-nums"><tr>${head}${body}</tr></table>`;
}

function studentBlock(student: PrepStudent, index: number, font: string) {
  const facts = [
    student.sash.type ? `نوع الوشاح: <b>${escapeHtml(student.sash.type)}</b>` : "",
    student.sash.font ? `الخط: <b>${escapeHtml(student.sash.font)}</b>` : "",
    student.sash.color ? `لون الوشاح: ${colorValue(student.sash.color)}` : "",
    student.sash.embroideryColor ? `لون التطريز: ${colorValue(student.sash.embroideryColor)}` : "",
  ].filter(Boolean);
  return shell(
    font,
    `<div style="border:1px solid ${LINE};border-radius:10px;padding:12px 14px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="flex:none;color:${ACCENT};font-weight:800;font-size:17px">${index}.</span>
        <span style="font-size:17px;font-weight:800;min-width:0">${escapeHtml(student.name)}</span>
        <span style="margin-inline-start:auto;font-size:12px;color:${MUTED};white-space:nowrap"><bdi dir="ltr">${escapeHtml(student.studentCode)}</bdi>${student.size ? ` · مقاس ${escapeHtml(student.size)}` : ""}</span>
      </div>
      <div style="margin-top:4px;font-size:13px;color:#333">رقم الموبايل: ${student.phones.length ? `<b>${phoneLines(student.phones, " · ")}</b>` : `<span style="color:${MUTED}">غير مسجل</span>`}</div>
      ${measurementStrip(student)}
      <div style="margin-top:10px;border:1.5px solid ${ACCENT};border-radius:8px;padding:6px 12px 12px;background:#fbf5f7">
        <div style="font-size:11px;font-weight:800;color:${ACCENT}">الاسم على الوشاح</div>
        ${student.sash.name
          ? `<div style="font-size:24px;font-weight:800;color:#3d0f1d;line-height:1.5">${escapeHtml(student.sash.name)}</div>`
          : `<div style="font-size:14px;font-weight:700;color:#b00020">لم يُحدد الاسم على الوشاح — راجع الإدارة</div>`}
      </div>
      ${facts.length ? `<div style="margin-top:6px;font-size:12px;color:#333;display:flex;flex-wrap:wrap;gap:2px 16px">${facts.map((fact) => `<span>${fact}</span>`).join("")}</div>` : ""}
      ${student.references.length
        ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:10px">${student.references.map(referenceCell).join("")}</div>`
        : `<div style="margin-top:10px;padding:8px 10px;border:1px dashed #b9b2b4;border-radius:8px;color:${MUTED};font-size:12px">لم يرسل الطالب صوراً أو ملاحظات للتجهيز.</div>`}
    </div>`,
  );
}

/** Every block of the document, in order: header, name list chunks, one card per student. */
export function preparationBlocks(doc: PrepDocument): string[] {
  const font = doc.fontFamily || "Cairo, Tahoma, Arial, sans-serif";
  return [headerBlock(doc, font), ...nameBlocks(doc, font), ...doc.students.map((student, index) => studentBlock(student, index + 1, font))];
}

/** The same blocks as one printable A4 document (the fallback path). */
export function preparationPrintHtml(doc: PrepDocument): string {
  const blocks = preparationBlocks(doc)
    .map((block) => `<div style="break-inside:avoid;page-break-inside:avoid;margin:0 0 10px">${block}</div>`)
    .join("");
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(`صور التجهيز — ${doc.title}`)}</title>
    <style>@page{size:A4;margin:10mm}html,body{margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>
    </head><body><div style="width:${PREP_BLOCK_WIDTH_PX}px;margin:0 auto">${blocks}</div></body></html>`;
}

// ─── Browser: rasterise blocks and lay them out on A4 pages ─────────────────

type Html2PdfWorker = {
  set: (options: Record<string, unknown>) => Html2PdfWorker;
  from: (element: HTMLElement) => Html2PdfWorker;
  toCanvas: () => Html2PdfWorker;
  get: (key: string) => Promise<HTMLCanvasElement>;
};

class BlankRasterError extends Error {}

function waitForImage(image: HTMLImageElement, timeoutMs: number) {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve(true);
  if (image.complete) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => resolve(false), timeoutMs);
    image.addEventListener("load", () => { window.clearTimeout(timer); resolve(true); }, { once: true });
    image.addEventListener("error", () => { window.clearTimeout(timer); resolve(false); }, { once: true });
  });
}

/** A rasterised block always has dark text; an all-white canvas means the browser failed. */
function looksBlank(canvas: HTMLCanvasElement) {
  if (!canvas.width || !canvas.height) return true;
  const probe = document.createElement("canvas");
  probe.width = 64;
  probe.height = Math.max(1, Math.round((canvas.height / canvas.width) * 64));
  const context = probe.getContext("2d");
  if (!context) return false;
  context.drawImage(canvas, 0, 0, probe.width, probe.height);
  const { data } = context.getImageData(0, 0, probe.width, probe.height);
  for (let index = 0; index < data.length; index += 4) if (data[index] + data[index + 1] + data[index + 2] < 540) return false;
  return true;
}

function canvasJpeg(canvas: HTMLCanvasElement) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then(resolve, reject) : reject(new Error("تعذر تجهيز صفحة من الملف"))), "image/jpeg", 0.86);
  });
}

function saveBlob(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Builds and downloads the PDF. Resolves "pdf" when a file was saved, "print"
 * when the browser could not rasterise and the print dialog was opened instead.
 */
export async function downloadPreparationPdf(
  doc: PrepDocument,
  filename: string,
  onProgress?: (done: number, total: number) => void,
): Promise<"pdf" | "print"> {
  if (typeof window === "undefined") throw new Error("تنزيل الملف متاح من المتصفح فقط");
  if (!doc.students.length) throw new Error("لا يوجد طلاب في هذا الملف");
  const fontFamily = doc.fontFamily || getComputedStyle(document.body).fontFamily || "Cairo, Tahoma, sans-serif";
  const full: PrepDocument = { ...doc, fontFamily };
  const blocks = preparationBlocks(full);

  const staging = document.createElement("div");
  staging.setAttribute("aria-hidden", "true");
  staging.style.cssText = `position:fixed;left:-20000px;top:0;width:${PREP_BLOCK_WIDTH_PX}px;pointer-events:none;background:#fff;`;
  for (const html of blocks) {
    const block = document.createElement("div");
    block.innerHTML = html;
    staging.appendChild(block);
  }
  document.body.appendChild(staging);

  try {
    // Photos that cannot be loaded are named in the file instead of leaving an empty frame.
    const images = Array.from(staging.querySelectorAll<HTMLImageElement>("img"));
    const loaded = await Promise.all(images.map((image) => waitForImage(image, 25_000)));
    images.forEach((image, index) => {
      if (loaded[index]) return;
      if (image.hasAttribute("data-prep-logo")) { image.remove(); return; }
      const frame = image.closest<HTMLElement>("[data-prep-frame]");
      const notice = document.createElement("div");
      notice.textContent = "تعذر تحميل الصورة هنا — افتحها من صفحة الطالب في بوابة الخياطين";
      notice.style.cssText = "padding:18px 8px;font-size:12px;color:#b00020;text-align:center";
      if (frame) frame.replaceChildren(notice);
      else image.replaceWith(notice);
    });
    await (document.fonts?.ready?.catch(() => undefined) ?? Promise.resolve());
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const [{ PDFDocument, StandardFonts, rgb }, html2pdfModule, { preparePdfClone }] = await Promise.all([
      import("pdf-lib"),
      import("html2pdf.js"),
      import("@/lib/pdf"),
    ]);
    const factory = ((html2pdfModule as any).default ?? html2pdfModule) as () => Html2PdfWorker;
    if (typeof factory !== "function") throw new Error("مكتبة PDF غير جاهزة؛ أعد المحاولة");

    const pdf = await PDFDocument.create();
    pdf.setTitle(`صور وملاحظات الطلبة للتجهيز — ${doc.title}`);
    pdf.setCreator("AJN");
    const pageSize: [number, number] = [595.28, 841.89];
    const margin = 28.35;
    const footer = 16;
    const gap = 9;
    const contentWidth = pageSize[0] - margin * 2;
    const contentHeight = pageSize[1] - margin * 2 - footer;
    let page = pdf.addPage(pageSize);
    let y = pageSize[1] - margin;
    let placed = 0;

    const elements = Array.from(staging.children) as HTMLElement[];
    for (const [index, element] of elements.entries()) {
      const canvas = await factory()
        .set({
          margin: 0,
          jsPDF: { unit: "mm", format: [190, 297], orientation: "portrait" },
          html2canvas: { scale: 2, useCORS: true, allowTaint: false, backgroundColor: "#ffffff", logging: false, imageTimeout: 25_000, onclone: preparePdfClone },
        })
        .from(element)
        .toCanvas()
        .get("canvas");
      if (looksBlank(canvas)) throw new BlankRasterError("blank");
      const image = await pdf.embedJpg(await canvasJpeg(canvas));
      let width = contentWidth;
      let height = (canvas.height / canvas.width) * contentWidth;
      if (height > contentHeight) {
        width *= contentHeight / height;
        height = contentHeight;
      }
      if (placed > 0 && y - height < margin + footer) {
        page = pdf.addPage(pageSize);
        y = pageSize[1] - margin;
      }
      page.drawImage(image, { x: margin + (contentWidth - width) / 2, y: y - height, width, height });
      y -= height + gap;
      placed += 1;
      canvas.width = 0;
      canvas.height = 0;
      onProgress?.(index + 1, elements.length);
    }

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = pdf.getPages();
    pages.forEach((item, index) => {
      const label = `${index + 1} / ${pages.length}`;
      item.drawText(label, { x: pageSize[0] / 2 - font.widthOfTextAtSize(label, 8) / 2, y: margin / 2, size: 8, font, color: rgb(0.45, 0.45, 0.45) });
    });
    saveBlob(await pdf.save(), filename);
    return "pdf";
  } catch (error) {
    if (!(error instanceof BlankRasterError)) throw error;
    const { printStandaloneDocument } = await import("@/lib/pdf");
    printStandaloneDocument(preparationPrintHtml(full), 794);
    return "print";
  } finally {
    staging.remove();
  }
}
