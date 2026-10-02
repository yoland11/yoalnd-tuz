const CHECKOUT_ERROR_STATUSES = new Set([400, 401, 403, 404, 409, 422, 500]);

type PurchaseCatalogProduct = { nameAr?: string | null; name?: string | null };

export function hasExactPurchaseCatalogProduct(
  enteredName: string,
  products: readonly PurchaseCatalogProduct[],
) {
  const normalize = (value: string | null | undefined) =>
    String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const entered = normalize(enteredName);
  if (!entered) return false;
  return products.some(
    (product) =>
      normalize(product.nameAr) === entered || normalize(product.name) === entered,
  );
}

export function mapPurchaseInvoiceCheckoutError(error: unknown) {
  if (!(error instanceof Error)) return null;
  const details = error as Error & {
    status?: unknown;
    options?: unknown;
  };
  const status = Number(details.status);
  if (
    !details.options ||
    !CHECKOUT_ERROR_STATUSES.has(status) ||
    !details.message.trim()
  )
    return null;
  return { message: details.message, status };
}

export function purchaseInvoiceErrorDescription(
  message: unknown,
  requestId: unknown,
) {
  const safeMessage = String(message ?? "تعذر حفظ فاتورة الشراء");
  const reference = String(requestId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(reference)) return safeMessage;
  return `${safeMessage} · مرجع الخطأ: ${reference}`;
}
