export type StoredFile = {
  key: string;
  url: string;
  size: number;
  mimeType: string;
};

export interface StorageDriver {
  put(input: {
    key: string;
    body: Buffer | Uint8Array;
    mimeType: string;
  }): Promise<StoredFile>;

  delete(key: string): Promise<void>;

  get(key: string): Promise<{ body: any; mimeType?: string }>;

  publicUrl(key: string): string;
}
