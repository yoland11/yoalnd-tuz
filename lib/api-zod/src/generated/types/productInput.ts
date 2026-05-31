import type { ProductColor } from "./productColor";

export interface ProductInput {
  name?: string;
  nameAr?: string;
  description?: string;
  descriptionAr?: string;
  price?: number;
  originalPrice?: number;
  costPrice?: number;
  stock?: number;
  minStock?: number;
  barcode?: string;
  category?: string;
  subcategory?: string;
  images?: string[];
  imageMetadata?: Record<string, unknown>[];
  colors?: ProductColor[];
  isFeatured?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}
