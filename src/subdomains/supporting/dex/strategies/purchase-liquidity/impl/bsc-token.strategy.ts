import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexBscService } from '../../../services/dex-bsc.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';
import { PurchaseLiquidityStrategyAlias } from '../purchase-liquidity.facade';

@Injectable()
export class BscTokenStrategy extends EvmTokenStrategy {
  constructor(
    protected readonly assetService: AssetService,
    notificationService: NotificationService,
    dexBscService: DexBscService,
  ) {
    super(notificationService, dexBscService, PurchaseLiquidityStrategyAlias.BSC_TOKEN);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBnbCoin();
  }
}
