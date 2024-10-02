import { Injectable } from '@nestjs/common';
import * as IbanTools from 'ibantools';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import {
  MailFactory,
  MailKey,
  MailTranslationKey,
} from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { AmlReason, AmlReasonWithoutReason, KycAmlReasons } from '../../../aml/enums/aml-reason.enum';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto, BuyCryptoAmlReasonPendingStates, BuyCryptoStatus } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';

@Injectable()
export class BuyCryptoNotificationService {
  private readonly logger = new DfxLogger(BuyCryptoNotificationService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly notificationService: NotificationService,
  ) {}

  async sendNotificationMails(): Promise<void> {
    try {
      if (DisabledProcess(Process.BUY_CRYPTO_MAIL)) return;
      await this.paymentCompleted();
      await this.chargebackInitiated();
      await this.pendingBuyCrypto();
      await this.chargebackNotPossible();
      await this.chargebackUnconfirmed();
    } catch (e) {
      this.logger.error('Error during buy-crypto notification:', e);
    }
  }

  async sendMissingLiquidityError(
    outputAssetName: string,
    blockchain: string,
    type: string,
    transactionIds: number[],
    messages: string[],
  ): Promise<void> {
    const correlationId = `BuyCryptoBatch&LiquidityCheck&${outputAssetName}&${blockchain}&${type}&TX_IDs_${transactionIds.map(
      (id) => `${id}`,
    )}`;

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.BUY_CRYPTO,
      input: { subject: 'Buy Crypto Error - missing liquidity.', errors: messages, isLiqMail: true },
      options: { debounce: 3600000 },
      correlationId,
    });
  }

  async sendNonRecoverableErrorMail(batch: BuyCryptoBatch, message: string, e?: Error): Promise<void> {
    const correlationId = `BuyCryptoBatch&${batch.id}`;
    const errors = e ? [message, e.message] : [message];

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.BUY_CRYPTO,
      input: { subject: 'Buy Crypto Error', errors, isLiqMail: true },
      options: { suppressRecurring: true },
      correlationId,
    });
  }

  private async paymentCompleted(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        mailSendDate: IsNull(),
        amlCheck: CheckStatus.PASS,
        isComplete: true,
        status: BuyCryptoStatus.COMPLETE,
        outputAmount: Not(IsNull()),
      },
      relations: {
        transaction: { user: { userData: true } },
      },
    });

    for (const entity of entities) {
      try {
        if (entity.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_CRYPTO_COMPLETED,
            input: {
              userData: entity.userData,
              title: `${MailTranslationKey.CRYPTO_OUTPUT}.title`,
              salutation: { key: `${MailTranslationKey.CRYPTO_OUTPUT}.salutation` },
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

        await this.buyCryptoRepo.update(...entity.confirmSentMail());
      } catch (e) {
        this.logger.error(`Failed to send buy-crypto completed mail ${entity.id}:`, e);
      }
    }
  }

  private async pendingBuyCrypto(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        mailSendDate: IsNull(),
        outputAmount: IsNull(),
        chargebackDate: IsNull(),
        chargebackBankTx: IsNull(),
        amlReason: In(BuyCryptoAmlReasonPendingStates),
        amlCheck: CheckStatus.PENDING,
      },
      relations: { transaction: { user: { userData: true } } },
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'pending' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_CRYPTO_PENDING,
            input: {
              userData: entity.userData,
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

        await this.buyCryptoRepo.update(...entity.confirmSentMail());
      } catch (e) {
        this.logger.error(`Failed to send buy-crypto pending mail ${entity.id}:`, e);
      }
    }
  }

  private async chargebackInitiated(): Promise<void> {
    const search: FindOptionsWhere<BuyCrypto> = {
      mailSendDate: IsNull(),
      outputAmount: IsNull(),
      chargebackDate: Not(IsNull()),
      chargebackAllowedDate: Not(IsNull()),
      amlReason: Not(IsNull()),
      amlCheck: CheckStatus.FAIL,
    };
    const entities = await this.buyCryptoRepo.find({
      where: [
        { ...search, chargebackBankTx: Not(IsNull()), chargebackIban: Not(IsNull()) },
        { ...search, chargebackCryptoTxId: Not(IsNull()) },
        { ...search, checkoutTx: Not(IsNull()) },
      ],
      relations: {
        cryptoInput: true,
        bankTx: true,
        checkoutTx: true,
        transaction: { user: { userData: true } },
      },
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
            context: MailContext.BUY_CRYPTO_RETURN,
            input: {
              userData: entity.userData,
              title: `${entity.translationReturnMailKey}.title`,
              salutation: { key: `${entity.translationReturnMailKey}.salutation` },
              suffix: [
                {
                  key: `${MailTranslationKey.PAYMENT}.transaction_button`,
                  params: { url: entity.transaction.url },
                },
                {
                  key: `${MailTranslationKey.GENERAL}.link`,
                  params: { url: entity.transaction.url, urlText: entity.transaction.url },
                },
                !AmlReasonWithoutReason.includes(entity.amlReason)
                  ? {
                      key: `${MailTranslationKey.CHARGEBACK}.introduction`,
                      params: {
                        reason: MailFactory.parseMailKey(MailTranslationKey.CHARGEBACK_REASON, entity.mailReturnReason),
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

        await this.buyCryptoRepo.update(...entity.confirmSentMail());
      } catch (e) {
        this.logger.error(`Failed to send buy-crypto chargeback mail ${entity.id}:`, e);
      }
    }
  }

  private async chargebackUnconfirmed(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        mailSendDate: IsNull(),
        outputAmount: IsNull(),
        chargebackIban: IsNull(),
        chargebackBankTx: IsNull(),
        chargebackCryptoTxId: IsNull(),
        chargebackAllowedDateUser: IsNull(),
        chargebackAllowedDate: Not(IsNull()),
        amlReason: Not(IsNull()),
        amlCheck: CheckStatus.FAIL,
      },
      relations: { transaction: { user: { userData: true } } },
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'chargebackUnconfirmed' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_CRYPTO_CHARGEBACK_UNCONFIRMED,
            input: {
              userData: entity.userData,
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

        await this.buyCryptoRepo.update(...entity.confirmSentMail());
      } catch (e) {
        this.logger.error(`Failed to send buy-crypto chargebackUnconfirmed mail ${entity.id}:`, e);
      }
    }
  }

  private async chargebackNotPossible(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        mailSendDate: IsNull(),
        outputAmount: IsNull(),
        chargebackIban: IsNull(),
        bankTx: Not(IsNull()),
        amlReason: Not(IsNull()),
        amlCheck: CheckStatus.FAIL,
      },
      relations: { transaction: { user: { userData: true } }, bankData: true },
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'chargebackNotPossible' email(s)`);

    for (const entity of entities) {
      try {
        if (
          entity.bankData &&
          Util.minutesDiff(entity.created) < 60 &&
          IbanTools.validateIBAN(entity.bankData.iban.split(';')[0]).valid
        )
          continue;
        if (entity.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_CRYPTO_CHARGEBACK_NOT_POSSIBLE,
            input: {
              userData: entity.userData,
              title: `${MailTranslationKey.CHARGEBACK_NOT_POSSIBLE}.title`,
              salutation: {
                key: `${MailTranslationKey.CHARGEBACK_NOT_POSSIBLE}.salutation`,
              },
              suffix: [
                { key: `${MailTranslationKey.CHARGEBACK_NOT_POSSIBLE}.message` },
                { key: MailKey.SPACE, params: { value: '2' } },
                { key: `${MailTranslationKey.GENERAL}.thanks` },
                { key: MailKey.SPACE, params: { value: '4' } },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });
        }

        await this.buyCryptoRepo.update(...entity.confirmSentMail());
      } catch (e) {
        this.logger.error(`Failed to send buy-crypto chargebackNotPossible mail ${entity.id}:`, e);
      }
    }
  }
}
