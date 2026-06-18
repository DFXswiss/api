import { Test } from '@nestjs/testing';
import { TestUtil } from 'src/shared/utils/test.util';
import { MockStorageService } from '../mock-storage.service';

const CONTAINER = 'mock-spec';

describe('MockStorageService', () => {
  beforeAll(async () => {
    await Test.createTestingModule({
      providers: [TestUtil.provideConfig({ s3: { publicUrl: 'https://files.test.local/' } })],
    }).compile();
  });

  describe('upload / get roundtrip', () => {
    it('stores and reads back data, type and metadata', async () => {
      const service = new MockStorageService(CONTAINER);
      const data = Buffer.from('payload');

      const url = await service.uploadBlob('user/1/note.txt', data, 'text/plain', { owner: 'u1' });
      expect(url).toBe('https://files.test.local/mock-spec/user/1/note.txt');

      const res = await service.getBlob('user/1/note.txt');
      expect(res.data).toBe(data);
      expect(res.contentType).toBe('text/plain');
      expect(res.metadata).toEqual({ owner: 'u1' });
      expect(res.created).toBeInstanceOf(Date);
      expect(res.updated).toBeInstanceOf(Date);
    });

    it('defaults metadata to {} when uploaded without metadata', async () => {
      const service = new MockStorageService(CONTAINER);
      await service.uploadBlob('user/1/plain.txt', Buffer.from('x'), 'text/plain');

      expect((await service.getBlob('user/1/plain.txt')).metadata).toEqual({});
    });
  });

  describe('listBlobs', () => {
    it('filters by prefix and maps stored entries', async () => {
      const service = new MockStorageService('mock-spec-list');
      await service.uploadBlob('user/1/a.png', Buffer.from('a'), 'image/png', { k: 'v' });
      await service.uploadBlob('user/1/b.pdf', Buffer.from('b'), 'application/pdf');
      await service.uploadBlob('user/2/c.png', Buffer.from('c'), 'image/png');

      const blobs = await service.listBlobs('user/1/');

      expect(blobs.map((b) => b.name).sort()).toEqual(['user/1/a.png', 'user/1/b.pdf']);
      const a = blobs.find((b) => b.name === 'user/1/a.png');
      expect(a).toMatchObject({
        url: 'https://files.test.local/mock-spec-list/user/1/a.png',
        contentType: 'image/png',
        metadata: { k: 'v' },
      });
      expect(a.created).toBeInstanceOf(Date);
    });

    it('returns [] when nothing matches the prefix', async () => {
      const service = new MockStorageService('mock-spec-empty');

      expect(await service.listBlobs('nope/')).toEqual([]);
    });

    it('lists all entries of the container when no prefix is given', async () => {
      const service = new MockStorageService('mock-spec-all');
      await service.uploadBlob('x.png', Buffer.from('x'), 'image/png');
      await service.uploadBlob('y.png', Buffer.from('y'), 'image/png');

      expect((await service.listBlobs()).map((b) => b.name).sort()).toEqual(['x.png', 'y.png']);
    });
  });

  describe('getBlob dummy-file fallback', () => {
    const service = new MockStorageService('mock-spec-dummy');

    it('returns a mapped dummy file by basename', async () => {
      const res = await service.getBlob('user/1/id_front.png');
      expect(res.contentType).toBe('image/png');
      expect(res.data.length).toBeGreaterThan(0);
      expect(res.metadata).toEqual({});
    });

    it('returns a mapped pdf dummy file', async () => {
      const res = await service.getBlob('proof_of_address.pdf');
      expect(res.contentType).toBe('application/pdf');
      expect(res.data.length).toBeGreaterThan(0);
    });

    it('falls back by .pdf extension for an unmapped name', async () => {
      const res = await service.getBlob('user/1/some-random.pdf');
      expect(res.contentType).toBe('application/pdf');
      expect(res.data.length).toBeGreaterThan(0);
    });

    it('falls back by .jpg extension for an unmapped name', async () => {
      const res = await service.getBlob('user/1/holiday.jpg');
      expect(res.contentType).toBe('image/jpeg');
      expect(res.data.length).toBeGreaterThan(0);
    });

    it('falls back by .jpeg extension for an unmapped name', async () => {
      const res = await service.getBlob('user/1/holiday.jpeg');
      expect(res.contentType).toBe('image/jpeg');
    });

    it('falls back to png for any other / extensionless name', async () => {
      const res = await service.getBlob('user/1/whatever');
      expect(res.contentType).toBe('image/png');
      expect(res.data.length).toBeGreaterThan(0);
    });
  });

  describe('copyBlobs', () => {
    it('copies matching blobs with the prefix replaced', async () => {
      const service = new MockStorageService('mock-spec-copy');
      await service.uploadBlob('src/a.png', Buffer.from('a'), 'image/png', { k: 'v' });
      await service.uploadBlob('src/sub/b.pdf', Buffer.from('b'), 'application/pdf');

      await service.copyBlobs('src/', 'dst/');

      const copied = await service.listBlobs('dst/');
      expect(copied.map((b) => b.name).sort()).toEqual(['dst/a.png', 'dst/sub/b.pdf']);

      const copiedA = await service.getBlob('dst/a.png');
      expect(copiedA.data.equals(Buffer.from('a'))).toBe(true);
      expect(copiedA.contentType).toBe('image/png');
      expect(copiedA.metadata).toEqual({ k: 'v' });

      // source remains untouched
      expect((await service.listBlobs('src/')).map((b) => b.name).sort()).toEqual(['src/a.png', 'src/sub/b.pdf']);
    });
  });
});
