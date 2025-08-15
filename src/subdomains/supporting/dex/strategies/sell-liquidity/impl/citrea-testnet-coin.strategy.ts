import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class CitreaTestnetCoinStrategy extends EvmCoinStrategy {
  protected readonly logger = new DfxLogger(CitreaTestnetCoinStrategy);

  constructor(protected readonly assetService: AssetService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  sellLiquidity(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for CitreaTestnet coin');
  }

  addSellData(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for CitreaTestnet coin');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getCitreaTestnetCoin();
  }
}