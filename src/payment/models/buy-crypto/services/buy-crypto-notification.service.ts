import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { IsNull, Not } from 'typeorm';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';

@Injectable()
export class BuyCryptoNotificationService {
  constructor(private readonly buyCryptoRepo: BuyCryptoRepository, private readonly mailService: MailService) {}

  async sendNotificationMails(): Promise<void> {
    try {
      const txOutput = await this.buyCryptoRepo.find({
        where: {
          recipientMail: IsNull(),
          mailSendDate: IsNull(),
          txId: Not(IsNull()),
          isComplete: true,
          batch: { status: BuyCryptoBatchStatus.COMPLETE },
        },
        relations: ['bankTx', 'buy', 'buy.user', 'buy.user.userData', 'batch'],
      });

      txOutput.length &&
        console.info(
          `Sending notifications for ${txOutput.length} buy crypto transaction(s). Transaction ID(s): ${txOutput.map(
            (t) => t.id,
          )}`,
        );

      for (const tx of txOutput) {
        try {
          tx.buy.user.userData.mail &&
            (await this.mailService.sendTranslatedMail({
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
            }));

          tx.confirmSentMail();

          await this.buyCryptoRepo.save(tx);
        } catch (e) {
          console.error(e);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  async sendNonRecoverableErrorMail(message: string, e?: Error): Promise<void> {
    const body = e ? [message, e.message] : [message];

    await this.mailService.sendErrorMail('Buy Crypto Error', body);
  }
}
