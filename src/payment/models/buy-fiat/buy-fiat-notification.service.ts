import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/lock';
import { MailService } from 'src/shared/services/mail.service';
import { Util } from 'src/shared/util';
import { IsNull, Not } from 'typeorm';
import { BuyFiatRepository } from './buy-fiat.repository';

@Injectable()
export class BuyFiatNotificationService {
  private readonly lock = new Lock(1800);

  constructor(private readonly buyFiatRepo: BuyFiatRepository, private readonly mailService: MailService) {}

  @Interval(60000)
  async sendNotificationMails(): Promise<void> {
    if (!this.lock.acquire()) return;

    await this.offRampInitiated();
    await this.cryptoExchangedToFiat();
    await this.fiatToBankTransferInitiated();

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

        entity.offRampInitiated(recipientMail);

        if (recipientMail) {
          await this.mailService.sendTranslatedMail({
            userData: entity.sell.user.userData,
            translationKey: 'mail.payment.withdrawal.offRampInitiated',
            params: {
              inputAmount: entity.cryptoInput.amount,
              inputAsset: entity.cryptoInput.asset.dexName,
              inputTransactionLink: `https://defiscan.live/transactions/${entity.cryptoInput.inTxId}`,
            },
          });
        }

        await this.buyFiatRepo.update(
          { id: entity.id },
          { recipientMail: entity.recipientMail, mail1SendDate: entity.mail1SendDate },
        );
      } catch (e) {
        console.error(e);
      }
    }
  }

  private async cryptoExchangedToFiat(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: { mail1SendDate: Not(IsNull()), mail2SendDate: IsNull(), outputAmount: Not(IsNull()) },
      relations: ['sell', 'sell.user', 'sell.user.userData'],
    });

    entities.length > 0 && console.log(`Sending ${entities.length} 'crypto exchanged to fiat' email(s)`);

    for (const entity of entities) {
      try {
        entity.cryptoExchangedToFiat();

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

        await this.buyFiatRepo.update({ id: entity.id }, { mail2SendDate: entity.mail2SendDate });
      } catch (e) {
        console.error(e);
      }
    }
  }

  private async fiatToBankTransferInitiated(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: { mail2SendDate: Not(IsNull()), mail3SendDate: IsNull(), bankTx: Not(IsNull()) },
      relations: ['sell', 'sell.user', 'sell.user.userData'],
    });

    entities.length > 0 && console.log(`Sending ${entities.length} 'fiat to bank transfer' email(s)`);

    for (const entity of entities) {
      try {
        entity.fiatToBankTransferInitiated();

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

        await this.buyFiatRepo.update({ id: entity.id }, { mail3SendDate: entity.mail3SendDate });
      } catch (e) {
        console.error(e);
      }
    }
  }
}
