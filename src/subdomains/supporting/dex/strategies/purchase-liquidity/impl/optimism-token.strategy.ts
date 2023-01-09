import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';
import { PurchaseLiquidityStrategyAlias } from '../purchase-liquidity.facade';
import { DexOptimismService } from '../../../services/dex-optimism.service';

@Injectable()
export class OptimismTokenStrategy extends EvmTokenStrategy {
  constructor(
    protected readonly assetService: AssetService,
    notificationService: NotificationService,
    dexOptimismService: DexOptimismService,
  ) {
    super(notificationService, dexOptimismService, PurchaseLiquidityStrategyAlias.OPTIMISM_TOKEN);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getOptimismCoin();
  }
}
