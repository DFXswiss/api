import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Blob, BlobContent, StorageService } from './storage.service';

/**
 * S3-compatible storage implementation (MinIO).
 *
 * Replaces AzureStorageService. The blob URL shape is kept identical
 * (`<publicUrl><container>/<encoded name>`) so that `blobName()` stays
 * reversible and any URL persisted in the DB remains consistent after migration.
 */
export class S3StorageService extends StorageService {
  private readonly logger = new DfxLogger(S3StorageService);
  private readonly client: S3Client;

  constructor(private readonly container: string) {
    super();

    const { endpoint, region, accessKey, secretKey } = Config.s3;
    this.client = new S3Client({
      endpoint, // MinIO endpoint (per-env, via compose)
      region,
      forcePathStyle: true, // MinIO requires path-style addressing
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });
  }

  async listBlobs(prefix?: string): Promise<Blob[]> {
    const blobs: Blob[] = [];

    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.container, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
      );

      for (const o of res.Contents ?? []) {
        // ListObjectsV2 returns no content-type/user-metadata; HeadObject per key only if a
        // consumer actually needs them (today's callers use name + url).
        blobs.push({
          name: o.Key,
          url: this.blobUrl(o.Key),
          contentType: undefined,
          created: o.LastModified,
          updated: o.LastModified,
          metadata: {},
        });
      }

      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    return blobs;
  }

  async getBlob(name: string): Promise<BlobContent> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.container, Key: name }));

    return {
      data: Buffer.from(await res.Body.transformToByteArray()),
      contentType: res.ContentType,
      created: res.LastModified,
      updated: res.LastModified,
      metadata: res.Metadata,
    };
  }

  async uploadBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.container,
        Key: name,
        Body: data,
        ContentType: type,
        Metadata: metadata,
        ...this.objectLock(), // WORM for compliance buckets
      }),
    );

    return this.blobUrl(name);
  }

  async copyBlobs(sourcePrefix: string, targetPrefix: string): Promise<void> {
    const blobs = await this.listBlobs(sourcePrefix);

    for (const blob of blobs) {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.container,
          Key: blob.name.replace(sourcePrefix, targetPrefix),
          CopySource: `${this.container}/${blob.name}`,
          ...this.objectLock(),
        }),
      );
    }
  }

  blobUrl(name: string): string {
    const urlEncodedName = name.split('/').map(encodeURIComponent).join('/');
    return `${Config.s3.publicUrl}${this.container}/${urlEncodedName}`;
  }

  blobName(url: string): string {
    const filePath = url.split(`${this.container}/`)[1];
    return filePath.split('/').map(decodeURIComponent).join('/');
  }

  /**
   * Compliance buckets get a defined retention (extendable, never shortenable).
   * NOTE: EP2 settlement containers are created dynamically per merchant — if those
   * must be WORM too, match by pattern/prefix here instead of an exact bucket list.
   */
  private objectLock(): { ObjectLockMode?: 'COMPLIANCE'; ObjectLockRetainUntilDate?: Date } {
    if (!Config.s3.complianceBuckets.includes(this.container)) return {};

    const retainUntil = new Date();
    retainUntil.setDate(retainUntil.getDate() + Config.s3.retentionDays);
    return { ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: retainUntil };
  }
}
