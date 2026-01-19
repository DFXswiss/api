import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { In, IsNull, MoreThan, Not } from 'typeorm';
import { MailFactory } from '../../notification/factories/mail.factory';
import { SupportMessageTranslationKey } from '../dto/support-issue.dto';
import { BotAuthor } from '../entities/support-message.entity';
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

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.SUPPORT_ISSUE_AUTO_TEMPLATES, timeout: 1800 })
  async sendAutoTemplates() {
    await this.moneroComplete();
  }

  async moneroComplete(): Promise<void> {
    const entities = await this.supportIssueRepo.find({
      where: {
        type: SupportIssueType.TRANSACTION_ISSUE,
        reason: In([SupportIssueReason.FUNDS_NOT_RECEIVED, SupportIssueReason.TRANSACTION_MISSING]),
        state: SupportIssueInternalState.CREATED,
        messages: { author: Not(BotAuthor) },
        transaction: {
          buyCrypto: { id: Not(IsNull()), isComplete: true, amlCheck: CheckStatus.PASS, outputAsset: { name: 'XMR' } },
        },
        created: MoreThan(Util.daysBefore(2)),
      },
    });

    for (const entity of entities) {
      const lang = entity.userData.language.symbol.toLowerCase();
      const message = this.mailFactory.translate(SupportMessageTranslationKey.MONERO_NOT_DISPLAYED, lang);
      await this.supportIssueService.createMessageSupport(entity.id, { message, author: BotAuthor });
      await this.supportIssueService.updateIssueInternal(entity, { state: SupportIssueInternalState.BOT_MESSAGE });
    }
  }
}
