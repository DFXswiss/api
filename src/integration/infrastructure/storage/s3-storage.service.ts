import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Config } from 'src/config/config';
import { Blob, BlobContent, BlobMetaData, StorageService } from './storage.service';

/**
 * S3-protocol storage implementation. Talks to the configured S3-compatible
 * endpoint (on-prem MinIO today; any S3 store via `Config.s3.endpoint`) — this is a
 * protocol client, not the AWS cloud: no AWS account, no data leaves to AWS.
 *
 * Replaces AzureStorageService. The blob URL shape is kept identical so `blobName()`
 * stays reversible and URLs persisted in the DB remain consistent after migration.
 *
 * WORM / Object-Lock is expected to be enforced server-side via the bucket's default
 * retention (Compliance mode), provisioned externally at bucket setup — see the infra
 * RFC. It is intentionally not applied per request here.
 */
export class S3StorageService extends StorageService {
  private readonly client: S3Client;

  constructor(container: string) {
    super(container);

    const { endpoint, region, accessKey, secretKey, publicUrl } = Config.s3;
    if (!endpoint || !region || !accessKey || !secretKey || !publicUrl)
      throw new Error('Incomplete S3 config: endpoint, region, accessKey, secretKey and publicUrl are required');
    if (!publicUrl.endsWith('/')) throw new Error('S3 publicUrl must end with a trailing slash');

    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true, // MinIO requires path-style addressing
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });
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

  async copyBlobs(sourcePrefix: string, targetPrefix: string): Promise<void> {
    // copy needs only the keys, not metadata — avoid the per-object HeadObject fan-out.
    const keys = await this.listKeys(sourcePrefix);

    for (const key of keys) {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.container,
          Key: key.replace(sourcePrefix, targetPrefix),
          CopySource: `${this.container}/${this.encodeKey(key)}`, // key must be URL-encoded
        }),
      );
    }
  }

  private async listKeys(prefix?: string): Promise<string[]> {
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
