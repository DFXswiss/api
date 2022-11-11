import { Injectable } from '@nestjs/common';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityBalanceIntegrationFactory } from '../factories/liquidity-balance-integration.factory';

@Injectable()
export class LiquidityManagementBalanceService {
  constructor(private readonly balanceIntegrationFactory: LiquidityBalanceIntegrationFactory) {}

  //*** PUBLIC API ***//

  async refreshBalances(rules: LiquidityManagementRule[]): Promise<LiquidityBalance[]> {
    const balanceRequests = rules
      .map((rule) => {
        const integration = this.balanceIntegrationFactory.getIntegration(rule);

        if (!integration) return null;

        return integration.getBalance(rule.target);
      })
      .filter((i) => i);

    return Promise.allSettled(balanceRequests).then((values) =>
      values.filter(this.filterRejectedBalanceCalls).map((b) => b.value),
    );
  }

  findRelevantBalance(rule: LiquidityManagementRule, balances: LiquidityBalance[]): LiquidityBalance {
    const balance = balances.find((b) => b.target === rule.target);

    if (!balance) {
      throw new Error(`Error while trying to find reference asset for ruleId: ${rule.id}. Balance not found`);
    }

    return balance;
  }

  //*** HELPER METHODS ***//

  private filterRejectedBalanceCalls(
    result: PromiseSettledResult<LiquidityBalance>,
  ): result is PromiseFulfilledResult<LiquidityBalance> {
    return result.status === 'fulfilled';
  }
}
