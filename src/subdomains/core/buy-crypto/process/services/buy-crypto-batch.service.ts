import { Injectable } from '@nestjs/common';
import { Not, IsNull } from 'typeorm';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { AbortBatchCreationException } from '../exceptions/abort-batch-creation.exception';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { BuyCryptoPricingService } from './buy-crypto-pricing.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Price } from 'src/integration/exchange/dto/price.dto';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { CheckLiquidityRequest, CheckLiquidityResult } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { FeeResult, FeeRequest } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PriceRequestContext } from 'src/subdomains/supporting/pricing/enums';
import { PriceResult, PriceRequest } from 'src/subdomains/supporting/pricing/interfaces';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { FeeLimitExceededException } from '../exceptions/fee-limit-exceeded.exception';
import { Util } from 'src/shared/utils/util';

@Injectable()
export class BuyCryptoBatchService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly pricingService: PricingService,
    private readonly buyCryptoPricingService: BuyCryptoPricingService,
    private readonly assetService: AssetService,
    private readonly dexService: DexService,
    private readonly payoutService: PayoutService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
  ) {}

  async batchTransactionsByAssets(): Promise<void> {
    try {
      const txInput = await this.buyCryptoRepo.find({
        where: {
          inputReferenceAmountMinusFee: Not(IsNull()),
          outputReferenceAsset: IsNull(),
          outputReferenceAmount: IsNull(),
          outputAsset: IsNull(),
          batch: IsNull(),
        },
        relations: [
          'bankTx',
          'buy',
          'buy.user',
          'buy.asset',
          'batch',
          'cryptoRoute',
          'cryptoRoute.user',
          'cryptoRoute.asset',
        ],
      });

      if (txInput.length === 0) {
        return;
      }

      console.info(
        `Buy crypto transaction input. Processing ${txInput.length} transaction(s). Transaction ID(s):`,
        txInput.map((t) => t.id),
      );

      const txWithAssets = await this.defineAssetPair(txInput);
      const referencePrices = await this.getReferencePrices(txWithAssets);
      const txWithReferenceAmount = await this.defineReferenceAmount(txWithAssets, referencePrices);
      const batches = await this.createBatches(txWithReferenceAmount);

      for (const batch of batches) {
        const savedBatch = await this.buyCryptoBatchRepo.save(batch);
        console.info(
          `Created buy crypto batch. Batch ID: ${savedBatch.id}. Asset: ${savedBatch.outputAsset.uniqueName}. Transaction(s) count ${batch.transactions.length}`,
        );
      }
    } catch (e) {
      console.error(e);
    }
  }

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
        console.error('Error while defining asset pair for BuyCrypto', e);
      }
    }

    return transactions.filter((tx) => tx.outputReferenceAsset && tx.outputAsset);
  }

  private async getReferencePrices(txWithAssets: BuyCrypto[]): Promise<Price[]> {
    const referenceAssetPairs = [
      ...new Set(
        txWithAssets
          .filter((tx) => tx.inputReferenceAsset !== tx.outputReferenceAsset.dexName)
          .map((tx) => `${tx.inputReferenceAsset}/${tx.outputReferenceAsset.dexName}`),
      ),
    ].map((assets) => assets.split('/'));

    const prices = await Promise.all<PriceResult>(
      referenceAssetPairs.map(async (pair) => {
        const priceRequest = this.createPriceRequest(pair, txWithAssets);

        return this.pricingService.getPrice(priceRequest).catch((e) => {
          console.error('Failed to get price:', e);
          return undefined;
        });
      }),
    );

    return prices.filter((p) => p).map((p) => p.price);
  }

  private async defineReferenceAmount(transactions: BuyCrypto[], referencePrices: Price[]): Promise<BuyCrypto[]> {
    for (const tx of transactions) {
      try {
        tx.calculateOutputReferenceAmount(referencePrices);
      } catch (e) {
        console.error(`Could not calculate outputReferenceAmount for transaction ${tx.id}}`, e);
      }
    }

    return transactions.filter((tx) => tx.outputReferenceAmount);
  }

  private async createBatches(transactions: BuyCrypto[]): Promise<BuyCryptoBatch[]> {
    let batches: BuyCryptoBatch[] = [];

    batches = this.batchTransactions(transactions);
    batches = await this.filterOutExistingBatches(batches);
    batches = await this.optimizeBatches(batches);

    return batches;
  }

  private batchTransactions(transactions: BuyCrypto[]): BuyCryptoBatch[] {
    const batches = new Map<string, BuyCryptoBatch>();

    for (const tx of transactions) {
      const { outputReferenceAsset, outputAsset } = tx;

      let batch = batches.get(this.getBatchTempKey(outputReferenceAsset, outputAsset));

      if (!batch) {
        batch = this.buyCryptoBatchRepo.create({
          outputReferenceAsset,
          outputAsset,
          blockchain: outputAsset.blockchain,
          status: BuyCryptoBatchStatus.CREATED,
          transactions: [],
        });
        batches.set(this.getBatchTempKey(outputReferenceAsset, outputAsset), batch);
      }

      batch.addTransaction(tx);
    }

    return [...batches.values()];
  }

  private getBatchTempKey(outputReferenceAsset: Asset, outputAsset: Asset): string {
    const { dexName: targetDexName, blockchain, type } = outputAsset;
    const { dexName: referenceDexName } = outputReferenceAsset;

    return referenceDexName + '&' + targetDexName + '&' + blockchain + '&' + type;
  }

  private async filterOutExistingBatches(batches: BuyCryptoBatch[]): Promise<BuyCryptoBatch[]> {
    const filteredBatches: BuyCryptoBatch[] = [];

    for (const batch of batches) {
      const { outputAsset } = batch;

      const existingBatch = await this.buyCryptoBatchRepo.findOne({
        outputAsset,
        status: Not(BuyCryptoBatchStatus.COMPLETE),
      });

      if (existingBatch) {
        const txIds = batch.transactions.map((t) => t.id);

        console.info(
          `Halting with creation of a new batch for asset: ${outputAsset.dexName}, existing batch for this asset is not complete yet. Transaction ID(s): ${txIds}`,
        );

        continue;
      }

      filteredBatches.push(batch);
    }

    return filteredBatches;
  }

  private async optimizeBatches(batches: BuyCryptoBatch[]): Promise<BuyCryptoBatch[]> {
    const optimizedBatches = [];

    for (const batch of batches) {
      try {
        const liquidity = await this.checkLiquidity(batch);
        const nativePayoutFee = await this.checkPayoutFees(batch);
        const [purchaseFee, payoutFee] = await this.getFeeAmountsInBatchAsset(batch, liquidity, nativePayoutFee);

        await this.optimizeBatch(batch, liquidity, purchaseFee, payoutFee);

        optimizedBatches.push(batch);
      } catch (e) {
        console.info(`Error in optimizing new batch. Batch target asset: ${batch.outputAsset.uniqueName}.`, e.message);
      }
    }

    return optimizedBatches;
  }

  private async checkLiquidity(batch: BuyCryptoBatch): Promise<CheckLiquidityResult> {
    try {
      const request = await this.createReadonlyLiquidityRequest(batch);

      return await this.dexService.checkLiquidity(request);
    } catch (e) {
      throw new Error(
        `Error in checking liquidity for a batch. Batch target asset: ${batch.outputAsset.uniqueName}. ${e.message}`,
      );
    }
  }

  private async createReadonlyLiquidityRequest(batch: BuyCryptoBatch): Promise<CheckLiquidityRequest> {
    const { outputAsset: targetAsset, outputReferenceAsset: referenceAsset } = batch;

    return {
      context: LiquidityOrderContext.BUY_CRYPTO,
      correlationId: 'not_required_for_readonly_liquidity_request',
      referenceAsset,
      referenceAmount: batch.outputReferenceAmount,
      targetAsset,
    };
  }

  private async checkPayoutFees(batch: BuyCryptoBatch): Promise<FeeResult> {
    try {
      const request = await this.createPayoutFeeRequest(batch);

      return await this.payoutService.estimateFee(request);
    } catch (e) {
      throw new Error(`Error in checking payout fees for a batch, ID: ${batch.id}. ${e.message}`);
    }
  }

  private async createPayoutFeeRequest(batch: BuyCryptoBatch): Promise<FeeRequest> {
    return {
      asset: batch.outputAsset,
      quantityOfTransactions: batch.transactions.length,
    };
  }

  private async getFeeAmountsInBatchAsset(
    batch: BuyCryptoBatch,
    liquidity: CheckLiquidityResult,
    nativePayoutFee: FeeResult,
  ): Promise<[number, number]> {
    const { purchaseFee: nativePurchaseFee } = liquidity;

    const purchaseFeeInBatchCurrency = await this.getPurchaseFeeAmountInBatchAsset(batch, nativePurchaseFee);
    const payoutFeeInBatchCurrency = await this.getPayoutFeeAmountInBatchAsset(batch, nativePayoutFee);

    return [purchaseFeeInBatchCurrency, payoutFeeInBatchCurrency];
  }

  private async getPurchaseFeeAmountInBatchAsset(batch: BuyCryptoBatch, nativePurchaseFee: FeeResult): Promise<number> {
    const txIdStrings = batch.transactions.reduce((acc, t) => acc + `|${t.id}|`, '');
    const priceRequestCorrelationId = `BuyCryptoBatch_ConvertEstimatedPurchaseFee_${txIdStrings}`;
    const errorMessage = `Could not get price for purchase fee calculation. Ignoring fee estimate. Native fee asset: ${nativePurchaseFee.asset.dexName}, batch reference asset: ${batch.outputReferenceAsset.dexName}`;

    return this.buyCryptoPricingService.getFeeAmountInBatchAsset(
      batch,
      nativePurchaseFee,
      priceRequestCorrelationId,
      errorMessage,
    );
  }

  private async getPayoutFeeAmountInBatchAsset(batch: BuyCryptoBatch, nativePayoutFee: FeeResult): Promise<number> {
    const txIdStrings = batch.transactions.reduce((acc, t) => acc + `|${t.id}|`, '');
    const priceRequestCorrelationId = `BuyCryptoBatch_ConvertEstimatedPayoutFee_${txIdStrings}`;
    const errorMessage = `Could not get price for payout fee calculation. Ignoring fee estimate. Native fee asset: ${nativePayoutFee.asset.dexName}, batch reference asset: ${batch.outputReferenceAsset.dexName}`;

    return this.buyCryptoPricingService.getFeeAmountInBatchAsset(
      batch,
      nativePayoutFee,
      priceRequestCorrelationId,
      errorMessage,
    );
  }

  private async optimizeBatch(
    batch: BuyCryptoBatch,
    liquidity: CheckLiquidityResult,
    purchaseFee: number | null,
    payoutFee: number | null,
  ): Promise<void> {
    try {
      const inputBatchLength = batch.transactions.length;

      const {
        reference: { availableAmount, maxPurchasableAmount },
      } = liquidity;

      const [isPurchaseRequired, liquidityWarning] = batch.optimizeByLiquidity(availableAmount, maxPurchasableAmount);

      liquidityWarning && (await this.handleLiquidityWarning(batch));
      const effectivePurchaseFee = isPurchaseRequired ? purchaseFee : 0;

      batch.checkAndRecordFeesEstimations(effectivePurchaseFee, payoutFee);

      if (inputBatchLength !== batch.transactions.length) {
        console.log(
          `Optimized batch for output asset: ${batch.outputAsset.uniqueName}. ${
            inputBatchLength - batch.transactions.length
          } removed from the batch`,
        );
      }
    } catch (e) {
      if (e instanceof AbortBatchCreationException) {
        await this.handleAbortBatchCreationException(batch, liquidity, e);
      }

      if (e instanceof FeeLimitExceededException) {
        await this.handleFeeLimitExceededException(batch);
      }

      // re-throw by default to abort proceeding with batch
      throw e;
    }
  }

  private async handleLiquidityWarning(batch: BuyCryptoBatch): Promise<void> {
    try {
      const {
        outputAsset: { dexName, blockchain, type },
      } = batch;

      await this.buyCryptoNotificationService.sendMissingLiquidityWarning(dexName, blockchain, type);
    } catch (e) {
      console.error('Error in handling buy crypto batch liquidity warning', e);
    }
  }

  private async handleAbortBatchCreationException(
    batch: BuyCryptoBatch,
    liquidity: CheckLiquidityResult,
    error: AbortBatchCreationException,
  ): Promise<void> {
    try {
      const {
        target: {
          amount: targetAmount,
          availableAmount: availableTargetAmount,
          maxPurchasableAmount: maxPurchasableTargetAmount,
        },
        reference: { availableAmount: availableReferenceAmount, maxPurchasableAmount: maxPurchasableReferenceAmount },
      } = liquidity;

      const { outputReferenceAmount, outputAsset: oa, outputReferenceAsset: ora, transactions } = batch;

      const targetDeficit = Util.round(targetAmount - availableTargetAmount, 8);
      const referenceDeficit = Util.round(outputReferenceAmount - availableReferenceAmount, 8);

      const maxPurchasableTargetAmountMessage =
        maxPurchasableTargetAmount != null
          ? `Could be automatically swapped from other available swap assets: ${maxPurchasableTargetAmount}`
          : '';

      const maxPurchasableReferenceAmountMessage =
        maxPurchasableReferenceAmount != null
          ? `Could be automatically swapped from other available swap assets: ${maxPurchasableReferenceAmount}`
          : '';

      const messages = [
        `${error.message} Details:`,
        `In target asset (${oa.uniqueName}): Required amount: ${targetAmount}, available amount: ${availableTargetAmount}, deficit: ${targetDeficit}. ${maxPurchasableTargetAmountMessage}`,
        `In reference asset (${ora.uniqueName}): Required amount: ${outputReferenceAmount}, available amount: ${availableReferenceAmount}, deficit: ${referenceDeficit}. ${maxPurchasableReferenceAmountMessage}`,
      ];

      await this.buyCryptoNotificationService.sendMissingLiquidityError(
        oa.dexName,
        oa.blockchain,
        oa.type,
        transactions.map((t) => t.id),
        messages,
      );
    } catch (e) {
      console.error('Error in handling AbortBatchCreationException', e);
    }
  }

  private async handleFeeLimitExceededException(batch: BuyCryptoBatch): Promise<void> {
    for (const tx of batch.transactions) {
      tx.waitingForLowerFee();

      await this.buyCryptoRepo.save(tx);
    }
  }

  private createPriceRequest(currencyPair: string[], transactions: BuyCrypto[] = []): PriceRequest {
    const correlationId = 'BuyCryptoTransactions' + transactions.reduce((acc, t) => acc + `|${t.id}|`, '');
    return { context: PriceRequestContext.BUY_CRYPTO, correlationId, from: currencyPair[0], to: currencyPair[1] };
  }
}
