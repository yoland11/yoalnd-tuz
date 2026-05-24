export interface HealthStatus {
  status: string;
}

export interface MessageResponse {
  message: string;
}

export interface CategoryItem {
  name: string;
  count: number;
}

export interface ProductColor {
  name: string;
  hex: string;
  image?: string | null;
  imageUrl?: string | null;
}

export interface OtpRequest {
  phone: string;
}

export interface OtpResponse {
  message: string;
  /** @nullable */
  devOtp?: string | null;
}

export interface OtpVerify {
  phone: string;
  otp: string;
}

export interface Customer {
  id: number;
  phone: string;
  name: string;
  role?: string;
  createdAt: string;
}

export interface AuthResult {
  customer: Customer;
  token: string;
}

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
  stock: number;
  /** @nullable */
  category?: string | null;
  /** @nullable */
  subcategory?: string | null;
  images: string[];
  imageMetadata?: Record<string, unknown>[];
  colors?: ProductColor[];
  isFeatured?: boolean;
  /** @nullable */
  rating?: number | null;
  reviewCount?: number;
  createdAt: string;
}

export interface ProductInput {
  name: string;
  nameAr: string;
  description?: string;
  descriptionAr?: string;
  price: number;
  originalPrice?: number;
  stock: number;
  category?: string;
  subcategory?: string;
  images?: string[];
  imageMetadata?: Record<string, unknown>[];
  colors?: ProductColor[];
  isFeatured?: boolean;
}

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

export interface Service {
  id: number;
  name: string;
  nameAr: string;
  /** @nullable */
  description?: string | null;
  /** @nullable */
  descriptionAr?: string | null;
  type: string;
  /** @nullable */
  icon?: string | null;
  /** @nullable */
  image?: string | null;
  imageMetadata?: Record<string, unknown>;
  isActive: boolean;
}

export type ServiceOrderInputCustomFields = { [key: string]: unknown };

export interface ServiceOrderInput {
  serviceId: number;
  customerName: string;
  phone: string;
  eventDate: string;
  eventLocation?: string;
  notes?: string;
  customFields?: ServiceOrderInputCustomFields;
}

export interface ServiceOrder {
  id: number;
  serviceId: number;
  serviceName?: string;
  /** @nullable */
  trackingCode?: string | null;
  customerName: string;
  phone: string;
  /** @nullable */
  eventDate?: string | null;
  /** @nullable */
  eventLocation?: string | null;
  /** @nullable */
  notes?: string | null;
  status: string;
  createdAt: string;
}

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

export interface Cart {
  items: CartItem[];
  total: number;
  itemCount?: number;
}

export interface CartItemInput {
  productId: number;
  quantity: number;
  selectedColor?: string;
  selectedColorData?: ProductColor;
  customization?: string;
}

export interface CartItemUpdate {
  quantity: number;
}

export type OrderPaymentMethod =
  (typeof OrderPaymentMethod)[keyof typeof OrderPaymentMethod];

export const OrderPaymentMethod = {
  cod: "cod",
  transfer: "transfer",
  paid: "paid",
} as const;

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

export interface Order {
  id: number;
  trackingCode: string;
  /** @nullable */
  customerId?: number | null;
  customerName?: string;
  customerPhone?: string;
  status: string;
  /** @nullable */
  serviceType?: string | null;
  total: number;
  deliveryFee?: number;
  paymentMethod?: OrderPaymentMethod;
  /** @nullable */
  governorate?: string | null;
  /** @nullable */
  area?: string | null;
  /** @nullable */
  address?: string | null;
  /** @nullable */
  notes?: string | null;
  /** @nullable */
  mapsUrl?: string | null;
  items?: OrderItem[];
  createdAt: string;
  updatedAt?: string;
}

export type OrderInputPaymentMethod =
  (typeof OrderInputPaymentMethod)[keyof typeof OrderInputPaymentMethod];

export const OrderInputPaymentMethod = {
  cod: "cod",
  transfer: "transfer",
  paid: "paid",
} as const;

export interface OrderInput {
  customerName: string;
  customerPhone: string;
  governorate: string;
  area?: string;
  address?: string;
  notes?: string;
  paymentMethod?: OrderInputPaymentMethod;
  deliveryZoneId?: number;
  /** Google Maps URL (from geolocation or manual entry) */
  mapsUrl?: string;
}

export interface OrderStatusUpdate {
  status: string;
  notes?: string;
}

export interface StatusHistoryEntry {
  status: string;
  /** @nullable */
  notes?: string | null;
  createdAt: string;
}

export interface OrderTracking {
  trackingCode: string;
  status: string;
  customerName?: string;
  /** @nullable */
  customerPhone?: string | null;
  /** @nullable */
  serviceType?: string | null;
  /** product | service */
  kind?: string;
  total?: number;
  items?: OrderItem[];
  statusHistory?: StatusHistoryEntry[];
  createdAt: string;
  /** @nullable */
  estimatedDelivery?: string | null;
  /** @nullable */
  mapsUrl?: string | null;
  /** @nullable */
  governorate?: string | null;
  /** @nullable */
  area?: string | null;
  /** @nullable */
  address?: string | null;
  /** @nullable */
  eventDate?: string | null;
  /** @nullable */
  eventLocation?: string | null;
  /**
   * confirmed | reschedule_requested | null
   * @nullable
   */
  customerConfirmation?: string | null;
  /** @nullable */
  requestedDate?: string | null;
  /** @nullable */
  confirmationNote?: string | null;
  /** @nullable */
  confirmationAt?: string | null;
}

export type BookingResponseInputAction =
  (typeof BookingResponseInputAction)[keyof typeof BookingResponseInputAction];

export const BookingResponseInputAction = {
  confirm: "confirm",
  reschedule: "reschedule",
} as const;

export interface BookingResponseInput {
  action: BookingResponseInputAction;
  requestedDate?: string;
  note?: string;
}

export interface GalleryItem {
  id: number;
  mediaUrl: string;
  mediaType: string;
  imageMetadata?: Record<string, unknown>;
  /** @nullable */
  title?: string | null;
  /** @nullable */
  titleAr?: string | null;
  category: string;
  createdAt: string;
}

export interface GalleryItemInput {
  mediaUrl: string;
  mediaType: string;
  imageMetadata?: Record<string, unknown>;
  title?: string;
  titleAr?: string;
  category: string;
}

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

export interface ReviewInput {
  productId: number;
  customerName: string;
  rating: number;
  comment?: string;
}

export interface DeliveryZone {
  id: number;
  governorate: string;
  governorateAr?: string;
  areas?: string[];
  price: number;
  estimatedDays: number;
  isActive: boolean;
}

export interface DeliveryZoneInput {
  governorate: string;
  governorateAr: string;
  areas?: string[];
  price: number;
  estimatedDays: number;
  isActive?: boolean;
}

export interface DeliveryZoneUpdate {
  price?: number;
  estimatedDays?: number;
  isActive?: boolean;
  areas?: string[];
}

export interface DashboardStats {
  totalOrders: number;
  totalRevenue: number;
  totalProducts: number;
  totalCustomers: number;
  pendingOrders: number;
  todayOrders: number;
  todayRevenue: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

/**
 * Anonymous cart/session identifier generated and stored by the web client.
 */
export type CartSessionIdParameter = string;

export type ListProductsParams = {
  category?: string;
  search?: string;
  inStock?: boolean;
};

export type ListOrdersParams = {
  status?: string;
  customerId?: number;
};

export type ListGalleryParams = {
  category?: string;
};

export type ListReviewsParams = {
  productId: number;
};
