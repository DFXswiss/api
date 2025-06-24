import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { DexArbitrumService } from '../../../services/dex-arbitrum.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class ArbitrumTokenStrategy extends PurchaseStrategy {
  protected readonly logger: DfxLoggerService;

  constructor(private readonly dfxLogger: DfxLoggerService, dexArbitrumService: DexArbitrumService) {
    super(dexArbitrumService);

    this.logger = this.dfxLogger.create(ArbitrumTokenStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.ARBITRUM;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  get dexName(): string {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getArbitrumCoin();
  }
}
