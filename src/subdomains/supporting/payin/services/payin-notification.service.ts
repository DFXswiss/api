import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import {
  MailFactory,
  MailKey,
  MailTranslationKey,
} from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull, Not } from 'typeorm';
import { PayInAction } from '../entities/crypto-input.entity';
import { PayInRepository } from '../repositories/payin.repository';

@Injectable()
export class PayInNotificationService {
  private readonly logger = new DfxLogger(PayInNotificationService);

  constructor(
    private readonly payInRepo: PayInRepository,
    private readonly notificationService: NotificationService,
  ) {}

  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.PAY_IN_MAIL, timeout: 1800 })
  async sendNotificationMails(): Promise<void> {
    await this.returnedCryptoInput();
  }

  async returnedCryptoInput(): Promise<void> {
    const entities = await this.payInRepo.find({
      where: {
        mailReturnSendDate: IsNull(),
        recipientMail: IsNull(),
        returnTxId: Not(IsNull()),
        action: PayInAction.RETURN,
      },
      relations: { transaction: { user: { wallet: true }, userData: true }, route: true },
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} cryptoInput return email(s)`);

    for (const entity of entities) {
      try {
        if (entity.transaction.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER_V2,
            context: MailContext.CRYPTO_INPUT_RETURN,
            input: {
              userData: entity.transaction.userData,
              wallet: entity.transaction.user.wallet,
              title: `${MailTranslationKey.CRYPTO_CHARGEBACK}.title`,
              salutation: { key: `${MailTranslationKey.CRYPTO_CHARGEBACK}.salutation` },
              texts: [
                {
                  key: `${MailTranslationKey.CRYPTO_CHARGEBACK}.transaction_button`,
                  params: { url: entity.transaction.url, button: 'true' },
                },
                {
                  key: `${MailTranslationKey.CHARGEBACK}.introduction`,
                  params: {
                    reason: MailFactory.parseMailKey(MailTranslationKey.CHARGEBACK_REASON, entity.amlReason),
                  },
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

        await this.payInRepo.update(...entity.returnMail());
      } catch (e) {
        this.logger.error(`Failed to send cryptoInput return mail ${entity.id}:`, e);
      }
    }
  }
}
