import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { IsNull, Not } from 'typeorm';
import { MailContext, MailType } from '../../notification/enums';
import { MailKey, MailTranslationKey } from '../../notification/factories/mail.factory';
import { NotificationService } from '../../notification/services/notification.service';
import { BankTxReturnRepository } from './bank-tx-return.repository';

@Injectable()
export class BankTxReturnNotificationService {
  private readonly logger = new DfxLogger(BankTxReturnNotificationService);

  constructor(
    private readonly bankTxReturnRepo: BankTxReturnRepository,
    private readonly notificationService: NotificationService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.BANK_TX_RETURN_MAIL, timeout: 1800 })
  async sendBankTxReturnMail() {
    await this.chargebackInitiated();
  }

  private async chargebackInitiated(): Promise<void> {
    const entities = await this.bankTxReturnRepo.find({
      where: {
        mailSendDate: IsNull(),
        chargebackAmount: Not(IsNull()),
        chargebackDate: Not(IsNull()),
        chargebackAllowedDate: Not(IsNull()),
        chargebackBankTx: Not(IsNull()),
        chargebackIban: Not(IsNull()),
        userData: { id: Not(IsNull()) },
      },
      relations: {
        bankTx: true,
        userData: { wallet: true },
        transaction: true,
      },
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} bankTxReturn chargeback email(s)`);

    for (const entity of entities) {
      try {
        if (entity.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER_V2,
            context: MailContext.BANK_TX_RETURN,
            input: {
              userData: entity.userData,
              wallet: entity.wallet,
              title: `${MailTranslationKey.FIAT_CHARGEBACK}.title`,
              salutation: { key: `${MailTranslationKey.FIAT_CHARGEBACK}.salutation` },
              texts: [
                {
                  key: `${MailTranslationKey.PAYMENT}.transaction_button`,
                  params: { url: entity.transaction.url, button: 'true' },
                },
                {
                  key: `${MailTranslationKey.GENERAL}.link`,
                  params: { url: entity.transaction.url, urlText: entity.transaction.url },
                },
                { key: MailKey.SPACE, params: { value: '2' } },
                { key: `${MailTranslationKey.GENERAL}.support` },
                { key: MailKey.SPACE, params: { value: '4' } },
                { key: `${MailTranslationKey.GENERAL}.thanks` },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });
        }

        await this.bankTxReturnRepo.update(...entity.confirmSentMail());
      } catch (e) {
        this.logger.error(`Failed to send bank-tx-return chargeback mail ${entity.id}:`, e);
      }
    }
  }
}
