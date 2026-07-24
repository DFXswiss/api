import { GetObjectLockConfigurationCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import {
  assertBucketWorm,
  assertBucketWormIfDeclared,
  assertBucketsAccounted,
  assertNotOneSidedEmpty,
  assertPageComplete,
  assertRequestedContainersExist,
  assertUndeclaredBucketHasNoWorm,
  assertWithinHealCap,
  assertWormContainersConfig,
  DEFAULT_HEAL_CAP,
  diffStores,
  DiffResult,
  isAzurePreconditionFailed,
  isGateBlocking,
  isS3PreconditionFailed,
  OVERWRITE_SKEW_TOLERANCE_MS,
  parseConfig,
  StoredObject,
} from '../../../../../scripts/storage/reconcile-stores';
import { GEBUEV_RETENTION_FLOOR_YEARS } from '../worm-retention.const';

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

const t0 = new Date('2024-01-01T00:00:00.000Z');
const skewMs = 60 * 60 * 1000; // 1 hour — matches OVERWRITE_SKEW_TOLERANCE_MS

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

describe('assertRequestedContainersExist', () => {
  it('throws when a requested container is missing from S3 buckets', () => {
    expect(() => assertRequestedContainersExist(['kyc'], ['kyc', 'support'])).toThrow(/support/);
  });

  it('does not throw when all requested containers exist (extra S3 buckets ok)', () => {
    expect(() => assertRequestedContainersExist(['kyc', 'support'], ['kyc'])).not.toThrow();
  });
});

describe('parseConfig', () => {
  const ENV_KEYS = [
    'RECONCILE_CONTAINERS',
    'RECONCILE_IGNORE_BUCKETS',
    'RECONCILE_WORM_CONTAINERS',
    'RECONCILE_HEAL',
    'RECONCILE_HEAL_CAP',
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
    expect(() => assertWormContainersConfig(true, ['kyc', 'missing'], ['kyc', 'support'])).toThrow(
      /missing/,
    );
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
    await expect(assertBucketWorm(client, 'kyc', verified)).rejects.toThrow(
      /Refusing azure→s3 heal into bucket "kyc"/,
    );
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
    await expect(
      assertBucketWormIfDeclared(client, 'kyc', worm, verified, noWormVerified),
    ).resolves.toBeUndefined();
    expect(verified.get('kyc')).toBe(true);
    expect(s3Mock.commandCalls(GetObjectLockConfigurationCommand)).toHaveLength(1);
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
    await expect(
      assertBucketWormIfDeclared(client, 'kyc', worm, verified, noWormVerified),
    ).rejects.toThrow(/not declared in RECONCILE_WORM_CONTAINERS/);
    await expect(
      assertBucketWormIfDeclared(client, 'kyc', worm, verified, noWormVerified),
    ).rejects.toThrow(/under-declaration/);
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
