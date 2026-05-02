import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageDriver, StoredFile } from './types.js';
import { Readable } from 'node:stream';

export class S3StorageDriver implements StorageDriver {
  private client: S3Client;
  private bucket: string;
  private publicBaseUrl: string;

  constructor(config: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle?: boolean;
    publicBaseUrl: string;
  }) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
    });
    this.bucket = config.bucket;
    this.publicBaseUrl = config.publicBaseUrl;
  }

  async put(input: {
    key: string;
    body: Buffer | Uint8Array;
    mimeType: string;
  }): Promise<StoredFile> {
    const { Upload } = await import('@aws-sdk/lib-storage');
    
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.mimeType,
      },
    });

    await upload.done();

    return {
      key: input.key,
      url: this.publicUrl(input.key),
      size: input.body.length,
      mimeType: input.mimeType,
    };
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }

  async get(key: string): Promise<{ body: Readable; mimeType?: string }> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );

    return {
      body: response.Body as Readable,
      mimeType: response.ContentType,
    };
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/raw/${key}`;
  }
}
