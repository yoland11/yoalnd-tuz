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
