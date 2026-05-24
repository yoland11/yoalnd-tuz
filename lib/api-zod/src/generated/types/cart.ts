import type { CartItem } from "./cartItem";

export interface Cart {
  items: CartItem[];
  total: number;
  itemCount?: number;
}
