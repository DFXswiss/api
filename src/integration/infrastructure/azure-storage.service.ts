import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { Config, GetConfig } from 'src/config/config';

export interface Blob {
  name: string;
  url: string;
  contentType: string;
  created: Date;
  updated: Date;
  metadata: Record<string, string>;
}

export interface BlobContent {
  data: Buffer;
  contentType: string;
}

export class AzureStorageService {
  private readonly client: ContainerClient;

  constructor(private readonly container: string) {
    this.client = BlobServiceClient.fromConnectionString(GetConfig().azure.storage.connectionString).getContainerClient(
      container,
    );
  }

  async listBlobs(prefix?: string): Promise<Blob[]> {
    const iterator = this.client.listBlobsFlat({ prefix, includeMetadata: true }).byPage({ maxPageSize: 100 });

    const blobs: Blob[] = [];

    let done = false;
    while (!done) {
      const batch = await iterator.next();

      const items: Blob[] = batch.value?.segment?.blobItems?.map((i) => ({
        name: i.name,
        url: this.blobUrl(i.name),
        contentType: i.properties.contentType,
        created: i.properties.createdOn,
        updated: i.properties.lastModified,
        metadata: i.metadata,
      }));
      if (items) blobs.push(...items);

      done = batch.done;
    }

    return blobs;
  }

  async getBlob(name: string): Promise<BlobContent> {
    const blobClient = this.client.getBlockBlobClient(name);
    const { contentType } = await blobClient.getProperties();
    return { contentType: contentType, data: await blobClient.downloadToBuffer() };
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

  private blobUrl(name: string): string {
    const urlEncodedName = name
      .split('/')
      .map((p) => encodeURIComponent(p))
      .join('/');
    return `${Config.azure.storage.url}${this.container}/${urlEncodedName}`;
  }
}
