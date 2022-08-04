import { Injectable } from '@nestjs/common';
import { NodeService } from 'src/ain/node/node.service';
import { In } from 'typeorm';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatchStatus, BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { DexService } from '../../dex/services/dex.service';
import { LiquidityOrderContext } from '../../dex/entities/liquidity-order.entity';
import { PayoutRequest, PayoutService } from '../../payout/services/payout.service';
import { PayoutOrderContext } from '../../payout/entities/payout-order.entity';
import { DuplicatedEntryException } from '../../payout/exceptions/duplicated-entry.exception';

@Injectable()
export class BuyCryptoOutService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly dexService: DexService,
    private readonly payoutService: PayoutService,
    readonly nodeService: NodeService,
  ) {}

  async payoutTransactions(): Promise<void> {
    try {
      const batches = await this.buyCryptoBatchRepo.find({
        where: {
          // PAYING_OUT batches are fetch for retry in case of failure in previous iteration
          status: In([BuyCryptoBatchStatus.SECURED, BuyCryptoBatchStatus.PAYING_OUT]),
        },
        relations: [
          'transactions',
          'transactions.buy',
          'transactions.buy.user',
          'transactions.cryptoRoute',
          'transactions.cryptoRoute.user',
        ],
      });

      if (batches.length === 0) {
        return;
      }

      for (const batch of batches) {
        try {
          await this.checkCompletion(batch);
        } catch (e) {
          console.error(`Error on checking pervious payout for a batch ID: ${batch.id}`, e);
          continue;
        }

        if (!(batch.status === BuyCryptoBatchStatus.SECURED || batch.status === BuyCryptoBatchStatus.PAYING_OUT)) {
          continue;
        }

        batch.payingOut();
        await this.buyCryptoBatchRepo.save(batch);

        const successfulRequests = [];

        for (const transaction of batch.transactions) {
          try {
            const request: PayoutRequest = {
              context: PayoutOrderContext.BUY_CRYPTO,
              correlationId: transaction.id.toString(),
              asset: transaction.outputAsset,
              amount: transaction.outputAmount,
              destinationAddress: transaction.target.address,
            };

            await this.payoutService.doPayout(request);
            successfulRequests.push(transaction);
          } catch (e) {
            if (e instanceof DuplicatedEntryException) {
              continue;
            }

            console.error(`Failed to initiate buy-crypto payout. Transaction ID: ${transaction.id}`);
            // continue with next group in case payout failed
            continue;
          }
        }

        this.logTransactionsPayouts(successfulRequests);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async checkCompletion(batch: BuyCryptoBatch) {
    for (const tx of batch.transactions) {
      if (tx.isComplete) {
        continue;
      }

      try {
        const { isComplete, payoutTxId } = await this.payoutService.checkOrderCompletion(
          PayoutOrderContext.BUY_CRYPTO,
          tx.id.toString(),
        );

        if (isComplete) {
          tx.complete(payoutTxId);
          await this.buyCryptoRepo.save(tx);
        }
      } catch (e) {
        console.error(`Error on validating transaction completion. ID: ${tx.id}.`, e);
        continue;
      }
    }

    const isBatchComplete = batch.transactions.every((tx) => tx.isComplete);

    if (isBatchComplete) {
      console.info(`Buy crypto batch payout complete. Batch ID: ${batch.id}`);
      batch.complete();

      await this.buyCryptoBatchRepo.save(batch);
      await this.dexService.completeOrders(LiquidityOrderContext.BUY_CRYPTO, batch.id.toString());
    }
  }

  //*** LOGS ***//

  private logTransactionsPayouts(transactions: BuyCrypto[]): void {
    const transactionsLogs = transactions.map((tx) => tx.id);

    transactions.length &&
      console.info(`Paying out ${transactionsLogs.length} transaction(s). Transaction ID(s):`, transactionsLogs);
  }
}
