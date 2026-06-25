export type OrderInputPaymentMethod =
  (typeof OrderInputPaymentMethod)[keyof typeof OrderInputPaymentMethod];

export const OrderInputPaymentMethod = {
  cod: "cod",
  transfer: "transfer",
  paid: "paid",
} as const;
