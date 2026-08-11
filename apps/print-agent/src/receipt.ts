import QRCode from "qrcode";
import { buildSalesInvoiceThermalHtml } from "@workspace/print-template";
import type { PrintPayload } from "./contracts.js";

/**
 * The Agent receives trusted data only. The document itself is built by the
 * shared canonical Sales Invoice thermal template also used by browser print.
 */
export async function salesInvoiceReceiptHtml(payload: PrintPayload) {
  const invoice = payload.invoice;
  const qrImageUrl = payload.appearance?.showQr !== false && invoice.qrUrl
    ? await QRCode.toDataURL(invoice.qrUrl, {
      margin: 1,
      width: payload.paperSize === "58mm" ? 140 : 172,
      errorCorrectionLevel: "M",
    })
    : null;
  return buildSalesInvoiceThermalHtml({
    paperSize: payload.paperSize,
    invoiceNo: invoice.invoiceNo,
    issuedAt: invoice.issuedAt ?? invoice.date,
    customerName: invoice.customerName,
    customerPhone: invoice.customerPhone,
    paymentMethod: invoice.paymentMethod,
    paymentStatus: invoice.paymentStatus,
    employeeName: invoice.employeeName,
    items: invoice.items.map((item) => ({ productName: item.name, ...item })),
    subtotal: invoice.subtotal,
    discount: invoice.discountAmount,
    tax: invoice.taxAmount,
    deliveryFee: invoice.deliveryFee,
    total: invoice.total,
    paid: invoice.paidAmount,
    remaining: invoice.remainingAmount,
    qrImageUrl,
    qrCaption: invoice.invoiceNo,
    logoUrl: payload.appearance?.logoUrl,
    companyName: payload.appearance?.companyName,
    companyPhone: payload.appearance?.companyPhone,
    companyAddress: payload.appearance?.companyAddress,
    footerText: payload.appearance?.footerText,
    showLogo: payload.appearance?.showLogo,
    showQr: payload.appearance?.showQr,
    showCustomerPhone: payload.appearance?.showCustomerPhone,
    showEmployeeName: payload.appearance?.showEmployeeName,
    showAddress: payload.appearance?.showAddress,
    horizontalOffsetMm: payload.horizontalOffsetMm,
    verticalOffsetMm: payload.verticalOffsetMm,
  });
}
