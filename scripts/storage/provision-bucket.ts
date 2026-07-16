/**
 * WORM bucket provisioning for the GeBüV anchoring pipeline (Stage 3).
 *
 * Creates (or reconciles) an S3-compatible bucket with Object Lock enabled and a default
 * COMPLIANCE-mode retention, so archived compliance objects (KYC documents, EP2 settlement
 * reports) become immutable for the legally required retention period (Swiss GeBüV: 10 years
 * of business records; we provision a safety margin, default 11 years).
 *
 * IMPORTANT — dynamic EP2 containers:
 *   EP2 settlement reports are written to a per-merchant container resolved at runtime
 *   (paymentLinksConfigObj.ep2ReportContainer in fiat-output-job.service.ts). Each such
 *   container is a distinct S3 bucket and MUST be provisioned with this exact same Object
 *   Lock + COMPLIANCE retention BEFORE its first PUT — otherwise its objects are not WORM
 *   protected and Object Lock cannot be retro-fitted onto an existing non-locked bucket.
 *   Run this script once per container name before onboarding a new EP2 merchant.
 *
 * Idempotent: if the bucket already exists, creation is skipped and only the Object Lock
 * default-retention configuration is (re)applied.
 *
 * Configuration (no silent defaults for credentials — fails fast if incomplete):
 *   - S3 endpoint/region from Config.s3 (S3_ENDPOINT / S3_REGION — shared with the app).
 *   - Auth from Config.s3Admin (S3_ADMIN_ACCESS_KEY / S3_ADMIN_SECRET_KEY) — dedicated
 *     provisioning credentials with CreateBucket/Object-Lock rights. The app's policy-
 *     restricted S3_ACCESS_KEY/S3_SECRET_KEY are intentionally NOT used and NOT fallen
 *     back to: they cannot create buckets or apply Object Lock.
 *
 * Run with (bucket name required, retention years optional, default 11):
 *   BUCKET=kyc RETENTION_YEARS=11 npx ts-node scripts/storage/provision-bucket.ts
 *   npx ts-node scripts/storage/provision-bucket.ts kyc 11
 */

import {
  CreateBucketCommand,
  GetBucketVersioningCommand,
  GetObjectLockConfigurationCommand,
  HeadBucketCommand,
  ObjectLockRetentionMode,
  PutBucketVersioningCommand,
  PutObjectLockConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';

dotenv.config();

// Loaded after dotenv so Config.s3 / Config.s3Admin read the populated env. `Config` (the
// module-level `export let Config`) is only ever set as a side effect of `new ConfigService()`,
// which this standalone script never instantiates — importing the raw `Config` binding would be
// permanently `undefined` here. Build a local instance directly via `GetConfig()` instead.
import { GetConfig } from '../../src/config/config';

const Config = GetConfig();

import { GEBUEV_RETENTION_FLOOR_YEARS } from '../../src/integration/infrastructure/storage/worm-retention.const';

function getBucketName(): string {
  const bucket = process.env.BUCKET ?? process.argv[2];
  if (!bucket) throw new Error('Missing bucket name. Provide via BUCKET env var or as the first CLI argument.');
  return bucket;
}

export { GEBUEV_RETENTION_FLOOR_YEARS };

export function getRetentionYears(): number {
  const raw = process.env.RETENTION_YEARS ?? process.argv[3];
  if (raw == null) return 11; // GeBüV 10y + safety margin; explicit, not a silent credential default.

  const years = Number(raw);
  if (!Number.isInteger(years) || years <= 0)
    throw new Error(`Invalid RETENTION_YEARS: ${raw} (expected positive integer)`);
  if (years < GEBUEV_RETENTION_FLOOR_YEARS)
    throw new Error(
      `RETENTION_YEARS=${years} is below the GeBüV ${GEBUEV_RETENTION_FLOOR_YEARS}-year retention floor. ` +
        `COMPLIANCE-mode WORM retention is extend-only and irreversible, so refusing to provision an ` +
        `under-retained bucket. Set RETENTION_YEARS to at least ${GEBUEV_RETENTION_FLOOR_YEARS} (default 11).`,
    );
  return years;
}

function buildClient(): S3Client {
  const { endpoint, region } = Config.s3;
  const { accessKey, secretKey } = Config.s3Admin;
  if (!endpoint || !region || !accessKey || !secretKey)
    throw new Error(
      'Incomplete S3 admin config: S3_ENDPOINT, S3_REGION, S3_ADMIN_ACCESS_KEY and S3_ADMIN_SECRET_KEY are required',
    );

  return new S3Client({
    endpoint,
    region,
    forcePathStyle: true, // MinIO requires path-style addressing (matches S3StorageService)
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
}

async function bucketExists(client: S3Client, bucket: string): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (e) {
    const status = e?.$metadata?.httpStatusCode;
    if (status === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchBucket') return false;
    // HeadBucket on this deployment returns 403 (not 404) when the caller's policy lacks
    // access — including for buckets that do not exist yet. Neither true nor false is safe:
    // true would skip provisioning a genuinely new EP2 merchant bucket; false would blind-
    // CreateBucket against a bucket that may already exist. Fail loud so the policy is fixed.
    if (status === 403 || e?.name === 'AccessDenied')
      throw new Error(
        `Cannot verify bucket existence — provisioning credentials lack permission on "${bucket}" (403). ` +
          `Check the S3_ADMIN_ACCESS_KEY/S3_ADMIN_SECRET_KEY policy.`,
      );
    throw e;
  }
}

async function ensureVersioning(client: S3Client, bucket: string): Promise<void> {
  // Object Lock requires versioning; CreateBucket with ObjectLockEnabledForBucket enables it
  // implicitly, but we assert/enable it explicitly so reconciling an existing bucket is safe.
  const current = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
  if (current.Status === 'Enabled') {
    console.log('  Versioning: already enabled');
    return;
  }

  await client.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' } }));
  console.log('  Versioning: enabled');
}

async function applyObjectLock(client: S3Client, bucket: string, years: number): Promise<void> {
  await client.send(
    new PutObjectLockConfigurationCommand({
      Bucket: bucket,
      ObjectLockConfiguration: {
        ObjectLockEnabled: 'Enabled',
        Rule: { DefaultRetention: { Mode: ObjectLockRetentionMode.COMPLIANCE, Years: years } },
      },
    }),
  );
  console.log(`  Object Lock: default retention COMPLIANCE / ${years} year(s)`);
}

// Object Lock cannot be retro-fitted once objects exist. Read back the applied configuration
// and refuse success unless COMPLIANCE + requested years are confirmed live on the bucket.
async function verifyObjectLock(client: S3Client, bucket: string, years: number): Promise<void> {
  const result = await client.send(new GetObjectLockConfigurationCommand({ Bucket: bucket }));
  const cfg = result.ObjectLockConfiguration;
  const retention = cfg?.Rule?.DefaultRetention;

  if (
    cfg?.ObjectLockEnabled !== 'Enabled' ||
    retention?.Mode !== ObjectLockRetentionMode.COMPLIANCE ||
    retention?.Years !== years
  ) {
    throw new Error(
      `Object Lock verification failed for bucket "${bucket}": expected Enabled + COMPLIANCE / ${years} year(s), ` +
        `got ObjectLockEnabled=${cfg?.ObjectLockEnabled}, Mode=${retention?.Mode}, Years=${retention?.Years}`,
    );
  }

  console.log(`  Object Lock verified: Enabled + COMPLIANCE / ${years} year(s)`);
}

async function main(): Promise<void> {
  const bucket = getBucketName();
  const years = getRetentionYears();
  const client = buildClient();

  console.log(`Provisioning WORM bucket "${bucket}" (endpoint ${Config.s3.endpoint})`);

  if (await bucketExists(client, bucket)) {
    console.log('  Bucket: already exists -> reconciling lock configuration only');
  } else {
    await client.send(new CreateBucketCommand({ Bucket: bucket, ObjectLockEnabledForBucket: true }));
    console.log('  Bucket: created with Object Lock enabled');
  }

  await ensureVersioning(client, bucket);
  await applyObjectLock(client, bucket, years);
  await verifyObjectLock(client, bucket, years);

  console.log(`Done. Bucket "${bucket}" is WORM-protected (COMPLIANCE, ${years}y).`);
}

// Only run when invoked directly as a script (npx ts-node …), not when imported (e.g. by tests
// that exercise getRetentionYears' GeBüV floor without provisioning a real bucket).
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('Provisioning failed:', e?.message ?? e);
      process.exit(1);
    });
}
