import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { isAsset } from 'src/shared/models/active';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { In } from 'typeorm';
import { LiquidityBalance } from '../../entities/liquidity-balance.entity';
import { LiquidityManagementContext, LiquidityManagementOrderStatus, LiquidityManagementSystem } from '../../enums';
import { LiquidityBalanceIntegration, LiquidityManagementAsset } from '../../interfaces';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';

@Injectable()
export class ExchangeAdapter implements LiquidityBalanceIntegration {
  private readonly logger = new DfxLogger(ExchangeAdapter);

  constructor(
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly orderRepo: LiquidityManagementOrderRepository,
  ) {}

  async getBalances(assets: LiquidityManagementAsset[]): Promise<LiquidityBalance[]> {
    const liquidityManagementAssets = Util.groupBy<LiquidityManagementAsset, LiquidityManagementContext>(
      assets,
      'context',
    );

    const balances = await Util.doGetFulfilled(
      Array.from(liquidityManagementAssets.entries()).map(([e, a]) => this.getForExchange(e, a)),
    );

    return balances.reduce((prev, curr) => prev.concat(curr), []);
  }

  // --- HELPER METHODS --- //

  async getForExchange(exchange: string, assets: LiquidityManagementAsset[]): Promise<LiquidityBalance[]> {
    try {
      const hasSafeBalances = await this.hasSafeBalances(exchange);
      if (!hasSafeBalances) return [];

      const exchangeService = this.exchangeRegistry.getStrategy(exchange);
      const balances = await exchangeService.getBalances().then((b) => b.total);

      return assets.map((a) => {
        const name = isAsset(a) ? a.dexName : a.name;
        const balance = balances[name] ?? 0;

        return LiquidityBalance.create(a, balance);
      });
    } catch (e) {
      this.logger.error(`Failed to update liquidity management balance for ${exchange}:`, e);
    }
  }

  private async hasSafeBalances(exchange: string): Promise<boolean> {
    return this.orderRepo
      .exist({
        where: {
          action: { system: exchange as LiquidityManagementSystem },
          status: In([LiquidityManagementOrderStatus.CREATED, LiquidityManagementOrderStatus.IN_PROGRESS]),
        },
      })
      .then((r) => !r);
  }
}
