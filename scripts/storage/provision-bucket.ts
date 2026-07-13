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
 *   - S3 endpoint/region/credentials come from the standard S3_* env vars (via Config.s3).
 *
 * Run with (bucket name required, retention years optional, default 11):
 *   BUCKET=kyc RETENTION_YEARS=11 npx ts-node scripts/storage/provision-bucket.ts
 *   npx ts-node scripts/storage/provision-bucket.ts kyc 11
 */

import {
  CreateBucketCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  ObjectLockRetentionMode,
  PutBucketVersioningCommand,
  PutObjectLockConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';

dotenv.config();

// Loaded after dotenv so Config.s3 reads the populated env.
import { Config } from '../../src/config/config';

function getBucketName(): string {
  const bucket = process.env.BUCKET ?? process.argv[2];
  if (!bucket) throw new Error('Missing bucket name. Provide via BUCKET env var or as the first CLI argument.');
  return bucket;
}

function getRetentionYears(): number {
  const raw = process.env.RETENTION_YEARS ?? process.argv[3];
  if (raw == null) return 11; // GeBüV 10y + safety margin; explicit, not a silent credential default.

  const years = Number(raw);
  if (!Number.isInteger(years) || years <= 0)
    throw new Error(`Invalid RETENTION_YEARS: ${raw} (expected positive integer)`);
  return years;
}

function buildClient(): S3Client {
  const { endpoint, region, accessKey, secretKey } = Config.s3;
  if (!endpoint || !region || !accessKey || !secretKey)
    throw new Error('Incomplete S3 config: S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY and S3_SECRET_KEY are required');

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

  console.log(`Done. Bucket "${bucket}" is WORM-protected (COMPLIANCE, ${years}y).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Provisioning failed:', e?.message ?? e);
    process.exit(1);
  });
