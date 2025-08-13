import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DexCitreaTestnetService } from '../../../services/dex-citrea-testnet.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class CitreaTestnetTokenStrategy extends PurchaseStrategy {
  protected readonly logger = new DfxLogger(CitreaTestnetTokenStrategy);

  constructor(dexCitreaTestnetService: DexCitreaTestnetService) {
    super(dexCitreaTestnetService);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
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
    return this.assetService.getCitreaTestnetCoin();
  }
}