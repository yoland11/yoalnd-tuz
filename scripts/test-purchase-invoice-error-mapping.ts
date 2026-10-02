import assert from "node:assert/strict";
import {
  hasExactPurchaseCatalogProduct,
  mapPurchaseInvoiceCheckoutError,
  purchaseInvoiceErrorDescription,
} from "../src/lib/purchase-invoice-errors";

assert.equal(
  hasExactPurchaseCatalogProduct("بيبي روز غصن كبير", [
    { nameAr: "بيبي روز غصن كبير", name: "Baby Rose Large Stem" },
  ]),
  true,
  "an exact catalog match typed without selecting a search result must be recognized",
);
assert.equal(
  hasExactPurchaseCatalogProduct("صنف جديد", [{ nameAr: "منتج موجود", name: "Existing Product" }]),
  false,
  "new free-text purchase items must remain supported",
);

const missingVariant = Object.assign(
  new Error("اختر متغير المنتج: ورد صناعي"),
  { name: "CheckoutError", status: 422, options: {} },
);
assert.deepEqual(mapPurchaseInvoiceCheckoutError(missingVariant), {
  message: "اختر متغير المنتج: ورد صناعي",
  status: 422,
});

const staleVariant = Object.assign(
  new Error("المتغير المحدد لم يعد متاحاً"),
  { name: "CheckoutError", status: 409, options: {} },
);
assert.deepEqual(mapPurchaseInvoiceCheckoutError(staleVariant), {
  message: "المتغير المحدد لم يعد متاحاً",
  status: 409,
});

assert.equal(
  mapPurchaseInvoiceCheckoutError(new Error("database failure")),
  null,
  "unexpected errors must continue through the structured server error handler",
);
assert.equal(
  purchaseInvoiceErrorDescription("تعذر إكمال العملية", "REQ-abc-123"),
  "تعذر إكمال العملية · مرجع الخطأ: REQ-abc-123",
);
assert.equal(
  purchaseInvoiceErrorDescription("تعذر إكمال العملية", "unsafe / id"),
  "تعذر إكمال العملية",
  "the toast must not display an untrusted request reference",
);

console.log("Purchase invoice domain-error mapping passed.");
