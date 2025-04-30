import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { Active, isAsset } from 'src/shared/models/active';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { In } from 'typeorm';
import { LiquidityBalance } from '../../entities/liquidity-balance.entity';
import { LiquidityManagementContext, LiquidityManagementOrderStatus, LiquidityManagementSystem } from '../../enums';
import { LiquidityBalanceIntegration, LiquidityManagementActive } from '../../interfaces';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';

@Injectable()
export class ExchangeAdapter implements LiquidityBalanceIntegration {
  private readonly logger = new DfxLogger(ExchangeAdapter);

  constructor(
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly orderRepo: LiquidityManagementOrderRepository,
  ) {}

  async getBalances(assets: LiquidityManagementActive[]): Promise<LiquidityBalance[]> {
    const liquidityManagementAssets = Util.groupBy<LiquidityManagementActive, LiquidityManagementContext>(
      assets,
      'context',
    );

    const balances = await Util.doGetFulfilled(
      Array.from(liquidityManagementAssets.entries()).map(([e, a]) => this.getForExchange(e, a)),
    );

    return balances.reduce((prev, curr) => prev.concat(curr), []);
  }

  async getNumberOfPendingOrders(_: Active, context: LiquidityManagementContext): Promise<number> {
    const system = Object.values(LiquidityManagementSystem).find((s) => s.toString() === context.toString());
    return system
      ? this.orderRepo.countBy({
          action: { system },
          status: In([LiquidityManagementOrderStatus.CREATED, LiquidityManagementOrderStatus.IN_PROGRESS]),
        })
      : 0;
  }

  // --- HELPER METHODS --- //

  async getForExchange(exchange: string, assets: LiquidityManagementActive[]): Promise<LiquidityBalance[]> {
    try {
      const exchangeService = this.exchangeRegistry.get(exchange);
      const balances = await exchangeService.getTotalBalances();

      return assets.map((a) => {
        const name = isAsset(a) ? a.dexName : a.name;
        const balance = balances[name] ?? 0;

        return LiquidityBalance.create(a, balance);
      });
    } catch (e) {
      this.logger.error(`Failed to update liquidity management balance for ${exchange}:`, e);
      throw e;
    }
  }
}
