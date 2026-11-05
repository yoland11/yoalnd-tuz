import type { EquipmentRentalDetail, EquipmentRentalDispatch, EquipmentRentalReturn } from "@/lib/equipment-rentals";
import { EQUIPMENT_RENTAL_STATUS_LABELS } from "@/lib/equipment-rentals";
import { thermalReceiptCss } from "./print-helpers";

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const cash = (value: unknown) => `${Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} د.ع`;
const movementReceiptCss = `
  @page{size:A4;margin:14mm}*{box-sizing:border-box}
  body{font:12px/1.6 Cairo,Tahoma,Arial,sans-serif;color:#21191c;max-width:180mm;margin:auto}
  header{border-bottom:2px solid #70032c;padding-bottom:12px;text-align:center}h1{font-size:24px;color:#70032c;margin:4px 0}
  table{width:100%;border-collapse:collapse;margin:16px 0}thead{display:table-header-group}
  th,td{padding:7px 5px;border-bottom:1px solid #eadde1;text-align:start;overflow-wrap:anywhere;vertical-align:top}
  th{background:#fbf5f7}tr{break-inside:avoid}small{display:block;color:#666}bdi{unicode-bidi:isolate}
  .note{white-space:pre-wrap;overflow-wrap:anywhere}.signatures{display:flex;justify-content:space-between;gap:24px;break-inside:avoid;margin-top:28px}
`;

export function equipmentRentalDispatchPrintHtml(
  rental: Pick<EquipmentRentalDetail, "orderNo" | "customerName">,
  record: EquipmentRentalDispatch,
  company: { site_name?: string },
) {
  const date = new Date(record.dispatchedAt).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad" });
  const rows = record.lines.map(line => `<tr>
    <td><b>${esc(line.name)}</b><small><bdi>${esc(line.code)}</bdi></small></td>
    <td>${esc(line.employeeName)}</td>
    <td>${line.warehouses.map(source => `<div>${esc(source.name)} × <bdi>${esc(source.quantity)}</bdi></div>`).join("")}</td>
    <td><bdi>${esc(line.quantity)}</bdi></td><td><bdi>${esc(line.remaining)}</bdi></td>
  </tr>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
    <title>سند تسليم معدات · ${esc(rental.orderNo)}</title><style>${movementReceiptCss}</style></head><body><main>
    <header><b>${esc(company.site_name || "AJN")}</b><h1>سند تسليم معدات</h1><bdi>${esc(rental.orderNo)}</bdi></header>
    <p>العميل: <b>${esc(rental.customerName)}</b> · وقت التسليم: <bdi>${esc(date)}</bdi></p>
    <p>سجّله: ${esc(record.actorName)} · مرجع العملية: <small><bdi>${esc(record.requestId)}</bdi></small></p>
    <table><thead><tr><th>المعدة</th><th>مسؤول التسليم</th><th>مخزن المصدر</th><th>المُسلّم</th><th>باقي التسليم</th></tr></thead><tbody>${rows}</tbody></table>
    ${record.note ? `<p class="note">الملاحظات: ${esc(record.note)}</p>` : ""}
    <div class="signatures"><p>توقيع العميل __________________</p><p>توقيع مسؤول التسليم __________________</p></div></main></body></html>`;
}

export function equipmentRentalReturnPrintHtml(
  rental: Pick<EquipmentRentalDetail, "orderNo" | "customerName">,
  record: EquipmentRentalReturn,
  company: { site_name?: string },
) {
  const date = new Date(record.returnedAt).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad" });
  const rows = record.lines.map(line => `<tr>
    <td><b>${esc(line.name)}</b><small><bdi>${esc(line.code)}</bdi></small>${line.note && line.note !== record.note ? `<small class="note">${esc(line.note)}</small>` : ""}</td>
    <td>${esc(line.receivingEmployeeName)}<small>${esc(line.warehouseName || "—")}</small></td>
    ${[line.good, line.damaged, line.missing, line.pending, line.outstandingAfter].map(quantity => `<td><bdi>${esc(quantity)}</bdi></td>`).join("")}
  </tr>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
    <title>سند استرجاع معدات · ${esc(rental.orderNo)}</title><style>${movementReceiptCss}</style></head><body><main><header><b>${esc(company.site_name || "AJN")}</b><h1>سند استرجاع معدات</h1><bdi>${esc(rental.orderNo)}</bdi></header>
    <p>العميل: <b>${esc(rental.customerName)}</b> · وقت الاسترجاع: <bdi>${esc(date)}</bdi></p>
    <p>سجّله: ${esc(record.actorName)} · مرجع العملية: <small><bdi>${esc(record.requestId)}</bdi></small></p>
    <table><thead><tr><th>المعدة</th><th>المستلم والمخزن</th><th>سليم</th><th>تالف</th><th>مفقود</th><th>بانتظار الفحص</th><th>المتبقي لدى العميل</th></tr></thead><tbody>${rows}</tbody></table>
    ${record.note ? `<p class="note">الملاحظات: ${esc(record.note)}</p>` : ""}
    <p>تُسوّى مبالغ الإيجار والتأمين عبر الموافقات المالية.</p>
    <div class="signatures"><p>توقيع العميل __________________</p><p>توقيع المستلم __________________</p></div></main></body></html>`;
}

export function equipmentRentalPrintHtml(rental: EquipmentRentalDetail, company: { site_name?: string; phone?: string; address?: string }, size: "A4" | "80mm", document: "contract" | "receipt" = "contract") {
  const details = rental.details;
  const thermal = size === "80mm";
  const lines = details.assets.map((line) => thermal
    ? `<tr><td colspan="2"><b>${esc(line.name)}</b><small>${esc(line.code)} · مخزن ${esc(line.warehouseId ?? "الرئيسي")}</small></td><td class="number">${esc(cash(line.lineTotal))}</td></tr><tr class="line-detail"><td colspan="3">الكمية ${esc(line.quantity)} × ${esc(cash(line.unitPrice))} · المدة ${esc(line.duration)}${line.discount ? ` · خصم ${esc(cash(line.discount))}` : ""}</td></tr>`
    : `<tr><td>${esc(line.name)}<small>${esc(line.code)} · مخزن ${esc(line.warehouseId ?? "الرئيسي")}</small></td><td>${esc(line.quantity)}</td><td>${esc(line.duration)}</td><td>${esc(cash(line.unitPrice))}</td><td>${esc(cash(line.discount))}</td><td>${esc(cash(line.lineTotal))}</td></tr>`).join("");
  const columns = thermal ? '<th colspan="2">المعدات</th><th>المجموع</th>' : '<th>المعدات</th><th>الكمية</th><th>المدة</th><th>سعر الوحدة</th><th>الخصم</th><th>المجموع</th>';
  const terms = document === "contract" ? `<section><h3>شروط الإيجار المتفق عليها</h3><p class="terms">${esc(details.terms || "يلتزم المستأجر بإعادة المعدات بالعدد والحالة المبينة في محضر التسليم. تُراجع أي رسوم تأخير أو تلف أو فقد وفق الشروط المتفق عليها وبعد الاعتماد.")}</p><p>حالة المعدات عند التسليم: ${esc(details.assets.map(line => `${line.name}: ${String(line.conditionAtDispatch || "تراجع في محضر التسليم")}`).join(" · "))}</p><div class="signatures"><p>توقيع العميل<br><br>________________</p><p>ممثل الشركة<br><br>________________</p></div></section>` : "";
  const css = thermal ? `${thermalReceiptCss("80mm")} body{font-size:11px}table{font-size:10px;table-layout:fixed}th,td{padding:4px 1px;overflow-wrap:anywhere}.line-detail{font-size:9px;color:#555}.number{white-space:nowrap} .signatures{display:block}h1{font-size:17px}` : `@page{size:A4;margin:14mm}body{font-family:Cairo,Tahoma,Arial,sans-serif;color:#21191c;max-width:180mm;margin:auto;font-size:12px}h1{font-size:25px;color:#70032c}th,td{padding:9px 6px}section{margin-top:20px}.signatures{display:flex;justify-content:space-between;gap:20px}`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(rental.orderNo)}</title><style>${css}*{box-sizing:border-box}table{width:100%;border-collapse:collapse}th,td{text-align:right;border-bottom:1px solid #eadde1;vertical-align:top}th{background:#fbf5f7}small{display:block;color:#666;font-size:.85em}header{text-align:center;border-bottom:2px solid #70032c;padding-bottom:12px}p{line-height:1.8}.facts{display:flex;flex-wrap:wrap;gap:5px 25px}.money{margin-inline-start:auto;width:100%;max-width:330px}.money p{display:flex;justify-content:space-between;margin:5px 0}.money .total{border-top:1px solid #eadde1;padding-top:8px;font-size:1.15em;color:#70032c}.terms{white-space:pre-wrap}.muted{color:#666}tr,section{break-inside:avoid}bdi{direction:ltr}</style></head><body><main class="${thermal ? "receipt" : "rental-contract"}"><header><h2>${esc(company.site_name || "AJN")}</h2><p>${esc(company.address)} · ${esc(company.phone)}</p><h1>${document === "contract" ? "عقد إيجار معدات" : "كشف حساب إيجار"}</h1><bdi>${esc(rental.orderNo)}</bdi></header><section class="facts"><p>العميل: <b>${esc(rental.customerName)}</b><br>الهاتف: <bdi>${esc(rental.phone)}</bdi><br>${esc(details.address)}</p><p>التسليم: <bdi>${esc(rental.startDate)} ${esc(details.startTime)}</bdi><br>الإرجاع المتوقع: <bdi>${esc(rental.endDate)} ${esc(details.endTime)}</bdi><br>الحالة: ${esc(EQUIPMENT_RENTAL_STATUS_LABELS[rental.status] || rental.status)}</p></section><table><thead><tr>${columns}</tr></thead><tbody>${lines}</tbody></table><section class="money"><p><span>التوصيل</span><bdi>${esc(cash(details.deliveryCharge))}</bdi></p><p><span>التركيب</span><bdi>${esc(cash(details.installationCharge))}</bdi></p><p><span>خصم العقد</span><bdi>${esc(cash(details.discount))}</bdi></p><p class="total"><b>إجمالي الإيجار</b><bdi>${esc(cash(rental.total))}</bdi></p><p><span>المسدد المعتمد</span><bdi>${esc(cash(rental.paid))}</bdi></p><p><b>المتبقي</b><bdi>${esc(cash(rental.remaining))}</bdi></p><p><span>التأمين المطلوب (مسترد)</span><bdi>${esc(cash(details.depositRequired))}</bdi></p><p><span>التأمين المحتفظ به</span><bdi>${esc(cash(rental.finance.depositHeld))}</bdi></p></section><p class="muted">التأمين المسترد التزام مستقل؛ لا يخفض رصيد الإيجار إلا بتسوية معتمدة. الدفعات المعلقة لا تدخل في المسدد أعلاه.</p>${terms}</main></body></html>`;
}
