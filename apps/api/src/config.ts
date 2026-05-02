import 'dotenv/config';
import { LocalStorageDriver } from './storage/local.js';
import { S3StorageDriver } from './storage/s3.js';
import { StorageDriver } from './storage/types.js';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL || 'file:app.sqlite',
  storageDriver: process.env.STORAGE_DRIVER || 'local',
  uploadDir: process.env.UPLOAD_DIR || 'data/uploads',
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '20', 10),
  allowedTypes: (process.env.ALLOWED_TYPES || 'image/png,image/jpeg,image/webp,image/gif').split(','),
  publicUploads: process.env.PUBLIC_UPLOADS === 'true',
  adminToken: process.env.ADMIN_TOKEN || 'change-me',
  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET || '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  }
};

let storage: StorageDriver;

if (config.storageDriver === 'local') {
  storage = new LocalStorageDriver({
    uploadDir: config.uploadDir,
    publicBaseUrl: config.publicBaseUrl,
  });
} else if (config.storageDriver === 's3') {
  storage = new S3StorageDriver({
    ...config.s3,
    publicBaseUrl: config.publicBaseUrl,
  });
} else {
  throw new Error(`Unsupported storage driver: ${config.storageDriver}`);
}

export { storage };
