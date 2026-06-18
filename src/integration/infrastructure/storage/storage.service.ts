/**
 * Provider-agnostic blob storage abstraction.
 *
 * The public surface is identical to the previous `AzureStorageService` so that
 * existing consumers (KYC, support, fiat-output) need no change beyond how the
 * instance is obtained — see `storage.factory.ts`.
 *
 * WORM / Object-Lock is enforced at the storage layer for compliance buckets and
 * is intentionally NOT part of these signatures: consumers just upload, the
 * implementation applies retention based on bucket configuration.
 */

export interface BlobMetaData {
  // optional: a bucket listing does not return content-type / user metadata,
  // only a HeadObject/GetObject does
  contentType?: string;
  created?: Date;
  updated?: Date;
  metadata?: Record<string, string>;
}

export interface Blob extends BlobMetaData {
  name: string;
  url: string;
}

export interface BlobContent extends BlobMetaData {
  data: Buffer;
}

export abstract class StorageService {
  abstract listBlobs(prefix?: string): Promise<Blob[]>;
  abstract getBlob(name: string): Promise<BlobContent>;
  abstract uploadBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string>;
  abstract copyBlobs(sourcePrefix: string, targetPrefix: string): Promise<void>;
  abstract blobUrl(name: string): string;
  abstract blobName(url: string): string;
}
