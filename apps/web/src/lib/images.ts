export type VariantName = 'thumbnail' | 'card' | 'tablet' | 'social' | 'poster';
export type UploadMode = 'upload' | 'compress-jpg' | 'png-to-jpg' | 'strip-metadata' | 'remove-background' | 'video';
export type MediaType = 'image' | 'video';

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
  mediaType?: MediaType;
  size: number;
  width: number | null;
  height: number | null;
  durationMs?: number | null;
  transcoded?: boolean;
  originalSize?: number | null;
  isAnimated: boolean;
  createdAt: string;
  directUrl: string;
  autoUrl: string;
  responsiveHtml: string;
  videoHtml?: string;
  original: ImageRendition;
  variants: Partial<Record<VariantName, ImageRendition>>;
}

export interface ProcessingSummary {
  mode: UploadMode | 'video';
  sourceMimeType: string;
  sourceSize: number;
  outputMimeType: string;
  outputSize: number;
  savedBytes: number;
  savedPercent: number;
  transcoded?: boolean;
}

export function isVideoAsset(image: Pick<ImageAsset, 'mediaType' | 'mimeType'>): boolean {
  return image.mediaType === 'video' || image.mimeType.startsWith('video/');
}

export function getDisplayName(image: Pick<ImageAsset, 'altName' | 'id'>): string {
  return image.altName || image.id;
}

export function getPreviewUrl(image: Pick<ImageAsset, 'directUrl' | 'variants' | 'mediaType' | 'mimeType'>): string {
  if (isVideoAsset(image)) {
    return image.variants.poster?.url || image.directUrl;
  }
  return image.variants.card?.url || image.variants.thumbnail?.url || image.directUrl;
}

export function getPrimaryViewUrl(image: Pick<ImageAsset, 'directUrl' | 'variants' | 'mediaType' | 'mimeType'>): string {
  if (isVideoAsset(image)) {
    return image.directUrl;
  }
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

export function formatDuration(durationMs: number | null | undefined): string | null {
  if (!durationMs || durationMs <= 0) {
    return null;
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatMimeLabel(mimeType: string): string {
  return mimeType.split('/')[1]?.toUpperCase() || mimeType.toUpperCase();
}
