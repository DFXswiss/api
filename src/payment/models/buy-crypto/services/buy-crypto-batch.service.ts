import { Injectable } from '@nestjs/common';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Not, IsNull } from 'typeorm';
import { Price } from '../../exchange/dto/price.dto';
import { ExchangeUtilityService } from '../../exchange/exchange-utility.service';
import { BuyCryptoBatchRepository } from '../buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../buy-crypto.repository';
import { BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoOutService } from './buy-crypto-out.service';

@Injectable()
export class BuyCryptoBatchService {
  private outClient: NodeClient;

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly buyCryptoOutService: BuyCryptoOutService,
    private readonly exchangeUtilityService: ExchangeUtilityService,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.OUTPUT).subscribe((client) => (this.outClient = client));
  }

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

    if (txInput.length === 0) {
      return;
    }

    const txWithAssets = await this.defineAssetPair(txInput);
    const referencePrices = await this.getReferencePrices(txWithAssets);
    const txWithReferenceAmount = await this.defineReferenceAmount(txWithAssets, referencePrices);
    const blockedAssets = await this.buyCryptoOutService.getAssetsOnOutNode();
    const batches = await this.batchTransactions(txWithReferenceAmount, blockedAssets);

    for (const batch of batches) {
      // in case of interim DB failure - will safely start over
      await this.buyCryptoBatchRepo.save(batch);
    }
  }

  private async getReferencePrices(txWithAssets: BuyCrypto[]): Promise<Map<string, Price>> {
    const result = new Map<string, Price>();
    const referenceAssets = [...new Set(txWithAssets.map((tx) => tx.outputReferenceAsset))];

    await Promise.all(
      referenceAssets.map(async (asset) => await this.exchangeUtilityService.getMatchingPrice('EUR', asset)),
    ).then((prices) => prices.forEach((price, i) => result.set(referenceAssets[i], price)));

    return result;
  }

  private async defineAssetPair(transactions: BuyCrypto[]): Promise<BuyCrypto[]> {
    for (const tx of transactions) {
      const outputAsset = tx.buy?.asset?.name;
      tx.defineAssetExchangePair(outputAsset);
    }

    return transactions;
  }

  private async defineReferenceAmount(
    transactions: BuyCrypto[],
    referencePrices: Map<string, Price>,
  ): Promise<BuyCrypto[]> {
    for (const tx of transactions) {
      const { outputReferenceAsset } = tx;

      const referenceAssetPrice = referencePrices.get(outputReferenceAsset);

      tx.calculateOutputReferenceAmount(referenceAssetPrice);
    }

    return transactions;
  }

  private async batchTransactions(
    transactions: BuyCrypto[],
    blockedAssets: { amount: number; asset: string }[],
  ): Promise<BuyCryptoBatch[]> {
    const batches = new Map<string, BuyCryptoBatch>();

    for (const tx of transactions) {
      const { outputReferenceAsset, outputAsset } = tx;

      // not allowing to create a batch for an asset that still exists on OUT node
      if (blockedAssets.find((a) => a.asset === outputAsset)) {
        console.warn(`Halting with creation of a batch for asset: ${outputAsset}, balance still available on OUT node`);
        return;
      }

      const existingBatch = this.buyCryptoBatchRepo.find({ outputAsset: tx.outputAsset });

      if (existingBatch) {
        console.warn(`Halting with creation of a batch for asset: ${outputAsset}, batch already exists`);
        return;
      }

      let batch = batches.get(outputReferenceAsset + '&' + outputAsset);

      if (!batch) {
        batch = this.buyCryptoBatchRepo.create({ outputReferenceAsset, outputAsset });
        batches.set(outputReferenceAsset + '&' + outputAsset, batch);
      }

      batch.addTransaction(tx);
    }

    return [...batches.values()];
  }
}
