import type { ProductColor } from "./productColor";

export interface OrderItem {
  id: number;
  productId: number;
  productName: string;
  productNameAr?: string;
  quantity: number;
  price: number;
  /** @nullable */
  selectedColor?: string | null;
  selectedColorData?: ProductColor | null;
  /** @nullable */
  customization?: string | null;
  /** @nullable */
  image?: string | null;
}
