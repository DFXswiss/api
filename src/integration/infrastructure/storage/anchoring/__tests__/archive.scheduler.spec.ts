// Stub the heavy `opentimestamps` library (pulled in transitively via ArchiveService) so its
// eager network/`request` deps never load; ArchiveService is fully mocked in this spec anyway.
jest.mock('opentimestamps', () => ({}));

import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ArchiveBatch } from '../archive-batch.entity';
import { ArchiveScheduler } from '../archive.scheduler';
import { ArchiveService } from '../archive.service';

describe('ArchiveScheduler', () => {
  let scheduler: ArchiveScheduler;
  let archiveService: ArchiveService;

  beforeEach(async () => {
    archiveService = createMock<ArchiveService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ArchiveScheduler, { provide: ArchiveService, useValue: archiveService }],
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

    it('swallows errors so a failure never crashes the scheduler', async () => {
      (archiveService.anchorPending as jest.Mock).mockRejectedValue(new Error('calendar down'));

      await expect(scheduler.anchorPending()).resolves.toBeUndefined();
    });
  });

  describe('upgradeBatches', () => {
    it('delegates to ArchiveService.upgradeBatches', async () => {
      await scheduler.upgradeBatches();

      expect(archiveService.upgradeBatches).toHaveBeenCalledTimes(1);
    });

    it('swallows errors so a failure never crashes the scheduler', async () => {
      (archiveService.upgradeBatches as jest.Mock).mockRejectedValue(new Error('upgrade failed'));

      await expect(scheduler.upgradeBatches()).resolves.toBeUndefined();
    });
  });
});
