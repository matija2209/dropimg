import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalStorageDriver } from '../storage/local.js';
import { S3StorageDriver } from '../storage/s3.js';
import { serializeImageAsset, buildVariantUrl } from '../lib/image-assets.js';
import { config } from '../config.js';

test('CDN: LocalStorageDriver and S3StorageDriver generate CDN URLs', () => {
  const localDriver = new LocalStorageDriver({
    uploadDir: '/tmp/test',
    publicBaseUrl: 'https://img.buildwithmatija.com',
    cdnUrl: 'https://buildwithmatija-assets.b-cdn.net',
  });

  assert.equal(
    localDriver.publicUrl('sample.png'),
    'https://buildwithmatija-assets.b-cdn.net/raw/sample.png'
  );

  const s3Driver = new S3StorageDriver({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    bucket: 'test-bucket',
    accessKeyId: 'test',
    secretAccessKey: 'test',
    publicBaseUrl: 'https://img.buildwithmatija.com',
    cdnUrl: 'https://buildwithmatija-assets.b-cdn.net',
  });

  assert.equal(
    s3Driver.publicUrl('sample.webp'),
    'https://buildwithmatija-assets.b-cdn.net/raw/sample.webp'
  );
});

test('CDN: serializeImageAsset generates CDN URLs and responsive HTML', () => {
  const mockImage = {
    id: 'testimg123',
    filename: 'testimg123.png',
    altName: 'Test Logo',
    mimeType: 'image/png',
    mediaType: 'image' as const,
    size: 1024,
    width: 200,
    height: 200,
    isAnimated: false,
    userId: null,
    deleteToken: 'token123',
    createdAt: new Date().toISOString(),
    variants: [
      {
        id: 'var1',
        imageId: 'testimg123',
        variant: 'thumbnail',
        storageKey: 'testimg123-thumbnail.webp',
        mimeType: 'image/webp',
        width: 150,
        height: 150,
        size: 512,
        createdAt: new Date().toISOString(),
      },
    ],
  };

  const serialized = serializeImageAsset(mockImage as any);

  assert.ok(
    serialized.directUrl.startsWith(config.cdnUrl),
    `directUrl (${serialized.directUrl}) should start with CDN URL (${config.cdnUrl})`
  );
  assert.ok(
    serialized.autoUrl.startsWith(config.cdnUrl),
    `autoUrl (${serialized.autoUrl}) should start with CDN URL (${config.cdnUrl})`
  );
  assert.ok(
    serialized.variants.thumbnail?.url.startsWith(config.cdnUrl),
    `thumbnail variant URL should start with CDN URL`
  );
  assert.ok(
    serialized.responsiveHtml.includes(config.cdnUrl),
    `responsiveHtml should embed CDN URL`
  );
});
