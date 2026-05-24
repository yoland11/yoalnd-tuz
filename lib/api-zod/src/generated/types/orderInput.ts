import type { OrderInputPaymentMethod } from "./orderInputPaymentMethod";

export interface OrderInput {
  customerName: string;
  customerPhone: string;
  governorate: string;
  area?: string;
  address?: string;
  notes?: string;
  paymentMethod?: OrderInputPaymentMethod;
  deliveryZoneId?: number;
  /** Google Maps URL (from geolocation or manual entry) */
  mapsUrl?: string;
}
