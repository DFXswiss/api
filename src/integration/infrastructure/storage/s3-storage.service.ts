import {
  CopyObjectCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ObjectLockRetentionMode,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Config } from 'src/config/config';
import { Blob, BlobContent, BlobMetaData, StorageService } from './storage.service';
import { GEBUEV_RETENTION_FLOOR_YEARS } from './worm-retention.const';

/**
 * S3-protocol storage implementation. Talks to the configured S3-compatible
 * endpoint (on-prem MinIO today; any S3 store via `Config.s3.endpoint`) — this is a
 * protocol client, not the AWS cloud: no AWS account, no data leaves to AWS.
 *
 * Replaces AzureStorageService. The blob URL shape is kept identical so `blobName()`
 * stays reversible and URLs persisted in the DB remain consistent after migration.
 *
 * WORM writes (`uploadWormBlob`) attach per-object COMPLIANCE retention that mirrors
 * the bucket's validated default retention years (floor-clamped to
 * `GEBUEV_RETENTION_FLOOR_YEARS`). An explicit per-object retention overrides the
 * bucket default, so it must never be shorter than that validated default.
 * Bucket-level Object Lock is still verified as defense in depth.
 */
export class S3StorageService extends StorageService {
  // Containers verified to have Object Lock enabled: last successful probe timestamp plus the
  // validated DefaultRetention.Years from that probe. Static so the check is amortized across
  // the short-lived per-container instances the EP2 sink creates (createStorageService per
  // report). Re-verified after TTL so a later bucket-side retention weakening is not masked
  // for the rest of the process lifetime. Years are cached with the timestamp so WORM PUTs
  // can reuse them on a cache hit without re-probing.
  private static readonly objectLockVerified = new Map<string, { verifiedAt: number; years: number }>();
  private static readonly OBJECT_LOCK_VERIFY_TTL_MS = 5 * 60 * 1000;

  private _client?: S3Client;

  constructor(container: string) {
    super(container);
  }

  private get client(): S3Client {
    if (!this._client) {
      const { endpoint, region, accessKey, secretKey, publicUrl } = Config.s3;
      if (!endpoint || !region || !accessKey || !secretKey || !publicUrl)
        throw new Error('Incomplete S3 config: endpoint, region, accessKey, secretKey and publicUrl are required');
      if (!publicUrl.endsWith('/')) throw new Error('S3 publicUrl must end with a trailing slash');

      this._client = new S3Client({
        endpoint,
        region,
        forcePathStyle: true, // MinIO requires path-style addressing
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      });
    }
    return this._client;
  }

  async listBlobs(prefix?: string): Promise<Blob[]> {
    // S3 listings carry no content-type / user metadata (unlike the Azure listing this
    // replaces), so fetch per object. Per-prefix counts are modest (per-user KYC/support).
    const keys = await this.listKeys(prefix);
    return Promise.all(keys.map((key) => this.head(key)));
  }

  async getBlob(name: string): Promise<BlobContent> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.container, Key: name }));
    if (!res.Body) throw new Error(`Empty body for blob ${this.container}/${name}`);

    return { data: Buffer.from(await res.Body.transformToByteArray()), ...this.toMetaData(res) };
  }

  async uploadBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.container, Key: name, Body: data, ContentType: type, Metadata: metadata }),
    );

    return this.blobUrl(name);
  }

  // WORM sink (GeBüV): fail closed unless the target bucket enforces Object Lock (defense in
  // depth). Object Lock cannot be retro-fitted onto an existing bucket, so writing a compliance
  // record into a non-locked (or unverifiable) bucket would leave it mutable/deletable forever —
  // we refuse rather than under-protect. Verified per container with a short TTL. Every WORM PUT
  // also sets per-object COMPLIANCE retention mirroring the bucket's validated default years
  // (floor-clamped): an explicit per-object retention overrides the bucket default, so it must
  // never be shorter than that validated default.
  async uploadWormBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string> {
    const validatedBucketYears = await this.assertObjectLockEnabled();
    const retainYears = Math.max(validatedBucketYears, GEBUEV_RETENTION_FLOOR_YEARS);

    const retainUntil = new Date();
    retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + retainYears);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.container,
        Key: name,
        Body: data,
        ContentType: type,
        Metadata: metadata,
        ObjectLockMode: ObjectLockRetentionMode.COMPLIANCE,
        ObjectLockRetainUntilDate: retainUntil,
      }),
    );

    return this.blobUrl(name);
  }

  /** Verifies Object Lock + COMPLIANCE default retention; returns the validated default years. */
  private async assertObjectLockEnabled(): Promise<number> {
    const cached = S3StorageService.objectLockVerified.get(this.container);
    if (cached != null && Date.now() - cached.verifiedAt < S3StorageService.OBJECT_LOCK_VERIFY_TTL_MS) {
      if (cached.years == null || !(cached.years >= GEBUEV_RETENTION_FLOOR_YEARS))
        throw new Error(
          `Refusing WORM write into bucket "${this.container}": cached Object Lock retention years are unavailable ` +
            `or below the floor (got Years=${cached.years}). GeBüV compliance records must not be written without a ` +
            `validated retention period.`,
        );
      return cached.years;
    }

    let cfg:
      | { ObjectLockEnabled?: string; Rule?: { DefaultRetention?: { Mode?: string; Years?: number } } }
      | undefined;
    try {
      const res = await this.client.send(new GetObjectLockConfigurationCommand({ Bucket: this.container }));
      cfg = res.ObjectLockConfiguration;
    } catch (e) {
      // A bucket without Object Lock returns ObjectLockConfigurationNotFoundError; any other error
      // (missing bucket, transport, auth) is equally unverifiable. Either way, fail closed.
      throw new Error(
        `Refusing WORM write into bucket "${this.container}": could not verify Object Lock is enabled ` +
          `(${e?.name ?? 'error'}: ${e?.message ?? e}). GeBüV compliance records must not be written into ` +
          `an unverified bucket. Provision it first (scripts/storage/provision-bucket.ts).`,
      );
    }

    const retention = cfg?.Rule?.DefaultRetention;
    const years = retention?.Years;
    const isValid =
      cfg?.ObjectLockEnabled === 'Enabled' &&
      retention?.Mode === ObjectLockRetentionMode.COMPLIANCE &&
      years != null &&
      years >= GEBUEV_RETENTION_FLOOR_YEARS;

    if (!isValid || years == null)
      throw new Error(
        `Refusing WORM write into bucket "${this.container}": Object Lock is not enabled with a COMPLIANCE-mode ` +
          `default retention of at least ${GEBUEV_RETENTION_FLOOR_YEARS} year(s) (got ObjectLockEnabled=` +
          `${cfg?.ObjectLockEnabled}, Mode=${retention?.Mode}, Years=${years}). GeBüV compliance ` +
          `records must be WORM-protected and Object Lock cannot be retro-fitted onto an existing bucket. ` +
          `Provision it first (scripts/storage/provision-bucket.ts).`,
      );

    S3StorageService.objectLockVerified.set(this.container, { verifiedAt: Date.now(), years });
    return years;
  }

  async copyBlobs(sourcePrefix: string, targetPrefix: string): Promise<string[]> {
    await this.assertObjectLockEnabled();
    // copy needs only the keys, not metadata — avoid the per-object HeadObject fan-out.
    const keys = await this.listKeys(sourcePrefix);
    const targetKeys: string[] = [];

    for (const key of keys) {
      const targetKey = key.replace(sourcePrefix, targetPrefix);
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.container,
          Key: targetKey,
          CopySource: `${this.container}/${this.encodeKey(key)}`, // key must be URL-encoded
        }),
      );
      targetKeys.push(targetKey);
    }

    return targetKeys;
  }

  async listKeys(prefix?: string): Promise<string[]> {
    const keys: string[] = [];

    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.container, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
      );

      for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);

      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    return keys;
  }

  private async head(name: string): Promise<Blob> {
    const res = await this.client.send(new HeadObjectCommand({ Bucket: this.container, Key: name }));
    return { name, url: this.blobUrl(name), ...this.toMetaData(res) };
  }

  // NOTE: S3 has no creation timestamp (created == updated == LastModified) and lowercases
  // user-metadata keys. contentType/timestamps are always present for objects we write
  // (ContentType is always set on upload).
  private toMetaData(res: {
    ContentType?: string;
    LastModified?: Date;
    Metadata?: Record<string, string>;
  }): BlobMetaData {
    return {
      contentType: res.ContentType,
      created: res.LastModified,
      updated: res.LastModified,
      metadata: res.Metadata ?? {},
    };
  }
}
