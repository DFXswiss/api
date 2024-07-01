import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import {
  SupportIssueReason,
  SupportIssueType,
} from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';
import { IsNull } from 'typeorm';
import { LimitRequestRepository } from '../repositories/limit-request.repository';

@Injectable()
export class LimitRequestJobService {
  constructor(
    private readonly limitRequestRepo: LimitRequestRepository,
    private readonly supportIssueService: SupportIssueService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async limitRequestSync(): Promise<void> {
    if (DisabledProcess(Process.LIMIT_REQUEST_SYNC)) return;

    const entities = await this.limitRequestRepo.find({
      where: { supportIssue: IsNull() },
      relations: { userData: true },
    });

    for (const entity of entities) {
      await this.supportIssueService.createIssueInternal(entity.userData, {
        name: entity.userData.firstname ?? '-',
        type: SupportIssueType.LIMIT_REQUEST,
        reason: SupportIssueReason.OTHER,
        fileUrl: entity.documentProofUrl,
        limitRequest: entity,
      });
    }
  }
}
