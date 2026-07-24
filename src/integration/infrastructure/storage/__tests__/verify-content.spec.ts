import {
  assertHashedSize,
  assertHashVersionUnchanged,
  assertWithinHashCap,
  classifyKey,
  ContentObject,
  isSinglePartEtag,
  isStillProvenByHash,
  md5Matches,
  normalizeEtag,
  objectSignature,
  parseConfig,
} from '../../../../../scripts/storage/verify-content';

function contentObject(
  key: string,
  size: number,
  lastModified: Date,
  extras: { contentMd5?: string; etag: string },
): ContentObject {
  return { key, size, lastModified, ...extras };
}

const cutoff = new Date('2026-07-14T00:00:00.000Z');
const beforeCutoff = new Date('2026-07-13T00:00:00.000Z');
const afterCutoff = new Date('2026-07-15T00:00:00.000Z');

// Known MD5 of empty content: d41d8cd98f00b204e9800998ecf8427e
const EMPTY_MD5_HEX = 'd41d8cd98f00b204e9800998ecf8427e';
const EMPTY_MD5_BASE64 = Buffer.from(EMPTY_MD5_HEX, 'hex').toString('base64');
// Different MD5 (of "x"): 9dd4e461268c8034f5c8564e155c67a6
const OTHER_MD5_HEX = '9dd4e461268c8034f5c8564e155c67a6';
const OTHER_MD5_BASE64 = Buffer.from(OTHER_MD5_HEX, 'hex').toString('base64');

const AZURE_ETAG = '"azure-etag-1"';
const AZURE_ETAG_OTHER = '"azure-etag-2"';
const S3_ETAG = `"${EMPTY_MD5_HEX}"`;
const S3_ETAG_OTHER = `"${OTHER_MD5_HEX}"`;
const PLACEHOLDER_ETAG = '"placeholder-etag"';

describe('isSinglePartEtag', () => {
  it('returns true for 32 lowercase hex characters', () => {
    expect(isSinglePartEtag(EMPTY_MD5_HEX)).toBe(true);
  });

  it('returns true for 32 uppercase hex characters', () => {
    expect(isSinglePartEtag(EMPTY_MD5_HEX.toUpperCase())).toBe(true);
  });

  it('returns true for quoted 32-hex ETag (S3 style)', () => {
    expect(isSinglePartEtag(`"${EMPTY_MD5_HEX}"`)).toBe(true);
  });

  it('returns false for multipart ETag with -partCount suffix', () => {
    expect(isSinglePartEtag(`"${EMPTY_MD5_HEX}-2"`)).toBe(false);
    expect(isSinglePartEtag(`${EMPTY_MD5_HEX}-12`)).toBe(false);
  });

  it('returns false for non-hex or wrong-length values', () => {
    expect(isSinglePartEtag('abc')).toBe(false);
    expect(isSinglePartEtag('g'.repeat(32))).toBe(false);
  });

  it('does not treat unpaired or empty quote forms as single-part', () => {
    // Paired-quote strip only; lone/asymmetric quotes must not become a bare 32-hex value.
    expect(isSinglePartEtag('')).toBe(false);
    expect(isSinglePartEtag('"')).toBe(false);
    expect(isSinglePartEtag(`"${EMPTY_MD5_HEX}`)).toBe(false);
    expect(isSinglePartEtag(`${EMPTY_MD5_HEX}"`)).toBe(false);
  });
});

describe('md5Matches', () => {
  it('returns true for matching azure contentMd5 (base64) and single-part S3 etag', () => {
    expect(md5Matches(EMPTY_MD5_BASE64, `"${EMPTY_MD5_HEX}"`)).toBe(true);
    expect(md5Matches(EMPTY_MD5_BASE64, EMPTY_MD5_HEX)).toBe(true);
    expect(md5Matches(EMPTY_MD5_BASE64, EMPTY_MD5_HEX.toUpperCase())).toBe(true);
  });

  it('returns false for mismatching pair of same length / comparable metadata', () => {
    expect(md5Matches(EMPTY_MD5_BASE64, `"${OTHER_MD5_HEX}"`)).toBe(false);
    expect(md5Matches(OTHER_MD5_BASE64, `"${EMPTY_MD5_HEX}"`)).toBe(false);
  });

  it('returns null when azure contentMd5 is missing', () => {
    expect(md5Matches(undefined, `"${EMPTY_MD5_HEX}"`)).toBeNull();
  });

  it('returns null when s3 etag is missing', () => {
    expect(md5Matches(EMPTY_MD5_BASE64, undefined)).toBeNull();
  });

  it('returns null for multipart etag (not a whole-object MD5)', () => {
    expect(md5Matches(EMPTY_MD5_BASE64, `"${EMPTY_MD5_HEX}-3"`)).toBeNull();
  });
});

describe('classifyKey', () => {
  it('returns size-mismatch when sizes differ (checked first, unconditionally)', () => {
    const azure = contentObject('k', 100, beforeCutoff, { contentMd5: EMPTY_MD5_BASE64, etag: AZURE_ETAG });
    const s3 = contentObject('k', 99, beforeCutoff, { etag: S3_ETAG });
    expect(classifyKey(azure, s3, cutoff, true)).toBe('size-mismatch');
  });

  it('returns metadata-match when md5/etag match (same size)', () => {
    const azure = contentObject('k', 50, afterCutoff, { contentMd5: EMPTY_MD5_BASE64, etag: AZURE_ETAG });
    const s3 = contentObject('k', 50, afterCutoff, { etag: S3_ETAG });
    expect(classifyKey(azure, s3, cutoff, false)).toBe('metadata-match');
  });

  it('returns backfill-covered when backfillContentProven is true and both timestamps <= cutoff', () => {
    const azure = contentObject('k', 50, beforeCutoff, { etag: AZURE_ETAG }); // no contentMd5
    const s3 = contentObject('k', 50, beforeCutoff, { etag: PLACEHOLDER_ETAG }); // not comparable via md5
    expect(classifyKey(azure, s3, cutoff, true)).toBe('backfill-covered');
  });

  it('returns backfill-covered when both lastModified are exactly at the cutoff', () => {
    const azure = contentObject('k', 10, cutoff, { etag: AZURE_ETAG });
    const s3 = contentObject('k', 10, cutoff, { etag: PLACEHOLDER_ETAG });
    expect(classifyKey(azure, s3, cutoff, true)).toBe('backfill-covered');
  });

  it('returns needs-hash when either side is newer than the cutoff', () => {
    const azureNew = contentObject('k', 50, afterCutoff, { etag: AZURE_ETAG });
    const s3Old = contentObject('k', 50, beforeCutoff, { etag: PLACEHOLDER_ETAG });
    expect(classifyKey(azureNew, s3Old, cutoff, true)).toBe('needs-hash');

    const azureOld = contentObject('k', 50, beforeCutoff, { etag: AZURE_ETAG });
    const s3New = contentObject('k', 50, afterCutoff, { etag: PLACEHOLDER_ETAG });
    expect(classifyKey(azureOld, s3New, cutoff, true)).toBe('needs-hash');
  });

  it('returns needs-hash when md5 mismatches (same size) — never backfill-covered', () => {
    const azure = contentObject('k', 50, beforeCutoff, { contentMd5: EMPTY_MD5_BASE64, etag: AZURE_ETAG });
    const s3 = contentObject('k', 50, beforeCutoff, { etag: S3_ETAG_OTHER });
    // Even with backfillContentProven and both <= cutoff: md5 false must not pass.
    expect(classifyKey(azure, s3, cutoff, true)).toBe('needs-hash');
    expect(classifyKey(azure, s3, cutoff, false)).toBe('needs-hash');
  });

  it('returns needs-hash when azure contentMd5 is missing and not backfill-covered', () => {
    const azure = contentObject('k', 50, afterCutoff, { etag: AZURE_ETAG }); // no contentMd5, after cutoff
    const s3 = contentObject('k', 50, afterCutoff, { etag: S3_ETAG });
    expect(classifyKey(azure, s3, cutoff, true)).toBe('needs-hash');
  });

  it('returns needs-hash (NOT backfill-covered) when backfillContentProven is false even if both timestamps <= cutoff', () => {
    const azure = contentObject('k', 50, beforeCutoff, { etag: AZURE_ETAG });
    const s3 = contentObject('k', 50, beforeCutoff, { etag: PLACEHOLDER_ETAG });
    expect(classifyKey(azure, s3, cutoff, false)).toBe('needs-hash');
  });

  it('prefers metadata-match over backfill-covered when md5 matches', () => {
    const azure = contentObject('k', 50, beforeCutoff, { contentMd5: EMPTY_MD5_BASE64, etag: AZURE_ETAG });
    const s3 = contentObject('k', 50, beforeCutoff, { etag: S3_ETAG });
    expect(classifyKey(azure, s3, cutoff, true)).toBe('metadata-match');
  });
});

describe('assertWithinHashCap', () => {
  it('throws when count exceeds cap (message mentions both values)', () => {
    expect(() => assertWithinHashCap(5001, 5000)).toThrow(/5001/);
    expect(() => assertWithinHashCap(5001, 5000)).toThrow(/5000/);
  });

  it('does not throw when count equals cap', () => {
    expect(() => assertWithinHashCap(5000, 5000)).not.toThrow();
  });

  it('does not throw when count is below cap', () => {
    expect(() => assertWithinHashCap(5, 5000)).not.toThrow();
  });
});

describe('objectSignature', () => {
  const azureBase = contentObject('k', 100, beforeCutoff, { contentMd5: EMPTY_MD5_BASE64, etag: AZURE_ETAG });
  const s3Base = contentObject('k', 100, beforeCutoff, { etag: S3_ETAG });

  it('returns a stable equal signature for identical objects', () => {
    const a1 = contentObject('k', 100, beforeCutoff, { contentMd5: EMPTY_MD5_BASE64, etag: AZURE_ETAG });
    const s1 = contentObject('k', 100, beforeCutoff, { etag: S3_ETAG });
    const a2 = contentObject('k', 100, beforeCutoff, { contentMd5: EMPTY_MD5_BASE64, etag: AZURE_ETAG });
    const s2 = contentObject('k', 100, beforeCutoff, { etag: S3_ETAG });
    expect(objectSignature(a1, s1)).toBe(objectSignature(a2, s2));
    expect(objectSignature(a1, s1)).toBe(`${AZURE_ETAG}|100|${S3_ETAG}|100`);
  });

  it('changes when azure.etag changes (same size/timestamps)', () => {
    const azureChanged = contentObject('k', 100, beforeCutoff, {
      contentMd5: EMPTY_MD5_BASE64,
      etag: AZURE_ETAG_OTHER,
    });
    expect(objectSignature(azureChanged, s3Base)).not.toBe(objectSignature(azureBase, s3Base));
  });

  it('changes when s3.etag changes (same size/timestamps)', () => {
    const s3Changed = contentObject('k', 100, beforeCutoff, { etag: S3_ETAG_OTHER });
    expect(objectSignature(azureBase, s3Changed)).not.toBe(objectSignature(azureBase, s3Base));
  });

  it('changes when size changes', () => {
    const azureChanged = contentObject('k', 101, beforeCutoff, { contentMd5: EMPTY_MD5_BASE64, etag: AZURE_ETAG });
    const s3Changed = contentObject('k', 101, beforeCutoff, { etag: S3_ETAG });
    expect(objectSignature(azureChanged, s3Changed)).not.toBe(objectSignature(azureBase, s3Base));
  });
});

describe('isStillProvenByHash', () => {
  const azure = contentObject('k', 100, beforeCutoff, { contentMd5: EMPTY_MD5_BASE64, etag: AZURE_ETAG });
  const s3 = contentObject('k', 100, beforeCutoff, { etag: S3_ETAG });
  const sk = 'container\0k';

  it('returns false when sk is not present in the map', () => {
    const map = new Map<string, string>();
    expect(isStillProvenByHash(map, sk, azure, s3)).toBe(false);
  });

  it('returns true when map signature matches current objects and keeps the entry', () => {
    const map = new Map<string, string>();
    map.set(sk, objectSignature(azure, s3));
    expect(isStillProvenByHash(map, sk, azure, s3)).toBe(true);
    expect(map.has(sk)).toBe(true);
  });

  it('returns false and deletes the entry when objects produce a different signature', () => {
    const map = new Map<string, string>();
    map.set(sk, objectSignature(azure, s3));
    const azureChanged = contentObject('k', 100, beforeCutoff, {
      contentMd5: EMPTY_MD5_BASE64,
      etag: AZURE_ETAG_OTHER,
    });
    expect(isStillProvenByHash(map, sk, azureChanged, s3)).toBe(false);
    expect(map.has(sk)).toBe(false);
  });
});

describe('assertHashVersionUnchanged', () => {
  it('does not throw when listed and downloaded ETag are the same', () => {
    expect(() => assertHashVersionUnchanged('"etag-1"', '"etag-1"', 'azure test/key')).not.toThrow();
  });

  it('throws when listed and downloaded ETag differ (message includes label)', () => {
    expect(() => assertHashVersionUnchanged('"etag-1"', '"etag-2"', 'azure test/key')).toThrow(/azure test\/key/);
  });

  it('does not throw when one ETag is quoted and the other is unquoted', () => {
    expect(() => assertHashVersionUnchanged('"abc"', 'abc', 'azure test/key')).not.toThrow();
  });

  it('throws when listed ETag has a weak-validator prefix', () => {
    expect(() => assertHashVersionUnchanged('W/"abc"', 'abc', 'azure test/key')).toThrow(/weak/i);
  });

  it('throws when downloaded ETag has a weak-validator prefix', () => {
    expect(() => assertHashVersionUnchanged('abc', 'W/"abc"', 'azure test/key')).toThrow(/weak/i);
  });

  it('throws when both ETags have a weak-validator prefix', () => {
    expect(() => assertHashVersionUnchanged('W/"abc"', 'W/"abc"', 'azure test/key')).toThrow(/weak/i);
  });

  it('throws when ETags are genuinely different', () => {
    expect(() => assertHashVersionUnchanged('"abc"', '"def"', 'azure test/key')).toThrow();
  });

  it('includes both raw ETag values in the error message', () => {
    expect(() => assertHashVersionUnchanged('W/"abc"', '"def"', 'azure test/key')).toThrow(
      /listedEtag=W\/"abc".*downloadedEtag="def"/,
    );
  });

  it('throws for asymmetric quoting (leading-only vs trailing-only must not match)', () => {
    expect(() => assertHashVersionUnchanged('"abc', 'abc"', 'azure test/key')).toThrow();
  });

  it('normalizeEtag only strips paired quotes; empty, lone, and asymmetric quotes stay distinct', () => {
    expect(normalizeEtag('')).toBe('');
    expect(normalizeEtag('"')).toBe('"');
    expect(normalizeEtag('"abc')).toBe('"abc');
    expect(normalizeEtag('abc"')).toBe('abc"');
    expect(normalizeEtag('"abc"')).toBe('abc');
    // Empty and lone quote must not collide with each other or with stripped values.
    expect(normalizeEtag('')).not.toBe(normalizeEtag('"'));
    expect(normalizeEtag('"')).not.toBe(normalizeEtag('""'));
    expect(normalizeEtag('"abc')).not.toBe(normalizeEtag('abc"'));
    expect(normalizeEtag('"abc')).not.toBe(normalizeEtag('abc'));
    expect(normalizeEtag('abc"')).not.toBe(normalizeEtag('abc'));
  });
});

describe('parseConfig BACKFILL_PROOF_CUTOFF bounds', () => {
  const envKeys = [
    'BACKFILL_PROOF_CUTOFF',
    'BACKFILL_CONTENT_PROVEN',
    'VERIFY_CONTAINERS',
    'VERIFY_HASH_DELTA',
    'VERIFY_HASH_CAP',
  ] as const;
  let savedEnv: Record<string, string | undefined>;
  let savedArgv: string[];

  beforeEach(() => {
    savedEnv = {};
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
    }
    savedArgv = process.argv;
    process.argv = ['node', 'verify-content.ts', 'test-container'];
    delete process.env.VERIFY_CONTAINERS;
    delete process.env.VERIFY_HASH_DELTA;
    delete process.env.VERIFY_HASH_CAP;
    process.env.BACKFILL_CONTENT_PROVEN = 'false';
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    }
    process.argv = savedArgv;
  });

  it('throws when cutoff is in the future', () => {
    process.env.BACKFILL_PROOF_CUTOFF = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(() => parseConfig()).toThrow(/future/i);
    expect(() => parseConfig()).toThrow(/BACKFILL_PROOF_CUTOFF/);
  });

  it('does not throw when cutoff is in the past', () => {
    process.env.BACKFILL_PROOF_CUTOFF = '2020-01-01T00:00:00.000Z';
    expect(() => parseConfig()).not.toThrow();
    const cfg = parseConfig();
    expect(cfg.backfillCutoff.toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });

  it('throws when cutoff is not ISO-8601', () => {
    process.env.BACKFILL_PROOF_CUTOFF = '07/14/2026';
    expect(() => parseConfig()).toThrow(/ISO-8601/);
  });

  it('throws on invalid calendar date that Date would silently roll over', () => {
    process.env.BACKFILL_PROOF_CUTOFF = '2026-04-31T00:00:00Z';
    expect(() => parseConfig()).toThrow();
  });

  it('throws when cutoff is not UTC-anchored (missing Z)', () => {
    process.env.BACKFILL_PROOF_CUTOFF = '2026-07-14T00:00:00';
    expect(() => parseConfig()).toThrow(/UTC/);
  });

  it('does not throw for valid UTC ISO-8601 cutoff in the past', () => {
    process.env.BACKFILL_PROOF_CUTOFF = '2026-07-14T00:00:00Z';
    expect(() => parseConfig()).not.toThrow();
  });
});

describe('assertHashedSize', () => {
  it('throws when total does not match expected size', () => {
    expect(() => assertHashedSize(10, 20)).toThrow(/10/);
    expect(() => assertHashedSize(10, 20)).toThrow(/20/);
  });

  it('does not throw when total equals expected size', () => {
    expect(() => assertHashedSize(100, 100)).not.toThrow();
    expect(() => assertHashedSize(0, 0)).not.toThrow();
  });
});
