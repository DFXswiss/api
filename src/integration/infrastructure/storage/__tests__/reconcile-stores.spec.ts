import {
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { Readable } from 'stream';
import {
  assertBucketWorm,
  assertBucketWormIfDeclared,
  assertBucketsAccounted,
  assertExactHealBinding,
  assertNotOneSidedEmpty,
  assertPageComplete,
  assertRequestedContainersExist,
  assertUndeclaredBucketHasNoWorm,
  assertWithinHealCap,
  assertWormContainersConfig,
  buildAdditiveReconcileSummary,
  buildMachineReadableReconcileReport,
  collectAdditiveCandidatesForContainer,
  computeCandidateSetSha256,
  copyAzureToS3,
  copyS3ToAzure,
  DEFAULT_HEAL_CAP,
  diffStores,
  DiffResult,
  formatDetailObjectLine,
  formatReconcileReportJsonLine,
  hashObjectKeySha256,
  HealContainerReport,
  indexStoredObjectsByKey,
  isAzurePreconditionFailed,
  isGateBlocking,
  isS3PreconditionFailed,
  listAzureObjects,
  listS3Objects,
  logObjectAction,
  OVERWRITE_SKEW_TOLERANCE_MS,
  parseConfig,
  printCategory,
  RECONCILE_REPORT_SCHEMA_VERSION,
  RECONCILER_PRIVACY_LOG_VERSION,
  runAdditiveHealOrchestration,
  safeObjectReference,
  StoredObject,
} from '../../../../../scripts/storage/reconcile-stores';
import { GEBUEV_RETENTION_FLOOR_DAYS, GEBUEV_RETENTION_FLOOR_YEARS } from '../worm-retention.const';

const s3Mock = mockClient(S3Client);

/** Real S3Client instance; mockClient patches at the class-prototype level. */
function makeS3Client(): S3Client {
  return new S3Client({
    region: 'us-east-1',
    credentials: { accessKeyId: 'x', secretAccessKey: 'x' },
  });
}

function storedObject(key: string, size: number, lastModified: Date): StoredObject {
  return { key, size, lastModified };
}

/** Conspicuous ETag-like sentinels — must never appear in privacy-safe detail/logs. */
const ETAG_SENTINEL_AZURE = '"ETAG_SENTINEL_AZURE_NEVER_LOG_0xDEAD"';
const ETAG_SENTINEL_S3 = '"ETAG_SENTINEL_S3_NEVER_LOG_abc123"';

function assertNoEtagSentinelLeak(text: string): void {
  expect(text).not.toContain(ETAG_SENTINEL_AZURE);
  expect(text).not.toContain(ETAG_SENTINEL_S3);
  expect(text).not.toContain('ETAG_SENTINEL');
  expect(text).not.toMatch(/\betag=/i);
}

async function rejectedError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('Expected rejection to contain an Error instance');
  }
  throw new Error('Expected promise to reject');
}

const t0 = new Date('2024-01-01T00:00:00.000Z');
const skewMs = 60 * 60 * 1000; // 1 hour — matches OVERWRITE_SKEW_TOLERANCE_MS

/** Conspicuous sentinel raw keys — must never appear in logs, JSON, or digests. */
const SENTINEL_KEY_A = 'SENTINEL_RAW_KEY_user/999/private-document-NEVER-LOG.pdf';
const SENTINEL_KEY_B = 'SENTINEL_RAW_KEY_user/888/another-secret-file-NEVER-LOG.bin';
const SENTINEL_KEY_C = 'SENTINEL_RAW_KEY_acct/777/third-private-NEVER-LOG.dat';

function assertNoSentinelLeak(text: string): void {
  expect(text).not.toContain(SENTINEL_KEY_A);
  expect(text).not.toContain(SENTINEL_KEY_B);
  expect(text).not.toContain(SENTINEL_KEY_C);
  expect(text).not.toContain('private-document-NEVER-LOG');
  expect(text).not.toContain('another-secret-file-NEVER-LOG');
  expect(text).not.toContain('third-private-NEVER-LOG');
  expect(text).not.toContain('SENTINEL_RAW_KEY');
}

describe('safeObjectReference', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses a stable SHA-256 digest without exposing the raw key', () => {
    const rawKey = SENTINEL_KEY_A;
    const reference = safeObjectReference('kyc', rawKey);

    expect(reference).toMatch(/^kyc\/key-sha256:[a-f0-9]{64}$/);
    expect(reference).toBe(safeObjectReference('kyc', rawKey));
    expect(reference).not.toContain(rawKey);
    assertNoSentinelLeak(reference);
  });

  it('keeps verbose, heal, skip, and object-specific errors free of raw keys', async () => {
    const rawKey = SENTINEL_KEY_A;
    const expectedReference = safeObjectReference('kyc', rawKey);
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const azureByKey = indexStoredObjectsByKey([storedObject(rawKey, 42, t0)]);
    printCategory('kyc', 'onlyOnAzure', [rawKey], true, {
      bytes: 42,
      azureByKey,
      singleSource: 'azure',
    });
    logObjectAction('HEALED', 'azure->s3', 'kyc', rawKey);
    logObjectAction('SKIPPED (appeared concurrently)', 's3->azure', 'kyc', rawKey);

    const azureDownloadFailure = {
      getBlockBlobClient: () => ({ download: jest.fn().mockRejectedValue(new Error(`failed ${rawKey}`)) }),
    } as never;
    await expect(copyAzureToS3(azureDownloadFailure, makeS3Client(), 'kyc', rawKey)).rejects.toThrow(expectedReference);

    const s3DownloadFailure = {
      send: jest.fn().mockRejectedValue(new Error(`failed ${rawKey}`)),
    } as never;
    await expect(copyS3ToAzure(s3DownloadFailure, 'kyc', {} as never, rawKey)).rejects.toThrow(expectedReference);

    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain(expectedReference);
    expect(output).toContain(`key-sha256=${hashObjectKeySha256(rawKey)}`);
    expect(output).toContain('source=azure');
    expect(output).toContain('size=42');
    expect(output).not.toContain('contentType');
    expect(output).not.toContain('content-type');
    assertNoSentinelLeak(output);
    assertNoEtagSentinelLeak(output);
    expect(RECONCILER_PRIVACY_LOG_VERSION).toBe('storage-reconciler-private-logs-v2');
  });

  it('redacts raw keys in incomplete S3 and Azure listing errors', async () => {
    const rawKey = SENTINEL_KEY_B;
    const expectedReference = safeObjectReference('kyc', rawKey);

    s3Mock.reset();
    s3Mock.on(ListObjectsV2Command).resolves({
      IsTruncated: false,
      Contents: [{ Key: rawKey, Size: undefined, LastModified: t0 }],
    });
    const s3Error = await rejectedError(listS3Objects(makeS3Client(), 'kyc'));
    expect(s3Error.message).toContain(expectedReference);
    assertNoSentinelLeak(s3Error.message);

    const azureContainer = {
      containerName: 'kyc',
      async *listBlobsFlat() {
        yield { name: rawKey, properties: { contentLength: undefined, lastModified: t0 } };
      },
    } as never;
    const azureError = await rejectedError(listAzureObjects(azureContainer));
    expect(azureError.message).toContain(expectedReference);
    assertNoSentinelLeak(azureError.message);
  });
});

describe('listing does not capture ETags', () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  it('listS3Objects stores only key, size, lastModified (ignores listing ETag)', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      IsTruncated: false,
      Contents: [{ Key: 'a', Size: 10, LastModified: t0, ETag: ETAG_SENTINEL_S3 }],
    });
    const objects = await listS3Objects(makeS3Client(), 'kyc');
    expect(objects).toEqual([{ key: 'a', size: 10, lastModified: t0 }]);
    expect(objects[0]).not.toHaveProperty('etag');
    assertNoEtagSentinelLeak(JSON.stringify(objects));
  });

  it('listAzureObjects stores only key, size, lastModified (ignores properties.etag)', async () => {
    const azureContainer = {
      containerName: 'kyc',
      async *listBlobsFlat() {
        yield {
          name: 'b',
          properties: { contentLength: 20, lastModified: t0, etag: ETAG_SENTINEL_AZURE },
        };
      },
    } as never;
    const objects = await listAzureObjects(azureContainer);
    expect(objects).toEqual([{ key: 'b', size: 20, lastModified: t0 }]);
    expect(objects[0]).not.toHaveProperty('etag');
    assertNoEtagSentinelLeak(JSON.stringify(objects));
  });
});

describe('diffStores', () => {
  it('returns empty lists when inventories are identical', () => {
    const azure = [storedObject('a', 10, t0), storedObject('b', 20, t0)];
    const s3 = [storedObject('a', 10, t0), storedObject('b', 20, t0)];
    const diff: DiffResult = diffStores(azure, s3, skewMs);
    expect(diff.onlyOnAzure).toEqual([]);
    expect(diff.onlyOnS3).toEqual([]);
    expect(diff.sizeMismatch).toEqual([]);
    expect(diff.suspectedOverwrite).toEqual([]);
  });

  it('puts keys present only on Azure into onlyOnAzure', () => {
    const azure = [storedObject('only-az', 1, t0)];
    const s3: StoredObject[] = [];
    const diff = diffStores(azure, s3, skewMs);
    expect(diff.onlyOnAzure).toEqual(['only-az']);
    expect(diff.onlyOnS3).toEqual([]);
    expect(diff.sizeMismatch).toEqual([]);
    expect(diff.suspectedOverwrite).toEqual([]);
  });

  it('puts keys present only on S3 into onlyOnS3', () => {
    const azure: StoredObject[] = [];
    const s3 = [storedObject('only-s3', 1, t0)];
    const diff = diffStores(azure, s3, skewMs);
    expect(diff.onlyOnAzure).toEqual([]);
    expect(diff.onlyOnS3).toEqual(['only-s3']);
    expect(diff.sizeMismatch).toEqual([]);
    expect(diff.suspectedOverwrite).toEqual([]);
  });

  it('puts same key with different size into sizeMismatch', () => {
    const azure = [storedObject('k', 100, t0)];
    const s3 = [storedObject('k', 99, t0)];
    const diff = diffStores(azure, s3, skewMs);
    expect(diff.sizeMismatch).toEqual(['k']);
    expect(diff.onlyOnAzure).toEqual([]);
    expect(diff.onlyOnS3).toEqual([]);
    expect(diff.suspectedOverwrite).toEqual([]);
  });

  it('puts same key/size with Azure lastModified beyond skew into suspectedOverwrite', () => {
    const s3Time = t0;
    const azureTime = new Date(t0.getTime() + skewMs + 1);
    const azure = [storedObject('k', 50, azureTime)];
    const s3 = [storedObject('k', 50, s3Time)];
    const diff = diffStores(azure, s3, skewMs);
    expect(diff.suspectedOverwrite).toEqual(['k']);
    expect(diff.sizeMismatch).toEqual([]);
    expect(diff.onlyOnAzure).toEqual([]);
    expect(diff.onlyOnS3).toEqual([]);
  });

  // Documented (key,size) trust boundary of diffStores — byte equality is intentionally not checked
  // (see source docblock: "Same-size objects with different content are not detectable by this tool").
  it('does not flag same key/size/lastModified (same-size different content is undetectable)', () => {
    const azure = [storedObject('k', 50, t0)];
    const s3 = [storedObject('k', 50, t0)];
    const diff = diffStores(azure, s3, skewMs);
    expect(diff.sizeMismatch).toEqual([]);
    expect(diff.suspectedOverwrite).toEqual([]);
    expect(diff.onlyOnAzure).toEqual([]);
    expect(diff.onlyOnS3).toEqual([]);
  });

  // Comparison is >=, so exactly at the tolerance boundary is already flagged.
  it('flags suspectedOverwrite when Azure lastModified is exactly at skew tolerance boundary', () => {
    const s3Time = t0;
    const azureTime = new Date(s3Time.getTime() + OVERWRITE_SKEW_TOLERANCE_MS);
    const azure = [storedObject('k', 50, azureTime)];
    const s3 = [storedObject('k', 50, s3Time)];
    const diff = diffStores(azure, s3, OVERWRITE_SKEW_TOLERANCE_MS);
    expect(diff.suspectedOverwrite).toEqual(['k']);
    expect(diff.sizeMismatch).toEqual([]);
    expect(diff.onlyOnAzure).toEqual([]);
    expect(diff.onlyOnS3).toEqual([]);
  });

  it('does not flag suspectedOverwrite when Azure lastModified is just under skew tolerance', () => {
    const s3Time = t0;
    const azureTime = new Date(s3Time.getTime() + OVERWRITE_SKEW_TOLERANCE_MS - 1);
    const azure = [storedObject('k', 50, azureTime)];
    const s3 = [storedObject('k', 50, s3Time)];
    const diff = diffStores(azure, s3, OVERWRITE_SKEW_TOLERANCE_MS);
    expect(diff.suspectedOverwrite).toEqual([]);
    expect(diff.sizeMismatch).toEqual([]);
    expect(diff.onlyOnAzure).toEqual([]);
    expect(diff.onlyOnS3).toEqual([]);
  });
});

describe('isGateBlocking', () => {
  it('returns false for an empty diff', () => {
    const diff: DiffResult = {
      onlyOnAzure: [],
      onlyOnS3: [],
      sizeMismatch: [],
      suspectedOverwrite: [],
    };
    expect(isGateBlocking(diff)).toBe(false);
  });

  it('returns true when only onlyOnAzure is non-empty', () => {
    const diff: DiffResult = {
      onlyOnAzure: ['a'],
      onlyOnS3: [],
      sizeMismatch: [],
      suspectedOverwrite: [],
    };
    expect(isGateBlocking(diff)).toBe(true);
  });

  it('returns true when only onlyOnS3 is non-empty', () => {
    const diff: DiffResult = {
      onlyOnAzure: [],
      onlyOnS3: ['a'],
      sizeMismatch: [],
      suspectedOverwrite: [],
    };
    expect(isGateBlocking(diff)).toBe(true);
  });

  it('returns true when only sizeMismatch is non-empty', () => {
    const diff: DiffResult = {
      onlyOnAzure: [],
      onlyOnS3: [],
      sizeMismatch: ['a'],
      suspectedOverwrite: [],
    };
    expect(isGateBlocking(diff)).toBe(true);
  });

  it('returns false when only suspectedOverwrite is non-empty', () => {
    const diff: DiffResult = {
      onlyOnAzure: [],
      onlyOnS3: [],
      sizeMismatch: [],
      suspectedOverwrite: ['a'],
    };
    expect(isGateBlocking(diff)).toBe(false);
  });
});

describe('assertNotOneSidedEmpty', () => {
  it('throws when Azure is empty and S3 is not', () => {
    expect(() => assertNotOneSidedEmpty(0, 5, 'x')).toThrow(/x/);
    expect(() => assertNotOneSidedEmpty(0, 5, 'x')).toThrow(/azureCount=0/);
    expect(() => assertNotOneSidedEmpty(0, 5, 'x')).toThrow(/s3Count=5/);
  });

  it('throws when S3 is empty and Azure is not', () => {
    expect(() => assertNotOneSidedEmpty(5, 0, 'x')).toThrow(/x/);
    expect(() => assertNotOneSidedEmpty(5, 0, 'x')).toThrow(/azureCount=5/);
    expect(() => assertNotOneSidedEmpty(5, 0, 'x')).toThrow(/s3Count=0/);
  });

  it('does not throw when both sides are empty', () => {
    expect(() => assertNotOneSidedEmpty(0, 0, 'x')).not.toThrow();
  });

  it('does not throw when both sides are non-empty', () => {
    expect(() => assertNotOneSidedEmpty(5, 5, 'x')).not.toThrow();
  });
});

describe('assertWithinHealCap', () => {
  it('throws when candidateCount exceeds cap', () => {
    expect(() => assertWithinHealCap(1001, 1000)).toThrow(/1001/);
    expect(() => assertWithinHealCap(1001, 1000)).toThrow(/1000/);
  });

  it('does not throw when candidateCount equals cap', () => {
    expect(() => assertWithinHealCap(1000, 1000)).not.toThrow();
  });

  it('does not throw when candidateCount is below cap', () => {
    expect(() => assertWithinHealCap(5, 1000)).not.toThrow();
  });
});

describe('assertExactHealBinding', () => {
  const digest = 'a'.repeat(64);
  const other = 'b'.repeat(64);

  it('does not throw when count and digest match exactly', () => {
    expect(() => assertExactHealBinding(3, 3, digest, digest)).not.toThrow();
  });

  it('throws on candidate count mismatch before any I/O', () => {
    expect(() => assertExactHealBinding(2, 3, digest, digest)).toThrow(/Exact-cap heal binding failed/);
    expect(() => assertExactHealBinding(2, 3, digest, digest)).toThrow(/additive candidate count 2/);
    expect(() => assertExactHealBinding(2, 3, digest, digest)).toThrow(/RECONCILE_HEAL_CAP 3/);
    expect(() => assertExactHealBinding(2, 3, digest, digest)).toThrow(/before any WORM probe, download, or PUT/);
  });

  it('throws on candidate-set digest mismatch before any I/O', () => {
    expect(() => assertExactHealBinding(3, 3, digest, other)).toThrow(/Exact-cap heal binding failed/);
    expect(() => assertExactHealBinding(3, 3, digest, other)).toThrow(new RegExp(digest));
    expect(() => assertExactHealBinding(3, 3, digest, other)).toThrow(new RegExp(other));
    expect(() => assertExactHealBinding(3, 3, digest, other)).toThrow(/before any WORM probe, download, or PUT/);
  });
});

describe('assertRequestedContainersExist', () => {
  it('throws when a requested container is missing from S3 buckets', () => {
    expect(() => assertRequestedContainersExist(['kyc'], ['kyc', 'support'])).toThrow(/support/);
  });

  it('does not throw when all requested containers exist (extra S3 buckets ok)', () => {
    expect(() => assertRequestedContainersExist(['kyc', 'support'], ['kyc'])).not.toThrow();
  });
});

describe('additive summary and candidateSetSha256', () => {
  it('is stable and order-independent over the same candidate multiset', () => {
    const candidatesForward = [
      { container: 'kyc', direction: 'azureToS3' as const, keySha256: hashObjectKeySha256(SENTINEL_KEY_A), size: 10 },
      { container: 'support', direction: 's3ToAzure' as const, keySha256: hashObjectKeySha256(SENTINEL_KEY_B), size: 20 },
      { container: 'kyc', direction: 's3ToAzure' as const, keySha256: hashObjectKeySha256(SENTINEL_KEY_C), size: 30 },
    ];
    const candidatesReversed = [...candidatesForward].reverse();
    const candidatesShuffled = [candidatesForward[1], candidatesForward[2], candidatesForward[0]];

    const d1 = computeCandidateSetSha256(candidatesForward);
    const d2 = computeCandidateSetSha256(candidatesReversed);
    const d3 = computeCandidateSetSha256(candidatesShuffled);

    expect(d1).toMatch(/^[a-f0-9]{64}$/);
    expect(d1).toBe(d2);
    expect(d1).toBe(d3);
    assertNoSentinelLeak(d1);
  });

  it('changes when container, direction, key, or size changes', () => {
    const base = {
      container: 'kyc',
      direction: 'azureToS3' as const,
      keySha256: hashObjectKeySha256(SENTINEL_KEY_A),
      size: 10,
    };
    const baseDigest = computeCandidateSetSha256([base]);

    expect(computeCandidateSetSha256([{ ...base, container: 'support' }])).not.toBe(baseDigest);
    expect(computeCandidateSetSha256([{ ...base, direction: 's3ToAzure' }])).not.toBe(baseDigest);
    expect(
      computeCandidateSetSha256([{ ...base, keySha256: hashObjectKeySha256(SENTINEL_KEY_B) }]),
    ).not.toBe(baseDigest);
    expect(computeCandidateSetSha256([{ ...base, size: 11 }])).not.toBe(baseDigest);
  });

  it('sums candidate bytes per direction and never embeds raw keys in the report JSON', () => {
    const azureObjs = [
      storedObject(SENTINEL_KEY_A, 100, t0),
      storedObject(SENTINEL_KEY_B, 250, t0),
      storedObject('shared', 5, t0),
    ];
    const s3Objs = [storedObject(SENTINEL_KEY_C, 40, t0), storedObject('shared', 5, t0)];
    const diff = diffStores(azureObjs, s3Objs, skewMs);

    expect(new Set(diff.onlyOnAzure)).toEqual(new Set([SENTINEL_KEY_A, SENTINEL_KEY_B]));
    expect(diff.onlyOnS3).toEqual([SENTINEL_KEY_C]);

    const summary = buildAdditiveReconcileSummary([
      { container: 'kyc', diff, azureObjs, s3Objs },
      {
        container: 'support',
        diff: { onlyOnAzure: [], onlyOnS3: [], sizeMismatch: [], suspectedOverwrite: [] },
        azureObjs: [],
        s3Objs: [],
      },
      {
        container: 'ep2-example',
        diff: { onlyOnAzure: [], onlyOnS3: [], sizeMismatch: [], suspectedOverwrite: [] },
        azureObjs: [],
        s3Objs: [],
      },
    ]);

    expect(summary.containers).toHaveLength(3);
    const kyc = summary.containers.find((c) => c.container === 'kyc');
    expect(kyc?.azureToS3).toEqual({ count: 2, bytes: 350 });
    expect(kyc?.s3ToAzure).toEqual({ count: 1, bytes: 40 });
    expect(summary.totals.azureToS3).toEqual({ count: 2, bytes: 350 });
    expect(summary.totals.s3ToAzure).toEqual({ count: 1, bytes: 40 });
    expect(summary.totals.additiveCandidates).toBe(3);
    expect(summary.totals.onlyOnAzure).toBe(2);
    expect(summary.totals.onlyOnS3).toBe(1);
    expect(summary.candidateSetSha256).toMatch(/^[a-f0-9]{64}$/);

    const azureByKey = indexStoredObjectsByKey(azureObjs);
    const s3ByKey = indexStoredObjectsByKey(s3Objs);
    const candidates = collectAdditiveCandidatesForContainer('kyc', diff, azureByKey, s3ByKey);
    expect(computeCandidateSetSha256(candidates)).toBe(summary.candidateSetSha256);

    const report = buildMachineReadableReconcileReport(summary, 'REPORT', '2024-01-01T00:00:00.000Z', {
      apiImageDigest: 'sha256:deadbeef',
      operatorCommitSha: 'abc123def',
    });
    expect(report.schemaVersion).toBe(RECONCILE_REPORT_SCHEMA_VERSION);
    expect(report.privacyLogVersion).toBe('storage-reconciler-private-logs-v2');
    expect(report.mode).toBe('REPORT');
    expect(report.apiImageDigest).toBe('sha256:deadbeef');
    expect(report.operatorCommitSha).toBe('abc123def');

    const line = formatReconcileReportJsonLine(report);
    expect(line.startsWith('RECONCILE_REPORT_JSON=')).toBe(true);
    const jsonPart = line.slice('RECONCILE_REPORT_JSON='.length);
    const parsed = JSON.parse(jsonPart) as Record<string, unknown>;
    expect(parsed.candidateSetSha256).toBe(summary.candidateSetSha256);
    expect(parsed.schemaVersion).toBe(1);
    assertNoSentinelLeak(line);
    assertNoSentinelLeak(JSON.stringify(parsed));
  });
});

describe('privacy-safe detail mode', () => {
  afterEach(() => jest.restoreAllMocks());

  it('prints only the technical whitelist and both sides for sizeMismatch (no ETag)', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const azureObj = storedObject(SENTINEL_KEY_A, 100, t0);
    const s3Obj = storedObject(SENTINEL_KEY_A, 99, new Date('2024-02-01T00:00:00.000Z'));
    const azureByKey = indexStoredObjectsByKey([azureObj]);
    const s3ByKey = indexStoredObjectsByKey([s3Obj]);

    printCategory('kyc', 'sizeMismatch', [SENTINEL_KEY_A], true, {
      azureByKey,
      s3ByKey,
      dualSide: true,
    });

    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('sizeMismatch: 1');
    expect(output).toContain(formatDetailObjectLine('kyc', SENTINEL_KEY_A, 'azure', azureObj));
    expect(output).toContain(formatDetailObjectLine('kyc', SENTINEL_KEY_A, 's3', s3Obj));
    expect(output).toContain('source=azure');
    expect(output).toContain('source=s3');
    expect(output).toContain('size=100');
    expect(output).toContain('size=99');
    expect(output).toContain('lastModified=2024-01-01T00:00:00.000Z');
    expect(output).toContain('lastModified=2024-02-01T00:00:00.000Z');
    // Conspicuous ETag sentinels must never appear even if present on listing payloads elsewhere
    expect(output).not.toContain(ETAG_SENTINEL_AZURE);
    expect(output).not.toContain(ETAG_SENTINEL_S3);
    expect(output).not.toMatch(/\betag=/i);
    expect(output).not.toContain('contentType');
    expect(output).not.toContain('content-type');
    expect(output).not.toContain('metadata');
    expect(output).not.toContain('user-meta');
    assertNoSentinelLeak(output);
    assertNoEtagSentinelLeak(output);
  });

  it('formatDetailObjectLine never emits ETag sentinels or etag= fields', () => {
    const obj = storedObject(SENTINEL_KEY_A, 42, t0);
    const line = formatDetailObjectLine('kyc', SENTINEL_KEY_A, 'azure', obj);
    expect(line).toContain('container=kyc');
    expect(line).toContain(`key-sha256=${hashObjectKeySha256(SENTINEL_KEY_A)}`);
    expect(line).toContain('source=azure');
    expect(line).toContain('size=42');
    expect(line).toContain('lastModified=2024-01-01T00:00:00.000Z');
    expect(line).not.toContain(ETAG_SENTINEL_AZURE);
    expect(line).not.toContain(ETAG_SENTINEL_S3);
    expect(line).not.toMatch(/\betag=/i);
    assertNoSentinelLeak(line);
    assertNoEtagSentinelLeak(line);
  });

  it('caps verbose samples at 20 entries per category', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const keys: string[] = [];
    const objs: StoredObject[] = [];
    for (let i = 0; i < 25; i++) {
      const key = `key-${i}`;
      keys.push(key);
      objs.push(storedObject(key, i, t0));
    }
    printCategory('kyc', 'onlyOnAzure', keys, true, {
      bytes: objs.reduce((s, o) => s + o.size, 0),
      azureByKey: indexStoredObjectsByKey(objs),
      singleSource: 'azure',
    });
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('... and 5 more');
    const detailLines = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.includes('key-sha256='));
    expect(detailLines).toHaveLength(20);
  });
});

describe('parseConfig', () => {
  const ENV_KEYS = [
    'RECONCILE_CONTAINERS',
    'RECONCILE_IGNORE_BUCKETS',
    'RECONCILE_WORM_CONTAINERS',
    'RECONCILE_HEAL',
    'RECONCILE_HEAL_CAP',
    'RECONCILE_EXPECTED_CANDIDATE_SET_SHA256',
    'RECONCILE_API_IMAGE_DIGEST',
    'RECONCILE_OPERATOR_COMMIT_SHA',
  ] as const;

  let savedEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;
  let savedArgv: string[];

  beforeEach(() => {
    savedEnv = {
      RECONCILE_CONTAINERS: process.env.RECONCILE_CONTAINERS,
      RECONCILE_IGNORE_BUCKETS: process.env.RECONCILE_IGNORE_BUCKETS,
      RECONCILE_WORM_CONTAINERS: process.env.RECONCILE_WORM_CONTAINERS,
      RECONCILE_HEAL: process.env.RECONCILE_HEAL,
      RECONCILE_HEAL_CAP: process.env.RECONCILE_HEAL_CAP,
      RECONCILE_EXPECTED_CANDIDATE_SET_SHA256: process.env.RECONCILE_EXPECTED_CANDIDATE_SET_SHA256,
      RECONCILE_API_IMAGE_DIGEST: process.env.RECONCILE_API_IMAGE_DIGEST,
      RECONCILE_OPERATOR_COMMIT_SHA: process.env.RECONCILE_OPERATOR_COMMIT_SHA,
    };
    savedArgv = process.argv;
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    process.argv = ['node', 'script'];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    process.argv = savedArgv;
  });

  it('reads containers from CLI positional args in order', () => {
    process.argv = ['node', 'script', 'kyc', 'support'];
    const cfg = parseConfig();
    expect(cfg.containers).toEqual(['kyc', 'support']);
  });

  it('reads containers from RECONCILE_CONTAINERS with space and comma separation', () => {
    process.env.RECONCILE_CONTAINERS = 'kyc, support  ep2-example';
    const cfg = parseConfig();
    expect(cfg.containers).toEqual(['kyc', 'support', 'ep2-example']);
  });

  it('dedupes containers while preserving first-seen order', () => {
    process.argv = ['node', 'script', 'kyc', 'kyc', 'support'];
    const cfg = parseConfig();
    expect(cfg.containers).toEqual(['kyc', 'support']);
  });

  it('throws on unknown flag', () => {
    process.argv = ['node', 'script', 'kyc', '--foo'];
    expect(() => parseConfig()).toThrow(/Unknown flag/);
  });

  it('sets heal true when --heal is present', () => {
    process.argv = ['node', 'script', 'kyc', '--heal'];
    process.env.RECONCILE_WORM_CONTAINERS = 'kyc';
    const cfg = parseConfig();
    expect(cfg.heal).toBe(true);
  });

  it('sets verbose true when --verbose is present', () => {
    process.argv = ['node', 'script', 'kyc', '--verbose'];
    const cfg = parseConfig();
    expect(cfg.verbose).toBe(true);
  });

  it('defaults heal and verbose to false when flags and RECONCILE_HEAL are absent', () => {
    process.argv = ['node', 'script', 'kyc'];
    const cfg = parseConfig();
    expect(cfg.heal).toBe(false);
    expect(cfg.verbose).toBe(false);
    expect(cfg.exactCap).toBe(false);
  });

  it('sets heal true from RECONCILE_HEAL=true without --heal flag', () => {
    process.argv = ['node', 'script', 'kyc'];
    process.env.RECONCILE_HEAL = 'true';
    process.env.RECONCILE_WORM_CONTAINERS = 'kyc';
    const cfg = parseConfig();
    expect(cfg.heal).toBe(true);
  });

  it('throws when no containers are specified via CLI or ENV', () => {
    process.argv = ['node', 'script'];
    expect(() => parseConfig()).toThrow(/No containers specified/);
  });

  it('throws on invalid RECONCILE_HEAL_CAP values', () => {
    process.argv = ['node', 'script', 'kyc'];
    for (const invalid of ['0', '-1', 'x']) {
      process.env.RECONCILE_HEAL_CAP = invalid;
      expect(() => parseConfig()).toThrow(/Invalid RECONCILE_HEAL_CAP/);
    }
  });

  it('accepts valid RECONCILE_HEAL_CAP', () => {
    process.argv = ['node', 'script', 'kyc'];
    process.env.RECONCILE_HEAL_CAP = '50';
    const cfg = parseConfig();
    expect(cfg.healCap).toBe(50);
  });

  it('defaults healCap to DEFAULT_HEAL_CAP when RECONCILE_HEAL_CAP is unset', () => {
    process.argv = ['node', 'script', 'kyc'];
    const cfg = parseConfig();
    expect(cfg.healCap).toBe(DEFAULT_HEAL_CAP);
    expect(cfg.healCap).toBe(1000);
  });

  it('parses RECONCILE_IGNORE_BUCKETS', () => {
    process.argv = ['node', 'script', 'kyc'];
    process.env.RECONCILE_IGNORE_BUCKETS = 'system, temp';
    const cfg = parseConfig();
    expect(cfg.ignoreBuckets).toEqual(['system', 'temp']);
  });

  it('REPORT mode does not require RECONCILE_WORM_CONTAINERS', () => {
    process.argv = ['node', 'script', 'kyc', 'support'];
    const cfg = parseConfig();
    expect(cfg.heal).toBe(false);
    expect(cfg.wormContainers).toEqual([]);
  });

  it('parses RECONCILE_WORM_CONTAINERS with space and comma separation', () => {
    process.argv = ['node', 'script', 'kyc', 'support', 'ep2-example'];
    process.env.RECONCILE_WORM_CONTAINERS = 'kyc, ep2-example';
    const cfg = parseConfig();
    expect(cfg.wormContainers).toEqual(['kyc', 'ep2-example']);
  });

  it('throws when --heal is set and RECONCILE_WORM_CONTAINERS is unset', () => {
    process.argv = ['node', 'script', 'kyc', '--heal'];
    expect(() => parseConfig()).toThrow(/RECONCILE_WORM_CONTAINERS is required/);
    expect(() => parseConfig()).toThrow(/Guessing either blocks legitimate heals/);
  });

  it('throws when --heal is set and RECONCILE_WORM_CONTAINERS is empty', () => {
    process.argv = ['node', 'script', 'kyc', '--heal'];
    process.env.RECONCILE_WORM_CONTAINERS = '';
    expect(() => parseConfig()).toThrow(/RECONCILE_WORM_CONTAINERS is required/);
  });

  it('throws when --heal is set and RECONCILE_WORM_CONTAINERS parses to empty', () => {
    process.argv = ['node', 'script', 'kyc', '--heal'];
    process.env.RECONCILE_WORM_CONTAINERS = '  ,  ';
    expect(() => parseConfig()).toThrow(/RECONCILE_WORM_CONTAINERS is required/);
  });

  it('throws when --heal and a declared WORM container is not among the reconciled containers', () => {
    process.argv = ['node', 'script', 'kyc', 'support', '--heal'];
    process.env.RECONCILE_WORM_CONTAINERS = 'kyc, typo-bucket';
    expect(() => parseConfig()).toThrow(/not among the reconciled containers/);
    expect(() => parseConfig()).toThrow(/typo-bucket/);
  });

  it('REPORT mode does not throw when RECONCILE_WORM_CONTAINERS has names outside the reconciled set', () => {
    process.argv = ['node', 'script', 'kyc', 'support'];
    process.env.RECONCILE_WORM_CONTAINERS = 'kyc, typo-bucket';
    const cfg = parseConfig();
    expect(cfg.heal).toBe(false);
    expect(cfg.wormContainers).toEqual(['kyc', 'typo-bucket']);
  });

  it('throws when --exact-cap is used without heal', () => {
    process.argv = ['node', 'script', 'kyc', '--exact-cap'];
    expect(() => parseConfig()).toThrow(/--exact-cap is only allowed together with --heal/);
  });

  it('throws when --exact-cap lacks RECONCILE_HEAL_CAP (no silent default)', () => {
    process.argv = ['node', 'script', 'kyc', '--heal', '--exact-cap'];
    process.env.RECONCILE_WORM_CONTAINERS = 'kyc';
    process.env.RECONCILE_EXPECTED_CANDIDATE_SET_SHA256 = 'a'.repeat(64);
    expect(() => parseConfig()).toThrow(/RECONCILE_HEAL_CAP is required when --exact-cap/);
  });

  it('throws when --exact-cap lacks RECONCILE_EXPECTED_CANDIDATE_SET_SHA256', () => {
    process.argv = ['node', 'script', 'kyc', '--heal', '--exact-cap'];
    process.env.RECONCILE_WORM_CONTAINERS = 'kyc';
    process.env.RECONCILE_HEAL_CAP = '2';
    expect(() => parseConfig()).toThrow(/RECONCILE_EXPECTED_CANDIDATE_SET_SHA256 is required/);
  });

  it('throws when expected candidate digest is not 64 lowercase hex', () => {
    process.argv = ['node', 'script', 'kyc', '--heal', '--exact-cap'];
    process.env.RECONCILE_WORM_CONTAINERS = 'kyc';
    process.env.RECONCILE_HEAL_CAP = '2';
    for (const invalid of ['ABC', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      process.env.RECONCILE_EXPECTED_CANDIDATE_SET_SHA256 = invalid;
      expect(() => parseConfig()).toThrow(/64 lowercase hex/);
    }
  });

  it('accepts valid --exact-cap configuration', () => {
    const digest = '0123456789abcdef'.repeat(4);
    process.argv = ['node', 'script', 'kyc', '--heal', '--exact-cap'];
    process.env.RECONCILE_WORM_CONTAINERS = 'kyc';
    process.env.RECONCILE_HEAL_CAP = '7';
    process.env.RECONCILE_EXPECTED_CANDIDATE_SET_SHA256 = digest;
    process.env.RECONCILE_API_IMAGE_DIGEST = 'sha256:image';
    process.env.RECONCILE_OPERATOR_COMMIT_SHA = 'deadbeef';
    const cfg = parseConfig();
    expect(cfg.exactCap).toBe(true);
    expect(cfg.heal).toBe(true);
    expect(cfg.healCap).toBe(7);
    expect(cfg.expectedCandidateSetSha256).toBe(digest);
    expect(cfg.apiImageDigest).toBe('sha256:image');
    expect(cfg.operatorCommitSha).toBe('deadbeef');
  });
});

describe('assertWormContainersConfig', () => {
  it('throws when heal is true and wormContainers is empty', () => {
    expect(() => assertWormContainersConfig(true, [], ['kyc', 'support'])).toThrow(
      /RECONCILE_WORM_CONTAINERS is required/,
    );
    expect(() => assertWormContainersConfig(true, [], ['kyc', 'support'])).toThrow(
      /Guessing either blocks legitimate heals/,
    );
  });

  it('does not throw when heal is false and wormContainers is empty', () => {
    expect(() => assertWormContainersConfig(false, [], ['kyc', 'support'])).not.toThrow();
  });

  it('does not throw when heal is false even if declared names are outside the reconciled set', () => {
    expect(() => assertWormContainersConfig(false, ['kyc', 'typo-bucket'], ['kyc', 'support'])).not.toThrow();
  });

  it('throws when a declared WORM container is missing from the reconciled list', () => {
    expect(() => assertWormContainersConfig(true, ['kyc', 'missing'], ['kyc', 'support'])).toThrow(
      /not among the reconciled containers/,
    );
    expect(() => assertWormContainersConfig(true, ['kyc', 'missing'], ['kyc', 'support'])).toThrow(/missing/);
  });

  it('does not throw when every declared WORM container is reconciled', () => {
    expect(() => assertWormContainersConfig(true, ['kyc'], ['kyc', 'support'])).not.toThrow();
  });
});

describe('assertBucketWorm / assertBucketWormIfDeclared / assertUndeclaredBucketHasNoWorm', () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  it('assertBucketWorm throws when Object Lock configuration is missing (fail-closed)', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'kyc' }).resolves({
      ObjectLockConfiguration: undefined,
    });
    const client = makeS3Client();
    const verified = new Map<string, boolean>();
    await expect(assertBucketWorm(client, 'kyc', verified)).rejects.toThrow(/Refusing azure→s3 heal into bucket "kyc"/);
    await expect(assertBucketWorm(client, 'kyc', verified)).rejects.toThrow(/Object Lock is not Enabled/);
    expect(verified.get('kyc')).toBeUndefined();
  });

  it('assertBucketWormIfDeclared throws for a declared WORM container without Object Lock', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'kyc' }).resolves({
      ObjectLockConfiguration: undefined,
    });
    const client = makeS3Client();
    const verified = new Map<string, boolean>();
    const noWormVerified = new Map<string, boolean>();
    const worm = new Set(['kyc']);
    await expect(assertBucketWormIfDeclared(client, 'kyc', worm, verified, noWormVerified)).rejects.toThrow(
      /Refusing azure→s3 heal into bucket "kyc"/,
    );
    expect(s3Mock.commandCalls(GetObjectLockConfigurationCommand)).toHaveLength(1);
  });

  it('assertBucketWormIfDeclared probes and allows an undeclared container with no Object Lock', async () => {
    const err = Object.assign(new Error('Object Lock configuration does not exist for this bucket'), {
      name: 'ObjectLockConfigurationNotFoundError',
    });
    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'support' }).rejects(err);
    const client = makeS3Client();
    const verified = new Map<string, boolean>();
    const noWormVerified = new Map<string, boolean>();
    // support is reconciled but deliberately not WORM — genuine non-lock bucket may proceed
    const worm = new Set(['kyc']);
    await expect(
      assertBucketWormIfDeclared(client, 'support', worm, verified, noWormVerified),
    ).resolves.toBeUndefined();
    expect(s3Mock.commandCalls(GetObjectLockConfigurationCommand)).toHaveLength(1);
    expect(noWormVerified.get('support')).toBe(true);
    expect(verified.size).toBe(0);
  });

  it('assertBucketWormIfDeclared accepts a declared WORM container with COMPLIANCE lock', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'kyc' }).resolves({
      ObjectLockConfiguration: {
        ObjectLockEnabled: 'Enabled',
        Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: GEBUEV_RETENTION_FLOOR_YEARS } },
      },
    });
    const client = makeS3Client();
    const verified = new Map<string, boolean>();
    const noWormVerified = new Map<string, boolean>();
    const worm = new Set(['kyc']);
    await expect(assertBucketWormIfDeclared(client, 'kyc', worm, verified, noWormVerified)).resolves.toBeUndefined();
    expect(verified.get('kyc')).toBe(true);
    expect(s3Mock.commandCalls(GetObjectLockConfigurationCommand)).toHaveLength(1);
  });

  // MinIO production default retention is Days: 4015 (not Years).
  it('assertBucketWorm accepts COMPLIANCE Days retention at the MinIO production value (4015)', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'kyc' }).resolves({
      ObjectLockConfiguration: {
        ObjectLockEnabled: 'Enabled',
        Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 4015 } },
      },
    });
    const client = makeS3Client();
    const verified = new Map<string, boolean>();
    await expect(assertBucketWorm(client, 'kyc', verified)).resolves.toBeUndefined();
    expect(verified.get('kyc')).toBe(true);
    expect(s3Mock.commandCalls(GetObjectLockConfigurationCommand)).toHaveLength(1);
  });

  it('assertBucketWorm fails closed when COMPLIANCE Days retention is below the GeBüV day floor', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'kyc' }).resolves({
      ObjectLockConfiguration: {
        ObjectLockEnabled: 'Enabled',
        Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: GEBUEV_RETENTION_FLOOR_DAYS - 1 } },
      },
    });
    const client = makeS3Client();
    const verified = new Map<string, boolean>();
    await expect(assertBucketWorm(client, 'kyc', verified)).rejects.toThrow(/Refusing azure→s3 heal into bucket "kyc"/);
    await expect(assertBucketWorm(client, 'kyc', verified)).rejects.toThrow(
      new RegExp(`Days=${GEBUEV_RETENTION_FLOOR_DAYS - 1}`),
    );
    await expect(assertBucketWorm(client, 'kyc', verified)).rejects.toThrow(
      new RegExp(String(GEBUEV_RETENTION_FLOOR_DAYS)),
    );
    expect(verified.get('kyc')).toBeUndefined();
  });

  it('assertBucketWorm fails closed and does not cache verification when both retention units are set', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'kyc' }).resolves({
      ObjectLockConfiguration: {
        ObjectLockEnabled: 'Enabled',
        Rule: {
          DefaultRetention: {
            Mode: 'COMPLIANCE',
            Years: GEBUEV_RETENTION_FLOOR_YEARS,
            Days: 4015,
          },
        },
      },
    });
    const client = makeS3Client();
    const verified = new Map<string, boolean>();

    await expect(assertBucketWorm(client, 'kyc', verified)).rejects.toThrow(
      `Years=${GEBUEV_RETENTION_FLOOR_YEARS}, Days=4015`,
    );

    expect(verified.get('kyc')).toBeUndefined();
  });

  it.each([
    {
      unit: 'Years',
      value: GEBUEV_RETENTION_FLOOR_YEARS + 0.5,
      retention: { Mode: 'COMPLIANCE' as const, Years: GEBUEV_RETENTION_FLOOR_YEARS + 0.5 },
    },
    {
      unit: 'Days',
      value: GEBUEV_RETENTION_FLOOR_DAYS + 0.5,
      retention: { Mode: 'COMPLIANCE' as const, Days: GEBUEV_RETENTION_FLOOR_DAYS + 0.5 },
    },
  ])('assertBucketWorm fails closed and does not cache non-integer $unit retention', async (testCase) => {
    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'kyc' }).resolves({
      ObjectLockConfiguration: {
        ObjectLockEnabled: 'Enabled',
        Rule: { DefaultRetention: testCase.retention },
      },
    });
    const client = makeS3Client();
    const verified = new Map<string, boolean>();

    await expect(assertBucketWorm(client, 'kyc', verified)).rejects.toThrow(`${testCase.unit}=${testCase.value}`);

    expect(verified.get('kyc')).toBeUndefined();
  });

  it('assertBucketWormIfDeclared throws when an undeclared container has Object Lock enabled', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'kyc' }).resolves({
      ObjectLockConfiguration: {
        ObjectLockEnabled: 'Enabled',
        Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: GEBUEV_RETENTION_FLOOR_YEARS } },
      },
    });
    const client = makeS3Client();
    const verified = new Map<string, boolean>();
    const noWormVerified = new Map<string, boolean>();
    // kyc has Object Lock but was forgotten from RECONCILE_WORM_CONTAINERS
    const worm = new Set(['ep2-example']);
    await expect(assertBucketWormIfDeclared(client, 'kyc', worm, verified, noWormVerified)).rejects.toThrow(
      /not declared in RECONCILE_WORM_CONTAINERS/,
    );
    await expect(assertBucketWormIfDeclared(client, 'kyc', worm, verified, noWormVerified)).rejects.toThrow(
      /under-declaration/,
    );
    expect(noWormVerified.get('kyc')).toBeUndefined();
  });

  it('assertUndeclaredBucketHasNoWorm throws fail-closed on non-NotFound probe errors', async () => {
    const err = Object.assign(new Error('Access Denied'), { name: 'AccessDenied' });
    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'support' }).rejects(err);
    const client = makeS3Client();
    const verified = new Map<string, boolean>();
    await expect(assertUndeclaredBucketHasNoWorm(client, 'support', verified)).rejects.toThrow(
      /could not verify Object Lock status/,
    );
    await expect(assertUndeclaredBucketHasNoWorm(client, 'support', verified)).rejects.toThrow(/AccessDenied/);
    await expect(assertUndeclaredBucketHasNoWorm(client, 'support', verified)).rejects.toThrow(
      /not treating this as "no lock"/,
    );
    expect(verified.get('support')).toBeUndefined();
  });

  it('assertUndeclaredBucketHasNoWorm memoizes successful no-lock probes per bucket', async () => {
    const err = Object.assign(new Error('Object Lock configuration does not exist for this bucket'), {
      name: 'ObjectLockConfigurationNotFoundError',
    });
    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'support' }).rejects(err);
    const client = makeS3Client();
    const verified = new Map<string, boolean>();
    await assertUndeclaredBucketHasNoWorm(client, 'support', verified);
    await assertUndeclaredBucketHasNoWorm(client, 'support', verified);
    expect(s3Mock.commandCalls(GetObjectLockConfigurationCommand)).toHaveLength(1);
    expect(verified.get('support')).toBe(true);
  });

  it('WORM probe remains fail-closed before azure→s3 heal path (declared COMPLIANCE failure)', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'kyc' }).resolves({
      ObjectLockConfiguration: {
        ObjectLockEnabled: 'Enabled',
        Rule: { DefaultRetention: { Mode: 'GOVERNANCE', Years: GEBUEV_RETENTION_FLOOR_YEARS } },
      },
    });
    const client = makeS3Client();
    const verified = new Map<string, boolean>();
    const noWormVerified = new Map<string, boolean>();
    await expect(assertBucketWormIfDeclared(client, 'kyc', new Set(['kyc']), verified, noWormVerified)).rejects.toThrow(
      /Refusing azure→s3 heal/,
    );
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});

describe('assertBucketsAccounted', () => {
  it('does not throw when every existing S3 bucket is requested', () => {
    expect(() => assertBucketsAccounted(['kyc', 'support'], ['kyc', 'support'], [])).not.toThrow();
  });

  it('throws when a bucket is neither requested nor ignored', () => {
    expect(() => assertBucketsAccounted(['kyc', 'orphan'], ['kyc'], [])).toThrow(/orphan/);
  });

  it('does not throw when an unrequested bucket is in the ignore list', () => {
    expect(() => assertBucketsAccounted(['kyc', 'system'], ['kyc'], ['system'])).not.toThrow();
  });
});

describe('assertPageComplete', () => {
  it('throws when truncated without a next token', () => {
    expect(() => assertPageComplete(true, undefined)).toThrow(/IsTruncated/);
  });

  it('throws when truncated with an empty next token', () => {
    expect(() => assertPageComplete(true, '')).toThrow(/IsTruncated/);
  });

  it('does not throw when truncated with a next token', () => {
    expect(() => assertPageComplete(true, 'some-token')).not.toThrow();
  });

  it('does not throw when not truncated', () => {
    expect(() => assertPageComplete(false, undefined)).not.toThrow();
  });
});

describe('isS3PreconditionFailed', () => {
  it('returns true for httpStatusCode 412', () => {
    expect(isS3PreconditionFailed({ $metadata: { httpStatusCode: 412 } })).toBe(true);
  });

  it('returns true for name PreconditionFailed', () => {
    expect(isS3PreconditionFailed({ name: 'PreconditionFailed' })).toBe(true);
  });

  it('returns false for httpStatusCode 500', () => {
    expect(isS3PreconditionFailed({ $metadata: { httpStatusCode: 500 } })).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isS3PreconditionFailed(undefined)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(isS3PreconditionFailed({})).toBe(false);
  });
});

describe('isAzurePreconditionFailed', () => {
  it('returns true for statusCode 412', () => {
    expect(isAzurePreconditionFailed({ statusCode: 412 })).toBe(true);
  });

  it('returns true for BlobAlreadyExists errorCode', () => {
    expect(isAzurePreconditionFailed({ details: { errorCode: 'BlobAlreadyExists' } })).toBe(true);
  });

  it('returns false for generic statusCode 409 without BlobAlreadyExists', () => {
    expect(isAzurePreconditionFailed({ statusCode: 409 })).toBe(false);
  });

  it('returns false for statusCode 500', () => {
    expect(isAzurePreconditionFailed({ statusCode: 500 })).toBe(false);
  });
});

describe('copyAzureToS3 / copyS3ToAzure preconditions', () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('S3 PUT includes IfNoneMatch: * and returns healed on success', async () => {
    const body = Buffer.from('payload');
    const readable = Readable.from([body]);
    const azureContainer = {
      getBlockBlobClient: () => ({
        download: jest.fn().mockResolvedValue({
          readableStreamBody: readable,
          contentType: 'application/pdf',
          metadata: { owner: 'should-not-be-logged' },
        }),
      }),
    } as never;

    s3Mock.on(PutObjectCommand).resolves({});
    const result = await copyAzureToS3(azureContainer, makeS3Client(), 'kyc', SENTINEL_KEY_A);
    expect(result).toBe('healed');

    const putCalls = s3Mock.commandCalls(PutObjectCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input.IfNoneMatch).toBe('*');
    expect(putCalls[0].args[0].input.Key).toBe(SENTINEL_KEY_A);
  });

  it('S3 precondition conflict is skipped (atomic concurrency)', async () => {
    jest.spyOn(console, 'log').mockImplementation();
    const body = Buffer.from('payload');
    const readable = Readable.from([body]);
    const azureContainer = {
      getBlockBlobClient: () => ({
        download: jest.fn().mockResolvedValue({
          readableStreamBody: readable,
          contentType: 'application/octet-stream',
          metadata: {},
        }),
      }),
    } as never;

    s3Mock.on(PutObjectCommand).rejects(
      Object.assign(new Error('Precondition Failed'), {
        name: 'PreconditionFailed',
        $metadata: { httpStatusCode: 412 },
      }),
    );

    const result = await copyAzureToS3(azureContainer, makeS3Client(), 'kyc', SENTINEL_KEY_A);
    expect(result).toBe('skipped');
  });

  it('Azure upload includes conditions.ifNoneMatch: * and returns healed on success', async () => {
    const bodyBytes = new Uint8Array([1, 2, 3]);
    s3Mock.on(GetObjectCommand).resolves({
      Body: {
        transformToByteArray: async () => bodyBytes,
      } as never,
      ContentType: 'text/plain',
      Metadata: { note: 'should-not-be-logged' },
    });

    const uploadData = jest.fn().mockResolvedValue(undefined);
    const azureContainer = {
      getBlockBlobClient: () => ({ uploadData }),
    } as never;

    const result = await copyS3ToAzure(makeS3Client(), 'kyc', azureContainer, SENTINEL_KEY_B);
    expect(result).toBe('healed');
    expect(uploadData).toHaveBeenCalledTimes(1);
    const uploadOpts = uploadData.mock.calls[0][1] as {
      conditions: { ifNoneMatch: string };
      metadata?: Record<string, string>;
    };
    expect(uploadOpts.conditions.ifNoneMatch).toBe('*');
  });

  it('Azure precondition conflict is skipped (atomic concurrency)', async () => {
    jest.spyOn(console, 'log').mockImplementation();
    const bodyBytes = new Uint8Array([1, 2, 3]);
    s3Mock.on(GetObjectCommand).resolves({
      Body: {
        transformToByteArray: async () => bodyBytes,
      } as never,
      ContentType: 'text/plain',
      Metadata: {},
    });

    const uploadData = jest.fn().mockRejectedValue(
      Object.assign(new Error('BlobAlreadyExists'), {
        statusCode: 412,
        details: { errorCode: 'BlobAlreadyExists' },
      }),
    );
    const azureContainer = {
      getBlockBlobClient: () => ({ uploadData }),
    } as never;

    const result = await copyS3ToAzure(makeS3Client(), 'kyc', azureContainer, SENTINEL_KEY_B);
    expect(result).toBe('skipped');
  });
});

describe('runAdditiveHealOrchestration (production HEAL path)', () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeAzureClient(opts?: {
    download?: jest.Mock;
    uploadData?: jest.Mock;
    getContainerClient?: jest.Mock;
  }): {
    getContainerClient: jest.Mock;
    download: jest.Mock;
    uploadData: jest.Mock;
  } {
    const download = opts?.download ?? jest.fn();
    const uploadData = opts?.uploadData ?? jest.fn();
    const getContainerClient =
      opts?.getContainerClient ??
      jest.fn().mockReturnValue({
        getBlockBlobClient: () => ({ download, uploadData }),
      });
    return { getContainerClient, download, uploadData };
  }

  function emptyHealReport(container = 'kyc'): HealContainerReport {
    return {
      container,
      diff: {
        onlyOnAzure: [] as string[],
        onlyOnS3: [] as string[],
        sizeMismatch: [] as string[],
        suspectedOverwrite: [] as string[],
      },
      azureByKey: new Map<string, StoredObject>(),
      s3ByKey: new Map<string, StoredObject>(),
    };
  }

  function azureOnlyHealReport(container: string, key: string, size: number): HealContainerReport {
    const obj = storedObject(key, size, t0);
    return {
      container,
      diff: {
        onlyOnAzure: [key],
        onlyOnS3: [] as string[],
        sizeMismatch: [] as string[],
        suspectedOverwrite: [] as string[],
      },
      azureByKey: indexStoredObjectsByKey([obj]),
      s3ByKey: new Map<string, StoredObject>(),
    };
  }

  function assertZeroStorageAndWormIo(): void {
    expect(s3Mock.commandCalls(GetObjectLockConfigurationCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  }

  it('rejects exact count mismatch with zero storage/WORM I/O', async () => {
    const azure = makeAzureClient();
    const report = azureOnlyHealReport('kyc', SENTINEL_KEY_A, 10);
    const actualDigest = computeCandidateSetSha256([
      {
        container: 'kyc',
        direction: 'azureToS3',
        keySha256: hashObjectKeySha256(SENTINEL_KEY_A),
        size: 10,
      },
    ]);

    const err = await rejectedError(
      runAdditiveHealOrchestration({
        reports: [report],
        s3: makeS3Client(),
        azure,
        wormContainers: new Set(['kyc']),
        healCap: 2,
        exactCap: true,
        actualCandidateSetSha256: actualDigest,
        expectedCandidateSetSha256: actualDigest,
      }),
    );

    expect(err.message).toMatch(/Exact-cap heal binding failed/);
    expect(err.message).toMatch(/additive candidate count 1/);
    expect(err.message).toMatch(/RECONCILE_HEAL_CAP 2/);
    expect(err.message).toMatch(/before any WORM probe, download, or PUT/);
    assertNoSentinelLeak(err.message);
    assertNoEtagSentinelLeak(err.message);
    expect(azure.getContainerClient).not.toHaveBeenCalled();
    expect(azure.download).not.toHaveBeenCalled();
    expect(azure.uploadData).not.toHaveBeenCalled();
    assertZeroStorageAndWormIo();
  });

  it('rejects same-count digest mismatch with zero storage/WORM I/O', async () => {
    const azure = makeAzureClient();
    const report = azureOnlyHealReport('kyc', SENTINEL_KEY_A, 10);
    const actualDigest = computeCandidateSetSha256([
      {
        container: 'kyc',
        direction: 'azureToS3',
        keySha256: hashObjectKeySha256(SENTINEL_KEY_A),
        size: 10,
      },
    ]);
    const expectedDigest = 'b'.repeat(64);

    const err = await rejectedError(
      runAdditiveHealOrchestration({
        reports: [report],
        s3: makeS3Client(),
        azure,
        wormContainers: new Set(['kyc']),
        healCap: 1,
        exactCap: true,
        actualCandidateSetSha256: actualDigest,
        expectedCandidateSetSha256: expectedDigest,
      }),
    );

    expect(err.message).toMatch(/Exact-cap heal binding failed/);
    expect(err.message).toContain(actualDigest);
    expect(err.message).toContain(expectedDigest);
    expect(err.message).toMatch(/before any WORM probe, download, or PUT/);
    assertNoSentinelLeak(err.message);
    assertNoEtagSentinelLeak(err.message);
    expect(azure.getContainerClient).not.toHaveBeenCalled();
    expect(azure.download).not.toHaveBeenCalled();
    expect(azure.uploadData).not.toHaveBeenCalled();
    assertZeroStorageAndWormIo();
  });

  it('rejects empty live candidate set under positive exact-cap (no clean-parity bypass)', async () => {
    const azure = makeAzureClient();
    const emptyDigest = computeCandidateSetSha256([]);
    // Approved positive cap/digest from a prior report, but live inventory is now empty.
    const staleApprovedDigest = 'c'.repeat(64);

    const err = await rejectedError(
      runAdditiveHealOrchestration({
        reports: [emptyHealReport('kyc')],
        s3: makeS3Client(),
        azure,
        wormContainers: new Set(['kyc']),
        healCap: 3,
        exactCap: true,
        actualCandidateSetSha256: emptyDigest,
        expectedCandidateSetSha256: staleApprovedDigest,
      }),
    );

    expect(err.message).toMatch(/Exact-cap heal binding failed/);
    expect(err.message).toMatch(/additive candidate count 0/);
    expect(err.message).toMatch(/RECONCILE_HEAL_CAP 3/);
    expect(err.message).toMatch(/before any WORM probe, download, or PUT/);
    assertNoSentinelLeak(err.message);
    assertNoEtagSentinelLeak(err.message);
    expect(azure.getContainerClient).not.toHaveBeenCalled();
    expect(azure.download).not.toHaveBeenCalled();
    expect(azure.uploadData).not.toHaveBeenCalled();
    assertZeroStorageAndWormIo();
  });

  it('rejects WORM failure for azure→s3 after probe but before Azure download and S3 PutObject', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'kyc' }).resolves({
      ObjectLockConfiguration: {
        ObjectLockEnabled: 'Enabled',
        Rule: { DefaultRetention: { Mode: 'GOVERNANCE', Years: GEBUEV_RETENTION_FLOOR_YEARS } },
      },
    });

    const azure = makeAzureClient({
      download: jest.fn().mockResolvedValue({
        readableStreamBody: Readable.from([Buffer.from('payload')]),
        contentType: 'application/octet-stream',
        metadata: {},
      }),
    });
    const report = azureOnlyHealReport('kyc', SENTINEL_KEY_A, 7);
    const actualDigest = computeCandidateSetSha256([
      {
        container: 'kyc',
        direction: 'azureToS3',
        keySha256: hashObjectKeySha256(SENTINEL_KEY_A),
        size: 7,
      },
    ]);

    const err = await rejectedError(
      runAdditiveHealOrchestration({
        reports: [report],
        s3: makeS3Client(),
        azure,
        wormContainers: new Set(['kyc']),
        healCap: 1,
        exactCap: false,
        actualCandidateSetSha256: actualDigest,
      }),
    );

    expect(err.message).toMatch(/Refusing azure→s3 heal/);
    assertNoSentinelLeak(err.message);
    assertNoEtagSentinelLeak(err.message);
    // WORM probe is expected; copy I/O must not follow.
    expect(s3Mock.commandCalls(GetObjectLockConfigurationCommand)).toHaveLength(1);
    expect(azure.getContainerClient).toHaveBeenCalledWith('kyc');
    expect(azure.download).not.toHaveBeenCalled();
    expect(azure.uploadData).not.toHaveBeenCalled();
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('normal non-exact HEAL with zero candidates is a no-op success after max-cap auth', async () => {
    const azure = makeAzureClient();
    const stats = await runAdditiveHealOrchestration({
      reports: [emptyHealReport('kyc')],
      s3: makeS3Client(),
      azure,
      wormContainers: new Set(['kyc']),
      healCap: DEFAULT_HEAL_CAP,
      exactCap: false,
      actualCandidateSetSha256: computeCandidateSetSha256([]),
    });

    expect(stats.azureToS3).toEqual({
      healedCount: 0,
      healedBytes: 0,
      skippedCount: 0,
      skippedBytes: 0,
    });
    expect(stats.s3ToAzure).toEqual({
      healedCount: 0,
      healedBytes: 0,
      skippedCount: 0,
      skippedBytes: 0,
    });
    // Container client may be resolved, but no WORM probe / download / PUT / upload.
    expect(azure.download).not.toHaveBeenCalled();
    expect(azure.uploadData).not.toHaveBeenCalled();
    assertZeroStorageAndWormIo();
  });

  it('exact-cap success heals both directions with WORM-before-copy ordering, conditional targets, stats, and privacy', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const callOrder: string[] = [];

    const azureToS3Size = 100;
    const s3ToAzureSize = 40;
    const azurePayload = Buffer.from('azure-source-payload');
    const s3Payload = new Uint8Array([9, 8, 7, 6]);
    const contentTypeSentinel = 'application/pdf-NEVER-LOG-CONTENT-TYPE';
    const reverseContentTypeSentinel = 'text/plain-NEVER-LOG-CONTENT-TYPE';
    const userMetaSentinel = 'user-meta-NEVER-LOG-OWNER';

    s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: 'kyc' }).callsFake(async () => {
      callOrder.push('worm-probe');
      return {
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: GEBUEV_RETENTION_FLOOR_YEARS } },
        },
      };
    });

    s3Mock.on(PutObjectCommand).callsFake(async () => {
      callOrder.push('s3-put');
      return {};
    });

    s3Mock.on(GetObjectCommand).callsFake(async () => {
      callOrder.push('s3-get');
      return {
        Body: {
          transformToByteArray: async () => s3Payload,
        } as never,
        ContentType: reverseContentTypeSentinel,
        Metadata: { note: userMetaSentinel },
      };
    });

    const download = jest.fn().mockImplementation(async () => {
      callOrder.push('azure-download');
      return {
        readableStreamBody: Readable.from([azurePayload]),
        contentType: contentTypeSentinel,
        metadata: { owner: userMetaSentinel },
      };
    });

    const uploadData = jest.fn().mockImplementation(async () => {
      callOrder.push('azure-upload');
    });

    const getBlockBlobClientKeys: string[] = [];
    const getContainerClient = jest.fn().mockImplementation((container: string) => ({
      getBlockBlobClient: (key: string) => {
        getBlockBlobClientKeys.push(`${container}:${key}`);
        return { download, uploadData };
      },
    }));

    const azure = makeAzureClient({ download, uploadData, getContainerClient });

    const wormAzureToS3Report: HealContainerReport = {
      container: 'kyc',
      diff: {
        onlyOnAzure: [SENTINEL_KEY_A],
        onlyOnS3: [],
        sizeMismatch: [],
        suspectedOverwrite: [],
      },
      azureByKey: indexStoredObjectsByKey([storedObject(SENTINEL_KEY_A, azureToS3Size, t0)]),
      s3ByKey: new Map(),
    };

    const normalS3ToAzureReport: HealContainerReport = {
      container: 'support',
      diff: {
        onlyOnAzure: [],
        onlyOnS3: [SENTINEL_KEY_B],
        sizeMismatch: [],
        suspectedOverwrite: [],
      },
      azureByKey: new Map(),
      s3ByKey: indexStoredObjectsByKey([storedObject(SENTINEL_KEY_B, s3ToAzureSize, t0)]),
    };

    const expectedDigest = computeCandidateSetSha256([
      {
        container: 'kyc',
        direction: 'azureToS3',
        keySha256: hashObjectKeySha256(SENTINEL_KEY_A),
        size: azureToS3Size,
      },
      {
        container: 'support',
        direction: 's3ToAzure',
        keySha256: hashObjectKeySha256(SENTINEL_KEY_B),
        size: s3ToAzureSize,
      },
    ]);

    const stats = await runAdditiveHealOrchestration({
      reports: [wormAzureToS3Report, normalS3ToAzureReport],
      s3: makeS3Client(),
      azure,
      wormContainers: new Set(['kyc']),
      healCap: 2,
      exactCap: true,
      actualCandidateSetSha256: expectedDigest,
      expectedCandidateSetSha256: expectedDigest,
    });

    // Real production sequence: WORM probe before Azure download + S3 PUT; reverse is S3 GET + Azure upload.
    expect(callOrder).toEqual(['worm-probe', 'azure-download', 's3-put', 's3-get', 'azure-upload']);

    const wormCalls = s3Mock.commandCalls(GetObjectLockConfigurationCommand);
    expect(wormCalls).toHaveLength(1);
    expect(wormCalls[0].args[0].input.Bucket).toBe('kyc');

    const putCalls = s3Mock.commandCalls(PutObjectCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input.Bucket).toBe('kyc');
    expect(putCalls[0].args[0].input.Key).toBe(SENTINEL_KEY_A);
    expect(putCalls[0].args[0].input.IfNoneMatch).toBe('*');

    const getCalls = s3Mock.commandCalls(GetObjectCommand);
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0].args[0].input.Bucket).toBe('support');
    expect(getCalls[0].args[0].input.Key).toBe(SENTINEL_KEY_B);

    expect(uploadData).toHaveBeenCalledTimes(1);
    const uploadOpts = uploadData.mock.calls[0][1] as {
      conditions: { ifNoneMatch: string };
      metadata?: Record<string, string>;
    };
    expect(uploadOpts.conditions.ifNoneMatch).toBe('*');

    expect(getBlockBlobClientKeys).toEqual([`kyc:${SENTINEL_KEY_A}`, `support:${SENTINEL_KEY_B}`]);
    expect(azure.getContainerClient).toHaveBeenCalledWith('kyc');
    expect(azure.getContainerClient).toHaveBeenCalledWith('support');

    expect(stats.azureToS3).toEqual({
      healedCount: 1,
      healedBytes: azureToS3Size,
      skippedCount: 0,
      skippedBytes: 0,
    });
    expect(stats.s3ToAzure).toEqual({
      healedCount: 1,
      healedBytes: s3ToAzureSize,
      skippedCount: 0,
      skippedBytes: 0,
    });

    const output = consoleSpy.mock.calls.flat().join('\n');
    const azureToS3Ref = safeObjectReference('kyc', SENTINEL_KEY_A);
    const s3ToAzureRef = safeObjectReference('support', SENTINEL_KEY_B);
    expect(output).toContain(`HEALED azure->s3 ${azureToS3Ref}`);
    expect(output).toContain(`HEALED s3->azure ${s3ToAzureRef}`);
    assertNoSentinelLeak(output);
    assertNoEtagSentinelLeak(output);
    expect(output).not.toContain(contentTypeSentinel);
    expect(output).not.toContain(reverseContentTypeSentinel);
    expect(output).not.toContain(userMetaSentinel);
    expect(output).not.toContain('contentType');
    expect(output).not.toContain('content-type');
    expect(output).not.toContain('metadata');
    expect(output).not.toContain('user-meta');
  });
});
