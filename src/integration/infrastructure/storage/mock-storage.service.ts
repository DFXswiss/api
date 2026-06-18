import { Config } from 'src/config/config';
import { Blob, BlobContent, StorageService } from './storage.service';

/**
 * In-memory storage for local development (LOC), ported from the previous
 * AzureStorageService mock mode. The dummy-file fallback for KYC demo files
 * (scripts/kyc/dummy-files) can be carried over here unchanged if still needed.
 */
const mockStorage = new Map<string, { data: Buffer; type: string; metadata?: Record<string, string> }>();

export class MockStorageService extends StorageService {
  constructor(private readonly container: string) {
    super();
  }

  async listBlobs(prefix?: string): Promise<Blob[]> {
    const keyPrefix = `${this.container}/${prefix ?? ''}`;

    return [...mockStorage.entries()]
      .filter(([key]) => key.startsWith(keyPrefix))
      .map(([key, value]) => {
        const name = key.replace(`${this.container}/`, '');
        return {
          name,
          url: this.blobUrl(name),
          contentType: value.type,
          created: new Date(),
          updated: new Date(),
          metadata: value.metadata ?? {},
        };
      });
  }

  async getBlob(name: string): Promise<BlobContent> {
    const stored = mockStorage.get(`${this.container}/${name}`);
    return {
      data: stored?.data,
      contentType: stored?.type,
      created: new Date(),
      updated: new Date(),
      metadata: stored?.metadata ?? {},
    };
  }

  async uploadBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string> {
    mockStorage.set(`${this.container}/${name}`, { data, type, metadata });
    return this.blobUrl(name);
  }

  async copyBlobs(sourcePrefix: string, targetPrefix: string): Promise<void> {
    for (const blob of await this.listBlobs(sourcePrefix)) {
      const content = await this.getBlob(blob.name);
      await this.uploadBlob(
        blob.name.replace(sourcePrefix, targetPrefix),
        content.data,
        content.contentType,
        blob.metadata,
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
}
