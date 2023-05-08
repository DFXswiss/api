import { Injectable } from '@nestjs/common';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityBalanceIntegrationFactory } from '../factories/liquidity-balance-integration.factory';
import { LiquidityBalanceRepository } from '../repositories/liquidity-balance.repository';
import { Util } from 'src/shared/utils/util';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class LiquidityManagementBalanceService {
  constructor(
    private readonly balanceIntegrationFactory: LiquidityBalanceIntegrationFactory,
    private readonly balanceRepo: LiquidityBalanceRepository,
  ) {}
  private readonly logger = new DfxLogger(LiquidityManagementBalanceService);

  //*** PUBLIC API ***//

  async refreshBalances(rules: LiquidityManagementRule[]): Promise<LiquidityBalance[]> {
    const balanceRequests = rules.map(async (rule) => {
      try {
        const integration = this.balanceIntegrationFactory.getIntegration(rule);
        if (!integration) throw new Error(`Not balance integration found`);

        return await integration.getBalance(rule.target);
      } catch (e) {
        this.logger.warn(`Error getting liquidity management balance for rule ${rule.id}:`, e);

        throw e;
      }
    });

    const balances = await Util.doGetFulfilled(balanceRequests);

    await this.saveBalanceResults(balances);

    return balances;
  }

  findRelevantBalance(rule: LiquidityManagementRule, balances: LiquidityBalance[]): LiquidityBalance | undefined {
    return balances.find((b) => b.target.id === rule.target.id);
  }

  async getBalances(): Promise<LiquidityBalance[]> {
    return this.balanceRepo.find();
  }

  //*** HELPER METHODS ***//

  private async saveBalanceResults(balances: LiquidityBalance[]): Promise<void> {
    for (const balance of balances) {
      try {
        const existingBalance = await this.balanceRepo.findOneBy([
          { asset: { id: balance.asset?.id } },
          { fiat: { id: balance.fiat?.id } },
        ]);

        if (existingBalance) {
          existingBalance.updateBalance(balance.amount ?? 0);
          await this.balanceRepo.save(existingBalance);

          continue;
        }

        await this.balanceRepo.save(balance);
      } catch (e) {
        this.logger.error(`Could not save balance of ${balance.targetName}.`, e);
      }
    }
  }
}
