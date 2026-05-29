import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { config } from '../config.js';

export type StagedUpload = {
  s3Key: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fingerprint: string;
};

export function makeS3Client(): S3Client {
  return new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
    forcePathStyle: config.s3.forcePathStyle,
  });
}

export async function downloadStagedToFile(staged: StagedUpload, destPath: string): Promise<void> {
  const client = makeS3Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: staged.s3Key,
    })
  );

  if (!response.Body) {
    throw new Error('Empty staged object body');
  }

  await pipeline(response.Body as Readable, createWriteStream(destPath));
}
