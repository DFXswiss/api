/**
 * Standalone Azure ↔ S3/MinIO byte-content verification gate for dual-write cutover.
 *
 * Complements (and does not replace) the (key, size) reconciler in reconcile-stores.ts.
 * That tool deliberately leaves same-size content divergence undetectable; this script
 * closes that gap by proving CONTENT equality (bytes), not just key+size presence.
 * Default mode is REPORT (read-only, no network writes, no hashing): classify every
 * shared key into a proof class and exit 0 only when every shared key is proven equal
 * from metadata/backfill and there are zero missing keys / size mismatches / needs-hash.
 * With `--hash-delta`, keys that still need byte proof are streamed through incremental
 * SHA-256 on both sides (capped, concurrency-limited) and compared.
 *
 * Proof classes (fail-closed — anything not provably equal is gate-blocking):
 *   - metadata-match: Azure contentMD5 (base64) matches S3 single-part ETag under the
 *     assumption that the S3-compatible store returns the full-object MD5 as the ETag
 *     for single-part objects (true for MinIO without SSE-KMS/SSE-C). A non-MD5 ETag
 *     simply fails the comparison and falls through to needs-hash (fail-closed).
 *     No download required when the comparison succeeds.
 *   - backfill-covered: same size, both lastModified <= BACKFILL_PROOF_CUTOFF, and
 *     BACKFILL_CONTENT_PROVEN=true (operator-asserted that the backfill run itself
 *     content-verified every object). Does NOT apply when md5Matches is false.
 *   - size-mismatch: same key, different size — content cannot match; gate-red.
 *   - needs-hash: same size but not proven by metadata or backfill (missing MD5,
 *     multipart ETag, MD5 mismatch, object newer than cutoff, or backfill not proven).
 *     In REPORT mode this is gate-red; with --hash-delta these keys are byte-hashed.
 *
 * Fail-closed principle: there is no silent "assume equal" path. md5Matches===false or
 * null never becomes a pass class; exceeding the hash cap throws; missing keys and
 * size mismatches always block the gate. This tool only reports missing keys — healing
 * them is the job of reconcile-stores.ts and must not be duplicated here.
 *
 * Must run during the dual-write phase, before Azure is switched off / s3-only. A final,
 * fully-authoritative run belongs inside a write-freeze window so concurrent writes cannot
 * race the inventory (the --hash-delta fixpoint loop re-checks keys modified after run
 * start, but a freeze is the only truly authoritative boundary). A green (passing) result
 * from this gate is authoritative ONLY when the run was executed inside a write freeze,
 * because Azure and S3 are listed sequentially / non-atomically, so an overwrite that
 * lands in the window between the two listings is not detectable.
 *
 * BACKFILL_CONTENT_PROVEN precondition: set to the exact string 'true' ONLY after
 * confirming from the backfill run logs that zero objects had unverifiable/unchecked
 * hashes during backfill. Otherwise Azure blobs without an MD5 (common) would only be
 * size-verified, not content-verified, by the backfill-covered class — a silent hole.
 *
 * Trust boundary: this proves content equality at the time the tool ran. Bit-rot
 * occurring afterward is a separate, ongoing storage-scrubbing concern, not something
 * this one-shot gate covers.
 *
 * Very large buckets may need extra heap for --hash-delta runs because inventories and
 * hash work are held in memory, e.g.:
 *   node --max-old-space-size=4096 ./node_modules/.bin/ts-node scripts/storage/verify-content.ts --hash-delta
 *
 * Configuration (no silent credential defaults — fails fast if incomplete):
 *   - S3: S3_ENDPOINT, S3_REGION, S3_ADMIN_ACCESS_KEY, S3_ADMIN_SECRET_KEY
 *   - Azure: AZURE_STORAGE_CONNECTION_STRING
 *   - Containers: CLI positional args or VERIFY_CONTAINERS (space- and/or comma-separated)
 *   - Ignore buckets: VERIFY_IGNORE_BUCKETS (space- and/or comma-separated; optional)
 *   - Mode: --hash-delta or VERIFY_HASH_DELTA=true (default: REPORT)
 *   - BACKFILL_PROOF_CUTOFF: required UTC ISO-8601 date string (YYYY-MM-DDTHH:mm:ssZ)
 *   - BACKFILL_CONTENT_PROVEN: only exact 'true' enables backfill-covered (else false)
 *   - Hash cap: VERIFY_HASH_CAP (positive integer) or DEFAULT_HASH_CAP
 *   - HASH_CONCURRENCY: fixed documented constant (not env-configurable)
 *
 * Run examples:
 *   VERIFY_CONTAINERS="kyc support ep2-example" BACKFILL_PROOF_CUTOFF=2026-07-14T00:00:00Z BACKFILL_CONTENT_PROVEN=true npx ts-node scripts/storage/verify-content.ts
 *   VERIFY_CONTAINERS="kyc support ep2-example" BACKFILL_PROOF_CUTOFF=2026-07-14T00:00:00Z BACKFILL_CONTENT_PROVEN=true npx ts-node scripts/storage/verify-content.ts --hash-delta
 *   BACKFILL_PROOF_CUTOFF=2026-07-14T00:00:00Z BACKFILL_CONTENT_PROVEN=false \
 *     npx ts-node scripts/storage/verify-content.ts kyc support --hash-delta
 *
 * Scope boundary: Azure SAS connection strings cannot list containers, so the requested
 * list is intentionally Azure's authority for which stores are verified. Every existing
 * S3 bucket must either be in the requested container list or explicitly declared via
 * VERIFY_IGNORE_BUCKETS (non-document / system buckets) — unaccounted buckets fail hard.
 */

import { GetObjectCommand, ListBucketsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

/** Marker checked by the production wrapper before storage credentials reach this script. */
export const CONTENT_VERIFY_PRIVACY_LOG_VERSION = 'storage-content-verify-private-logs-v1';

/** Max needs-hash keys hashed per run when VERIFY_HASH_CAP is unset. Logged at runtime. */
export const DEFAULT_HASH_CAP = 5000;

/** Concurrent SHA-256 stream pairs during --hash-delta. Logged at runtime; not env-configurable. */
export const HASH_CONCURRENCY = 2;

/** Max fixpoint re-list/re-hash iterations for keys modified after runStart. */
const MAX_FIXPOINT_ITERATIONS = 10;

/** Pacing delay (ms) between concurrent hash batches to avoid I/O storms. */
const HASH_BATCH_PACING_MS = 100;

/** UTC-only, seconds mandatory, `Z` suffix mandatory for BACKFILL_PROOF_CUTOFF. */
const ISO_8601_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export interface ContentObject {
  key: string;
  size: number;
  lastModified: Date;
  contentMd5?: string; // base64 string, Azure only, when present
  /** Native ETag/version id from list response (raw as returned by the SDK), both stores. */
  etag: string;
}

export type ProofClass = 'metadata-match' | 'backfill-covered' | 'size-mismatch' | 'needs-hash';

// Unit-testable pure helpers — no I/O.
// --- PURE CLASSIFICATION / GUARDS --- //

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
 * Remove a matching pair of surrounding double quotes only.
 * Leading-only or trailing-only quotes are left unchanged so malformed values
 * do not collide after normalization (e.g. `"abc` vs `abc"`).
 * A single-character `"` is not stripped (needs length >= 2 with both ends quoted).
 */
function stripPairedQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/** True when a trimmed ETag is a weak validator (RFC 7232 §2.1 `W/` prefix). */
function isWeakValidator(etag: string): boolean {
  return etag.trim().startsWith('W/');
}

/**
 * True iff the ETag (paired surrounding quotes stripped) is exactly 32 hex chars — the
 * shape of a single-part upload MD5. Multipart ETags have the form `<32-hex>-<partCount>`
 * and are never a whole-object MD5. Shape alone does not prove the value is an MD5
 * (see md5Matches).
 */
export function isSinglePartEtag(etag: string): boolean {
  const stripped = stripPairedQuotes(etag);
  return /^[0-9a-fA-F]{32}$/.test(stripped);
}

/**
 * Compare Azure contentMD5 (base64) to S3 single-part ETag under the assumption that the
 * S3-compatible store returns the full-object MD5 as the ETag for single-part objects
 * (holds for MinIO without SSE-KMS/SSE-C). This is not a general-case proof of MD5
 * equality: a non-MD5 ETag (e.g. under SSE-KMS) will not match Azure contentMD5, so this
 * returns false and classification falls through to needs-hash (fail-closed, safe).
 * Returns null when not comparable (missing md5, missing etag, or multipart etag).
 */
export function md5Matches(azureContentMd5: string | undefined, s3Etag: string | undefined): boolean | null {
  if (azureContentMd5 === undefined || s3Etag === undefined) return null;
  if (!isSinglePartEtag(s3Etag)) return null;

  const etagHex = stripPairedQuotes(s3Etag).toLowerCase();

  const azureHex = Buffer.from(azureContentMd5, 'base64').toString('hex').toLowerCase();
  return azureHex === etagHex;
}

/**
 * Stable signature of the listed Azure+S3 object pair used to bind a prior hash proof
 * to that exact listing state. Bound to both sides' ETags (each store's own version
 * identifier, which changes on every write to that side) and sizes — not timestamps —
 * so a same-second overwrite on either side reliably invalidates a stale hash proof
 * regardless of clock granularity.
 */
export function objectSignature(azure: ContentObject, s3: ContentObject): string {
  return `${azure.etag}|${azure.size}|${s3.etag}|${s3.size}`;
}

/**
 * Normalize an ETag for version comparison across list vs download APIs.
 * Trims leading/trailing whitespace and strips a matching pair of surrounding double
 * quotes. Listing and download often disagree only on quoting (e.g. Azure list returns
 * unquoted; download returns quoted). Does not strip a weak-validator `W/` prefix —
 * weak validators are rejected by assertHashVersionUnchanged (RFC 7232 §2.1: a weak
 * validator does not guarantee byte identity).
 */
export function normalizeEtag(etag: string): string {
  return stripPairedQuotes(etag.trim());
}

/**
 * Guards against TOCTOU/ABA: the object that was actually hashed (download-time ETag)
 * must be the exact same version that was listed (listing-time ETag) — otherwise the
 * proof we are about to store would vouch for bytes we never actually hashed.
 * Weak validators (RFC 7232 §2.1) fail closed: they do not prove byte identity, so the
 * hash proof cannot be bound to them even when both sides share the same trailing value.
 */
export function assertHashVersionUnchanged(listedEtag: string, downloadedEtag: string, label: string): void {
  if (isWeakValidator(listedEtag) || isWeakValidator(downloadedEtag)) {
    throw new Error(
      `weak validator does not guarantee byte identity; hash proof cannot be bound to it — ${label}: ` +
        `listedEtag=${listedEtag} downloadedEtag=${downloadedEtag}`,
    );
  }
  if (normalizeEtag(listedEtag) !== normalizeEtag(downloadedEtag)) {
    throw new Error(
      `object changed between listing and hash — ${label}: listedEtag=${listedEtag} downloadedEtag=${downloadedEtag}`,
    );
  }
}

/**
 * True only if a prior hash proof still matches the CURRENT listed objects.
 * Mutates `provenByHash`: deletes the entry when the signature no longer matches.
 */
export function isStillProvenByHash(
  provenByHash: Map<string, string>,
  sk: string,
  azureObj: ContentObject,
  s3Obj: ContentObject,
): boolean {
  const provenSig = provenByHash.get(sk);
  if (provenSig === undefined) return false;
  const currentSig = objectSignature(azureObj, s3Obj);
  if (provenSig === currentSig) return true;
  // Object changed since hash — discard stale proof so the key is reclassified/re-hashed.
  provenByHash.delete(sk);
  return false;
}

/**
 * Classify a key present on both sides into a proof class.
 * Fail-closed: md5Matches===false never yields metadata-match or backfill-covered.
 */
export function classifyKey(
  azure: ContentObject,
  s3: ContentObject,
  backfillCutoff: Date,
  backfillContentProven: boolean,
): ProofClass {
  if (azure.size !== s3.size) return 'size-mismatch';

  const md5 = md5Matches(azure.contentMd5, s3.etag);
  if (md5 === true) return 'metadata-match';

  // Known MD5 content mismatch must never be treated as backfill-covered (fail-closed).
  if (md5 === false) return 'needs-hash';

  // md5 === null: not provable from metadata alone.
  if (
    backfillContentProven === true &&
    azure.lastModified.getTime() <= backfillCutoff.getTime() &&
    s3.lastModified.getTime() <= backfillCutoff.getTime()
  ) {
    return 'backfill-covered';
  }

  return 'needs-hash';
}

/** Fail if the number of needs-hash keys to hash exceeds the configured cap. */
export function assertWithinHashCap(count: number, cap: number): void {
  if (count > cap) {
    throw new Error(
      `needs-hash count ${count} exceeds hash cap ${cap}. ` +
        `Raise VERIFY_HASH_CAP only after reviewing the report, or hash in smaller batches.`,
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
        `Provision missing buckets before verifying content.`,
    );
  }
}

/**
 * Fail if an S3 bucket is neither verified nor explicitly ignored. This prevents a
 * partial container list from producing a false-green cutover result.
 */
export function assertBucketsAccounted(existingS3Buckets: string[], requested: string[], ignore: string[]): void {
  const accounted = new Set([...requested, ...ignore]);
  const unaccounted = existingS3Buckets.filter((name) => !accounted.has(name));
  if (unaccounted.length > 0) {
    throw new Error(
      `Unaccounted S3 bucket(s): ${unaccounted.join(', ')}. ` +
        `Each must either be content-verified (added to VERIFY_CONTAINERS) or explicitly ` +
        `declared as a non-document-store via VERIFY_IGNORE_BUCKETS.`,
    );
  }
}

/** Stable, non-reversible object reference for logs; raw document keys may contain PII. */
export function safeObjectReference(container: string, key: string): string {
  const keyDigest = crypto.createHash('sha256').update(key).digest('hex');
  return `${container}/key-sha256:${keyDigest}`;
}

// size/lastModified/etag/md5 from list pages only — no HeadObject per key.
// --- LISTING --- //

export async function listS3(client: S3Client, bucket: string): Promise<ContentObject[]> {
  const objects: ContentObject[] = [];
  let token: string | undefined;

  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }),
    );

    assertPageComplete(res.IsTruncated === true, res.NextContinuationToken);

    for (const o of res.Contents ?? []) {
      if (
        o.Key == null ||
        o.Key === '' ||
        o.Size == null ||
        o.LastModified == null ||
        o.ETag == null ||
        o.ETag === ''
      ) {
        throw new Error(
          `Incomplete S3 list entry in bucket "${bucket}"` +
            (o.Key != null && o.Key !== '' ? ` object=${safeObjectReference(bucket, o.Key)}` : '') +
            `: Key, Size, LastModified and ETag are required from ListObjectsV2 (no HeadObject fallback)`,
        );
      }
      objects.push({
        key: o.Key,
        size: o.Size,
        lastModified: o.LastModified,
        etag: o.ETag,
      });
    }

    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  return objects;
}

export async function listS3Buckets(client: S3Client): Promise<string[]> {
  const buckets: string[] = [];
  let token: string | undefined;

  do {
    const res = await client.send(new ListBucketsCommand({ ContinuationToken: token }));
    for (const bucket of res.Buckets ?? []) {
      if (bucket.Name == null || bucket.Name === '') {
        throw new Error('Incomplete S3 ListBuckets entry: Name is required (refusing silent skip of unnamed bucket)');
      }
      buckets.push(bucket.Name);
    }
    token = res.ContinuationToken;
  } while (token);

  return buckets;
}

export async function listAzure(containerClient: ContainerClient): Promise<ContentObject[]> {
  const objects: ContentObject[] = [];
  const container = containerClient.containerName;

  for await (const b of containerClient.listBlobsFlat()) {
    const name = b.name;
    const contentLength = b.properties?.contentLength;
    const lastModified = b.properties?.lastModified;
    const etag = b.properties?.etag;

    if (name == null || name === '' || contentLength == null || lastModified == null || etag == null || etag === '') {
      throw new Error(
        `Incomplete Azure list entry in container "${container}"` +
          (name != null && name !== '' ? ` object=${safeObjectReference(container, name)}` : '') +
          `: name, properties.contentLength, properties.lastModified and properties.etag are required from listBlobsFlat`,
      );
    }

    let contentMd5: string | undefined;
    if (b.properties?.contentMD5 != null) {
      contentMd5 = Buffer.from(b.properties.contentMD5).toString('base64');
    }

    objects.push({
      key: name,
      size: contentLength,
      lastModified,
      contentMd5,
      etag,
    });
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

export function parseConfig(): {
  containers: string[];
  ignoreBuckets: string[];
  hashDelta: boolean;
  backfillCutoff: Date;
  backfillContentProven: boolean;
  hashCap: number;
} {
  const args = process.argv.slice(2);

  for (const a of args) {
    if (a.startsWith('--') && a !== '--hash-delta') {
      throw new Error(`Unknown flag: ${a}`);
    }
  }

  const hashDelta = args.includes('--hash-delta') || process.env.VERIFY_HASH_DELTA === 'true';

  let containers = args.filter((a) => !a.startsWith('--'));
  if (containers.length === 0) {
    const envList = process.env.VERIFY_CONTAINERS;
    if (envList) containers = parseContainerList(envList);
  }
  if (containers.length === 0) {
    throw new Error(
      'No containers specified. Pass container names as CLI args or set VERIFY_CONTAINERS ' +
        '(space- and/or comma-separated).',
    );
  }
  containers = dedupePreserveOrder(containers);

  const ignoreRaw = process.env.VERIFY_IGNORE_BUCKETS;
  const ignoreBuckets = ignoreRaw ? dedupePreserveOrder(parseContainerList(ignoreRaw)) : [];

  const cutoffRaw = process.env.BACKFILL_PROOF_CUTOFF;
  if (cutoffRaw === undefined || cutoffRaw === '') {
    throw new Error(
      'BACKFILL_PROOF_CUTOFF is required (ISO-8601 date string). ' +
        'Set it to the backfill completion timestamp used as the content-proof cutoff.',
    );
  }
  if (!ISO_8601_UTC_REGEX.test(cutoffRaw)) {
    throw new Error(`BACKFILL_PROOF_CUTOFF must be UTC ISO-8601 ending in Z: ${cutoffRaw}`);
  }
  const backfillCutoff = new Date(cutoffRaw);
  if (Number.isNaN(backfillCutoff.getTime())) {
    throw new Error(`Invalid BACKFILL_PROOF_CUTOFF: ${cutoffRaw} (expected ISO-8601 date string)`);
  }
  if (backfillCutoff.toISOString().slice(0, 19) !== cutoffRaw.slice(0, 19)) {
    throw new Error(`BACKFILL_PROOF_CUTOFF is not a valid calendar date/time (rolled over): ${cutoffRaw}`);
  }
  if (backfillCutoff.getTime() > Date.now()) {
    throw new Error(
      `BACKFILL_PROOF_CUTOFF is in the future (${cutoffRaw}). ` +
        `A future cutoff with BACKFILL_CONTENT_PROVEN=true would let virtually every current ` +
        `object pass as backfill-covered without any MD5 proof.`,
    );
  }

  const backfillContentProven = process.env.BACKFILL_CONTENT_PROVEN === 'true';

  const rawCap = process.env.VERIFY_HASH_CAP;
  let hashCap = DEFAULT_HASH_CAP;
  if (rawCap !== undefined) {
    const n = Number(rawCap);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Invalid VERIFY_HASH_CAP: ${rawCap} (expected positive integer)`);
    }
    hashCap = n;
  }

  return { containers, ignoreBuckets, hashDelta, backfillCutoff, backfillContentProven, hashCap };
}

// --- HASHING --- //

/**
 * Fail-loud guard: a truncated stream that still emits 'end' must not produce a trusted hash.
 */
export function assertHashedSize(total: number, expected: number): void {
  if (total !== expected) {
    throw new Error(
      `Stream byte count ${total} does not match expected size ${expected}; ` +
        `hash is incomplete or truncated and must not be trusted.`,
    );
  }
}

/**
 * Stream a readable through incremental SHA-256; do not buffer the whole object.
 * `expectedSize` is the known listing size; after 'end', the accumulated byte count must
 * match or the hash is rejected (fail-loud against silent truncation).
 */
export async function streamSha256(readable: NodeJS.ReadableStream, expectedSize: number): Promise<string> {
  const hash = crypto.createHash('sha256');
  let total = 0;
  return new Promise<string>((resolve, reject) => {
    readable.on('data', (chunk: Buffer | string) => {
      total += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      hash.update(chunk);
    });
    readable.on('end', () => {
      try {
        assertHashedSize(total, expectedSize);
        resolve(hash.digest('hex'));
      } catch (err) {
        reject(err);
      }
    });
    readable.on('error', (err) => reject(err));
  });
}

async function hashAzureBlob(
  containerClient: ContainerClient,
  key: string,
  expectedSize: number,
): Promise<{ digest: string; etag: string }> {
  const download = await containerClient.getBlobClient(key).download();
  if (!download.readableStreamBody) {
    throw new Error(
      `Empty readableStreamBody for Azure blob ${safeObjectReference(containerClient.containerName, key)}`,
    );
  }
  if (!download.etag) {
    throw new Error(
      `Missing etag on Azure download response for ${safeObjectReference(containerClient.containerName, key)}`,
    );
  }
  const digest = await streamSha256(download.readableStreamBody, expectedSize);
  return { digest, etag: download.etag };
}

async function hashS3Object(
  client: S3Client,
  bucket: string,
  key: string,
  expectedSize: number,
): Promise<{ digest: string; etag: string }> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) {
    throw new Error(`Empty body for S3 object ${safeObjectReference(bucket, key)}`);
  }
  if (!res.ETag) {
    throw new Error(`Missing ETag on S3 GetObject response for ${safeObjectReference(bucket, key)}`);
  }
  const digest = await streamSha256(res.Body as NodeJS.ReadableStream, expectedSize);
  return { digest, etag: res.ETag };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run async work over items with fixed concurrency and a pacing delay between batches.
 */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  pacingMs: number,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((item) => fn(item)));
    results.push(...batchResults);
    if (i + concurrency < items.length && pacingMs > 0) {
      await sleep(pacingMs);
    }
  }
  return results;
}

// --- CLASSIFICATION AGGREGATION --- //

export interface ContainerClassification {
  container: string;
  missingKeys: string[];
  metadataMatch: string[];
  backfillCovered: string[];
  sizeMismatch: string[];
  needsHash: string[];
  needsHashBytes: number;
  azureMap: Map<string, ContentObject>;
  s3Map: Map<string, ContentObject>;
}

export function classifyContainer(
  container: string,
  azureObjs: ContentObject[],
  s3Objs: ContentObject[],
  backfillCutoff: Date,
  backfillContentProven: boolean,
): ContainerClassification {
  const azureMap = new Map<string, ContentObject>();
  for (const o of azureObjs) azureMap.set(o.key, o);

  const s3Map = new Map<string, ContentObject>();
  for (const o of s3Objs) s3Map.set(o.key, o);

  const missingKeys: string[] = [];
  const metadataMatch: string[] = [];
  const backfillCovered: string[] = [];
  const sizeMismatch: string[] = [];
  const needsHash: string[] = [];
  let needsHashBytes = 0;

  for (const key of azureMap.keys()) {
    if (!s3Map.has(key)) missingKeys.push(key);
  }
  for (const key of s3Map.keys()) {
    if (!azureMap.has(key)) missingKeys.push(key);
  }

  for (const [key, azureObj] of azureMap) {
    const s3Obj = s3Map.get(key);
    if (!s3Obj) continue;
    const cls = classifyKey(azureObj, s3Obj, backfillCutoff, backfillContentProven);
    switch (cls) {
      case 'metadata-match':
        metadataMatch.push(key);
        break;
      case 'backfill-covered':
        backfillCovered.push(key);
        break;
      case 'size-mismatch':
        sizeMismatch.push(key);
        break;
      case 'needs-hash':
        needsHash.push(key);
        needsHashBytes += azureObj.size;
        break;
    }
  }

  return {
    container,
    missingKeys,
    metadataMatch,
    backfillCovered,
    sizeMismatch,
    needsHash,
    needsHashBytes,
    azureMap,
    s3Map,
  };
}

function printCategory(label: string, keys: string[]): void {
  console.log(`    ${label}: ${keys.length}`);
}

function sumField(reports: ContainerClassification[], field: keyof ContainerClassification): number {
  return reports.reduce((sum, r) => {
    const v = r[field];
    return sum + (Array.isArray(v) ? v.length : 0);
  }, 0);
}

function sumNeedsHashBytes(reports: ContainerClassification[]): number {
  return reports.reduce((sum, report) => sum + report.needsHashBytes, 0);
}

// --- MAIN --- //

async function main(): Promise<number> {
  const runStart = new Date();
  const { containers, ignoreBuckets, hashDelta, backfillCutoff, backfillContentProven, hashCap } = parseConfig();
  const s3 = buildS3Client();
  const azure = buildAzureClient();

  const existingS3Buckets = await listS3Buckets(s3);
  assertRequestedContainersExist(existingS3Buckets, containers);
  assertBucketsAccounted(existingS3Buckets, containers, ignoreBuckets);

  console.log(
    `Content verify: containers=[${containers.join(', ')}] ignoreBuckets=[${ignoreBuckets.join(', ')}] ` +
      `mode=${hashDelta ? 'HASH-DELTA' : 'REPORT'} ` +
      `privacyLogVersion=${CONTENT_VERIFY_PRIVACY_LOG_VERSION} ` +
      `backfillCutoff=${backfillCutoff.toISOString()} ` +
      `BACKFILL_CONTENT_PROVEN=${backfillContentProven} ` +
      `hashCap=${hashCap}${process.env.VERIFY_HASH_CAP === undefined ? ` (DEFAULT_HASH_CAP)` : ''} ` +
      `hashConcurrency=${HASH_CONCURRENCY} ` +
      `runStart=${runStart.toISOString()}`,
  );

  if (backfillContentProven) {
    console.log(
      'TRUST ASSUMPTION: BACKFILL_CONTENT_PROVEN=true — backfill-covered will accept ' +
        'pre-cutoff same-size objects without per-object MD5. Confirm from the backfill run logs ' +
        'that zero objects had unverifiable/unchecked hashes before relying on this gate.',
    );
  } else {
    console.log(
      'BACKFILL_CONTENT_PROVEN=false — backfill-covered class is disabled; ' +
        'pre-cutoff objects without MD5/ETag match will be needs-hash.',
    );
  }

  const reports: ContainerClassification[] = [];

  for (const container of containers) {
    try {
      const azureContainer = azure.getContainerClient(container);
      const azureObjs = await listAzure(azureContainer);
      const s3Objs = await listS3(s3, container);
      const report = classifyContainer(container, azureObjs, s3Objs, backfillCutoff, backfillContentProven);
      reports.push(report);

      console.log(`\n[${container}] azure=${azureObjs.length} s3=${s3Objs.length}`);
      printCategory('metadata-match', report.metadataMatch);
      printCategory('backfill-covered', report.backfillCovered);
      printCategory('size-mismatch', report.sizeMismatch);
      printCategory('needs-hash', report.needsHash);
      console.log(`    needs-hash-bytes: ${report.needsHashBytes}`);
      printCategory('missingKeys', report.missingKeys);
    } catch (e) {
      throw new Error(`[container="${container}"] ${e?.message ?? e}`, { cause: e });
    }
  }

  const totals = {
    metadataMatch: sumField(reports, 'metadataMatch'),
    backfillCovered: sumField(reports, 'backfillCovered'),
    sizeMismatch: sumField(reports, 'sizeMismatch'),
    needsHash: sumField(reports, 'needsHash'),
    needsHashBytes: sumNeedsHashBytes(reports),
    missingKeys: sumField(reports, 'missingKeys'),
  };

  console.log(
    `\nAGGREGATE across ${containers.length} container(s): ` +
      `metadata-match=${totals.metadataMatch} backfill-covered=${totals.backfillCovered} ` +
      `size-mismatch=${totals.sizeMismatch} needs-hash=${totals.needsHash} ` +
      `needs-hash-bytes=${totals.needsHashBytes} ` +
      `missingKeys=${totals.missingKeys}`,
  );

  // REPORT mode (default): classify only; no hashing / no network writes.
  if (!hashDelta) {
    const green = totals.sizeMismatch === 0 && totals.needsHash === 0 && totals.missingKeys === 0;

    if (green) {
      console.log(
        `CONTENT VERIFIED (REPORT): all shared keys are metadata-match or backfill-covered; ` +
          `0 size-mismatch, 0 needs-hash, 0 missingKeys across ${containers.length} container(s).`,
      );
      console.log(
        `AUTHORITATIVE ONLY UNDER A WRITE FREEZE: this gate lists Azure and S3 non-atomically, ` +
          `so an overwrite during the listing window is not detectable. Treat a green result ` +
          `from an unfrozen (live dual-write) run as provisional; the final authoritative run ` +
          `MUST hold a write freeze.`,
      );
      return 0;
    }

    const parts: string[] = [];
    if (totals.needsHash > 0) {
      parts.push(`${totals.needsHash} key(s) need byte-hash verification -- run with --hash-delta`);
    }
    if (totals.sizeMismatch > 0) {
      parts.push(`size-mismatch=${totals.sizeMismatch}`);
    }
    if (totals.missingKeys > 0) {
      parts.push(`missingKeys=${totals.missingKeys}`);
    }
    console.error(
      `CONTENT GATE RED (REPORT): ${parts.join('; ')}. ` +
        `Gate is green only when every shared key is metadata-match or backfill-covered ` +
        `and size-mismatch/needs-hash/missingKeys are all 0.`,
    );
    return 1;
  }

  // --- HASH-DELTA mode --- //
  type HashWorkItem = { container: string; key: string };
  type Divergence = { container: string; key: string };

  const contentDivergence: Divergence[] = [];
  // scopedKey -> objectSignature at the time the hash was computed (binds proof to listing state).
  const provenByHash = new Map<string, string>();
  let totalHashed = 0;

  const scopedKey = (container: string, key: string): string => `${container}\0${key}`;

  async function hashWorkItems(items: HashWorkItem[]): Promise<void> {
    if (items.length === 0) return;

    // Cap applies to the cumulative needs-hash set hashed this run.
    assertWithinHashCap(totalHashed + items.length, hashCap);
    totalHashed += items.length;

    console.log(
      `Hashing ${items.length} needs-hash key(s) with concurrency=${HASH_CONCURRENCY} ` +
        `(cumulative=${totalHashed}, cap=${hashCap})...`,
    );

    await mapPool(
      items,
      HASH_CONCURRENCY,
      async (item) => {
        try {
          const report = reports.find((r) => r.container === item.container);
          if (!report) {
            throw new Error(`No classification report for container "${item.container}" while hashing`);
          }
          const azureObj = report.azureMap.get(item.key);
          const s3Obj = report.s3Map.get(item.key);
          const objectRef = safeObjectReference(item.container, item.key);
          if (!azureObj || !s3Obj) {
            throw new Error(
              `Missing list metadata for ${objectRef} while hashing ` +
                `(both sides required; size mismatch would not reach hashing)`,
            );
          }
          // Both sides share the same size here; size-mismatch never reaches hashing.
          const expectedSize = azureObj.size;

          const azureContainer = azure.getContainerClient(item.container);
          const [azureResult, s3Result] = await Promise.all([
            hashAzureBlob(azureContainer, item.key, expectedSize),
            hashS3Object(s3, item.container, item.key, expectedSize),
          ]);

          try {
            assertHashVersionUnchanged(azureObj.etag, azureResult.etag, `azure ${objectRef}`);
            assertHashVersionUnchanged(s3Obj.etag, s3Result.etag, `s3 ${objectRef}`);
          } catch (versionErr) {
            console.log(`SKIP (changed during hash, will re-list) ${objectRef}: ` + `${(versionErr as Error).message}`);
            return;
          }

          if (azureResult.digest === s3Result.digest) {
            provenByHash.set(scopedKey(item.container, item.key), objectSignature(azureObj, s3Obj));
            console.log(`HASH MATCH ${objectRef}`);
          } else {
            contentDivergence.push({ container: item.container, key: item.key });
            console.error(
              `CONTENT DIVERGENCE ${objectRef}: ` + `azureSha256=${azureResult.digest} s3Sha256=${s3Result.digest}`,
            );
          }
        } catch (e) {
          throw new Error(
            `[object="${safeObjectReference(item.container, item.key)}"] hash failed: ${e?.message ?? e}`,
            {
              cause: e,
            },
          );
        }
      },
      HASH_BATCH_PACING_MS,
    );
  }

  // Initial needs-hash set across all containers.
  const pending: HashWorkItem[] = [];
  for (const r of reports) {
    for (const key of r.needsHash) {
      pending.push({ container: r.container, key });
    }
  }

  await hashWorkItems(pending);

  // Fixpoint: re-list containers and re-classify keys modified after runStart until stable.
  let iteration = 0;
  let fixpointStable = false;
  while (iteration < MAX_FIXPOINT_ITERATIONS) {
    iteration++;
    const newNeedsHash: HashWorkItem[] = [];
    const alreadyQueued = new Set<string>();

    for (const container of containers) {
      try {
        const azureContainer = azure.getContainerClient(container);
        const azureObjs = await listAzure(azureContainer);
        const s3Objs = await listS3(s3, container);
        const report = classifyContainer(container, azureObjs, s3Objs, backfillCutoff, backfillContentProven);

        // Replace report in place for intermediate logging / final path consistency.
        const idx = reports.findIndex((r) => r.container === container);
        if (idx >= 0) reports[idx] = report;
        else reports.push(report);

        const candidateKeys = new Set<string>();
        for (const o of azureObjs) {
          if (o.lastModified.getTime() > runStart.getTime()) candidateKeys.add(o.key);
        }
        for (const o of s3Objs) {
          if (o.lastModified.getTime() > runStart.getTime()) candidateKeys.add(o.key);
        }

        // Re-classify keys touched after runStart, plus any remaining needs-hash not yet resolved.
        for (const key of report.needsHash) {
          candidateKeys.add(key);
        }

        for (const key of candidateKeys) {
          const sk = scopedKey(container, key);
          if (contentDivergence.some((d) => d.container === container && d.key === key)) continue;
          if (alreadyQueued.has(sk)) continue;

          const azureObj = report.azureMap.get(key);
          const s3Obj = report.s3Map.get(key);
          if (!azureObj || !s3Obj) continue; // missing on one side — handled by missingKeys

          // Only skip when the CURRENT listed objects still match the hash-time signature.
          if (isStillProvenByHash(provenByHash, sk, azureObj, s3Obj)) continue;

          const cls = classifyKey(azureObj, s3Obj, backfillCutoff, backfillContentProven);
          if (cls === 'needs-hash') {
            alreadyQueued.add(sk);
            newNeedsHash.push({ container, key });
          }
        }
      } catch (e) {
        throw new Error(`[container="${container}"] fixpoint re-list failed: ${e?.message ?? e}`, {
          cause: e,
        });
      }
    }

    if (newNeedsHash.length === 0) {
      fixpointStable = true;
      break;
    }

    console.log(
      `Fixpoint iteration ${iteration}: ${newNeedsHash.length} needs-hash key(s) remaining/new after re-list`,
    );
    await hashWorkItems(newNeedsHash);
  }

  if (!fixpointStable) {
    throw new Error(
      `Fixpoint loop exceeded MAX_FIXPOINT_ITERATIONS=${MAX_FIXPOINT_ITERATIONS} ` +
        `with unresolved needs-hash keys. ` +
        `Re-run inside a write-freeze window for an authoritative result.`,
    );
  }

  // Final inventory for gate decision (full re-list + re-classify).
  const finalReports: ContainerClassification[] = [];
  for (const container of containers) {
    try {
      const azureContainer = azure.getContainerClient(container);
      const azureObjs = await listAzure(azureContainer);
      const s3Objs = await listS3(s3, container);
      finalReports.push(classifyContainer(container, azureObjs, s3Objs, backfillCutoff, backfillContentProven));
    } catch (e) {
      throw new Error(`[container="${container}"] final re-list failed: ${e?.message ?? e}`, { cause: e });
    }
  }

  let remainingNeedsHash = 0;
  for (const r of finalReports) {
    for (const key of r.needsHash) {
      const sk = scopedKey(r.container, key);
      if (contentDivergence.some((d) => d.container === r.container && d.key === key)) continue;

      const azureObj = r.azureMap.get(key);
      const s3Obj = r.s3Map.get(key);
      if (!azureObj || !s3Obj) {
        // needs-hash keys are always present on both sides; missing map entry is still gate-red.
        remainingNeedsHash++;
        continue;
      }

      // Only treat as resolved when the CURRENT listed objects still match the hash-time signature.
      if (isStillProvenByHash(provenByHash, sk, azureObj, s3Obj)) continue;

      remainingNeedsHash++;
    }
  }

  const finalTotals = {
    metadataMatch: sumField(finalReports, 'metadataMatch'),
    backfillCovered: sumField(finalReports, 'backfillCovered'),
    sizeMismatch: sumField(finalReports, 'sizeMismatch'),
    needsHash: remainingNeedsHash,
    missingKeys: sumField(finalReports, 'missingKeys'),
    contentDivergence: contentDivergence.length,
  };

  console.log(
    `\nHASH-DELTA FINAL across ${containers.length} container(s): ` +
      `metadata-match=${finalTotals.metadataMatch} backfill-covered=${finalTotals.backfillCovered} ` +
      `size-mismatch=${finalTotals.sizeMismatch} remaining-needs-hash=${finalTotals.needsHash} ` +
      `missingKeys=${finalTotals.missingKeys} contentDivergence=${finalTotals.contentDivergence} ` +
      `provenByHash=${provenByHash.size}`,
  );

  if (contentDivergence.length > 0) {
    console.error('CONTENT DIVERGENCE keys (same size, different bytes) — most severe finding:');
    for (const d of contentDivergence) {
      console.error(`  - ${safeObjectReference(d.container, d.key)}`);
    }
  }

  const green =
    contentDivergence.length === 0 &&
    remainingNeedsHash === 0 &&
    finalTotals.sizeMismatch === 0 &&
    finalTotals.missingKeys === 0;

  if (green) {
    console.log(
      `CONTENT VERIFIED (HASH-DELTA): 0 contentDivergence, 0 remaining needs-hash, ` +
        `0 size-mismatch, 0 missingKeys across ${containers.length} container(s).`,
    );
    console.log(
      `AUTHORITATIVE ONLY UNDER A WRITE FREEZE: this gate lists Azure and S3 non-atomically, ` +
        `so an overwrite during the listing window is not detectable. Treat a green result ` +
        `from an unfrozen (live dual-write) run as provisional; the final authoritative run ` +
        `MUST hold a write freeze.`,
    );
    return 0;
  }

  const parts: string[] = [];
  if (contentDivergence.length > 0) {
    parts.push(`contentDivergence=${contentDivergence.length}`);
  }
  if (remainingNeedsHash > 0) {
    parts.push(`remaining-needs-hash=${remainingNeedsHash}`);
  }
  if (finalTotals.sizeMismatch > 0) {
    parts.push(`size-mismatch=${finalTotals.sizeMismatch}`);
  }
  if (finalTotals.missingKeys > 0) {
    parts.push(`missingKeys=${finalTotals.missingKeys}`);
  }
  console.error(
    `CONTENT GATE RED (HASH-DELTA): ${parts.join('; ')}. ` +
      `Gate is green only with 0 contentDivergence, 0 remaining needs-hash, ` +
      `0 size-mismatch, and 0 missingKeys.`,
  );
  return 1;
}

// Only run when invoked directly as a script (npx ts-node …), not when imported by unit tests.
if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error('Content verify failed:', e?.message ?? e);
      console.error('name:', e?.name);
      console.error('httpStatusCode:', e?.$metadata?.httpStatusCode ?? e?.statusCode);
      console.error('stack:', e?.stack);
      process.exit(1);
    });
}
