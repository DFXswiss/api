import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { SellLiquidityStrategy } from './base/sell-liquidity.strategy';

@Injectable()
export class TronCoinStrategy extends SellLiquidityStrategy {
  protected readonly logger = new DfxLogger(TronCoinStrategy);

  constructor(protected readonly assetService: AssetService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.TRON;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  sellLiquidity(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Tron coin');
  }

  addSellData(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Tron coin');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getTronCoin();
  }
}
