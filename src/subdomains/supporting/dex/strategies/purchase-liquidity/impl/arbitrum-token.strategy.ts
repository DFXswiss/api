import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';
import { PurchaseLiquidityStrategyAlias } from '../purchase-liquidity.facade';
import { DexArbitrumService } from '../../../services/dex-arbitrum.service';

@Injectable()
export class ArbitrumTokenStrategy extends EvmTokenStrategy {
  constructor(
    protected readonly assetService: AssetService,
    notificationService: NotificationService,
    dexArbitrumService: DexArbitrumService,
  ) {
    super(notificationService, dexArbitrumService, PurchaseLiquidityStrategyAlias.ARBITRUM_TOKEN);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getArbitrumCoin();
  }
}
