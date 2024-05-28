import { Injectable } from '@nestjs/common';
import { Transaction, TransactionStatus } from 'src/integration/sift/dto/sift.dto';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PayoutOrderContext } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { PayoutRequest } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { In } from 'typeorm';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto, BuyCryptoStatus } from '../entities/buy-crypto.entity';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoPricingService } from './buy-crypto-pricing.service';
import { BuyCryptoWebhookService } from './buy-crypto-webhook.service';

@Injectable()
export class BuyCryptoOutService {
  private readonly logger = new DfxLogger(BuyCryptoOutService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly buyCryptoPricingService: BuyCryptoPricingService,
    private readonly dexService: DexService,
    private readonly payoutService: PayoutService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly siftService: SiftService,
  ) {}

  async payoutTransactions(): Promise<void> {
    try {
      const batches = await this.fetchBatchesForPayout();

      if (batches.length === 0) {
        return;
      }

      for (const batch of batches) {
        if (batch.status === BuyCryptoBatchStatus.PAYING_OUT) {
          try {
            await this.checkCompletion(batch);
          } catch (e) {
            this.logger.error(`Error on checking previous payout for batch ${batch.id}:`, e);
            continue;
          }
        } else {
          batch.payingOut();
          await this.buyCryptoBatchRepo.save(batch);
        }
      }

      // pay out buy crypto
      const payingOutBatches = batches.filter((b) => b.status === BuyCryptoBatchStatus.PAYING_OUT);
      const transactionsToPayout = payingOutBatches
        .reduce((prev: BuyCrypto[], curr) => prev.concat(curr.transactions), [])
        .filter((r) => r.status === BuyCryptoStatus.READY_FOR_PAYOUT)
        .sort((a, b) => (a.target.address > b.target.address ? 1 : -1));

      const successfulRequests = [];

      for (const transaction of transactionsToPayout) {
        try {
          await this.doPayout(transaction);
          successfulRequests.push(transaction);
        } catch (e) {
          this.logger.error(`Failed to initiate buy-crypto payout for transaction ${transaction.id}:`, e);
          // continue with next transaction in case payout initiation failed
          continue;
        }
      }

      this.logTransactionsPayouts(successfulRequests);
    } catch (e) {
      this.logger.error('Error buy-crypto transaction payout:', e);
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
        'transactions.buy.user.wallet',
        'transactions.buy.asset',
        'transactions.cryptoRoute',
        'transactions.cryptoRoute.user',
        'transactions.cryptoRoute.user.wallet',
        'transactions.cryptoRoute.asset',
        'transactions.cryptoInput',
        'transactions.bankTx',
        'transactions.checkoutTx',
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

    transaction.payingOut();
    await this.buyCryptoRepo.save(transaction);
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

        if (tx.txId !== payoutTxId) {
          tx.setTxId(payoutTxId);
          await this.buyCryptoRepo.save(tx);
        }

        if (isComplete) {
          const payoutFee = await this.buyCryptoPricingService.getFeeAmountInRefAsset(
            tx.outputReferenceAsset,
            nativePayoutFee,
          );

          tx.complete(payoutFee);
          await this.buyCryptoRepo.save(tx);

          //update sift transaction status
          await this.siftService.transaction({
            $transaction_id: tx.id.toString(),
            $transaction_status: TransactionStatus.SUCCESS,
            $time: tx.updated.getTime(),
          } as Transaction);

          // payment webhook
          await this.buyCryptoWebhookService.triggerWebhook(tx);
        }
      } catch (e) {
        this.logger.error(`Error on validating completion for transaction ${tx.id}:`, e);
        continue;
      }
    }

    const isBatchComplete = batch.transactions.every((tx) => tx.isComplete);

    if (isBatchComplete) {
      this.logger.verbose(`Buy-crypto payout complete (batch ID: ${batch.id})`);

      batch.complete();
      await this.buyCryptoBatchRepo.save(batch);
      await this.dexService.completeOrders(LiquidityOrderContext.BUY_CRYPTO, batch.id.toString());
    }
  }

  //*** LOGS ***//

  private logTransactionsPayouts(transactions: BuyCrypto[]): void {
    const transactionsIds = transactions.map((tx) => tx.id);

    transactions.length &&
      this.logger.verbose(`Paying out ${transactionsIds.length} transaction(s). Transaction ID(s): ${transactionsIds}`);
  }
}
