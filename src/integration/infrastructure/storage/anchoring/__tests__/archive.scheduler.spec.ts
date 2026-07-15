// Stub the heavy `opentimestamps` library (pulled in transitively via ArchiveService) so its
// eager network/`request` deps never load; ArchiveService is fully mocked in this spec anyway.
jest.mock('opentimestamps', () => ({}));

const mockCreateStorageService = jest.fn();
jest.mock('src/integration/infrastructure/storage/storage.factory', () => ({
  createStorageService: (...args: any[]) => mockCreateStorageService(...args),
}));

import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { ArchiveBatch } from '../archive-batch.entity';
import { ArchiveScheduler } from '../archive.scheduler';
import { ArchiveService } from '../archive.service';
import { sha256 } from '../merkle';

describe('ArchiveScheduler', () => {
  let scheduler: ArchiveScheduler;
  let archiveService: ArchiveService;

  beforeEach(async () => {
    archiveService = createMock<ArchiveService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArchiveScheduler,
        { provide: ArchiveService, useValue: archiveService },
        { provide: RepositoryFactory, useValue: createMock<RepositoryFactory>() },
      ],
    }).compile();

    scheduler = module.get<ArchiveScheduler>(ArchiveScheduler);
  });

  it('should be defined', () => {
    expect(scheduler).toBeDefined();
  });

  describe('anchorPending', () => {
    it('delegates to ArchiveService.anchorPending', async () => {
      (archiveService.anchorPending as jest.Mock).mockResolvedValue({ id: 1, merkleRoot: 'ab' } as ArchiveBatch);

      await scheduler.anchorPending();

      expect(archiveService.anchorPending).toHaveBeenCalledTimes(1);
    });

    it('propagates errors to the @DfxCron wrapper', async () => {
      (archiveService.anchorPending as jest.Mock).mockRejectedValue(new Error('calendar down'));

      await expect(scheduler.anchorPending()).rejects.toThrow('calendar down');
    });
  });

  describe('upgradeBatches', () => {
    it('delegates to ArchiveService.upgradeBatches', async () => {
      await scheduler.upgradeBatches();

      expect(archiveService.upgradeBatches).toHaveBeenCalledTimes(1);
    });

    it('propagates errors to the @DfxCron wrapper', async () => {
      (archiveService.upgradeBatches as jest.Mock).mockRejectedValue(new Error('upgrade failed'));

      await expect(scheduler.upgradeBatches()).rejects.toThrow('upgrade failed');
    });
  });

  describe('reconcileHashes', () => {
    let scheduler: ArchiveScheduler;
    let archiveService: ArchiveService;
    let repos: RepositoryFactory;

    const storageStubs: Record<string, { listKeys: jest.Mock; getBlob: jest.Mock }> = {};

    const stubStorage = (container: string, blobs: { name: string; data: Buffer }[]) => {
      storageStubs[container] = {
        listKeys: jest.fn().mockResolvedValue(blobs.map((b) => b.name)),
        getBlob: jest.fn((name: string) => Promise.resolve({ data: blobs.find((b) => b.name === name)!.data })),
      };
    };

    beforeEach(async () => {
      for (const key of Object.keys(storageStubs)) delete storageStubs[key];
      mockCreateStorageService.mockReset();
      mockCreateStorageService.mockImplementation((container: string) => storageStubs[container]);

      archiveService = createMock<ArchiveService>();
      repos = createMock<RepositoryFactory>();
      (repos.userData as unknown) = createMock<UserDataRepository>();

      (repos.userData.find as jest.Mock).mockResolvedValue([]);
      (archiveService.recordedNames as jest.Mock).mockResolvedValue(new Set());

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ArchiveScheduler,
          { provide: ArchiveService, useValue: archiveService },
          { provide: RepositoryFactory, useValue: repos },
        ],
      }).compile();

      scheduler = module.get<ArchiveScheduler>(ArchiveScheduler);
    });

    it('recordHash only objects present in storage but absent from recordedNames', async () => {
      const missingData = Buffer.from('missing-doc');
      const presentData = Buffer.from('already-recorded');

      stubStorage('kyc', [
        { name: 'user/1/a.pdf', data: missingData },
        { name: 'user/1/b.pdf', data: presentData },
      ]);
      (archiveService.recordedNames as jest.Mock).mockResolvedValue(new Set(['user/1/b.pdf']));

      await scheduler.reconcileHashes();

      expect(archiveService.recordHash).toHaveBeenCalledTimes(1);
      expect(archiveService.recordHash).toHaveBeenCalledWith(
        'kyc',
        'user/1/a.pdf',
        sha256(missingData).toString('hex'),
      );
      expect(archiveService.recordHash).not.toHaveBeenCalledWith('kyc', 'user/1/b.pdf', expect.anything());
    });

    it('deduplicates ep2ReportContainer values across UserData rows', async () => {
      const container = 'merchant-ep2-bucket';
      const ud1 = Object.assign(new UserData(), {
        id: 1,
        paymentLinksConfig: JSON.stringify({ ep2ReportContainer: container }),
      });
      const ud2 = Object.assign(new UserData(), {
        id: 2,
        paymentLinksConfig: JSON.stringify({ ep2ReportContainer: container }),
      });
      (repos.userData.find as jest.Mock).mockResolvedValue([ud1, ud2]);

      stubStorage('kyc', []);
      stubStorage(container, [{ name: 'settlement.ep2', data: Buffer.from('<ep2/>') }]);

      await scheduler.reconcileHashes();

      const containersRequested = mockCreateStorageService.mock.calls.map((c) => c[0]);
      expect(containersRequested.filter((c) => c === container)).toHaveLength(1);
      expect(containersRequested).toContain('kyc');
      expect(archiveService.recordHash).toHaveBeenCalledTimes(1);
      expect(archiveService.recordHash).toHaveBeenCalledWith(
        container,
        'settlement.ep2',
        sha256(Buffer.from('<ep2/>')).toString('hex'),
      );
    });

    it('continues when recordHash rejects for one missing object', async () => {
      const dataA = Buffer.from('doc-a');
      const dataB = Buffer.from('doc-b');

      stubStorage('kyc', [
        { name: 'user/1/a.pdf', data: dataA },
        { name: 'user/1/b.pdf', data: dataB },
      ]);
      (archiveService.recordedNames as jest.Mock).mockResolvedValue(new Set());
      (archiveService.recordHash as jest.Mock)
        .mockRejectedValueOnce(new Error('already anchored under a different hash'))
        .mockResolvedValueOnce(undefined);

      await expect(scheduler.reconcileHashes()).resolves.toBeUndefined();

      expect(archiveService.recordHash).toHaveBeenCalledTimes(2);
      expect(archiveService.recordHash).toHaveBeenCalledWith('kyc', 'user/1/a.pdf', sha256(dataA).toString('hex'));
      expect(archiveService.recordHash).toHaveBeenCalledWith('kyc', 'user/1/b.pdf', sha256(dataB).toString('hex'));
    });
  });
});
