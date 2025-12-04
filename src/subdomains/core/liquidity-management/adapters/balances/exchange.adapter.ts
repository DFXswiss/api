import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { ScryptService } from 'src/integration/exchange/services/scrypt.service';
import { Active } from 'src/shared/models/active';
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

  private readonly ASSET_MAPPINGS = { BTC: ['XBT'] };

  constructor(
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly scryptService: ScryptService,
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

  async hasPendingOrders(active: Active, context: LiquidityManagementContext): Promise<boolean> {
    const system = Object.values(LiquidityManagementSystem).find((s) => s.toString() === context.toString());
    const query = {
      action: { system },
      status: In([LiquidityManagementOrderStatus.CREATED, LiquidityManagementOrderStatus.IN_PROGRESS]),
    };

    return system
      ? this.orderRepo.existsBy([
          {
            ...query,
            inputAsset: active.name,
          },
          {
            ...query,
            outputAsset: active.name,
          },
        ])
      : false;
  }

  // --- HELPER METHODS --- //

  async getForExchange(exchange: string, assets: LiquidityManagementAsset[]): Promise<LiquidityBalance[]> {
    try {
      const exchangeService =
        exchange === LiquidityManagementSystem.SCRYPT ? this.scryptService : this.exchangeRegistry.get(exchange);
      const balances = await exchangeService.getTotalBalances();

      return assets.map((a) => {
        const names = [a.dexName, ...(this.ASSET_MAPPINGS[a.dexName] ?? [])];
        const balance = Util.sum(names.map((n) => balances[n] ?? 0));

        return LiquidityBalance.create(a, balance);
      });
    } catch (e) {
      this.logger.error(`Failed to update liquidity management balance for ${exchange}:`, e);
      throw e;
    }
  }
}
