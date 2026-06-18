// Stub the heavy `opentimestamps` library so its eager network/`request` deps never load:
// this spec mocks OpenTimestampsService entirely, so the real implementation is never used.
jest.mock('opentimestamps', () => ({}));

import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ArchiveBatch } from '../archive-batch.entity';
import { ArchiveBatchRepository } from '../archive-batch.repository';
import { ArchiveFile } from '../archive-file.entity';
import { ArchiveFileRepository } from '../archive-file.repository';
import { ArchiveService } from '../archive.service';
import { sha256 } from '../merkle';
import { OpenTimestampsService } from '../opentimestamps.service';

/**
 * A shared in-memory store backing both fake repositories. It reproduces just enough TypeORM
 * behaviour (auto-increment ids, `(bucket, name)` upsert, batch-null filtering, ordering and
 * `manager.transaction`) for the round-trip the service performs, so that saves inside the
 * transaction the service runs on the batch repo's manager land in the same `files`/`batches`
 * arrays the assertions inspect. The Merkle math is the REAL Stage-1 module; only
 * OpenTimestamps is mocked so no network is touched.
 */
function fakeStore() {
  const files: ArchiveFile[] = [];
  const batches: ArchiveBatch[] = [];
  let fileSeq = 0;
  let batchSeq = 0;

  // dispatch a single entity (or array) by type, assigning ids on first save.
  const saveEntity = (entity: any): any => {
    const list = Array.isArray(entity) ? entity : [entity];
    for (const item of list) {
      if (item instanceof ArchiveBatch) {
        if (!item.id) {
          item.id = ++batchSeq;
          batches.push(item);
        }
      } else {
        if (!item.id) {
          item.id = ++fileSeq;
          files.push(item);
        }
      }
    }
    return entity;
  };

  const manager = {
    save: async (entity: any) => saveEntity(entity),
    transaction: async (run: (manager: any) => Promise<void>) => run(manager),
  };

  const fileRepo: any = {
    files,
    manager,
    create: (data: Partial<ArchiveFile>) => Object.assign(new ArchiveFile(), data),
    save: async (entity: ArchiveFile | ArchiveFile[]) => saveEntity(entity),
    update: async (id: number, partial: Partial<ArchiveFile>) => {
      const file = files.find((f) => f.id === id);
      if (file) Object.assign(file, partial);
    },
    findOneBy: async (where: Partial<ArchiveFile>) =>
      files.find((f) => f.bucket === where.bucket && f.name === where.name) ?? undefined,
    // supports lookup by id or by (bucket, name); `relations` is implicit since the in-memory
    // files already carry their `batch` reference once anchored.
    findOne: async ({ where }: any) =>
      files.find((f) => (where.id != null ? f.id === where.id : f.bucket === where.bucket && f.name === where.name)) ??
      undefined,
    find: async ({ where, order }: any) => {
      let result = [...files];

      if (where?.batch !== undefined) {
        // TypeORM IsNull() carries `_type === 'isNull'`; otherwise we match a batch id.
        const wantsNull = where.batch?._type === 'isNull' || where.batch === null;
        if (wantsNull) result = result.filter((f) => f.batch == null);
        else if (where.batch?.id != null) result = result.filter((f) => f.batch?.id === where.batch.id);
      }

      if (order?.id === 'ASC') result.sort((a, b) => a.id - b.id);
      if (order?.leafIndex === 'ASC') result.sort((a, b) => a.leafIndex - b.leafIndex);

      return result;
    },
  };

  const batchRepo: any = {
    batches,
    manager,
    create: (data: Partial<ArchiveBatch>) => Object.assign(new ArchiveBatch(), data),
    save: async (entity: ArchiveBatch) => saveEntity(entity),
    findBy: async (where: Partial<ArchiveBatch>) => batches.filter((b) => b.status === where.status),
  };

  return { fileRepo, batchRepo };
}

describe('ArchiveService', () => {
  let service: ArchiveService;
  let fileRepo: any;
  let batchRepo: any;
  let ots: OpenTimestampsService;

  beforeEach(async () => {
    ({ fileRepo, batchRepo } = fakeStore());

    ots = createMock<OpenTimestampsService>();
    // Deterministic, network-free fakes: the .ots bytes just wrap the root; pending forever.
    (ots.stamp as jest.Mock).mockImplementation(async (digest: Buffer) => Buffer.concat([Buffer.from('OTS'), digest]));
    (ots.upgrade as jest.Mock).mockImplementation(async (bytes: Buffer) => bytes);
    (ots.verify as jest.Mock).mockResolvedValue({ confirmed: false, pending: true });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArchiveService,
        { provide: ArchiveFileRepository, useValue: fileRepo },
        { provide: ArchiveBatchRepository, useValue: batchRepo },
        { provide: OpenTimestampsService, useValue: ots },
      ],
    }).compile();

    service = module.get<ArchiveService>(ArchiveService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('round-trip', () => {
    const docs = [
      { bucket: 'archive', name: 'doc-a.pdf', data: Buffer.from('content of document A') },
      { bucket: 'archive', name: 'doc-b.pdf', data: Buffer.from('content of document B') },
      { bucket: 'archive', name: 'doc-c.pdf', data: Buffer.from('content of document C') },
    ];

    beforeEach(async () => {
      for (const doc of docs) {
        await service.recordHash(doc.bucket, doc.name, sha256(doc.data).toString('hex'));
      }
    });

    it('records all files unanchored', () => {
      expect(fileRepo.files).toHaveLength(3);
      expect(fileRepo.files.every((f: ArchiveFile) => f.batch == null)).toBe(true);
    });

    it('upserts idempotently on (bucket, name)', async () => {
      await service.recordHash('archive', 'doc-a.pdf', sha256(Buffer.from('updated A')).toString('hex'));

      expect(fileRepo.files).toHaveLength(3);
      const fileA = fileRepo.files.find((f: ArchiveFile) => f.name === 'doc-a.pdf');
      expect(fileA.sha256).toBe(sha256(Buffer.from('updated A')).toString('hex'));
    });

    it('anchors pending files into a batch and stamps the root', async () => {
      const batch = await service.anchorPending();

      expect(batch).toBeDefined();
      expect(batch.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
      expect(batch.status).toBe('pendingBtc');
      expect(batch.otsProof).toBeDefined();
      expect(ots.stamp).toHaveBeenCalledTimes(1);

      // every file got assigned to the batch with a leaf index
      expect(fileRepo.files.every((f: ArchiveFile) => f.batch?.id === batch.id)).toBe(true);
      expect(fileRepo.files.map((f: ArchiveFile) => f.leafIndex).sort()).toEqual([0, 1, 2]);
    });

    it('returns undefined when there is nothing to anchor', async () => {
      await service.anchorPending();
      const second = await service.anchorPending();
      expect(second).toBeUndefined();
    });

    it('verifies an unchanged, anchored document (real Merkle proof)', async () => {
      await service.anchorPending();

      const result = await service.verifyDocument('archive', 'doc-b.pdf', docs[1].data);

      expect(result.found).toBe(true);
      expect(result.hashMatches).toBe(true);
      expect(result.anchored).toBe(true);
      expect(result.proofValid).toBe(true);
      expect(result.pending).toBe(true);
      expect(result.bitcoinHeight).toBeUndefined();
    });

    it('detects tampered data via hash mismatch', async () => {
      await service.anchorPending();

      const result = await service.verifyDocument('archive', 'doc-b.pdf', Buffer.from('tampered content'));

      expect(result.found).toBe(true);
      expect(result.hashMatches).toBe(false);
      // the stored hash is still genuinely anchored, only the supplied bytes differ
      expect(result.anchored).toBe(true);
      expect(result.proofValid).toBe(true);
    });

    it('reports an unanchored file as anchored:false', async () => {
      const result = await service.verifyDocument('archive', 'doc-a.pdf', docs[0].data);

      expect(result.found).toBe(true);
      expect(result.hashMatches).toBe(true);
      expect(result.anchored).toBe(false);
      expect(result.proofValid).toBeUndefined();
    });

    it('reports an unknown document as found:false', async () => {
      const result = await service.verifyDocument('archive', 'missing.pdf', Buffer.from('whatever'));

      expect(result.found).toBe(false);
    });

    it('confirms a batch once OpenTimestamps reports a Bitcoin attestation', async () => {
      await service.anchorPending();

      (ots.verify as jest.Mock).mockResolvedValue({ confirmed: true, pending: false, bitcoin: { height: 840000 } });

      await service.upgradeBatches();

      expect(batchRepo.batches[0].status).toBe('confirmed');
      expect(batchRepo.batches[0].bitcoinHeight).toBe(840000);
    });

    it('refuses to overwrite an anchored hash with a differing hash (avoids bogus tampering)', async () => {
      await service.anchorPending();

      const anchored = fileRepo.files.find((f: ArchiveFile) => f.name === 'doc-a.pdf');
      const originalHash = anchored.sha256;

      await expect(
        service.recordHash('archive', 'doc-a.pdf', sha256(Buffer.from('re-uploaded A')).toString('hex')),
      ).rejects.toThrow(/Refusing to overwrite anchored hash/);

      // the anchored leaf hash is untouched
      expect(anchored.sha256).toBe(originalHash);
    });

    it('is a no-op when recording the same hash on an already-anchored file', async () => {
      await service.anchorPending();

      const anchored = fileRepo.files.find((f: ArchiveFile) => f.name === 'doc-a.pdf');
      const originalHash = anchored.sha256;

      await expect(service.recordHash('archive', 'doc-a.pdf', originalHash)).resolves.toBeUndefined();

      expect(anchored.sha256).toBe(originalHash);
      expect(fileRepo.files).toHaveLength(3);
    });

    it('persists upgraded proof bytes even while verify still reports pending', async () => {
      await service.anchorPending();

      const batch = batchRepo.batches[0];
      const originalProof = batch.otsProof;

      // upgrade yields changed bytes, but the attestation is not yet on-chain
      (ots.upgrade as jest.Mock).mockResolvedValueOnce(Buffer.from('UPGRADED-BUT-PENDING'));
      (ots.verify as jest.Mock).mockResolvedValueOnce({ confirmed: false, pending: true });

      await service.upgradeBatches();

      expect(batch.otsProof).toBe(Buffer.from('UPGRADED-BUT-PENDING').toString('base64'));
      expect(batch.otsProof).not.toBe(originalProof);
      // still not confirmed
      expect(batch.status).toBe('pendingBtc');
      expect(batch.bitcoinHeight).toBeUndefined();
    });

    it('does not save a batch when upgrade is unchanged and still pending', async () => {
      await service.anchorPending();

      const batch = batchRepo.batches[0];
      const saveSpy = jest.spyOn(batchRepo, 'save');

      // upgrade returns the same bytes, verify still pending => nothing to persist
      await service.upgradeBatches();

      expect(saveSpy).not.toHaveBeenCalled();
      expect(batch.status).toBe('pendingBtc');
    });
  });
});
