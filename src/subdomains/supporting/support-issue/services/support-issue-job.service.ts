import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { FindOptionsWhere, In, IsNull, MoreThan, Not } from 'typeorm';
import { MailFactory } from '../../notification/factories/mail.factory';
import { TransactionRequestType } from '../../payment/entities/transaction-request.entity';
import { SupportMessageTranslationKey } from '../dto/support-issue.dto';
import { SupportIssue } from '../entities/support-issue.entity';
import { AutoResponder } from '../entities/support-message.entity';
import { SupportIssueInternalState, SupportIssueReason, SupportIssueType } from '../enums/support-issue.enum';
import { SupportIssueRepository } from '../repositories/support-issue.repository';
import { SupportIssueService } from './support-issue.service';

enum AutoResponse {
  MONERO_COMPLETE = 'MoneroComplete',
  SEPA = 'Sepa',
}

@Injectable()
export class SupportIssueJobService {
  constructor(
    private readonly supportIssueRepo: SupportIssueRepository,
    private readonly supportIssueService: SupportIssueService,
    private readonly mailFactory: MailFactory,
    private readonly settingsService: SettingService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.SUPPORT_BOT, timeout: 1800 })
  async sendAutoResponses() {
    const disabledTemplates = await this.settingsService.get('SupportBot').then((s) => s?.split(',') as AutoResponse[]);

    if (!disabledTemplates.includes(AutoResponse.MONERO_COMPLETE)) await this.moneroComplete();
    if (!disabledTemplates.includes(AutoResponse.SEPA)) await this.sepa();
  }

  async sepa(): Promise<void> {
    const issues = await this.getAutoResponseIssues({
      type: SupportIssueType.TRANSACTION_ISSUE,
      reason: In([SupportIssueReason.FUNDS_NOT_RECEIVED, SupportIssueReason.TRANSACTION_MISSING]),
      transactionRequest: { type: TransactionRequestType.BUY },
      transaction: { id: IsNull() },
    });
    if (!issues.length) return;

    const [standard, weekend] = Util.partition(issues, (i) => {
      const day = i.created.getDay();
      const hour = i.created.getHours();

      return (day === 2 && hour >= 14) || (day > 2 && day < 5) || (day === 5 && hour < 14);
    });

    await this.sendAutoResponse(SupportMessageTranslationKey.SEPA_STANDARD, standard);
    await this.sendAutoResponse(SupportMessageTranslationKey.SEPA_WEEKEND, weekend);
  }

  async moneroComplete(): Promise<void> {
    const issues = await this.getAutoResponseIssues({
      type: SupportIssueType.TRANSACTION_ISSUE,
      reason: In([SupportIssueReason.FUNDS_NOT_RECEIVED, SupportIssueReason.TRANSACTION_MISSING]),
      transaction: {
        buyCrypto: { id: Not(IsNull()), isComplete: true, amlCheck: CheckStatus.PASS, outputAsset: { name: 'XMR' } },
      },
      created: MoreThan(Util.daysBefore(2)),
    });
    await this.sendAutoResponse(SupportMessageTranslationKey.MONERO_NOT_DISPLAYED, issues);
  }

  // --- HELPER METHODS --- //
  private async getAutoResponseIssues(where: FindOptionsWhere<SupportIssue>): Promise<SupportIssue[]> {
    return this.supportIssueRepo.find({
      where: {
        state: SupportIssueInternalState.CREATED,
        messages: { author: Not(AutoResponder) },
        ...where,
      },
    });
  }

  private async sendAutoResponse(
    translationKey: SupportMessageTranslationKey,
    entities: SupportIssue[],
  ): Promise<void> {
    for (const entity of entities) {
      const lang = entity.userData.language.symbol.toLowerCase();
      const message = this.mailFactory.translate(translationKey, lang);
      const botHint = this.mailFactory.translate(SupportMessageTranslationKey.BOT_HINT, lang);
      await this.supportIssueService.createMessageInternal(entity, {
        message: `Hi ${entity.userData.firstname ?? entity.name}\n\n${message}\n\n${botHint}\n\nFreundliche Grüsse / Kind Regards DFX Bot`,
        author: AutoResponder,
      });
      await this.supportIssueService.updateIssueInternal(entity, {
        state: SupportIssueInternalState.PENDING,
      });
    }
  }
}
