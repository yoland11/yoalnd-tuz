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
