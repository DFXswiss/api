import { Injectable } from '@nestjs/common';
import { isFiat } from 'src/shared/models/active';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { AmlService } from 'src/subdomains/core/aml/aml.service';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { CryptoPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { IsNull, Not } from 'typeorm';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { BuyCryptoFee } from '../entities/buy-crypto-fees.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoWebhookService } from './buy-crypto-webhook.service';
import { BuyCryptoService } from './buy-crypto.service';

@Injectable()
export class BuyCryptoPreparationService {
  private readonly logger = new DfxLogger(BuyCryptoPreparationService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly transactionHelper: TransactionHelper,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly assetService: AssetService,
    private readonly feeService: FeeService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly amlService: AmlService,
    private readonly userService: UserService,
  ) {}

  async doAmlCheck(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        amlCheck: IsNull(),
        amlReason: IsNull(),
        inputAmount: Not(IsNull()),
        inputAsset: Not(IsNull()),
        status: IsNull(),
        isComplete: false,
      },
      relations: {
        bankTx: true,
        checkoutTx: true,
        cryptoInput: true,
        buy: { user: { wallet: true, userData: { users: true } } },
        cryptoRoute: { user: { wallet: true, userData: { users: true } } },
      },
    });
    if (entities.length === 0) return;

    this.logger.verbose(
      `AmlCheck for ${entities.length} buy-crypto transaction(s). Transaction ID(s): ${entities.map((t) => t.id)}`,
    );

    // CHF/EUR Price
    const fiatChf = await this.fiatService.getFiatByName('CHF');

    for (const entity of entities) {
      try {
        if (entity.cryptoInput && (!entity.cryptoInput.isConfirmed || !entity.cryptoInput.amlCheck)) continue;

        const inputCurrency = entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputAsset));
        const inputReferenceCurrency =
          entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputReferenceAsset));

        const inputReferenceAssetChfPrice = await this.pricingService.getPrice(inputReferenceCurrency, fiatChf, false);

        const minVolume = await this.transactionHelper.getMinVolumeIn(inputCurrency, inputReferenceCurrency, false);

        const last24hVolume = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(1),
          entity.userData.users,
        );

        const last7dVolume = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(7),
          entity.userData.users,
        );

        const last30dVolume = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(30),
          entity.userData.users,
        );

        const { bankData, blacklist, instantBanks } = await this.amlService.getAmlCheckInput(entity);

        await this.buyCryptoRepo.update(
          ...entity.amlCheckAndFillUp(
            inputReferenceAssetChfPrice,
            minVolume,
            last24hVolume,
            last7dVolume,
            last30dVolume,
            bankData,
            blacklist,
            instantBanks,
          ),
        );

        if (entity.amlCheck === CheckStatus.PASS && entity.user.status === UserStatus.NA)
          await this.userService.activateUser(entity.user);
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} AML check:`, e);
      }
    }
  }

  async refreshFee(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        amlCheck: CheckStatus.PASS,
        status: IsNull(),
        isComplete: false,
        percentFee: IsNull(),
        inputReferenceAmount: Not(IsNull()),
      },
      relations: [
        'bankTx',
        'checkoutTx',
        'buy',
        'buy.user',
        'buy.user.wallet',
        'buy.user.userData',
        'cryptoInput',
        'cryptoRoute',
        'cryptoRoute.user',
        'cryptoRoute.user.wallet',
        'cryptoRoute.user.userData',
      ],
    });

    // CHF/EUR Price
    const fiatEur = await this.fiatService.getFiatByName('EUR');
    const fiatChf = await this.fiatService.getFiatByName('CHF');

    for (const entity of entities) {
      try {
        const inputReferenceCurrency =
          entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputReferenceAsset));

        const inputCurrency = entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputAsset));

        const { fee } = await this.transactionHelper.getTxFeeInfos(
          entity.inputReferenceAmount,
          inputCurrency,
          inputReferenceCurrency,
          entity.target.asset,
          entity.paymentMethodIn,
          CryptoPaymentMethod.CRYPTO,
          entity.user,
        );

        const referenceEurPrice = await this.pricingService.getPrice(inputReferenceCurrency, fiatEur, false);
        const referenceChfPrice = await this.pricingService.getPrice(inputReferenceCurrency, fiatChf, false);

        const amountInChf = referenceChfPrice.convert(entity.inputReferenceAmount, 2);

        await this.buyCryptoRepo.update(
          ...entity.setFeeAndFiatReference(
            referenceEurPrice.convert(entity.inputReferenceAmount, 2),
            amountInChf,
            fee,
            isFiat(inputReferenceCurrency) ? fee.min : referenceEurPrice.convert(fee.min, 2),
            referenceChfPrice.convert(fee.total, 2),
          ),
        );

        for (const feeId of fee.fees) {
          await this.feeService.increaseTxUsages(amountInChf, feeId, entity.user.userData);
        }

        await this.buyCryptoService.updateBuyVolume([entity.buy?.id]);
        await this.buyCryptoService.updateCryptoRouteVolume([entity.cryptoRoute?.id]);
        await this.buyCryptoService.updateRefVolume([entity.usedRef]);
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} fee and fiat reference refresh:`, e);
      }
    }
  }

  async prepareTransactions(): Promise<void> {
    try {
      const txInput = await this.buyCryptoRepo.find({
        where: {
          inputReferenceAmountMinusFee: Not(IsNull()),
          percentFee: Not(IsNull()),
          outputReferenceAsset: IsNull(),
          outputAsset: IsNull(),
          batch: IsNull(),
        },
        relations: [
          'bankTx',
          'checkoutTx',
          'buy',
          'buy.user',
          'buy.user.wallet',
          'buy.asset',
          'batch',
          'cryptoRoute',
          'cryptoRoute.user',
          'cryptoRoute.user.wallet',
          'cryptoRoute.asset',
          'cryptoInput',
        ],
      });

      if (txInput.length === 0) return;

      this.logger.verbose(
        `Buy-crypto transaction input. Processing ${txInput.length} transaction(s). Transaction ID(s): ${txInput.map(
          (t) => t.id,
        )}`,
      );

      const txWithAssets = await this.defineAssetPair(txInput);
      const txWithFeeConstraints = this.setFeeConstraints(txWithAssets);

      for (const tx of txWithFeeConstraints) {
        await this.buyCryptoRepo.save(tx);
        await this.buyCryptoWebhookService.triggerWebhook(tx);
      }
    } catch (e) {
      this.logger.error('Error during buy-crypto preparation:', e);
    }
  }

  // --- HELPER METHODS --- //

  private async defineAssetPair(transactions: BuyCrypto[]): Promise<BuyCrypto[]> {
    for (const tx of transactions) {
      try {
        const outputReferenceAssetToFetch = tx.defineAssetExchangePair();

        if (outputReferenceAssetToFetch) {
          const { outputReferenceAssetName, type } = outputReferenceAssetToFetch;

          const outputReferenceAsset = await this.assetService.getAssetByQuery({
            dexName: outputReferenceAssetName,
            blockchain: tx.outputAsset.blockchain,
            type,
          });

          if (!outputReferenceAsset) {
            throw new Error(
              `Asset with name ${outputReferenceAssetName}, type: ${type}, blockchain: ${tx.outputAsset.blockchain} not found by asset service.`,
            );
          }

          tx.setOutputReferenceAsset(outputReferenceAsset);
        }
      } catch (e) {
        this.logger.error('Error while defining buy-crypto asset pair:', e);
      }
    }

    return transactions.filter((tx) => tx.outputReferenceAsset && tx.outputAsset);
  }

  private setFeeConstraints(transactions: BuyCrypto[]): BuyCrypto[] {
    for (const tx of transactions) {
      const fee = BuyCryptoFee.create(tx);
      tx.setFeeConstraints(fee);
    }

    return transactions;
  }
}
