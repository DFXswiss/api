import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { In } from 'typeorm';
import { LiquidityBalance } from '../../entities/liquidity-balance.entity';
import { LiquidityManagementOrderStatus, LiquidityManagementSystem } from '../../enums';
import { LiquidityBalanceIntegration, LiquidityManagementAsset } from '../../interfaces';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';

@Injectable()
export class CustomAdapter implements LiquidityBalanceIntegration {
  private readonly logger = new DfxLogger(CustomAdapter);

  constructor(
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly orderRepo: LiquidityManagementOrderRepository,
  ) {}

  async getBalances(assets: LiquidityManagementAsset[]): Promise<LiquidityBalance[]> {
    return Util.doGetFulfilled(assets.map((a) => this.getForAsset(a)));
  }

  async hasPendingOrders(): Promise<boolean> {
    // custom liquidity movements are never blocked
    return false;
  }

  // --- HELPER METHODS --- //

  private async getForAsset(asset: LiquidityManagementAsset): Promise<LiquidityBalance> {
    if (asset.type !== AssetType.CUSTOM) throw new Error(`Asset ${asset.id} is not a custom asset`);

    try {
      switch (asset.name) {
        case 'USDT': {
          // total available USDT balance (Kraken + Binance + transfer)
          const balances = await Promise.all([
            this.exchangeRegistry.get('Kraken').getAvailableBalance(asset.name),
            this.exchangeRegistry.get('Binance').getAvailableBalance(asset.name),
            this.orderRepo.sum('inputAmount', {
              action: { system: In([LiquidityManagementSystem.KRAKEN, LiquidityManagementSystem.BINANCE]) },
              // UNCERTAIN too: the generic quarantine in startNewOrders is not Scrypt-specific, so a
              // Kraken/Binance order can land there — and neither adapter can resolve it, so it would stay
              // put and silently drop its amount out of this balance for as long as it remains unresolved.
              status: In([
                LiquidityManagementOrderStatus.CREATED,
                LiquidityManagementOrderStatus.IN_PROGRESS,
                LiquidityManagementOrderStatus.UNCERTAIN,
              ]),
              inputAsset: asset.name,
            }),
          ]);

          return LiquidityBalance.create(asset, Util.sum(balances));
        }
      }
    } catch (e) {
      this.logger.error(`Failed to update liquidity management balance for custom asset ${asset.id}:`, e);
      throw e;
    }

    throw new Error(`Asset ${asset.id} is not supported by CustomAdapter`);
  }
}
