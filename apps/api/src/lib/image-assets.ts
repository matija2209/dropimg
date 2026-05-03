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
  const variantData = (image.variants ?? []).map((variant) => ({
    name: variant.variant as VariantName,
    url: buildVariantUrl(image.id, variant.variant as VariantName),
    base64Url: buildBase64Url(image.id, variant.variant as VariantName),
    mimeType: variant.mimeType,
    width: variant.width,
    height: variant.height,
    size: variant.size,
  }));

  const variants = Object.fromEntries(
    variantData.map((v) => [v.name, v])
  );

  const original = {
    url: buildVariantUrl(image.id, 'original'),
    base64Url: buildBase64Url(image.id, 'original'),
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    size: image.size,
  };

  // Generate responsive HTML snippet
  const srcsetEntries = variantData
    .filter(v => v.width)
    .sort((a, b) => (a.width || 0) - (b.width || 0))
    .map(v => `${v.url} ${v.width}w`);

  let responsiveHtml = `<img src="${original.url}" alt="${image.altName || ''}" />`;
  if (srcsetEntries.length > 0) {
    const srcset = srcsetEntries.join(', ');
    const sizes = `(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 1024px`;
    responsiveHtml = `<img src="${original.url}" srcset="${srcset}" sizes="${sizes}" alt="${image.altName || ''}" loading="lazy" />`;
  }

  return {
    ...image,
    directUrl: original.url,
    autoUrl: `${config.publicBaseUrl}/api/images/${image.id}/auto`,
    original,
    variants,
    responsiveHtml,
  };
}
