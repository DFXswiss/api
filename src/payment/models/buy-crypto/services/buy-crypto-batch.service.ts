import { Injectable } from '@nestjs/common';
import { Not, IsNull } from 'typeorm';
import { Price } from '../../exchange/dto/price.dto';
import { ExchangeUtilityService } from '../../exchange/exchange-utility.service';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoOutService } from './buy-crypto-out.service';

@Injectable()
export class BuyCryptoBatchService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly buyCryptoOutService: BuyCryptoOutService,
    private readonly exchangeUtilityService: ExchangeUtilityService,
  ) {}

  async batchTransactionsByAssets(): Promise<void> {
    const txInput = await this.buyCryptoRepo.find({
      where: {
        inputReferenceAmountMinusFee: Not(IsNull()),
        outputReferenceAsset: IsNull(),
        outputReferenceAmount: IsNull(),
        outputAsset: IsNull(),
        batch: IsNull(),
      },
      relations: ['bankTx', 'buy', 'buy.user', 'batch'],
    });

    console.log('batchTransactionsByAssets Input Transactions', txInput);

    try {
      console.log('batchTransactionsByAssets Input Transactions DETAILS', txInput[0].buy.user, txInput[0].buy.asset);
    } catch {}

    if (txInput.length === 0) {
      return;
    }

    const txWithAssets = await this.defineAssetPair(txInput);
    const referencePrices = await this.getReferencePrices(txWithAssets);
    const txWithReferenceAmount = await this.defineReferenceAmount(txWithAssets, referencePrices);
    const blockedAssets = await this.buyCryptoOutService.getAssetsOnOutNode();
    const batches = await this.batchTransactions(txWithReferenceAmount, blockedAssets);

    console.log('batchTransactionsByAssets batches', batches);

    for (const batch of batches) {
      // in case of interim DB failure - will safely start over
      await this.buyCryptoBatchRepo.save(batch);
    }
  }

  private async getReferencePrices(txWithAssets: BuyCrypto[]): Promise<Map<string, Price>> {
    const result = new Map<string, Price>();
    const referenceAssets = [...new Set(txWithAssets.map((tx) => tx.outputReferenceAsset))];
    console.log('Getting matching prices');
    await Promise.all(
      referenceAssets.map(async (asset) => await this.exchangeUtilityService.getMatchingPrice('EUR', asset)),
    ).then((prices) => prices.forEach((price, i) => result.set(referenceAssets[i], price)));

    console.log('Got matching prices', result);
    return result;
  }

  private async defineAssetPair(transactions: BuyCrypto[]): Promise<BuyCrypto[]> {
    for (const tx of transactions) {
      const outputAsset = tx.buy?.asset?.dexName;
      tx.defineAssetExchangePair(outputAsset);
    }

    console.log('Defined asset pair', transactions);

    return transactions;
  }

  private async defineReferenceAmount(
    transactions: BuyCrypto[],
    referencePrices: Map<string, Price>,
  ): Promise<BuyCrypto[]> {
    for (const tx of transactions) {
      const { outputReferenceAsset } = tx;

      const referenceAssetPrice = referencePrices.get(outputReferenceAsset);

      console.log('referenceAssetPrice', referenceAssetPrice);

      tx.calculateOutputReferenceAmount(referenceAssetPrice);
    }

    console.log('Defined reference amount', transactions);

    return transactions;
  }

  private async batchTransactions(
    transactions: BuyCrypto[],
    blockedAssets: { amount: number; asset: string }[],
  ): Promise<BuyCryptoBatch[]> {
    console.log('Creating batches');
    const batches = new Map<string, BuyCryptoBatch>();

    for (const tx of transactions) {
      const { outputReferenceAsset, outputAsset } = tx;

      // not allowing to create a batch for an asset that still exists on OUT node
      if (blockedAssets.find((a) => a.asset === outputAsset)) {
        console.warn(`Halting with creation of a batch for asset: ${outputAsset}, balance still available on OUT node`);
        break;
      }

      const existingBatch = await this.buyCryptoBatchRepo.findOne({ outputAsset: tx.outputAsset });

      if (existingBatch) {
        console.warn(`Halting with creation of a batch for asset: ${outputAsset}, batch already exists`);
        break;
      }

      let batch = batches.get(outputReferenceAsset + '&' + outputAsset);

      if (!batch) {
        batch = this.buyCryptoBatchRepo.create({
          outputReferenceAsset,
          outputAsset,
          status: BuyCryptoBatchStatus.CREATED,
        });
        batches.set(outputReferenceAsset + '&' + outputAsset, batch);
      }

      console.log('First batch', batch);

      batch.addTransaction(tx);
    }

    console.log('All Batches output', [...batches.values()]);

    return [...batches.values()];
  }

  private async saveBatch(batch: BuyCryptoBatch): Promise<BuyCryptoBatch> {
    const updatedBatch = await this.buyCryptoBatchRepo.save(batch);
    for (const tx of batch.transactions) {
      await this.buyCryptoRepo.save(tx);
      // in case of interim DB failure - will safely start over
    }

    return updatedBatch;
  }
}
