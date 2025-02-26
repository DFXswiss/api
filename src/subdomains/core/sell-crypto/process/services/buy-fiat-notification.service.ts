import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { AmlReason, AmlReasonWithoutReason, KycAmlReasons } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import {
  MailFactory,
  MailKey,
  MailTranslationKey,
} from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { In, IsNull, Not } from 'typeorm';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { BuyFiat, BuyFiatAmlReasonPendingStates } from '../buy-fiat.entity';
import { BuyFiatRepository } from '../buy-fiat.repository';

@Injectable()
export class BuyFiatNotificationService {
  private readonly logger = new DfxLogger(BuyFiatNotificationService);

  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly notificationService: NotificationService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.BUY_FIAT_MAIL, timeout: 1800 })
  async sendNotificationMails(): Promise<void> {
    await this.paymentCompleted();
    await this.chargebackInitiated();
    await this.pendingBuyFiat();
    await this.chargebackUnconfirmed();
  }

  private async paymentCompleted(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        mail3SendDate: IsNull(),
        amlCheck: CheckStatus.PASS,
        isComplete: true,
        outputAmount: Not(IsNull()),
      },
      relations: {
        transaction: { userData: true, user: { wallet: true } },
      },
    });

    for (const entity of entities) {
      try {
        if (entity.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_FIAT_COMPLETED,
            input: {
              userData: entity.userData,
              wallet: entity.wallet,
              title: `${MailTranslationKey.FIAT_OUTPUT}.title`,
              salutation: { key: `${MailTranslationKey.FIAT_OUTPUT}.salutation` },
              suffix: [
                {
                  key: `${MailTranslationKey.PAYMENT}.transaction_button`,
                  params: { url: entity.transaction.url },
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

        await this.buyFiatRepo.update(...entity.fiatToBankTransferInitiated());
      } catch (e) {
        this.logger.error(`Failed to send buy-fiat completed mail ${entity.id}:`, e);
      }
    }
  }

  async paymentProcessing(entity: BuyFiat): Promise<void> {
    try {
      if (entity.userData.mail) {
        await this.notificationService.sendMail({
          type: MailType.USER,
          context: MailContext.BUY_FIAT_PROCESSING,
          input: {
            userData: entity.userData,
            title: `${MailTranslationKey.PROCESSING}.title`,
            salutation: { key: `${MailTranslationKey.PROCESSING}.salutation` },
            suffix: [
              {
                key: `${MailTranslationKey.PAYMENT}.transaction_button`,
                params: { url: entity.transaction.url },
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

      await this.buyFiatRepo.update(...entity.fiatToBankTransferInitiated());
    } catch (e) {
      this.logger.error(`Failed to send buy-fiat processing mail ${entity.id}:`, e);
    }
  }

  private async pendingBuyFiat(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        mail2SendDate: IsNull(),
        outputAmount: IsNull(),
        amlReason: In(BuyFiatAmlReasonPendingStates),
        amlCheck: CheckStatus.PENDING,
      },
      relations: { sell: true, transaction: { userData: true, user: { wallet: true } } },
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'pending' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_FIAT_PENDING,
            input: {
              userData: entity.userData,
              wallet: entity.wallet,
              title: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.title`,
              salutation: {
                key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.salutation`,
              },
              suffix: [
                { key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line1` },
                {
                  key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line2`,
                  params: {
                    url: entity.userData.kycUrl,
                    urlText: entity.userData.kycUrl,
                  },
                },
                {
                  key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line3`,
                  params: {
                    url: entity.userData.kycUrl,
                    urlText: entity.userData.kycUrl,
                  },
                },
                {
                  key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line4`,
                  params: {
                    url: entity.userData.kycUrl,
                    urlText: entity.userData.kycUrl,
                  },
                },
                {
                  key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line5`,
                  params: { url: entity.transaction.url },
                },
                { key: MailKey.SPACE, params: { value: '1' } },
                { key: `${MailTranslationKey.GENERAL}.support` },
                { key: MailKey.SPACE, params: { value: '2' } },
                { key: `${MailTranslationKey.GENERAL}.thanks` },
                { key: MailKey.SPACE, params: { value: '4' } },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });
        }

        await this.buyFiatRepo.update(...entity.pendingMail());
      } catch (e) {
        this.logger.error(`Failed to send pending mail for buy-fiat ${entity.id}:`, e);
      }
    }
  }

  private async chargebackInitiated(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        chargebackTxId: Not(IsNull()),
        chargebackDate: Not(IsNull()),
        chargebackAllowedDate: Not(IsNull()),
        amlCheck: CheckStatus.FAIL,
        amlReason: Not(IsNull()),
        mailReturnSendDate: IsNull(),
      },
      relations: { sell: true, cryptoInput: true, transaction: { userData: true, user: { wallet: true } } },
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} chargeback email(s)`);

    for (const entity of entities) {
      try {
        if (
          entity.userData.mail &&
          (entity.userData.verifiedName || entity.amlReason !== AmlReason.NAME_CHECK_WITHOUT_KYC) &&
          !entity.noCommunication
        ) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_FIAT_RETURN,
            input: {
              userData: entity.userData,
              wallet: entity.wallet,
              title: `${MailTranslationKey.CRYPTO_CHARGEBACK}.title`,
              salutation: { key: `${MailTranslationKey.CRYPTO_CHARGEBACK}.salutation` },
              suffix: [
                {
                  key: `${MailTranslationKey.PAYMENT}.transaction_button`,
                  params: { url: entity.transaction.url },
                },
                {
                  key: `${MailTranslationKey.GENERAL}.link`,
                  params: { url: entity.transaction.url, urlText: entity.transaction.url },
                },
                ,
                !AmlReasonWithoutReason.includes(entity.amlReason)
                  ? {
                      key: `${MailTranslationKey.CHARGEBACK}.introduction`,
                      params: {
                        reason: MailFactory.parseMailKey(MailTranslationKey.CHARGEBACK_REASON, entity.amlReason),
                        url: entity.userData.dilisenseUrl,
                        urlText: entity.userData.dilisenseUrl,
                      },
                    }
                  : null,
                KycAmlReasons.includes(entity.amlReason)
                  ? {
                      key: `${MailTranslationKey.CHARGEBACK}.kyc_start`,
                      params: {
                        url: entity.userData.kycUrl,
                        urlText: entity.userData.kycUrl,
                      },
                    }
                  : null,
                { key: MailKey.SPACE, params: { value: '2' } },
                { key: `${MailTranslationKey.GENERAL}.support` },
                { key: MailKey.SPACE, params: { value: '4' } },
                { key: `${MailTranslationKey.GENERAL}.thanks` },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });
        }

        await this.buyFiatRepo.update(...entity.chargebackMail());
      } catch (e) {
        this.logger.error(`Failed to send chargeback mail for buy-fiat ${entity.id}:`, e);
      }
    }
  }

  private async chargebackUnconfirmed(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        mailReturnSendDate: IsNull(),
        outputAmount: IsNull(),
        chargebackTxId: IsNull(),
        chargebackAddress: IsNull(),
        chargebackAllowedDateUser: IsNull(),
        chargebackAllowedDate: IsNull(),
        chargebackDate: IsNull(),
        chargebackAmount: IsNull(),
        amlReason: Not(IsNull()),
        amlCheck: CheckStatus.FAIL,
      },
      relations: { transaction: { userData: true, user: { wallet: true } } },
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'chargebackUnconfirmed' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_FIAT_CHARGEBACK_UNCONFIRMED,
            input: {
              userData: entity.userData,
              wallet: entity.wallet,
              title: `${MailTranslationKey.CHARGEBACK_UNCONFIRMED}.title`,
              salutation: {
                key: `${MailTranslationKey.CHARGEBACK_UNCONFIRMED}.salutation`,
              },
              suffix: [
                {
                  key: `${MailTranslationKey.CHARGEBACK_UNCONFIRMED}.transaction_button`,
                  params: { url: entity.transaction.url },
                },
                { key: MailKey.SPACE, params: { value: '4' } },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });
        }

        await this.buyFiatRepo.update(...entity.chargebackMail());
      } catch (e) {
        this.logger.error(`Failed to send buy-fiat chargebackUnconfirmed mail ${entity.id}:`, e);
      }
    }
  }
}
