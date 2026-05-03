import { config } from '../config.js';
import type { Image, ImageVariant } from '../db/schema.js';
import type { VariantName } from '../services/image-processing.js';

type ImageWithVariants = Image & {
  variants?: ImageVariant[];
};

export function buildVariantUrl(imageId: string, variant: VariantName): string {
  return `${config.publicBaseUrl}/api/images/${imageId}/file/${variant}`;
}

export function buildBase64Url(imageId: string, variant: VariantName): string {
  return `${config.publicBaseUrl}/api/images/${imageId}/base64/${variant}`;
}

export function serializeImageAsset(image: ImageWithVariants) {
  const variants = Object.fromEntries(
    (image.variants ?? []).map((variant) => [
      variant.variant,
      {
        url: buildVariantUrl(image.id, variant.variant as VariantName),
        base64Url: buildBase64Url(image.id, variant.variant as VariantName),
        mimeType: variant.mimeType,
        width: variant.width,
        height: variant.height,
        size: variant.size,
      },
    ])
  );

  const original = {
    url: buildVariantUrl(image.id, 'original'),
    base64Url: buildBase64Url(image.id, 'original'),
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    size: image.size,
  };

  return {
    ...image,
    directUrl: original.url,
    original,
    variants,
  };
}
