import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { SellLiquidityStrategy } from './base/sell-liquidity.strategy';

@Injectable()
export class BitcoinStrategy extends SellLiquidityStrategy {
  protected readonly logger = new DfxLogger(BitcoinStrategy);

  constructor(protected readonly assetService: AssetService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }

  get assetType(): AssetType {
    return undefined;
  }

  sellLiquidity(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for bitcoin');
  }

  addSellData(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for bitcoin');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBtcCoin();
  }
}
