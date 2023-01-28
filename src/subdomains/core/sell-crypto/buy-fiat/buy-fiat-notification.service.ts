import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { I18nService } from 'nestjs-i18n';
import { BlockchainExplorerUrls } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Config } from 'src/config/config';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { IsNull, Not, In } from 'typeorm';
import { BuyFiatRepository } from './buy-fiat.repository';
import { AmlCheck } from '../../buy-crypto/process/enums/aml-check.enum';
import { BuyFiatAmlReasonPendingStates } from './buy-fiat.entity';

@Injectable()
export class BuyFiatNotificationService {
  private readonly lock = new Lock(1800);

  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly notificationService: NotificationService,
    private readonly i18nService: I18nService,
  ) {}

  @Interval(60000)
  async sendNotificationMails(): Promise<void> {
    if (!this.lock.acquire()) return;

    await this.offRampInitiated();
    await this.cryptoExchangedToFiat();
    await this.fiatToBankTransferInitiated();
    await this.paybackToAddressInitiated();
    await this.pendingBuyFiat();

    this.lock.release();
  }

  private async offRampInitiated(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: { mail1SendDate: IsNull(), cryptoInput: Not(IsNull()) },
      relations: ['cryptoInput', 'sell', 'sell.user', 'sell.user.userData'],
    });

    entities.length > 0 && console.log(`Sending ${entities.length} 'off-ramp initiated' email(s)`);

    for (const entity of entities) {
      try {
        const recipientMail = entity.sell.user.userData.mail;

        if (recipientMail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            input: {
              userData: entity.sell.user.userData,
              translationKey: entity.translationKey,
              translationParams: {
                inputAmount: entity.cryptoInput.amount,
                inputAsset: entity.cryptoInput.asset.dexName,
                inputTransactionLink: `${BlockchainExplorerUrls[entity.cryptoInput.asset.blockchain]}/${
                  entity.cryptoInput.inTxId
                }`,
              },
            },
          });
        } else {
          console.error(`Failed to send buy fiat mails ${entity.id}: user has no email`);
        }

        await this.buyFiatRepo.update(...entity.offRampInitiated(recipientMail));
      } catch (e) {
        console.error(`Failed to send buyFiat off-ramp initiated mail ${entity.id}:`, e);
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
      relations: ['sell', 'sell.user', 'sell.user.userData'],
    });

    entities.length > 0 && console.log(`Sending ${entities.length} 'crypto exchanged to fiat' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.sell.user.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            input: {
              userData: entity.sell.user.userData,
              translationKey: entity.translationKey,
              translationParams: {
                inputAmount: entity.inputAmount,
                inputAsset: entity.inputAsset,
                percentFee: entity.percentFeeString,
                exchangeRate: entity.exchangeRateString,
                outputAmount: entity.outputAmount,
                outputAsset: entity.outputAsset,
              },
            },
          });
        }

        await this.buyFiatRepo.update(...entity.cryptoExchangedToFiat());
      } catch (e) {
        console.error(`Failed to send buyFiat crypto exchanged to fiat mail ${entity.id}:`, e);
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

    entities.length > 0 && console.log(`Sending ${entities.length} 'fiat to bank transfer' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.sell.user.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            input: {
              userData: entity.sell.user.userData,
              translationKey: entity.translationKey,
              translationParams: {
                outputAmount: entity.outputAmount,
                outputAsset: entity.outputAsset,
                bankAccountTrimmed: Util.blankIban(entity.sell.iban),
                remittanceInfo: entity.fiatOutput.remittanceInfo,
              },
            },
          });
        }

        await this.buyFiatRepo.update(...entity.fiatToBankTransferInitiated());
      } catch (e) {
        console.error(`Failed to send buyFiat fiat to bank transfer mail ${entity.id}:`, e);
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

    entities.length > 0 && console.log(`Sending ${entities.length} 'payback to address' email(s)`);

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
                returnTransactionLink: `${BlockchainExplorerUrls[entity.cryptoInput.asset.blockchain]}/${
                  entity.cryptoReturnTxId
                }`,
                returnReason: await this.i18nService.translate(`mail.amlReasonMailText.${entity.amlReason}`, {
                  lang: entity.sell.user.userData.language?.symbol.toLowerCase(),
                }),
                userAddressTrimmed: Util.blankBlockchainAddress(entity.sell.user.address),
              },
            },
          });
        }

        await this.buyFiatRepo.update({ id: entity.id }, { mailReturnSendDate: entity.mailReturnSendDate });
      } catch (e) {
        console.error(`Failed to send buyFiat payback to address mail ${entity.id}:`, e);
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

    entities.length > 0 && console.log(`Sending ${entities.length} 'pending' email(s)`);

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
        console.error(e);
      }
    }
  }
}
