import { Injectable } from '@nestjs/common';
import { NodeService } from 'src/blockchain/ain/node/node.service';
import { In } from 'typeorm';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatchStatus, BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { DexService } from '../../dex/services/dex.service';
import { LiquidityOrderContext } from '../../dex/entities/liquidity-order.entity';
import { PayoutService } from '../../payout/services/payout.service';
import { PayoutOrderContext } from '../../payout/entities/payout-order.entity';
import { DuplicatedEntryException } from '../../payout/exceptions/duplicated-entry.exception';
import { PayoutRequest } from '../../payout/interfaces';
import { BuyCryptoPricingService } from './buy-crypto-pricing.service';

@Injectable()
export class BuyCryptoOutService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly buyCryptoPricingService: BuyCryptoPricingService,
    private readonly dexService: DexService,
    private readonly payoutService: PayoutService,
    readonly nodeService: NodeService,
  ) {}

  async payoutTransactions(): Promise<void> {
    try {
      const batches = await this.fetchBatchesForPayout();

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

        // TODO - refactor process so not rely on DuplicatedEntryException when retrying half-successful batch
        if (!(batch.status === BuyCryptoBatchStatus.SECURED || batch.status === BuyCryptoBatchStatus.PAYING_OUT)) {
          continue;
        }

        batch.payingOut();
        await this.buyCryptoBatchRepo.save(batch);

        const successfulRequests = [];

        for (const transaction of batch.transactions) {
          try {
            await this.doPayout(transaction);
            successfulRequests.push(transaction);
          } catch (e) {
            if (e instanceof DuplicatedEntryException) {
              continue;
            }

            console.error(`Failed to initiate buy-crypto payout. Transaction ID: ${transaction.id}`);
            // continue with next transaction in case payout initiation failed
            continue;
          }
        }

        this.logTransactionsPayouts(successfulRequests);
      }
    } catch (e) {
      console.error(e);
    }
  }

  //*** HELPER METHODS ***//

  private async fetchBatchesForPayout(): Promise<BuyCryptoBatch[]> {
    return this.buyCryptoBatchRepo.find({
      where: {
        // PAYING_OUT batches are fetch for retry in case of failure in previous iteration
        status: In([BuyCryptoBatchStatus.SECURED, BuyCryptoBatchStatus.PAYING_OUT]),
      },
      relations: [
        'transactions',
        'transactions.buy',
        'transactions.buy.user',
        'transactions.buy.asset',
        'transactions.cryptoRoute',
        'transactions.cryptoRoute.user',
        'transactions.cryptoRoute.asset',
      ],
    });
  }

  private async doPayout(transaction: BuyCrypto): Promise<void> {
    const request: PayoutRequest = {
      context: PayoutOrderContext.BUY_CRYPTO,
      correlationId: transaction.id.toString(),
      asset: transaction.outputAsset,
      amount: transaction.outputAmount,
      destinationAddress: transaction.target.address,
    };

    await this.payoutService.doPayout(request);
  }

  private async checkCompletion(batch: BuyCryptoBatch) {
    for (const tx of batch.transactions) {
      if (tx.isComplete) {
        continue;
      }

      try {
        const {
          isComplete,
          payoutTxId,
          payoutFee: nativePayoutFee,
        } = await this.payoutService.checkOrderCompletion(PayoutOrderContext.BUY_CRYPTO, tx.id.toString());

        if (isComplete) {
          const payoutFee = await this.buyCryptoPricingService.convertToTargetAsset(
            batch,
            nativePayoutFee.asset,
            nativePayoutFee.amount,
            batch.outputReferenceAsset,
            'ConvertActualPayoutFee',
          );

          tx.complete(payoutTxId, payoutFee);
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
