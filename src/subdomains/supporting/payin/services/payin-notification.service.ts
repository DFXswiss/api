import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import {
  MailFactory,
  MailKey,
  MailTranslationKey,
} from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull, Not } from 'typeorm';
import { PayInRepository } from '../repositories/payin.repository';

@Injectable()
export class PayInNotificationService {
  private readonly logger = new DfxLogger(PayInNotificationService);

  constructor(private readonly payInRepo: PayInRepository, private readonly notificationService: NotificationService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock(1800)
  async sendNotificationMails(): Promise<void> {
    try {
      if (Config.processDisabled(Process.PAY_IN_MAIL)) return;
      await this.returnedCryptoInput();
    } catch (e) {
      this.logger.error('Error during buy-crypto notification:', e);
    }
  }

  async returnedCryptoInput(): Promise<void> {
    const entities = await this.payInRepo.find({
      where: {
        mailReturnSendDate: IsNull(),
        recipientMail: IsNull(),
        returnTxId: Not(IsNull()),
        amlCheck: CheckStatus.PASS,
      },
      relations: ['route', 'route.user', 'route.user.userData'],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} cryptoInput return email(s)`);

    for (const entity of entities) {
      try {
        if (entity.route.user.userData.mail) {
          await this.notificationService.sendMailNew({
            type: MailType.USER,
            input: {
              userData: entity.route.user.userData,
              title: `${MailTranslationKey.CRYPTO_RETURN}.title`,
              prefix: { key: `${MailTranslationKey.CRYPTO_RETURN}.salutation` },
              table: {
                [`${MailTranslationKey.PAYMENT}.reimbursed`]: `${entity.amount} ${entity.asset.name}`,
                [`${MailTranslationKey.PAYMENT}.blockchain`]: entity.asset.blockchain,
                [`${MailTranslationKey.PAYMENT}.wallet_address`]: Util.blankStart(entity.route.user.address),
                [`${MailTranslationKey.PAYMENT}.transaction_id`]: entity.isLightningInput
                  ? Util.blankStart(entity.returnTxId)
                  : null,
              },
              suffix: [
                !entity.isLightningInput
                  ? {
                      key: `${MailTranslationKey.CRYPTO_RETURN}.payment_link`,
                      params: { url: txExplorerUrl(entity.asset.blockchain, entity.returnTxId) },
                    }
                  : null,
                {
                  key: `${MailTranslationKey.RETURN}.introduction`,
                  params: {
                    reason: MailFactory.parseMailKey(MailTranslationKey.RETURN_REASON, entity.amlReason),
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
