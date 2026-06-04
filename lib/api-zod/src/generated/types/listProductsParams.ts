export type ListProductsParams = {
  category?: string;
  subcategory?: string;
  categoryId?: number;
  subcategoryId?: number;
  search?: string;
  inStock?: boolean;
  limit?: number;
  offset?: number;
};
