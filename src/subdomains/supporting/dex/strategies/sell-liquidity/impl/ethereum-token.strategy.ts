import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SellLiquidityStrategyAlias } from '../sell-liquidity.facade';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class EthereumTokenStrategy extends EvmTokenStrategy {
  constructor(protected readonly assetService: AssetService) {
    super(SellLiquidityStrategyAlias.ETHEREUM_TOKEN);
  }

  sellLiquidity(): Promise<void> {
    throw new Error(`Selling liquidity on DEX is not supported for Ethereum token`);
  }

  addSellData(): Promise<void> {
    throw new Error(`Selling liquidity on DEX is not supported for Ethereum token`);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({ dexName: 'ETH', blockchain: Blockchain.ETHEREUM, type: AssetType.COIN });
  }
}
