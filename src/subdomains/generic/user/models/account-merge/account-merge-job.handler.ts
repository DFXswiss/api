import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { JobGroup } from 'src/subdomains/supporting/job/enums';
import { JobDeadLetterException } from 'src/subdomains/supporting/job/exceptions/job-dead-letter.exception';
import { JobHandler } from 'src/subdomains/supporting/job/interfaces/job-handler.interface';
import { JobService } from 'src/subdomains/supporting/job/services/job.service';
import { AccountMergeService } from './account-merge.service';

export interface AccountMergeJobInput {
  code: string;
}

export interface AccountMergeJobOutput {
  masterUserDataId: number;
  kycHash: string;
}

@Injectable()
export class AccountMergeJobHandler implements JobHandler<AccountMergeJobInput, AccountMergeJobOutput>, OnModuleInit {
  readonly group = JobGroup.ACCOUNT_MERGE;

  constructor(
    private readonly jobService: JobService,
    private readonly accountMergeService: AccountMergeService,
  ) {}

  // Registered from the outside so the job module stays free of domain dependencies.
  onModuleInit(): void {
    this.jobService.registerHandler(this);
  }

  async execute(input: AccountMergeJobInput): Promise<AccountMergeJobOutput> {
    try {
      const request = await this.accountMergeService.executeMerge(input.code);

      // No access token here: it is bound to the request context (address, IP, 2FA marker) and
      // would otherwise sit in the job table as a stored credential. Minted fresh in the HTTP
      // layer when the caller picks up the result.
      return { masterUserDataId: request.master.id, kycHash: request.master.kycHash };
    } catch (e) {
      // These preconditions can never turn true by retrying, so the job must not consume attempt
      // budget on them.
      if (e instanceof NotFoundException || e instanceof BadRequestException || e instanceof ConflictException) {
        throw new JobDeadLetterException(e.message);
      }

      throw e;
    }
  }
}
