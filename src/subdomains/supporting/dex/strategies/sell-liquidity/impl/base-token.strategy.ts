import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class BaseTokenStrategy extends EvmTokenStrategy {
  protected readonly logger = new DfxLogger(BaseTokenStrategy);

  constructor(protected readonly assetService: AssetService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.BASE;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  sellLiquidity(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Base token');
  }

  addSellData(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Base token');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBaseCoin();
  }
}
