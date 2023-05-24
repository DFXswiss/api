import { Injectable } from '@nestjs/common';
import { PayoutOrderContext } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { PayoutRequest } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { RefRewardRepository } from './ref-reward.repository';
import { RefReward, RewardStatus } from './ref-reward.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class RefRewardOutService {
  private readonly logger = new DfxLogger(RefRewardOutService);

  constructor(
    private readonly refRewardRepo: RefRewardRepository,
    private readonly payoutService: PayoutService,
    private readonly assetService: AssetService,
    private readonly userService: UserService,
    private readonly dexService: DexService,
  ) {}

  async checkPaidTransaction(): Promise<void> {
    try {
      const transactionsPaidOut = await this.refRewardRepo.find({
        where: { status: RewardStatus.PAYING_OUT },
        relations: ['user'],
      });

      await this.checkCompletion(transactionsPaidOut);
    } catch (e) {
      this.logger.error('Failed to check paid ref-rewards:', e);
    }
  }

  async payoutNewTransactions(): Promise<void> {
    try {
      const transactionsToPayout = await this.refRewardRepo.find({
        where: { status: RewardStatus.READY_FOR_PAYOUT },
        relations: ['user'],
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

  private async updatePaidRefCredit(userIds: number[]): Promise<void> {
    userIds = userIds.filter((u, j) => userIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of userIds) {
      const { volume } = await this.refRewardRepo
        .createQueryBuilder('refReward')
        .select('SUM(amountInEur)', 'volume')
        .innerJoin('refReward.user', 'user')
        .where('user.id = :id', { id })
        .getRawOne<{ volume: number }>();

      await this.userService.updatePaidRefCredit(id, volume ?? 0);
    }
  }

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

          await this.updatePaidRefCredit([tx.user?.id]);
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
