export interface DeliveryZoneInput {
  governorate: string;
  governorateAr: string;
  areas?: string[];
  price: number;
  estimatedDays: number;
  isActive?: boolean;
}
