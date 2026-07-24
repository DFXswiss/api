/**
 * Swiss GeBüV requires business records to be retained for 10 years. COMPLIANCE-mode Object
 * Lock retention is extend-only and irreversible, so a value provisioned too low can never be
 * corrected on the objects it protects — it must therefore fail closed, never silently
 * under-retain. Shared between the WORM bucket provisioning script
 * (scripts/storage/provision-bucket.ts) and the runtime Object-Lock guard
 * (S3StorageService.assertObjectLockEnabled) so both enforce the identical floor — never
 * duplicate this number.
 */
export const GEBUEV_RETENTION_FLOOR_YEARS = 10;

/**
 * Upper bound on the WORM default-retention years accepted by the provisioning script. COMPLIANCE-
 * mode Object Lock retention is extend-only and irreversible, so a typo that provisions e.g. 110
 * years would lock the entire bucket's contents for a century with no way back. Provisioning above
 * this ceiling must fail closed, exactly like provisioning below the floor.
 */
export const GEBUEV_RETENTION_CEILING_YEARS = 12;
