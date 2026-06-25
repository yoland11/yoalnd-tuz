export interface ServiceOrder {
  id: number;
  serviceId: number;
  serviceName?: string;
  /** @nullable */
  trackingCode?: string | null;
  customerName: string;
  phone: string;
  /** @nullable */
  eventDate?: string | null;
  /** @nullable */
  eventLocation?: string | null;
  /** @nullable */
  notes?: string | null;
  status: string;
  createdAt: string;
}
