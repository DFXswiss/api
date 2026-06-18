import { Environment, GetConfig } from 'src/config/config';
import { MockStorageService } from './mock-storage.service';
import { S3StorageService } from './s3-storage.service';
import { StorageService } from './storage.service';

/**
 * Returns the configured storage implementation for a bucket/container.
 *
 * Drop-in replacement for `new AzureStorageService(container)` at the call sites:
 *   - kyc-document.service.ts
 *   - support-document.service.ts
 *   - fiat-output-job.service.ts
 */
export function createStorageService(container: string): StorageService {
  return GetConfig().environment === Environment.LOC
    ? new MockStorageService(container)
    : new S3StorageService(container);
}
