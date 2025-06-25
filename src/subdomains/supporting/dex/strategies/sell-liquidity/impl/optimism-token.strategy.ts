import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class OptimismTokenStrategy extends EvmTokenStrategy {
  protected readonly logger: DfxLogger;

  constructor(readonly loggerFactory: LoggerFactory, protected readonly assetService: AssetService) {
    super();

    this.logger = this.loggerFactory.create(OptimismTokenStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.OPTIMISM;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  sellLiquidity(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Optimism token');
  }

  addSellData(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Optimism token');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getOptimismCoin();
  }
}
