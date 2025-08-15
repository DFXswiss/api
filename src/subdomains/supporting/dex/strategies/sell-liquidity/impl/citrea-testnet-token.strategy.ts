import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class CitreaTestnetTokenStrategy extends EvmTokenStrategy {
  protected readonly logger = new DfxLogger(CitreaTestnetTokenStrategy);

  constructor(protected readonly assetService: AssetService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  sellLiquidity(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for CitreaTestnet token');
  }

  addSellData(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for CitreaTestnet token');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getCitreaTestnetCoin();
  }
}