import { Injectable } from '@nestjs/common';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityBalanceFactory } from '../factories/liquidity-balance.factory';

@Injectable()
export class LiquidityManagementBalanceService {
  constructor(private readonly balanceFactory: LiquidityBalanceFactory) {}

  //*** PUBLIC API ***//

  async refreshBalances(rules: LiquidityManagementRule[]): Promise<LiquidityBalance[]> {
    // TODO -> return successful balances, kick out failed promises
    return Promise.all(
      rules.map((rule) => {
        const integration = this.balanceFactory.getIntegration(rule);
        return integration.getBalance(rule.target);
      }),
    ).then((b) => {
      // TODO -> save balances to DB
      return b;
    });
  }

  findRelevantBalance(rule: LiquidityManagementRule, balances: LiquidityBalance[]): LiquidityBalance {
    const balance = balances.find((b) => b.target === rule.target);

    if (!balance) {
      throw new Error(`Error while trying to find reference asset for ruleId: ${rule.id}. Balance not found`);
    }

    return balance;
  }
}
