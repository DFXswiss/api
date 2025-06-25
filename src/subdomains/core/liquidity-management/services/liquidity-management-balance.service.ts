import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Util } from 'src/shared/utils/util';
import { In } from 'typeorm';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityBalanceIntegrationFactory } from '../factories/liquidity-balance-integration.factory';
import { LiquidityBalanceRepository } from '../repositories/liquidity-balance.repository';

@Injectable()
export class LiquidityManagementBalanceService {
  private readonly logger: DfxLogger;

  constructor(
    private readonly balanceIntegrationFactory: LiquidityBalanceIntegrationFactory,
    private readonly balanceRepo: LiquidityBalanceRepository,
    readonly loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(LiquidityManagementBalanceService);
  }

  //*** PUBLIC API ***//

  async getAllLiqBalancesForAssets(assetIds: number[]): Promise<LiquidityBalance[]> {
    return this.balanceRepo.findBy({ asset: { id: In(assetIds) } });
  }

  async refreshBalances(rules: LiquidityManagementRule[]): Promise<LiquidityBalance[]> {
    const integrations = this.balanceIntegrationFactory.getIntegrations(rules);

    const balanceRequests = integrations.map(({ integration, rules }) =>
      integration.getBalances(rules.map((r) => Object.assign(r.target, { context: r.context }))).catch((e) => {
        this.logger.warn(`Error getting liquidity management balances for rules ${rules.map((r) => r.id)}:`, e);
        throw e;
      }),
    );

    const balances = await Util.doGetFulfilled(balanceRequests).then((balances) =>
      balances.reduce((prev, curr) => prev.concat(curr), []),
    );

    await this.saveBalanceResults(balances);

    return balances;
  }

  findRelevantBalance(rule: LiquidityManagementRule, balances: LiquidityBalance[]): LiquidityBalance | undefined {
    return balances.find((b) => b.asset.id === rule.target.id);
  }

  async getBalances(): Promise<LiquidityBalance[]> {
    return this.balanceRepo.find();
  }

  async getNumberOfPendingOrders(rule: LiquidityManagementRule): Promise<number> {
    const integration = this.balanceIntegrationFactory.getIntegration(rule);
    return integration.getNumberOfPendingOrders(rule.target, rule.context);
  }

  //*** HELPER METHODS ***//

  private async saveBalanceResults(balances: LiquidityBalance[]): Promise<void> {
    for (const balance of balances) {
      try {
        const existingBalance = await this.balanceRepo.findOneBy({ asset: { id: balance.asset?.id } });

        if (existingBalance) {
          existingBalance.updateBalance(balance.amount ?? 0);
          await this.balanceRepo.save(existingBalance);

          continue;
        }

        await this.balanceRepo.save(balance);
      } catch (e) {
        this.logger.error(`Could not save balance of ${balance.asset.name}:`, e);
      }
    }
  }
}
