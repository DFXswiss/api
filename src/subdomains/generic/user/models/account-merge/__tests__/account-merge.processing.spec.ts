import { ConfigService } from 'src/config/config';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Util } from 'src/shared/utils/util';
import { UserData } from '../../user-data/user-data.entity';
import { UserDataService } from '../../user-data/user-data.service';
import { AccountMerge } from '../account-merge.entity';
import { AccountMergeRepository } from '../account-merge.repository';
import { AccountMergeService } from '../account-merge.service';

describe('AccountMerge processing state', () => {
  beforeAll(() => {
    new ConfigService();
  });

  describe('isProcessing getter', () => {
    const build = (overrides: Partial<AccountMerge>): AccountMerge =>
      Object.assign(new AccountMerge(), { isCompleted: false, expiration: Util.daysAfter(1) }, overrides);

    it('is false before processing starts', () => {
      expect(build({ processingStartedAt: undefined }).isProcessing).toBe(false);
    });

    it('is true once processing started and the merge is neither completed nor expired', () => {
      expect(build({ processingStartedAt: new Date() }).isProcessing).toBe(true);
    });

    it('is false once the merge is completed', () => {
      expect(build({ processingStartedAt: new Date(), isCompleted: true }).isProcessing).toBe(false);
    });

    it('is false once the merge is expired', () => {
      expect(build({ processingStartedAt: new Date(), expiration: Util.daysBefore(1) }).isProcessing).toBe(false);
    });
  });

  describe('hasProcessingMerge', () => {
    it('queries open, processing, non-expired merges for the userData as master or slave', async () => {
      const existsBy = jest.fn().mockResolvedValue(true);
      const service = new AccountMergeService(
        { existsBy } as unknown as AccountMergeRepository,
        {} as unknown as NotificationService,
        {} as unknown as KycLogService,
        {} as unknown as UserDataService,
      );

      const result = await service.hasProcessingMerge(7);

      expect(result).toBe(true);
      const [where] = existsBy.mock.calls[0];
      expect(where).toHaveLength(2);
      expect(where[0]).toMatchObject({ isCompleted: false, master: { id: 7 } });
      expect(where[1]).toMatchObject({ isCompleted: false, slave: { id: 7 } });
    });
  });

  describe('executeMerge cleanup on failure', () => {
    it('clears processingStartedAt when mergeUserData throws, so the client is not stuck processing', async () => {
      const master = Object.assign(new UserData(), { id: 1, kycLevel: 20, mail: 'm@test.com' });
      const slave = Object.assign(new UserData(), { id: 2, kycLevel: 10, mail: 's@test.com' });
      const request = Object.assign(new AccountMerge(), {
        id: 5,
        code: 'code-5',
        master,
        slave,
        isCompleted: false,
        expiration: Util.daysAfter(1),
      });

      const update = jest.fn();
      const service = new AccountMergeService(
        { findOne: jest.fn().mockResolvedValue(request), update } as unknown as AccountMergeRepository,
        {} as unknown as NotificationService,
        { createMergeLog: jest.fn() } as unknown as KycLogService,
        { mergeUserData: jest.fn().mockRejectedValue(new Error('merge failed')) } as unknown as UserDataService,
      );

      await expect(service.executeMerge('code-5')).rejects.toThrow('merge failed');

      // last persisted update must be the cleanup (processingStartedAt = null), and complete() never ran
      const updates = update.mock.calls.map((c) => c[1]);
      expect(updates).toContainEqual({ processingStartedAt: null });
      expect(updates).not.toContainEqual(expect.objectContaining({ isCompleted: true }));
      expect(request.isProcessing).toBe(false);
    });
  });
});
