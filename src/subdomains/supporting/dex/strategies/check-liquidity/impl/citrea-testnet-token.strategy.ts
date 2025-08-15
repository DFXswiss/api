import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexCitreaTestnetService } from '../../../services/dex-citrea-testnet.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class CitreaTestnetTokenStrategy extends EvmTokenStrategy {
  constructor(protected readonly assetService: AssetService, dexCitreaTestnetService: DexCitreaTestnetService) {
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

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getCitreaTestnetCoin();
  }
}