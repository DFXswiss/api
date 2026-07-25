import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { BuyCryptoStatus } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { FindOptionsWhere, In, IsNull, MoreThan, Not } from 'typeorm';
import { MailFactory } from '../../notification/factories/mail.factory';
import { TransactionRequestType } from '../../payment/entities/transaction-request.entity';
import { SupportMessageTranslationKey } from '../dto/support-issue.dto';
import { SupportIssue } from '../entities/support-issue.entity';
import { AutoResponder, CustomerAuthor } from '../entities/support-message.entity';
import { SupportIssueInternalState, SupportIssueReason, SupportIssueType } from '../enums/support-issue.enum';
import { SupportIssueRepository } from '../repositories/support-issue.repository';
import { SupportIssueService } from './support-issue.service';

enum AutoResponse {
  MONERO_COMPLETE = 'MoneroComplete',
  SEPA = 'Sepa',
  MISSING_LIQUIDITY = 'MissingLiquidity',
}

@Injectable()
export class SupportIssueJobService {
  constructor(
    private readonly supportIssueRepo: SupportIssueRepository,
    private readonly supportIssueService: SupportIssueService,
    private readonly mailFactory: MailFactory,
    private readonly settingsService: SettingService,
  ) {}

  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.SUPPORT_BOT, timeout: 1800 })
  async autoOnHold(): Promise<void> {
    const entities = await this.supportIssueRepo.find({
      where: {
        state: In([SupportIssueInternalState.CREATED, SupportIssueInternalState.PENDING]),
        messages: { id: Not(IsNull()) },
      },
      relations: { messages: true },
      // id as tie-break for the same reason as in getAutoResponseIssues below: messages.at(-1) must
      // be deterministic even when two messages share a created timestamp
      order: { messages: { created: 'ASC', id: 'ASC' } },
    });

    for (const entity of entities) {
      if (
        entity.messages.at(-1).author !== CustomerAuthor &&
        Util.daysDiff(entity.messages.at(-1).created) > Config.support.issueOnHoldExpiry
      )
        await this.supportIssueRepo.update(entity.id, { state: SupportIssueInternalState.ON_HOLD });
    }
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.SUPPORT_BOT, timeout: 1800 })
  async sendAutoResponses(): Promise<void> {
    const disabledTemplates = await this.settingsService
      .get('supportBot')
      .then((s) => (s?.split(',') ?? []) as AutoResponse[]);

    if (!disabledTemplates.includes(AutoResponse.MONERO_COMPLETE)) await this.moneroComplete();
    if (!disabledTemplates.includes(AutoResponse.SEPA)) await this.sepa();
    if (!disabledTemplates.includes(AutoResponse.MISSING_LIQUIDITY)) await this.missingLiquidity();
  }

  async missingLiquidity(): Promise<void> {
    const issues = await this.getAutoResponseIssues({
      type: SupportIssueType.TRANSACTION_ISSUE,
      reason: In([SupportIssueReason.FUNDS_NOT_RECEIVED, SupportIssueReason.TRANSACTION_MISSING]),
      transaction: {
        buyCrypto: { id: Not(IsNull()), amlCheck: CheckStatus.PASS, status: BuyCryptoStatus.MISSING_LIQUIDITY },
      },
    });
    await this.sendAutoResponse(SupportMessageTranslationKey.MISSING_LIQUIDITY, issues);
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
      reason: In([
        SupportIssueReason.FUNDS_NOT_RECEIVED,
        SupportIssueReason.TRANSACTION_MISSING,
        SupportIssueReason.OTHER,
      ]),
      transaction: {
        buyCrypto: { id: Not(IsNull()), isComplete: true, amlCheck: CheckStatus.PASS, outputAsset: { name: 'XMR' } },
      },
      created: MoreThan(Util.daysBefore(2)),
    });
    await this.sendAutoResponse(SupportMessageTranslationKey.MONERO_NOT_DISPLAYED, issues);
  }

  // --- HELPER METHODS --- //
  private async getAutoResponseIssues(where: FindOptionsWhere<SupportIssue>): Promise<SupportIssue[]> {
    const request: FindOptionsWhere<SupportIssue> = { state: SupportIssueInternalState.CREATED, ...where };
    return this.supportIssueRepo
      .find({
        where: [
          { ...request, clerk: IsNull() },
          { ...request, clerk: Not(AutoResponder) },
        ],
        relations: { messages: true },
        // the filter below reads messages.at(-1), so the thread has to come back in order -
        // without this the bot decides "the customer wrote last" off an arbitrary row and both
        // mails the wrong tickets and skips the right ones (autoOnHold above already orders)
        // id as tie-break: two messages sharing a created timestamp would otherwise leave
        // messages.at(-1) non-deterministic again, which is the whole point of ordering here
        order: { messages: { created: 'ASC', id: 'ASC' } },
      })
      .then((issues) =>
        issues.filter(
          // length guard: `relations: { messages: true }` is a LEFT JOIN, so an issue whose first
          // message never got written (createIssueInternal commits the issue and the message in
          // separate transactions) comes back with an empty array and at(-1) would throw. The thrown
          // error is caught and logged as an ERROR by the cron lock, which then aborts the rest of
          // the run - so a single such row stops every auto-response, every minute, until someone
          // reads the log. The sibling autoOnHold guards this via its where clause; this one did not.
          (i) =>
            i.messages.length > 0 &&
            i.messages.at(-1).author === CustomerAuthor &&
            i.messages.every((m) => m.author !== AutoResponder),
        ),
      );
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
