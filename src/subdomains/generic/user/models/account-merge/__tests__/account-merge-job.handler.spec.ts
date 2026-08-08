import { ConflictException } from '@nestjs/common';
import { JobDeadLetterException } from 'src/subdomains/supporting/job/exceptions/job-dead-letter.exception';
import { JobService } from 'src/subdomains/supporting/job/services/job.service';
import { UserData } from '../../user-data/user-data.entity';
import { AccountMerge } from '../account-merge.entity';
import { AccountMergeJobHandler } from '../account-merge-job.handler';
import { AccountMergeService } from '../account-merge.service';

describe('AccountMergeJobHandler', () => {
  let handler: AccountMergeJobHandler;
  let accountMergeService: jest.Mocked<Partial<AccountMergeService>>;
  let jobService: jest.Mocked<Partial<JobService>>;

  beforeEach(() => {
    accountMergeService = { executeMerge: jest.fn() };
    jobService = { registerHandler: jest.fn() };

    handler = new AccountMergeJobHandler(
      jobService as unknown as JobService,
      accountMergeService as unknown as AccountMergeService,
    );
  });

  describe('execute', () => {
    it('calls executeMerge with the code and maps master id and kycHash', async () => {
      const request = Object.assign(new AccountMerge(), {
        master: Object.assign(new UserData(), { id: 1, kycHash: 'hash-1' }),
      });
      accountMergeService.executeMerge.mockResolvedValue(request);

      const result = await handler.execute({ code: 'merge-code' });

      expect(accountMergeService.executeMerge).toHaveBeenCalledWith('merge-code');
      expect(result).toEqual({ masterUserDataId: 1, kycHash: 'hash-1' });
    });

    it('does not include an accessToken field on the result', async () => {
      const request = Object.assign(new AccountMerge(), {
        master: Object.assign(new UserData(), { id: 1, kycHash: 'hash-1' }),
      });
      accountMergeService.executeMerge.mockResolvedValue(request);

      const result = await handler.execute({ code: 'merge-code' });

      expect(result).not.toHaveProperty('accessToken');
      expect(Object.keys(result)).toEqual(['masterUserDataId', 'kycHash']);
    });

    it('maps ConflictException to JobDeadLetterException', async () => {
      accountMergeService.executeMerge.mockRejectedValue(new ConflictException('Merge request is already completed'));

      await expect(handler.execute({ code: 'merge-code' })).rejects.toThrow(JobDeadLetterException);
      await expect(handler.execute({ code: 'merge-code' })).rejects.toThrow('Merge request is already completed');
    });

    it('rethrows a generic Error unchanged', async () => {
      const error = new Error('transient failure');
      accountMergeService.executeMerge.mockRejectedValue(error);

      await expect(handler.execute({ code: 'merge-code' })).rejects.toBe(error);
    });
  });
});
