import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import {
  SupportIssueReason,
  SupportIssueState,
  SupportIssueType,
} from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';
import { IsNull } from 'typeorm';
import { LimitRequestRepository } from '../repositories/limit-request.repository';

@Injectable()
export class LimitRequestJobService {
  private readonly logger = new DfxLogger(LimitRequestJobService);

  constructor(
    private readonly limitRequestRepo: LimitRequestRepository,
    private readonly supportIssueService: SupportIssueService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async limitRequestSync(): Promise<void> {
    if (DisabledProcess(Process.LIMIT_REQUEST_SYNC)) return;

    const entities = await this.limitRequestRepo.find({
      where: { supportIssue: { id: IsNull() } },
      relations: { userData: true, supportIssue: true },
    });

    for (const entity of entities) {
      try {
        await this.supportIssueService.createIssueInternal(entity.userData, {
          name: entity.userData.completeName ?? '-',
          type: SupportIssueType.LIMIT_REQUEST,
          state: SupportIssueState.PENDING,
          reason: SupportIssueReason.OTHER,
          fileUrl: entity.documentProofUrl,
          limitRequest: entity,
        });
      } catch (e) {
        this.logger.error('Error in limitRequest sync job:', e);
      }
    }
  }
}
