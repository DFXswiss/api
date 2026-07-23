import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { Config } from 'src/config/config';
import { Blob, BlobContent, BlobMetaData, StorageService } from './storage.service';

/**
 * Azure Blob storage implementation. Talks to Azure Storage via a connection string
 * (`Config.azure.storage.connectionString`). Used during the Azure→MinIO dual-write cutover
 * as the legacy backend — see CompositeStorageService / createStorageService.
 *
 * Client construction is fully lazy (mirrors S3StorageService): the constructor reads nothing
 * from Config, so eager construction at boot (KYC/Support) cannot crash on incomplete Azure
 * credentials. The first I/O call builds and memoizes the SDK client and fails loud if the
 * connection string is missing.
 *
 * LOC is handled exclusively by MockStorageService via the factory — this class must never run
 * in LOC and contains no mock/dummy-file logic.
 *
 * WORM / Object Lock is not available on Azure Blob the way MinIO enforces it. `uploadWormBlob`
 * therefore inherits the base-class default (delegates to `uploadBlob` with no lock check).
 */
export class AzureStorageService extends StorageService {
  private _client?: ContainerClient;

  constructor(container: string) {
    super(container);
  }

  private get client(): ContainerClient {
    if (!this._client) {
      const { connectionString } = Config.azure.storage;
      if (!connectionString) throw new Error('Incomplete Azure config: connectionString is required');
      this._client = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(this.container);
    }
    return this._client;
  }

  async listBlobs(prefix?: string): Promise<Blob[]> {
    const iterator = this.client.listBlobsFlat({ prefix, includeMetadata: true }).byPage({ maxPageSize: 100 });

    const blobs: Blob[] = [];

    let done = false;
    while (!done) {
      const batch = await iterator.next();

      const items: Blob[] = batch.value?.segment?.blobItems?.map((i) => ({
        ...this.mapProperties(i.properties),
        name: i.name,
        url: this.blobUrl(i.name),
        metadata: i.metadata,
      }));
      if (items) blobs.push(...items);

      done = batch.done;
    }

    return blobs;
  }

  async listKeys(prefix?: string): Promise<string[]> {
    const iterator = this.client.listBlobsFlat({ prefix }).byPage({ maxPageSize: 100 });

    const keys: string[] = [];

    let done = false;
    while (!done) {
      const batch = await iterator.next();

      const items: string[] | undefined = batch.value?.segment?.blobItems?.map((i) => i.name);
      if (items) keys.push(...items);

      done = batch.done;
    }

    return keys;
  }

  async getBlob(name: string): Promise<BlobContent> {
    const blobClient = this.client.getBlockBlobClient(name);
    const properties = await blobClient.getProperties();
    return {
      ...this.mapProperties(properties),
      data: await blobClient.downloadToBuffer(),
    };
  }

  async uploadBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string> {
    await this.client
      .getBlockBlobClient(name)
      .uploadData(data, { blobHTTPHeaders: { blobContentType: type }, metadata: !metadata ? undefined : metadata });

    return this.blobUrl(name);
  }

  async copyBlobs(sourcePrefix: string, targetPrefix: string): Promise<string[]> {
    const blobs = await this.listBlobs(sourcePrefix);
    const targetKeys: string[] = [];

    for (const blob of blobs) {
      const data = await this.getBlob(blob.name);
      const targetName = blob.name.replace(sourcePrefix, targetPrefix);
      await this.uploadBlob(targetName, data.data, data.contentType, blob.metadata);
      targetKeys.push(targetName);
    }

    return targetKeys;
  }

  blobUrl(name: string): string {
    return `${Config.azure.storage.url}${this.container}/${this.encodeKey(name)}`;
  }

  blobName(url: string): string {
    const filePath = url.split(`${this.container}/`)[1];
    if (filePath == null) throw new Error(`URL does not belong to container ${this.container}: ${url}`);
    return filePath.split('/').map(decodeURIComponent).join('/');
  }

  // Shared shape for getProperties() and listBlobsFlat item properties (both expose contentType /
  // createdOn / lastModified / metadata under these names).
  private mapProperties(properties: {
    contentType?: string;
    createdOn?: Date;
    lastModified?: Date;
    metadata?: Record<string, string>;
  }): BlobMetaData {
    return {
      contentType: properties.contentType,
      created: properties.createdOn,
      updated: properties.lastModified,
      metadata: properties.metadata,
    };
  }
}
