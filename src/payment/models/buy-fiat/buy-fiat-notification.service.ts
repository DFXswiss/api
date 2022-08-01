import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/lock';
import { MailService } from 'src/shared/services/mail.service';
import { IsNull, Not } from 'typeorm';
import { BuyFiatRepository } from './buy-fiat.repository';

@Injectable()
export class BuyFiatNotificationService {
  private readonly lock = new Lock(1800);

  constructor(private readonly buyFiatRepo: BuyFiatRepository, private readonly mailService: MailService) {}

  @Interval(60000)
  async sendNotificationMails(): Promise<void> {
    await this.offRampInitiated();
    await this.cryptoExchangedToFiat();
    await this.fiatToBankTransferInitiated();
  }

  private async offRampInitiated(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: { mail1SendDate: IsNull() },
      relations: ['cryptoInput', 'cryptoInput.route', 'cryptoInput.route.user', 'cryptoInput.route.user.userData'],
    });

    for (const entity of entities) {
      try {
        const recipientMail = entity.cryptoInput?.route?.user?.userData?.mail;

        entity.offRampInitiated(recipientMail);

        await this.mailService.sendTranslatedMail({
          userData: entity.cryptoInput.route.user.userData,
          translationKey: 'mail.payment.withdrawal.offRampInitiated',
          params: {},
        });

        await this.buyFiatRepo.save(entity);
      } catch (e) {
        console.error(e);
      }
    }
  }

  private async cryptoExchangedToFiat(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: { mail1SendDate: Not(IsNull()), mail2SendDate: IsNull(), outputAmount: Not(IsNull()) },
      relations: ['cryptoInput', 'cryptoInput.route', 'cryptoInput.route.user', 'cryptoInput.route.user.userData'],
    });

    for (const entity of entities) {
      try {
        entity.cryptoExchangedToFiat();

        await this.mailService.sendTranslatedMail({
          userData: entity.cryptoInput.route.user.userData,
          translationKey: 'mail.payment.withdrawal.cryptoExchangedToFiat',
          params: {},
        });

        await this.buyFiatRepo.save(entity);
      } catch (e) {
        console.error(e);
      }
    }
  }

  private async fiatToBankTransferInitiated(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: { mail2SendDate: Not(IsNull()), mail3SendDate: IsNull(), bankTxId: Not(IsNull()) },
      relations: ['cryptoInput', 'cryptoInput.route', 'cryptoInput.route.user', 'cryptoInput.route.user.userData'],
    });

    for (const entity of entities) {
      try {
        entity.fiatToBankTransferInitiated();

        await this.mailService.sendTranslatedMail({
          userData: entity.cryptoInput.route.user.userData,
          translationKey: 'mail.payment.withdrawal.fiatToBankTransferInitiated',
          params: {},
        });

        await this.buyFiatRepo.save(entity);
      } catch (e) {
        console.error(e);
      }
    }
  }
}
