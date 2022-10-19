import { Injectable } from '@nestjs/common';
import { Not, IsNull } from 'typeorm';
import { Price } from '../../exchange/dto/price.dto';
import { PricingService } from '../../pricing/services/pricing.service';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { PriceRequest, PriceResult } from '../../pricing/interfaces';
import { PriceRequestContext } from '../../pricing/enums';
import { LiquidityRequest, LiquidityResponse } from '../../dex/interfaces';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityOrderContext } from '../../dex/entities/liquidity-order.entity';
import { DexService } from '../../dex/services/dex.service';
import { PayoutService } from '../../payout/services/payout.service';
import { AbortBatchCreationException } from '../exceptions/abort-batch-creation.exception';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { FeeRequest, FeeResponse } from '../../payout/interfaces';

@Injectable()
export class BuyCryptoBatchService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly pricingService: PricingService,
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
          `Created buy crypto batch. Batch ID: ${savedBatch.id}. Asset: ${savedBatch.outputAsset}. Transaction(s) count ${batch.transactions.length}`,
        );
      }
    } catch (e) {
      console.error(e);
    }
  }

  private async defineAssetPair(transactions: BuyCrypto[]): Promise<BuyCrypto[]> {
    for (const tx of transactions) {
      tx.defineAssetExchangePair();
    }

    return transactions.filter((tx) => tx.outputAsset);
  }

  private async getReferencePrices(txWithAssets: BuyCrypto[]): Promise<Price[]> {
    const referenceAssetPairs = [
      ...new Set(
        txWithAssets
          .filter((tx) => tx.inputReferenceAsset !== tx.outputReferenceAsset)
          .map((tx) => `${tx.inputReferenceAsset}/${tx.outputReferenceAsset}`),
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
    batches = await this.validateBatches(batches);

    return batches;
  }

  private batchTransactions(transactions: BuyCrypto[]): BuyCryptoBatch[] {
    const batches = new Map<string, BuyCryptoBatch>();

    for (const tx of transactions) {
      const { outputReferenceAsset, outputAsset, target } = tx;

      let batch = batches.get(
        outputReferenceAsset + '&' + outputAsset + '&' + target.asset.blockchain + '&' + target.asset.type,
      );

      if (!batch) {
        batch = this.buyCryptoBatchRepo.create({
          outputReferenceAsset,
          outputAsset,
          blockchain: target.asset.blockchain,
          status: BuyCryptoBatchStatus.CREATED,
          transactions: [],
        });
        batches.set(outputReferenceAsset + '&' + outputAsset + '&' + target.asset.blockchain, batch);
      }

      batch.addTransaction(tx);
    }

    return [...batches.values()];
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
          `Halting with creation of a new batch for asset: ${outputAsset}, existing batch for this asset is not complete yet. Transaction ID(s): ${txIds}`,
        );

        continue;
      }

      filteredBatches.push(batch);
    }

    return filteredBatches;
  }

  private async validateBatches(batches: BuyCryptoBatch[]): Promise<BuyCryptoBatch[]> {
    batches = await this.reBatchGivenLiquidityEstimation(batches);
    batches = await this.reBatchGivenFeesEstimation(batches);

    return batches;
  }

  private async reBatchGivenLiquidityEstimation(batches: BuyCryptoBatch[]): Promise<BuyCryptoBatch[]> {
    const optimizedBatches = [];

    for (const batch of batches) {
      try {
        const { reference } = await this.checkLiquidity(batch);

        batch.optimizeByLiquidity(reference.availableAmount, reference.maxPurchasableAmount);

        optimizedBatches.push(batch);
      } catch (e) {
        if (e instanceof AbortBatchCreationException) {
          await this.handleAbortBatchCreationException(batch, e);
        }

        console.info(`Error in optimizing new batch. Batch target asset: ${batch.outputAsset}.`, e.message);
      }
    }

    return optimizedBatches;
  }

  private async checkLiquidity(batch: BuyCryptoBatch): Promise<LiquidityResponse> {
    try {
      const request = await this.createLiquidityRequest(batch);

      return await this.dexService.checkLiquidity(request);
    } catch (e) {
      throw new Error(`Error in checking liquidity for a batch, ID: ${batch.id}. ${e.message}`);
    }
  }

  private async createLiquidityRequest(batch: BuyCryptoBatch): Promise<LiquidityRequest> {
    const { outputAsset, blockchain } = batch;
    const targetAsset = await this.assetService.getAssetByQuery({ dexName: outputAsset, blockchain });

    return {
      context: LiquidityOrderContext.BUY_CRYPTO,
      correlationId: batch.id.toString(),
      referenceAsset: batch.outputReferenceAsset,
      referenceAmount: batch.outputReferenceAmount,
      targetAsset,
      options: {
        bypassSlippageProtection: true,
      },
    };
  }

  private async handleAbortBatchCreationException(
    batch: BuyCryptoBatch,
    error: AbortBatchCreationException,
  ): Promise<void> {
    try {
      const { outputAsset } = batch;
      const { blockchain, type } = batch.transactions[0]?.target?.asset; // TODO - remove when outputAsset changed to Asset on BuyCryptoBatch

      await this.buyCryptoNotificationService.sendMissingLiquidityError(outputAsset, blockchain, type, error.message);
    } catch (e) {
      console.error('Error in handling AbortBatchCreationException', e);
    }
  }

  private async reBatchGivenFeesEstimation(batches: BuyCryptoBatch[]): Promise<BuyCryptoBatch[]> {
    // !!! filter out small transactions where fee % is too high and reslice the batch again.
    // estimate fees here?
    // purchase fees and payout fees

    const optimizedBatches = [];

    for (const batch of batches) {
      try {
        const payoutFees = await this.checkFee(batch);

        batch.optimizeByFees(payoutFees);

        optimizedBatches.push(batch);
      } catch (e) {
        console.info(`Error in optimizing new batch. Batch target asset: ${batch.outputAsset}.`, e.message);
      }
    }

    return optimizedBatches;
  }

  private async checkFee(batch: BuyCryptoBatch): Promise<FeeResponse> {
    try {
      const request = await this.createFeeRequest(batch);

      return await this.payoutService.estimateFee(request);
    } catch (e) {
      throw new Error(`Error in checking liquidity for a batch, ID: ${batch.id}. ${e.message}`);
    }
  }

  private async createFeeRequest(batch: BuyCryptoBatch): Promise<FeeRequest> {
    const { outputAsset, blockchain } = batch;
    const targetAsset = await this.assetService.getAssetByQuery({ dexName: outputAsset, blockchain });

    return {
      asset: targetAsset,
      quantityOfTransactions: batch.transactions.length,
    };
  }

  private createPriceRequest(currencyPair: string[], transactions: BuyCrypto[] = []): PriceRequest {
    const correlationId = 'BuyCryptoTransactions' + transactions.reduce((acc, t) => acc + `|${t.id}|`, '');
    return { context: PriceRequestContext.BUY_CRYPTO, correlationId, from: currencyPair[0], to: currencyPair[1] };
  }
}
