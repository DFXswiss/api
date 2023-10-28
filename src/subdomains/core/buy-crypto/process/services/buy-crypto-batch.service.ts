import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LiquidityManagementRuleStatus } from 'src/subdomains/core/liquidity-management/enums';
import { LiquidityManagementService } from 'src/subdomains/core/liquidity-management/services/liquidity-management.service';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { CheckLiquidityRequest, CheckLiquidityResult } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PriceRequestContext } from 'src/subdomains/supporting/pricing/domain/enums';
import { PriceMismatchException } from 'src/subdomains/supporting/pricing/domain/exceptions/price-mismatch.exception';
import { PriceRequest, PriceResult } from 'src/subdomains/supporting/pricing/domain/interfaces';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { In, IsNull, Not } from 'typeorm';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { BuyCryptoFee } from '../entities/buy-crypto-fees.entity';
import { BuyCrypto, BuyCryptoStatus } from '../entities/buy-crypto.entity';
import { MissingBuyCryptoLiquidityException } from '../exceptions/abort-batch-creation.exception';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { BuyCryptoPricingService } from './buy-crypto-pricing.service';
import { BuyCryptoWebhookService } from './buy-crypto-webhook.service';

@Injectable()
export class BuyCryptoBatchService {
  private readonly logger = new DfxLogger(BuyCryptoBatchService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly pricingService: PricingService,
    private readonly buyCryptoPricingService: BuyCryptoPricingService,
    private readonly assetService: AssetService,
    private readonly dexService: DexService,
    private readonly payoutService: PayoutService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly liquidityService: LiquidityManagementService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
  ) {}

  async prepareTransactions(): Promise<void> {
    try {
      const txInput = await this.buyCryptoRepo.find({
        where: {
          inputReferenceAmountMinusFee: Not(IsNull()),
          outputReferenceAsset: IsNull(),
          outputAsset: IsNull(),
          batch: IsNull(),
        },
        relations: [
          'bankTx',
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

  async batchAndOptimizeTransactions(): Promise<void> {
    try {
      const txWithAssets = await this.buyCryptoRepo.find({
        where: {
          outputReferenceAsset: Not(IsNull()),
          outputAsset: Not(IsNull()),
          outputReferenceAmount: IsNull(),
          batch: IsNull(),
          status: In([
            BuyCryptoStatus.PREPARED,
            BuyCryptoStatus.WAITING_FOR_LOWER_FEE,
            BuyCryptoStatus.PRICE_MISMATCH,
            BuyCryptoStatus.MISSING_LIQUIDITY,
          ]),
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
          'fee',
        ],
      });

      if (txWithAssets.length === 0) return;

      this.logger.verbose(
        `Batching ${txWithAssets.length} buy-crypto transaction(s). Transaction ID(s): ${txWithAssets.map(
          (t) => t.id,
        )}`,
      );

      const referencePrices = await this.getReferencePrices(txWithAssets);
      const txWithReferenceAmount = await this.defineReferenceAmount(txWithAssets, referencePrices);
      const batches = await this.createBatches(txWithReferenceAmount);

      for (const batch of batches) {
        const savedBatch = await this.buyCryptoBatchRepo.save(batch);
        this.logger.verbose(
          `Created buy-crypto batch. Batch ID: ${savedBatch.id}. Asset: ${savedBatch.outputAsset.uniqueName}. Transaction(s) count ${batch.transactions.length}`,
        );
      }
    } catch (e) {
      this.logger.error('Error during buy-crypto batching:', e);
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

  private async getReferencePrices(txWithAssets: BuyCrypto[]): Promise<Price[]> {
    try {
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
            this.logger.error('Failed to get price:', e);
            return undefined;
          });
        }),
      );

      return prices.filter((p) => p).map((p) => p.price);
    } catch (e) {
      if (e instanceof PriceMismatchException) {
        await this.setPriceMismatchStatus(txWithAssets);
      }

      throw e;
    }
  }

  private async defineReferenceAmount(transactions: BuyCrypto[], referencePrices: Price[]): Promise<BuyCrypto[]> {
    for (const tx of transactions) {
      try {
        tx.calculateOutputReferenceAmount(referencePrices);
      } catch (e) {
        this.logger.error(`Could not calculate outputReferenceAmount for transaction ${tx.id}:`, e);
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

      const existingBatch = await this.buyCryptoBatchRepo.findOneBy({
        outputAsset: { id: outputAsset.id },
        status: Not(BuyCryptoBatchStatus.COMPLETE),
      });
      const newBatch = filteredBatches.find((b) => b.outputAsset.id === outputAsset.id);

      if (existingBatch || newBatch) {
        const txIds = batch.transactions.map((t) => t.id);

        this.logger.verbose(
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
        const inputBatchLength = batch.transactions.length;

        await this.optimizeByPayoutFee(batch);
        const purchaseFee = await this.optimizeByLiquidity(batch);
        await this.optimizeByPurchaseFee(batch, purchaseFee);

        if (inputBatchLength !== batch.transactions.length) {
          this.logger.verbose(
            `Optimized batch for output asset ${batch.outputAsset.uniqueName}. ${
              inputBatchLength - batch.transactions.length
            } removed from the batch`,
          );
        }

        optimizedBatches.push(batch);
      } catch (e) {
        this.logger.warn(`Error in optimizing new batch for ${batch.outputAsset.uniqueName}:`, e);
      }
    }

    return optimizedBatches;
  }

  // --- PAYOUT FEE OPTIMIZING --- //
  private async optimizeByPayoutFee(batch: BuyCryptoBatch) {
    // add fee estimation
    for (const tx of batch.transactions) {
      const payoutFee = await this.getPayoutFee(tx);
      await this.buyCryptoRepo.updateFee(...tx.fee.addPayoutFeeEstimation(payoutFee, tx));
    }

    // optimize
    const filteredOutTransactions = batch.optimizeByPayoutFeeEstimation();
    await this.setWaitingForLowerFeeStatus(filteredOutTransactions);

    if (batch.transactions.length === 0) {
      throw new FeeLimitExceededException(
        `Cannot re-batch transactions by payout fee, no transaction exceeds the fee limit. Out asset: ${batch.outputAsset.uniqueName}`,
      );
    }
  }

  private async getPayoutFee(tx: BuyCrypto): Promise<number> {
    const nativePayoutFee = await this.payoutService.estimateFee(
      tx.outputAsset,
      tx.target.address,
      tx.outputReferenceAmount,
      tx.outputReferenceAsset,
    );

    return this.buyCryptoPricingService.getFeeAmountInRefAsset(tx.outputReferenceAsset, nativePayoutFee);
  }

  // ---- LIQUIDITY OPTIMIZING --- //

  private async optimizeByLiquidity(batch: BuyCryptoBatch): Promise<FeeResult> {
    const liquidity = await this.checkLiquidity(batch);

    try {
      const {
        purchaseFee,
        reference: { availableAmount, maxPurchasableAmount },
      } = liquidity;

      const isPurchaseRequired = batch.optimizeByLiquidity(availableAmount, maxPurchasableAmount);

      return isPurchaseRequired ? purchaseFee : { amount: 0, asset: purchaseFee.asset };
    } catch (e) {
      if (e instanceof MissingBuyCryptoLiquidityException) {
        await this.handleMissingBuyCryptoLiquidityException(batch, liquidity, e);
      }

      // re-throw by default to abort proceeding with batch
      throw e;
    }
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

  private async handleMissingBuyCryptoLiquidityException(
    batch: BuyCryptoBatch,
    liquidity: CheckLiquidityResult,
    error: MissingBuyCryptoLiquidityException,
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

      await this.setMissingLiquidityStatus(transactions);

      const targetDeficit = Util.round(targetAmount - availableTargetAmount, 8);
      const referenceDeficit = Util.round(outputReferenceAmount - availableReferenceAmount, 8);

      // order liquidity
      try {
        const asset = oa.dexName === 'DFI' ? await this.assetService.getDfiToken() : oa;
        const orderId = await this.liquidityService.buyLiquidity(asset.id, targetDeficit, true);
        this.logger.info(`Missing buy-crypto liquidity. Liquidity management order created: ${orderId}`);
      } catch (e) {
        this.logger.info(`Failed to order missing liquidity for asset ${oa.uniqueName}:`, e);

        // send missing liquidity message
        if (!e.message?.includes(LiquidityManagementRuleStatus.PROCESSING)) {
          const maxPurchasableTargetAmountMessage =
            maxPurchasableTargetAmount != null ? `, purchasable: ${maxPurchasableTargetAmount}` : '';

          const maxPurchasableReferenceAmountMessage =
            maxPurchasableReferenceAmount != null ? `, purchasable: ${maxPurchasableReferenceAmount}` : '';

          const messages = [
            `${error.message} Details:`,
            `Target: ${targetDeficit} ${oa.uniqueName} (required ${targetAmount}, available: ${availableTargetAmount}${maxPurchasableTargetAmountMessage})`,
            `Reference: ${referenceDeficit} ${ora.uniqueName} (required ${outputReferenceAmount}, available: ${availableReferenceAmount}${maxPurchasableReferenceAmountMessage})`,
            `Liquidity management order failed: ${e.message}`,
          ];

          await this.buyCryptoNotificationService.sendMissingLiquidityError(
            oa.dexName,
            oa.blockchain,
            oa.type,
            transactions.map((t) => t.id),
            messages,
          );
        }
      }
    } catch (e) {
      this.logger.error('Error in handling MissingBuyCryptoLiquidityException:', e);
    }
  }

  // --- PURCHASE FEE OPTIMIZATION -- ///
  private async optimizeByPurchaseFee(batch: BuyCryptoBatch, nativePurchaseFee: FeeResult) {
    try {
      const purchaseFee = await this.buyCryptoPricingService.getFeeAmountInRefAsset(
        batch.outputReferenceAsset,
        nativePurchaseFee,
      );

      batch.checkByPurchaseFeeEstimation(purchaseFee);
    } catch (e) {
      if (e instanceof FeeLimitExceededException) {
        await this.setWaitingForLowerFeeStatus(batch.transactions);
      }

      // re-throw by default to abort proceeding with batch
      throw e;
    }
  }

  // --- HELPER METHODS --- //
  private async setWaitingForLowerFeeStatus(transactions: BuyCrypto[]): Promise<void> {
    for (const tx of transactions) {
      await this.buyCryptoRepo.update(...tx.waitingForLowerFee());
    }
  }

  private async setPriceMismatchStatus(transactions: BuyCrypto[]): Promise<void> {
    for (const tx of transactions) {
      await this.buyCryptoRepo.update(...tx.setPriceMismatchStatus());
    }
  }

  private async setMissingLiquidityStatus(transactions: BuyCrypto[]): Promise<void> {
    for (const tx of transactions) {
      await this.buyCryptoRepo.update(...tx.setMissingLiquidityStatus());
    }
  }

  private createPriceRequest(currencyPair: string[], transactions: BuyCrypto[] = []): PriceRequest {
    const correlationId = 'BuyCryptoTransactions' + transactions.reduce((acc, t) => acc + `|${t.id}|`, '');
    return { context: PriceRequestContext.BUY_CRYPTO, correlationId, from: currencyPair[0], to: currencyPair[1] };
  }
}
