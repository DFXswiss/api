import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { IsNull, Not } from 'typeorm';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { Util } from 'src/shared/util';

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
        relations: [
          'bankTx',
          'buy',
          'buy.user',
          'buy.user.userData',
          'batch',
          'cryptoRoute',
          'cryptoRoute.user',
          'cryptoRoute.user.userData',
        ],
      });

      txOutput.length &&
        console.info(
          `Sending notifications for ${txOutput.length} buy crypto transaction(s). Transaction ID(s): ${txOutput.map(
            (t) => t.id,
          )}`,
        );

      for (const tx of txOutput) {
        try {
          tx.user.userData.mail &&
            (await this.mailService.sendTranslatedMail({
              userData: tx.user.userData,
              translationKey: tx.translationKey,
              params: {
                buyInputAmount: tx.inputAmount,
                buyInputAsset: tx.inputAsset,
                buyOutputAmount: tx.outputAmount,
                buyOutputAsset: tx.outputAsset,
                buyFeePercentage: Util.round(tx.percentFee * 100, 2),
                exchangeRate: Util.round(tx.inputAmount / tx.outputAmount, 2),
                buyWalletAddress: Util.trimBlockchainAddress(tx.target.address),
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
