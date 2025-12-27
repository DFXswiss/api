import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class MockStorageService {
  private readonly logger = new DfxLogger(MockStorageService);
  private readonly storage = new Map<string, Buffer>();

  async uploadFile(
    container: string,
    fileName: string,
    data: Buffer,
    _contentType?: string,
  ): Promise<string> {
    const key = `${container}/${fileName}`;
    this.storage.set(key, data);
    this.logger.verbose(`Mock: Uploaded ${key} (${data.length} bytes)`);
    return `mock://storage/${key}`;
  }

  async downloadFile(container: string, fileName: string): Promise<Buffer | undefined> {
    const key = `${container}/${fileName}`;
    const data = this.storage.get(key);
    this.logger.verbose(`Mock: Downloaded ${key} (${data?.length ?? 0} bytes)`);
    return data;
  }

  async deleteFile(container: string, fileName: string): Promise<void> {
    const key = `${container}/${fileName}`;
    this.storage.delete(key);
    this.logger.verbose(`Mock: Deleted ${key}`);
  }

  async listFiles(container: string, prefix?: string): Promise<string[]> {
    const files = Array.from(this.storage.keys())
      .filter((key) => key.startsWith(container))
      .filter((key) => !prefix || key.includes(prefix))
      .map((key) => key.replace(`${container}/`, ''));

    this.logger.verbose(`Mock: Listed ${files.length} files in ${container}`);
    return files;
  }

  async fileExists(container: string, fileName: string): Promise<boolean> {
    const key = `${container}/${fileName}`;
    return this.storage.has(key);
  }
}
