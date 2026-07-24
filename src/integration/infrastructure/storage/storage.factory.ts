import { Environment, GetConfig } from 'src/config/config';
import { AzureStorageService } from './azure-storage.service';
import { CompositeStorageService } from './composite-storage.service';
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
 *
 * Branching (non-LOC):
 *   - STORAGE_WRITE_MODE=azure → AzureStorageService only
 *   - STORAGE_WRITE_MODE=dual  → CompositeStorageService (fail-closed dual-write; reads from
 *     STORAGE_READ_SOURCE)
 *   - STORAGE_WRITE_MODE=s3    → S3StorageService only
 * Accessing `cfg.storage.writeMode` triggers the full config validation (format of both
 * migration env vars + invalid-combo check) before branching — a broken migration-mode
 * selector must crash app boot loudly, not silently pick a class.
 *
 * The KYC/support providers construct their storage service eagerly in their own
 * constructors, which happens before ConfigService has initialized the `Config` singleton.
 * Backend constructors therefore validate credentials lazily, on the first storage call,
 * rather than at construction — validating eagerly would crash application boot. Incomplete
 * S3/Azure credentials consequently fail on the first storage call, not at app boot. The
 * migration-mode selector itself is the exception: it is validated eagerly here so a bad
 * cutover config never boots into a half-configured state.
 */
export function createStorageService(container: string): StorageService {
  // Fresh read from process.env — same boot-safety pattern as the environment check below;
  // do NOT use the mutable Config singleton here, since KYC/Support construct their storage
  // service before Nest's ConfigService (which sets Config) may have run.
  const cfg = GetConfig();
  if (cfg.environment === Environment.LOC) return new MockStorageService(container);

  switch (cfg.storage.writeMode) {
    case 'dual':
      return new CompositeStorageService(container);
    case 's3':
      return new S3StorageService(container);
    case 'azure':
      return new AzureStorageService(container);
  }
}
