import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { IsNull, Not } from 'typeorm';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';

@Injectable()
export class BuyCryptoNotificationService {
  constructor(private readonly buyCryptoRepo: BuyCryptoRepository, private readonly mailService: MailService) {}

  async sentNotificationMails(): Promise<void> {
    const txOutput = await this.buyCryptoRepo.find({
      where: {
        recipientMail: IsNull(),
        mailSendDate: IsNull(),
        txId: Not(IsNull()),
        batch: { status: BuyCryptoBatchStatus.COMPLETE },
      },
      relations: ['bankTx', 'buy', 'buy.user', 'buy.user.userData', 'batch'],
    });

    console.log('SEND NOTIFICATIONS', txOutput);

    for (const tx of txOutput) {
      await this.mailService.sendTranslatedMail({
        userData: tx.buy.user.userData,
        translationKey: 'mail.payment.buyCrypto',
        params: {
          buyFiatAmount: tx.inputAmount,
          buyFiatAsset: tx.inputAsset,
          buyCryptoAmount: tx.outputAmount,
          buyCryptoAsset: tx.outputAsset,
          buyFeePercentage: tx.percentFee,
          buyFeeAmount: tx.percentFeeAmount,
          buyWalletAddress: tx.buy.user.address,
          buyTxId: tx.txId,
        },
      });

      tx.confirmSentMail();

      console.log('TX mail confirmed', tx);

      // TODO - no need to await? make sure
      await this.buyCryptoRepo.save(tx);
    }
  }
}
