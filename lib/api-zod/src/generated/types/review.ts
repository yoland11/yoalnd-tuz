export interface Review {
  id: number;
  productId: number;
  /** @nullable */
  customerId?: number | null;
  customerName: string;
  rating: number;
  /** @nullable */
  comment?: string | null;
  createdAt: string;
}
