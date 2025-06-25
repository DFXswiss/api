import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class PolygonCoinStrategy extends EvmCoinStrategy {
  protected readonly logger: DfxLogger;

  constructor(readonly loggerFactory: LoggerFactory, protected readonly assetService: AssetService) {
    super();

    this.logger = this.loggerFactory.create(PolygonCoinStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.POLYGON;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  sellLiquidity(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Polygon coin');
  }

  addSellData(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Polygon coin');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getPolygonCoin();
  }
}
