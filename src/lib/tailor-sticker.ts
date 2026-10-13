/**
 * Graduation student stickers (50×30 mm) printed on the 80 mm receipt roll.
 * No @page size: the driver's paper defines the page (Chromium centres a
 * smaller CSS page on it), so stickers run from the top, centred in the
 * ~72 mm printable width, and a sticker never splits across two pages.
 */
export type StickerItem = { name: string; studentCode: string; groupName: string; size: string; qr: string };

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function stickerSize(measurements: Record<string, unknown> | null | undefined) {
  const m = measurements ?? {};
  return String(m.standardSize || m.readySize || m.customSize || m.suggestedSize || "—");
}

export async function stickerQr(qrToken: string | null | undefined, origin = window.location.origin) {
  if (!qrToken) return "";
  try {
    const QR: any = await import("qrcode");
    return await QR.toDataURL(`${origin}/graduation/track/${qrToken}`, { margin: 1, width: 240 });
  } catch {
    return "";
  }
}

const stickerBody = (item: StickerItem) => `<div class="lbl">${item.qr ? `<img src="${item.qr}" alt=""/>` : ""}
  <div class="t"><b>${esc(item.name)}</b><span class="code">${esc(item.studentCode)}</span><span class="grp">${esc(item.groupName)}</span>
  <span class="sz">المقاس: ${esc(item.size)}</span></div></div>`;

export function stickerDocument(items: StickerItem[], title = "ملصق") {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{margin:0}
  html,body{background:#fff}
  .lbl{width:50mm;height:30mm;margin:0 auto 2.5mm;padding:1.5mm;display:flex;align-items:center;gap:1.8mm;overflow:hidden;border:0.3mm solid #000;border-radius:1.5mm;break-inside:avoid;page-break-inside:avoid}
  .lbl:last-child{margin-bottom:0}
  .lbl img{width:21mm;height:21mm;flex:none;image-rendering:pixelated}
  .t{flex:1;min-width:0;line-height:1.25}
  .t b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:10.5px;font-weight:800}
  .t .code{display:block;direction:ltr;text-align:right;font-size:7.5px;font-weight:600;margin-top:.6mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .t .grp{display:block;font-size:8px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .t .sz{display:inline-block;margin-top:.8mm;font-size:10px;font-weight:800;border:0.3mm solid #000;border-radius:1mm;padding:0 1.2mm}
  @media screen{body{padding:12px;background:#eee}.lbl{background:#fff}}</style></head><body>
  ${items.map(stickerBody).join("\n")}
  </body></html>`;
}
