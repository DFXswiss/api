import { Injectable } from '@nestjs/common';
import { In, IsNull, Not } from 'typeorm';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { Util } from 'src/shared/utils/util';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { AmlCheck } from '../enums/aml-check.enum';
import { I18nService } from 'nestjs-i18n';
import { Config, Process } from 'src/config/config';
import { BuyCryptoAmlReasonPendingStates } from '../entities/buy-crypto.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';

@Injectable()
export class BuyCryptoNotificationService {
  private readonly logger = new DfxLogger(BuyCryptoNotificationService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly notificationService: NotificationService,
    private readonly i18nService: I18nService,
  ) {}

  async sendNotificationMails(): Promise<void> {
    try {
      if (Config.processDisabled(Process.BUY_CRYPTO_MAIL)) return;
      await this.buyCryptoConfirmed();
      await this.paybackToAddressInitiated();
      await this.pendingBuyCrypto();
    } catch (e) {
      this.logger.error('Error during buy crypto notification:', e);
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
          'batch',
          'cryptoRoute',
          'cryptoRoute.user',
          'cryptoRoute.user.userData',
          'cryptoInput',
        ],
      });

      txOutput.length &&
        this.logger.info(
          `Sending notifications for ${txOutput.length} buy crypto transaction(s). Transaction ID(s): ${txOutput.map(
            (t) => t.id,
          )}`,
        );

      for (const tx of txOutput) {
        try {
          const minFee = tx.minFeeAmountFiat
            ? ` (min. ${tx.minFeeAmountFiat} ${tx.cryptoInput ? 'EUR' : tx.inputReferenceAsset})`
            : '';
          tx.user.userData.mail &&
            (await this.notificationService.sendMail({
              type: MailType.USER,
              input: {
                userData: tx.user.userData,
                translationKey: tx.translationKey,
                translationParams: {
                  buyInputAmount: tx.inputAmount,
                  buyInputAsset: tx.inputAsset,
                  inputBlockchain: tx.cryptoInput ? tx.cryptoInput.asset.blockchain : null,
                  buyOutputAmount: tx.outputAmount,
                  buyOutputAsset: tx.outputAsset.name,
                  blockchain: tx.outputAsset.blockchain,
                  buyFeePercentage: Util.round(tx.percentFee * 100, 2),
                  exchangeRate: Util.round(
                    (tx.inputAmount / tx.inputReferenceAmount) * (tx.inputReferenceAmountMinusFee / tx.outputAmount),
                    2,
                  ),
                  buyWalletAddress: Util.blankBlockchainAddress(tx.target.address),
                  buyTxId: tx.txId,
                  buyTransactionLink: txExplorerUrl(tx.target.asset.blockchain, tx.txId),
                  fee: `${Util.round(tx.percentFee * 100, 2)}%` + minFee,
                },
              },
            }));

          await this.buyCryptoRepo.update(...tx.confirmSentMail());
        } catch (e) {
          this.logger.error(`Failed to send buyCrypto confirmed mail ${tx.id}:`, e);
        }
      }
    } catch (e) {
      this.logger.error(`Failed to send buyCrypto confirmed mails:`, e);
    }
  }

  async sendMissingLiquidityWarning(outputAssetName: string, blockchain: string, type: string): Promise<void> {
    const correlationId = `BuyCryptoBatch&LiquidityCheckWarning&${outputAssetName}&${blockchain}&${type}`;
    const message = `One or more transactions were removed from batching, due to insufficient purchasable liquidity. Batch asset: ${outputAssetName} ${blockchain} ${type}`;
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
    outputAssetName: string,
    blockchain: string,
    type: string,
    transactionIds: number[],
    messages: string[],
  ): Promise<void> {
    const correlationId = `BuyCryptoBatch&LiquidityCheck&${outputAssetName}&${blockchain}&${type}&TX_IDs_${transactionIds.map(
      (id) => `${id}`,
    )}`;

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      input: { subject: 'Buy Crypto Error - missing liquidity.', errors: messages },
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

    entities.length > 0 && this.logger.info(`Sending ${entities.length} 'payback to address' email(s)`);

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
                returnTransactionLink: entity.chargebackRemittanceInfo?.split(' Zahlung')[0],
                returnReason: this.i18nService.translate(`mail.amlReasonMailText.${entity.amlReason}`, {
                  lang: entity.user.userData.language?.symbol.toLowerCase(),
                }),
                userAddressTrimmed: entity.target.trimmedReturnAddress,
              },
            },
          });
        }

        await this.buyCryptoRepo.update(...entity.confirmSentMail());
      } catch (e) {
        this.logger.error(`Failed to send buyCrypto payback to address mail ${entity.id}:`, e);
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
        amlReason: In(BuyCryptoAmlReasonPendingStates),
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

    entities.length > 0 && this.logger.info(`Sending ${entities.length} 'pending' email(s)`);

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
        this.logger.error(`Failed to send buyCrypto pending mail ${entity.id}:`, e);
      }
    }
  }
}
