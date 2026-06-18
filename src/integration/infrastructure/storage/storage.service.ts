import { Config } from 'src/config/config';

export interface BlobMetaData {
  contentType: string;
  created: Date;
  updated: Date;
  metadata: Record<string, string>;
}

export interface Blob extends BlobMetaData {
  name: string;
  url: string;
}

export interface BlobContent extends BlobMetaData {
  data: Buffer;
}

/**
 * Provider-agnostic blob storage abstraction.
 *
 * The method surface is signature-compatible with the previous AzureStorageService,
 * so consumers only change how the instance is obtained (see storage.factory.ts).
 *
 * `blobUrl`/`blobName` live here so the URL shape — and its reversibility — is
 * identical across implementations and stays consistent with URLs persisted in the DB.
 * The trailing-slash contract on the public URL base is enforced by the concrete
 * implementation's config validation.
 */
export abstract class StorageService {
  constructor(protected readonly container: string) {}

  abstract listBlobs(prefix?: string): Promise<Blob[]>;
  abstract getBlob(name: string): Promise<BlobContent>;
  abstract uploadBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string>;
  abstract copyBlobs(sourcePrefix: string, targetPrefix: string): Promise<void>;

  blobUrl(name: string): string {
    return `${Config.s3.publicUrl}${this.container}/${this.encodeKey(name)}`;
  }

  blobName(url: string): string {
    const filePath = url.split(`${this.container}/`)[1];
    return filePath.split('/').map(decodeURIComponent).join('/');
  }

  protected encodeKey(name: string): string {
    return name.split('/').map(encodeURIComponent).join('/');
  }
}
