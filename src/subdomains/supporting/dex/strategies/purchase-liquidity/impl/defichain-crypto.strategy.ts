import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityOrderFactory } from '../../../factories/liquidity-order.factory';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DeFiChainNonPoolPairStrategy } from './base/defichain-non-poolpair.strategy';
import { PurchaseLiquidityStrategyAlias } from '../purchase-liquidity.facade';

@Injectable()
export class DeFiChainCryptoStrategy extends DeFiChainNonPoolPairStrategy {
  constructor(
    readonly notificationService: NotificationService,
    readonly assetService: AssetService,
    readonly dexDeFiChainService: DexDeFiChainService,
    readonly liquidityOrderRepo: LiquidityOrderRepository,
    readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {
    super(
      notificationService,
      assetService,
      dexDeFiChainService,
      liquidityOrderRepo,
      liquidityOrderFactory,
      [{ name: 'DFI', type: AssetType.TOKEN }],
      PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO,
    );
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getDfiCoin();
  }
}
