import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { FindOptionsWhere, In, IsNull, MoreThan, Not } from 'typeorm';
import { MailFactory } from '../../notification/factories/mail.factory';
import { SupportMessageTranslationKey } from '../dto/support-issue.dto';
import { SupportIssue } from '../entities/support-issue.entity';
import { AutoResponder } from '../entities/support-message.entity';
import { SupportIssueInternalState, SupportIssueReason, SupportIssueType } from '../enums/support-issue.enum';
import { SupportIssueRepository } from '../repositories/support-issue.repository';
import { SupportIssueService } from './support-issue.service';

@Injectable()
export class SupportIssueJobService {
  constructor(
    private readonly supportIssueRepo: SupportIssueRepository,
    private readonly supportIssueService: SupportIssueService,
    private readonly mailFactory: MailFactory,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.SUPPORT_BOT, timeout: 1800 })
  async sendAutoResponses() {
    await this.moneroComplete();
  }

  async moneroComplete(): Promise<void> {
    await this.sendAutoResponse(SupportMessageTranslationKey.MONERO_NOT_DISPLAYED, {
      type: SupportIssueType.TRANSACTION_ISSUE,
      reason: In([SupportIssueReason.FUNDS_NOT_RECEIVED, SupportIssueReason.TRANSACTION_MISSING]),
      transaction: {
        buyCrypto: { id: Not(IsNull()), isComplete: true, amlCheck: CheckStatus.PASS, outputAsset: { name: 'XMR' } },
      },
      created: MoreThan(Util.daysBefore(2)),
    });
  }

  private async sendAutoResponse(
    translationKey: SupportMessageTranslationKey,
    where: FindOptionsWhere<SupportIssue>,
  ): Promise<void> {
    const entities = await this.supportIssueRepo.find({
      where: {
        state: SupportIssueInternalState.CREATED,
        messages: { author: Not(AutoResponder) },
        ...where,
      },
    });

    for (const entity of entities) {
      const lang = entity.userData.language.symbol.toLowerCase();
      const message = this.mailFactory.translate(translationKey, lang);
      await this.supportIssueService.createMessageSupport(entity.id, { message, author: AutoResponder });
      await this.supportIssueService.updateIssueInternal(entity, {
        state: SupportIssueInternalState.PENDING,
      });
    }
  }
}
