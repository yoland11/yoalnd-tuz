import type { ProductColor } from "./productColor";

export interface CartItemInput {
  productId: number;
  quantity: number;
  selectedColor?: string;
  selectedColorData?: ProductColor;
  customization?: string;
}
