import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Test } from '@nestjs/testing';
import { mockClient } from 'aws-sdk-client-mock';
import { TestUtil } from 'src/shared/utils/test.util';
import { S3StorageService } from '../s3-storage.service';

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
    it('builds with a complete config', () => {
      expect(new S3StorageService(CONTAINER)).toBeInstanceOf(S3StorageService);
    });

    it('throws when endpoint is missing', async () => {
      await provideConfig({ ...validS3, endpoint: undefined });
      expect(() => new S3StorageService(CONTAINER)).toThrow('Incomplete S3 config');
    });

    it('throws when region is missing', async () => {
      await provideConfig({ ...validS3, region: undefined });
      expect(() => new S3StorageService(CONTAINER)).toThrow('Incomplete S3 config');
    });

    it('throws when accessKey is missing', async () => {
      await provideConfig({ ...validS3, accessKey: undefined });
      expect(() => new S3StorageService(CONTAINER)).toThrow('Incomplete S3 config');
    });

    it('throws when secretKey is missing', async () => {
      await provideConfig({ ...validS3, secretKey: undefined });
      expect(() => new S3StorageService(CONTAINER)).toThrow('Incomplete S3 config');
    });

    it('throws when publicUrl is missing', async () => {
      await provideConfig({ ...validS3, publicUrl: undefined });
      expect(() => new S3StorageService(CONTAINER)).toThrow('Incomplete S3 config');
    });

    it('throws when publicUrl has no trailing slash', async () => {
      await provideConfig({ ...validS3, publicUrl: 'https://files.test.local' });
      expect(() => new S3StorageService(CONTAINER)).toThrow('must end with a trailing slash');
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

  describe('copyBlobs', () => {
    it('URL-encodes keys with spaces / special chars and rewrites the prefix', async () => {
      const key = 'src/sub dir/file (1)+&.png';
      s3Mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: key }], IsTruncated: false });
      s3Mock.on(CopyObjectCommand).resolves({});

      await new S3StorageService(CONTAINER).copyBlobs('src/', 'dst/');

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

      await new S3StorageService(CONTAINER).copyBlobs('src/', 'dst/');

      const keys = s3Mock.commandCalls(CopyObjectCommand).map((c) => c.args[0].input.Key);
      expect(keys).toEqual(['dst/a', 'dst/b']);
    });

    it('does nothing for an empty source prefix', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({ Contents: [], IsTruncated: false });

      await new S3StorageService(CONTAINER).copyBlobs('src/', 'dst/');

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
