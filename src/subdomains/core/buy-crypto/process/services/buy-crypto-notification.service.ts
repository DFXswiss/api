import { Injectable } from '@nestjs/common';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
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
import { BuyCrypto, BuyCryptoAmlReasonPendingStates } from '../entities/buy-crypto.entity';
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
      await this.paybackToAddressInitiated();
      await this.pendingBuyCrypto();
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

  private async paybackToAddressInitiated(): Promise<void> {
    const search: FindOptionsWhere<BuyCrypto> = {
      mailSendDate: IsNull(),
      outputAmount: IsNull(),
      chargebackDate: Not(IsNull()),
      amlReason: Not(IsNull()),
      amlCheck: CheckStatus.FAIL,
    };
    const entities = await this.buyCryptoRepo.find({
      where: [
        { ...search, chargebackBankTx: Not(IsNull()) },
        { ...search, chargebackCryptoTxId: Not(IsNull()) },
      ],
      relations: [
        'buy',
        'buy.user',
        'buy.user.userData',
        'cryptoInput',
        'cryptoRoute',
        'cryptoRoute.user',
        'cryptoRoute.user.userData',
        'bankTx',
        'checkoutTx',
      ],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'payback to address' email(s)`);

    for (const entity of entities) {
      try {
        if (
          entity.user.userData.mail &&
          (entity.user.userData.verifiedName || entity.amlReason !== AmlReason.NAME_CHECK_WITHOUT_KYC) &&
          !entity.noCommunication
        ) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_CRYPTO_RETURN,
            input: {
              userData: entity.user.userData,
              title: `${entity.translationReturnMailKey}.title`,
              salutation: { key: `${entity.translationReturnMailKey}.salutation` },
              table: {
                [`${MailTranslationKey.PAYMENT}.reimbursed`]: `${entity.inputAmount} ${entity.inputAsset}`,
                [`${MailTranslationKey.PAYMENT}.bank_account`]:
                  entity.isBankInput && entity.bankTx.iban ? Util.blankStart(entity.bankTx.iban) : null,
                [`${MailTranslationKey.PAYMENT}.remittance_info`]: !entity.isCryptoCryptoTransaction
                  ? entity.chargebackRemittanceInfo?.split(' Zahlung')[0]
                  : null,
                [`${MailTranslationKey.PAYMENT}.blockchain`]: entity.isCryptoCryptoTransaction
                  ? entity.cryptoInput.asset.blockchain
                  : null,
                [`${MailTranslationKey.PAYMENT}.wallet_address`]: entity.isCryptoCryptoTransaction
                  ? Util.blankStart(entity.cryptoRoute.user.address)
                  : null,
                [`${MailTranslationKey.PAYMENT}.transaction_id`]: entity.isLightningInput
                  ? Util.blankStart(entity.chargebackCryptoTxId)
                  : null,
              },
              suffix: [
                !entity.isLightningInput && entity.isCryptoCryptoTransaction
                  ? {
                      key: `${entity.translationReturnMailKey}.payment_link`,
                      params: {
                        url: txExplorerUrl(entity.cryptoInput.asset.blockchain, entity.chargebackCryptoTxId),
                      },
                    }
                  : null,
                !AmlReasonWithoutReason.includes(entity.amlReason)
                  ? {
                      key: `${MailTranslationKey.RETURN}.introduction`,
                      params: {
                        reason: MailFactory.parseMailKey(MailTranslationKey.RETURN_REASON, entity.amlReason),
                        url: entity.user.userData.dilisenseUrl,
                        urlText: entity.user.userData.dilisenseUrl,
                      },
                    }
                  : null,
                KycAmlReasons.includes(entity.amlReason)
                  ? {
                      key: `${MailTranslationKey.RETURN}.kyc_start`,
                      params: {
                        url: entity.user.userData.kycUrl,
                        urlText: entity.user.userData.kycUrl,
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
        this.logger.error(`Failed to send buy-crypto payback to address mail ${entity.id}:`, e);
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
      relations: [
        'buy',
        'buy.user',
        'buy.user.userData',
        'cryptoInput',
        'cryptoRoute',
        'cryptoRoute.user',
        'cryptoRoute.user.userData',
      ],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'pending' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.user.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_CRYPTO_PENDING,
            input: {
              userData: entity.user.userData,
              title: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.title`,
              salutation: {
                key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.salutation`,
              },
              suffix: [
                { key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line1` },
                {
                  key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line2`,
                  params: {
                    url: entity.user.userData.kycUrl,
                    urlText: entity.user.userData.kycUrl,
                  },
                },
                {
                  key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line3`,
                  params: {
                    url: entity.user.userData.kycUrl,
                    urlText: entity.user.userData.kycUrl,
                  },
                },
                {
                  key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line4`,
                  params: {
                    url: entity.user.userData.kycUrl,
                    urlText: entity.user.userData.kycUrl,
                  },
                },
                { key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line5` },
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
}
