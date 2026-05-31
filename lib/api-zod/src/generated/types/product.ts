import type { ProductColor } from "./productColor";

export interface Product {
  id: number;
  name: string;
  nameAr: string;
  /** @nullable */
  description?: string | null;
  /** @nullable */
  descriptionAr?: string | null;
  price: number;
  /** @nullable */
  originalPrice?: number | null;
  costPrice?: number;
  stock: number;
  minStock?: number;
  /** @nullable */
  barcode?: string | null;
  /** @nullable */
  category?: string | null;
  /** @nullable */
  subcategory?: string | null;
  images: string[];
  imageMetadata?: Record<string, unknown>[];
  colors?: ProductColor[];
  isFeatured?: boolean;
  isActive?: boolean;
  sortOrder?: number;
  /** @nullable */
  rating?: number | null;
  reviewCount?: number;
  createdAt: string;
}
