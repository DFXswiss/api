import {
  assertWithinHashCap,
  classifyKey,
  ContentObject,
  isSinglePartEtag,
  md5Matches,
} from '../../../../../scripts/storage/verify-content';

function contentObject(
  key: string,
  size: number,
  lastModified: Date,
  extras: { contentMd5?: string; etag?: string } = {},
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
    const azure = contentObject('k', 100, beforeCutoff, { contentMd5: EMPTY_MD5_BASE64 });
    const s3 = contentObject('k', 99, beforeCutoff, { etag: `"${EMPTY_MD5_HEX}"` });
    expect(classifyKey(azure, s3, cutoff, true)).toBe('size-mismatch');
  });

  it('returns metadata-match when md5/etag match (same size)', () => {
    const azure = contentObject('k', 50, afterCutoff, { contentMd5: EMPTY_MD5_BASE64 });
    const s3 = contentObject('k', 50, afterCutoff, { etag: `"${EMPTY_MD5_HEX}"` });
    expect(classifyKey(azure, s3, cutoff, false)).toBe('metadata-match');
  });

  it('returns backfill-covered when backfillContentProven is true and both timestamps <= cutoff', () => {
    const azure = contentObject('k', 50, beforeCutoff); // no contentMd5
    const s3 = contentObject('k', 50, beforeCutoff); // no etag / not comparable
    expect(classifyKey(azure, s3, cutoff, true)).toBe('backfill-covered');
  });

  it('returns backfill-covered when both lastModified are exactly at the cutoff', () => {
    const azure = contentObject('k', 10, cutoff);
    const s3 = contentObject('k', 10, cutoff);
    expect(classifyKey(azure, s3, cutoff, true)).toBe('backfill-covered');
  });

  it('returns needs-hash when either side is newer than the cutoff', () => {
    const azureNew = contentObject('k', 50, afterCutoff);
    const s3Old = contentObject('k', 50, beforeCutoff);
    expect(classifyKey(azureNew, s3Old, cutoff, true)).toBe('needs-hash');

    const azureOld = contentObject('k', 50, beforeCutoff);
    const s3New = contentObject('k', 50, afterCutoff);
    expect(classifyKey(azureOld, s3New, cutoff, true)).toBe('needs-hash');
  });

  it('returns needs-hash when md5 mismatches (same size) — never backfill-covered', () => {
    const azure = contentObject('k', 50, beforeCutoff, { contentMd5: EMPTY_MD5_BASE64 });
    const s3 = contentObject('k', 50, beforeCutoff, { etag: `"${OTHER_MD5_HEX}"` });
    // Even with backfillContentProven and both <= cutoff: md5 false must not pass.
    expect(classifyKey(azure, s3, cutoff, true)).toBe('needs-hash');
    expect(classifyKey(azure, s3, cutoff, false)).toBe('needs-hash');
  });

  it('returns needs-hash when azure contentMd5 is missing and not backfill-covered', () => {
    const azure = contentObject('k', 50, afterCutoff); // no contentMd5, after cutoff
    const s3 = contentObject('k', 50, afterCutoff, { etag: `"${EMPTY_MD5_HEX}"` });
    expect(classifyKey(azure, s3, cutoff, true)).toBe('needs-hash');
  });

  it('returns needs-hash (NOT backfill-covered) when backfillContentProven is false even if both timestamps <= cutoff', () => {
    const azure = contentObject('k', 50, beforeCutoff);
    const s3 = contentObject('k', 50, beforeCutoff);
    expect(classifyKey(azure, s3, cutoff, false)).toBe('needs-hash');
  });

  it('prefers metadata-match over backfill-covered when md5 matches', () => {
    const azure = contentObject('k', 50, beforeCutoff, { contentMd5: EMPTY_MD5_BASE64 });
    const s3 = contentObject('k', 50, beforeCutoff, { etag: `"${EMPTY_MD5_HEX}"` });
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
