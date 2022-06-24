import { Injectable } from '@nestjs/common';
import { Not, IsNull } from 'typeorm';
import { Price } from '../../exchange/dto/price.dto';
import { ExchangeUtilityService } from '../../exchange/exchange-utility.service';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoOutService } from './buy-crypto-out.service';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';

@Injectable()
export class BuyCryptoBatchService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly buyCryptoOutService: BuyCryptoOutService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly exchangeUtilityService: ExchangeUtilityService,
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
        relations: ['bankTx', 'buy', 'buy.user', 'batch'],
      });

      if (txInput.length === 0) {
        return;
      }

      console.info(
        `New buy crypto transaction input. Processing ${txInput.length} transaction(s). Transaction ID(s):`,
        txInput.map((t) => t.id),
      );

      const txWithAssets = await this.defineAssetPair(txInput);
      const referencePrices = await this.getReferencePrices(txWithAssets);
      const txWithReferenceAmount = await this.defineReferenceAmount(txWithAssets, referencePrices);
      const blockedAssets = await this.buyCryptoOutService.getAssetsOnOutNode();
      const batches = await this.batchTransactions(txWithReferenceAmount, blockedAssets);

      for (const batch of batches) {
        const savedBatch = await this.buyCryptoBatchRepo.save(batch);
        console.info(`Created buy crypto batch. Batch ID: ${savedBatch.id}. Asset: ${savedBatch.outputAsset}`);
      }
    } catch (e) {
      console.error(e);
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
      const outputAsset = tx.buy?.asset?.dexName;
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

      const existingBatch = await this.buyCryptoBatchRepo.findOne({
        outputAsset: tx.outputAsset,
        status: Not(BuyCryptoBatchStatus.COMPLETE),
      });

      if (existingBatch) {
        console.info(`Halting with creation of a batch for asset: ${outputAsset}, batch already exists`);

        // ???
        break;
      }

      if (blockedAssets.find((a) => a.asset === outputAsset)) {
        const errorMessage = `Halting with creation of a batch for asset: ${outputAsset}, balance still available on OUT node`;

        console.warn(errorMessage);
        this.buyCryptoNotificationService.sendNonRecoverableErrorMail(errorMessage);

        // ???
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

      batch.addTransaction(tx);
    }

    return [...batches.values()];
  }
}
