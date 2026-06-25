import type { Product } from "./product";
import type { ProductColor } from "./productColor";

export interface CartItem {
  id: number;
  productId: number;
  product?: Product;
  quantity: number;
  price: number;
  /** @nullable */
  selectedColor?: string | null;
  selectedColorData?: ProductColor | null;
  /** @nullable */
  customization?: string | null;
}
