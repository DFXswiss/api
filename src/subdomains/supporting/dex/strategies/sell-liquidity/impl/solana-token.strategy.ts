import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SellLiquidityStrategy } from './base/sell-liquidity.strategy';

@Injectable()
export class SolanaTokenStrategy extends SellLiquidityStrategy {
  protected readonly logger: DfxLogger;

  constructor(readonly loggerFactory: LoggerFactory, protected readonly assetService: AssetService) {
    super();

    this.logger = this.loggerFactory.create(SolanaTokenStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.SOLANA;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  sellLiquidity(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Solana token');
  }

  addSellData(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Solana token');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getSolanaCoin();
  }
}
