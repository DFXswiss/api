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
 *   - kyc-document.service.ts   (constructed at boot, before ConfigService has run)
 *   - support-document.service.ts (constructed at boot, before ConfigService has run)
 *   - fiat-output-job.service.ts (per-job, runtime EP2 container)
 * The KYC/support providers construct their S3StorageService eagerly in their own
 * constructors, which happens before ConfigService has initialized the `Config` singleton.
 * S3StorageService therefore validates its S3 config lazily, on the first storage call,
 * rather than at construction — validating eagerly would crash application boot. An
 * incomplete S3 config consequently fails on the first storage call, not at app boot.
 */
export function createStorageService(container: string): StorageService {
  return GetConfig().environment === Environment.LOC
    ? new MockStorageService(container)
    : new S3StorageService(container);
}
