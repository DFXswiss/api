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
import { Blob, BlobContent, BlobMetaData, KeyDate, StorageService } from './storage.service';
import { GEBUEV_RETENTION_FLOOR_DAYS, GEBUEV_RETENTION_FLOOR_YEARS } from './worm-retention.const';

/** Validated bucket default retention; unit matches what the bucket returned (Years or Days). */
type ValidatedWormRetention = { unit: 'Years'; value: number } | { unit: 'Days'; value: number };

/**
 * S3-protocol storage implementation. Talks to the configured S3-compatible
 * endpoint (on-prem MinIO today; any S3 store via `Config.s3.endpoint`) — this is a
 * protocol client, not the AWS cloud: no AWS account, no data leaves to AWS.
 *
 * Replaces AzureStorageService. The blob URL shape is kept identical so `blobName()`
 * stays reversible and URLs persisted in the DB remain consistent after migration.
 *
 * WORM writes (`uploadWormBlob`) attach per-object COMPLIANCE retention that mirrors
 * the bucket's validated default retention (Years floor-clamped to
 * `GEBUEV_RETENTION_FLOOR_YEARS`, or Days floor-clamped to `GEBUEV_RETENTION_FLOOR_DAYS`).
 * An explicit per-object retention overrides the bucket default, so it must never be
 * shorter than that validated default. Bucket-level Object Lock is still verified as
 * defense in depth.
 */
export class S3StorageService extends StorageService {
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
  // we refuse rather than under-protect. Every WORM PUT also sets per-object COMPLIANCE
  // retention mirroring the bucket's validated default (Years or Days, floor-clamped in the
  // same unit): an explicit per-object retention overrides the bucket default, so it must never
  // be shorter than that validated default.
  //
  // Deliberate residual: probing then writing leaves a sub-millisecond window in which a bucket
  // default RAISED between probe and PUT is not mirrored, so the object carries the previously
  // validated period. That is accepted because the alternatives are worse — dropping the explicit
  // retention reopens the dangerous case (a WEAKENED default silently under-protecting records),
  // and pinning every record to the provisioning ceiling would irreversibly over-retain all
  // compliance data. The worst case here still satisfies the GeBüV floor and stays extendable.
  async uploadWormBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string> {
    const validated = await this.assertObjectLockEnabled();

    // Retain-until is computed from client time. Add one day so request latency or clock skew
    // can never make the explicit per-object date shorter than a server-side default derived
    // from the same period. Over-retaining by a day is harmless; COMPLIANCE retention is
    // extend-only. Years use calendar-year arithmetic; Days use calendar-day arithmetic —
    // never convert between units with a flat 365-day year.
    const retainUntil = new Date();
    if (validated.unit === 'Years') {
      const retainYears = Math.max(validated.value, GEBUEV_RETENTION_FLOOR_YEARS);
      retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + retainYears);
    } else {
      const retainDays = Math.max(validated.value, GEBUEV_RETENTION_FLOOR_DAYS);
      retainUntil.setUTCDate(retainUntil.getUTCDate() + retainDays);
    }
    retainUntil.setUTCDate(retainUntil.getUTCDate() + 1);

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

  /**
   * Verifies Object Lock + COMPLIANCE default retention; returns the validated duration in the
   * unit the bucket supplied (`Years` or `Days`). Accepts Years >= GeBüV year floor or
   * Days >= GeBüV day floor (MinIO often returns Days for a multi-year default).
   *
   * Always probes the live bucket config — no TTL cache. Called only from WORM paths
   * (`uploadWormBlob`, and `copyBlobs` which shares the same fail-closed guard); those are
   * low-volume compliance writes, so one probe per write is the correct trade-off. It also
   * means a bucket-side weakening (or a raised default that must be mirrored on the next
   * per-object retention) is never masked at all, not just after a TTL.
   */
  private async assertObjectLockEnabled(): Promise<ValidatedWormRetention> {
    let cfg:
      | {
          ObjectLockEnabled?: string;
          Rule?: { DefaultRetention?: { Mode?: string; Years?: number; Days?: number } };
        }
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
    const days = retention?.Days;
    const yearsOk =
      years != null &&
      days == null &&
      Number.isFinite(years) &&
      Number.isInteger(years) &&
      years > 0 &&
      years >= GEBUEV_RETENTION_FLOOR_YEARS;
    const daysOk =
      days != null &&
      years == null &&
      Number.isFinite(days) &&
      Number.isInteger(days) &&
      days > 0 &&
      days >= GEBUEV_RETENTION_FLOOR_DAYS;
    const isValid =
      cfg?.ObjectLockEnabled === 'Enabled' &&
      retention?.Mode === ObjectLockRetentionMode.COMPLIANCE &&
      (yearsOk || daysOk);

    if (!isValid)
      throw new Error(
        `Refusing WORM write into bucket "${this.container}": Object Lock is not enabled with a COMPLIANCE-mode ` +
          `default retention of at least ${GEBUEV_RETENTION_FLOOR_YEARS} year(s) or ${GEBUEV_RETENTION_FLOOR_DAYS} day(s) ` +
          `(got ObjectLockEnabled=${cfg?.ObjectLockEnabled}, Mode=${retention?.Mode}, Years=${years}, Days=${days}). ` +
          `GeBüV compliance records must be WORM-protected and Object Lock cannot be retro-fitted onto an existing bucket. ` +
          `Provision it first (scripts/storage/provision-bucket.ts).`,
      );

    if (yearsOk) return { unit: 'Years', value: years };
    return { unit: 'Days', value: days as number };
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

  // S3 has no creation timestamp, so `LastModified` is the only date there is - and the listing
  // carries it, which is what keeps this to one request per page rather than one per object.
  async listKeyDates(prefix?: string): Promise<KeyDate[]> {
    const keys: KeyDate[] = [];

    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.container, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
      );

      for (const o of res.Contents ?? []) if (o.Key) keys.push({ key: o.Key, created: o.LastModified });

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
