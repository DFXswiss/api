import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PayoutOrderContext } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { PayoutRequest } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { RefReward, RewardStatus } from '../ref-reward.entity';
import { RefRewardRepository } from '../ref-reward.repository';
import { RefRewardService } from './ref-reward.service';

@Injectable()
export class RefRewardOutService {
  private readonly logger: DfxLogger;

  constructor(
    readonly loggerFactory: LoggerFactory,
    private readonly refRewardRepo: RefRewardRepository,
    private readonly payoutService: PayoutService,
    private readonly assetService: AssetService,
    private readonly dexService: DexService,
    private readonly refRewardService: RefRewardService,
  ) {
    this.logger = loggerFactory.create(RefRewardOutService);
  }

  async checkPaidTransaction(): Promise<void> {
    try {
      const transactionsPaidOut = await this.refRewardRepo.find({
        where: { status: RewardStatus.PAYING_OUT },
        relations: { user: true },
      });

      await this.checkCompletion(transactionsPaidOut);
    } catch (e) {
      this.logger.error('Failed to check paid ref-rewards:', e);
    }
  }

  async payoutNewTransactions(): Promise<void> {
    try {
      if (DisabledProcess(Process.CRYPTO_PAYOUT)) return;

      const transactionsToPayout = await this.refRewardRepo.find({
        where: { status: RewardStatus.READY_FOR_PAYOUT },
        relations: { user: true },
      });

      // pay out ref rewards
      const successfulRequests = [];

      for (const transaction of transactionsToPayout) {
        try {
          await this.doPayout(transaction);
          successfulRequests.push(transaction);
        } catch (e) {
          this.logger.error(`Failed to initiate ref-reward payout. Transaction ID: ${transaction.id}`);
          // continue with next transaction in case payout initiation failed
          continue;
        }
      }

      this.logTransactionsPayouts(successfulRequests);
    } catch (e) {
      this.logger.error('Failed to payout new ref-rewards:', e);
    }
  }

  //*** HELPER METHODS ***//

  private async doPayout(transaction: RefReward): Promise<void> {
    const asset = await this.assetService.getNativeAsset(transaction.targetBlockchain);

    const request: PayoutRequest = {
      context: PayoutOrderContext.REF_PAYOUT,
      correlationId: transaction.id.toString(),
      asset,
      amount: transaction.outputAmount,
      destinationAddress: transaction.targetAddress,
    };

    await this.payoutService.doPayout(request);

    await this.refRewardRepo.update(...transaction.payingOut());
  }

  private async checkCompletion(transactions: RefReward[]) {
    for (const tx of transactions) {
      if (tx.outputDate) {
        continue;
      }

      try {
        const { isComplete, payoutTxId } = await this.payoutService.checkOrderCompletion(
          PayoutOrderContext.REF_PAYOUT,
          tx.id.toString(),
        );

        if (isComplete) {
          await this.refRewardRepo.update(...tx.complete(payoutTxId));

          await this.dexService.completeOrders(LiquidityOrderContext.REF_PAYOUT, tx.id.toString());

          await this.refRewardService.updatePaidRefCredit([tx.user?.id]);
        }
      } catch (e) {
        this.logger.error(`Error on checking completion of ref-reward ${tx.id}:`, e);
        continue;
      }
    }
  }

  //*** LOGS ***//

  private logTransactionsPayouts(transactions: RefReward[]): void {
    const transactionsLogs = transactions.map((tx) => tx.id);

    transactions.length &&
      this.logger.info(
        `Paying out ${transactionsLogs.length} reward transaction(s). Transaction ID(s): ${transactionsLogs}`,
      );
  }
}
