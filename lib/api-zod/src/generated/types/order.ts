import type { OrderItem } from "./orderItem";
import type { OrderPaymentMethod } from "./orderPaymentMethod";

export interface Order {
  id: number;
  trackingCode: string;
  /** @nullable */
  customerId?: number | null;
  customerName?: string;
  customerPhone?: string;
  status: string;
  /** @nullable */
  serviceType?: string | null;
  total: number;
  deliveryFee?: number;
  paymentMethod?: OrderPaymentMethod;
  /** @nullable */
  governorate?: string | null;
  /** @nullable */
  area?: string | null;
  /** @nullable */
  address?: string | null;
  /** @nullable */
  notes?: string | null;
  /** @nullable */
  mapsUrl?: string | null;
  items?: OrderItem[];
  createdAt: string;
  updatedAt?: string;
}
