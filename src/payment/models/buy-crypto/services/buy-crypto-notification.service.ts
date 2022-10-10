import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { IsNull, Not } from 'typeorm';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { Util } from 'src/shared/util';
import { Blockchain, BlockchainExplorerUrls } from 'src/blockchain/shared/enums/blockchain.enum';
import { AmlCheck } from '../enums/aml-check.enum';
import { I18nService } from 'nestjs-i18n';
import { AmlReason } from '../enums/aml-reason.enum';

@Injectable()
export class BuyCryptoNotificationService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly mailService: MailService,
    private readonly i18nService: I18nService,
  ) {}

  async sendNotificationMails(): Promise<void> {
    await this.buyCryptoConfirmed();
    await this.paybackToAddressInitiated();
    await this.pendingBuyCrypto();
  }

  async buyCryptoConfirmed(): Promise<void> {
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
                buyTransactionLink: `${BlockchainExplorerUrls[Blockchain.DEFICHAIN]}/${tx.txId}`,
              },
            }));

          await this.buyCryptoRepo.update(...tx.confirmSentMail());
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

  async paybackToAddressInitiated(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        mailSendDate: IsNull(),
        outputAmount: IsNull(),
        chargebackDate: Not(IsNull()),
        chargebackBankTx: Not(IsNull()),
        chargebackRemittanceInfo: Not(IsNull()),
        amlReason: Not(IsNull()),
        amlCheck: AmlCheck.FAIL,
      },
      relations: [
        'buy',
        'buy.user',
        'buy.user.userData',
        'cryptoInput',
        'cryptoRoute',
        'cryptoRoute.user',
        'cryptoRoute.user.userData',
      ],
    });

    entities.length > 0 && console.log(`Sending ${entities.length} 'payback to address' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.user.userData.mail) {
          await this.mailService.sendTranslatedMail({
            userData: entity.user.userData,
            translationKey: entity.translationKey,
            params: {
              inputAmount: entity.inputAmount,
              inputAsset: entity.inputAsset,
              returnTransactionLink: entity.chargebackRemittanceInfo,
              returnReason: await this.i18nService.translate(`mail.amlReasonMailText.${entity.amlReason}`, {
                lang: entity.user.userData.language?.symbol.toLowerCase(),
              }),
              userAddressTrimmed: Util.trimBlockchainAddress(entity.user.address),
            },
          });
        }

        await this.buyCryptoRepo.update(...entity.confirmSentMail());
      } catch (e) {
        console.error(e);
      }
    }
  }

  async pendingBuyCrypto(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        mailSendDate: IsNull(),
        outputAmount: IsNull(),
        chargebackDate: IsNull(),
        chargebackBankTx: IsNull(),
        amlReason: Not(IsNull()),
        amlCheck: AmlCheck.PENDING,
      },
      relations: [
        'buy',
        'buy.user',
        'buy.user.userData',
        'cryptoInput',
        'cryptoRoute',
        'cryptoRoute.user',
        'cryptoRoute.user.userData',
      ],
    });

    entities.length > 0 && console.log(`Sending ${entities.length} 'pending' email(s)`);

    for (const entity of entities) {
      if (entity.amlReason !== AmlReason.ANNUAL_LIMIT && entity.amlReason !== AmlReason.DAILY_LIMIT) continue;
      try {
        entity.confirmSentMail();

        if (entity.user.userData.mail) {
          await this.mailService.sendTranslatedMail({
            userData: entity.user.userData,
            translationKey: entity.translationKey,
            params: {
              hashLink: `https://payment.dfx.swiss/kyc?code=${entity.user.userData.kycHash}`,
            },
          });
        }

        await this.buyCryptoRepo.update(
          { id: entity.id },
          { mailSendDate: entity.mailSendDate, recipientMail: entity.recipientMail },
        );
      } catch (e) {
        console.error(e);
      }
    }
  }
}
