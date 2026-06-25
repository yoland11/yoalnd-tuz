export type OrderPaymentMethod =
  (typeof OrderPaymentMethod)[keyof typeof OrderPaymentMethod];

export const OrderPaymentMethod = {
  cod: "cod",
  transfer: "transfer",
  paid: "paid",
} as const;
