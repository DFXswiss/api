import { Injectable } from '@nestjs/common';
import { In, IsNull, Not } from 'typeorm';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { Util } from 'src/shared/util';
import { NotificationService } from 'src/notification/services/notification.service';
import { MailContext, MailType } from 'src/notification/enums';
import { BlockchainExplorerUrls } from 'src/blockchain/shared/enums/blockchain.enum';
import { AmlCheck } from '../enums/aml-check.enum';
import { I18nService } from 'nestjs-i18n';
import { AmlReason } from '../enums/aml-reason.enum';
import { Config } from 'src/config/config';

@Injectable()
export class BuyCryptoNotificationService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly notificationService: NotificationService,
    private readonly i18nService: I18nService,
  ) {}

  async sendNotificationMails(): Promise<void> {
    try {
      await this.buyCryptoConfirmed();
      await this.paybackToAddressInitiated();
      await this.pendingBuyCrypto();
    } catch (e) {
      console.error(e);
    }
  }

  async buyCryptoConfirmed(): Promise<void> {
    try {
      const txOutput = await this.buyCryptoRepo.find({
        where: {
          mailSendDate: IsNull(),
          txId: Not(IsNull()),
          isComplete: true,
          batch: { status: BuyCryptoBatchStatus.COMPLETE },
          amlCheck: AmlCheck.PASS,
        },
        relations: [
          'bankTx',
          'buy',
          'buy.user',
          'buy.user.userData',
          'buy.asset',
          'batch',
          'cryptoRoute',
          'cryptoRoute.user',
          'cryptoRoute.user.userData',
          'cryptoRoute.asset',
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
                  buyTransactionLink: `${BlockchainExplorerUrls[tx.target.asset.blockchain]}/${tx.txId}`,
                },
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

  async sendMissingLiquidityWarning(outputAsset: string, blockchain: string, type: string): Promise<void> {
    const correlationId = `BuyCryptoBatch&LiquidityCheckWarning&${outputAsset}&${blockchain}&${type}`;
    const message = `One or more transactions were removed from batching, due to insufficient purchasable liquidity. Batch asset: ${outputAsset} ${blockchain} ${type}`;
    const additionalMessage =
      'Caution! this mail has debounce time of 30 minutes, by the moment you read this mail required amounts might have changed.';

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      input: {
        subject: 'Buy Crypto Warning - liquidity about to be missing.',
        errors: [message, additionalMessage],
      },
      options: { debounce: 1800000 },
      metadata: { context: MailContext.BUY_CRYPTO, correlationId },
    });
  }

  async sendMissingLiquidityError(
    outputAsset: string,
    blockchain: string,
    type: string,
    message: string,
  ): Promise<void> {
    const correlationId = `BuyCryptoBatch&LiquidityCheck&${outputAsset}&${blockchain}&${type}`;
    const additionalMessage =
      'Caution! this mail has debounce time of 30 minutes, by the moment you read this mail required amounts might have changed.';

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      input: { subject: 'Buy Crypto Error - missing liquidity.', errors: [message, additionalMessage] },
      options: { debounce: 1800000 },
      metadata: { context: MailContext.BUY_CRYPTO, correlationId },
    });
  }

  async sendFeeConversionError(
    nativeAssetName: string,
    referenceAssetName: string,
    message: string,
    error: Error,
  ): Promise<void> {
    const correlationId = `BuyCryptoBatch&FeeConversion&from_${nativeAssetName}&to_${referenceAssetName}`;
    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      input: { subject: 'Buy Crypto Error - cannot calculate fee.', errors: [message, error.message] },
      options: { debounce: 1800000 },
      metadata: { context: MailContext.BUY_CRYPTO, correlationId },
    });
  }

  async sendNonRecoverableErrorMail(batch: BuyCryptoBatch, message: string, e?: Error): Promise<void> {
    const correlationId = `BuyCryptoBatch&${batch.id}`;
    const errors = e ? [message, e.message] : [message];

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      input: { subject: 'Buy Crypto Error', errors },
      options: { suppressRecurring: true },
      metadata: { context: MailContext.BUY_CRYPTO, correlationId },
    });
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
          await this.notificationService.sendMail({
            type: MailType.USER,
            input: {
              userData: entity.user.userData,
              translationKey: entity.translationKey,
              translationParams: {
                inputAmount: entity.inputAmount,
                inputAsset: entity.inputAsset,
                returnTransactionLink: entity.chargebackRemittanceInfo,
                returnReason: await this.i18nService.translate(`mail.amlReasonMailText.${entity.amlReason}`, {
                  lang: entity.user.userData.language?.symbol.toLowerCase(),
                }),
                userAddressTrimmed: entity.target.trimmedReturnAddress,
              },
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
        amlReason: In([AmlReason.DAILY_LIMIT, AmlReason.ANNUAL_LIMIT, AmlReason.OLKY_NO_KYC]),
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
      try {
        if (entity.user.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            input: {
              userData: entity.user.userData,
              translationKey: entity.translationKey,
              translationParams: {
                hashLink: `${Config.payment.url}/kyc?code=${entity.user.userData.kycHash}`,
              },
            },
          });
        }

        await this.buyCryptoRepo.update(...entity.confirmSentMail());
      } catch (e) {
        console.error(e);
      }
    }
  }
}
