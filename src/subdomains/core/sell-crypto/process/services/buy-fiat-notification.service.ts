import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
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
import { BuyFiatAmlReasonPendingStates } from '../buy-fiat.entity';
import { BuyFiatRepository } from '../buy-fiat.repository';

@Injectable()
export class BuyFiatNotificationService {
  private readonly logger = new DfxLogger(BuyFiatNotificationService);

  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async sendNotificationMails(): Promise<void> {
    if (DisabledProcess(Process.BUY_FIAT_MAIL)) return;
    await this.offRampInitiated();
    await this.cryptoExchangedToFiat();
    await this.fiatToBankTransferInitiated();
    await this.paybackToAddressInitiated();
    await this.pendingBuyFiat();
  }

  private async offRampInitiated(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: { mail1SendDate: IsNull(), cryptoInput: Not(IsNull()) },
      relations: ['cryptoInput', 'sell', 'sell.user', 'sell.user.userData'],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'off-ramp initiated' email(s)`);

    for (const entity of entities) {
      try {
        const recipientMail = entity.sell.user.userData.mail;

        if (recipientMail && !entity.noCommunication) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_FIAT,
            input: {
              userData: entity.sell.user.userData,
              title: `${MailTranslationKey.BUY_FIAT}.initiated.title`,
              salutation: { key: `${MailTranslationKey.BUY_FIAT}.initiated.salutation` },
              table: {
                [`${MailTranslationKey.BUY_FIAT}.input_amount`]: `${entity.cryptoInput.amount} ${entity.cryptoInput.asset.name}`,
                [`${MailTranslationKey.PAYMENT}.blockchain`]: `${entity.cryptoInputBlockchain}`,
                [`${MailTranslationKey.PAYMENT}.transaction_id`]: entity.isLightningTransaction
                  ? Util.blankStart(entity.cryptoInput.inTxId)
                  : null,
              },
              suffix: [
                entity.isLightningTransaction
                  ? null
                  : {
                      key: `${MailTranslationKey.BUY_FIAT}.payment_link`,
                      params: { url: txExplorerUrl(entity.cryptoInputBlockchain, entity.cryptoInput.inTxId) },
                    },
                { key: MailKey.SPACE, params: { value: '3' } },
                { key: `${MailTranslationKey.BUY_FIAT}.initiated.next_step` },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });
        }

        await this.buyFiatRepo.update(...entity.offRampInitiated());
      } catch (e) {
        this.logger.error(`Failed to send off-ramp initiated mail for buy-fiat ${entity.id}:`, e);
      }
    }
  }

  private async cryptoExchangedToFiat(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        mail1SendDate: Not(IsNull()),
        mail2SendDate: IsNull(),
        outputAmount: Not(IsNull()),
        amlCheck: CheckStatus.PASS,
      },
      relations: ['cryptoInput', 'sell', 'sell.user', 'sell.user.userData'],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'crypto exchanged to fiat' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.sell.user.userData.mail && !entity.noCommunication) {
          const minFee = entity.minFeeAmountFiat
            ? ` (min. ${entity.minFeeAmountFiat} ${entity.outputReferenceAsset.name})`
            : '';

          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_FIAT,
            input: {
              userData: entity.sell.user.userData,
              title: `${MailTranslationKey.BUY_FIAT}.exchanged.title`,
              salutation: { key: `${MailTranslationKey.BUY_FIAT}.exchanged.salutation` },
              table: {
                [`${MailTranslationKey.BUY_FIAT}.input_amount`]: `${entity.inputAmount} ${entity.inputAsset}`,
                [`${MailTranslationKey.PAYMENT}.blockchain`]: `${entity.cryptoInputBlockchain}`,
                [`${MailTranslationKey.PAYMENT}.dfx_fee`]: `${entity.percentFeeString}` + minFee,
                [`${MailTranslationKey.PAYMENT}.exchange_rate`]: `${entity.exchangeRateString}`,
                [`${MailTranslationKey.BUY_FIAT}.output_amount`]: `${Util.roundReadable(entity.outputAmount, true)} ${
                  entity.outputAsset.name
                }`,
              },
              suffix: [
                { key: MailKey.SPACE, params: { value: '4' } },
                { key: `${MailTranslationKey.BUY_FIAT}.exchanged.next_step` },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });
        }

        await this.buyFiatRepo.update(...entity.cryptoExchangedToFiat());
      } catch (e) {
        this.logger.error(`Failed to send crypto exchanged to fiat mail for buy-fiat ${entity.id}:`, e);
      }
    }
  }

  private async fiatToBankTransferInitiated(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        mail2SendDate: Not(IsNull()),
        mail3SendDate: IsNull(),
        fiatOutput: { bankTx: Not(IsNull()), remittanceInfo: Not(IsNull()) },
        amlCheck: CheckStatus.PASS,
      },
      relations: ['sell', 'sell.user', 'sell.user.userData', 'fiatOutput', 'fiatOutput.bankTx'],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'fiat to bank transfer' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.sell.user.userData.mail && !entity.noCommunication) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_FIAT,
            input: {
              userData: entity.sell.user.userData,
              title: `${MailTranslationKey.BUY_FIAT}.processed.title`,
              salutation: { key: `${MailTranslationKey.BUY_FIAT}.processed.salutation` },
              table: {
                [`${MailTranslationKey.BUY_FIAT}.output_amount`]: `${Util.roundReadable(entity.outputAmount, true)} ${
                  entity.outputAsset.name
                }`,
                [`${MailTranslationKey.PAYMENT}.bank_account`]: Util.blankStart(entity.sell.iban),
                [`${MailTranslationKey.PAYMENT}.remittance_info`]: entity.fiatOutput.remittanceInfo,
              },
              suffix: [
                { key: MailKey.SPACE, params: { value: '4' } },
                { key: `${MailTranslationKey.BUY_FIAT}.processed.next_step` },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });
        }

        await this.buyFiatRepo.update(...entity.fiatToBankTransferInitiated());
      } catch (e) {
        this.logger.error(`Failed to send fiat to bank transfer mail for buy-fiat ${entity.id}:`, e);
      }
    }
  }

  private async paybackToAddressInitiated(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        mail1SendDate: Not(IsNull()),
        cryptoReturnTxId: Not(IsNull()),
        cryptoReturnDate: Not(IsNull()),
        amlCheck: CheckStatus.FAIL,
        amlReason: Not(IsNull()),
        mailReturnSendDate: IsNull(),
      },
      relations: ['sell', 'sell.user', 'sell.user.userData', 'cryptoInput'],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'payback to address' email(s)`);

    for (const entity of entities) {
      try {
        if (
          entity.sell.user.userData.mail &&
          (entity.sell.user.userData.verifiedName || entity.amlReason !== AmlReason.NAME_CHECK_WITHOUT_KYC) &&
          !entity.noCommunication
        ) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_FIAT_RETURN,
            input: {
              userData: entity.sell.user.userData,
              title: `${MailTranslationKey.CRYPTO_RETURN}.title`,
              salutation: { key: `${MailTranslationKey.CRYPTO_RETURN}.salutation` },
              table: {
                [`${MailTranslationKey.PAYMENT}.reimbursed`]: `${entity.inputAmount} ${entity.inputAsset}`,
                [`${MailTranslationKey.PAYMENT}.blockchain`]: entity.cryptoInputBlockchain,
                [`${MailTranslationKey.PAYMENT}.wallet_address`]: Util.blankStart(entity.sell.user.address),
                [`${MailTranslationKey.PAYMENT}.transaction_id`]: entity.isLightningTransaction
                  ? Util.blankStart(entity.cryptoReturnTxId)
                  : null,
              },
              suffix: [
                entity.isLightningTransaction
                  ? null
                  : {
                      key: `${MailTranslationKey.CRYPTO_RETURN}.payment_link`,
                      params: { url: txExplorerUrl(entity.cryptoInputBlockchain, entity.cryptoReturnTxId) },
                    },
                !AmlReasonWithoutReason.includes(entity.amlReason)
                  ? {
                      key: `${MailTranslationKey.RETURN}.introduction`,
                      params: {
                        reason: MailFactory.parseMailKey(MailTranslationKey.RETURN_REASON, entity.amlReason),
                        url: entity.sell.user.userData.dilisenseUrl,
                        urlText: entity.sell.user.userData.dilisenseUrl,
                      },
                    }
                  : null,
                KycAmlReasons.includes(entity.amlReason)
                  ? {
                      key: `${MailTranslationKey.RETURN}.kyc_start`,
                      params: {
                        url: entity.sell.user.userData.kycUrl,
                        urlText: entity.sell.user.userData.kycUrl,
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

        await this.buyFiatRepo.update(...entity.returnMail());
      } catch (e) {
        this.logger.error(`Failed to send payback to address mail for buy-fiat ${entity.id}:`, e);
      }
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
      relations: ['sell', 'sell.user', 'sell.user.userData'],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'pending' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.sell.user.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.BUY_FIAT_PENDING,
            input: {
              userData: entity.sell.user.userData,
              title: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.title`,
              salutation: {
                key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.salutation`,
              },
              suffix: [
                { key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line1` },
                {
                  key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line2`,
                  params: {
                    url: entity.sell.user.userData.kycUrl,
                    urlText: entity.sell.user.userData.kycUrl,
                  },
                },
                {
                  key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line3`,
                  params: {
                    url: entity.sell.user.userData.kycUrl,
                    urlText: entity.sell.user.userData.kycUrl,
                  },
                },
                {
                  key: `${MailFactory.parseMailKey(MailTranslationKey.PENDING, entity.amlReason)}.line4`,
                  params: {
                    url: entity.sell.user.userData.kycUrl,
                    urlText: entity.sell.user.userData.kycUrl,
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

        await this.buyFiatRepo.update(...entity.pendingMail());
      } catch (e) {
        this.logger.error(`Failed to send pending mail for buy-fiat ${entity.id}:`, e);
      }
    }
  }
}
