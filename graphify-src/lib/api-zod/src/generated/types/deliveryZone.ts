export interface DeliveryZone {
  id: number;
  governorate: string;
  governorateAr?: string;
  areas?: string[];
  price: number;
  estimatedDays: number;
  isActive: boolean;
}
