import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';

export interface Blob {
  name: string;
  contentType: string;
  created: Date;
  updated: Date;
}

export interface BlobContent {
  data: Buffer;
  contentType: string;
}

export class AzureStorageService {
  private readonly blobConnectionString = 'TODO';

  private readonly client: ContainerClient;

  constructor(container: string) {
    this.client = BlobServiceClient.fromConnectionString(this.blobConnectionString).getContainerClient(container);
  }

  async listBlobs(prefix?: string): Promise<Blob[]> {
    const iterator = this.client.listBlobsFlat({ prefix }).byPage({ maxPageSize: 100 });

    const blobs: Blob[] = [];

    let done = false;
    while (!done) {
      const batch = await iterator.next();

      const items: Blob[] = batch.value?.segment?.blobItems?.map((i) => ({
        name: i.name,
        contentType: i.properties.contentType,
        created: i.properties.createdOn,
        updated: i.properties.lastModified,
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

  async uploadBlob(name: string, data: Buffer, type: string) {
    await this.client.getBlockBlobClient(name).uploadData(data, { blobHTTPHeaders: { blobContentType: type } });
  }
}
