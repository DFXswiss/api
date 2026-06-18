import * as fs from 'fs';
import * as path from 'path';
import { Blob, BlobContent, StorageService } from './storage.service';

// In-memory storage for local development (LOC).
const mockStorage = new Map<string, { data: Buffer; type: string; metadata?: Record<string, string> }>();

// Dummy KYC files for local development (used when a blob was not uploaded this process lifetime).
const DUMMY_FILES_DIR = path.join(process.cwd(), 'scripts', 'kyc', 'dummy-files');
const DUMMY_FILE_MAP: Record<string, { file: string; type: string }> = {
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

function loadDummyFile(filename: string): Buffer {
  return fs.readFileSync(path.join(DUMMY_FILES_DIR, filename));
}

export class MockStorageService extends StorageService {
  constructor(container: string) {
    super(container);
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
    if (stored)
      return {
        data: stored.data,
        contentType: stored.type,
        created: new Date(),
        updated: new Date(),
        metadata: stored.metadata ?? {},
      };

    // Fallback to a dummy file (parity with the previous mock) so LOC document reads return bytes.
    const fileName = name.split('/').pop() ?? name;
    const mapping = DUMMY_FILE_MAP[fileName];
    if (mapping)
      return {
        data: loadDummyFile(mapping.file),
        contentType: mapping.type,
        created: new Date(),
        updated: new Date(),
        metadata: {},
      };

    const ext = name.split('.').pop()?.toLowerCase();
    const isPdf = ext === 'pdf';
    const isJpg = ext === 'jpg' || ext === 'jpeg';
    return {
      data: loadDummyFile(isPdf ? 'proof_of_address.pdf' : isJpg ? 'selfie.jpg' : 'id_front.png'),
      contentType: isPdf ? 'application/pdf' : isJpg ? 'image/jpeg' : 'image/png',
      created: new Date(),
      updated: new Date(),
      metadata: {},
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
}
