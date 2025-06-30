import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class ArbitrumCoinStrategy extends EvmCoinStrategy {
  protected readonly logger: DfxLogger;

  constructor(readonly loggerFactory: LoggerFactory, protected readonly assetService: AssetService) {
    super();

    this.logger = this.loggerFactory.create(ArbitrumCoinStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.ARBITRUM;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  sellLiquidity(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Arbitrum coin');
  }

  addSellData(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Arbitrum coin');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getArbitrumCoin();
  }
}
