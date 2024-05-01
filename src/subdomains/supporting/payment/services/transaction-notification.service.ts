import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { In, IsNull } from 'typeorm';
import { BankTxUnassignedTypes } from '../../bank-tx/bank-tx/bank-tx.entity';
import { MailContext, MailType } from '../../notification/enums';
import { MailKey, MailTranslationKey } from '../../notification/factories/mail.factory';
import { NotificationService } from '../../notification/services/notification.service';
import { Transaction } from '../entities/transaction.entity';
import { TransactionRepository } from '../repositories/transaction.repository';

@Injectable()
export class TransactionNotificationService {
  private readonly logger = new DfxLogger(TransactionNotificationService);

  constructor(
    private readonly repo: TransactionRepository,
    private readonly notificationService: NotificationService,
    private readonly bankDataService: BankDataService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async sendNotificationMails(): Promise<void> {
    if (DisabledProcess(Process.TX_MAIL)) return;
    await this.sendTxUnassignedMails();
  }

  async sendTxAssignedMail(entity: Transaction): Promise<void> {
    try {
      if (
        entity.targetEntity?.userData.mail &&
        !(entity.targetEntity instanceof RefReward) &&
        !DisabledProcess(Process.TX_MAIL)
      ) {
        await this.notificationService.sendMail({
          type: MailType.USER,
          context: entity.mailContext,
          input: {
            userData: entity.targetEntity.userData,
            title: `${entity.targetEntity.inputMailTranslationKey}.title`,
            salutation: { key: `${entity.targetEntity.inputMailTranslationKey}.salutation` },
            suffix: [
              {
                key: `${MailTranslationKey.PAYMENT}.transaction_button`,
                params: { url: entity.url },
              },
              {
                key: `${MailTranslationKey.GENERAL}.link`,
                params: { url: entity.url, urlText: entity.url },
              },
              { key: MailKey.SPACE, params: { value: '4' } },
              { key: MailKey.DFX_TEAM_CLOSING },
            ],
          },
        });

        await this.repo.update(...entity.mailSent());
      }
    } catch (e) {
      this.logger.error(`Failed to send tx assigned mail for ${entity.id}:`, e);
    }
  }

  private async sendTxUnassignedMails(): Promise<void> {
    const entities = await this.repo.find({
      where: { bankTx: { type: In(BankTxUnassignedTypes), creditDebitIndicator: 'CRDT' }, mailSendDate: IsNull() },
      relations: { bankTx: true },
    });
    if (entities.length === 0) return;

    for (const entity of entities) {
      try {
        const bankData = await this.bankDataService.getBankDataWithIban(entity.bankTx.senderAccount);
        if (!bankData) continue;

        if (bankData.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.UNASSIGNED_TX,
            input: {
              userData: bankData.userData,
              title: `${MailTranslationKey.UNASSIGNED_FIAT_INPUT}.title`,
              salutation: { key: `${MailTranslationKey.UNASSIGNED_FIAT_INPUT}.salutation` },
              suffix: [
                {
                  key: `${MailTranslationKey.UNASSIGNED_FIAT_INPUT}.transaction_button`,
                  params: { url: entity.url },
                },
                {
                  key: `${MailTranslationKey.GENERAL}.link`,
                  params: { url: entity.url, urlText: entity.url },
                },
                { key: MailKey.SPACE, params: { value: '4' } },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });

          await this.repo.update(...entity.mailSent());
        }
      } catch (e) {
        this.logger.error(`Failed to send tx unassigned mail for ${entity.id}:`, e);
      }
    }
  }
}
