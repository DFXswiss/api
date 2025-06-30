import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SellLiquidityStrategy } from './base/sell-liquidity.strategy';

@Injectable()
export class BitcoinStrategy extends SellLiquidityStrategy {
  protected readonly logger: DfxLogger;

  constructor(readonly loggerFactory: LoggerFactory, protected readonly assetService: AssetService) {
    super();

    this.logger = this.loggerFactory.create(BitcoinStrategy);
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
