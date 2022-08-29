import { Injectable } from '@nestjs/common';
import { Not, IsNull } from 'typeorm';
import { Price } from '../../exchange/dto/price.dto';
import { PricingService } from '../../pricing/services/pricing.service';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';

@Injectable()
export class BuyCryptoBatchService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly exchangeUtilityService: PricingService,
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
        relations: ['bankTx', 'buy', 'buy.user', 'buy.asset', 'batch', 'cryptoRoute', 'cryptoRoute.user'],
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
      const batches = await this.batchTransactions(txWithReferenceAmount);

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

    const prices = await Promise.all(
      referenceAssetPairs.map(
        async (pair) =>
          await this.exchangeUtilityService.getMatchingPrice(pair[0], pair[1]).catch((e) => {
            console.error('Failed to get price:', e);
            return undefined;
          }),
      ),
    );

    return prices.filter((p) => p);
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

  private async batchTransactions(transactions: BuyCrypto[]): Promise<BuyCryptoBatch[]> {
    const batches = new Map<string, BuyCryptoBatch>();

    for (const tx of transactions) {
      const { outputReferenceAsset, outputAsset, buy } = tx;

      const existingBatch = await this.buyCryptoBatchRepo.findOne({
        outputAsset: tx.outputAsset,
        status: Not(BuyCryptoBatchStatus.COMPLETE),
      });

      if (existingBatch) {
        console.info(
          `Halting with creation of a new batch for asset: ${outputAsset}, existing batch for this asset is not complete yet. Transaction ID: ${tx.id}`,
        );

        continue;
      }

      let batch = batches.get(outputReferenceAsset + '&' + outputAsset + '&' + tx.buy.asset.blockchain);

      if (!batch) {
        batch = this.buyCryptoBatchRepo.create({
          outputReferenceAsset,
          outputAsset,
          blockchain: buy.asset.blockchain,
          status: BuyCryptoBatchStatus.CREATED,
          transactions: [],
        });
        batches.set(outputReferenceAsset + '&' + outputAsset + '&' + tx.buy.asset.blockchain, batch);
      }

      batch.addTransaction(tx);
    }

    return [...batches.values()];
  }
}
