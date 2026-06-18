import { Environment, GetConfig } from 'src/config/config';
import { MockStorageService } from './mock-storage.service';
import { S3StorageService } from './s3-storage.service';
import { StorageService } from './storage.service';

/**
 * Returns the configured storage implementation for a bucket/container.
 *
 * Deliberately a factory function rather than a DI provider: instances are
 * per-container and some containers are resolved at runtime (e.g. the per-merchant
 * EP2 settlement container in fiat-output), which a singleton provider can't express.
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
