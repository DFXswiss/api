import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
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

  constructor(private readonly payInRepo: PayInRepository, private readonly notificationService: NotificationService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock(1800)
  async sendNotificationMails(): Promise<void> {
    if (DisabledProcess(Process.PAY_IN_MAIL)) return;
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
      relations: { route: { user: { userData: true, wallet: true } } },
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} cryptoInput return email(s)`);

    for (const entity of entities) {
      try {
        if (entity.route.user.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.CRYPTO_INPUT_RETURN,
            input: {
              userData: entity.route.user.userData,
              wallet: entity.route.user.wallet,
              title: `${MailTranslationKey.CRYPTO_CHARGEBACK}.title`,
              salutation: { key: `${MailTranslationKey.CRYPTO_CHARGEBACK}.salutation` },
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
                      key: `${MailTranslationKey.CRYPTO_CHARGEBACK}.payment_link`,
                      params: { url: txExplorerUrl(entity.asset.blockchain, entity.returnTxId) },
                    }
                  : null,
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
