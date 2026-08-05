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
 * A key and the date the store holds for it, as the listing itself reports them.
 *
 * The date is the object's date, not the document's: a store that received the object through a
 * copy — a migration between backends, say — reports the copy. It is the best date available
 * without a request per object, and the caller has to be able to live with that.
 */
export interface KeyDate {
  key: string;
  lastModified?: Date;
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
  /** Keys only, no per-object metadata fetch — cheap for large buckets (e.g. reconciliation diffing). */
  abstract listKeys(prefix?: string): Promise<string[]>;
  /**
   * Keys with the date the listing already carries — same number of requests as `listKeys`.
   *
   * Separate from `listBlobs`, which answers with full metadata and, on a store whose listing does
   * not carry it, pays one request per object for the rest. Over a prefix holding hundreds of
   * thousands of objects that is not a heavier call but a different order of magnitude.
   */
  abstract listKeyDates(prefix?: string): Promise<KeyDate[]>;
  abstract getBlob(name: string): Promise<BlobContent>;
  abstract uploadBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string>;
  /** Copies every object under `sourcePrefix` to `targetPrefix` and returns the TARGET keys of every object copied. */
  abstract copyBlobs(sourcePrefix: string, targetPrefix: string): Promise<string[]>;

  /**
   * WORM sink for GeBüV-retention-relevant compliance records (e.g. EP2 settlement reports written
   * to a per-merchant container resolved at runtime). The target bucket MUST enforce Object Lock,
   * which cannot be retro-fitted onto an existing non-locked bucket — so a concrete implementation
   * must verify the lock is present before the first write and fail closed if it is not, rather than
   * silently persisting mutable, deletable compliance records into an unprotected bucket.
   *
   * The base default delegates to `uploadBlob` (no server-side Object Lock in LOC/mock); the S3
   * implementation adds the fail-closed verification.
   */
  async uploadWormBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string> {
    return this.uploadBlob(name, data, type, metadata);
  }

  blobUrl(name: string): string {
    return `${Config.s3.publicUrl}${this.container}/${this.encodeKey(name)}`;
  }

  blobName(url: string): string {
    const filePath = url.split(`${this.container}/`)[1];
    if (filePath == null) throw new Error(`URL does not belong to container ${this.container}: ${url}`);
    return filePath.split('/').map(decodeURIComponent).join('/');
  }

  protected encodeKey(name: string): string {
    return StorageService.encodePath(name);
  }

  // Per-segment path encoding for blob keys/URLs: each path segment is `encodeURIComponent`-encoded
  // while the `/` separators are preserved. Exposed statically so consumers that build host-stable
  // variants of a blob URL (e.g. `KycDocumentService.toHostStableUrl`) encode byte-identically to
  // `blobUrl`, keeping the two URLs identical apart from the host.
  static encodePath(name: string): string {
    return name.split('/').map(encodeURIComponent).join('/');
  }
}
