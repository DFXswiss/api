import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { I18nService } from 'nestjs-i18n';
import { BlockchainExplorerUrls } from 'src/blockchain/shared/enums/blockchain.enum';
import { Lock } from 'src/shared/lock';
import { MailService } from 'src/shared/services/mail.service';
import { Util } from 'src/shared/util';
import { IsNull, Not } from 'typeorm';
import { AmlCheck } from '../buy-crypto/enums/aml-check.enum';
import { BuyFiatRepository } from './buy-fiat.repository';

@Injectable()
export class BuyFiatNotificationService {
  private readonly lock = new Lock(1800);

  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly mailService: MailService,
    private readonly i18nService: I18nService,
  ) {}

  @Interval(60000)
  async sendNotificationMails(): Promise<void> {
    if (!this.lock.acquire()) return;

    await this.offRampInitiated();
    await this.cryptoExchangedToFiat();
    await this.fiatToBankTransferInitiated();
    await this.paybackToAddressInitiated();

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
          await this.mailService.sendTranslatedMail({
            userData: entity.sell.user.userData,
            translationKey: 'mail.payment.withdrawal.offRampInitiated',
            params: {
              inputAmount: entity.cryptoInput.amount,
              inputAsset: entity.cryptoInput.asset.dexName,
              inputTransactionLink: `${BlockchainExplorerUrls[entity.cryptoInput.asset.blockchain]}/${
                entity.cryptoInput.inTxId
              }`,
            },
          });
        } else {
          console.error(`Failed to send buy fiat mails ${entity.id}: user has no email`);
        }

        await this.buyFiatRepo.update(...entity.offRampInitiated(recipientMail));
      } catch (e) {
        console.error(e);
      }
    }
  }

  private async cryptoExchangedToFiat(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        mail1SendDate: Not(IsNull()),
        mail2SendDate: IsNull(),
        outputAmount: Not(IsNull()),
        amlCheck: Not(AmlCheck.FAIL),
      },
      relations: ['sell', 'sell.user', 'sell.user.userData'],
    });

    entities.length > 0 && console.log(`Sending ${entities.length} 'crypto exchanged to fiat' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.sell.user.userData.mail) {
          await this.mailService.sendTranslatedMail({
            userData: entity.sell.user.userData,
            translationKey: 'mail.payment.withdrawal.cryptoExchangedToFiat',
            params: {
              inputAmount: entity.inputAmount,
              inputAsset: entity.inputAsset,
              percentFee: entity.percentFeeString,
              exchangeRate: entity.exchangeRateString,
              outputAmount: entity.outputAmount,
              outputAsset: entity.outputAsset,
            },
          });
        }

        await this.buyFiatRepo.update(...entity.cryptoExchangedToFiat());
      } catch (e) {
        console.error(e);
      }
    }
  }

  private async fiatToBankTransferInitiated(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        mail2SendDate: Not(IsNull()),
        mail3SendDate: IsNull(),
        bankTx: Not(IsNull()),
        amlCheck: Not(AmlCheck.FAIL),
      },
      relations: ['sell', 'sell.user', 'sell.user.userData'],
    });

    entities.length > 0 && console.log(`Sending ${entities.length} 'fiat to bank transfer' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.sell.user.userData.mail) {
          await this.mailService.sendTranslatedMail({
            userData: entity.sell.user.userData,
            translationKey: 'mail.payment.withdrawal.fiatToBankTransferInitiated',
            params: {
              outputAmount: entity.outputAmount,
              outputAsset: entity.outputAsset,
              bankAccountTrimmed: Util.trimIBAN(entity.sell.iban),
              remittanceInfo: entity.remittanceInfo,
            },
          });
        }

        await this.buyFiatRepo.update(...entity.fiatToBankTransferInitiated());
      } catch (e) {
        console.error(e);
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
          await this.mailService.sendTranslatedMail({
            userData: entity.sell.user.userData,
            translationKey: 'mail.payment.withdrawal.paybackToAddressInitiated',
            params: {
              inputAmount: entity.inputAmount,
              inputAsset: entity.inputAsset,
              returnTransactionLink: `${BlockchainExplorerUrls[entity.cryptoInput.asset.blockchain]}/${
                entity.cryptoReturnTxId
              }`,
              returnReason: await this.i18nService.translate(`mail.amlReasonMailText.${entity.amlReason}`, {
                lang: entity.sell.user.userData.language?.symbol.toLowerCase(),
              }),
              userAddressTrimmed: Util.trimBlockchainAddress(entity.sell.user.address),
            },
          });
        }

        await this.buyFiatRepo.update({ id: entity.id }, { mailReturnSendDate: entity.mailReturnSendDate });
      } catch (e) {
        console.error(e);
      }
    }
  }
}
