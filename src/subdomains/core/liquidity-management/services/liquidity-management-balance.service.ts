import { Injectable, OnModuleInit } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { FindOptionsRelations, In } from 'typeorm';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityBalanceIntegrationFactory } from '../factories/liquidity-balance-integration.factory';
import { LiquidityBalanceRepository } from '../repositories/liquidity-balance.repository';

export interface BankBalanceUpdate {
  bank: Bank;
  balance: number;
}

@Injectable()
export class LiquidityManagementBalanceService implements OnModuleInit {
  private readonly logger = new DfxLogger(LiquidityManagementBalanceService);

  constructor(
    private readonly balanceIntegrationFactory: LiquidityBalanceIntegrationFactory,
    private readonly balanceRepo: LiquidityBalanceRepository,
    private readonly bankTxService: BankTxService,
  ) {}

  onModuleInit() {
    this.bankTxService.bankBalanceObservable.subscribe((dto) => this.refreshBankBalance(dto));
  }

  //*** PUBLIC API ***//

  async getAllLiqBalancesForAssets(
    assetIds: number[],
    relations?: FindOptionsRelations<LiquidityBalance>,
  ): Promise<LiquidityBalance[]> {
    return this.balanceRepo.find({ where: { asset: { id: In(assetIds) } }, relations });
  }

  async refreshBalances(rules: LiquidityManagementRule[]): Promise<LiquidityBalance[]> {
    const integrations = this.balanceIntegrationFactory.getIntegrations(rules);

    const startDate = new Date();

    const balanceRequests = integrations.map(({ integration, rules }) =>
      integration.getBalances(rules.map((r) => Object.assign(r.target, { context: r.context }))).catch((e) => {
        this.logger.warn(`Error getting liquidity management balances for rules ${rules.map((r) => r.id)}:`, e);
        throw e;
      }),
    );

    const balances = await Util.doGetFulfilled(balanceRequests).then((balances) =>
      balances.reduce((prev, curr) => prev.concat(curr), []),
    );

    await this.saveBalanceResults(startDate, balances);

    return balances;
  }

  async refreshBankBalance(dto: BankBalanceUpdate): Promise<void> {
    const entity = await this.balanceRepo.findOne({ where: { asset: { bank: { id: dto.bank.id } } } });
    await this.balanceRepo.update(entity.id, { amount: dto.balance });
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

  private async saveBalanceResults(startDate: Date, balances: LiquidityBalance[]): Promise<void> {
    for (const balance of balances) {
      try {
        const existingBalance = await this.balanceRepo.findOneBy({ asset: { id: balance.asset?.id } });

        if (existingBalance.updated > startDate) continue;

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
