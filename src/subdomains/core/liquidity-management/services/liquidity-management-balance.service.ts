import { Injectable } from '@nestjs/common';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { BalanceNotCertainException } from '../exceptions/balance-not-certain.exception';
import { LiquidityBalanceIntegrationFactory } from '../factories/liquidity-balance-integration.factory';
import { LiquidityBalanceRepository } from '../repositories/liquidity-balance.repository';

@Injectable()
export class LiquidityManagementBalanceService {
  constructor(
    private readonly balanceIntegrationFactory: LiquidityBalanceIntegrationFactory,
    private readonly balanceRepo: LiquidityBalanceRepository,
  ) {}

  //*** PUBLIC API ***//

  async refreshBalances(rules: LiquidityManagementRule[]): Promise<LiquidityBalance[]> {
    const balanceRequests = await Promise.all(
      rules.map(async (rule) => {
        try {
          const integration = this.balanceIntegrationFactory.getIntegration(rule);

          if (!integration) return null;

          return await integration.getBalance(rule.target);
        } catch (e) {
          if (e instanceof BalanceNotCertainException) {
            console.warn(e.message);
          }

          return null;
        }
      }),
    ).then((r) => r.filter((i) => i));

    const balances = await Promise.allSettled(balanceRequests).then((values) =>
      values.filter(this.filterFulfilledBalanceCalls).map((b) => b.value),
    );

    await this.saveBalanceResults(balances);

    return balances;
  }

  findRelevantBalance(rule: LiquidityManagementRule, balances: LiquidityBalance[]): LiquidityBalance {
    const balance = balances.find((b) => b.target === rule.target);

    if (!balance) {
      throw new Error(`Error while trying to find reference asset for ruleId: ${rule.id}. Balance not found`);
    }

    return balance;
  }

  async getBalances(): Promise<LiquidityBalance[]> {
    return this.balanceRepo.find();
  }

  //*** HELPER METHODS ***//

  private filterFulfilledBalanceCalls(
    result: PromiseSettledResult<LiquidityBalance>,
  ): result is PromiseFulfilledResult<LiquidityBalance> {
    return result.status === 'fulfilled';
  }

  private async saveBalanceResults(balances: LiquidityBalance[]): Promise<void> {
    for (const balance of balances) {
      try {
        const existingBalance = await this.balanceRepo.findOne({
          where: [{ asset: balance.asset }, { fiat: balance.fiat }],
        });

        if (existingBalance) {
          existingBalance.updateBalance(balance.amount ?? 0);
          await this.balanceRepo.save(existingBalance);

          continue;
        }

        await this.balanceRepo.save(balance);
      } catch (e) {
        console.error(`Could not save balance of ${balance.target.name}.`, e);
      }
    }
  }
}
