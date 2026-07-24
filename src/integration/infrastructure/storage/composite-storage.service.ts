import { Config, StorageReadSource, StorageWriteMode } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AzureStorageService } from './azure-storage.service';
import { S3StorageService } from './s3-storage.service';
import { Blob, BlobContent, StorageService } from './storage.service';

/**
 * Dual-write storage layer for the Azure→MinIO cutover.
 *
 * Writes are driven by `Config.storage.writeMode` (`azure` | `dual` | `s3`); reads by
 * `Config.storage.readSource` (`azure` | `s3`). In `dual` mode both backends receive every
 * write, fail-closed (if either side throws, the whole call throws — never mask a partial
 * write). Read path has no fallback: only the configured `readSource` is consulted.
 *
 * Both backends are constructed eagerly but remain boot-order-safe: their constructors read
 * nothing from Config (lazy client getters). Config is only re-read on each I/O method via
 * `getWriteMode()` / `getReadSource()`, which re-run the central validation in
 * `Config.storage` (format of both vars + invalid-combo check).
 *
 * Canonical URL form is S3 (`Config.s3.publicUrl`): dual-mode upload/copy return values come
 * from the S3 backend regardless of write order. `blobUrl`/`blobName` are inherited unchanged
 * from StorageService for the same reason.
 */
export class CompositeStorageService extends StorageService {
  private readonly logger = new DfxLogger(CompositeStorageService);
  private readonly s3: S3StorageService;
  private readonly azure: AzureStorageService;

  constructor(container: string) {
    super(container);
    this.s3 = new S3StorageService(container);
    this.azure = new AzureStorageService(container);
  }

  private getWriteMode(): StorageWriteMode {
    return Config.storage.writeMode;
  }

  private getReadSource(): StorageReadSource {
    return Config.storage.readSource;
  }

  private readBackend(): StorageService {
    return this.getReadSource() === 's3' ? this.s3 : this.azure;
  }

  async listBlobs(prefix?: string): Promise<Blob[]> {
    return this.readBackend().listBlobs(prefix);
  }

  async listKeys(prefix?: string): Promise<string[]> {
    return this.readBackend().listKeys(prefix);
  }

  async getBlob(name: string): Promise<BlobContent> {
    return this.readBackend().getBlob(name);
  }

  async uploadBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string> {
    const mode = this.getWriteMode();
    if (mode === 'azure') return this.azure.uploadBlob(name, data, type, metadata);
    if (mode === 's3') return this.s3.uploadBlob(name, data, type, metadata);

    // dual: write read-source first, then the other; always return the S3 URL (canonical form).
    const readSource = this.getReadSource();
    if (readSource === 'azure') {
      await this.azure.uploadBlob(name, data, type, metadata);
      return this.s3.uploadBlob(name, data, type, metadata);
    }
    const s3Url = await this.s3.uploadBlob(name, data, type, metadata);
    await this.azure.uploadBlob(name, data, type, metadata);
    return s3Url;
  }

  async uploadWormBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string> {
    const mode = this.getWriteMode();
    // Always call uploadWormBlob (never uploadBlob) so S3's Object-Lock check stays intact;
    // Azure inherits the base default (no lock enforcement).
    if (mode === 'azure') return this.azure.uploadWormBlob(name, data, type, metadata);
    if (mode === 's3') return this.s3.uploadWormBlob(name, data, type, metadata);

    const readSource = this.getReadSource();
    if (readSource === 'azure') {
      await this.azure.uploadWormBlob(name, data, type, metadata);
      return this.s3.uploadWormBlob(name, data, type, metadata);
    }
    const s3Url = await this.s3.uploadWormBlob(name, data, type, metadata);
    await this.azure.uploadWormBlob(name, data, type, metadata);
    return s3Url;
  }

  async copyBlobs(sourcePrefix: string, targetPrefix: string): Promise<string[]> {
    const mode = this.getWriteMode();
    if (mode === 'azure') return this.azure.copyBlobs(sourcePrefix, targetPrefix);
    if (mode === 's3') return this.s3.copyBlobs(sourcePrefix, targetPrefix);

    // dual: same order rule as upload (read-source first). An empty source prefix on one side
    // is a legitimate no-op (returns []) — not an error. Azure/S3 length asymmetry (e.g. source
    // exists only on one side before backfill) must not fail closed (account merges during the
    // migration window); log loudly and rely on the mandatory reconciler gate to heal the
    // divergence before the read flip.
    const readSource = this.getReadSource();
    let s3Result: string[];
    let azureResult: string[];
    if (readSource === 'azure') {
      azureResult = await this.azure.copyBlobs(sourcePrefix, targetPrefix);
      s3Result = await this.s3.copyBlobs(sourcePrefix, targetPrefix);
    } else {
      s3Result = await this.s3.copyBlobs(sourcePrefix, targetPrefix);
      azureResult = await this.azure.copyBlobs(sourcePrefix, targetPrefix);
    }

    if (azureResult.length !== s3Result.length) {
      this.logger.warn(
        `copyBlobs dual-write asymmetry: sourcePrefix=${sourcePrefix} targetPrefix=${targetPrefix} ` +
          `azureCount=${azureResult.length} s3Count=${s3Result.length}; ` +
          `the reconciler gate must heal this divergence before the read flip`,
      );
    }

    return s3Result;
  }
}
