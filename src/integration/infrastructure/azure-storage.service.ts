import { BlobGetPropertiesResponse, BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { Config, GetConfig } from 'src/config/config';

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

export class AzureStorageService {
  private readonly client: ContainerClient;

  constructor(private readonly container: string) {
    const connectionString = GetConfig().azure.storage.connectionString;

    if (connectionString)
      this.client = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(container);
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

  async copyBlobs(sourcePrefix: string, targetPrefix: string): Promise<void> {
    const blobs = await this.listBlobs(sourcePrefix);

    for (const blob of blobs) {
      const data = await this.getBlob(blob.name);
      const targetName = blob.name.replace(sourcePrefix, targetPrefix);
      await this.uploadBlob(targetName, data.data, data.contentType, blob.metadata);
    }
  }

  blobUrl(name: string): string {
    const urlEncodedName = name.split('/').map(encodeURIComponent).join('/');
    return `${Config.azure.storage.url}${this.container}/${urlEncodedName}`;
  }

  blobName(url: string): string {
    const filePath = url.split(`${this.container}/`)[1];
    return filePath.split('/').map(decodeURIComponent).join('/');
  }

  private mapProperties(properties: BlobGetPropertiesResponse): BlobMetaData {
    return {
      contentType: properties.contentType,
      created: properties.createdOn,
      updated: properties.lastModified,
      metadata: properties.metadata,
    };
  }
}
