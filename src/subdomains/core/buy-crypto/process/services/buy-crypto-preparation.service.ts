import { Injectable } from '@nestjs/common';
import { isFiat } from 'src/shared/models/active';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { CryptoPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { IsNull, Not } from 'typeorm';
import { BuyCryptoFee } from '../entities/buy-crypto-fees.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { CheckStatus } from '../enums/check-status.enum';
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
    private readonly bankDataService: BankDataService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly assetService: AssetService,
    private readonly feeService: FeeService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
  ) {}

  async doAmlCheck(): Promise<void> {
    // Atm only for bankTx BuyCrypto

    const entities = await this.buyCryptoRepo.find({
      where: { amlCheck: IsNull(), amlReason: IsNull(), bankTx: Not(IsNull()), buy: Not(IsNull()), status: IsNull() },
      relations: ['bankTx', 'buy', 'buy.user', 'buy.user.wallet', 'buy.user.userData', 'buy.user.userData.users'],
    });
    if (entities.length === 0) return;

    this.logger.verbose(
      `AmlCheck for ${entities.length} buy-crypto transaction(s). Transaction ID(s): ${entities.map((t) => t.id)}`,
    );

    // CHF/EUR Price
    const fiatChf = await this.fiatService.getFiatByName('CHF');

    for (const entity of entities) {
      try {
        const inputReferenceCurrency = await this.fiatService.getFiatByName(entity.bankTx.txCurrency);
        const inputCurrency = await this.fiatService.getFiatByName(entity.inputAsset);

        const { minVolume } = await this.transactionHelper.getTxFeeInfos(
          entity.inputReferenceAmount,
          inputCurrency,
          inputReferenceCurrency,
          entity.target.asset,
          entity.paymentMethodIn,
          CryptoPaymentMethod.CRYPTO,
          entity.user,
        );

        const inputAssetChfPrice = await this.pricingService.getPrice(inputReferenceCurrency, fiatChf, false);

        const bankData = await this.bankDataService.getBankDataWithIban(entity.bankTx.iban, undefined, true);

        const dateFrom = Util.daysBefore(30);

        const userDataBuyCryptoVolume = await this.buyCryptoService.getUserVolume(
          entity.user.userData.users.map((user) => user.id),
          dateFrom,
        );

        const userDataBuyFiatVolume = await this.buyFiatService.getUserVolume(
          entity.user.userData.users.map((user) => user.id),
          dateFrom,
        );

        await this.buyCryptoRepo.update(
          ...entity.amlCheckAndFillUp(
            inputAssetChfPrice,
            minVolume,
            userDataBuyCryptoVolume + userDataBuyFiatVolume,
            bankData?.userData,
          ),
        );
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
          (await this.fiatService.getFiatByName(entity.inputReferenceAsset)) ??
          (await this.assetService.getNativeMainLayerAsset(entity.inputReferenceAsset));

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
            fee.fees,
            fee.rate,
            fee.fixed,
            fee.payoutRefBonus,
            fee.min,
            isFiat(inputReferenceCurrency) ? fee.min : referenceEurPrice.convert(fee.min, 2),
            fee.total,
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
