import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexGnosisService } from '../../../services/dex-gnosis.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class GnosisTokenStrategy extends EvmTokenStrategy {
  constructor(protected readonly assetService: AssetService, dexGnosisService: DexGnosisService) {
    super(dexGnosisService);
  }

  get blockchain(): Blockchain {
    return Blockchain.GNOSIS;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getGnosisCoin();
  }
}
