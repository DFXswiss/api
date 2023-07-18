import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { isAsset } from 'src/shared/models/active';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LiquidityBalance } from '../../entities/liquidity-balance.entity';
import { LiquidityManagementContext } from '../../enums';
import { LiquidityBalanceIntegration, LiquidityManagementAsset } from '../../interfaces';

@Injectable()
export class ExchangeAdapter implements LiquidityBalanceIntegration {
  private readonly logger = new DfxLogger(ExchangeAdapter);

  constructor(private readonly exchangeRegistry: ExchangeRegistryService) {}

  async getBalances(assets: LiquidityManagementAsset[]): Promise<LiquidityBalance[]> {
    assets = await Util.asyncFilter(assets, (a) => this.hasSafeBalance(a));

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
  private async hasSafeBalance(asset: LiquidityManagementAsset): Promise<boolean> {
    // TODO
    return true;
  }

  async getForExchange(
    exchange: LiquidityManagementContext,
    assets: LiquidityManagementAsset[],
  ): Promise<LiquidityBalance[]> {
    try {
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
}
