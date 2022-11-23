import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';
import { PurchaseLiquidityStrategyAlias } from '../purchase-liquidity.facade';

@Injectable()
export class EthereumCoinStrategy extends EvmCoinStrategy {
  constructor(
    private readonly assetService: AssetService,
    notificationService: NotificationService,
    dexEthereumService: DexEthereumService,
  ) {
    super(notificationService, dexEthereumService, PurchaseLiquidityStrategyAlias.ETHEREUM_COIN);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getEthCoin();
  }
}
