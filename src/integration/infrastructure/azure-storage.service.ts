import { BlobGetPropertiesResponse, BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import * as fs from 'fs';
import * as path from 'path';
import { Config, Environment, GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';

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

// In-memory storage for local development
const mockStorage = new Map<string, { data: Buffer; type: string; metadata?: Record<string, string> }>();

// Dummy files directory for local development
const DUMMY_FILES_DIR = path.join(process.cwd(), 'scripts', 'kyc', 'dummy-files');

// Load dummy file from disk
function loadDummyFile(filename: string): Buffer {
  const filePath = path.join(DUMMY_FILES_DIR, filename);
  return fs.readFileSync(filePath);
}

export class AzureStorageService {
  private readonly logger = new DfxLogger(AzureStorageService);
  private readonly client: ContainerClient;
  private readonly isMockMode: boolean;

  constructor(private readonly container: string) {
    const config = GetConfig();
    this.isMockMode = config.environment === Environment.LOC;

    if (this.isMockMode) {
      this.logger.verbose(`AzureStorageService [${container}] running in MOCK mode`);
      return;
    }

    const connectionString = config.azure.storage.connectionString;
    if (connectionString)
      this.client = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(container);
  }

  async listBlobs(prefix?: string): Promise<Blob[]> {
    if (this.isMockMode) {
      const blobs: Blob[] = [];
      const keyPrefix = `${this.container}/${prefix ?? ''}`;
      for (const [key, value] of mockStorage.entries()) {
        if (key.startsWith(keyPrefix)) {
          const name = key.replace(`${this.container}/`, '');
          blobs.push({
            name,
            url: this.blobUrl(name),
            contentType: value.type,
            created: new Date(),
            updated: new Date(),
            metadata: value.metadata ?? {},
          });
        }
      }
      return blobs;
    }

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
    if (this.isMockMode) {
      const key = `${this.container}/${name}`;
      const stored = mockStorage.get(key);

      // Return stored data if available, otherwise return dummy test data based on file extension
      if (stored) {
        return {
          data: stored.data,
          contentType: stored.type,
          created: new Date(),
          updated: new Date(),
          metadata: stored.metadata ?? {},
        };
      }

      // Provide dummy data for missing files in local dev mode
      const ext = name.split('.').pop()?.toLowerCase();
      const filename = name.split('/').pop() ?? name;

      // Map common KYC file names to dummy files
      const dummyFileMap: Record<string, { file: string; type: string }> = {
        'id_front.png': { file: 'id_front.png', type: 'image/png' },
        'id_back.png': { file: 'id_back.png', type: 'image/png' },
        'selfie.jpg': { file: 'selfie.jpg', type: 'image/jpeg' },
        'passport.png': { file: 'passport.png', type: 'image/png' },
        'residence_permit.png': { file: 'residence_permit.png', type: 'image/png' },
        'proof_of_address.pdf': { file: 'proof_of_address.pdf', type: 'application/pdf' },
        'bank_statement.pdf': { file: 'bank_statement.pdf', type: 'application/pdf' },
        'source_of_funds.pdf': { file: 'source_of_funds.pdf', type: 'application/pdf' },
        'commercial_register.pdf': { file: 'commercial_register.pdf', type: 'application/pdf' },
        'additional_document.pdf': { file: 'additional_document.pdf', type: 'application/pdf' },
      };

      const mapping = dummyFileMap[filename];
      if (mapping) {
        return {
          data: loadDummyFile(mapping.file),
          contentType: mapping.type,
          created: new Date(),
          updated: new Date(),
          metadata: {},
        };
      }

      // Fallback based on extension
      const isJpg = ext === 'jpg' || ext === 'jpeg';
      const isPdf = ext === 'pdf';
      return {
        data: loadDummyFile(isPdf ? 'proof_of_address.pdf' : isJpg ? 'selfie.jpg' : 'id_front.png'),
        contentType: isPdf ? 'application/pdf' : isJpg ? 'image/jpeg' : 'image/png',
        created: new Date(),
        updated: new Date(),
        metadata: {},
      };
    }

    const blobClient = this.client.getBlockBlobClient(name);
    const properties = await blobClient.getProperties();
    return {
      ...this.mapProperties(properties),
      data: await blobClient.downloadToBuffer(),
    };
  }

  async uploadBlob(name: string, data: Buffer, type: string, metadata?: Record<string, string>): Promise<string> {
    if (this.isMockMode) {
      const key = `${this.container}/${name}`;
      mockStorage.set(key, { data, type, metadata });
      this.logger.verbose(`Mock: Uploaded ${key} (${data.length} bytes)`);
      return this.blobUrl(name);
    }

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
