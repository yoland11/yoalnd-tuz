import type { ServiceOrderInputCustomFields } from "./serviceOrderInputCustomFields";

export interface ServiceOrderInput {
  serviceId: number;
  customerName: string;
  phone: string;
  eventDate?: string;
  eventLocation?: string;
  notes?: string;
  customFields?: ServiceOrderInputCustomFields;
}
