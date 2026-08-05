import {
  CopyObjectCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ObjectLockRetentionMode,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Test } from '@nestjs/testing';
import { mockClient } from 'aws-sdk-client-mock';
import { TestUtil } from 'src/shared/utils/test.util';
import { S3StorageService } from '../s3-storage.service';
import { GEBUEV_RETENTION_FLOOR_DAYS, GEBUEV_RETENTION_FLOOR_YEARS } from '../worm-retention.const';

const validS3 = {
  endpoint: 'https://s3.test.local',
  region: 'us-east-1',
  accessKey: 'access-key',
  secretKey: 'secret-key',
  publicUrl: 'https://files.test.local/', // trailing slash required
};

const CONTAINER = 'kyc';

const s3Mock = mockClient(S3Client);

async function provideConfig(s3: Partial<typeof validS3> = validS3): Promise<void> {
  await Test.createTestingModule({
    providers: [TestUtil.provideConfig({ s3 })],
  }).compile();
}

// Minimal stream stub matching the parts the service consumes (transformToByteArray).
function bodyStream(bytes: Uint8Array): { transformToByteArray: () => Promise<Uint8Array> } {
  return { transformToByteArray: async () => bytes };
}

describe('S3StorageService', () => {
  beforeEach(async () => {
    s3Mock.reset();
    await provideConfig();
  });

  describe('constructor', () => {
    it('builds with a complete config', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({ IsTruncated: false });
      const service = new S3StorageService(CONTAINER);
      expect(service).toBeInstanceOf(S3StorageService);
      await expect(service.listBlobs()).resolves.toEqual([]);
    });

    it('throws when endpoint is missing', async () => {
      await provideConfig({ ...validS3, endpoint: undefined });
      await expect(new S3StorageService(CONTAINER).getBlob('x')).rejects.toThrow('Incomplete S3 config');
    });

    it('throws when region is missing', async () => {
      await provideConfig({ ...validS3, region: undefined });
      await expect(new S3StorageService(CONTAINER).getBlob('x')).rejects.toThrow('Incomplete S3 config');
    });

    it('throws when accessKey is missing', async () => {
      await provideConfig({ ...validS3, accessKey: undefined });
      await expect(new S3StorageService(CONTAINER).getBlob('x')).rejects.toThrow('Incomplete S3 config');
    });

    it('throws when secretKey is missing', async () => {
      await provideConfig({ ...validS3, secretKey: undefined });
      await expect(new S3StorageService(CONTAINER).getBlob('x')).rejects.toThrow('Incomplete S3 config');
    });

    it('throws when publicUrl is missing', async () => {
      await provideConfig({ ...validS3, publicUrl: undefined });
      await expect(new S3StorageService(CONTAINER).getBlob('x')).rejects.toThrow('Incomplete S3 config');
    });

    it('throws when publicUrl has no trailing slash', async () => {
      await provideConfig({ ...validS3, publicUrl: 'https://files.test.local' });
      await expect(new S3StorageService(CONTAINER).getBlob('x')).rejects.toThrow('must end with a trailing slash');
    });
  });

  describe('listKeyDates', () => {
    // One request per page, not per object: `listBlobs` pays a HEAD per object on S3, which over the
    // legacy KYC prefix would be hundreds of thousands of requests.
    it('takes the modification date from the listing and follows the pages', async () => {
      const first = new Date('2026-07-13T10:00:00.000Z');
      const second = new Date('2026-07-13T11:00:00.000Z');
      s3Mock
        .on(ListObjectsV2Command)
        .resolvesOnce({
          Contents: [{ Key: 'spider/1/a.pdf', LastModified: first }],
          IsTruncated: true,
          NextContinuationToken: 'tok-1',
        })
        .resolvesOnce({ Contents: [{ Key: 'spider/1/b.pdf', LastModified: second }], IsTruncated: false });

      const keys = await new S3StorageService(CONTAINER).listKeyDates('spider/');

      expect(keys).toEqual([
        { key: 'spider/1/a.pdf', created: first },
        { key: 'spider/1/b.pdf', created: second },
      ]);
      expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(0);
      expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(2);
      expect(s3Mock.commandCalls(ListObjectsV2Command)[1].args[0].input).toMatchObject({
        Prefix: 'spider/',
        ContinuationToken: 'tok-1',
      });
    });

    it('skips an entry without a key and reports no date where the listing has none', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: undefined }, { Key: 'k' }], IsTruncated: false });

      const keys = await new S3StorageService(CONTAINER).listKeyDates();

      expect(keys).toEqual([{ key: 'k', created: undefined }]);
    });

    it('returns nothing for an empty listing', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({ IsTruncated: false });

      await expect(new S3StorageService(CONTAINER).listKeyDates('none/')).resolves.toEqual([]);
    });
  });

  describe('listBlobs', () => {
    it('paginates ListObjectsV2 and heads each key', async () => {
      s3Mock
        .on(ListObjectsV2Command)
        .resolvesOnce({ Contents: [{ Key: 'user/1/a.png' }], IsTruncated: true, NextContinuationToken: 'tok-1' })
        .resolvesOnce({ Contents: [{ Key: 'user/1/b.pdf' }], IsTruncated: false });

      const created = new Date('2026-01-01T00:00:00.000Z');
      s3Mock
        .on(HeadObjectCommand, { Key: 'user/1/a.png' })
        .resolves({ ContentType: 'image/png', LastModified: created, Metadata: { kind: 'id' } });
      s3Mock
        .on(HeadObjectCommand, { Key: 'user/1/b.pdf' })
        .resolves({ ContentType: 'application/pdf', LastModified: created, Metadata: { kind: 'poa' } });

      const blobs = await new S3StorageService(CONTAINER).listBlobs('user/1/');

      expect(blobs).toEqual([
        {
          name: 'user/1/a.png',
          url: 'https://files.test.local/kyc/user/1/a.png',
          contentType: 'image/png',
          created,
          updated: created,
          metadata: { kind: 'id' },
        },
        {
          name: 'user/1/b.pdf',
          url: 'https://files.test.local/kyc/user/1/b.pdf',
          contentType: 'application/pdf',
          created,
          updated: created,
          metadata: { kind: 'poa' },
        },
      ]);

      const listCalls = s3Mock.commandCalls(ListObjectsV2Command);
      expect(listCalls).toHaveLength(2);
      expect(listCalls[0].args[0].input).toMatchObject({ Bucket: CONTAINER, Prefix: 'user/1/', MaxKeys: 1000 });
      expect(listCalls[0].args[0].input.ContinuationToken).toBeUndefined();
      expect(listCalls[1].args[0].input.ContinuationToken).toBe('tok-1');
      expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(2);
    });

    it('defaults missing metadata to an empty object', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'k' }], IsTruncated: false });
      s3Mock.on(HeadObjectCommand).resolves({ ContentType: 'image/png', LastModified: new Date() });

      const [blob] = await new S3StorageService(CONTAINER).listBlobs();

      expect(blob.metadata).toEqual({});
    });

    it('skips entries without a Key and returns [] for an empty listing', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: undefined }], IsTruncated: false });

      expect(await new S3StorageService(CONTAINER).listBlobs()).toEqual([]);
      expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(0);
    });

    it('returns [] when Contents is absent', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({ IsTruncated: false });

      expect(await new S3StorageService(CONTAINER).listBlobs()).toEqual([]);
    });
  });

  describe('getBlob', () => {
    it('returns the decoded body with metadata', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const created = new Date('2026-02-02T00:00:00.000Z');
      s3Mock.on(GetObjectCommand, { Bucket: CONTAINER, Key: 'doc.pdf' }).resolves({
        Body: bodyStream(bytes) as never,
        ContentType: 'application/pdf',
        LastModified: created,
        Metadata: { source: 'kyc' },
      });

      const res = await new S3StorageService(CONTAINER).getBlob('doc.pdf');

      expect(res.data).toBeInstanceOf(Buffer);
      expect(res.data.equals(Buffer.from(bytes))).toBe(true);
      expect(res.contentType).toBe('application/pdf');
      expect(res.created).toBe(created);
      expect(res.updated).toBe(created);
      expect(res.metadata).toEqual({ source: 'kyc' });
    });

    it('throws when the body is empty', async () => {
      s3Mock.on(GetObjectCommand).resolves({ Body: undefined });

      await expect(new S3StorageService(CONTAINER).getBlob('missing')).rejects.toThrow(
        'Empty body for blob kyc/missing',
      );
    });
  });

  describe('uploadBlob', () => {
    it('sends a PutObjectCommand and returns the blob URL', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      const data = Buffer.from('hello');

      const url = await new S3StorageService(CONTAINER).uploadBlob('user/1/file.txt', data, 'text/plain', {
        owner: 'u1',
      });

      expect(url).toBe('https://files.test.local/kyc/user/1/file.txt');
      const calls = s3Mock.commandCalls(PutObjectCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toMatchObject({
        Bucket: CONTAINER,
        Key: 'user/1/file.txt',
        Body: data,
        ContentType: 'text/plain',
        Metadata: { owner: 'u1' },
      });
    });

    it('passes undefined metadata through', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      await new S3StorageService(CONTAINER).uploadBlob('a.bin', Buffer.from('x'), 'application/octet-stream');

      expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input.Metadata).toBeUndefined();
    });
  });

  describe('uploadWormBlob (WORM/EP2 sink, fail-closed Object-Lock guard)', () => {
    /** Expected RetainUntil bounds: bucket years + 1-day safety margin for client latency/skew. */
    function retainUntilBounds(beforeMs: number, afterMs: number, years: number): { min: Date; max: Date } {
      const min = new Date(beforeMs);
      min.setUTCFullYear(min.getUTCFullYear() + years);
      min.setUTCDate(min.getUTCDate() + 1);
      const max = new Date(afterMs);
      max.setUTCFullYear(max.getUTCFullYear() + years);
      max.setUTCDate(max.getUTCDate() + 1);
      return { min, max };
    }

    /** Expected RetainUntil bounds: bucket days + 1-day safety margin (calendar-day arithmetic). */
    function retainUntilBoundsDays(beforeMs: number, afterMs: number, days: number): { min: Date; max: Date } {
      const min = new Date(beforeMs);
      min.setUTCDate(min.getUTCDate() + days + 1);
      const max = new Date(afterMs);
      max.setUTCDate(max.getUTCDate() + days + 1);
      return { min, max };
    }

    it('PUTs into a bucket whose Object Lock is enabled', async () => {
      const container = 'ep2-worm-locked';
      const bucketYears = GEBUEV_RETENTION_FLOOR_YEARS;
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).resolves({
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: bucketYears } },
        },
      });
      s3Mock.on(PutObjectCommand).resolves({});

      const before = Date.now();
      const url = await new S3StorageService(container).uploadWormBlob(
        'settlement.ep2',
        Buffer.from('<ep2/>'),
        'text/xml',
      );
      const after = Date.now();

      expect(url).toBe(`https://files.test.local/${container}/settlement.ep2`);
      const puts = s3Mock.commandCalls(PutObjectCommand);
      expect(puts).toHaveLength(1);
      expect(puts[0].args[0].input).toMatchObject({
        Bucket: container,
        Key: 'settlement.ep2',
        ContentType: 'text/xml',
        ObjectLockMode: ObjectLockRetentionMode.COMPLIANCE,
      });
      const retainUntil = puts[0].args[0].input.ObjectLockRetainUntilDate as Date;
      expect(retainUntil).toBeInstanceOf(Date);
      // at least the bucket default years out (margin makes it slightly more, never less)
      const yearsOnlyMin = new Date(before);
      yearsOnlyMin.setUTCFullYear(yearsOnlyMin.getUTCFullYear() + bucketYears);
      expect(retainUntil.getTime()).toBeGreaterThanOrEqual(yearsOnlyMin.getTime());
      const { min, max } = retainUntilBounds(before, after, bucketYears);
      expect(retainUntil.getTime()).toBeGreaterThanOrEqual(min.getTime());
      expect(retainUntil.getTime()).toBeLessThanOrEqual(max.getTime());
    });

    it('mirrors a bucket default higher than the floor on per-object RetainUntilDate', async () => {
      const container = 'ep2-worm-above-floor';
      const bucketYears = GEBUEV_RETENTION_FLOOR_YEARS + 1; // e.g. 11 when floor is 10
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).resolves({
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: bucketYears } },
        },
      });
      s3Mock.on(PutObjectCommand).resolves({});

      const before = Date.now();
      await new S3StorageService(container).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml');
      const after = Date.now();

      const retainUntil = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input.ObjectLockRetainUntilDate as Date;
      expect(retainUntil).toBeInstanceOf(Date);
      // must use the validated bucket years (11), not the floor (10); at least years out
      const yearsOnlyMin = new Date(before);
      yearsOnlyMin.setUTCFullYear(yearsOnlyMin.getUTCFullYear() + bucketYears);
      expect(retainUntil.getTime()).toBeGreaterThanOrEqual(yearsOnlyMin.getTime());
      const { min, max } = retainUntilBounds(before, after, bucketYears);
      expect(retainUntil.getTime()).toBeGreaterThanOrEqual(min.getTime());
      expect(retainUntil.getTime()).toBeLessThanOrEqual(max.getTime());
      // and must be past what the floor alone would produce
      const floorMax = new Date(after);
      floorMax.setUTCFullYear(floorMax.getUTCFullYear() + GEBUEV_RETENTION_FLOOR_YEARS);
      floorMax.setUTCDate(floorMax.getUTCDate() + 1);
      expect(retainUntil.getTime()).toBeGreaterThan(floorMax.getTime());
    });

    it('attaches per-object COMPLIANCE retention on every WORM PUT (mirrors validated bucket default)', async () => {
      const container = 'ep2-worm-per-object-retention';
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).resolves({
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: 11 } },
        },
      });
      s3Mock.on(PutObjectCommand).resolves({});

      await new S3StorageService(container).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml', {
        source: 'ep2',
      });

      const put = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
      expect(put.ObjectLockMode).toBe(ObjectLockRetentionMode.COMPLIANCE);
      expect(put.ObjectLockRetainUntilDate).toBeInstanceOf(Date);
      expect(put.Metadata).toEqual({ source: 'ep2' });
      // plain uploadBlob must remain free of Object Lock headers
      s3Mock.resetHistory();
      s3Mock.on(PutObjectCommand).resolves({});
      await new S3StorageService(container).uploadBlob('plain.txt', Buffer.from('x'), 'text/plain');
      const plainPut = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
      expect(plainPut.ObjectLockMode).toBeUndefined();
      expect(plainPut.ObjectLockRetainUntilDate).toBeUndefined();
    });

    it('fails closed and does NOT PUT when Object Lock is not enabled on the bucket', async () => {
      const container = 'ep2-worm-unlocked';
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).resolves({ ObjectLockConfiguration: {} });
      s3Mock.on(PutObjectCommand).resolves({});

      await expect(
        new S3StorageService(container).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml'),
      ).rejects.toThrow('Object Lock is not enabled');

      // the mutable bucket must never receive the compliance record
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it('fails closed when the lock configuration cannot be read (e.g. bucket has no Object Lock config)', async () => {
      const container = 'ep2-worm-noconfig';
      const err = Object.assign(new Error('Object Lock configuration does not exist for this bucket'), {
        name: 'ObjectLockConfigurationNotFoundError',
      });
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).rejects(err);
      s3Mock.on(PutObjectCommand).resolves({});

      await expect(
        new S3StorageService(container).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml'),
      ).rejects.toThrow('could not verify Object Lock is enabled');

      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it('fails closed with a non-Error rejection from the lock-configuration read', async () => {
      const container = 'ep2-worm-non-error-rejection';
      s3Mock
        .on(GetObjectLockConfigurationCommand, { Bucket: container })
        .callsFake(() => Promise.reject('access denied'));
      s3Mock.on(PutObjectCommand).resolves({});

      await expect(
        new S3StorageService(container).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml'),
      ).rejects.toThrow('could not verify Object Lock is enabled (error: access denied)');

      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it('probes Object Lock on every WORM write (no TTL cache)', async () => {
      const container = 'ep2-worm-probe-every-write';
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).resolves({
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: 11 } },
        },
      });
      s3Mock.on(PutObjectCommand).resolves({});

      const service = new S3StorageService(container);
      await service.uploadWormBlob('a.ep2', Buffer.from('a'), 'text/xml');
      await service.uploadWormBlob('b.ep2', Buffer.from('b'), 'text/xml');
      await new S3StorageService(container).uploadWormBlob('c.ep2', Buffer.from('c'), 'text/xml');

      expect(s3Mock.commandCalls(GetObjectLockConfigurationCommand)).toHaveLength(3);
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(3);
    });

    it('picks up a raised bucket default retention on the very next WORM write', async () => {
      const container = 'ep2-worm-raised-default';
      const lowerYears = GEBUEV_RETENTION_FLOOR_YEARS;
      const raisedYears = GEBUEV_RETENTION_FLOOR_YEARS + 2;
      s3Mock
        .on(GetObjectLockConfigurationCommand, { Bucket: container })
        .resolvesOnce({
          ObjectLockConfiguration: {
            ObjectLockEnabled: 'Enabled',
            Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: lowerYears } },
          },
        })
        .resolvesOnce({
          ObjectLockConfiguration: {
            ObjectLockEnabled: 'Enabled',
            Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: raisedYears } },
          },
        });
      s3Mock.on(PutObjectCommand).resolves({});

      const service = new S3StorageService(container);
      const beforeFirst = Date.now();
      await service.uploadWormBlob('first.ep2', Buffer.from('a'), 'text/xml');
      const afterFirst = Date.now();
      const beforeSecond = Date.now();
      await service.uploadWormBlob('second.ep2', Buffer.from('b'), 'text/xml');
      const afterSecond = Date.now();

      expect(s3Mock.commandCalls(GetObjectLockConfigurationCommand)).toHaveLength(2);
      const puts = s3Mock.commandCalls(PutObjectCommand);
      expect(puts).toHaveLength(2);

      const firstRetain = puts[0].args[0].input.ObjectLockRetainUntilDate as Date;
      const secondRetain = puts[1].args[0].input.ObjectLockRetainUntilDate as Date;

      // first write uses the lower default (at least those years out; margin may add a day)
      const firstYearsOnlyMin = new Date(beforeFirst);
      firstYearsOnlyMin.setUTCFullYear(firstYearsOnlyMin.getUTCFullYear() + lowerYears);
      expect(firstRetain.getTime()).toBeGreaterThanOrEqual(firstYearsOnlyMin.getTime());
      const firstBounds = retainUntilBounds(beforeFirst, afterFirst, lowerYears);
      expect(firstRetain.getTime()).toBeGreaterThanOrEqual(firstBounds.min.getTime());
      expect(firstRetain.getTime()).toBeLessThanOrEqual(firstBounds.max.getTime());

      // second write must mirror the raised default immediately — no stale lower value
      const secondYearsOnlyMin = new Date(beforeSecond);
      secondYearsOnlyMin.setUTCFullYear(secondYearsOnlyMin.getUTCFullYear() + raisedYears);
      expect(secondRetain.getTime()).toBeGreaterThanOrEqual(secondYearsOnlyMin.getTime());
      const secondBounds = retainUntilBounds(beforeSecond, afterSecond, raisedYears);
      expect(secondRetain.getTime()).toBeGreaterThanOrEqual(secondBounds.min.getTime());
      expect(secondRetain.getTime()).toBeLessThanOrEqual(secondBounds.max.getTime());
      expect(secondRetain.getTime()).toBeGreaterThan(firstRetain.getTime());
    });

    it('fails closed when the default retention mode is GOVERNANCE instead of COMPLIANCE', async () => {
      const container = 'ep2-worm-governance';
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).resolves({
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'GOVERNANCE', Years: 11 } },
        },
      });
      s3Mock.on(PutObjectCommand).resolves({});

      await expect(
        new S3StorageService(container).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml'),
      ).rejects.toThrow('Object Lock is not enabled');

      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it('fails closed when Object Lock is enabled but no default retention rule is configured', async () => {
      const container = 'ep2-worm-no-default-retention';
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).resolves({
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: {},
        },
      });
      s3Mock.on(PutObjectCommand).resolves({});

      await expect(
        new S3StorageService(container).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml'),
      ).rejects.toThrow('Object Lock is not enabled');

      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it('fails closed when the COMPLIANCE retention Years is below the GeBüV floor', async () => {
      const container = 'ep2-worm-under-floor';
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).resolves({
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: GEBUEV_RETENTION_FLOOR_YEARS - 1 } },
        },
      });
      s3Mock.on(PutObjectCommand).resolves({});

      await expect(
        new S3StorageService(container).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml'),
      ).rejects.toThrow('Object Lock is not enabled');

      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    // MinIO surfaces the production default retention as Days (e.g. 4015), not Years.
    it('PUTs into a MinIO-style bucket with COMPLIANCE Days retention (4015) and mirrors RetainUntil', async () => {
      const container = 'ep2-worm-minio-days';
      const bucketDays = 4015;
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).resolves({
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: bucketDays } },
        },
      });
      s3Mock.on(PutObjectCommand).resolves({});

      const before = Date.now();
      const url = await new S3StorageService(container).uploadWormBlob(
        'settlement.ep2',
        Buffer.from('<ep2/>'),
        'text/xml',
      );
      const after = Date.now();

      expect(url).toBe(`https://files.test.local/${container}/settlement.ep2`);
      const puts = s3Mock.commandCalls(PutObjectCommand);
      expect(puts).toHaveLength(1);
      expect(puts[0].args[0].input).toMatchObject({
        Bucket: container,
        Key: 'settlement.ep2',
        ContentType: 'text/xml',
        ObjectLockMode: ObjectLockRetentionMode.COMPLIANCE,
      });
      const retainUntil = puts[0].args[0].input.ObjectLockRetainUntilDate as Date;
      expect(retainUntil).toBeInstanceOf(Date);
      // validated days only (no safety day yet) must be at or before retainUntil
      const daysOnlyMin = new Date(before);
      daysOnlyMin.setUTCDate(daysOnlyMin.getUTCDate() + bucketDays);
      expect(retainUntil.getTime()).toBeGreaterThanOrEqual(daysOnlyMin.getTime());
      // full bounds: validated days + 1-day safety margin
      const { min, max } = retainUntilBoundsDays(before, after, bucketDays);
      expect(retainUntil.getTime()).toBeGreaterThanOrEqual(min.getTime());
      expect(retainUntil.getTime()).toBeLessThanOrEqual(max.getTime());
    });

    it('fails closed and does NOT PUT when COMPLIANCE Days retention is below the GeBüV day floor', async () => {
      const container = 'ep2-worm-days-under-floor';
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).resolves({
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: GEBUEV_RETENTION_FLOOR_DAYS - 1 } },
        },
      });
      s3Mock.on(PutObjectCommand).resolves({});

      await expect(
        new S3StorageService(container).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml'),
      ).rejects.toThrow('Object Lock is not enabled');

      await expect(
        new S3StorageService(container).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml'),
      ).rejects.toThrow(new RegExp(`Days=${GEBUEV_RETENTION_FLOOR_DAYS - 1}`));

      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it('fails closed and does NOT PUT when both retention Years and Days are set', async () => {
      const container = 'ep2-worm-both-retention-units';
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).resolves({
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
      s3Mock.on(PutObjectCommand).resolves({});

      await expect(
        new S3StorageService(container).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml'),
      ).rejects.toThrow(`Years=${GEBUEV_RETENTION_FLOOR_YEARS}, Days=4015`);

      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
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
    ])('fails closed and does NOT PUT when COMPLIANCE $unit retention is not an integer', async (testCase) => {
      const container = `ep2-worm-non-integer-${testCase.unit.toLowerCase()}`;
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).resolves({
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: testCase.retention },
        },
      });
      s3Mock.on(PutObjectCommand).resolves({});

      await expect(
        new S3StorageService(container).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml'),
      ).rejects.toThrow(`${testCase.unit}=${testCase.value}`);

      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });
  });

  describe('copyBlobs', () => {
    beforeEach(() => {
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: CONTAINER }).resolves({
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: 11 } },
        },
      });
    });

    it('URL-encodes keys with spaces / special chars and rewrites the prefix', async () => {
      const key = 'src/sub dir/file (1)+&.png';
      s3Mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: key }], IsTruncated: false });
      s3Mock.on(CopyObjectCommand).resolves({});

      const targetKeys = await new S3StorageService(CONTAINER).copyBlobs('src/', 'dst/');

      expect(targetKeys).toEqual(['dst/sub dir/file (1)+&.png']);
      const calls = s3Mock.commandCalls(CopyObjectCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toMatchObject({
        Bucket: CONTAINER,
        Key: 'dst/sub dir/file (1)+&.png',
        // path separators preserved, each segment percent-encoded
        CopySource: 'kyc/src/sub%20dir/file%20(1)%2B%26.png',
      });
      // copy must not fan out to HeadObject
      expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(0);
    });

    it('copies every listed key', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'src/a' }, { Key: 'src/b' }], IsTruncated: false });
      s3Mock.on(CopyObjectCommand).resolves({});

      const targetKeys = await new S3StorageService(CONTAINER).copyBlobs('src/', 'dst/');

      expect(targetKeys).toEqual(['dst/a', 'dst/b']);
      const keys = s3Mock.commandCalls(CopyObjectCommand).map((c) => c.args[0].input.Key);
      expect(keys).toEqual(['dst/a', 'dst/b']);
    });

    it('does nothing for an empty source prefix', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({ Contents: [], IsTruncated: false });

      const targetKeys = await new S3StorageService(CONTAINER).copyBlobs('src/', 'dst/');

      expect(targetKeys).toEqual([]);
      expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
    });

    it('fails closed and does NOT copy when Object Lock is not enabled on the bucket', async () => {
      const container = 'copy-worm-unlocked';
      s3Mock.on(GetObjectLockConfigurationCommand, { Bucket: container }).resolves({ ObjectLockConfiguration: {} });
      s3Mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'src/a' }], IsTruncated: false });
      s3Mock.on(CopyObjectCommand).resolves({});

      await expect(new S3StorageService(container).copyBlobs('src/', 'dst/')).rejects.toThrow(
        'Object Lock is not enabled',
      );

      expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
    });
  });

  describe('blobUrl / blobName roundtrip (inherited)', () => {
    it('builds a URL and reverses it, including encoded segments', () => {
      const service = new S3StorageService(CONTAINER);
      const name = 'user/1/my file.png';

      const url = service.blobUrl(name);

      expect(url).toBe('https://files.test.local/kyc/user/1/my%20file.png');
      expect(service.blobName(url)).toBe(name);
    });

    it('throws blobName for a URL outside the container', () => {
      const service = new S3StorageService(CONTAINER);

      expect(() => service.blobName('https://files.test.local/other/x.png')).toThrow(
        'URL does not belong to container kyc',
      );
    });
  });
});
