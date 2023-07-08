import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { I18nService } from 'nestjs-i18n';
import { Config, Process } from 'src/config/config';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { In, IsNull, Not } from 'typeorm';
import { AmlCheck } from '../../buy-crypto/process/enums/aml-check.enum';
import { BuyFiatAmlReasonPendingStates } from './buy-fiat.entity';
import { BuyFiatRepository } from './buy-fiat.repository';

@Injectable()
export class BuyFiatNotificationService {
  private readonly logger = new DfxLogger(BuyFiatNotificationService);

  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly notificationService: NotificationService,
    private readonly i18nService: I18nService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async sendNotificationMails(): Promise<void> {
    if (Config.processDisabled(Process.BUY_FIAT_MAIL)) return;
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

        if (recipientMail) {
          await this.notificationService.sendMailNew({
            type: MailType.USER,
            input: {
              userData: entity.sell.user.userData,
              title: `${MailTranslationKey.BUY_FIAT}.initiated.title`,
              prefix: { key: `${MailTranslationKey.BUY_FIAT}.initiated.salutation` },
              table: {
                [`${MailTranslationKey.BUY_FIAT}.input_amount`]: `${entity.inputAmount} ${entity.inputAsset}`,
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
        } else {
          this.logger.warn(`Failed to send buy-fiat mails ${entity.id}: user has no email`);
        }

        await this.buyFiatRepo.update(...entity.offRampInitiated(recipientMail));
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
        amlCheck: AmlCheck.PASS,
      },
      relations: ['cryptoInput', 'sell', 'sell.user', 'sell.user.userData'],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'crypto exchanged to fiat' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.sell.user.userData.mail) {
          const minFee = entity.minFeeAmountFiat
            ? ` (min. ${entity.minFeeAmountFiat} ${entity.outputReferenceAsset})`
            : '';

          await this.notificationService.sendMailNew({
            type: MailType.USER,
            input: {
              userData: entity.sell.user.userData,
              title: `${MailTranslationKey.BUY_FIAT}.exchanged.title`,
              prefix: { key: `${MailTranslationKey.BUY_FIAT}.exchanged.salutation` },
              table: {
                [`${MailTranslationKey.BUY_FIAT}.input_amount`]: `${entity.inputAmount} ${entity.inputAsset}`,
                [`${MailTranslationKey.PAYMENT}.blockchain`]: `${entity.cryptoInputBlockchain}`,
                [`${MailTranslationKey.PAYMENT}.dfx_fee`]: `${entity.percentFeeString}` + minFee,
                [`${MailTranslationKey.PAYMENT}.exchange_rate`]: `${entity.exchangeRateString}`,
                [`${MailTranslationKey.BUY_FIAT}.output_amount`]: `${entity.outputAmount} ${entity.outputAsset}`,
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
        amlCheck: AmlCheck.PASS,
      },
      relations: ['sell', 'sell.user', 'sell.user.userData', 'fiatOutput', 'fiatOutput.bankTx'],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'fiat to bank transfer' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.sell.user.userData.mail) {
          await this.notificationService.sendMailNew({
            type: MailType.USER,
            input: {
              userData: entity.sell.user.userData,
              title: `${MailTranslationKey.BUY_FIAT}.processed.title`,
              prefix: { key: `${MailTranslationKey.BUY_FIAT}.processed.salutation` },
              table: {
                [`${MailTranslationKey.BUY_FIAT}.output_amount`]: `${entity.outputAmount} ${entity.outputAsset}`,
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
        amlReason: Not(IsNull()),
        amlCheck: AmlCheck.FAIL,
        mailReturnSendDate: IsNull(),
      },
      relations: ['sell', 'sell.user', 'sell.user.userData', 'cryptoInput'],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'payback to address' email(s)`);

    for (const entity of entities) {
      try {
        entity.paybackToAddressInitiated();

        if (entity.sell.user.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            input: {
              userData: entity.sell.user.userData,
              translationKey: entity.translationKey,
              translationParams: {
                inputAmount: entity.inputAmount,
                inputAsset: entity.inputAsset,
                blockchain: entity.cryptoInputBlockchain,
                returnTransactionLink: txExplorerUrl(entity.cryptoInputBlockchain, entity.cryptoReturnTxId),
                returnReason: this.i18nService.translate(`mail.amlReasonMailText.${entity.amlReason}`, {
                  lang: entity.sell.user.userData.language?.symbol.toLowerCase(),
                }),
                userAddressTrimmed: Util.blankStart(entity.sell.user.address),
              },
            },
          });
        }

        await this.buyFiatRepo.update({ id: entity.id }, { mailReturnSendDate: entity.mailReturnSendDate });
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
        amlCheck: AmlCheck.PENDING,
      },
      relations: ['sell', 'sell.user', 'sell.user.userData'],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'pending' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.sell.user.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            input: {
              userData: entity.sell.user.userData,
              translationKey: entity.translationKey,
              translationParams: {
                hashLink: `${Config.payment.url}/kyc?code=${entity.sell.user.userData.kycHash}`,
              },
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
