/**
 * Standalone Azure ↔ S3/MinIO store reconciler for dual-write cutover gates.
 *
 * Proves (and optionally heals additively) that the Azure legacy store and the MinIO/S3
 * store hold the same object inventory for a given list of containers before the read
 * path is switched from Azure to S3. Default mode is REPORT (read-only): print divergence
 * and exit 1 if any is found. With `--heal`, missing objects are copied in either direction
 * (never deleted; content divergence is never overwritten or tolerated). Exit 0 if and only
 * if zero (key, size) divergence remains — see trust boundary below.
 *
 * Comparison is (key, size) plus a lastModified overwrite signature — key presence alone is
 * not enough: an Azure overwrite of a key after backfill leaves identical key sets with
 * diverging content; after Azure teardown the stale S3 copy would become truth (silent data
 * loss). Same-size content overwrites are NOT detectable here (would need a full byte-level
 * comparison — deliberately out of scope); lastModified only catches time-skewed overwrites
 * within OVERWRITE_SKEW_TOLERANCE_MS. The hard gate is (key, size) parity only (onlyOnAzure,
 * onlyOnS3, sizeMismatch); suspectedOverwrite is advisory (lastModified heuristic) and is
 * systematically false-positive after heals because a healed object receives a new
 * lastModified. Exit code 0 therefore proves (key, size) parity only — it does NOT prove
 * byte-identity. Same-size objects with different content are not detectable by this tool
 * and require a separate, not-yet-built byte-level Azure↔S3 verification before Azure
 * teardown (that check is not part of this tool).
 *
 * Overwrite direction is one-sided on purpose: only azure.lastModified >= s3.lastModified +
 * tolerance is flagged. The reverse (s3 newer than azure) is the normal backfill / dual-write
 * ordering case and must not be treated as an overwrite — Azure is the authoritative source.
 *
 * Heal semantics (additive only): missing objects are copied azure→s3 or s3→azure; never
 * delete; never overwrite content divergence. Before every azure→s3 heal copy, containers
 * explicitly declared in RECONCILE_WORM_CONTAINERS are fail-closed checked for Object Lock
 * COMPLIANCE (assertBucketWorm). Containers not on that list are probed once: if Object Lock
 * is unexpectedly Enabled, heal aborts (under-declaration guard — closes the gap where a
 * forgotten WORM container would otherwise be written without a COMPLIANCE check); if the
 * bucket has no Object Lock (ObjectLockConfigurationNotFoundError), the heal proceeds into
 * the normal bucket. Any other probe error fails closed. The WORM set is never guessed:
 * --heal with RECONCILE_WORM_CONTAINERS unset or empty aborts, because guessing either blocks
 * heals into normal buckets or silently writes compliance records into an unprotected bucket.
 * REPORT mode does not require this variable and is unaffected by its value (no-op).
 *
 * Exact-cap heal (`--exact-cap` with `--heal`): production path that binds the heal to both
 * the exact additive candidate count (must equal RECONCILE_HEAL_CAP) and a previously
 * approved candidate-set digest (RECONCILE_EXPECTED_CANDIDATE_SET_SHA256). Both checks run
 * before any WORM probe, download, or PUT. Normal `--heal` keeps max-cap semantics
 * (candidate count ≤ RECONCILE_HEAL_CAP / DEFAULT_HEAL_CAP).
 *
 * Very large buckets may need extra heap because all objects are held in memory, e.g.:
 *   node --max-old-space-size=4096 ./node_modules/.bin/ts-node scripts/storage/reconcile-stores.ts
 *
 * Configuration (no silent credential defaults — fails fast if incomplete):
 *   - S3: S3_ENDPOINT, S3_REGION, S3_ADMIN_ACCESS_KEY, S3_ADMIN_SECRET_KEY
 *   - Azure: AZURE_STORAGE_CONNECTION_STRING
 *   - Containers: CLI positional args or RECONCILE_CONTAINERS (space- and/or comma-separated)
 *   - Ignore buckets: RECONCILE_IGNORE_BUCKETS (space- and/or comma-separated; optional)
 *   - WORM containers: RECONCILE_WORM_CONTAINERS (space- and/or comma-separated; required for
 *     --heal / RECONCILE_HEAL=true, ignored by REPORT). Must list every Object-Lock COMPLIANCE
 *     container among the reconciled set; must not list containers outside that set (typo gate).
 *   - Heal: --heal or RECONCILE_HEAL=true
 *   - Heal cap: RECONCILE_HEAL_CAP (positive integer) or DEFAULT_HEAL_CAP (normal heal only)
 *   - Exact-cap heal: --exact-cap (requires --heal / RECONCILE_HEAL=true), plus explicit
 *     RECONCILE_HEAL_CAP and RECONCILE_EXPECTED_CANDIDATE_SET_SHA256 (64 lowercase hex)
 *   - Optional report provenance: RECONCILE_API_IMAGE_DIGEST, RECONCILE_OPERATOR_COMMIT_SHA
 *
 * Run examples:
 *   RECONCILE_CONTAINERS="kyc support ep2-example" npx ts-node scripts/storage/reconcile-stores.ts
 *   RECONCILE_CONTAINERS="kyc support ep2-example" RECONCILE_WORM_CONTAINERS="kyc ep2-example" \
 *     npx ts-node scripts/storage/reconcile-stores.ts --heal
 *   npx ts-node scripts/storage/reconcile-stores.ts kyc support --verbose
 *
 * Scope boundary: Azure SAS connection strings cannot list containers, so the requested
 * list is intentionally Azure's authority for which stores are reconciled. Every existing
 * S3 bucket must either be in the requested container list or explicitly declared via
 * RECONCILE_IGNORE_BUCKETS (non-document / system buckets) — unaccounted buckets fail hard.
 *
 * Privacy boundary: raw object keys are held in memory for comparison and passed to the
 * storage SDKs, but are never printed. Verbose diagnostics and heal progress identify an
 * object only as a stable SHA-256 key digest. Machine-readable Gate-1 summary lines never
 * include raw keys or user metadata.
 */

import {
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

import {
  GEBUEV_RETENTION_FLOOR_DAYS,
  GEBUEV_RETENTION_FLOOR_YEARS,
} from '../../src/integration/infrastructure/storage/worm-retention.const';

/** Max additive heal copies per run when RECONCILE_HEAL_CAP is unset. Logged at runtime. */
export const DEFAULT_HEAL_CAP = 1000;

/** Runtime marker required by the production operator wrapper before credentials are passed. */
export const RECONCILER_PRIVACY_LOG_VERSION = 'storage-reconciler-private-logs-v2';

/** Schema version for the machine-readable Gate-1 `RECONCILE_REPORT_JSON` line. */
export const RECONCILE_REPORT_SCHEMA_VERSION = 1;

/**
 * Azure lastModified may legitimately lag S3 (or vice versa) by clock skew / write ordering.
 * Only treat as suspected overwrite when Azure is newer by more than this window (1 hour).
 */
export const OVERWRITE_SKEW_TOLERANCE_MS = 60 * 60 * 1000;

export interface StoredObject {
  key: string;
  size: number;
  lastModified: Date;
}

export interface DiffResult {
  /** Present only on Azure → heal direction azure→s3 */
  onlyOnAzure: string[];
  /** Present only on S3 → heal direction s3→azure */
  onlyOnS3: string[];
  /**
   * Present on both, different size → content divergence, gate-blocking, not auto-healable
   */
  sizeMismatch: string[];
  /**
   * Present on both, same size, but azure.lastModified >= s3.lastModified + tolerance →
   * advisory lastModified hint (not gate-blocking; unreliable after heals), not auto-healable
   */
  suspectedOverwrite: string[];
}

export type HealDirection = 'azureToS3' | 's3ToAzure';

export interface DirectionSummary {
  count: number;
  bytes: number;
}

export interface ContainerAdditiveSummary {
  container: string;
  azureToS3: DirectionSummary;
  s3ToAzure: DirectionSummary;
}

/** Privacy-safe additive candidate (no raw key). */
export interface AdditiveCandidate {
  container: string;
  direction: HealDirection;
  keySha256: string;
  size: number;
}

export interface AdditiveReportTotals {
  onlyOnAzure: number;
  onlyOnS3: number;
  sizeMismatch: number;
  suspectedOverwrite: number;
  azureToS3: DirectionSummary;
  s3ToAzure: DirectionSummary;
  additiveCandidates: number;
}

/** Canonical additive Gate-1 summary over all containers (privacy-safe). */
export interface AdditiveReconcileSummary {
  containers: ContainerAdditiveSummary[];
  totals: AdditiveReportTotals;
  candidateSetSha256: string;
}

/** Machine-readable Gate-1 report payload (no raw keys / user metadata). */
export interface MachineReadableReconcileReport {
  schemaVersion: number;
  privacyLogVersion: string;
  mode: 'REPORT' | 'HEAL';
  generatedAtUtc: string;
  apiImageDigest?: string;
  operatorCommitSha?: string;
  containers: ContainerAdditiveSummary[];
  totals: AdditiveReportTotals;
  candidateSetSha256: string;
}

export interface DirectionHealStats {
  healedCount: number;
  healedBytes: number;
  skippedCount: number;
  skippedBytes: number;
}

/** Per-container inventory + diff inputs for additive HEAL orchestration (privacy-safe). */
export interface HealContainerReport {
  container: string;
  diff: DiffResult;
  azureByKey: ReadonlyMap<string, StoredObject>;
  s3ByKey: ReadonlyMap<string, StoredObject>;
}

/** Inputs for the production additive HEAL path (authorization + sequential copies). */
export interface AdditiveHealOrchestrationParams {
  reports: ReadonlyArray<HealContainerReport>;
  s3: S3Client;
  azure: Pick<BlobServiceClient, 'getContainerClient'>;
  wormContainers: ReadonlySet<string>;
  healCap: number;
  exactCap: boolean;
  actualCandidateSetSha256: string;
  expectedCandidateSetSha256?: string;
}

/** Directional heal stats returned by runAdditiveHealOrchestration for summary/verification. */
export interface AdditiveHealOrchestrationStats {
  azureToS3: DirectionHealStats;
  s3ToAzure: DirectionHealStats;
}

// Unit-testable pure helpers — no I/O.
// --- PURE DIFF / GUARDS --- //

/**
 * Compare Azure and S3 object inventories by (key, size) and lastModified overwrite signature.
 * Pure: no network or filesystem calls.
 */
export function diffStores(azureObjs: StoredObject[], s3Objs: StoredObject[], skewToleranceMs: number): DiffResult {
  const azureMap = new Map<string, StoredObject>();
  for (const o of azureObjs) azureMap.set(o.key, o);

  const s3Map = new Map<string, StoredObject>();
  for (const o of s3Objs) s3Map.set(o.key, o);

  const onlyOnAzure: string[] = [];
  const onlyOnS3: string[] = [];
  const sizeMismatch: string[] = [];
  const suspectedOverwrite: string[] = [];

  for (const key of azureMap.keys()) {
    if (!s3Map.has(key)) onlyOnAzure.push(key);
  }
  for (const key of s3Map.keys()) {
    if (!azureMap.has(key)) onlyOnS3.push(key);
  }

  for (const [key, azure] of azureMap) {
    const s3 = s3Map.get(key);
    if (!s3) continue;
    if (azure.size !== s3.size) {
      sizeMismatch.push(key);
      continue;
    }
    if (azure.lastModified.getTime() >= s3.lastModified.getTime() + skewToleranceMs) {
      suspectedOverwrite.push(key);
    }
  }

  return { onlyOnAzure, onlyOnS3, sizeMismatch, suspectedOverwrite };
}

/**
 * Hard gate: true when (key, size) divergence remains. suspectedOverwrite is advisory only
 * (lastModified heuristic; systematically false-positive after heals) and does not block.
 */
export function isGateBlocking(diff: DiffResult): boolean {
  return diff.onlyOnAzure.length > 0 || diff.onlyOnS3.length > 0 || diff.sizeMismatch.length > 0;
}

/**
 * Fail if exactly one side is empty while the other has objects (likely wrong container name
 * or broken credentials) — both empty or both non-empty is fine.
 */
export function assertNotOneSidedEmpty(azureCount: number, s3Count: number, container: string): void {
  const azureEmpty = azureCount === 0;
  const s3Empty = s3Count === 0;
  if (azureEmpty !== s3Empty) {
    throw new Error(
      `One-sided empty inventory for container "${container}": azureCount=${azureCount}, s3Count=${s3Count}. ` +
        `Refusing to treat this as a clean reconcile scope.`,
    );
  }
}

/** Fail if the number of additive heal candidates exceeds the configured cap. */
export function assertWithinHealCap(candidateCount: number, cap: number): void {
  if (candidateCount > cap) {
    throw new Error(
      `Heal candidate count ${candidateCount} exceeds heal cap ${cap}. ` +
        `Raise RECONCILE_HEAL_CAP only after reviewing the report, or heal in smaller batches.`,
    );
  }
}

/**
 * Exact-cap production binding: additive candidate count must equal RECONCILE_HEAL_CAP and the
 * computed candidate-set digest must equal the previously approved digest. Fail-closed before
 * any heal I/O (WORM probe, download, PUT).
 */
export function assertExactHealBinding(
  additiveCandidateCount: number,
  healCap: number,
  actualCandidateSetSha256: string,
  expectedCandidateSetSha256: string,
): void {
  if (additiveCandidateCount !== healCap) {
    throw new Error(
      `Exact-cap heal binding failed: additive candidate count ${additiveCandidateCount} ` +
        `!== RECONCILE_HEAL_CAP ${healCap}. Refusing heal before any WORM probe, download, or PUT.`,
    );
  }
  if (actualCandidateSetSha256 !== expectedCandidateSetSha256) {
    throw new Error(
      `Exact-cap heal binding failed: candidateSetSha256 ${actualCandidateSetSha256} ` +
        `!== expected ${expectedCandidateSetSha256}. Refusing heal before any WORM probe, download, or PUT.`,
    );
  }
}

/** Fail if any requested container name is missing from the S3 bucket inventory. */
export function assertRequestedContainersExist(existingS3Buckets: string[], requested: string[]): void {
  const existing = new Set(existingS3Buckets);
  const missing = requested.filter((name) => !existing.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Requested container(s) not found as S3 bucket(s): ${missing.join(', ')}. ` +
        `Provision missing buckets before reconciling.`,
    );
  }
}

/**
 * Fail if any existing S3 bucket is neither in the requested reconcile list nor in the
 * explicit ignore list (RECONCILE_IGNORE_BUCKETS). Completeness gate for cutover.
 */
export function assertBucketsAccounted(existingS3Buckets: string[], requested: string[], ignore: string[]): void {
  const accounted = new Set([...requested, ...ignore]);
  const unaccounted = existingS3Buckets.filter((name) => !accounted.has(name));
  if (unaccounted.length > 0) {
    throw new Error(
      `Unaccounted S3 bucket(s): ${unaccounted.join(', ')}. ` +
        `Each must either be reconciled (added to the requested container list) or explicitly ` +
        `declared as a non-document-store via RECONCILE_IGNORE_BUCKETS.`,
    );
  }
}

/**
 * Guard against silent incomplete S3 list pagination: IsTruncated without a continuation
 * token would leave the inventory incomplete if the loop simply stopped.
 */
export function assertPageComplete(isTruncated: boolean, nextToken: string | undefined): void {
  if (isTruncated && !nextToken) {
    throw new Error(
      'S3 ListObjectsV2 reported IsTruncated=true without NextContinuationToken; ' +
        'inventory would be incomplete if pagination stopped here.',
    );
  }
}

/**
 * Verify the target S3 bucket enforces Object Lock COMPLIANCE with GeBüV floor retention
 * before an azure→s3 heal copy into a declared WORM container. Memoized per bucket name in
 * `verified` (only successes). Call only for containers listed in RECONCILE_WORM_CONTAINERS —
 * undeclared targets use assertUndeclaredBucketHasNoWorm instead (see assertBucketWormIfDeclared).
 */
export async function assertBucketWorm(
  client: S3Client,
  bucket: string,
  verified: Map<string, boolean>,
): Promise<void> {
  if (verified.get(bucket) === true) return;

  const result = await client.send(new GetObjectLockConfigurationCommand({ Bucket: bucket }));
  const cfg = result.ObjectLockConfiguration;
  const retention = cfg?.Rule?.DefaultRetention;
  const years = retention?.Years;
  const days = retention?.Days;
  const yearsOk =
    years != null &&
    days == null &&
    Number.isFinite(years) &&
    Number.isInteger(years) &&
    years > 0 &&
    years >= GEBUEV_RETENTION_FLOOR_YEARS;
  const daysOk =
    days != null &&
    years == null &&
    Number.isFinite(days) &&
    Number.isInteger(days) &&
    days > 0 &&
    days >= GEBUEV_RETENTION_FLOOR_DAYS;

  const ok = cfg?.ObjectLockEnabled === 'Enabled' && retention?.Mode === 'COMPLIANCE' && (yearsOk || daysOk);

  if (!ok) {
    throw new Error(
      `Refusing azure→s3 heal into bucket "${bucket}": Object Lock is not Enabled with COMPLIANCE-mode ` +
        `default retention of at least ${GEBUEV_RETENTION_FLOOR_YEARS} year(s) or ${GEBUEV_RETENTION_FLOOR_DAYS} day(s) ` +
        `(got ObjectLockEnabled=${cfg?.ObjectLockEnabled}, Mode=${retention?.Mode}, Years=${years}, Days=${days}). ` +
        `Provision the bucket first (scripts/storage/provision-bucket.ts).`,
    );
  }

  verified.set(bucket, true);
}

/**
 * Under-declaration guard for undeclared azure→s3 heal targets: probe once whether the bucket
 * has Object Lock enabled. If it does, abort (operator must list it in RECONCILE_WORM_CONTAINERS
 * so COMPLIANCE is checked). If the probe rejects with ObjectLockConfigurationNotFoundError,
 * the bucket genuinely has no Object Lock — proceed. Any other probe error fails closed.
 * Memoized per bucket in `verified` (only successes; never cache a failure).
 */
export async function assertUndeclaredBucketHasNoWorm(
  client: S3Client,
  bucket: string,
  verified: Map<string, boolean>,
): Promise<void> {
  if (verified.get(bucket) === true) return;

  let result: { ObjectLockConfiguration?: { ObjectLockEnabled?: string } };
  try {
    result = await client.send(new GetObjectLockConfigurationCommand({ Bucket: bucket }));
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err?.name === 'ObjectLockConfigurationNotFoundError') {
      verified.set(bucket, true);
      return;
    }
    throw new Error(
      `Refusing azure→s3 heal into undeclared bucket "${bucket}": could not verify Object Lock status ` +
        `(${err?.name ?? 'error'}: ${err?.message ?? e}). Heal will not proceed without a verified ` +
        `Object Lock status (fail-closed; not treating this as "no lock").`,
    );
  }

  if (result.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled') {
    throw new Error(
      `Bucket/container "${bucket}" has Object Lock enabled but is not declared in RECONCILE_WORM_CONTAINERS. ` +
        `A heal will not proceed into a protected bucket without the declaration — this closes the ` +
        `under-declaration gap. Add "${bucket}" to RECONCILE_WORM_CONTAINERS so Object Lock COMPLIANCE ` +
        `is checked before azure→s3 copies.`,
    );
  }

  verified.set(bucket, true);
}

/**
 * Heal-path WORM gate for azure→s3 copies:
 * - Declared in RECONCILE_WORM_CONTAINERS → assertBucketWorm (fail-closed COMPLIANCE check).
 * - Not declared → assertUndeclaredBucketHasNoWorm (under-declaration guard: abort if the
 *   bucket unexpectedly has Object Lock Enabled; allow genuine non-WORM buckets).
 * `verified` memoizes declared-bucket COMPLIANCE successes; `noWormVerified` memoizes
 * undeclared-bucket "safe to proceed" successes. Failures are never cached.
 */
export async function assertBucketWormIfDeclared(
  client: S3Client,
  bucket: string,
  wormContainers: ReadonlySet<string>,
  verified: Map<string, boolean>,
  noWormVerified: Map<string, boolean>,
): Promise<void> {
  if (wormContainers.has(bucket)) {
    await assertBucketWorm(client, bucket, verified);
    return;
  }
  await assertUndeclaredBucketHasNoWorm(client, bucket, noWormVerified);
}

/**
 * Fail-loud config gate for RECONCILE_WORM_CONTAINERS. Entire function is a no-op when
 * `heal` is false (REPORT mode is unaffected by this variable, whether empty, set, or
 * containing names outside the reconciled set).
 * - Heal mode requires an explicit non-empty declaration (no silent default / empty-list default).
 * - In heal mode, any declared name must appear among the reconciled containers (typo gate).
 */
export function assertWormContainersConfig(
  heal: boolean,
  wormContainers: string[],
  reconciledContainers: string[],
): void {
  if (!heal) return;

  if (wormContainers.length === 0) {
    throw new Error(
      'RECONCILE_WORM_CONTAINERS is required when --heal (or RECONCILE_HEAL=true) is requested and must not be empty. ' +
        'Declare which containers enforce Object Lock COMPLIANCE (space- and/or comma-separated). ' +
        'Guessing either blocks legitimate heals into normal buckets or silently writes ' +
        'compliance records into an unprotected bucket.',
    );
  }

  const reconciled = new Set(reconciledContainers);
  const unknown = wormContainers.filter((name) => !reconciled.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `RECONCILE_WORM_CONTAINERS declares container(s) not among the reconciled containers: ${unknown.join(', ')}. ` +
        `Likely a typo in the declaration — every WORM container must also be reconciled.`,
    );
  }
}

// --- ADDITIVE SUMMARY / DIGEST (privacy-safe, pure) --- //

export function hashObjectKeySha256(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

export function indexStoredObjectsByKey(objects: readonly StoredObject[]): Map<string, StoredObject> {
  const map = new Map<string, StoredObject>();
  for (const obj of objects) {
    map.set(obj.key, obj);
  }
  return map;
}

export function sumBytesForKeys(keys: readonly string[], byKey: ReadonlyMap<string, StoredObject>): number {
  let bytes = 0;
  for (const key of keys) {
    const obj = byKey.get(key);
    if (!obj) {
      throw new Error(
        `Missing inventory object for key-sha256=${hashObjectKeySha256(key)} while summing candidate bytes`,
      );
    }
    bytes += obj.size;
  }
  return bytes;
}

export function buildDirectionSummary(
  keys: readonly string[],
  byKey: ReadonlyMap<string, StoredObject>,
): DirectionSummary {
  return { count: keys.length, bytes: sumBytesForKeys(keys, byKey) };
}

/**
 * Collect privacy-safe additive candidates for one container. Only onlyOnAzure / onlyOnS3
 * contribute; sizeMismatch and suspectedOverwrite are never additive heal candidates.
 */
export function collectAdditiveCandidatesForContainer(
  container: string,
  diff: DiffResult,
  azureByKey: ReadonlyMap<string, StoredObject>,
  s3ByKey: ReadonlyMap<string, StoredObject>,
): AdditiveCandidate[] {
  const candidates: AdditiveCandidate[] = [];

  for (const key of diff.onlyOnAzure) {
    const obj = azureByKey.get(key);
    if (!obj) {
      throw new Error(`Missing Azure inventory object for ${safeObjectReference(container, key)}`);
    }
    candidates.push({
      container,
      direction: 'azureToS3',
      keySha256: hashObjectKeySha256(key),
      size: obj.size,
    });
  }

  for (const key of diff.onlyOnS3) {
    const obj = s3ByKey.get(key);
    if (!obj) {
      throw new Error(`Missing S3 inventory object for ${safeObjectReference(container, key)}`);
    }
    candidates.push({
      container,
      direction: 's3ToAzure',
      keySha256: hashObjectKeySha256(key),
      size: obj.size,
    });
  }

  return candidates;
}

/** Canonical sort for candidate-set digest (order-independent over the multiset). */
export function compareAdditiveCandidates(a: AdditiveCandidate, b: AdditiveCandidate): number {
  if (a.container !== b.container) return a.container < b.container ? -1 : 1;
  if (a.direction !== b.direction) return a.direction < b.direction ? -1 : 1;
  if (a.keySha256 !== b.keySha256) return a.keySha256 < b.keySha256 ? -1 : 1;
  if (a.size !== b.size) return a.size < b.size ? -1 : 1;
  return 0;
}

/**
 * Deterministic, order-independent digest of the exact additive candidate set.
 * Each entry is container, direction, sha256(key), size — never a raw key.
 */
export function computeCandidateSetSha256(candidates: readonly AdditiveCandidate[]): string {
  const sorted = [...candidates].sort(compareAdditiveCandidates);
  // Fixed field order; array form avoids object key-order ambiguity.
  const canonical = JSON.stringify(sorted.map((c) => [c.container, c.direction, c.keySha256, c.size]));
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function buildContainerAdditiveSummary(
  container: string,
  diff: DiffResult,
  azureByKey: ReadonlyMap<string, StoredObject>,
  s3ByKey: ReadonlyMap<string, StoredObject>,
): ContainerAdditiveSummary {
  return {
    container,
    azureToS3: buildDirectionSummary(diff.onlyOnAzure, azureByKey),
    s3ToAzure: buildDirectionSummary(diff.onlyOnS3, s3ByKey),
  };
}

export function buildAdditiveReconcileSummary(
  containerReports: ReadonlyArray<{
    container: string;
    diff: DiffResult;
    azureObjs: readonly StoredObject[];
    s3Objs: readonly StoredObject[];
  }>,
): AdditiveReconcileSummary {
  const containers: ContainerAdditiveSummary[] = [];
  const allCandidates: AdditiveCandidate[] = [];
  let onlyOnAzure = 0;
  let onlyOnS3 = 0;
  let sizeMismatch = 0;
  let suspectedOverwrite = 0;
  let azureToS3Count = 0;
  let azureToS3Bytes = 0;
  let s3ToAzureCount = 0;
  let s3ToAzureBytes = 0;

  for (const report of containerReports) {
    const azureByKey = indexStoredObjectsByKey(report.azureObjs);
    const s3ByKey = indexStoredObjectsByKey(report.s3Objs);
    const summary = buildContainerAdditiveSummary(report.container, report.diff, azureByKey, s3ByKey);
    containers.push(summary);
    allCandidates.push(...collectAdditiveCandidatesForContainer(report.container, report.diff, azureByKey, s3ByKey));

    onlyOnAzure += report.diff.onlyOnAzure.length;
    onlyOnS3 += report.diff.onlyOnS3.length;
    sizeMismatch += report.diff.sizeMismatch.length;
    suspectedOverwrite += report.diff.suspectedOverwrite.length;
    azureToS3Count += summary.azureToS3.count;
    azureToS3Bytes += summary.azureToS3.bytes;
    s3ToAzureCount += summary.s3ToAzure.count;
    s3ToAzureBytes += summary.s3ToAzure.bytes;
  }

  const additiveCandidates = azureToS3Count + s3ToAzureCount;
  return {
    containers,
    totals: {
      onlyOnAzure,
      onlyOnS3,
      sizeMismatch,
      suspectedOverwrite,
      azureToS3: { count: azureToS3Count, bytes: azureToS3Bytes },
      s3ToAzure: { count: s3ToAzureCount, bytes: s3ToAzureBytes },
      additiveCandidates,
    },
    candidateSetSha256: computeCandidateSetSha256(allCandidates),
  };
}

export function buildMachineReadableReconcileReport(
  summary: AdditiveReconcileSummary,
  mode: 'REPORT' | 'HEAL',
  generatedAtUtc: string,
  provenance?: { apiImageDigest?: string; operatorCommitSha?: string },
): MachineReadableReconcileReport {
  const report: MachineReadableReconcileReport = {
    schemaVersion: RECONCILE_REPORT_SCHEMA_VERSION,
    privacyLogVersion: RECONCILER_PRIVACY_LOG_VERSION,
    mode,
    generatedAtUtc,
    containers: summary.containers,
    totals: summary.totals,
    candidateSetSha256: summary.candidateSetSha256,
  };

  if (provenance?.apiImageDigest !== undefined) {
    report.apiImageDigest = provenance.apiImageDigest;
  }
  if (provenance?.operatorCommitSha !== undefined) {
    report.operatorCommitSha = provenance.operatorCommitSha;
  }

  return report;
}

/** Exactly one machine-readable line for operator / Gate-1 automation. */
export function formatReconcileReportJsonLine(report: MachineReadableReconcileReport): string {
  return `RECONCILE_REPORT_JSON=${JSON.stringify(report)}`;
}

// size/lastModified from list pages only — no HeadObject per key.
// --- LISTING --- //

export async function listS3Objects(client: S3Client, bucket: string): Promise<StoredObject[]> {
  const objects: StoredObject[] = [];
  let token: string | undefined;

  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }),
    );

    assertPageComplete(res.IsTruncated === true, res.NextContinuationToken);

    for (const o of res.Contents ?? []) {
      if (o.Key == null || o.Key === '' || o.Size == null || o.LastModified == null) {
        const objectRef = o.Key ? safeObjectReference(bucket, o.Key) : 'key=missing';
        throw new Error(
          `Incomplete S3 list entry in bucket "${bucket}" (${objectRef})` +
            `: Key, Size and LastModified are required from ListObjectsV2 (no HeadObject fallback)`,
        );
      }
      objects.push({ key: o.Key, size: o.Size, lastModified: o.LastModified });
    }

    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  return objects;
}

export async function listAzureObjects(containerClient: ContainerClient): Promise<StoredObject[]> {
  const objects: StoredObject[] = [];
  const container = containerClient.containerName;

  for await (const b of containerClient.listBlobsFlat()) {
    const name = b.name;
    const contentLength = b.properties?.contentLength;
    const lastModified = b.properties?.lastModified;

    if (name == null || name === '' || contentLength == null || lastModified == null) {
      const objectRef = name ? safeObjectReference(container, name) : 'key=missing';
      throw new Error(
        `Incomplete Azure list entry in container "${container}" (${objectRef})` +
          `: name, properties.contentLength and properties.lastModified are required from listBlobsFlat`,
      );
    }

    objects.push({ key: name, size: contentLength, lastModified });
  }

  return objects;
}

// --- CLIENTS / CONFIG --- //

function buildS3Client(): S3Client {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const accessKey = process.env.S3_ADMIN_ACCESS_KEY;
  const secretKey = process.env.S3_ADMIN_SECRET_KEY;
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

function buildAzureClient(): BlobServiceClient {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error('Incomplete Azure config: AZURE_STORAGE_CONNECTION_STRING is required');

  return BlobServiceClient.fromConnectionString(connectionString);
}

function parseContainerList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Deduplicate while preserving first-seen order. */
function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

const EXPECTED_CANDIDATE_SET_SHA256_RE = /^[a-f0-9]{64}$/;

export function parseConfig(): {
  containers: string[];
  ignoreBuckets: string[];
  wormContainers: string[];
  heal: boolean;
  healCap: number;
  verbose: boolean;
  exactCap: boolean;
  expectedCandidateSetSha256?: string;
  apiImageDigest?: string;
  operatorCommitSha?: string;
} {
  const args = process.argv.slice(2);

  for (const a of args) {
    if (a.startsWith('--') && a !== '--heal' && a !== '--verbose' && a !== '--exact-cap') {
      throw new Error(`Unknown flag: ${a}`);
    }
  }

  const heal = args.includes('--heal') || process.env.RECONCILE_HEAL === 'true';
  const verbose = args.includes('--verbose');
  const exactCap = args.includes('--exact-cap');

  if (exactCap && !heal) {
    throw new Error('--exact-cap is only allowed together with --heal (or RECONCILE_HEAL=true)');
  }

  let containers = args.filter((a) => !a.startsWith('--'));
  if (containers.length === 0) {
    const envList = process.env.RECONCILE_CONTAINERS;
    if (envList) containers = parseContainerList(envList);
  }
  if (containers.length === 0) {
    throw new Error(
      'No containers specified. Pass container names as CLI args or set RECONCILE_CONTAINERS ' +
        '(space- and/or comma-separated).',
    );
  }
  containers = dedupePreserveOrder(containers);

  const ignoreRaw = process.env.RECONCILE_IGNORE_BUCKETS;
  const ignoreBuckets = ignoreRaw ? parseContainerList(ignoreRaw) : [];

  const wormRaw = process.env.RECONCILE_WORM_CONTAINERS;
  const wormContainers = wormRaw ? dedupePreserveOrder(parseContainerList(wormRaw)) : [];
  assertWormContainersConfig(heal, wormContainers, containers);

  const rawCap = process.env.RECONCILE_HEAL_CAP;
  let healCap = DEFAULT_HEAL_CAP;
  if (rawCap !== undefined) {
    const n = Number(rawCap);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Invalid RECONCILE_HEAL_CAP: ${rawCap} (expected positive integer)`);
    }
    healCap = n;
  } else if (exactCap) {
    throw new Error(
      'RECONCILE_HEAL_CAP is required when --exact-cap is set (exact additive candidate count binding; no silent default)',
    );
  }

  let expectedCandidateSetSha256: string | undefined;
  if (exactCap) {
    const expected = process.env.RECONCILE_EXPECTED_CANDIDATE_SET_SHA256;
    if (expected === undefined || expected === '') {
      throw new Error(
        'RECONCILE_EXPECTED_CANDIDATE_SET_SHA256 is required when --exact-cap is set and must be exactly 64 lowercase hex characters',
      );
    }
    if (!EXPECTED_CANDIDATE_SET_SHA256_RE.test(expected)) {
      throw new Error(
        'RECONCILE_EXPECTED_CANDIDATE_SET_SHA256 must be exactly 64 lowercase hex characters when --exact-cap is set',
      );
    }
    expectedCandidateSetSha256 = expected;
  }

  const apiImageDigest = process.env.RECONCILE_API_IMAGE_DIGEST;
  const operatorCommitSha = process.env.RECONCILE_OPERATOR_COMMIT_SHA;

  return {
    containers,
    ignoreBuckets,
    wormContainers,
    heal,
    healCap,
    verbose,
    exactCap,
    ...(expectedCandidateSetSha256 !== undefined ? { expectedCandidateSetSha256 } : {}),
    ...(apiImageDigest !== undefined && apiImageDigest !== '' ? { apiImageDigest } : {}),
    ...(operatorCommitSha !== undefined && operatorCommitSha !== '' ? { operatorCommitSha } : {}),
  };
}

function isEmptyDiff(diff: DiffResult): boolean {
  return (
    diff.onlyOnAzure.length === 0 &&
    diff.onlyOnS3.length === 0 &&
    diff.sizeMismatch.length === 0 &&
    diff.suspectedOverwrite.length === 0
  );
}

function countAdditive(diff: DiffResult): number {
  return diff.onlyOnAzure.length + diff.onlyOnS3.length;
}

export function safeObjectReference(container: string, key: string): string {
  const keyDigest = hashObjectKeySha256(key);
  return `${container}/key-sha256:${keyDigest}`;
}

/**
 * Privacy-safe detail line for --verbose: fixed technical allowlist only — container,
 * sha256(key), source, size, UTC lastModified. Never ETag, content hashes, raw keys,
 * content-type, or user metadata.
 */
export function formatDetailObjectLine(
  container: string,
  key: string,
  source: 'azure' | 's3',
  obj: StoredObject,
): string {
  const keySha256 = hashObjectKeySha256(key);
  const lastModifiedUtc = obj.lastModified.toISOString();
  return `      - container=${container} key-sha256=${keySha256} source=${source} size=${obj.size} lastModified=${lastModifiedUtc}`;
}

export function printCategory(
  container: string,
  label: string,
  keys: string[],
  verbose: boolean,
  options?: {
    bytes?: number;
    azureByKey?: ReadonlyMap<string, StoredObject>;
    s3ByKey?: ReadonlyMap<string, StoredObject>;
    dualSide?: boolean;
    singleSource?: 'azure' | 's3';
  },
): void {
  const bytesSuffix = options?.bytes !== undefined ? ` (bytes=${options.bytes})` : '';
  console.log(`    ${label}: ${keys.length}${bytesSuffix}`);
  if (!verbose || keys.length === 0) return;

  const samples = keys.slice(0, 20);
  for (const key of samples) {
    if (options?.dualSide) {
      const azureObj = options.azureByKey?.get(key);
      const s3Obj = options.s3ByKey?.get(key);
      if (!azureObj || !s3Obj) {
        throw new Error(`Missing dual-side inventory for ${safeObjectReference(container, key)} in detail mode`);
      }
      console.log(formatDetailObjectLine(container, key, 'azure', azureObj));
      console.log(formatDetailObjectLine(container, key, 's3', s3Obj));
    } else {
      const source = options?.singleSource;
      if (source === undefined) {
        throw new Error(`Detail mode requires singleSource or dualSide for category ${label}`);
      }
      const byKey = source === 'azure' ? options.azureByKey : options.s3ByKey;
      const obj = byKey?.get(key);
      if (!obj) {
        throw new Error(`Missing ${source} inventory for ${safeObjectReference(container, key)} in detail mode`);
      }
      console.log(formatDetailObjectLine(container, key, source, obj));
    }
  }
  if (keys.length > 20) console.log(`      ... and ${keys.length - 20} more`);
}

export function logObjectAction(action: string, direction: string, container: string, key: string): void {
  console.log(`${action} ${direction} ${safeObjectReference(container, key)}`);
}

/** Collect a Node readable stream into a single Buffer (for atomic Azure download). */
export async function streamToBuffer(readable: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    readable.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', (err) => reject(err));
  });
}

export function isS3PreconditionFailed(err: unknown): boolean {
  const e = err as {
    $metadata?: { httpStatusCode?: number };
    name?: string;
    statusCode?: number;
    details?: { errorCode?: string };
  };
  return e?.$metadata?.httpStatusCode === 412 || e?.name === 'PreconditionFailed';
}

export function isAzurePreconditionFailed(err: unknown): boolean {
  const e = err as {
    $metadata?: { httpStatusCode?: number };
    name?: string;
    statusCode?: number;
    details?: { errorCode?: string };
  };
  return e?.statusCode === 412 || e?.details?.errorCode === 'BlobAlreadyExists';
}

/**
 * Fail-closed gate for the digest-bound inventory size passed into heal copies.
 * Rejects non-integers, negatives, and non-safe integers before any target write.
 */
export function assertExpectedSourceSize(
  expectedSourceSize: number,
  direction: 'azure->s3' | 's3->azure',
  objectRef: string,
): void {
  if (!Number.isSafeInteger(expectedSourceSize) || expectedSourceSize < 0) {
    throw new Error(
      `Invalid expectedSourceSize for ${direction} copy of ${objectRef}: ` +
        `expected non-negative safe integer, got ${String(expectedSourceSize)}`,
    );
  }
}

/**
 * After a full source download, refuse to write if the loaded buffer length differs from the
 * inventory size that was bound into the candidate set (container + direction + sha256(key) + size).
 * Closes the race where the source object changes size between inventory and download.
 */
export function assertDownloadedSourceSize(
  actualSize: number,
  expectedSourceSize: number,
  direction: 'azure->s3' | 's3->azure',
  objectRef: string,
): void {
  if (actualSize !== expectedSourceSize) {
    throw new Error(
      `Source size race for ${direction}: expected ${expectedSourceSize} bytes, ` +
        `got ${actualSize} bytes for ${objectRef}`,
    );
  }
}

export async function copyAzureToS3(
  azureContainer: ContainerClient,
  s3: S3Client,
  bucket: string,
  key: string,
  expectedSourceSize: number,
): Promise<'healed' | 'skipped'> {
  const blobClient = azureContainer.getBlockBlobClient(key);
  const objectRef = safeObjectReference(bucket, key);
  assertExpectedSourceSize(expectedSourceSize, 'azure->s3', objectRef);

  const download = await blobClient.download().catch((err) => {
    throw new Error(`Azure download failed for ${objectRef}`, { cause: err });
  });
  if (!download.readableStreamBody) {
    throw new Error(`Empty readableStreamBody for Azure blob ${objectRef}`);
  }
  let data: Buffer;
  try {
    data = await streamToBuffer(download.readableStreamBody);
  } catch (err) {
    throw new Error(`Azure download stream failed for ${objectRef}`, { cause: err });
  }

  // Inventory size is digest-bound; refuse any source that changed size before the conditional PUT.
  assertDownloadedSourceSize(data.length, expectedSourceSize, 'azure->s3', objectRef);

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: download.contentType,
        Metadata: download.metadata,
        IfNoneMatch: '*',
      }),
    );
  } catch (err) {
    if (isS3PreconditionFailed(err)) {
      logObjectAction('SKIPPED (appeared concurrently)', 'azure->s3', bucket, key);
      return 'skipped';
    }
    throw new Error(`Azure->S3 copy failed for ${objectRef}`, { cause: err });
  }

  return 'healed';
}

export async function copyS3ToAzure(
  s3: S3Client,
  bucket: string,
  azureContainer: ContainerClient,
  key: string,
  expectedSourceSize: number,
): Promise<'healed' | 'skipped'> {
  const objectRef = safeObjectReference(bucket, key);
  assertExpectedSourceSize(expectedSourceSize, 's3->azure', objectRef);

  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })).catch((err) => {
    throw new Error(`S3 download failed for ${objectRef}`, { cause: err });
  });
  if (!res.Body) throw new Error(`Empty body for S3 object ${objectRef}`);

  let data: Buffer;
  try {
    data = Buffer.from(await res.Body.transformToByteArray());
  } catch (err) {
    throw new Error(`S3 download stream failed for ${objectRef}`, { cause: err });
  }

  // Inventory size is digest-bound; refuse any source that changed size before the conditional upload.
  assertDownloadedSourceSize(data.length, expectedSourceSize, 's3->azure', objectRef);

  try {
    await azureContainer.getBlockBlobClient(key).uploadData(data, {
      blobHTTPHeaders: { blobContentType: res.ContentType },
      metadata: res.Metadata,
      conditions: { ifNoneMatch: '*' },
    });
  } catch (err) {
    if (isAzurePreconditionFailed(err)) {
      logObjectAction('SKIPPED (appeared concurrently)', 's3->azure', bucket, key);
      return 'skipped';
    }
    throw new Error(`S3->Azure copy failed for ${objectRef}`, { cause: err });
  }

  return 'healed';
}

/**
 * Production additive HEAL orchestration: authorize exact-cap / max-cap binding first, then
 * run sequential azure→s3 / s3→azure copies with conditional target writes and WORM
 * fail-closed checks. No deletes or overwrites. Authorization runs before any WORM probe,
 * download, PUT/upload, or per-container copy loop — including when the live candidate set
 * is empty (exact-cap must not short-circuit to a misleading clean success).
 */
export async function runAdditiveHealOrchestration(
  params: AdditiveHealOrchestrationParams,
): Promise<AdditiveHealOrchestrationStats> {
  const {
    reports,
    s3,
    azure,
    wormContainers,
    healCap,
    exactCap,
    actualCandidateSetSha256,
    expectedCandidateSetSha256,
  } = params;

  const totalAdditive = reports.reduce((sum, r) => sum + countAdditive(r.diff), 0);

  if (exactCap) {
    if (expectedCandidateSetSha256 === undefined) {
      throw new Error('Internal error: exactCap set without expectedCandidateSetSha256');
    }
    assertExactHealBinding(totalAdditive, healCap, actualCandidateSetSha256, expectedCandidateSetSha256);
  } else {
    assertWithinHealCap(totalAdditive, healCap);
  }

  const wormVerified = new Map<string, boolean>();
  const noWormVerified = new Map<string, boolean>();
  const azureToS3Stats: DirectionHealStats = {
    healedCount: 0,
    healedBytes: 0,
    skippedCount: 0,
    skippedBytes: 0,
  };
  const s3ToAzureStats: DirectionHealStats = {
    healedCount: 0,
    healedBytes: 0,
    skippedCount: 0,
    skippedBytes: 0,
  };

  for (const r of reports) {
    try {
      const azureContainer = azure.getContainerClient(r.container);

      for (const key of r.diff.onlyOnAzure) {
        const size = r.azureByKey.get(key)?.size;
        if (size === undefined) {
          throw new Error(`Missing Azure size for ${safeObjectReference(r.container, key)}`);
        }
        await assertBucketWormIfDeclared(s3, r.container, wormContainers, wormVerified, noWormVerified);
        // Pass digest-bound inventory size so copy fails closed if the source changed after inventory.
        const result = await copyAzureToS3(azureContainer, s3, r.container, key, size);
        if (result === 'healed') {
          azureToS3Stats.healedCount++;
          azureToS3Stats.healedBytes += size;
          logObjectAction('HEALED', 'azure->s3', r.container, key);
        } else {
          azureToS3Stats.skippedCount++;
          azureToS3Stats.skippedBytes += size;
        }
      }

      for (const key of r.diff.onlyOnS3) {
        const size = r.s3ByKey.get(key)?.size;
        if (size === undefined) {
          throw new Error(`Missing S3 size for ${safeObjectReference(r.container, key)}`);
        }
        // Pass digest-bound inventory size so copy fails closed if the source changed after inventory.
        const result = await copyS3ToAzure(s3, r.container, azureContainer, key, size);
        if (result === 'healed') {
          s3ToAzureStats.healedCount++;
          s3ToAzureStats.healedBytes += size;
          logObjectAction('HEALED', 's3->azure', r.container, key);
        } else {
          s3ToAzureStats.skippedCount++;
          s3ToAzureStats.skippedBytes += size;
        }
      }
    } catch (e) {
      throw new Error(`[container="${r.container}"] ${e?.message ?? e}`, { cause: e });
    }
  }

  return { azureToS3: azureToS3Stats, s3ToAzure: s3ToAzureStats };
}

// --- MAIN --- //

async function main(): Promise<number> {
  const {
    containers,
    ignoreBuckets,
    wormContainers,
    heal,
    healCap,
    verbose,
    exactCap,
    expectedCandidateSetSha256,
    apiImageDigest,
    operatorCommitSha,
  } = parseConfig();
  const s3 = buildS3Client();
  const azure = buildAzureClient();
  const wormSet = new Set(wormContainers);

  console.log(
    `Store reconcile: containers=[${containers.join(', ')}] ` +
      `ignoreBuckets=[${ignoreBuckets.join(', ')}] ` +
      `wormContainers=[${wormContainers.join(', ')}] mode=${heal ? 'HEAL' : 'REPORT'} ` +
      `healCap=${healCap}${process.env.RECONCILE_HEAL_CAP === undefined ? ` (DEFAULT_HEAL_CAP)` : ''} ` +
      `exactCap=${exactCap} ` +
      `skewToleranceMs=${OVERWRITE_SKEW_TOLERANCE_MS}`,
  );

  const existingS3Buckets: string[] = [];
  let listBucketsToken: string | undefined;

  do {
    const bucketsRes = await s3.send(new ListBucketsCommand({ ContinuationToken: listBucketsToken }));

    for (const b of bucketsRes.Buckets ?? []) {
      if (b.Name == null || b.Name === '') {
        throw new Error('Incomplete S3 ListBuckets entry: Name is required (refusing silent skip of unnamed bucket)');
      }
      existingS3Buckets.push(b.Name);
    }

    // Same falsy-token termination as listS3Objects / assertPageComplete (!token covers '' and undefined).
    listBucketsToken = bucketsRes.ContinuationToken;
  } while (listBucketsToken);

  assertRequestedContainersExist(existingS3Buckets, containers);
  assertBucketsAccounted(existingS3Buckets, containers, ignoreBuckets);

  type ContainerReport = {
    container: string;
    diff: DiffResult;
    azureCount: number;
    s3Count: number;
    azureObjs: StoredObject[];
    s3Objs: StoredObject[];
    azureByKey: Map<string, StoredObject>;
    s3ByKey: Map<string, StoredObject>;
  };
  const reports: ContainerReport[] = [];

  for (const container of containers) {
    try {
      const azureContainer = azure.getContainerClient(container);
      const azureObjs = await listAzureObjects(azureContainer);
      const s3Objs = await listS3Objects(s3, container);

      assertNotOneSidedEmpty(azureObjs.length, s3Objs.length, container);

      const diff = diffStores(azureObjs, s3Objs, OVERWRITE_SKEW_TOLERANCE_MS);
      const azureByKey = indexStoredObjectsByKey(azureObjs);
      const s3ByKey = indexStoredObjectsByKey(s3Objs);
      reports.push({
        container,
        diff,
        azureCount: azureObjs.length,
        s3Count: s3Objs.length,
        azureObjs,
        s3Objs,
        azureByKey,
        s3ByKey,
      });

      const azureToS3 = buildDirectionSummary(diff.onlyOnAzure, azureByKey);
      const s3ToAzure = buildDirectionSummary(diff.onlyOnS3, s3ByKey);

      console.log(`\n[${container}] azure=${azureObjs.length} s3=${s3Objs.length}`);
      printCategory(container, 'onlyOnAzure', diff.onlyOnAzure, verbose, {
        bytes: azureToS3.bytes,
        azureByKey,
        singleSource: 'azure',
      });
      printCategory(container, 'onlyOnS3', diff.onlyOnS3, verbose, {
        bytes: s3ToAzure.bytes,
        s3ByKey,
        singleSource: 's3',
      });
      printCategory(container, 'sizeMismatch', diff.sizeMismatch, verbose, {
        azureByKey,
        s3ByKey,
        dualSide: true,
      });
      printCategory(container, 'suspectedOverwrite', diff.suspectedOverwrite, verbose, {
        azureByKey,
        s3ByKey,
        dualSide: true,
      });
      console.log(
        `    candidateBytes: azureToS3=${azureToS3.bytes} s3ToAzure=${s3ToAzure.bytes} ` +
          `(counts azureToS3=${azureToS3.count} s3ToAzure=${s3ToAzure.count})`,
      );
      if (isEmptyDiff(diff)) console.log('    OK: no divergence');
    } catch (e) {
      throw new Error(`[container="${container}"] ${e?.message ?? e}`, { cause: e });
    }
  }

  const additiveSummary = buildAdditiveReconcileSummary(reports);
  const totals = additiveSummary.totals;

  console.log(
    `\nAGGREGATE across ${containers.length} container(s): ` +
      `onlyOnAzure=${totals.onlyOnAzure} onlyOnS3=${totals.onlyOnS3} ` +
      `sizeMismatch=${totals.sizeMismatch} suspectedOverwrite=${totals.suspectedOverwrite} ` +
      `azureToS3.count=${totals.azureToS3.count} azureToS3.bytes=${totals.azureToS3.bytes} ` +
      `s3ToAzure.count=${totals.s3ToAzure.count} s3ToAzure.bytes=${totals.s3ToAzure.bytes} ` +
      `additiveCandidates=${totals.additiveCandidates} ` +
      `candidateSetSha256=${additiveSummary.candidateSetSha256}`,
  );

  const machineReport = buildMachineReadableReconcileReport(
    additiveSummary,
    heal ? 'HEAL' : 'REPORT',
    new Date().toISOString(),
    {
      ...(apiImageDigest !== undefined ? { apiImageDigest } : {}),
      ...(operatorCommitSha !== undefined ? { operatorCommitSha } : {}),
    },
  );
  // Exactly one machine-readable line before REPORT / HEAL decision.
  console.log(formatReconcileReportJsonLine(machineReport));

  const anyGateBlocking = reports.some((r) => isGateBlocking(r.diff));

  // REPORT: unchanged early clean success / divergence exit. HEAL always enters orchestration
  // (including zero candidates) so exact-cap cannot bypass authorization via clean parity.
  if (!heal) {
    if (!anyGateBlocking) {
      for (const r of reports) {
        if (r.diff.suspectedOverwrite.length > 0) {
          console.log(
            `ADVISORY: suspectedOverwrite=${r.diff.suspectedOverwrite.length} in ${r.container} ` +
              `(lastModified hint; unreliable after heals -- NOTE: (key,size) parity only; byte identity ` +
              `is NOT verified here. Same-size content divergence is out of scope and requires a separate ` +
              `byte-level Azure/S3 comparison (not part of this tool) before Azure teardown; does NOT block the gate)`,
          );
        }
      }
      console.log(
        `RECONCILED: 0 (key,size) divergence across ${containers.length} containers ` +
          `(hard gate is (key,size) parity; suspectedOverwrite is an advisory lastModified hint, ` +
          `unreliable after heals) -- NOTE: (key,size) parity only; byte identity is NOT verified here. ` +
          `Same-size content divergence is out of scope and requires a separate byte-level Azure/S3 ` +
          `comparison (not part of this tool) before Azure teardown.`,
      );
      return 0;
    }

    console.error(
      `DIVERGENCE: not reconciled across ${containers.length} container(s) ` +
        `(onlyOnAzure=${totals.onlyOnAzure}, onlyOnS3=${totals.onlyOnS3}, ` +
        `sizeMismatch=${totals.sizeMismatch}, suspectedOverwrite=${totals.suspectedOverwrite}, ` +
        `azureToS3.bytes=${totals.azureToS3.bytes}, s3ToAzure.bytes=${totals.s3ToAzure.bytes}, ` +
        `candidateSetSha256=${additiveSummary.candidateSetSha256}). ` +
        `Re-run with --heal to copy missing objects only; sizeMismatch/suspectedOverwrite are never auto-healed.`,
    );
    return 1;
  }

  // HEAL: production orchestration (auth first, then additive copies only)
  const healStats = await runAdditiveHealOrchestration({
    reports,
    s3,
    azure,
    wormContainers: wormSet,
    healCap,
    exactCap,
    actualCandidateSetSha256: additiveSummary.candidateSetSha256,
    ...(expectedCandidateSetSha256 !== undefined ? { expectedCandidateSetSha256 } : {}),
  });
  const azureToS3Stats = healStats.azureToS3;
  const s3ToAzureStats = healStats.s3ToAzure;

  const healedCount = azureToS3Stats.healedCount + s3ToAzureStats.healedCount;
  const skippedCount = azureToS3Stats.skippedCount + s3ToAzureStats.skippedCount;
  console.log(
    `Heal summary: healed=${healedCount} skipped=${skippedCount} ` +
      `azureToS3.healed.count=${azureToS3Stats.healedCount} azureToS3.healed.bytes=${azureToS3Stats.healedBytes} ` +
      `azureToS3.skipped.count=${azureToS3Stats.skippedCount} azureToS3.skipped.bytes=${azureToS3Stats.skippedBytes} ` +
      `s3ToAzure.healed.count=${s3ToAzureStats.healedCount} s3ToAzure.healed.bytes=${s3ToAzureStats.healedBytes} ` +
      `s3ToAzure.skipped.count=${s3ToAzureStats.skippedCount} s3ToAzure.skipped.bytes=${s3ToAzureStats.skippedBytes}`,
  );

  // Verification re-diff: additive sides must now be empty; residual content divergence stays red.
  let residualMismatch = 0;
  let residualOverwrite = 0;

  for (const container of containers) {
    try {
      const azureContainer = azure.getContainerClient(container);
      const azureObjs = await listAzureObjects(azureContainer);
      const s3Objs = await listS3Objects(s3, container);
      const diff = diffStores(azureObjs, s3Objs, OVERWRITE_SKEW_TOLERANCE_MS);

      if (diff.onlyOnAzure.length > 0 || diff.onlyOnS3.length > 0) {
        throw new Error(
          `Post-heal verification failed for container "${container}": additive divergence remains ` +
            `(onlyOnAzure=${diff.onlyOnAzure.length}, onlyOnS3=${diff.onlyOnS3.length}). Heal may have failed.`,
        );
      }

      residualMismatch += diff.sizeMismatch.length;
      residualOverwrite += diff.suspectedOverwrite.length;

      console.log(
        `\n[post-heal ${container}] sizeMismatch=${diff.sizeMismatch.length} ` +
          `suspectedOverwrite=${diff.suspectedOverwrite.length}`,
      );
    } catch (e) {
      throw new Error(`[container="${container}"] ${e?.message ?? e}`, { cause: e });
    }
  }

  if (residualMismatch > 0) {
    console.error(
      `DIVERGENCE after heal: sizeMismatch=${residualMismatch} ` + `(not auto-healable). Gate remains red.`,
    );
    return 1;
  }

  if (residualOverwrite > 0) {
    console.log(
      `ADVISORY: residual suspectedOverwrite=${residualOverwrite} after heal ` +
        `(lastModified hint; unreliable after heals -- NOTE: (key,size) parity only; byte identity ` +
        `is NOT verified here. Same-size content divergence is out of scope and requires a separate ` +
        `byte-level Azure/S3 comparison (not part of this tool) before Azure teardown; does NOT block the gate)`,
    );
  }

  console.log(
    `RECONCILED: 0 (key,size) divergence across ${containers.length} containers ` +
      `(hard gate is (key,size) parity; suspectedOverwrite is an advisory lastModified hint, ` +
      `unreliable after heals) -- NOTE: (key,size) parity only; byte identity is NOT verified here. ` +
      `Same-size content divergence is out of scope and requires a separate byte-level Azure/S3 ` +
      `comparison (not part of this tool) before Azure teardown.`,
  );
  return 0;
}

// Only run when invoked directly as a script (npx ts-node …), not when imported by unit tests.
if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error('Reconcile failed:', e?.message ?? e);
      console.error('name:', e?.name);
      console.error('httpStatusCode:', e?.$metadata?.httpStatusCode ?? e?.statusCode);
      console.error('stack:', e?.stack);
      process.exit(1);
    });
}
