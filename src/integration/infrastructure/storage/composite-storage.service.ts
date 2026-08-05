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
 * write, but only the configured read-source write is fail-closed: if it throws, the whole
 * call throws. The other (secondary) store's write is fail-open — failures are logged at
 * error level with the greppable marker `DUAL_WRITE_SECONDARY_FAILURE` and then swallowed.
 * This is correct because a successful upload must guarantee the document is readable from
 * the authoritative read source; the mandatory reconciler gate heals the resulting
 * divergence before the read source is ever flipped. Read path has no fallback: only the
 * configured `readSource` is consulted.
 *
 * Both backends are constructed eagerly but remain boot-order-safe: their constructors read
 * nothing from Config (lazy client getters). Config is only re-read on each I/O method via
 * `getWriteMode()` / `getReadSource()`, which re-run the central validation in
 * `Config.storage` (format of both vars + invalid-combo check).
 *
 * Canonical URL form is S3 (`Config.s3.publicUrl`) when the S3 write succeeds. When the
 * secondary S3 write fails under `readSource=azure`, the Azure URL is returned instead so
 * the returned URL always points at a store that actually holds the object. `blobUrl`/
 * `blobName` are inherited unchanged from StorageService.
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

    // dual: write read-source first (fail-closed), then secondary (fail-open + log).
    // Returned URL must point at a store that actually holds the object.
    const readSource = this.getReadSource();
    if (readSource === 'azure') {
      const azureUrl = await this.azure.uploadBlob(name, data, type, metadata);
      // Secondary write is fail-open: read source already holds the object, reconciler heals divergence.
      try {
        return await this.s3.uploadBlob(name, data, type, metadata);
      } catch (e) {
        // Deliberate: log the object key/name (needed for diagnosis and healing; may be a
        // user-supplied filename for KYC uploads). Never log contents, metadata values, or credentials.
        this.logger.error(
          `DUAL_WRITE_SECONDARY_FAILURE: uploadBlob failed on secondary store s3 ` +
            `(container=${this.container}, name=${name}); read source is azure, ` +
            `continuing (reconciler gate will heal the divergence before the read flip)`,
          e,
        );
        return azureUrl;
      }
    }
    const s3Url = await this.s3.uploadBlob(name, data, type, metadata);
    // Secondary write is fail-open: read source already holds the object, reconciler heals divergence.
    try {
      await this.azure.uploadBlob(name, data, type, metadata);
    } catch (e) {
      this.logger.error(
        `DUAL_WRITE_SECONDARY_FAILURE: uploadBlob failed on secondary store azure ` +
          `(container=${this.container}, name=${name}); read source is s3, ` +
          `continuing (reconciler gate will heal the divergence before the read flip)`,
        e,
      );
    }
    return s3Url;
  }

  async uploadWormBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string> {
    const mode = this.getWriteMode();
    // Always call uploadWormBlob (never uploadBlob) so S3's Object-Lock check stays intact;
    // Azure inherits the base default (no lock enforcement).
    if (mode === 'azure') return this.azure.uploadWormBlob(name, data, type, metadata);
    if (mode === 's3') return this.s3.uploadWormBlob(name, data, type, metadata);

    // dual: same asymmetric fail-closed/fail-open rules as uploadBlob, with an extra WORM
    // consequence under readSource=azure: S3 is the Object-Lock store and only the secondary
    // write. If that secondary write fails, the compliance record is temporarily held without
    // Object-Lock protection until the reconciler heals it into the locked bucket.
    const readSource = this.getReadSource();
    if (readSource === 'azure') {
      const azureUrl = await this.azure.uploadWormBlob(name, data, type, metadata);
      // Secondary write is fail-open: read source already holds the object, reconciler heals divergence.
      // WORM: until healing completes the compliance record has no Object-Lock protection.
      try {
        return await this.s3.uploadWormBlob(name, data, type, metadata);
      } catch (e) {
        this.logger.error(
          `DUAL_WRITE_SECONDARY_FAILURE: uploadWormBlob failed on secondary store s3 ` +
            `(container=${this.container}, name=${name}); read source is azure, ` +
            `compliance record is temporarily without Object-Lock protection until the reconciler ` +
            `heals it into the locked bucket; continuing (reconciler gate will heal the divergence before the read flip)`,
          e,
        );
        return azureUrl;
      }
    }
    const s3Url = await this.s3.uploadWormBlob(name, data, type, metadata);
    // Secondary write is fail-open: read source already holds the object, reconciler heals divergence.
    // Azure has no Object-Lock enforcement, so secondary azure failure is not a lock-protection loss.
    try {
      await this.azure.uploadWormBlob(name, data, type, metadata);
    } catch (e) {
      this.logger.error(
        `DUAL_WRITE_SECONDARY_FAILURE: uploadWormBlob failed on secondary store azure ` +
          `(container=${this.container}, name=${name}); read source is s3, ` +
          `continuing (reconciler gate will heal the divergence before the read flip)`,
        e,
      );
    }
    return s3Url;
  }

  async copyBlobs(sourcePrefix: string, targetPrefix: string): Promise<string[]> {
    const mode = this.getWriteMode();
    if (mode === 'azure') return this.azure.copyBlobs(sourcePrefix, targetPrefix);
    if (mode === 's3') return this.s3.copyBlobs(sourcePrefix, targetPrefix);

    // dual: same order rule as upload (read-source first, fail-closed). Secondary is fail-open
    // and logged. An empty source prefix on one side is a legitimate no-op (returns []) — not
    // an error. Azure/S3 length asymmetry (e.g. source exists only on one side before backfill,
    // or secondary copy failed outright) must not fail closed; log loudly and rely on the
    // mandatory reconciler gate to heal the divergence before the read flip.
    // Returned key list must come from the read-source store that actually holds the copies.
    const readSource = this.getReadSource();
    let s3Result: string[];
    let azureResult: string[];
    if (readSource === 'azure') {
      azureResult = await this.azure.copyBlobs(sourcePrefix, targetPrefix);
      // Secondary write is fail-open: read source already copied, reconciler heals divergence.
      try {
        s3Result = await this.s3.copyBlobs(sourcePrefix, targetPrefix);
      } catch (e) {
        this.logger.error(
          `DUAL_WRITE_SECONDARY_FAILURE: copyBlobs failed on secondary store s3 ` +
            `(container=${this.container}, name=${sourcePrefix} -> ${targetPrefix}); read source is azure, ` +
            `continuing (reconciler gate will heal the divergence before the read flip)`,
          e,
        );
        s3Result = [];
      }
    } else {
      s3Result = await this.s3.copyBlobs(sourcePrefix, targetPrefix);
      // Secondary write is fail-open: read source already copied, reconciler heals divergence.
      try {
        azureResult = await this.azure.copyBlobs(sourcePrefix, targetPrefix);
      } catch (e) {
        this.logger.error(
          `DUAL_WRITE_SECONDARY_FAILURE: copyBlobs failed on secondary store azure ` +
            `(container=${this.container}, name=${sourcePrefix} -> ${targetPrefix}); read source is s3, ` +
            `continuing (reconciler gate will heal the divergence before the read flip)`,
          e,
        );
        azureResult = [];
      }
    }

    if (azureResult.length !== s3Result.length) {
      this.logger.warn(
        `copyBlobs dual-write asymmetry: sourcePrefix=${sourcePrefix} targetPrefix=${targetPrefix} ` +
          `azureCount=${azureResult.length} s3Count=${s3Result.length}; ` +
          `the reconciler gate must heal this divergence before the read flip`,
      );
    }

    return readSource === 'azure' ? azureResult : s3Result;
  }
}
