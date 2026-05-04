export type VariantName = 'thumbnail' | 'card' | 'tablet' | 'social';
export type UploadMode = 'upload' | 'compress-jpg' | 'png-to-jpg' | 'strip-metadata' | 'remove-background';

export interface ImageRendition {
  url: string;
  base64Url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  size: number;
}

export interface ImageAsset {
  id: string;
  filename: string;
  altName: string | null;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  isAnimated: boolean;
  createdAt: string;
  directUrl: string;
  autoUrl: string;
  responsiveHtml: string;
  original: ImageRendition;
  variants: Partial<Record<VariantName, ImageRendition>>;
}

export interface ProcessingSummary {
  mode: UploadMode;
  sourceMimeType: string;
  sourceSize: number;
  outputMimeType: string;
  outputSize: number;
  savedBytes: number;
  savedPercent: number;
}

export function getDisplayName(image: Pick<ImageAsset, 'altName' | 'id'>): string {
  return image.altName || image.id;
}

export function getPreviewUrl(image: Pick<ImageAsset, 'directUrl' | 'variants'>): string {
  return image.variants.card?.url || image.variants.thumbnail?.url || image.directUrl;
}

export function getPrimaryViewUrl(image: Pick<ImageAsset, 'directUrl' | 'variants'>): string {
  return image.variants.tablet?.url || getPreviewUrl(image);
}

export function getBase64ApiPath(imageId: string, variant: VariantName | 'original'): string {
  return `/api/images/${imageId}/base64/${variant}`;
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatDimensions(width: number | null, height: number | null): string | null {
  if (!width || !height) {
    return null;
  }

  return `${width} x ${height}`;
}

export function formatMimeLabel(mimeType: string): string {
  return mimeType.split('/')[1]?.toUpperCase() || mimeType.toUpperCase();
}
