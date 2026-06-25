export interface GalleryItemInput {
  mediaUrl: string;
  mediaType: string;
  imageMetadata?: Record<string, unknown>;
  title?: string;
  titleAr?: string;
  category: string;
}
