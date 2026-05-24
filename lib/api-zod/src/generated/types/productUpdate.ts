import type { ProductColor } from "./productColor";

export interface ProductUpdate {
  name?: string;
  nameAr?: string;
  description?: string;
  descriptionAr?: string;
  price?: number;
  originalPrice?: number;
  stock?: number;
  category?: string;
  subcategory?: string;
  images?: string[];
  imageMetadata?: Record<string, unknown>[];
  colors?: ProductColor[];
  isFeatured?: boolean;
}
