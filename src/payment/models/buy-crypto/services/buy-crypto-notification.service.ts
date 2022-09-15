import { Injectable } from '@nestjs/common';
import { IsNull, Not } from 'typeorm';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { Util } from 'src/shared/util';
import { NotificationService } from 'src/notification/services/notification.service';
import { MailType } from 'src/notification/enums';

@Injectable()
export class BuyCryptoNotificationService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly notificationService: NotificationService,
  ) {}

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
            (await this.notificationService.sendMail({
              type: MailType.USER,
              input: {
                userData: tx.user.userData,
                translationKey: tx.translationKey,
                translationParams: {
                  buyInputAmount: tx.inputAmount,
                  buyInputAsset: tx.inputAsset,
                  buyOutputAmount: tx.outputAmount,
                  buyOutputAsset: tx.outputAsset,
                  buyFeePercentage: Util.round(tx.percentFee * 100, 2),
                  exchangeRate: Util.round(tx.inputAmount / tx.outputAmount, 2),
                  buyWalletAddress: Util.trimBlockchainAddress(tx.target.address),
                  buyTxId: tx.txId,
                },
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
    const errors = e ? [message, e.message] : [message];

    await this.notificationService.sendMail({ type: MailType.ERROR, input: { subject: 'Buy Crypto Error', errors } });
  }
}
