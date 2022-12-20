import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';
import { PurchaseLiquidityStrategyAlias } from '../purchase-liquidity.facade';
import { DexOptimismService } from '../../../services/dex-optimism.service';

@Injectable()
export class OptimismCoinStrategy extends EvmCoinStrategy {
  constructor(
    protected readonly assetService: AssetService,
    notificationService: NotificationService,
    dexOptimismService: DexOptimismService,
  ) {
    super(notificationService, dexOptimismService, PurchaseLiquidityStrategyAlias.OPTIMISM_COIN);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getOptimismCoin();
  }
}
