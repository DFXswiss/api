import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { LiquidityOrderFactory } from '../../../factories/liquidity-order.factory';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DeFiChainNonPoolPairStrategy } from './base/defichain-non-poolpair.strategy';

@Injectable()
export class DeFiChainStockStrategy extends DeFiChainNonPoolPairStrategy {
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
      [{ name: 'DUSD', type: AssetType.TOKEN }],
      'DeFiChainStock',
    );
  }

  get blockchain(): Blockchain {
    return Blockchain.DEFICHAIN;
  }

  get assetType(): AssetType {
    return undefined;
  }

  get assetCategory(): AssetCategory {
    return AssetCategory.STOCK;
  }

  get dexName(): string {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getDfiCoin();
  }
}
